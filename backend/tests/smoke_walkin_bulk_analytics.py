"""Smoke test — Bulk invites + invite conversion analytics.

Verifies:
  * POST /api/registry/invites/bulk processes multiple IDs,
    honours a template override, and records a batch doc.
  * Skips unknown IDs / patients with no contact, but succeeds for
    valid rows in the same call.
  * `invited_at` + `invite_count` stamped for every processed patient.
  * `walkin_invite_batches` batch doc holds template snapshot + counts.
  * GET /api/registry/invites/analytics returns the correct
    totals + conversion counts under both "any signup after" and the
    7d / 30d rolling windows.

Runs stand-alone:  python -m tests.smoke_walkin_bulk_analytics
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import httpx
from motor.motor_asyncio import AsyncIOMotorClient

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
        "session_token": token, "user_id": owner["user_id"],
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

    # ── Seed: 3 walk-in patients + 1 no-contact + 1 orphan (missing) ──
    p1, p2, p3, p_no_contact = (str(uuid.uuid4()) for _ in range(4))
    await db.patients.insert_many([
        {"patient_id": p1, "name": f"Walkin1 {tag}",
         "phone": f"9{tag[:9]}"[-10:], "phone_digits": f"9{tag[:9]}"[-10:],
         "first_seen_at": now, "created_at": now, "updated_at": now},
        {"patient_id": p2, "name": f"Walkin2 {tag}",
         "phone": f"8{tag[:9]}"[-10:], "phone_digits": f"8{tag[:9]}"[-10:],
         "email": f"walkin2-{tag}@example.com",
         "first_seen_at": now, "created_at": now, "updated_at": now},
        {"patient_id": p3, "name": f"Walkin3 {tag}",
         "email": f"walkin3-{tag}@example.com",
         "first_seen_at": now, "created_at": now, "updated_at": now},
        {"patient_id": p_no_contact, "name": f"NoContact {tag}",
         "first_seen_at": now, "created_at": now, "updated_at": now},
    ])
    p_missing = str(uuid.uuid4())  # never inserted

    # A broadcast template to override the invite body.
    tpl_id = str(uuid.uuid4())
    await db.comm_broadcast_templates.insert_one({
        "id": tpl_id, "name": f"invite-tpl-{tag}",
        "title": "Welcome to ConsultUro",
        "body": "Sign in to see your prescriptions and next visit.",
        "category": "announcements", "audience_mode": "patients",
        "action_type": "open_broadcast", "is_active": True,
        "use_count": 0, "last_used_at": None,
        "created_at": now, "updated_at": now, "schema_version": 1,
    })

    # ── For analytics: seed one converted user ──
    # Patient p2 has a matching users row created AFTER invited_at.
    conv_uid = f"smoke-conv-{tag}"

    token = await _mint_owner_session(db)
    H = {"Authorization": f"Bearer {token}"}
    created_patients = [p1, p2, p3, p_no_contact]

    try:
        async with httpx.AsyncClient(base_url=BASE, timeout=15) as http:
            # ── 1. Bulk invite with template ──
            r = await http.post(
                "/api/registry/invites/bulk",
                json={"patient_ids": [p1, p2, p3, p_no_contact, p_missing],
                       "template_id": tpl_id},
                headers=H,
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["ok"]
            assert body["template"] and body["template"]["id"] == tpl_id
            assert body["count"] == 5
            assert body["ok_count"] == 3        # p1, p2, p3
            assert body["error_count"] == 2      # no_contact + missing
            # Every result present.
            by_id = {res["patient_id"]: res for res in body["results"]}
            assert by_id[p1].get("wa_url") is not None
            assert by_id[p2].get("wa_url") and by_id[p2].get("mailto_uri")
            assert by_id[p3].get("mailto_uri") and by_id[p3].get("wa_url") is None
            # Template body/title shows up in the share message.
            assert "Welcome to ConsultUro" in by_id[p1]["share_message"]
            assert "Sign in to see your prescriptions" in by_id[p1]["share_message"]
            assert by_id[p_no_contact].get("error") == "no_contact"
            assert by_id[p_missing].get("error") == "not_found"
            print("✓ bulk invite: 3 ok / 2 errors, template override applied")

            # ── 2. Patients stamped with invited_at + invite_count ──
            for pid in (p1, p2, p3):
                row = await db.patients.find_one({"patient_id": pid})
                assert row.get("invited_at") is not None
                assert row.get("invite_count") == 1
            print("✓ invited_at + invite_count stamped for 3 patients")

            # ── 3. Template use_count bumped ──
            tpl_row = await db.comm_broadcast_templates.find_one({"id": tpl_id})
            assert tpl_row.get("use_count") == 1
            assert tpl_row.get("last_used_at") is not None
            print("✓ template use_count/last_used_at bumped")

            # ── 4. Batch doc persisted ──
            batch_id = body["batch_id"]
            batch = await db.walkin_invite_batches.find_one({"batch_id": batch_id})
            assert batch
            assert batch["ok_count"] == 3
            assert batch["error_count"] == 2
            assert batch["template_id"] == tpl_id
            assert len(batch["patient_ids"]) == 5
            print(f"✓ batch doc stored (batch_id={batch_id[:8]}…)")

            # Batches list returns it.
            r = await http.get("/api/registry/invites/batches",
                                params={"limit": 5}, headers=H)
            assert r.status_code == 200
            titles = [b["template_snapshot"]["name"] if b.get("template_snapshot") else None
                        for b in r.json()["items"]]
            assert any(t == f"invite-tpl-{tag}" for t in titles)
            print("✓ /invite-batches lists the new batch")

            # ── 5. Conversion analytics BEFORE we simulate a signup ──
            r = await http.get("/api/registry/invites/analytics", headers=H)
            assert r.status_code == 200
            before = r.json()
            assert before["total_invited"] >= 3
            baseline_converted = before["converted_total"]
            print(f"✓ analytics pre-signup: invited={before['total_invited']} "
                  f"converted={baseline_converted}")

            # ── 6. Simulate the walk-in signing up ──
            # Create a users row with the same phone as p2, created AFTER
            # invited_at (which we just set). Force created_at = now+1s.
            invited_row = await db.patients.find_one({"patient_id": p2})
            u_created = invited_row["invited_at"] + timedelta(seconds=30)
            await db.users.insert_one({
                "user_id": conv_uid, "role": "patient",
                "name": f"Converted {tag}",
                "phone": invited_row["phone_digits"],
                "email": invited_row["email"],
                "created_at": u_created,
            })

            r = await http.get("/api/registry/invites/analytics", headers=H)
            after = r.json()
            assert after["converted_total"] == baseline_converted + 1
            assert after["converted_within_7d"] >= 1
            assert after["converted_within_30d"] >= 1
            assert after["conversion_rate_total"] > 0
            print(f"✓ analytics post-signup: converted_total={after['converted_total']} "
                  f"7d={after['converted_within_7d']} 30d={after['converted_within_30d']}")

            # ── 7. Users created BEFORE their invite are NOT counted ──
            # p3 has no phone — but let's give it an email match with a
            # pre-existing users row and confirm we DON'T count it as a
            # conversion. (Their account existed before we invited them.)
            pre_uid = f"smoke-pre-{tag}"
            await db.users.insert_one({
                "user_id": pre_uid, "role": "patient",
                "name": f"PreExist {tag}",
                "email": f"walkin3-{tag}@example.com",
                # Created LONG before invited_at.
                "created_at": now - timedelta(days=365),
            })
            r = await http.get("/api/registry/invites/analytics", headers=H)
            after2 = r.json()
            # Converted_total should not jump — pre-existing users don't count.
            assert after2["converted_total"] == after["converted_total"], (
                f"pre-existing user shouldn't count as a conversion "
                f"({after['converted_total']} → {after2['converted_total']})"
            )
            print("✓ pre-existing users (created before invite) NOT counted")

            print("\nALL BULK-INVITE + ANALYTICS SMOKE TESTS PASSED ✅")
    finally:
        # Cleanup
        await db.patients.delete_many({"patient_id": {"$in": created_patients}})
        await db.users.delete_many({"user_id": {"$in": [conv_uid, f"smoke-pre-{tag}"]}})
        await db.auth_magic_tokens.delete_many({"invited_patient_id": {"$in": created_patients}})
        await db.comm_broadcast_templates.delete_one({"id": tpl_id})
        await db.walkin_invite_batches.delete_one({"batch_id": body["batch_id"]})
        await db.user_sessions.delete_many({"session_token": token})
        client.close()


if __name__ == "__main__":
    asyncio.run(main())
