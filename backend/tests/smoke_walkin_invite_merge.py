"""Smoke test — Walk-in invites + duplicate detection.

Verifies:
  * POST /api/registry/patients/{id}/invite for phone-only, email-only
    and phone+email patients.
  * Records `invited_at` / `invite_count` on the registry row.
  * GET /api/registry/patients/{id}/duplicates returns strong match
    on phone (same last-10 digits) and weak match on similar name.
  * Existing POST /merge endpoint absorbs the duplicate cleanly.

Runs stand-alone:  python -m tests.smoke_walkin_invite_merge
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import httpx  # noqa: E402
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

BASE = "http://localhost:8001"


async def _mint_owner_session(db) -> str:
    owner = await db.users.find_one(
        {"role": {"$in": ["super_owner", "primary_owner", "owner"]}},
        {"_id": 0, "user_id": 1},
    )
    if not owner:
        raise RuntimeError("no owner-tier user seed available")
    token = "smoke-" + uuid.uuid4().hex
    await db.user_sessions.insert_one({
        "session_token": token,
        "user_id": owner["user_id"],
        "created_at": datetime.now(timezone.utc),
        "expires_at": datetime.now(timezone.utc).replace(year=2099),
    })
    return token


async def main():
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ.get("DB_NAME", "consulturo")]

    tag = uuid.uuid4().hex[:6]
    now = datetime.now(timezone.utc)

    # ── Seed ──
    phone_only_pid = str(uuid.uuid4())
    email_only_pid = str(uuid.uuid4())
    both_pid = str(uuid.uuid4())
    dup_by_phone_pid = str(uuid.uuid4())
    dup_by_name_pid = str(uuid.uuid4())
    other_pid = str(uuid.uuid4())

    ten = f"9{tag[:9]}"[-10:]  # unique last-10 digits

    await db.patients.insert_many([
        {"patient_id": phone_only_pid, "name": f"Walkin phone {tag}",
         "phone": ten, "phone_digits": ten,
         "first_seen_at": now, "created_at": now, "updated_at": now},
        {"patient_id": email_only_pid, "name": f"Walkin email {tag}",
         "email": f"walkin-{tag}@example.com",
         "first_seen_at": now, "created_at": now, "updated_at": now},
        {"patient_id": both_pid, "name": f"Sagar Joshi Test {tag}",
         "phone": f"8{tag[:9]}"[-10:], "phone_digits": f"8{tag[:9]}"[-10:],
         "email": f"sagar-{tag}@example.com",
         "first_seen_at": now, "created_at": now, "updated_at": now},
        # Duplicate: same phone as phone_only
        {"patient_id": dup_by_phone_pid, "name": f"Walkin phone dup {tag}",
         "phone": ten, "phone_digits": ten,
         "first_seen_at": now, "created_at": now, "updated_at": now},
        # Duplicate: similar name to both_pid (Sagar Joshi), no phone/email conflict
        {"patient_id": dup_by_name_pid, "name": f"Sagar Joshi {tag}",
         "first_seen_at": now, "created_at": now, "updated_at": now},
        # UNRELATED — different name, different phone, different email → not a candidate
        {"patient_id": other_pid, "name": f"Bob Smith {tag}",
         "phone": f"7{tag[:9]}"[-10:], "phone_digits": f"7{tag[:9]}"[-10:],
         "email": f"bob-{tag}@example.com",
         "first_seen_at": now, "created_at": now, "updated_at": now},
    ])

    token = await _mint_owner_session(db)
    H = {"Authorization": f"Bearer {token}"}
    created_ids = [phone_only_pid, email_only_pid, both_pid,
                    dup_by_phone_pid, dup_by_name_pid, other_pid]

    try:
        async with httpx.AsyncClient(base_url=BASE, timeout=15) as http:
            # ── 1. Invite phone-only patient ──
            r = await http.post(f"/api/registry/patients/{phone_only_pid}/invite",
                                 headers=H)
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["ok"] and body["wa_url"] and body["sms_uri"]
            assert body["mailto_uri"] is None  # no email → no mailto
            assert body["join_url"].startswith("http")
            print(f"✓ phone-only invite → wa_url + sms_uri (no mailto)")

            # ── 2. Invite email-only patient (magic link + mailto, no wa) ──
            r = await http.post(f"/api/registry/patients/{email_only_pid}/invite",
                                 headers=H)
            body = r.json()
            assert body["ok"]
            assert body["mailto_uri"], "expected mailto for email-only"
            assert body["wa_url"] is None, "no phone → no wa_url"
            assert "magic/redirect" in body["join_url"], "expected magic-link join url"
            print(f"✓ email-only invite → mailto + magic-link join url")

            # ── 3. Invite phone+email — expect all channels ──
            r = await http.post(f"/api/registry/patients/{both_pid}/invite",
                                 headers=H)
            body = r.json()
            assert body["wa_url"] and body["sms_uri"] and body["mailto_uri"]
            print(f"✓ phone+email invite → wa + sms + mailto")

            # ── 4. Registry row stamped with invited_at + invite_count ──
            row = await db.patients.find_one({"patient_id": phone_only_pid})
            assert row.get("invited_at") is not None
            assert (row.get("invite_count") or 0) >= 1
            # Re-invite bumps counter.
            await http.post(f"/api/registry/patients/{phone_only_pid}/invite", headers=H)
            row = await db.patients.find_one({"patient_id": phone_only_pid})
            assert row.get("invite_count") >= 2
            print(f"✓ invited_at recorded + invite_count = {row.get('invite_count')}")

            # ── 5. Patient with no contact info → 400 ──
            no_contact_pid = str(uuid.uuid4())
            await db.patients.insert_one({
                "patient_id": no_contact_pid, "name": f"No contact {tag}",
                "first_seen_at": now, "created_at": now, "updated_at": now,
            })
            created_ids.append(no_contact_pid)
            r = await http.post(f"/api/registry/patients/{no_contact_pid}/invite", headers=H)
            assert r.status_code == 400
            print(f"✓ patient with no contact → 400")

            # ── 6. Duplicate detection — phone match ──
            r = await http.get(f"/api/registry/patients/{phone_only_pid}/duplicates",
                                headers=H)
            body = r.json()
            ids = [c["patient_id"] for c in body["candidates"]]
            assert dup_by_phone_pid in ids
            strong = [c for c in body["candidates"] if c["confidence"] == "strong"]
            assert any(c["patient_id"] == dup_by_phone_pid for c in strong)
            print(f"✓ same-phone dup surfaced (STRONG, reasons={next(c['reasons'] for c in strong if c['patient_id']==dup_by_phone_pid)})")

            # ── 7. Duplicate detection — name match ──
            r = await http.get(f"/api/registry/patients/{both_pid}/duplicates",
                                headers=H)
            body = r.json()
            ids = [c["patient_id"] for c in body["candidates"]]
            assert dup_by_name_pid in ids
            weak = [c for c in body["candidates"] if c["confidence"] == "weak"]
            assert any(c["patient_id"] == dup_by_name_pid for c in weak)
            # Bob Smith must NOT appear as a candidate.
            assert other_pid not in ids
            print(f"✓ similar-name dup surfaced (WEAK), unrelated names excluded")

            # ── 8. Existing merge endpoint absorbs the phone dup ──
            r = await http.post(
                f"/api/registry/patients/{phone_only_pid}/merge",
                json={"duplicate_patient_id": dup_by_phone_pid},
                headers=H,
            )
            assert r.status_code == 200, r.text
            merged = r.json()
            assert merged.get("kept") == phone_only_pid
            assert merged.get("merged") == dup_by_phone_pid
            dup_row = await db.patients.find_one({"patient_id": dup_by_phone_pid})
            assert dup_row.get("merged_into") == phone_only_pid
            print(f"✓ merge endpoint absorbs the surfaced dup")

            # ── 9. Post-merge duplicates list no longer includes it ──
            r = await http.get(f"/api/registry/patients/{phone_only_pid}/duplicates",
                                headers=H)
            body = r.json()
            ids = [c["patient_id"] for c in body["candidates"]]
            assert dup_by_phone_pid not in ids, "merged row still appears as dup"
            print(f"✓ merged rows excluded from subsequent duplicates list")

            print("\nALL WALK-IN INVITE + DUPLICATES SMOKE TESTS PASSED ✅")
    finally:
        # Cleanup — including magic tokens issued.
        await db.patients.delete_many({"patient_id": {"$in": created_ids}})
        await db.auth_magic_tokens.delete_many({"invited_patient_id": {"$in": created_ids}})
        await db.user_sessions.delete_many({"session_token": token})
        client.close()


if __name__ == "__main__":
    asyncio.run(main())
