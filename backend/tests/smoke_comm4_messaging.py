"""Comm-4 acceptance smoke — full patient ↔ clinic flow.

Verifies each spec-mandated behaviour:
  1. One conversation per patient (unique on patient_user_id).
  2. Idempotency-Key dedupes duplicate sends.
  3. Patient send → state=awaiting_clinic, unread_for_clinic += 1.
  4. Staff send → state=awaiting_patient, unread_for_patient += 1.
  5. Message states progress: saved → push_queued (never delivered on
     FCM 200 alone).
  6. Marking read only decrements OPPOSITE-side unread counter.
  7. Reading own message is a no-op.
  8. list_messages bumps not-yet-synced messages to recipient_app_synced
     for the reader (never for the sender).
  9. Patient cannot access another patient's conversation.
 10. Assign/escalate/resolve/reopen state-machine transitions work,
     and illegal transitions raise ValueError.
 11. Staff-only actions reject patient callers.
 12. Push event enqueued on outbox with a stable dedupe_key
     (retries never duplicate).
 13. Recipient(s) get a comm_inbox_items row (item_type=v2_message),
     with action_type=open_conversation.
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


async def main():
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env'))
    from motor.motor_asyncio import AsyncIOMotorClient
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ.get("DB_NAME", "consulturo")]

    from services import comm_messaging as m

    # ── Seed a patient + a staff user ──
    suffix = uuid.uuid4().hex[:6]
    pt = {"user_id": f"p-{suffix}", "email": f"p-{suffix}@smoke", "role": "patient",
          "name": f"Test Patient {suffix}"}
    other_pt = {"user_id": f"po-{suffix}", "email": f"po-{suffix}@smoke", "role": "patient",
                "name": "Other Patient"}
    st = {"user_id": f"s-{suffix}", "email": f"s-{suffix}@smoke", "role": "primary_owner",
          "name": "Dr. Smoke"}
    ast = {"user_id": f"a-{suffix}", "email": f"a-{suffix}@smoke", "role": "reception",
           "name": "Reception Smoke"}
    for u in (pt, other_pt, st, ast):
        await db.users.update_one({"user_id": u["user_id"]}, {"$set": u}, upsert=True)

    # 1. Conversation get-or-create is idempotent
    c1 = await m.get_or_create_clinic_conversation(db, patient_user_id=pt["user_id"])
    c2 = await m.get_or_create_clinic_conversation(db, patient_user_id=pt["user_id"])
    assert c1["id"] == c2["id"], "get_or_create returned two ids for one patient"
    assert c1["state"] == "open"
    print(f"✓ one conversation per patient: {c1['id']}")

    # 2/3. Patient sends → awaiting_clinic + unread_for_clinic=1
    r1 = await m.send_message(
        db, user=pt, conversation_id=c1["id"],
        body="Hi, I have a question about my prescription.",
        idempotency_key="patient-msg-1",
    )
    assert not r1["idempotent"]
    conv = r1["conversation"]
    assert conv["state"] == "awaiting_clinic"
    assert conv["unread_for_clinic"] == 1
    assert conv["unread_for_patient"] == 0
    assert r1["message"]["delivery_state"] == "push_queued"
    assert r1["message"]["sender_display"].startswith("Test Patient"), r1["message"]["sender_display"]
    print(f"✓ patient send → awaiting_clinic, unread_for_clinic=1, delivery_state=push_queued")

    # 2b. Idempotency dedupe
    r1b = await m.send_message(
        db, user=pt, conversation_id=c1["id"],
        body="TOTALLY DIFFERENT BODY (should still dedupe on key)",
        idempotency_key="patient-msg-1",
    )
    assert r1b["idempotent"]
    assert r1b["message"]["id"] == r1["message"]["id"]
    # Body must remain the ORIGINAL, not the newer attempt.
    assert r1b["message"]["body"].startswith("Hi, I have")
    print(f"✓ Idempotency-Key dedupes replays (message id unchanged)")

    # 4. Staff (primary_owner) sends → awaiting_patient + unread_for_patient=1
    r2 = await m.send_message(
        db, user=st, conversation_id=c1["id"],
        body="Hello — I'll check your prescription and get back to you.",
        idempotency_key="staff-msg-1",
    )
    conv = r2["conversation"]
    assert conv["state"] == "awaiting_patient"
    assert conv["unread_for_clinic"] == 1
    assert conv["unread_for_patient"] == 1
    assert r2["message"]["sender_display"] == "ConsultUro Clinic"
    print(f"✓ staff send → awaiting_patient, unread_for_patient=1, sender_display='ConsultUro Clinic'")

    # 13. Inbox items were created for each recipient
    inb_for_staff = await db.comm_inbox_items.count_documents({
        "user_id": st["user_id"], "item_type": "v2_message",
        "source_id": r1["message"]["id"],
    })
    inb_for_patient = await db.comm_inbox_items.count_documents({
        "user_id": pt["user_id"], "item_type": "v2_message",
        "source_id": r2["message"]["id"],
    })
    assert inb_for_staff >= 1 and inb_for_patient == 1
    print(f"✓ inbox items created for recipients (staff:{inb_for_staff}, patient:{inb_for_patient})")

    # 12. Push events enqueued with stable dedupe_keys
    ev1 = await db.comm_outbox.count_documents({
        "dedupe_key": f"msgpush:{r1['message']['id']}:{st['user_id']}",
    })
    ev2 = await db.comm_outbox.count_documents({
        "dedupe_key": f"msgpush:{r2['message']['id']}:{pt['user_id']}",
    })
    assert ev1 == 1 and ev2 == 1
    print(f"✓ push events enqueued with stable dedupe keys (retries wont duplicate)")

    # 8. Listing bumps recipient_app_synced for msgs the reader didn't send
    listed = await m.list_messages(db, user=pt, conversation_id=c1["id"], limit=100)
    # Patient sees both messages; the staff-authored one should bump.
    staff_msg = next(x for x in listed["items"] if x["sender_role"] == "doctor")
    patient_msg = next(x for x in listed["items"] if x["sender_role"] == "patient")
    assert staff_msg["delivery_state"] == "recipient_app_synced", staff_msg["delivery_state"]
    # Patient's own message stays at push_queued for the patient (no self-bump).
    assert patient_msg["delivery_state"] == "push_queued"
    print(f"✓ list_messages bumps recipient_app_synced only for received messages")

    # 6/7. Patient marks staff msg read → unread_for_patient goes to 0
    #     Reading own is no-op → unread_for_clinic stays at 1
    res = await m.mark_message_read(db, user=pt, message_id=staff_msg["id"])
    assert res["ok"] and res["first_time_read"]
    conv = await m.get_conversation(db, c1["id"])
    assert conv["unread_for_patient"] == 0
    assert conv["unread_for_clinic"] == 1
    # Try to read patient's OWN msg → no-op
    res2 = await m.mark_message_read(db, user=pt, message_id=patient_msg["id"])
    assert res2.get("already_own_message")
    conv = await m.get_conversation(db, c1["id"])
    assert conv["unread_for_clinic"] == 1  # unchanged
    print(f"✓ mark_message_read only decrements opposite-side unread; own message read is a no-op")

    # Idempotent double-read: no extra decrement
    res3 = await m.mark_message_read(db, user=pt, message_id=staff_msg["id"])
    assert not res3.get("first_time_read"), "double-read must not re-decrement"
    conv = await m.get_conversation(db, c1["id"])
    assert conv["unread_for_patient"] == 0
    print(f"✓ double-read of same message is idempotent (no re-decrement)")

    # 9. Cross-patient access denied
    other_conv = await m.get_or_create_clinic_conversation(db,
        patient_user_id=other_pt["user_id"])
    try:
        await m.list_messages(db, user=other_pt, conversation_id=c1["id"])
        raise AssertionError("cross-patient list should have raised PermissionError")
    except PermissionError:
        pass
    print(f"✓ patient cannot access another patient's conversation")

    # 11. Patient trying to escalate / resolve → PermissionError
    for op in (m.escalate_to_doctor, m.resolve_conversation, m.reopen_conversation):
        try:
            await op(db, conv_id=c1["id"], actor=pt)
            raise AssertionError(f"{op.__name__} must reject patient callers")
        except PermissionError:
            pass
    print(f"✓ state-machine actions reject patient callers")

    # 10. State transitions: assign → escalate → resolve → reopen
    await m.assign_conversation(db, conv_id=c1["id"],
                                  assignee_user_id=ast["user_id"], actor=st)
    conv = await m.get_conversation(db, c1["id"])
    assert conv["assigned_to_user_id"] == ast["user_id"]
    print(f"✓ assign to reception ok")

    await m.escalate_to_doctor(db, conv_id=c1["id"], actor=st)
    conv = await m.get_conversation(db, c1["id"])
    assert conv["state"] == "escalated_to_doctor"

    await m.resolve_conversation(db, conv_id=c1["id"], actor=st)
    conv = await m.get_conversation(db, c1["id"])
    assert conv["state"] == "resolved"

    await m.reopen_conversation(db, conv_id=c1["id"], actor=st)
    conv = await m.get_conversation(db, c1["id"])
    assert conv["state"] == "awaiting_clinic", conv["state"]
    print(f"✓ escalate → resolve → reopen (resolved→awaiting_clinic)")

    # Illegal transition: awaiting_clinic → open is not allowed (open is
    # only reachable via archived → open).
    try:
        await m._transition_state(db, conv_id=c1["id"], new_state="open", actor=st)
        raise AssertionError("illegal_transition must have raised")
    except ValueError:
        pass
    print(f"✓ illegal transitions raise ValueError")

    # Assign to a non-staff user → rejected
    try:
        await m.assign_conversation(db, conv_id=c1["id"],
                                     assignee_user_id=pt["user_id"], actor=st)
        raise AssertionError("assign to patient must have raised")
    except ValueError as e:
        assert "assignee_not_staff" in str(e)
    print(f"✓ assign rejects non-staff assignees")

    # ── Cleanup ──
    conv_ids = [c1["id"], other_conv["id"]]
    for cid in conv_ids:
        await db.comm_messages.delete_many({"conversation_id": cid})
        await db.comm_conversation_participants.delete_many({"conversation_id": cid})
        await db.comm_conversations.delete_one({"id": cid})
        await db.comm_message_receipts.delete_many({"message_id": {"$in": []}})  # scope by ids not needed post-delete
    await db.comm_inbox_items.delete_many({"item_type": "v2_message",
                                            "user_id": {"$in": [pt["user_id"],
                                                                  other_pt["user_id"],
                                                                  st["user_id"],
                                                                  ast["user_id"]]}})
    await db.comm_outbox.delete_many({"aggregate_type": "v2_message"})
    for u in (pt, other_pt, st, ast):
        await db.users.delete_one({"user_id": u["user_id"]})

    print("\nALL COMM-4 SMOKE TESTS PASSED ✅")
    client.close()


if __name__ == "__main__":
    asyncio.run(main())
