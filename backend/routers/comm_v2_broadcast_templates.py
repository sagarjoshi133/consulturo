"""Comm V2 — Broadcast Templates endpoints.

  GET    /api/v2/communications/broadcast-templates
  POST   /api/v2/communications/broadcast-templates                   (owner-tier)
  GET    /api/v2/communications/broadcast-templates/{id}
  PATCH  /api/v2/communications/broadcast-templates/{id}              (owner-tier)
  DELETE /api/v2/communications/broadcast-templates/{id}              (owner-tier — soft delete)
  POST   /api/v2/communications/broadcast-templates/{id}/apply        (staff — creates draft)
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from server import db, require_user
from services import comm_broadcast_templates as _t

router = APIRouter(prefix="/api/v2/communications",
                     tags=["communications-v2-broadcast-templates"])


def _err(status: int, code: str, msg: str) -> HTTPException:
    return HTTPException(status_code=status,
                          detail={"error_code": code, "message": msg})


# ── Models ─────────────────────────────────────────────────────

class CreateTemplateBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    title: str = Field(..., min_length=1, max_length=200)
    body: str = Field(..., min_length=1, max_length=4000)
    category: str = Field("announcements",
        pattern="^(appointments|announcements|reminders|system|marketing)$")
    audience_mode: str = Field("patients",
        pattern="^(patients|staff|both|selected_patients|patients_with_future_appointments)$")
    action_type: str = Field("open_broadcast",
        pattern="^(open_broadcast|open_home|open_booking|open_notice|none)$")
    selected_patient_user_ids: Optional[List[str]] = None


class UpdateTemplateBody(BaseModel):
    name: Optional[str] = None
    title: Optional[str] = None
    body: Optional[str] = None
    category: Optional[str] = None
    audience_mode: Optional[str] = None
    action_type: Optional[str] = None
    selected_patient_user_ids: Optional[List[str]] = None
    is_active: Optional[bool] = None


class ApplyTemplateBody(BaseModel):
    """All fields optional — anything absent inherits from the template."""
    title: Optional[str] = None
    body: Optional[str] = None
    category: Optional[str] = None
    audience_mode: Optional[str] = None
    action_type: Optional[str] = None
    selected_patient_user_ids: Optional[List[str]] = None
    scheduled_at: Optional[datetime] = None


# ── Endpoints ──────────────────────────────────────────────────

@router.get("/broadcast-templates")
async def list_templates(
    limit: int = Query(30, ge=1, le=100),
    cursor: Optional[str] = None,
    category: Optional[str] = Query(None,
        pattern="^(appointments|announcements|reminders|system|marketing)$"),
    include_inactive: bool = Query(False),
    search: Optional[str] = Query(None, max_length=80),
    user=Depends(require_user),
):
    try:
        return await _t.list_templates(
            db, actor=user, limit=limit, cursor=cursor,
            category=category, include_inactive=include_inactive,
            search=search,
        )
    except PermissionError:
        raise _err(403, "staff_only", "Staff only.")


@router.get("/broadcast-templates/{tid}")
async def get_template(tid: str, user=Depends(require_user)):
    if not _t._is_staff(user):
        raise _err(403, "staff_only", "Staff only.")
    t = await _t.get_template(db, tid)
    if not t:
        raise _err(404, "template_not_found", "Template not found.")
    return {"template": t}


@router.post("/broadcast-templates")
async def create_template(body: CreateTemplateBody, user=Depends(require_user)):
    try:
        doc = await _t.create_template(
            db, actor=user,
            name=body.name, title=body.title, body=body.body,
            category=body.category, audience_mode=body.audience_mode,
            action_type=body.action_type,
            selected_patient_user_ids=body.selected_patient_user_ids,
        )
        return {"template": doc}
    except PermissionError:
        raise _err(403, "owner_only", "Only owner-tier can create templates.")
    except ValueError as e:
        raise _err(400, str(e), str(e))


@router.patch("/broadcast-templates/{tid}")
async def update_template(tid: str, body: UpdateTemplateBody,
                            user=Depends(require_user)):
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    try:
        doc = await _t.update_template(db, actor=user, template_id=tid,
                                          fields=fields)
        return {"template": doc}
    except PermissionError:
        raise _err(403, "owner_only", "Only owner-tier can edit templates.")
    except ValueError as e:
        raise _err(400, str(e), str(e))


@router.delete("/broadcast-templates/{tid}")
async def delete_template(tid: str, user=Depends(require_user)):
    try:
        ok = await _t.delete_template(db, actor=user, template_id=tid)
        if not ok:
            raise _err(404, "template_not_found",
                        "Template not found or already inactive.")
        return {"ok": True}
    except PermissionError:
        raise _err(403, "owner_only", "Only owner-tier can delete templates.")


@router.post("/broadcast-templates/{tid}/apply")
async def apply_template(tid: str, body: ApplyTemplateBody,
                           user=Depends(require_user)):
    overrides = {k: v for k, v in body.model_dump().items() if v is not None}
    try:
        draft = await _t.create_draft_from_template(
            db, actor=user, template_id=tid, overrides=overrides,
        )
        return {"broadcast": draft, "template_id": tid}
    except PermissionError:
        raise _err(403, "staff_only", "Staff only.")
    except ValueError as e:
        raise _err(400, str(e), str(e))
