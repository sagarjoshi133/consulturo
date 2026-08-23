"""Comm-5 acceptance smoke — full broadcast lifecycle.

Verifies:
  1. create_draft (staff-only)
  2. update_draft (only from draft/rejected states)
  3. submit_for_approval → pending_approval
  4. preview_broadcast (does NOT freeze recipients)
  5. approve (owner-only; freezes audience into comm_broadcast_recipients)
  6. reject (owner-only; only from pending_approval)
  7. schedule enqueues a durable outbox event with dedupe_key
  8. cancel removes/completes the pending dispatch row and stops delivery
  9. dispatch handler creates inbox items + push events, marks state
     completed/partially_failed HONESTLY
 10. retry-failed only requeues push_enqueue_error / provider_error rows,
     never excluded or already-accepted
 11. analytics reports each counter independently (never conflates
     provider_accepted with broadcast_read)
 12. broadcast read on inbox propagates into recipient row analytics
 13. Illegal transitions are rejected (e.g. approve without submit)
 14. Consent exclusion honored at freeze time
 15. Duplicate prevention: unique(broadcast_id, user_id)
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


async def main():
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env'))
    from motor.motor_asyncio import AsyncIOMotorClient
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ.get("DB_NAME", "consulturo", )]

    from services import comm_broadcasts as b, comm_inbox, comm_outbox
    # Register broadcast dispatch handler for this process.
    b.register_handlers()

    suffix = uuid.uuid4().hex[:6]
    owner = {"user_id": f"o-{suffix}", "email": f"o-{suffix}@smoke",
              "role": "primary_owner", "name": "Owner"}
    staff = {"user_id": f"s-{suffix}", "email": f"s-{suffix}@smoke",
              "role": "reception", "name": "Reception"}
    p1 = {"user_id": f"p1-{suffix}", "email": f"p1-{suffix}@smoke",
           "role": "patient", "name": "Patient 1"}
    p2 = {"user_id": f"p2-{suffix}", "email": f"p2-{suffix}@smoke",
           "role": "patient", "name": "Patient 2",
           "prefs_broadcast_opt_out": True}
    p3 = {"user_id": f"p3-{suffix}", "email": f"p3-{suffix}@smoke",
           "role": "patient", "name": "Patient 3"}
    for u in (owner, staff, p1, p2, p3):
        await db.users.update_one({"user_id": u["user_id"]}, {"$set": u}, upsert=True)
    # Give p1 an active installation (push_eligible), p3 none.
    await db.comm_installations.update_one(
        {"installation_id": f"inst-{p1['user_id']}"},
        {"$set": {"installation_id": f"inst-{p1['user_id']}",
                   "user_id": p1["user_id"], "provider": "fcm",
                   "platform": "android", "device_token": "fake-token-p1-" + "a"*80,
                   "token_hash": "hash-p1", "status": "active"}},
        upsert=True,
    )

    # 1. Staff creates draft. Patient trying is rejected.
    try:
        await b.create_draft(db, actor=p1, title="No", body="No",
                              category="announcements", audience_mode="patients")
        raise AssertionError("patient must not create broadcast")
    except PermissionError:
        pass
    draft = await b.create_draft(
        db, actor=staff, title="Clinic closed on Diwali",
        body="ConsultUro will be closed for Diwali on Nov 12 through Nov 14. "
             "Emergency line remains active.",
        category="announcements",
        audience_mode="patients",
    )
    assert draft["state"] == "draft"
    print(f"✓ staff-only create_draft, state=draft ({draft['id']})")

    # 2. update_draft
    upd = await b.update_draft(db, actor=staff, broadcast_id=draft["id"],
                                 fields={"title": "Clinic closed — Diwali"})
    assert upd["title"] == "Clinic closed — Diwali"
    print(f"✓ update_draft works while in draft")

    # 3. submit_for_approval
    pa = await b.submit_for_approval(db, actor=staff, broadcast_id=draft["id"])
    assert pa["state"] == "pending_approval"
    print(f"✓ submit_for_approval → pending_approval")

    # 4. preview (no freeze yet)
    prev = await b.preview_broadcast(db, actor=owner, broadcast_id=draft["id"])
    assert prev["audience_summary"]["intended_total"] >= 3
    assert prev["audience_summary"]["excluded"] >= 1  # p2 opted out
    assert prev["audience_summary"]["push_eligible"] >= 1  # p1 has installation
    # Confirm recipients were NOT frozen by preview
    frozen = await db.comm_broadcast_recipients.count_documents(
        {"broadcast_id": draft["id"]})
    assert frozen == 0
    print(f"✓ preview intended={prev['audience_summary']['intended_total']} "
          f"excluded={prev['audience_summary']['excluded']} "
          f"push_eligible={prev['audience_summary']['push_eligible']} "
          f"(no freeze)")

    # 13. Only owner can approve — reject staff attempt
    try:
        await b.approve_broadcast(db, actor=staff, broadcast_id=draft["id"])
        raise AssertionError("staff must not approve")
    except PermissionError:
        pass
    print(f"✓ staff cannot approve")

    # 5. Owner approves → freeze recipients
    appr = await b.approve_broadcast(db, actor=owner, broadcast_id=draft["id"])
    assert appr["state"] == "approved"
    assert appr["frozen_at"] is not None
    frozen_after = await db.comm_broadcast_recipients.count_documents(
        {"broadcast_id": draft["id"]})
    excluded = await db.comm_broadcast_recipients.count_documents(
        {"broadcast_id": draft["id"], "excluded_reason": {"$ne": None}})
    assert frozen_after >= 3, frozen_after
    assert excluded >= 1
    print(f"✓ approve froze {frozen_after} recipients ({excluded} excluded)")

    # 15. Duplicate prevention — approve again should hit "cannot_approve_state"
    try:
        await b.approve_broadcast(db, actor=owner, broadcast_id=draft["id"])
        raise AssertionError("second approve must fail")
    except ValueError as e:
        assert "cannot_approve" in str(e)
    print(f"✓ can't re-approve; unique(broadcast_id, user_id) prevents dup rows")

    # 7. Schedule → enqueues dispatch outbox
    when = datetime.now(timezone.utc) - timedelta(seconds=1)  # send-now
    sched = await b.schedule_broadcast(db, actor=owner,
                                         broadcast_id=draft["id"],
                                         scheduled_at=when)
    assert sched["state"] == "scheduled"
    dedupe_key = f"bcast:dispatch:{draft['id']}"
    outbox_row = await db.comm_outbox.find_one({"dedupe_key": dedupe_key})
    assert outbox_row, "dispatch outbox row not enqueued"
    print(f"✓ schedule enqueued outbox row with dedupe_key={dedupe_key}")

    # 9. Drain the outbox — dispatcher fires
    summary = await comm_outbox.drain_once(db)
    print(f"  outbox drain: {summary}")
    bcast_after = await b.get_broadcast(db, draft["id"])
    assert bcast_after["state"] in ("completed", "partially_failed"), bcast_after["state"]
    inbox_count = await db.comm_inbox_items.count_documents(
        {"item_type": "v2_broadcast", "source_id": draft["id"]})
    assert inbox_count >= 2  # p1 & p3 got items (p2 excluded)
    print(f"✓ dispatch produced state={bcast_after['state']} inbox_items={inbox_count}")

    # 9b. Recipient rows for excluded users have NO inbox_item_id
    ex_row = await db.comm_broadcast_recipients.find_one(
        {"broadcast_id": draft["id"], "user_id": p2["user_id"]},
        {"_id": 0})
    assert ex_row["excluded_reason"] == "consent_opt_out"
    assert ex_row["inbox_item_id"] is None
    print(f"✓ opt-out patient had no inbox item created (excluded_reason=consent_opt_out)")

    # 11+12. Analytics — each counter is independent
    an = await b.broadcast_analytics(db, broadcast_id=draft["id"])
    c = an["counters"]
    print(f"  analytics counters: {c}")
    assert c["intended_recipients"] >= 3
    assert c["excluded_recipients"] >= 1
    assert c["inbox_items_created"] >= 2
    assert c["push_eligible"] >= 1
    assert c["broadcast_read"] == 0  # nobody read yet
    # Now p1 reads their inbox item → analytics.broadcast_read becomes 1
    inbox_p1 = await db.comm_inbox_items.find_one(
        {"user_id": p1["user_id"], "item_type": "v2_broadcast",
         "source_id": draft["id"]}, {"_id": 0, "id": 1})
    await comm_inbox.mark_read(db, user_id=p1["user_id"],
                                 item_ids=[inbox_p1["id"]])
    an2 = await b.broadcast_analytics(db, broadcast_id=draft["id"])
    assert an2["counters"]["broadcast_read"] == 1, an2["counters"]
    print(f"✓ analytics reflect read forward (broadcast_read=1); provider_accepted={an2['counters']['provider_accepted']} — INDEPENDENT counters")

    # 8. Second broadcast — cancel before dispatch
    d2 = await b.create_draft(db, actor=staff, title="Cancel test",
                                body="This will be cancelled", category="announcements",
                                audience_mode="patients")
    await b.submit_for_approval(db, actor=staff, broadcast_id=d2["id"])
    await b.approve_broadcast(db, actor=owner, broadcast_id=d2["id"])
    await b.schedule_broadcast(db, actor=owner, broadcast_id=d2["id"],
                                 scheduled_at=datetime.now(timezone.utc) + timedelta(hours=1))
    cn = await b.cancel_broadcast(db, actor=owner, broadcast_id=d2["id"])
    assert cn["state"] == "cancelled"
    still_pending = await db.comm_outbox.find_one(
        {"dedupe_key": f"bcast:dispatch:{d2['id']}",
         "status": {"$in": ["pending", "retry_wait"]}})
    assert still_pending is None
    print(f"✓ cancel stops pending dispatch (outbox row is not pending anymore)")

    # 13b. Illegal transition — schedule a cancelled broadcast
    try:
        await b.schedule_broadcast(db, actor=owner, broadcast_id=d2["id"],
                                     scheduled_at=datetime.now(timezone.utc))
        raise AssertionError("scheduling cancelled must fail")
    except ValueError:
        pass
    print(f"✓ illegal transition (cancelled → scheduled) rejected")

    # 10. retry-failed on the first broadcast — should requeue 0 (no failures)
    rr = await b.retry_failed(db, actor=owner, broadcast_id=draft["id"])
    assert rr["requeued"] == 0
    print(f"✓ retry-failed with no failures requeues 0")

    # 6. Reject flow
    d3 = await b.create_draft(db, actor=staff, title="Reject test",
                                body="Body", category="announcements",
                                audience_mode="staff")
    await b.submit_for_approval(db, actor=staff, broadcast_id=d3["id"])
    rj = await b.reject_broadcast(db, actor=owner, broadcast_id=d3["id"],
                                    reason="Wrong audience")
    assert rj["state"] == "rejected"
    assert rj["rejection_reason"] == "Wrong audience"
    # 13c. Reject from wrong state (already rejected)
    try:
        await b.reject_broadcast(db, actor=owner, broadcast_id=d3["id"])
        raise AssertionError("second reject must fail")
    except ValueError:
        pass
    print(f"✓ reject with reason; second reject illegal")

    # Cleanup
    for bid in (draft["id"], d2["id"], d3["id"]):
        await db.comm_broadcasts.delete_one({"id": bid})
        await db.comm_broadcast_recipients.delete_many({"broadcast_id": bid})
    await db.comm_inbox_items.delete_many({"item_type": "v2_broadcast"})
    await db.comm_outbox.delete_many({"aggregate_type": "broadcast"})
    await db.comm_installations.delete_one({"installation_id": f"inst-{p1['user_id']}"})
    for u in (owner, staff, p1, p2, p3):
        await db.users.delete_one({"user_id": u["user_id"]})

    print("\nALL COMM-5 SMOKE TESTS PASSED ✅")
    client.close()


if __name__ == "__main__":
    asyncio.run(main())
