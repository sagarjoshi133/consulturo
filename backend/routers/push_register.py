"""
Push device registration endpoint per the Emergent Push playbook.

Devices call this endpoint after fetching a native FCM/APNs token
via `Notifications.getDevicePushTokenAsync()`.  The backend mirrors
the token row into our DB (for diagnostics + cleanup) AND forwards
it to the Emergent Push relay so upstream resolves user_id → token
itself at send time.

The legacy endpoint `/api/push/register` (Expo-token based) lives on
in `server.py` and is now a thin shim that also calls this relay so
both paths keep working during the transition.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from server import db, get_current_user
from services.push_relay import register_device, send_push

router = APIRouter()


class RegisterPushBody(BaseModel):
    user_id: Optional[str] = None  # Optional — server prefers auth context
    platform: str
    device_token: str


@router.post("/api/register-push", status_code=200)
async def register_push(
    body: RegisterPushBody,
    request: Request,
    user=Depends(get_current_user),
):
    """Register a *native* FCM/APNs push token with the Emergent relay.

    Auth-context wins: if the caller is signed in, we ignore the body's
    `user_id` and use the authenticated user_id. This prevents a
    misbehaving client from claiming tokens for someone else.
    """
    if user and (user.get("user_id") or user.get("id")):
        uid = user.get("user_id") or user.get("id")
    elif body.user_id:
        uid = body.user_id
    else:
        raise HTTPException(status_code=401, detail="Authentication required to register a push token")

    platform = (body.platform or "android").lower()
    token = (body.device_token or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="device_token is required")

    # Persist locally for diagnostics + duplicate cleanup. Even though
    # the Emergent relay holds the canonical store, we keep a mirror so
    # the in-app "Notifications Health" panel can still show registered
    # devices and we can purge stale rows from the dashboard.
    now = datetime.now(timezone.utc)
    user_doc = await db.users.find_one({"user_id": uid}, {"_id": 0, "email": 1, "phone": 1, "role": 1}) or {}
    row = {
        "id": str(uuid.uuid4()),
        "user_id": uid,
        "email": user_doc.get("email"),
        "phone": user_doc.get("phone"),
        "role": user_doc.get("role"),
        "platform": platform,
        "device_token": token,
        "transport": "emergent_native",
        "updated_at": now,
    }
    # Upsert by (user_id, device_token) — same device re-registering
    # on app open shouldn't proliferate rows. Different devices
    # belonging to the same user get separate rows (one per token).
    await db.push_tokens.update_one(
        {"user_id": uid, "device_token": token},
        {"$set": row, "$setOnInsert": {"created_at": now}},
        upsert=True,
    )

    # Forward to the Emergent relay so it knows where to deliver.
    relay_result = await register_device(uid, platform, token)
    return {"registered": True, "user_id": uid, "relay": relay_result}


# ── Lightweight diagnostic ─────────────────────────────────────────

class TestPushBody(BaseModel):
    title: Optional[str] = None
    body: Optional[str] = None


@router.post("/api/push/test-self")
async def push_test_self(body: TestPushBody, user=Depends(get_current_user)):
    """Send a test push to the signed-in user — used by the
    Notifications Health panel to confirm end-to-end delivery."""
    if not user or not (user.get("user_id") or user.get("id")):
        raise HTTPException(status_code=401, detail="Sign in to send a test push")
    uid = user.get("user_id") or user.get("id")
    res = await send_push(
        recipients=[uid],
        data={
            "title": (body.title or "ConsultUro test").strip(),
            "message": (body.body or "If you can see this, push delivery is working ✅").strip(),
            "kind": "test",
        },
        kind="test",
    )
    return {"ok": res.get("ok"), "result": res}


# ── Public-but-auth-gated relay status ─────────────────────────────
# Lets ANY signed-in user (not just owners) confirm whether the
# Emergent push relay was activated by the deployer for THIS backend
# instance. Used by the Notifications Health panel so the user can
# immediately tell when "bell works but device tray stays empty"
# is caused by EMERGENT_PUSH_KEY still being the placeholder.
#
# We deliberately do NOT return the key — only whether it's set.
@router.get("/api/push/status")
async def push_status(user=Depends(get_current_user)):
    from services.push_relay import is_configured as _relay_on
    uid = (user or {}).get("user_id") or (user or {}).get("id") if user else None
    rows = 0
    if uid:
        try:
            rows = await db.push_tokens.count_documents({"user_id": uid})
        except Exception:
            rows = 0
    return {
        "relay_configured": bool(_relay_on()),
        "your_devices_registered": rows,
        "message": (
            "Push relay is LIVE — pushes will reach the device tray."
            if _relay_on()
            else "Push relay is NOT configured for this backend "
                 "(EMERGENT_PUSH_KEY is still 'placeholder'). "
                 "Click Publish → Deploy in the editor and the key "
                 "will be injected automatically. Re-install your APK "
                 "after the deploy succeeds."
        ),
    }
