"""Communications V2 admin router.

Comm-1 (foundation) surface only. Later phases add:
  - /installations/*           (Comm-2 — Push V2)
  - /inbox/*                   (Comm-3 — Notification Centre V2)
  - /conversations/* etc.      (Comm-4 — Messaging V2)
  - /broadcasts/* etc.         (Comm-5 — Broadcast Studio V2)
  - /home-notices/*            (Comm-6 — Home Notice Banner)

Owner-tier only: all writes require primary_owner / super_owner. Reads
(flags list, outbox stats) also require owner-tier for safety — we
never expose delivery diagnostics to patients or general staff.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from server import db, require_owner
from services import comm_flags
from services import comm_outbox
from services import comm_audit

router = APIRouter(prefix="/api/v2/communications", tags=["communications-v2"])


# ── Feature flags ───────────────────────────────────────────────

@router.get("/admin/flags")
async def get_flags(user=Depends(require_owner)) -> Dict[str, Any]:
    flags = await comm_flags.get_all_flags(db)
    return {"flags": flags, "valid_keys": sorted(comm_flags.VALID_KEYS)}


class FlagBody(BaseModel):
    key: str
    value: Any


@router.post("/admin/flags")
async def set_flag(body: FlagBody, user=Depends(require_owner)) -> Dict[str, Any]:
    if body.key not in comm_flags.VALID_KEYS:
        raise HTTPException(status_code=400, detail={
            "error_code": "unknown_flag",
            "valid_keys": sorted(comm_flags.VALID_KEYS),
        })
    await comm_flags.set_flag(db, body.key, body.value, actor_user_id=user.get("user_id"))
    await comm_audit.log(
        db,
        action="flag.set",
        actor_user_id=user.get("user_id"),
        actor_role=user.get("role"),
        target_type="flag",
        target_id=body.key,
        metadata={"value": body.value},
    )
    return {"ok": True, "flags": await comm_flags.get_all_flags(db)}


# ── Durable outbox ──────────────────────────────────────────────

@router.get("/admin/outbox/stats")
async def outbox_stats(user=Depends(require_owner)) -> Dict[str, Any]:
    return await comm_outbox.outbox_stats(db)


@router.post("/admin/outbox/drain")
async def outbox_drain(user=Depends(require_owner)) -> Dict[str, Any]:
    """Manual drain — process one batch of pending rows synchronously.

    Owner-only (never n8n-integrated at this stage per the spec).
    Handy in preview where the background worker may be idle-sleeping.
    """
    res = await comm_outbox.drain_once(db)
    await comm_audit.log(
        db,
        action="outbox.drain",
        actor_user_id=user.get("user_id"),
        actor_role=user.get("role"),
        target_type="outbox",
        metadata=res,
    )
    return res


class DeadLetterRetryBody(BaseModel):
    event_id: str


@router.post("/admin/outbox/dead-letters/retry")
async def retry_dead_letter(body: DeadLetterRetryBody, user=Depends(require_owner)) -> Dict[str, Any]:
    ok = await comm_outbox.retry_dead_letter(db, body.event_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Dead-letter row not found")
    await comm_audit.log(
        db,
        action="outbox.retry_dead_letter",
        actor_user_id=user.get("user_id"),
        actor_role=user.get("role"),
        target_type="outbox_event",
        target_id=body.event_id,
    )
    return {"ok": True}


@router.get("/admin/outbox/dead-letters")
async def list_dead_letters(
    limit: int = Query(50, ge=1, le=200),
    user=Depends(require_owner),
) -> Dict[str, Any]:
    rows = []
    async for r in db.comm_dead_letters.find({}, {"_id": 0}).sort("created_at", -1).limit(limit):
        rows.append(r)
    return {"items": rows, "count": len(rows)}


@router.get("/admin/outbox/events")
async def list_events(
    status: Optional[str] = Query(None,
        pattern="^(pending|processing|retry_wait|completed|dead_letter)$"),
    limit: int = Query(50, ge=1, le=200),
    user=Depends(require_owner),
) -> Dict[str, Any]:
    q = {}
    if status:
        q["status"] = status
    rows = []
    async for r in db.comm_outbox.find(q, {"_id": 0}).sort("created_at", -1).limit(limit):
        rows.append(r)
    return {"items": rows, "count": len(rows)}


# ── Diagnostics ─────────────────────────────────────────────────

@router.get("/admin/health")
async def health(user=Depends(require_owner)) -> Dict[str, Any]:
    """One-glance health snapshot for Comm V2. Non-invasive; safe to poll."""
    outbox = await comm_outbox.outbox_stats(db)
    flags = await comm_flags.get_all_flags(db)
    collections = {}
    for name in [
        "comm_installations", "comm_inbox_items", "comm_conversations",
        "comm_messages", "comm_broadcasts", "comm_broadcast_recipients",
        "comm_home_notices", "comm_outbox", "comm_dead_letters", "comm_audit_log",
    ]:
        try:
            collections[name] = await db[name].estimated_document_count()
        except Exception:
            collections[name] = None
    return {
        "outbox": outbox,
        "collections": collections,
        "flags": flags,
    }
