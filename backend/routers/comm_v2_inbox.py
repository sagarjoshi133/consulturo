"""Comm V2 Notification Centre endpoints.

Per spec:
    GET  /api/v2/communications/inbox
    GET  /api/v2/communications/inbox/counts
    POST /api/v2/communications/inbox/{id}/read
    POST /api/v2/communications/inbox/read-batch
    POST /api/v2/communications/inbox/{id}/archive

Design notes:
    - Any authenticated user can read/write their OWN inbox.
    - Mark-read is BATCH-EXPLICIT: caller supplies the exact ids the
      screen displayed. The Messages screen therefore cannot clear
      the notification bell — only the Notification Centre can.
    - Server always computes unread counts (never derived on client).
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from server import db, require_user
from services import comm_inbox
from services import comm_flags

router = APIRouter(prefix="/api/v2/communications", tags=["communications-v2-inbox"])


@router.get("/me")
async def comm_v2_me(user=Depends(require_user)) -> Dict[str, Any]:
    """Effective Comm V2 gating for the current user. The frontend
    CommunicationsProvider polls this on every login to decide whether
    to show the new UI or fall back to legacy screens.

    Never exposes other users' state or the full flag map — only the
    per-flag booleans that apply to *this* user."""
    uid = user.get("user_id") or user.get("id") or ""
    return {
        "user_id": uid,
        "enabled": await comm_flags.is_enabled_for_user(db, "COMMUNICATIONS_V2_ENABLED", uid),
        "push_enabled": await comm_flags.is_enabled_for_user(db, "COMMUNICATIONS_V2_PUSH_ENABLED", uid),
        "messages_enabled": await comm_flags.is_enabled_for_user(db, "COMMUNICATIONS_V2_MESSAGES_ENABLED", uid),
        "broadcasts_enabled": await comm_flags.is_enabled_for_user(db, "COMMUNICATIONS_V2_BROADCASTS_ENABLED", uid),
        "home_notices_enabled": await comm_flags.is_enabled_for_user(db, "COMMUNICATIONS_V2_HOME_NOTICES_ENABLED", uid),
        "attachments_enabled": await comm_flags.is_enabled_for_user(db, "COMMUNICATIONS_V2_ATTACHMENTS_ENABLED", uid),
    }


@router.get("/inbox")
async def list_inbox(
    limit: int = Query(30, ge=1, le=100),
    cursor: Optional[str] = None,
    category: Optional[str] = Query(None,
        pattern="^(appointments|care_updates|reminders|announcements|system|security|marketing)$"),
    include_archived: bool = False,
    unread_only: bool = False,
    user=Depends(require_user),
) -> Dict[str, Any]:
    uid = user.get("user_id") or user.get("id")
    if not uid:
        raise HTTPException(401, "Authentication required")
    return await comm_inbox.list_inbox(
        db, user_id=uid, limit=limit, cursor=cursor, category=category,
        include_archived=bool(include_archived), unread_only=bool(unread_only),
    )


@router.get("/inbox/counts")
async def inbox_counts(user=Depends(require_user)) -> Dict[str, Any]:
    uid = user.get("user_id") or user.get("id")
    if not uid:
        raise HTTPException(401, "Authentication required")
    return await comm_inbox.counts(db, user_id=uid)


@router.post("/inbox/{item_id}/read")
async def mark_one_read(item_id: str, user=Depends(require_user)) -> Dict[str, Any]:
    uid = user.get("user_id") or user.get("id")
    n = await comm_inbox.mark_read(db, user_id=uid, item_ids=[item_id])
    return {"ok": True, "updated": n}


class ReadBatchBody(BaseModel):
    item_ids: List[str] = Field(..., min_length=1, max_length=200)


@router.post("/inbox/read-batch")
async def mark_batch_read(body: ReadBatchBody, user=Depends(require_user)) -> Dict[str, Any]:
    uid = user.get("user_id") or user.get("id")
    n = await comm_inbox.mark_read(db, user_id=uid, item_ids=body.item_ids)
    return {"ok": True, "updated": n}


@router.post("/inbox/{item_id}/archive")
async def archive_item(item_id: str, user=Depends(require_user)) -> Dict[str, Any]:
    uid = user.get("user_id") or user.get("id")
    ok = await comm_inbox.archive(db, user_id=uid, item_id=item_id)
    if not ok:
        raise HTTPException(404, "Inbox item not found or already archived")
    return {"ok": True}
