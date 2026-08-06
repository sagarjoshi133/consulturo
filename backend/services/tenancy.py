"""ConsultUro — Multi-tenant (clinic) helpers.

Phase A foundation. Provides:
 • `Clinic` / `ClinicMembership` ad-hoc dict shapes (no Pydantic — matches
   the rest of the codebase which uses dicts + light validation).
 • `slugify(name)` — collision-aware URL slug generator.
 • `get_user_clinics(user_id)` → memberships sorted by recency.
 • `get_default_clinic_id(user)` — the first/active clinic the user belongs to.
 • `resolve_clinic_id(request, user)` — pulls clinic_id from the
   `X-Clinic-Id` header (or `?clinic=<id>` fallback), validates the user
   has membership in it, and returns the effective clinic_id (or None for
   super_owner viewing "All Clinics").
 • `tenant_filter(user, clinic_id, *, allow_global)` — Mongo filter dict
   that scopes a query to the resolved clinic. super_owner with no
   X-Clinic-Id gets `{}` (sees everything).

Design notes (Phase A scope):
 • Auth, sessions, push tokens, audit logs, notifications stay GLOBAL —
   they're per-user, not per-clinic.
 • Clinic-scoped collections: bookings, prescriptions, surgeries,
   patients, ipss_records, ipss_submissions, blog_posts, medicines_custom,
   availability, unavailabilities, prostate_readings, bladder_diary,
   notes, clinic_settings, broadcast_inbox.
 • A user can be in MULTIPLE clinics (memberships table). `users.role`
   stays as the user's HIGHEST role across all clinics for backward
   compatibility; per-clinic role lives on the membership.
"""
from __future__ import annotations

import re
import time
import uuid
from typing import Any, Dict, List, Optional

from fastapi import HTTPException, Request

from db import db


# ── Constants ───────────────────────────────────────────────────────────
CLINICS_COLL = "clinics"
MEMBERSHIPS_COLL = "clinic_memberships"

# Collections that are SCOPED to a single clinic. Used by the migration
# script to backfill `clinic_id` and by tenant_filter() to know which
# queries to scope. Order doesn't matter — kept stable for readability.
TENANT_SCOPED_COLLECTIONS = [
    "bookings",
    "prescriptions",
    "surgeries",
    "patients",
    "ipss_records",
    "ipss_submissions",
    "blog_posts",
    "medicines_custom",
    "availability",
    "unavailabilities",
    "prostate_readings",
    "bladder_diary",
    "notes",
    "clinic_settings",
    "broadcast_inbox",
]

# Roles allowed inside a clinic membership. Mirrors auth_deps.STAFF_ROLES
# minus `super_owner` (which is platform-level, not clinic-scoped).
CLINIC_ROLES = {
    "primary_owner",
    "partner",
    "doctor",
    "assistant",
    "reception",
    "nursing",
}


# ── Slug helpers ────────────────────────────────────────────────────────
_SLUG_NORMALISE_RE = re.compile(r"[^a-z0-9]+")
_SLUG_TRIM_RE = re.compile(r"(^-+|-+$)")


def _normalise_slug(text: str) -> str:
    """Lowercase + strip non-alphanumeric → kebab-case. ASCII-only."""
    s = (text or "").strip().lower()
    s = _SLUG_NORMALISE_RE.sub("-", s)
    s = _SLUG_TRIM_RE.sub("", s)
    if not s:
        s = "clinic"
    # Mongo URL routes prefer ≤ 60 chars to keep paths neat.
    return s[:60]


async def slugify(name: str, *, prefer: Optional[str] = None) -> str:
    """Generate a URL-safe slug that doesn't collide with an existing
    clinic. Tries `prefer` (if given) first, then `name`, then appends
    `-2`, `-3`, … until unique.

    Returns the chosen slug. Never raises.
    """
    base = _normalise_slug(prefer or name or "clinic")
    candidate = base
    n = 1
    while True:
        existing = await db[CLINICS_COLL].find_one({"slug": candidate}, {"_id": 1})
        if not existing:
            return candidate
        n += 1
        candidate = f"{base}-{n}"
        if n > 50:
            # Defensive — append a short random suffix and bail.
            return f"{base}-{uuid.uuid4().hex[:6]}"


# ── CRUD helpers ────────────────────────────────────────────────────────
def _now_ms() -> int:
    return int(time.time() * 1000)


