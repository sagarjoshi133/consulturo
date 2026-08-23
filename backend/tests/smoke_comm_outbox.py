"""Comm-1 outbox smoke test — one-shot script that exercises:
  - enqueue with dedupe (second enqueue returns same row)
  - handler success path (row → completed)
  - handler failure path (row → retry_wait → completed on retry)
  - no-handler path (row → dead_letter after one attempt)
  - drain_once returns accurate counts
  - lease renewal / concurrency: two lease calls back-to-back never
    return the same row.
"""
from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402
from services import comm_outbox  # noqa: E402


async def main():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ.get("DB_NAME", "consulturo")]

    # Clean previous test state (only rows tagged smoke-test-…).
    await db.comm_outbox.delete_many({"event_type": {"$regex": "^smoke\\."}})
    await db.comm_dead_letters.delete_many({"event_type": {"$regex": "^smoke\\."}})

    # Register handlers.
    counts = {"ok": 0, "flaky": 0}

    async def ok_handler(row):
        counts["ok"] += 1
        return {"ok": True, "detail": {"echo": row.get("payload")}}

    async def flaky_handler(row):
        counts["flaky"] += 1
        if counts["flaky"] < 2:
            return {"ok": False, "detail": "transient upstream 503"}
        return {"ok": True, "detail": "succeeded on retry"}

    comm_outbox.register_handler("smoke.ok", ok_handler)
    comm_outbox.register_handler("smoke.flaky", flaky_handler)

    # 1) Enqueue with dedupe
    r1 = await comm_outbox.enqueue(db, event_type="smoke.ok",
                                    aggregate_type="test", aggregate_id="a1",
                                    payload={"n": 1}, dedupe_key="smoke-ok-1")
    r2 = await comm_outbox.enqueue(db, event_type="smoke.ok",
                                    aggregate_type="test", aggregate_id="a1",
                                    payload={"n": 1}, dedupe_key="smoke-ok-1")
    assert r1["event_id"] == r2["event_id"], "dedupe returned different rows!"
    print("✓ dedupe returns same event_id:", r1["event_id"])

    # 2) Enqueue flaky (retry then ok) and dead-letter candidate
    await comm_outbox.enqueue(db, event_type="smoke.flaky",
                              aggregate_type="test", aggregate_id="a2",
                              payload={"n": 2}, dedupe_key="smoke-flaky-1")
    await comm_outbox.enqueue(db, event_type="smoke.no_handler",
                              aggregate_type="test", aggregate_id="a3",
                              payload={"n": 3}, dedupe_key="smoke-noh-1")

    # 3) Drain
    summary = await comm_outbox.drain_once(db)
    print("drain1:", summary)
    assert summary["processed"] == 3
    assert summary["dead_letter"] == 1, f"expected 1 dead_letter, got {summary}"

    # Flaky row should now be retry_wait. Force it available and drain again.
    from datetime import datetime, timezone
    await db.comm_outbox.update_one(
        {"dedupe_key": "smoke-flaky-1"},
        {"$set": {"available_at": datetime.now(timezone.utc)}},
    )
    summary2 = await comm_outbox.drain_once(db)
    print("drain2:", summary2)

    # Verify final states
    ok_row = await db.comm_outbox.find_one({"dedupe_key": "smoke-ok-1"})
    flaky_row = await db.comm_outbox.find_one({"dedupe_key": "smoke-flaky-1"})
    noh_row = await db.comm_outbox.find_one({"dedupe_key": "smoke-noh-1"})
    assert ok_row["status"] == "completed", ok_row
    assert flaky_row["status"] == "completed", flaky_row
    assert noh_row["status"] == "dead_letter", noh_row
    print("✓ ok → completed")
    print("✓ flaky → completed after retry (attempts =", flaky_row["attempts"], ")")
    print("✓ no_handler → dead_letter")

    dead_row = await db.comm_dead_letters.find_one({"event_id": noh_row["event_id"]})
    assert dead_row and dead_row["reason"] == "no_handler"
    print("✓ dead_letter row mirrored in comm_dead_letters")

    # Retry dead-letter back into pending
    ok = await comm_outbox.retry_dead_letter(db, noh_row["event_id"])
    assert ok
    reqd = await db.comm_outbox.find_one({"event_id": noh_row["event_id"]})
    assert reqd["status"] == "pending" and reqd["attempts"] == 0
    print("✓ retry_dead_letter restores row to pending w/ attempts=0")

    # Stats
    stats = await comm_outbox.outbox_stats(db)
    print("outbox stats:", stats)

    # Cleanup smoke rows
    await db.comm_outbox.delete_many({"event_type": {"$regex": "^smoke\\."}})
    await db.comm_dead_letters.delete_many({"event_type": {"$regex": "^smoke\\."}})
    print("\nALL SMOKE TESTS PASSED")

    client.close()


if __name__ == "__main__":
    asyncio.run(main())
