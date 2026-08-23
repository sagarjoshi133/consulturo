"""Comm V2 messaging endpoints.

    GET  /api/v2/communications/conversations
    GET  /api/v2/communications/conversations/{id}/messages
    POST /api/v2/communications/conversations/{id}/messages
    POST /api/v2/communications/messages/{id}/read
    POST /api/v2/communications/conversations/{id}/assign
    POST /api/v2/communications/conversations/{id}/escalate
    POST /api/v2/communications/conversations/{id}/resolve
    POST /api/v2/communications/conversations/{id}/reopen

Auth rules baked into services.comm_messaging:
  - Patient: only their own conversation.
  - Staff / owner-tier: any conversation.
  - Assign / escalate / resolve / reopen: staff-only.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field

from server import db, require_user
from services import comm_messaging as _m

router = APIRouter(prefix="/api/v2/communications", tags=["communications-v2-messaging"])


# ── Conversation list & get-or-create ───────────────────────────

@router.get("/conversations")
async def list_conversations(
    limit: int = Query(30, ge=1, le=100),
    cursor: Optional[str] = None,
    state: Optional[str] = None,
    unread_only: bool = False,
    search: Optional[str] = Query(None, max_length=80),
    user=Depends(require_user),
) -> Dict[str, Any]:
    # Patients get their conversation auto-created on first GET so the
    # UI never renders an "empty" state before the first message.
    if user.get("role") == "patient":
        await _m.get_or_create_clinic_conversation(
            db, patient_user_id=user.get("user_id") or user.get("id"),
        )
    return await _m.list_conversations(
        db, user=user, limit=limit, cursor=cursor, state=state,
        unread_only=bool(unread_only), search=search,
    )


class GetOrCreateConvBody(BaseModel):
    patient_user_id: Optional[str] = None


@router.post("/conversations/get-or-create")
async def get_or_create_conv(
    body: GetOrCreateConvBody = Body(default_factory=GetOrCreateConvBody),
    user=Depends(require_user),
) -> Dict[str, Any]:
    """Patients: creates own. Staff: may supply patient_user_id to open
    a conversation with a specific patient. Idempotent."""
    role = (user or {}).get("role")
    if role == "patient":
        pid = user.get("user_id") or user.get("id")
    else:
        pid = (body.patient_user_id or "").strip()
        if not pid:
            raise HTTPException(400, "patient_user_id required for staff")
        # Verify patient exists.
        p = await db.users.find_one({"user_id": pid, "role": "patient"},
                                      {"_id": 0, "user_id": 1})
        if not p:
            raise HTTPException(404, "patient_not_found")
    conv = await _m.get_or_create_clinic_conversation(db, patient_user_id=pid)
    return {"conversation": conv}


# ── Messages: list & send ───────────────────────────────────────

@router.get("/conversations/{conv_id}/messages")
async def list_messages(
    conv_id: str,
    limit: int = Query(40, ge=1, le=100),
    cursor: Optional[str] = None,
    user=Depends(require_user),
) -> Dict[str, Any]:
    try:
        return await _m.list_messages(db, user=user, conversation_id=conv_id,
                                        limit=limit, cursor=cursor)
    except PermissionError:
        raise HTTPException(403, "forbidden")
    except ValueError as e:
        raise HTTPException(404, str(e))


class SendMessageBody(BaseModel):
    body: str = Field(..., min_length=1, max_length=4000)
    reply_to_message_id: Optional[str] = None
    # Body-level idempotency-key fallback for clients that can't set
    # arbitrary headers (Expo Go web preview quirks). Header wins.
    idempotency_key: Optional[str] = Field(None, min_length=4, max_length=100)


@router.post("/conversations/{conv_id}/messages")
async def send_message(
    conv_id: str,
    body: SendMessageBody,
    idempotency_key_header: Optional[str] = Header(None, alias="Idempotency-Key"),
    user=Depends(require_user),
) -> Dict[str, Any]:
    key = (idempotency_key_header or body.idempotency_key or "").strip()
    if not key:
        raise HTTPException(400, {"error_code": "missing_idempotency_key",
                                     "message": "Set Idempotency-Key header or body.idempotency_key"})
    try:
        result = await _m.send_message(
            db, user=user, conversation_id=conv_id, body=body.body,
            idempotency_key=key, reply_to_message_id=body.reply_to_message_id,
        )
        return result
    except PermissionError:
        raise HTTPException(403, "forbidden")
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/messages/{msg_id}/read")
async def mark_message_read(
    msg_id: str,
    user=Depends(require_user),
) -> Dict[str, Any]:
    try:
        return await _m.mark_message_read(db, user=user, message_id=msg_id)
    except PermissionError:
        raise HTTPException(403, "forbidden")
    except ValueError as e:
        raise HTTPException(404, str(e))


# ── State-machine actions ──────────────────────────────────────

class AssignBody(BaseModel):
    assignee_user_id: Optional[str] = None  # None = unassign


@router.post("/conversations/{conv_id}/assign")
async def assign(
    conv_id: str,
    body: AssignBody = Body(default_factory=AssignBody),
    user=Depends(require_user),
) -> Dict[str, Any]:
    try:
        conv = await _m.assign_conversation(
            db, conv_id=conv_id, assignee_user_id=body.assignee_user_id, actor=user,
        )
        return {"conversation": conv}
    except PermissionError as e:
        raise HTTPException(403, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/conversations/{conv_id}/escalate")
async def escalate(conv_id: str, user=Depends(require_user)) -> Dict[str, Any]:
    try:
        conv = await _m.escalate_to_doctor(db, conv_id=conv_id, actor=user)
        return {"conversation": conv}
    except PermissionError as e:
        raise HTTPException(403, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/conversations/{conv_id}/resolve")
async def resolve(conv_id: str, user=Depends(require_user)) -> Dict[str, Any]:
    try:
        conv = await _m.resolve_conversation(db, conv_id=conv_id, actor=user)
        return {"conversation": conv}
    except PermissionError as e:
        raise HTTPException(403, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/conversations/{conv_id}/reopen")
async def reopen(conv_id: str, user=Depends(require_user)) -> Dict[str, Any]:
    try:
        conv = await _m.reopen_conversation(db, conv_id=conv_id, actor=user)
        return {"conversation": conv}
    except PermissionError as e:
        raise HTTPException(403, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
