"""Communications V2 durable Mongo outbox.

Design (per the ConsultUro Comm V2 spec):

Row states:
    pending      → freshly enqueued, ready to lease
    processing   → currently leased by a worker
    retry_wait   → transient failure; will move to pending at available_at
    completed    → handler ran successfully; row kept for audit
    dead_letter  → gave up after MAX_ATTEMPTS; row also copied to comm_dead_letters

Every row carries:
    event_id, event_type, aggregate_type, aggregate_id, payload,
    dedupe_key (unique), correlation_id, attempts, available_at,
    locked_by, locked_until, last_error, created_at, completed_at

Leasing is done with an atomic find_one_and_update:
  filter: {status ∈ {pending, retry_wait}, available_at ≤ now,
           $or: [locked_until missing, locked_until ≤ now]}
  update: {status: processing, locked_by, locked_until}

That guarantees two workers on two replicas cannot claim the same row.

Reliability lives in Mongo, NOT in memory. On process restart, expired
leases become processable again automatically because the filter
matches `locked_until ≤ now`.

Handler registry: modules register their event_type → coroutine via
`register_handler("push.send", handler)`. If no handler is registered
for an event_type, the row moves to dead_letter after MAX_ATTEMPTS.
"""
from __future__ import annotations

import asyncio
import os
import random
import socket
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable, Dict, Optional

from pymongo import ReturnDocument

# ─── Tunables (safe defaults) ────────────────────────────────────
BATCH_SIZE = int(os.environ.get("COMM_V2_OUTBOX_BATCH_SIZE", "20"))
LEASE_SECONDS = int(os.environ.get("COMM_V2_OUTBOX_LEASE_SECONDS", "60"))
POLL_INTERVAL = float(os.environ.get("COMM_V2_OUTBOX_POLL_SECONDS", "2.0"))
IDLE_INTERVAL = float(os.environ.get("COMM_V2_OUTBOX_IDLE_SECONDS", "10.0"))
MAX_ATTEMPTS = int(os.environ.get("COMM_V2_OUTBOX_MAX_ATTEMPTS", "8"))
BACKOFF_BASE_SECONDS = float(os.environ.get("COMM_V2_OUTBOX_BACKOFF_BASE", "3.0"))
BACKOFF_CAP_SECONDS = float(os.environ.get("COMM_V2_OUTBOX_BACKOFF_CAP", "300.0"))

# Worker identity: hostname + short random suffix (survives restart uniquely).
WORKER_ID = f"{socket.gethostname()}:{uuid.uuid4().hex[:8]}"

# Handler registry — populated by importers via register_handler.
_HANDLERS: Dict[str, Callable[[Dict[str, Any]], Awaitable[Dict[str, Any]]]] = {}

_worker_task: Optional[asyncio.Task] = None
_running = False


def register_handler(event_type: str, fn: Callable[[Dict[str, Any]], Awaitable[Dict[str, Any]]]) -> None:
    """Register a coroutine to handle an event_type.

    The handler is called with the full outbox row dict and must return
    a dict `{"ok": bool, "detail": Any}`. If it raises, the row is
    treated as a transient failure and scheduled for retry.
    """
    _HANDLERS[event_type] = fn


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _backoff_delay(attempts: int) -> float:
    """Exponential backoff with jitter (attempts starts at 1).

    delay = min(cap, base * 2^(attempts-1)) * uniform(0.5, 1.5)
    """
    base = min(BACKOFF_CAP_SECONDS, BACKOFF_BASE_SECONDS * (2 ** max(0, attempts - 1)))
    jitter = random.uniform(0.5, 1.5)
    return max(1.0, base * jitter)


