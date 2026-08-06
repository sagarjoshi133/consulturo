"""ConsultUro — Phase A multi-tenant migration.

Idempotent. Safe to run multiple times. Always checks current state
before mutating anything.

What it does:
 1. Creates the default clinic "Dr Joshi's Uro Clinic" (slug
    `dr-joshi-uro`) owned by sagar.joshi133@gmail.com if it doesn't
    exist yet. Reuses the existing clinic_settings record (logo, copy,
    letterhead) as the clinic's `branding` blob.
 2. Creates `clinic_memberships` for every existing staff user (every
    user with role in CLINIC_ROLES) so Day-1 users keep their access.
 3. Backfills `clinic_id` on every TENANT_SCOPED_COLLECTIONS row that
    doesn't already have one — points them at the default clinic.
 4. Builds the recommended Mongo indexes (delegated to
    services.tenancy.ensure_indexes).

Run with:
    cd /app/backend && python -m migrations.001_multi_tenant
"""
from __future__ import annotations

import asyncio
import os
import sys
import time
from typing import Dict, Any

# Allow execution as `python -m migrations.001_multi_tenant` from the
# /app/backend directory.
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from db import db  # noqa: E402  (path mutation above)
from services.tenancy import (  # noqa: E402
    CLINIC_ROLES,
    CLINICS_COLL,
    MEMBERSHIPS_COLL,
    TENANT_SCOPED_COLLECTIONS,
    create_clinic,
    ensure_indexes,
    get_clinic_by_slug,
    upsert_membership,
)

DEFAULT_OWNER_EMAIL = "sagar.joshi133@gmail.com"
DEFAULT_CLINIC_NAME = "Dr Joshi's Uro Clinic"
DEFAULT_CLINIC_SLUG = "dr-joshi-uro"


async def _resolve_owner_user_id() -> str:
    user = await db["users"].find_one(
        {"email": DEFAULT_OWNER_EMAIL},
        {"_id": 0, "user_id": 1, "id": 1, "name": 1, "role": 1},
    )
    if not user:
        raise RuntimeError(
            f"Default-owner user '{DEFAULT_OWNER_EMAIL}' not found in users "
            "collection. Cannot run multi-tenant migration."
        )
    uid = user.get("user_id") or user.get("id")
    if not uid:
        raise RuntimeError(
            f"Default-owner user has no `user_id` field: {user}"
        )
    return uid


async def _ensure_default_clinic(owner_user_id: str) -> Dict[str, Any]:
    existing = await get_clinic_by_slug(DEFAULT_CLINIC_SLUG)
    if existing:
        print(f"  ✓ default clinic already exists: {existing['clinic_id']}")
        return existing

    # Carry over ALL existing clinic_settings (signature, letterhead,
    # patient education copy, …) into the new clinic's branding blob.
    cs = await db["clinic_settings"].find_one({}, {"_id": 0}) or {}

    branding = {
        "signature_url": cs.get("signature_url", ""),
        "letterhead_image_b64": cs.get("letterhead_image_b64", ""),
        "use_letterhead": cs.get("use_letterhead", False),
        "patient_education_html": cs.get("patient_education_html", ""),
        "need_help_html": cs.get("need_help_html", ""),
        "external_blog_feed_url": cs.get("external_blog_feed_url", ""),
        "external_youtube_channel_url": cs.get("external_youtube_channel_url", ""),
        "external_youtube_channel_id": cs.get("external_youtube_channel_id", ""),
        # external_youtube_api_key intentionally NOT copied (sensitive).
    }

    clinic = await create_clinic(
        name=DEFAULT_CLINIC_NAME,
        primary_owner_id=owner_user_id,
        slug=DEFAULT_CLINIC_SLUG,
        tagline="Premier Urology Care, Vadodara",
        address="Sterling Hospitals, Race Course Road, Vadodara – 390007",
        phone="+91 81550 75669",
        email=DEFAULT_OWNER_EMAIL,
        branding=branding,
    )
    print(f"  ✓ created default clinic: {clinic['clinic_id']}  (slug={clinic['slug']})")
    return clinic


async def _migrate_existing_users(clinic_id: str, owner_user_id: str) -> int:
    """Create memberships for every active staff user. Patients are NOT
    auto-assigned (their data lives in `patients` collection which is
    tenant-scoped — a patient row tagged with `clinic_id` is enough for
    the chart-history flow)."""
    cursor = db["users"].find(
        {"role": {"$in": list(CLINIC_ROLES)}},
        {"_id": 0, "user_id": 1, "id": 1, "email": 1, "role": 1, "is_demo": 1},
    )
    n = 0
    async for u in cursor:
        # Demo users intentionally are not auto-added — they're created
        # for short-lived previews and shouldn't pollute member rosters.
        if u.get("is_demo"):
            continue
        uid = u.get("user_id") or u.get("id")
        if not uid or not u.get("role"):
            continue
        existing = await db[MEMBERSHIPS_COLL].find_one(
            {"user_id": uid, "clinic_id": clinic_id}, {"_id": 1}
        )
        if existing:
            continue
        # Map user.role → clinic_role. The OWNERship is reserved for
        # the actual primary_owner; everyone else keeps their role.
        clinic_role = u["role"]
        if uid == owner_user_id:
            clinic_role = "primary_owner"
        elif clinic_role not in CLINIC_ROLES:
            clinic_role = "doctor"
        await upsert_membership(
            user_id=uid,
            clinic_id=clinic_id,
            role=clinic_role,
            invited_by=owner_user_id,
            is_active=True,
        )
        n += 1
    print(f"  ✓ created {n} new memberships")
    return n


async def _backfill_clinic_id(clinic_id: str) -> Dict[str, int]:
    """For every tenant-scoped collection, set `clinic_id` on rows that
    don't already have one. Counts are reported per collection."""
    out: Dict[str, int] = {}
    for coll in TENANT_SCOPED_COLLECTIONS:
        result = await db[coll].update_many(
            {"$or": [{"clinic_id": {"$exists": False}}, {"clinic_id": None}, {"clinic_id": ""}]},
            {"$set": {"clinic_id": clinic_id, "_migrated_at": int(time.time() * 1000)}},
        )
        out[coll] = result.modified_count
    print("  ✓ backfilled clinic_id on collections:")
    for k, v in out.items():
        if v:
            print(f"      • {k:<24} → {v} row(s)")
    return out


async def main() -> None:
    print("Multi-tenant migration starting …")
    print(f"  • Mongo: {os.environ.get('MONGO_URL')}  db={os.environ.get('DB_NAME', 'consulturo')}")

    print("\n[1/4] Ensuring indexes")
    await ensure_indexes()

    print("\n[2/4] Resolving default owner")
    owner_id = await _resolve_owner_user_id()
    print(f"  ✓ owner user_id: {owner_id}")

    print("\n[3/4] Ensuring default clinic")
    clinic = await _ensure_default_clinic(owner_id)

    print("\n[4/4] Backfilling memberships + clinic_id")
    await _migrate_existing_users(clinic["clinic_id"], owner_id)
    await _backfill_clinic_id(clinic["clinic_id"])

    # Snapshot for the CLI.
    counts = {}
    counts["clinics"] = await db[CLINICS_COLL].count_documents({})
    counts["memberships"] = await db[MEMBERSHIPS_COLL].count_documents({})
    print("\nDone. Final state:")
    for k, v in counts.items():
        print(f"  • {k:<14} = {v}")
    print(f"  • default clinic_id = {clinic['clinic_id']}  (slug={clinic['slug']})")


if __name__ == "__main__":
    asyncio.run(main())
