"""Comm V2 Home Notice endpoints."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel, Field

from server import db, require_user, require_owner
from services import comm_home_notices as _n

router = APIRouter(prefix="/api/v2/communications", tags=["communications-v2-notices"])


# ── Public (any authenticated user) ─────────────────────────────

@router.get("/home-notices/active")
async def active_notices(user=Depends(require_user)) -> Dict[str, Any]:
    items = await _n.list_active_for_user(db, user=user)
    return {"items": items, "count": len(items)}


class DismissBody(BaseModel):
    pass


@router.post("/home-notices/{notice_id}/dismiss")
async def dismiss(notice_id: str, user=Depends(require_user)) -> Dict[str, Any]:
    uid = user.get("user_id") or user.get("id")
    try:
        ok = await _n.dismiss_notice(db, notice_id=notice_id, user_id=uid)
        return {"ok": ok}
    except PermissionError:
        raise HTTPException(403, {"error_code": "not_dismissible",
                                     "message": "This notice cannot be dismissed."})
    except ValueError as e:
        raise HTTPException(404, str(e))


# ── Owner-only admin ────────────────────────────────────────────

class NoticeBody(BaseModel):
    message: str = Field(..., min_length=1, max_length=400)
    audience_scope: str = Field(..., pattern="^(patients|staff|both)$")
    notice_style: str = Field(..., pattern="^(information|warning|urgent|success)$")
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None
    is_active: bool = True
    is_dismissible: bool = True
    action_type: str = "none"
    action_target: Optional[str] = None


@router.get("/admin/home-notices")
async def admin_list(user=Depends(require_owner)) -> Dict[str, Any]:
    return await _n.list_admin(db)


@router.post("/admin/home-notices")
async def admin_create(body: NoticeBody, user=Depends(require_owner)) -> Dict[str, Any]:
    try:
        doc = await _n.create_notice(
            db, actor=user, message=body.message,
            audience_scope=body.audience_scope, notice_style=body.notice_style,
            starts_at=body.starts_at, ends_at=body.ends_at,
            is_active=body.is_active, is_dismissible=body.is_dismissible,
            action_type=body.action_type, action_target=body.action_target,
        )
        return {"notice": doc}
    except ValueError as e:
        raise HTTPException(400, str(e))


class NoticePatchBody(BaseModel):
    message: Optional[str] = None
    audience_scope: Optional[str] = None
    notice_style: Optional[str] = None
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None
    is_active: Optional[bool] = None
    is_dismissible: Optional[bool] = None
    action_type: Optional[str] = None
    action_target: Optional[str] = None


@router.patch("/admin/home-notices/{notice_id}")
async def admin_update(notice_id: str, body: NoticePatchBody,
                        user=Depends(require_owner)) -> Dict[str, Any]:
    try:
        doc = await _n.update_notice(db, actor=user, notice_id=notice_id,
                                        fields=body.model_dump())
        if not doc:
            raise HTTPException(404, "notice_not_found")
        return {"notice": doc}
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.delete("/admin/home-notices/{notice_id}")
async def admin_delete(notice_id: str, user=Depends(require_owner)) -> Dict[str, Any]:
    ok = await _n.delete_notice(db, notice_id=notice_id)
    return {"ok": ok}
