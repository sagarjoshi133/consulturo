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

from auth_deps import OWNER_TIER_ROLES
from server import db, get_current_user
from services.push_relay import register_device, send_push

router = APIRouter()


class RegisterPushBody(BaseModel):
    user_id: Optional[str] = None  # Optional — server prefers auth context
    platform: str
    device_token: str
    # Phase A: stable per-install UUID generated on the device. Lets the
    # backend dedupe rows when the FCM token rotates for the same install.
    installation_id: Optional[str] = None


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
        raise HTTPException(status_code=400, detail={
            "error_code": "invalid_token",
            "message": "device_token is required",
        })

    # Persist locally for diagnostics + duplicate cleanup. Even though
    # the Emergent relay holds the canonical store, we keep a mirror so
    # the in-app "Notifications Health" panel can still show registered
    # devices and we can purge stale rows from the dashboard.
    now = datetime.now(timezone.utc)
    install_id = (body.installation_id or "").strip() or None
    user_doc = await db.users.find_one({"user_id": uid}, {"_id": 0, "email": 1, "phone": 1, "role": 1}) or {}
    row = {
        "id": str(uuid.uuid4()),
        "user_id": uid,
        "email": user_doc.get("email"),
        "phone": user_doc.get("phone"),
        "role": user_doc.get("role"),
        "platform": platform,
        "device_token": token,
        "installation_id": install_id,
        "transport": "emergent_native",
        "updated_at": now,
    }
    if install_id:
        # Phase A: upsert by (user_id, installation_id) — when the FCM
        # token rotates for the SAME install, the row is replaced rather
        # than duplicated. Then drop any legacy row holding the same
        # token under a different / missing installation_id.
        await db.push_tokens.update_one(
            {"user_id": uid, "installation_id": install_id},
            {"$set": row, "$setOnInsert": {"created_at": now}},
            upsert=True,
        )
        await db.push_tokens.delete_many(
            {"user_id": uid, "device_token": token,
             "installation_id": {"$ne": install_id}},
        )
    else:
        # Legacy clients (pre installation_id): upsert by (user_id, token).
        await db.push_tokens.update_one(
            {"user_id": uid, "device_token": token},
            {"$set": row, "$setOnInsert": {"created_at": now}},
            upsert=True,
        )

    # Forward to the Emergent relay so it knows where to deliver.
    relay_result = await register_device(uid, platform, token)
    if relay_result.get("registered"):
        return {"registered": True, "user_id": uid, "relay": relay_result}

    # ── Phase A: typed non-2xx errors ────────────────────────────────
    # The token IS mirrored locally (startup/manual resync will forward
    # it once the relay comes online), but we no longer lie with a 200:
    # the client surfaces the exact failure in the Notifications Health
    # panel instead of showing "Registered ✓" while the tray stays empty.
    reason = relay_result.get("reason")
    if reason == "no_emergent_key":
        raise HTTPException(status_code=503, detail={
            "error_code": "relay_not_configured",
            "message": (
                "Push relay key not configured (preview environment). "
                "The token was saved and will auto-resync after Publish → Deploy."
            ),
            "mirrored": True,
        })
    if reason == "unauthorized":
        raise HTTPException(status_code=502, detail={
            "error_code": "relay_unauthorized",
            "message": "The push relay rejected our credentials (HTTP 401). Redeploy to refresh the key.",
            "mirrored": True,
        })
    raise HTTPException(status_code=502, detail={
        "error_code": "relay_upstream_error",
        "message": "The push relay could not register this device. It will be retried by the next resync.",
        "relay_status": relay_result.get("status"),
        "mirrored": True,
    })


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
    """One-stop push diagnostic. Shows, in a single response:
      1. relay_configured   — was the real EMERGENT_PUSH_KEY injected?
      2. your_devices       — mirrored device rows for the caller
      3. your_recent_registrations — did the relay ACCEPT the tokens?
      4. last_resync        — outcome of the startup token resync
      5. recent_send_errors — (owner-tier only) why recent sends failed
      6. next_step          — plain-English guidance on what to fix
    """
    from services.push_relay import is_configured as _relay_on
    relay_on = bool(_relay_on())
    uid = (user or {}).get("user_id") or (user or {}).get("id") if user else None

    out: dict = {"relay_configured": relay_on}

    # ── Caller's devices + relay registration outcomes ──────────────
    devices: list = []
    reg_log: list = []
    if uid:
        try:
            async for t in db.push_tokens.find({"user_id": uid}, {"_id": 0}).limit(10):
                devices.append({
                    "platform": t.get("platform"),
                    "transport": t.get("transport") or ("expo" if t.get("token") else "emergent_native"),
                    "token_preview": (t.get("device_token") or t.get("token") or "")[:24] + "…",
                    "updated_at": t.get("updated_at"),
                })
        except Exception:
            pass
        try:
            async for r in db.push_register_log.find(
                {"user_id": uid}, {"_id": 0, "platform": 1, "ok": 1,
                                   "status_code": 1, "created_at": 1},
            ).sort("created_at", -1).limit(5):
                reg_log.append(r)
        except Exception:
            pass
    out["your_devices_registered"] = len(devices)
    out["your_devices"] = devices
    out["your_recent_registrations"] = reg_log

    # ── Last startup resync outcome ─────────────────────────────────
    try:
        last_resync = await db.push_resync_log.find_one(
            {}, {"_id": 0, "total_rows": 1, "resynced": 1, "errors": 1, "at": 1},
            sort=[("at", -1)],
        )
        out["last_resync"] = last_resync
    except Exception:
        out["last_resync"] = None

    # ── Recent send errors (owner-tier only — titles can be private) ─
    role = (user or {}).get("role") if user else None
    if role in OWNER_TIER_ROLES:
        try:
            errs: list = []
            async for row in db.push_log.find(
                {"errors": {"$ne": []}},
                {"_id": 0, "data_type": 1, "total": 1, "sent": 1,
                 "errors": 1, "note": 1, "created_at": 1},
            ).sort("created_at", -1).limit(5):
                errs.append(row)
            out["recent_send_errors"] = errs
        except Exception:
            out["recent_send_errors"] = []

    # ── Plain-English next step ─────────────────────────────────────
    if not relay_on:
        next_step = (
            "EMERGENT_PUSH_KEY is still 'placeholder' — the backend cannot "
            "deliver device pushes. Click Publish → Deploy; the key is "
            "injected automatically during deploy."
        )
    elif not devices:
        next_step = (
            "Relay is LIVE but no device is registered for your account. "
            "Install the latest APK (built AFTER push support was added), "
            "open it, sign in and grant notification permission."
        )
    elif reg_log and not reg_log[0].get("ok"):
        next_step = (
            f"Your last device registration was REJECTED by the relay "
            f"(HTTP {reg_log[0].get('status_code')}). Contact support if "
            "this persists after a fresh deploy."
        )
    else:
        next_step = (
            "Everything looks healthy. Use the 'Send test push' button — "
            "if it still doesn't arrive, check recent_send_errors (owner) "
            "or battery-saver / notification settings on the device."
        )
    out["next_step"] = next_step
    out["message"] = next_step  # backwards compat with the old shape
    return out


@router.post("/api/push/resync")
async def push_resync(user=Depends(get_current_user)):
    """Owner-triggered relay resync: re-forward every mirrored device
    token to the Emergent relay. Same routine that runs on startup —
    exposed so an owner can force it right after a deploy without
    restarting the backend."""
    role = (user or {}).get("role") if user else None
    if role not in OWNER_TIER_ROLES:
        raise HTTPException(status_code=403, detail="Owner access required")
    from services.push_relay import resync_devices_to_relay
    res = await resync_devices_to_relay()
    res.pop("_id", None)
    return res
