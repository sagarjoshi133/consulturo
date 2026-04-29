"""ConsultUro — Clinic invitations router.

Phase D of the multi-tenant rollout. Lets a clinic's primary_owner /
super_owner invite teammates by email. The invitee receives a magic
link `/invite/<token>` which, upon being opened by an authenticated
user (signing in if needed), auto-creates their `clinic_membership`.

Endpoints:
 • POST /api/clinics/{clinic_id}/invitations   — create + email invite
 • GET  /api/clinics/{clinic_id}/invitations   — list pending invites
 • DELETE /api/invitations/{token}             — revoke an invite
 • GET  /api/invitations/{token}               — public preview (clinic
                                                  name, role, expiry).
                                                  Used by the /invite
                                                  landing page BEFORE
                                                  the user signs in.
 • POST /api/invitations/{token}/accept        — auth-required: attach
                                                  signed-in user to the
                                                  clinic, mark invite
                                                  consumed.

Tokens are 32-char URL-safe random strings stored in
`clinic_invitations` collection. Each invite has a 14-day expiry,
single-use, and is revocable.
"""
from __future__ import annotations

import os
import secrets
import time
import uuid
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field

from auth_deps import is_super_owner, require_user
from db import db
from services.email import _send_email
from services.tenancy import (
    CLINIC_ROLES,
    MEMBERSHIPS_COLL,
    get_clinic_by_id,
    upsert_membership,
)

router = APIRouter()

INVITES_COLL = "clinic_invitations"
INVITE_EXPIRY_DAYS = 14


def _now_ms() -> int:
    return int(time.time() * 1000)


def _uid(user: Dict[str, Any]) -> str:
    return user.get("user_id") or user.get("id") or ""


def _public_url() -> str:
    """Where to send the invitee. Reads EXPO_PUBLIC_BACKEND_URL (the
    same domain serves /invite/<token> via Expo Router) and falls back
    to the production host."""
    return (
        os.environ.get("PUBLIC_FRONTEND_URL")
        or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
        or "https://urology-pro.emergent.host"
    ).rstrip("/")


async def _require_clinic_admin(user: Dict[str, Any], clinic_id: str) -> Dict[str, Any]:
    clinic = await get_clinic_by_id(clinic_id)
    if not clinic:
        raise HTTPException(status_code=404, detail="Clinic not found")
    if is_super_owner(user):
        return clinic
    if clinic.get("primary_owner_id") != _uid(user):
        raise HTTPException(
            status_code=403,
            detail="Only the clinic's primary owner can manage invitations.",
        )
    return clinic


# ── Bodies ──────────────────────────────────────────────────────────────
class CreateInviteBody(BaseModel):
    email: EmailStr
    role: str = Field("doctor", description="Clinic role for the invitee")
    note: Optional[str] = Field(None, description="Free-form text shown in the email")


# ── Endpoints ───────────────────────────────────────────────────────────
@router.post("/api/clinics/{clinic_id}/invitations", status_code=201)
async def create_invitation(
    clinic_id: str,
    body: CreateInviteBody,
    user=Depends(require_user),
) -> Dict[str, Any]:
    clinic = await _require_clinic_admin(user, clinic_id)
    if body.role not in CLINIC_ROLES:
        raise HTTPException(status_code=400, detail=f"Invalid role: {body.role}")

    email_lc = str(body.email).strip().lower()

    # If a non-revoked invite for the same email already exists, reuse
    # it — don't spam the inbox with duplicates.
    existing = await db[INVITES_COLL].find_one(
        {
            "clinic_id": clinic_id,
            "email": email_lc,
            "status": "pending",
        },
        {"_id": 0},
    )
    if existing and existing.get("expires_at", 0) > _now_ms():
        token = existing["token"]
    else:
        token = secrets.token_urlsafe(24).replace("-", "").replace("_", "")[:32]
        doc = {
            "invitation_id": f"inv_{uuid.uuid4().hex[:12]}",
            "token": token,
            "clinic_id": clinic_id,
            "email": email_lc,
            "role": body.role,
            "note": (body.note or "").strip(),
            "invited_by": _uid(user),
            "created_at": _now_ms(),
            "expires_at": _now_ms() + INVITE_EXPIRY_DAYS * 86_400_000,
            "status": "pending",  # pending | accepted | revoked | expired
            "consumed_by": None,
            "consumed_at": None,
        }
        await db[INVITES_COLL].insert_one(doc)

    # ── Send email ─────────────────────────────────────────────────────
    accept_url = f"{_public_url()}/invite/{token}"
    role_pretty = body.role.replace("_", " ").title()
    inviter_name = user.get("name") or user.get("email") or "your colleague"
    note_html = (
        f"<blockquote style=\"border-left:3px solid #1FA1B7;padding:10px 14px;color:#1A2E35;background:#F4F8FB\"><i>{(body.note or '').strip()}</i></blockquote>"
        if body.note
        else ""
    )
    html = f"""
        <div style="font-family:-apple-system,Helvetica,Arial,sans-serif;color:#1A2E35;max-width:480px;margin:0 auto;padding:24px">
          <h2 style="color:#0F4C75;margin:0 0 8px">You're invited to join {clinic['name']}</h2>
          <p style="color:#4A5A66;margin:0 0 16px"><b>{inviter_name}</b> has invited you to join their clinic on ConsultUro as a <b>{role_pretty}</b>.</p>
          {note_html}
          <p style="margin:20px 0">Click the button below within {INVITE_EXPIRY_DAYS} days to accept:</p>
          <p style="text-align:center;margin:24px 0">
            <a href="{accept_url}" style="background:#0F4C75;color:#fff;padding:12px 24px;border-radius:24px;text-decoration:none;font-weight:700">Accept invitation</a>
          </p>
          <p style="color:#7A8A98;font-size:12px;margin-top:24px">If the button doesn't work, paste this link into your browser:<br/>{accept_url}</p>
        </div>
    """
    try:
        _send_email(
            to=email_lc,
            subject=f"You're invited to join {clinic['name']} on ConsultUro",
            html=html,
        )
    except Exception as e:  # noqa: BLE001
        # Don't fail the API call if email transport is down — the
        # token is still valid and the link can be shared manually.
        print(f"[invitations] email send failed for {email_lc}: {e}")

    return {"ok": True, "token": token, "accept_url": accept_url}


