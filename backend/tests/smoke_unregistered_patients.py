"""Smoke test — Unregistered Patients (HTTP against local backend).

Verifies the /api/registry/patients registration_status filter and
the /summary counter endpoint.

Runs stand-alone:  python -m tests.smoke_unregistered_patients
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
    """Return a valid session token bound to an owner-tier user, so
    the /api/registry/patients endpoint's require_registry_access
    capability check passes without depending on the fixture user."""
    # Prefer an existing owner-tier user; fall back to super_owner.
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

    tag = uuid.uuid4().hex[:8]
    now = datetime.now(timezone.utc)

    # ── Seed ──
    reg_uid = f"smoke-reg-{tag}"
    reg_phone = f"9{tag[:9]}"[-10:]
    reg_email = f"reg-{tag}@example.com"
    await db.users.insert_one({
        "user_id": reg_uid, "role": "patient",
        "name": f"Reg Patient {tag}", "phone": reg_phone, "email": reg_email,
    })
    reg_patient_id = str(uuid.uuid4())
    await db.patients.insert_one({
        "patient_id": reg_patient_id, "name": f"Reg Patient {tag}",
        "phone": reg_phone, "phone_digits": reg_phone, "email": reg_email,
        "first_seen_at": now, "created_at": now, "updated_at": now,
    })
    unreg_ids: list = []
    for i in range(2):
        pid = str(uuid.uuid4())
        unreg_ids.append(pid)
        await db.patients.insert_one({
            "patient_id": pid, "name": f"Walkin {tag}-{i}",
            "phone": f"8{tag[:9]}{i}"[-10:],
            "phone_digits": f"8{tag[:9]}{i}"[-10:],
            "email": None,
            "first_seen_at": now, "created_at": now, "updated_at": now,
        })

    token = await _mint_owner_session(db)
    headers = {"Authorization": f"Bearer {token}"}

    try:
        async with httpx.AsyncClient(base_url=BASE, timeout=15) as http:
            # ── ALL ──
            r = await http.get("/api/registry/patients",
                                params={"q": tag, "limit": 100,
                                         "registration_status": "all"},
                                headers=headers)
            assert r.status_code == 200, r.text
            all_ids = {x["patient_id"] for x in r.json()["items"]}
            assert reg_patient_id in all_ids
            for pid in unreg_ids:
                assert pid in all_ids
            print(f"✓ /registry/patients?status=all → {len(all_ids)} rows")

            # ── REGISTERED ──
            r = await http.get("/api/registry/patients",
                                params={"q": tag, "limit": 100,
                                         "registration_status": "registered"},
                                headers=headers)
            reg_ids = {x["patient_id"] for x in r.json()["items"]}
            assert reg_patient_id in reg_ids
            for pid in unreg_ids:
                assert pid not in reg_ids
            print(f"✓ /registry/patients?status=registered → {len(reg_ids)} rows (walk-ins excluded)")

            # ── UNREGISTERED ──
            r = await http.get("/api/registry/patients",
                                params={"q": tag, "limit": 100,
                                         "registration_status": "unregistered"},
                                headers=headers)
            un_ids = {x["patient_id"] for x in r.json()["items"]}
            assert reg_patient_id not in un_ids
            for pid in unreg_ids:
                assert pid in un_ids
            print(f"✓ /registry/patients?status=unregistered → {len(un_ids)} walk-ins")

            # ── SUMMARY ──
            r = await http.get("/api/registry/patients/summary", headers=headers)
            assert r.status_code == 200, r.text
            s = r.json()
            assert s["total"] == s["registered"] + s["unregistered"]
            assert s["registered"] >= 1
            assert s["unregistered"] >= 2
            print(f"✓ /summary → total={s['total']} registered={s['registered']} unregistered={s['unregistered']}")

            # ── Bad value ──
            r = await http.get("/api/registry/patients",
                                params={"registration_status": "banana"},
                                headers=headers)
            assert r.status_code == 400
            print("✓ invalid status → 400")

            print("\nALL UNREGISTERED-PATIENTS SMOKE TESTS PASSED ✅")
    finally:
        await db.users.delete_many({"user_id": reg_uid})
        await db.patients.delete_many({"patient_id": {"$in": [reg_patient_id] + unreg_ids}})
        await db.user_sessions.delete_many({"session_token": token})
        client.close()


if __name__ == "__main__":
    asyncio.run(main())
