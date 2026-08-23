"""Comm-2 backend smoke test.

Verifies:
  1. firebase_admin initialisation from FIREBASE_SERVICE_ACCOUNT_JSON_B64
  2. project_id matches env
  3. push.send handler is registered on the outbox
  4. Handler correctly returns 'no_active_installations' when there are none
  5. Handler correctly returns per-installation results when there are some
  6. FCM dry_run against a synthetic-but-well-formed token returns
     classify=='invalidate' (which is what we WANT — it means the SDK
     is talking to Google's servers and getting a specific rejection,
     not a config failure).
"""
from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402


async def main():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ.get("DB_NAME", "consulturo")]

    # 1. Firebase init
    from services import comm_fcm
    assert comm_fcm.is_configured(), f"FCM not configured: {comm_fcm.last_init_error()}"
    pid = comm_fcm.project_id()
    print(f"✓ FCM initialised — project = {pid}")
    assert pid == "consulturo-87dfa", f"unexpected project_id: {pid}"

    # 2. Dry-run against a fake token
    fake_token = "fake_token_for_smoke_test_" + "a" * 100
    dry = await comm_fcm.send_dry_run(token=fake_token, category="system")
    print(f"  dry-run against fake token: ok={dry.get('ok')} category={dry.get('category')} code={dry.get('code')}")
    # Expected: ok=False, category=invalidate (Google says token invalid).
    # If we instead got category=config, credentials are wrong.
    assert not dry.get("ok"), "dry-run against fake token should NOT succeed"
    assert dry.get("category") == "invalidate", (
        f"Expected 'invalidate' (real Google response) but got {dry}. "
        "This means firebase_admin didn't actually talk to Google — check creds."
    )
    print("✓ Google returned a proper INVALID_ARGUMENT — creds work end-to-end")

    # 3. Push handler registered
    from services import comm_push_handler, comm_outbox
    comm_push_handler.register()
    assert "push.send" in comm_outbox._HANDLERS, "push.send handler not registered"
    print("✓ push.send handler registered on outbox")

    # 4. no_active_installations path
    ev = await comm_outbox.enqueue(
        db, event_type="push.send",
        aggregate_type="test", aggregate_id="fake_user_no_devices",
        payload={
            "user_id": "fake_user_no_devices",
            "category": "system",
            "title": "SMOKE",
            "body": "should be skipped",
            "data": {"type": "smoke"},
        },
        dedupe_key=f"smoke-comm2-nod-{asyncio.get_event_loop().time():.0f}",
    )
    await comm_outbox.drain_once(db)
    final = await db.comm_outbox.find_one({"event_id": ev["event_id"]})
    attempt = await db.comm_delivery_attempts.find_one(
        {"event_id": ev["event_id"]}, sort=[("attempted_at", -1)])
    print(f"  no-devices event: status={final.get('status')} attempts={final.get('attempts')}")
    assert final["status"] == "completed", final
    assert attempt and attempt["detail"] == {"skipped": "no_active_installations"}
    print("✓ handler returns ok=True with 'skipped: no_active_installations'")

    # 5. Insert a fake installation, enqueue, drain, expect invalidation
    from services import comm_installations
    fake_uid = "smoke_user_" + os.urandom(4).hex()
    await db.users.insert_one({"user_id": fake_uid, "email": f"{fake_uid}@smoke", "role": "primary_owner"})
    row = await comm_installations.register(
        db, user_id=fake_uid,
        installation_id=f"smoke-inst-{fake_uid}",
        provider="fcm", platform="android",
        device_token=fake_token,
    )
    print(f"  installed fake device — token_hash={row.get('token_hash')[:12]}…")
    ev2 = await comm_outbox.enqueue(
        db, event_type="push.send",
        aggregate_type="test", aggregate_id=fake_uid,
        payload={
            "user_id": fake_uid, "category": "appointments",
            "title": "SMOKE-2", "body": "ConsultUro: you have an update.",
            "data": {"type": "smoke2", "inbox_item_id": "abc"},
        },
        dedupe_key=f"smoke-comm2-fake-{fake_uid}",
    )
    await comm_outbox.drain_once(db)
    final2 = await db.comm_outbox.find_one({"event_id": ev2["event_id"]})
    inst_after = await db.comm_installations.find_one({"installation_id": f"smoke-inst-{fake_uid}"})
    print(f"  fake-token event: status={final2.get('status')} attempts={final2.get('attempts')}")
    print(f"  installation status after send: {inst_after.get('status')}")
    assert final2["status"] == "completed", final2  # all_permanent → completed
    assert inst_after["status"] == "invalidated"
    assert inst_after["invalidated_reason"] in ("INVALID_ARGUMENT", "UNREGISTERED", "invalidate")
    print("✓ FCM permanent-error correctly invalidated the installation")

    # Cleanup
    await db.users.delete_one({"user_id": fake_uid})
    await db.comm_installations.delete_one({"installation_id": f"smoke-inst-{fake_uid}"})
    await db.comm_outbox.delete_many({"aggregate_id": {"$in": [fake_uid, "fake_user_no_devices"]}})
    await db.comm_delivery_attempts.delete_many({"event_id": {"$in": [ev["event_id"], ev2["event_id"]]}})

    print("\nALL COMM-2 SMOKE TESTS PASSED ✅")
    client.close()


if __name__ == "__main__":
    asyncio.run(main())
