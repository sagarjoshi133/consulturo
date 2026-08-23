"""Comm-8 migration & reconciliation smoke test.

Seeds fake legacy rows (notifications, broadcasts, broadcast_inbox),
runs each backfill twice (idempotency check), then compares against
the reconciliation report. Cleans up its own synthetic data.

Runs stand-alone: python -m tests.smoke_comm8_migration
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402


def _now():
    return datetime.now(timezone.utc)


async def _seed_legacy(db, tag: str):
    """Seed a small legacy corpus. Every synthetic id includes `tag` so
    cleanup can prune only what we inserted."""
    # ── Fake users ──
    patient_uid = f"smoke-pat-{tag}"
    staff_uid = f"smoke-staff-{tag}"
    other_pat_uid = f"smoke-pat2-{tag}"
    await db.users.insert_many([
        {"user_id": patient_uid, "role": "patient", "email": f"{tag}-p@example.com",
         "name": "Smoke Patient"},
        {"user_id": staff_uid, "role": "doctor", "email": f"{tag}-s@example.com",
         "name": "Smoke Doctor"},
        {"user_id": other_pat_uid, "role": "patient", "email": f"{tag}-p2@example.com",
         "name": "Smoke Patient2"},
    ])

    # ── Legacy notifications ──
    # 3 booking/system rows for patient → should backfill to inbox.
    # 2 personal_message rows (staff → patient + patient → staff) → should backfill to messaging.
    # 1 staff↔staff personal_message → should NOT backfill (out of scope).
    notif_ids = []
    for i, kind in enumerate(["booking", "system", "reminder"]):
        nid = f"n-{tag}-{i}"
        notif_ids.append(nid)
        await db.notifications.insert_one({
            "id": nid, "user_id": patient_uid,
            "title": f"{kind} notif {i}", "body": f"body {i}",
            "kind": kind, "data": {"booking_id": f"b-{tag}-{i}"},
            "read": False, "created_at": _now() - timedelta(hours=10 - i),
        })
    # personal_message: staff → patient
    await db.notifications.insert_one({
        "id": f"pm-{tag}-1", "user_id": patient_uid,
        "title": "Hello patient", "body": "Please arrive early",
        "kind": "personal",
        "data": {"sender_user_id": staff_uid, "sender_name": "Dr Smoke",
                  "sender_role": "doctor"},
        "read": True, "read_at": _now(),
        "created_at": _now() - timedelta(hours=5),
    })
    # patient → staff
    await db.notifications.insert_one({
        "id": f"pm-{tag}-2", "user_id": staff_uid,
        "title": "Reply from patient", "body": "OK",
        "kind": "personal",
        "data": {"sender_user_id": patient_uid, "sender_name": "Smoke Patient",
                  "sender_role": "patient"},
        "read": False,
        "created_at": _now() - timedelta(hours=3),
    })
    # staff↔staff (out of V2 scope)
    await db.notifications.insert_one({
        "id": f"pm-{tag}-3", "user_id": staff_uid,
        "title": "Staff DM", "body": "-",
        "kind": "personal",
        "data": {"sender_user_id": staff_uid, "sender_name": "Dr Smoke",
                  "sender_role": "doctor"},
        "created_at": _now(),
    })

    # ── Legacy broadcasts ──
    for i, status in enumerate(["sent", "approved", "pending_approval"]):
        bid = f"bc-{tag}-{i}"
        await db.broadcasts.insert_one({
            "broadcast_id": bid,
            "title": f"Broadcast {status}",
            "body": f"Body {i}",
            "target": ["all", "patients", "staff"][i],
            "status": status,
            "author_id": staff_uid,
            "author_name": "Dr Smoke",
            "created_at": _now() - timedelta(days=i),
            "approved_at": _now() - timedelta(days=i, hours=-1) if status != "pending_approval" else None,
            "approved_by": staff_uid if status != "pending_approval" else None,
            "sent_at": _now() - timedelta(days=i, hours=-2) if status == "sent" else None,
            "sent_count": 42 if status == "sent" else 0,
        })

    # ── Legacy broadcast_inbox — 2 recipient rows for the "sent" bc ──
    await db.broadcast_inbox.insert_many([
        {"inbox_id": f"ib-{tag}-1", "broadcast_id": f"bc-{tag}-0",
         "user_id": patient_uid, "title": "-", "body": "-",
         "created_at": _now(), "read_at": None},
        {"inbox_id": f"ib-{tag}-2", "broadcast_id": f"bc-{tag}-0",
         "user_id": other_pat_uid, "title": "-", "body": "-",
         "created_at": _now(), "read_at": _now()},
    ])
    return {
        "patient_uid": patient_uid,
        "staff_uid": staff_uid,
        "other_pat_uid": other_pat_uid,
        "tag": tag,
    }


async def _cleanup(db, seed: dict):
    tag = seed["tag"]
    await db.users.delete_many({"user_id": {"$in": [
        seed["patient_uid"], seed["staff_uid"], seed["other_pat_uid"],
    ]}})
    await db.notifications.delete_many({"id": {"$regex": f"^(n|pm)-{tag}-"}})
    await db.broadcasts.delete_many({"broadcast_id": {"$regex": f"^bc-{tag}-"}})
    await db.broadcast_inbox.delete_many({"inbox_id": {"$regex": f"^ib-{tag}-"}})
    # V2 side
    await db.comm_inbox_items.delete_many(
        {"user_id": {"$in": [seed["patient_uid"], seed["staff_uid"], seed["other_pat_uid"]]}}
    )
    await db.comm_messages.delete_many({"idempotency_key": {"$regex": f"legacy:(n|pm)-{tag}-"}})
    await db.comm_conversations.delete_many(
        {"patient_user_id": {"$in": [seed["patient_uid"], seed["other_pat_uid"]]}}
    )
    await db.comm_broadcasts.delete_many({"id": {"$regex": f"^bc-{tag}-"}})
    await db.comm_broadcast_recipients.delete_many({"broadcast_id": {"$regex": f"^bc-{tag}-"}})
    await db.comm_migration_map.delete_many({
        "$or": [
            {"source_id": {"$regex": f"^(n|pm|bc|ib)-{tag}-"}},
            {"source_id": {"$in": ["notifications_backfilled",
                                    "messages_backfilled",
                                    "broadcasts_backfilled"]}},
        ]
    })


async def main():
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ.get("DB_NAME", "consulturo")]

    from migrations.comm_v2_inbox_backfill import run_notifications_backfill
    from migrations.comm_v2_messaging_backfill import run_messaging_backfill
    from migrations.comm_v2_broadcasts_backfill import run_broadcasts_backfill
    from services import comm_reconciliation

    tag = uuid.uuid4().hex[:6]
    seed = await _seed_legacy(db, tag)
    print(f"--- seeded synthetic legacy corpus tag={tag} ---")

    try:
        # ── Run each backfill (force=True to bypass boot-time _status marker) ──
        print("\n--- Notifications backfill ---")
        n1 = await run_notifications_backfill(db, force=True)
        print("  ", n1)

        print("\n--- Messages backfill (force) ---")
        m1 = await run_messaging_backfill(db, force=True)
        print("  ", m1)

        print("\n--- Broadcasts backfill (force) ---")
        b1 = await run_broadcasts_backfill(db, force=True)
        print("  ", b1)

        # ── Assertions for this seed ──
        # 3 non-personal legacy notifs should now be in comm_inbox_items.
        migrated_inbox = await db.comm_inbox_items.count_documents(
            {"user_id": seed["patient_uid"], "item_type": {"$regex": "^legacy:"}}
        )
        assert migrated_inbox >= 3, f"expected ≥3 patient inbox rows, got {migrated_inbox}"
        print(f"✓ patient inbox rows migrated: {migrated_inbox} (≥3 expected)")

        # 2 personal_message rows for patient↔staff → 2 messages, 1 conversation.
        conv = await db.comm_conversations.find_one({"patient_user_id": seed["patient_uid"]})
        assert conv, "expected a comm_conversations row for the patient"
        msg_count = await db.comm_messages.count_documents({"conversation_id": conv["id"]})
        assert msg_count == 2, f"expected 2 messages in conversation, got {msg_count}"
        print(f"✓ patient↔staff conversation has {msg_count} migrated messages")

        # staff↔staff message should have been skipped.
        skip_key = f"{seed['staff_uid']}:legacy:pm-{tag}-3"
        staff_dm = await db.comm_messages.find_one({"idempotency_key": skip_key})
        assert staff_dm is None, "staff↔staff DM should NOT be migrated"
        print("✓ staff↔staff DM correctly skipped (not migrated)")

        # 3 legacy broadcasts → 3 v2 broadcasts (migrated_from_legacy=True).
        v2_bcasts = await db.comm_broadcasts.count_documents(
            {"id": {"$regex": f"^bc-{tag}-"}, "migrated_from_legacy": True}
        )
        assert v2_bcasts == 3, f"expected 3 migrated broadcasts, got {v2_bcasts}"
        print(f"✓ migrated broadcasts: {v2_bcasts}")

        # State mapping
        sent_v2 = await db.comm_broadcasts.find_one({"id": f"bc-{tag}-0"})
        assert sent_v2["state"] == "completed", f"sent → completed, got {sent_v2['state']}"
        print("✓ 'sent' → state='completed'")

        # 2 recipient rows.
        v2_recips = await db.comm_broadcast_recipients.count_documents(
            {"broadcast_id": f"bc-{tag}-0", "migrated_from_legacy": True}
        )
        assert v2_recips == 2, f"expected 2 migrated recipients, got {v2_recips}"
        print(f"✓ migrated broadcast recipients: {v2_recips}")

        # ── Idempotency: run each again with force=True — should not duplicate ──
        print("\n--- Idempotency (re-run with force) ---")
        n2 = await run_notifications_backfill(db, force=True)
        m2 = await run_messaging_backfill(db, force=True)
        b2 = await run_broadcasts_backfill(db, force=True)
        # After force re-run, mirrored/scanned counts remain the same
        # but each row's dedupe kicks in — no fresh inserts.
        inbox_after = await db.comm_inbox_items.count_documents(
            {"user_id": seed["patient_uid"], "item_type": {"$regex": "^legacy:"}}
        )
        assert inbox_after == migrated_inbox, "inbox rows duplicated on re-run"
        msg_after = await db.comm_messages.count_documents({"conversation_id": conv["id"]})
        assert msg_after == msg_count, "messages duplicated on re-run"
        bc_after = await db.comm_broadcasts.count_documents(
            {"id": {"$regex": f"^bc-{tag}-"}, "migrated_from_legacy": True}
        )
        assert bc_after == v2_bcasts, "broadcasts duplicated on re-run"
        print("✓ re-running all three backfills does NOT duplicate rows")

        # ── Reconciliation report (should be internally consistent) ──
        print("\n--- Reconciliation report ---")
        rep = await comm_reconciliation.build_report(db)
        # Note: the report is global (across all data, not just this seed),
        # so we only assert internal invariants, not exact numbers.
        for domain in ("notifications_inbox", "messages", "broadcasts",
                        "broadcast_recipients"):
            assert domain in rep, f"missing domain {domain} in reconciliation report"
        print(f"  overall ok={rep['ok']}")
        for domain in ("notifications_inbox", "messages", "broadcasts",
                        "broadcast_recipients"):
            print(f"    {domain}: ok={rep[domain].get('ok')}, "
                  f"delta={rep[domain].get('delta') or rep[domain].get('delta_legacy_vs_v2') or rep[domain].get('delta_mapped_vs_v2')}")
        # Broadcast recipients: legacy_total ≥ 2, v2_from_legacy ≥ 2.
        assert rep["broadcast_recipients"]["v2_from_legacy"] >= 2
        assert rep["broadcasts"]["v2_from_legacy"] >= 3
        print("✓ reconciliation report structure and counters valid")

        print("\nALL COMM-8 SMOKE TESTS PASSED ✅")
    finally:
        await _cleanup(db, seed)
        client.close()


if __name__ == "__main__":
    asyncio.run(main())