async def enqueue(
    db,
    *,
    event_type: str,
    aggregate_type: str,
    aggregate_id: str,
    payload: Dict[str, Any],
    dedupe_key: Optional[str] = None,
    correlation_id: Optional[str] = None,
    available_at: Optional[datetime] = None,
) -> Dict[str, Any]:
    """Enqueue an event onto the durable outbox.

    If `dedupe_key` matches an existing row, the enqueue is a no-op
    and the existing row is returned. This is the caller-facing
    idempotency guarantee.

    Returns the outbox row (including event_id) — never raises for
    the normal "already enqueued" case.
    """
    now = _now()
    row = {
        "event_id": str(uuid.uuid4()),
        "event_type": event_type,
        "aggregate_type": aggregate_type,
        "aggregate_id": aggregate_id,
        "payload": payload,
        "dedupe_key": dedupe_key,
        "correlation_id": correlation_id,
        "attempts": 0,
        "status": "pending",
        "available_at": available_at or now,
        "locked_by": None,
        "locked_until": None,
        "last_error": None,
        "created_at": now,
        "completed_at": None,
    }
    if dedupe_key:
        # Upsert-on-dedupe: only insert if the dedupe_key doesn't exist.
        existing = await db.comm_outbox.find_one({"dedupe_key": dedupe_key}, {"_id": 0})
        if existing:
            return existing
        try:
            await db.comm_outbox.insert_one(row)
        except Exception:
            # Concurrent enqueue on the same dedupe_key — return whichever exists.
            existing = await db.comm_outbox.find_one({"dedupe_key": dedupe_key}, {"_id": 0})
            if existing:
                return existing
            raise
    else:
        await db.comm_outbox.insert_one(row)
    row.pop("_id", None)
    return row


async def _lease_one(db) -> Optional[Dict[str, Any]]:
    """Atomically lease a single row. Returns the leased row or None."""
    now = _now()
    lease_until = now + timedelta(seconds=LEASE_SECONDS)
    row = await db.comm_outbox.find_one_and_update(
        {
            "status": {"$in": ["pending", "retry_wait"]},
            "available_at": {"$lte": now},
            "$or": [
                {"locked_until": None},
                {"locked_until": {"$exists": False}},
                {"locked_until": {"$lte": now}},
            ],
        },
        {"$set": {
            "status": "processing",
            "locked_by": WORKER_ID,
            "locked_until": lease_until,
            "leased_at": now,
        }},
        sort=[("available_at", 1), ("created_at", 1)],
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )
    return row


async def _record_attempt(db, event_id: str, ok: bool, detail: Any) -> None:
    try:
        await db.comm_delivery_attempts.insert_one({
            "event_id": event_id,
            "worker_id": WORKER_ID,
            "ok": bool(ok),
            "detail": detail if isinstance(detail, (str, dict, list)) else str(detail)[:2000],
            "attempted_at": _now(),
        })
    except Exception:
        pass


async def _to_dead_letter(db, row: Dict[str, Any], reason: str) -> None:
    now = _now()
    try:
        await db.comm_dead_letters.update_one(
            {"event_id": row["event_id"]},
            {"$set": {
                "event_id": row["event_id"],
                "event_type": row.get("event_type"),
                "aggregate_type": row.get("aggregate_type"),
                "aggregate_id": row.get("aggregate_id"),
                "payload": row.get("payload"),
                "attempts": row.get("attempts", 0),
                "reason": reason,
                "last_error": row.get("last_error"),
                "created_at": now,
            }},
            upsert=True,
        )
    except Exception:
        pass
    await db.comm_outbox.update_one(
        {"event_id": row["event_id"]},
        {"$set": {
            "status": "dead_letter",
            "locked_by": None,
            "locked_until": None,
            "last_error": reason,
            "completed_at": now,
        }},
    )


async def _process_row(db, row: Dict[str, Any]) -> bool:
    """Execute the handler for a leased row. Returns True if drained
    (completed OR dead_letter), False if it needs another spin later."""
    event_type = row.get("event_type") or ""
    attempts = int(row.get("attempts") or 0) + 1
    handler = _HANDLERS.get(event_type)

    if not handler:
        # No handler for this event_type — dead-letter immediately (no retry
        # loop for a permanently-broken routing). Attempts count still bumps.
        await db.comm_outbox.update_one(
            {"event_id": row["event_id"]},
            {"$set": {"attempts": attempts, "last_error": f"no handler for {event_type}"}},
        )
        await _record_attempt(db, row["event_id"], False, f"no handler for {event_type}")
        await _to_dead_letter(db, {**row, "attempts": attempts,
                                    "last_error": f"no handler for {event_type}"},
                              reason="no_handler")
        return True

    try:
        result = await handler(row)
        ok = bool(result.get("ok"))
        detail = result.get("detail")
    except Exception as e:
        ok = False
        detail = f"handler_exception: {type(e).__name__}: {e}"

    await _record_attempt(db, row["event_id"], ok, detail)

    if ok:
        await db.comm_outbox.update_one(
            {"event_id": row["event_id"]},
            {"$set": {
                "status": "completed",
                "attempts": attempts,
                "locked_by": None,
                "locked_until": None,
                "last_error": None,
                "completed_at": _now(),
            }},
        )
        return True

    # Failure — retry with backoff, or dead-letter if exhausted.
    if attempts >= MAX_ATTEMPTS:
        await db.comm_outbox.update_one(
            {"event_id": row["event_id"]},
            {"$set": {"attempts": attempts, "last_error": str(detail)[:1000]}},
        )
        await _to_dead_letter(db, {**row, "attempts": attempts,
                                    "last_error": str(detail)[:1000]},
                              reason="max_attempts_exceeded")
        return True

    delay = _backoff_delay(attempts)
    next_at = _now() + timedelta(seconds=delay)
    await db.comm_outbox.update_one(
        {"event_id": row["event_id"]},
        {"$set": {
            "status": "retry_wait",
            "attempts": attempts,
            "locked_by": None,
            "locked_until": None,
            "available_at": next_at,
            "last_error": str(detail)[:1000],
        }},
    )
    return False