async def create_clinic(
    *,
    name: str,
    primary_owner_id: str,
    slug: Optional[str] = None,
    tagline: str = "",
    address: str = "",
    phone: str = "",
    email: str = "",
    branding: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Create a new clinic + auto-create the primary_owner membership.

    Idempotent on `slug` — if a clinic with the resolved slug already
    exists, raises 409. Caller should pre-check or pass a known-unique
    slug from `slugify()`.
    """
    final_slug = slug or await slugify(name)
    if await db[CLINICS_COLL].find_one({"slug": final_slug}, {"_id": 1}):
        raise HTTPException(status_code=409, detail=f"Slug '{final_slug}' already in use")

    clinic_id = f"clinic_{uuid.uuid4().hex[:12]}"
    now = _now_ms()
    doc = {
        "clinic_id": clinic_id,
        "slug": final_slug,
        "name": name.strip() or final_slug,
        "tagline": tagline.strip(),
        "address": address.strip(),
        "phone": phone.strip(),
        "email": email.strip(),
        "branding": branding or {},
        "primary_owner_id": primary_owner_id,
        "created_at": now,
        "updated_at": now,
        "is_active": True,
        "deleted_at": None,
    }
    await db[CLINICS_COLL].insert_one(doc)

    # Auto-create the primary_owner membership.
    await upsert_membership(
        user_id=primary_owner_id,
        clinic_id=clinic_id,
        role="primary_owner",
        invited_by=None,  # self-created
    )
    doc.pop("_id", None)
    return doc


async def upsert_membership(
    *,
    user_id: str,
    clinic_id: str,
    role: str = "doctor",
    invited_by: Optional[str] = None,
    is_active: bool = True,
) -> Dict[str, Any]:
    """Insert or reactivate a (user_id, clinic_id) membership. Validates
    role against `CLINIC_ROLES`."""
    if role not in CLINIC_ROLES:
        raise HTTPException(status_code=400, detail=f"Invalid clinic role: {role}")
    now = _now_ms()
    existing = await db[MEMBERSHIPS_COLL].find_one(
        {"user_id": user_id, "clinic_id": clinic_id}, {"_id": 0}
    )
    if existing:
        await db[MEMBERSHIPS_COLL].update_one(
            {"user_id": user_id, "clinic_id": clinic_id},
            {"$set": {"role": role, "is_active": is_active, "updated_at": now}},
        )
        existing.update({"role": role, "is_active": is_active, "updated_at": now})
        return existing
    doc = {
        "membership_id": f"mb_{uuid.uuid4().hex[:12]}",
        "user_id": user_id,
        "clinic_id": clinic_id,
        "role": role,
        "is_active": is_active,
        "invited_by": invited_by,
        "joined_at": now,
        "updated_at": now,
    }
    await db[MEMBERSHIPS_COLL].insert_one(doc)
    doc.pop("_id", None)
    return doc


async def get_user_clinics(user_id: str, *, only_active: bool = True) -> List[Dict[str, Any]]:
    """Returns [{clinic, role}] for every clinic the user is a member of."""
    membership_filter: Dict[str, Any] = {"user_id": user_id}
    if only_active:
        membership_filter["is_active"] = True
    cursor = db[MEMBERSHIPS_COLL].find(membership_filter, {"_id": 0})
    memberships = await cursor.to_list(length=200)
    if not memberships:
        return []
    clinic_ids = list({m["clinic_id"] for m in memberships})
    clinic_cursor = db[CLINICS_COLL].find(
        {"clinic_id": {"$in": clinic_ids}, "deleted_at": None}, {"_id": 0}
    )
    clinics_by_id = {c["clinic_id"]: c async for c in clinic_cursor}
    out: List[Dict[str, Any]] = []
    for m in memberships:
        c = clinics_by_id.get(m["clinic_id"])
        if not c:
            continue
        out.append({
            "clinic": c,
            "role": m["role"],
            "is_active": m.get("is_active", True),
            "joined_at": m.get("joined_at"),
        })
    # Sort: primary_owner first, then by recency.
    out.sort(key=lambda x: (
        0 if x["role"] == "primary_owner" else 1 if x["role"] == "partner" else 2,
        -(x.get("joined_at") or 0),
    ))
    return out


async def get_default_clinic_id(user: Dict[str, Any]) -> Optional[str]:
    """First active clinic the user belongs to. None for users with no
    membership (typically `patient` role or a freshly-signed-in user)."""
    uid = (user or {}).get("user_id") or (user or {}).get("id")
    if not uid:
        return None
    clinics = await get_user_clinics(uid, only_active=True)
    if not clinics:
        return None
    return clinics[0]["clinic"]["clinic_id"]


# ── Request-time scoping ────────────────────────────────────────────────
async def resolve_clinic_id(
    request: Request, user: Dict[str, Any]
) -> Optional[str]:
    """Resolve the effective `clinic_id` for the current request.

    Resolution order:
      1. `X-Clinic-Id` request header
      2. `?clinic=<id>` query param
      3. user's default clinic (first active membership)
      4. None  → super_owner viewing "All Clinics" / unauthenticated

    For non-super_owner users, the resolved clinic_id MUST be one they
    have an active membership in — otherwise raises 403.

    Patients / users with no memberships return None silently (their
    routes don't use tenant_filter anyway).
    """
    if not user:
        return None
    role = user.get("role")
    is_super = role == "super_owner"

    raw = request.headers.get("X-Clinic-Id") or request.query_params.get("clinic")
    raw = (raw or "").strip()

    # super_owner: no header → None (sees all). Header set → use it as-is
    # (we trust super_owner). Empty string also means "all clinics".
    if is_super:
        return raw or None

    uid = user.get("user_id") or user.get("id")
    if raw:
        # Validate membership.
        m = await db[MEMBERSHIPS_COLL].find_one(
            {"user_id": uid, "clinic_id": raw, "is_active": True}, {"_id": 1}
        )
        if not m:
            raise HTTPException(
                status_code=403,
                detail="You are not a member of this clinic.",
            )
        return raw

    # No header — fall back to user's default clinic.
    return await get_default_clinic_id(user)


def tenant_filter(
    user: Dict[str, Any],
    clinic_id: Optional[str],
    *,
    allow_global: bool = False,
) -> Dict[str, Any]:
    """Build a Mongo filter that scopes a query to the resolved clinic.

    • super_owner with clinic_id=None  → `{}` (sees ALL clinics).
    • super_owner with explicit id     → `{"clinic_id": id}`.
    • normal user with id              → `{"clinic_id": id}`.
    • normal user with id=None +
      `allow_global=True`              → `{}` (router opted-in).
    • normal user with id=None +
      `allow_global=False`             → raises 400 (mis-configured).
    """
    role = (user or {}).get("role")
    is_super = role == "super_owner"
    if clinic_id:
        return {"clinic_id": clinic_id}
    if is_super or allow_global:
        return {}
    raise HTTPException(
        status_code=400,
        detail="Missing clinic context — pass X-Clinic-Id header.",
    )


# ── Public lookup ───────────────────────────────────────────────────────
async def get_clinic_by_slug(slug: str) -> Optional[Dict[str, Any]]:
    """Fetch by URL slug. Used by /api/clinics/by-slug/{slug} for the
    public clinic landing page (anonymous access)."""
    if not slug:
        return None
    doc = await db[CLINICS_COLL].find_one(
        {"slug": slug.strip().lower(), "deleted_at": None}, {"_id": 0}
    )
    return doc


async def get_clinic_by_id(clinic_id: str) -> Optional[Dict[str, Any]]:
    if not clinic_id:
        return None
    return await db[CLINICS_COLL].find_one(
        {"clinic_id": clinic_id, "deleted_at": None}, {"_id": 0}
    )


# ── Indexes (idempotent) ────────────────────────────────────────────────
async def ensure_indexes() -> None:
    """Create the required indexes. Called on app startup. Idempotent."""
    await db[CLINICS_COLL].create_index("clinic_id", unique=True)
    await db[CLINICS_COLL].create_index("slug", unique=True)
    await db[CLINICS_COLL].create_index("primary_owner_id")
    await db[MEMBERSHIPS_COLL].create_index(
        [("user_id", 1), ("clinic_id", 1)], unique=True
    )
    await db[MEMBERSHIPS_COLL].create_index("clinic_id")
    await db[MEMBERSHIPS_COLL].create_index("user_id")
    # Helpful tenant-scoped indexes — speeds up the universal
    # {"clinic_id": x} filter on the largest collections.
    for coll in ("bookings", "prescriptions", "surgeries", "patients"):
        await db[coll].create_index("clinic_id")
