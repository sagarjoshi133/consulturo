"""ConsultUro 2.0 — Phase B: Notification outbox with retry.

Durable delivery pipeline for device pushes:

    send_push_reliable(recipients, data, kind=…)
        Direct relay send. When the relay is CONFIGURED but the send
        fails (transient upstream error), the payload is queued into
        `notification_outbox` and retried by the background worker
        with exponential backoff. Bounded: max 5 attempts, 6-hour TTL
        (stale pushes are worse than no pushes for a medical app).

    enqueue_push(recipients, data, kind=…)
        Queue a push for asynchronous delivery without attempting a
        direct send first.

    start_outbox_worker()
        Background asyncio loop started at boot. Wakes every 60 s (or
        immediately after an enqueue) and drains due pending rows.

Outbox row lifecycle:
    pending → processing → sent
                        ↘ pending (retry w/ backoff) → … → dead
    pending/processing older than TTL → expired

No-op in preview: when EMERGENT_PUSH_KEY is "placeholder" the worker
only runs the expiry sweep — nothing is claimed, nothing spins.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional

from db import db

MAX_ATTEMPTS = 5
OUTBOX_TTL_HOURS = 6
_BACKOFF_MINUTES = [0.5, 2, 10, 30, 60]  # attempt N → wait _BACKOFF_MINUTES[N-1]
_WORKER_INTERVAL_SEC = 60

_worker_task: Optional[asyncio.Task] = None
_wake_event: Optional[asyncio.Event] = None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _wake() -> None:
    """Nudge the worker loop so a fresh enqueue is delivered promptly
    instead of waiting for the next 60 s tick."""
    if _wake_event is not None:
        try:
            _wake_event.set()
        except Exception:
            pass


# ─── Enqueue ─────────────────────────────────────────────────────────

async def enqueue_push(
    recipients: Iterable[str],
    data: Dict[str, Any],
    *,
    kind: Optional[str] = None,
    reason: Optional[str] = None,
) -> Dict[str, Any]:
    """Insert a pending outbox row. Returns {queued, outbox_id}."""
    rcpts = [r for r in list(recipients or []) if r]
    if not rcpts:
        return {"queued": False, "reason": "no_recipients"}
    now = _now()
    row = {
        "id": str(uuid.uuid4()),
        "recipients": rcpts,
        "data": dict(data or {}),
        "kind": kind or (data or {}).get("kind") or (data or {}).get("type"),
        "status": "pending",
        "attempts": 0,
        "max_attempts": MAX_ATTEMPTS,
        "last_error": reason,
        "next_attempt_at": now + timedelta(seconds=30),
        "expires_at": now + timedelta(hours=OUTBOX_TTL_HOURS),
        "created_at": now,
        "updated_at": now,
        "sent_at": None,
    }
    await db.notification_outbox.insert_one(dict(row))
    _wake()
    return {"queued": True, "outbox_id": row["id"]}


# ─── Reliable send (direct + retry queue on failure) ────────────────

async def send_push_reliable(
    recipients: Iterable[str],
    data: Dict[str, Any],
    *,
    kind: Optional[str] = None,
    idempotency_key: Optional[str] = None,
) -> Dict[str, Any]:
    """Relay send with a durability net.

    • Relay not configured (preview) → returns no_emergent_key without
      queuing (the caller's Expo-direct fallback covers dev; queuing
      here would flush stale pushes hours later after a deploy).
    • Relay configured + send failed → payload queued for background
      retry; response gains {queued_for_retry, outbox_id}.
    """
    from services.push_relay import is_configured, send_push

    rcpts = [r for r in list(recipients or []) if r]
    if not rcpts:
        return {"sent": 0, "ok": False, "reason": "no_recipients"}
    if not is_configured():
        return {"sent": 0, "ok": False, "reason": "no_emergent_key"}
    res = await send_push(
        recipients=rcpts, data=data, kind=kind, idempotency_key=idempotency_key
    )
    if not res.get("ok"):
        err = res.get("errors") or [res.get("reason") or "send_failed"]
        q = await enqueue_push(rcpts, data, kind=kind, reason=str(err[0])[:300])
        res["queued_for_retry"] = bool(q.get("queued"))
        res["outbox_id"] = q.get("outbox_id")
    return res


# ─── Worker ──────────────────────────────────────────────────────────

async def outbox_worker_pass(batch: int = 25) -> Dict[str, Any]:
    """One drain pass. Safe to call concurrently (rows are claimed via
    atomic find_one_and_update). Returns a summary dict."""
    from services.push_relay import is_configured, send_push

    now = _now()
    summary: Dict[str, Any] = {
        "expired": 0, "claimed": 0, "sent": 0,
        "retried": 0, "dead": 0,
        "relay_configured": bool(is_configured()),
        "at": now,
    }

    # 1) Expiry sweep — always runs, even without a relay key.
    exp = await db.notification_outbox.update_many(
        {"status": {"$in": ["pending", "processing"]}, "expires_at": {"$lt": now}},
        {"$set": {"status": "expired", "updated_at": now}},
    )
    summary["expired"] = exp.modified_count

    if not is_configured():
        summary["skipped"] = "relay_not_configured"
        return summary

    # 2) Claim + deliver due pending rows.
    for _ in range(max(1, batch)):
        row = await db.notification_outbox.find_one_and_update(
            {"status": "pending", "next_attempt_at": {"$lte": _now()}},
            {"$set": {"status": "processing", "updated_at": _now()}},
        )
        if not row:
            break
        summary["claimed"] += 1
        attempts = int(row.get("attempts") or 0) + 1
        try:
            res = await send_push(
                recipients=row.get("recipients") or [],
                data=row.get("data") or {},
                kind=row.get("kind"),
                idempotency_key=f"outbox-{row['id']}-{attempts}",
            )
            ok = bool(res.get("ok"))
            err = None if ok else str(
                (res.get("errors") or [res.get("reason") or "send_failed"])[0]
            )[:300]
        except Exception as e:
            ok, err = False, str(e)[:300]

        patch: Dict[str, Any] = {"attempts": attempts, "updated_at": _now(), "last_error": err}
        if ok:
            patch.update({"status": "sent", "sent_at": _now()})
            summary["sent"] += 1
        elif attempts >= int(row.get("max_attempts") or MAX_ATTEMPTS):
            patch["status"] = "dead"
            summary["dead"] += 1
        else:
            backoff_min = _BACKOFF_MINUTES[min(attempts, len(_BACKOFF_MINUTES)) - 1]
            patch.update({
                "status": "pending",
                "next_attempt_at": _now() + timedelta(minutes=backoff_min),
            })
            summary["retried"] += 1
        await db.notification_outbox.update_one({"id": row["id"]}, {"$set": patch})

    # Log only meaningful passes — an idle 60 s tick writes nothing.
    if summary["claimed"] or summary["expired"]:
        try:
            await db.outbox_worker_log.insert_one({**summary, "id": str(uuid.uuid4())})
        except Exception:
            pass
    return summary


async def _worker_loop() -> None:
    global _wake_event
    _wake_event = asyncio.Event()
    while True:
        try:
            await asyncio.wait_for(_wake_event.wait(), timeout=_WORKER_INTERVAL_SEC)
        except asyncio.TimeoutError:
            pass
        _wake_event.clear()
        try:
            await outbox_worker_pass()
        except Exception as e:
            print(f"[outbox] worker pass failed: {e}")


def start_outbox_worker() -> None:
    """Idempotent — starts the background drain loop once per process."""
    global _worker_task
    if _worker_task is not None and not _worker_task.done():
        return
    _worker_task = asyncio.get_event_loop().create_task(_worker_loop())
    print("[outbox] worker started (interval 60s, backoff 30s→60m, ttl 6h)")


# ─── Stats (health panel) ────────────────────────────────────────────

async def outbox_stats() -> Dict[str, Any]:
    now = _now()
    day_ago = now - timedelta(hours=24)
    out: Dict[str, Any] = {}
    for status in ("pending", "processing"):
        out[status] = await db.notification_outbox.count_documents({"status": status})
    for status in ("sent", "dead", "expired"):
        out[f"{status}_24h"] = await db.notification_outbox.count_documents(
            {"status": status, "updated_at": {"$gte": day_ago}}
        )
    return out