async def drain_once(db) -> Dict[str, Any]:
    """Process up to BATCH_SIZE rows and return a summary. Safe to call
    manually (via the /admin/outbox/drain endpoint) or from the worker."""
    processed = 0
    completed = 0
    retried = 0
    dead = 0
    for _ in range(BATCH_SIZE):
        row = await _lease_one(db)
        if not row:
            break
        processed += 1
        drained = await _process_row(db, row)
        # Re-read status to categorize.
        cur = await db.comm_outbox.find_one({"event_id": row["event_id"]},
                                            {"status": 1, "_id": 0})
        st = (cur or {}).get("status")
        if st == "completed":
            completed += 1
        elif st == "dead_letter":
            dead += 1
        elif st == "retry_wait":
            retried += 1
    return {
        "worker_id": WORKER_ID,
        "processed": processed,
        "completed": completed,
        "retried": retried,
        "dead_letter": dead,
    }


async def retry_dead_letter(db, event_id: str) -> bool:
    """Owner action: move a dead-lettered row back into the pending pool
    with attempts reset to zero. Returns True if a row was requeued."""
    now = _now()
    res = await db.comm_outbox.update_one(
        {"event_id": event_id, "status": "dead_letter"},
        {"$set": {
            "status": "pending",
            "attempts": 0,
            "available_at": now,
            "locked_by": None,
            "locked_until": None,
            "last_error": None,
        }},
    )
    return bool(res.modified_count)


async def outbox_stats(db) -> Dict[str, Any]:
    """Snapshot of counts per status for the diagnostics panel."""
    pipeline = [{"$group": {"_id": "$status", "count": {"$sum": 1}}}]
    counts = {}
    async for row in db.comm_outbox.aggregate(pipeline):
        counts[row["_id"] or "unknown"] = row["count"]
    dead = await db.comm_dead_letters.count_documents({})
    return {"worker_id": WORKER_ID, "by_status": counts, "dead_letters_total": dead}


def _get_db():
    """Late-bound db handle — imported at call time to avoid startup
    cycle with server.py."""
    from server import db as _db
    return _db


async def _worker_loop():
    global _running
    _running = True
    print(f"[comm_v2.outbox] worker started as {WORKER_ID}")
    while _running:
        try:
            db = _get_db()
            summary = await drain_once(db)
            if (summary.get("processed") or 0) == 0:
                await asyncio.sleep(IDLE_INTERVAL)
            else:
                await asyncio.sleep(POLL_INTERVAL)
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"[comm_v2.outbox] loop error (continuing): {e}")
            await asyncio.sleep(IDLE_INTERVAL)
    print(f"[comm_v2.outbox] worker stopped ({WORKER_ID})")


def start_worker() -> None:
    """Start the background worker task. Safe to call multiple times —
    subsequent calls are no-ops while a task is already running."""
    global _worker_task
    if _worker_task and not _worker_task.done():
        return
    loop = asyncio.get_event_loop()
    _worker_task = loop.create_task(_worker_loop())


def stop_worker() -> None:
    global _running, _worker_task
    _running = False
    if _worker_task and not _worker_task.done():
        _worker_task.cancel()
