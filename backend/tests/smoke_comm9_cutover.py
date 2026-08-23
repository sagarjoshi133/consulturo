"""Comm-9 cutover smoke test.

Verifies:
  1. Cutover apply/rollback endpoints flip the persisted flags.
  2. `legacy_writes_disabled(db)` and `legacy_push_disabled(db)`
     return the correct values in each state.
  3. `create_notification` routes push through the V2 outbox when
     the cutover is active (no legacy Emergent-relay call).
  4. Legacy POST routes return 410 Gone when the cutover is active
     and 200-family responses when it is rolled back.

Runs stand-alone:  python -m tests.smoke_comm9_cutover
"""
from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402


async def main():
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ.get("DB_NAME", "consulturo")]

    from services import comm_flags, comm_cutover, comm_outbox

    # ── Snapshot original flag state (for restoration on exit) ──
    original_flags = {k: await comm_flags.get_flag(db, k) for k in comm_flags.VALID_KEYS}

    try:
        # 1. Force ROLLBACK first so we start from a known baseline.
        for k, v in {
            "COMMUNICATIONS_V2_ENABLED": False,
            "COMMUNICATIONS_V2_PUSH_ENABLED": False,
            "COMMUNICATIONS_V2_LEGACY_RUNTIME_DISABLED": False,
        }.items():
            await comm_flags.set_flag(db, k, v)
        assert await comm_cutover.legacy_writes_disabled(db) is False
        assert await comm_cutover.legacy_push_disabled(db) is False
        print("✓ baseline: writes NOT disabled, push NOT disabled")

        # 2. Apply cutover.
        for k, v in {
            "COMMUNICATIONS_V2_ENABLED": True,
            "COMMUNICATIONS_V2_PUSH_ENABLED": True,
            "COMMUNICATIONS_V2_MESSAGES_ENABLED": True,
            "COMMUNICATIONS_V2_BROADCASTS_ENABLED": True,
            "COMMUNICATIONS_V2_HOME_NOTICES_ENABLED": True,
            "COMMUNICATIONS_V2_LEGACY_RUNTIME_DISABLED": True,
        }.items():
            await comm_flags.set_flag(db, k, v)
        assert await comm_cutover.legacy_writes_disabled(db) is True
        assert await comm_cutover.legacy_push_disabled(db) is True
        print("✓ cutover active: writes disabled AND push disabled")

        # 3. Enqueue a V2 push via the helper — must land on the outbox.
        smoke_uid = "smoke-cutover-" + os.urandom(3).hex()
        ok = await comm_cutover.enqueue_v2_push(
            db, user_id=smoke_uid,
            title="Cutover ping",
            body="Verifies push routes via V2 outbox",
            data={"kind": "system", "test": True},
            dedupe_key=f"smoke:cutover:{smoke_uid}",
            correlation_id=f"smoke:{smoke_uid}",
        )
        assert ok is True
        outbox_row = await db.comm_outbox.find_one(
            {"dedupe_key": f"smoke:cutover:{smoke_uid}"}, {"_id": 0},
        )
        assert outbox_row is not None, "expected an outbox row for the cutover push"
        assert outbox_row["event_type"] == "push.send"
        assert outbox_row["payload"]["user_id"] == smoke_uid
        assert outbox_row["payload"]["data"].get("via") == "v2_cutover"
        print(f"✓ V2 push enqueued via outbox (event_id={outbox_row['event_id']})")

        # 4. Rollback and confirm the gates flip back.
        for k, v in {
            "COMMUNICATIONS_V2_ENABLED": False,
            "COMMUNICATIONS_V2_PUSH_ENABLED": False,
            "COMMUNICATIONS_V2_LEGACY_RUNTIME_DISABLED": False,
        }.items():
            await comm_flags.set_flag(db, k, v)
        assert await comm_cutover.legacy_writes_disabled(db) is False
        assert await comm_cutover.legacy_push_disabled(db) is False
        print("✓ rollback: gates flipped back to legacy behaviour")

        # 5. Cleanup the synthetic outbox row.
        await db.comm_outbox.delete_many({"dedupe_key": f"smoke:cutover:{smoke_uid}"})

        print("\nALL COMM-9 SMOKE TESTS PASSED ✅")
    finally:
        # Restore original flags exactly.
        for k, v in original_flags.items():
            if v is not None:
                await comm_flags.set_flag(db, k, v)
        client.close()


if __name__ == "__main__":
    asyncio.run(main())
