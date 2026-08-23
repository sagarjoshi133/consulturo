"""Comm V2 Broadcast Studio endpoints.

    GET  /api/v2/communications/broadcasts
    POST /api/v2/communications/broadcasts             (create draft)
    PATCH /api/v2/communications/broadcasts/{id}       (edit draft)
    POST /api/v2/communications/broadcasts/{id}/submit
    GET  /api/v2/communications/broadcasts/{id}/preview
    POST /api/v2/communications/broadcasts/{id}/approve
    POST /api/v2/communications/broadcasts/{id}/reject
    POST /api/v2/communications/broadcasts/{id}/schedule
    POST /api/v2/communications/broadcasts/{id}/cancel
    POST /api/v2/communications/broadcasts/{id}/retry-failed
    GET  /api/v2/communications/broadcasts/{id}/analytics
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from server import db, require_user
from services import comm_broadcasts as _b

router = APIRouter(prefix="/api/v2/communications", tags=["communications-v2-broadcasts"])


def _err(status: int, code: str, msg: str) -> HTTPException:
    return HTTPException(status_code=status,
                         detail={"error_code": code, "message": msg})


# ── List + get ──────────────────────────────────────────────────

@router.get("/broadcasts")
async def list_broadcasts(
    limit: int = Query(20, ge=1, le=100),
    cursor: Optional[str] = None,
    state: Optional[str] = None,
    user=Depends(require_user),
):
    try:
        return await _b.list_broadcasts(db, actor=user, limit=limit,
                                          cursor=cursor, state=state)
    except PermissionError:
        raise _err(403, "staff_only", "Staff only.")


@router.get("/broadcasts/{bid}")
async def get_broadcast(bid: str, user=Depends(require_user)):
    if not _b._is_staff(user):
        raise _err(403, "staff_only", "Staff only.")
    b = await _b.get_broadcast(db, bid)
    if not b:
        raise _err(404, "broadcast_not_found", "Broadcast not found.")
    return {"broadcast": b}


# ── Create / edit draft ─────────────────────────────────────────

class CreateBroadcastBody(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    body: str = Field(..., min_length=1, max_length=4000)
    category: str = Field("announcements",
        pattern="^(appointments|announcements|reminders|system|marketing)$")
    audience_mode: str = Field(...,
        pattern="^(patients|staff|both|selected_patients|patients_with_future_appointments)$")
    selected_patient_user_ids: Optional[List[str]] = None
    scheduled_at: Optional[datetime] = None
    action_type: str = "open_broadcast"


@router.post("/broadcasts")
async def create_broadcast(body: CreateBroadcastBody, user=Depends(require_user)):
    try:
        doc = await _b.create_draft(
            db, actor=user, title=body.title, body=body.body,
            category=body.category, audience_mode=body.audience_mode,
            selected_patient_user_ids=body.selected_patient_user_ids,
            scheduled_at=body.scheduled_at, action_type=body.action_type,
        )
        return {"broadcast": doc}
    except PermissionError:
        raise _err(403, "staff_only", "Staff only.")
    except ValueError as e:
        raise _err(400, str(e), str(e))


class UpdateBroadcastBody(BaseModel):
    title: Optional[str] = None
    body: Optional[str] = None
    category: Optional[str] = None
    audience_mode: Optional[str] = None
    selected_patient_user_ids: Optional[List[str]] = None
    scheduled_at: Optional[datetime] = None
    action_type: Optional[str] = None


@router.patch("/broadcasts/{bid}")
async def update_broadcast(bid: str, body: UpdateBroadcastBody,
                            user=Depends(require_user)):
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    try:
        doc = await _b.update_draft(db, actor=user, broadcast_id=bid, fields=fields)
        return {"broadcast": doc}
    except PermissionError:
        raise _err(403, "staff_only", "Staff only.")
    except ValueError as e:
        raise _err(400, str(e), str(e))


@router.post("/broadcasts/{bid}/submit")
async def submit_for_approval(bid: str, user=Depends(require_user)):
    try:
        return {"broadcast": await _b.submit_for_approval(
            db, actor=user, broadcast_id=bid)}
    except PermissionError:
        raise _err(403, "staff_only", "Staff only.")
    except ValueError as e:
        raise _err(400, str(e), str(e))


# ── Preview ─────────────────────────────────────────────────────

@router.get("/broadcasts/{bid}/preview")
async def preview(bid: str, user=Depends(require_user)):
    try:
        return await _b.preview_broadcast(db, actor=user, broadcast_id=bid)
    except PermissionError:
        raise _err(403, "staff_only", "Staff only.")
    except ValueError as e:
        raise _err(404, str(e), str(e))


# ── Owner-only lifecycle ────────────────────────────────────────

@router.post("/broadcasts/{bid}/approve")
async def approve(bid: str, user=Depends(require_user)):
    try:
        return {"broadcast": await _b.approve_broadcast(
            db, actor=user, broadcast_id=bid)}
    except PermissionError:
        raise _err(403, "owner_only", "Owner only.")
    except ValueError as e:
        raise _err(400, str(e), str(e))


class RejectBody(BaseModel):
    reason: Optional[str] = None


@router.post("/broadcasts/{bid}/reject")
async def reject(bid: str,
                  body: RejectBody = Body(default_factory=RejectBody),
                  user=Depends(require_user)):
    try:
        return {"broadcast": await _b.reject_broadcast(
            db, actor=user, broadcast_id=bid, reason=body.reason)}
    except PermissionError:
        raise _err(403, "owner_only", "Owner only.")
    except ValueError as e:
        raise _err(400, str(e), str(e))


class ScheduleBody(BaseModel):
    scheduled_at: datetime


@router.post("/broadcasts/{bid}/schedule")
async def schedule(bid: str, body: ScheduleBody, user=Depends(require_user)):
    try:
        return {"broadcast": await _b.schedule_broadcast(
            db, actor=user, broadcast_id=bid, scheduled_at=body.scheduled_at)}
    except PermissionError:
        raise _err(403, "owner_only", "Owner only.")
    except ValueError as e:
        raise _err(400, str(e), str(e))


@router.post("/broadcasts/{bid}/cancel")
async def cancel(bid: str, user=Depends(require_user)):
    try:
        return {"broadcast": await _b.cancel_broadcast(
            db, actor=user, broadcast_id=bid)}
    except PermissionError:
        raise _err(403, "owner_only", "Owner only.")
    except ValueError as e:
        raise _err(400, str(e), str(e))


@router.post("/broadcasts/{bid}/retry-failed")
async def retry_failed(bid: str, user=Depends(require_user)):
    try:
        return await _b.retry_failed(db, actor=user, broadcast_id=bid)
    except PermissionError:
        raise _err(403, "owner_only", "Owner only.")
    except ValueError as e:
        raise _err(400, str(e), str(e))


# ── Analytics ──────────────────────────────────────────────────

@router.get("/broadcasts/{bid}/analytics")
async def analytics(bid: str, user=Depends(require_user)):
    if not _b._is_staff(user):
        raise _err(403, "staff_only", "Staff only.")
    try:
        return await _b.broadcast_analytics(db, broadcast_id=bid)
    except ValueError as e:
        raise _err(404, str(e), str(e))
