"""Comm V2 cutover helpers (Comm-9).

Tiny helpers used to gate legacy write endpoints and route pushes
through the V2 outbox once the cutover flags are on.

Centralised here so no legacy router or service has to import the
cutover logic directly — they just call `legacy_writes_disabled(db)`
and `legacy_push_disabled(db)` and get a boolean back.
"""
from __future__ import annotations

from typing import Any, Dict, Optional


async def legacy_writes_disabled(db) -> bool:
    """True when the cutover flag `COMMUNICATIONS_V2_LEGACY_RUNTIME_DISABLED`
    is on. Legacy WRITE endpoints (POST /api/broadcasts, POST
    /api/messages/send, etc.) should return 410 Gone in this state.

    Read endpoints continue to work — historical data is never
    deleted.
    """
    try:
        from services.comm_flags import get_flag
        return bool(await get_flag(db, "COMMUNICATIONS_V2_LEGACY_RUNTIME_DISABLED",
                                     False))
    except Exception:
        return False


async def legacy_push_disabled(db) -> bool:
    """True when V2 push is authoritative (either the master flag or
    the push-specific flag is on). When true, `create_notification`
    routes pushes through the durable outbox → direct FCM v1 instead
    of the legacy Emergent-relay path."""
    try:
        from services.comm_flags import get_all_flags
        f = await get_all_flags(db)
        return bool(f.get("COMMUNICATIONS_V2_ENABLED") and
                     f.get("COMMUNICATIONS_V2_PUSH_ENABLED"))
    except Exception:
        return False


async def enqueue_v2_push(
    db,
    *,
    user_id: str,
    title: str,
    body: str,
    data: Optional[Dict[str, Any]] = None,
    dedupe_key: Optional[str] = None,
    correlation_id: Optional[str] = None,
    category: str = "system",
) -> bool:
    """Push through the V2 outbox → direct FCM v1.

    Non-crashing: any failure returns False so legacy callers can
    keep operating (e.g. write the notification row anyway).
    """
    try:
        from services import comm_outbox
        ev = await comm_outbox.enqueue(
            db,
            event_type="push.send",
            aggregate_type="v2_bell",
            aggregate_id=user_id,
            payload={
                "user_id": user_id,
                "category": category,
                "title": title,
                "body": body,
                "data": {**(data or {}), "via": "v2_cutover"},
            },
            dedupe_key=dedupe_key,
            correlation_id=correlation_id,
        )
        return bool(ev and ev.get("event_id"))
    except Exception:
        return False


def cutover_gone_response(pointer: str) -> Dict[str, Any]:
    """Standard 410 Gone body for a deprecated legacy write endpoint."""
    return {
        "error_code": "legacy_endpoint_retired",
        "detail": ("This endpoint has been retired by Communications V2. "
                     "Please use the V2 endpoint instead."),
        "v2_endpoint": pointer,
        "docs": "COMM_V2_PRD.md § COMM-9",
    }