@router.get("/api/clinics/{clinic_id}/invitations")
async def list_invitations(
    clinic_id: str, user=Depends(require_user)
) -> Dict[str, Any]:
    await _require_clinic_admin(user, clinic_id)
    cursor = db[INVITES_COLL].find(
        {"clinic_id": clinic_id, "status": {"$in": ["pending", "accepted"]}},
        {"_id": 0},
    ).sort("created_at", -1)
    return {"invitations": await cursor.to_list(length=200)}


@router.delete("/api/invitations/{token}")
async def revoke_invitation(token: str, user=Depends(require_user)) -> Dict[str, Any]:
    inv = await db[INVITES_COLL].find_one({"token": token}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Invitation not found")
    await _require_clinic_admin(user, inv["clinic_id"])
    if inv["status"] != "pending":
        raise HTTPException(status_code=400, detail=f"Cannot revoke a {inv['status']} invitation")
    await db[INVITES_COLL].update_one(
        {"token": token},
        {"$set": {"status": "revoked", "revoked_at": _now_ms(), "revoked_by": _uid(user)}},
    )
    return {"ok": True}


@router.get("/api/invitations/{token}")
async def preview_invitation(token: str) -> Dict[str, Any]:
    """PUBLIC endpoint — used by /invite/<token> landing page BEFORE
    the user has signed in. Returns clinic name + role only."""
    inv = await db[INVITES_COLL].find_one({"token": token}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Invitation not found")
    if inv["status"] == "revoked":
        raise HTTPException(status_code=410, detail="This invitation has been revoked.")
    if inv["status"] == "accepted":
        raise HTTPException(status_code=410, detail="This invitation has already been accepted.")
    if inv["expires_at"] < _now_ms():
        # Lazy mark as expired so list_invitations reflects accurate state.
        await db[INVITES_COLL].update_one(
            {"token": token}, {"$set": {"status": "expired"}}
        )
        raise HTTPException(status_code=410, detail="This invitation has expired.")
    clinic = await get_clinic_by_id(inv["clinic_id"])
    if not clinic:
        raise HTTPException(status_code=404, detail="Associated clinic not found")
    return {
        "clinic": {
            "clinic_id": clinic["clinic_id"],
            "slug": clinic["slug"],
            "name": clinic["name"],
            "tagline": clinic.get("tagline", ""),
        },
        "email": inv["email"],
        "role": inv["role"],
        "note": inv.get("note", ""),
        "expires_at": inv["expires_at"],
    }


@router.post("/api/invitations/{token}/accept")
async def accept_invitation(token: str, user=Depends(require_user)) -> Dict[str, Any]:
    """Accept the invitation as the currently-signed-in user. The
    user's email does NOT have to match the invite — that's a UX
    choice (maybe they signed in with a different Google account); we
    add a warning to the response so the UI can confirm with the user.
    """
    inv = await db[INVITES_COLL].find_one({"token": token}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Invitation not found")
    if inv["status"] != "pending":
        raise HTTPException(status_code=410, detail=f"Invitation is {inv['status']}")
    if inv["expires_at"] < _now_ms():
        await db[INVITES_COLL].update_one(
            {"token": token}, {"$set": {"status": "expired"}}
        )
        raise HTTPException(status_code=410, detail="This invitation has expired.")

    # Create the membership.
    user_id = _uid(user)
    clinic_id = inv["clinic_id"]
    role = inv["role"]
    membership = await upsert_membership(
        user_id=user_id,
        clinic_id=clinic_id,
        role=role,
        invited_by=inv.get("invited_by"),
        is_active=True,
    )

    # Mark invite consumed.
    await db[INVITES_COLL].update_one(
        {"token": token},
        {
            "$set": {
                "status": "accepted",
                "consumed_by": user_id,
                "consumed_at": _now_ms(),
            }
        },
    )

    email_mismatch = (user.get("email") or "").strip().lower() != inv["email"]
    return {
        "ok": True,
        "clinic_id": clinic_id,
        "role": role,
        "membership": membership,
        "email_mismatch": email_mismatch,
    }
