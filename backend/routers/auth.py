"""ConsultUro — auth router.

  · /api/auth/session
  · /api/auth/handoff/init
  · /api/auth/handoff/{handoff_id}
  · /api/auth/me
  · /api/auth/magic/request
  · /api/auth/magic/exchange
  · /api/auth/otp/request
  · /api/auth/otp/verify
  · /api/auth/firebase-phone/verify
  · /api/auth/link-phone
  · /api/auth/link-email/request
  · /api/auth/link-email/verify
  · /api/auth/logout
  · /auth-callback
  · /auth-callback/{handoff_id}
  · /auth/magic/redirect

Extracted from server.py during Phase 3 modularization.
Behaviour preserved EXACTLY.
"""
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional
import uuid
import re
import os
from fastapi import APIRouter, Depends, HTTPException, Header, Request, Response
from fastapi.responses import HTMLResponse, JSONResponse
from db import db
from auth_deps import require_user
from models import FirebasePhoneVerifyBody, HandoffInitBody, LinkEmailBody, LinkEmailVerifyBody, LinkPhoneBody, MagicExchangeBody, MagicRequestBody, MyProfileBody, OtpRequestBody, OtpVerifyBody, SessionExchangeBody
from server import Cookie, EMERGENT_AUTH_URL, FIREBASE_API_KEY, _build_auth_callback_response, _ensure_user_for_email, _secrets, _send_email, httpx, limiter, resolve_role_for_email

router = APIRouter()


@router.get("/auth-callback")
async def auth_callback_bridge(request: Request):
    return _build_auth_callback_response(handoff_id_from_path="")

@router.get("/auth-callback/{handoff_id}")
async def auth_callback_bridge_with_handoff(handoff_id: str, request: Request):
    """Path-based variant — handoff_id is encoded in the URL path so it
    survives Emergent Auth's redirect handling (which sometimes strips
    fragments / appends query params and clobbers our state).
    """
    return _build_auth_callback_response(handoff_id_from_path=handoff_id or "")

@router.post("/api/auth/session")
@limiter.limit("20/minute")
async def auth_session(request: Request, body: SessionExchangeBody, response: Response):
    async with httpx.AsyncClient(timeout=10.0) as hc:
        r = await hc.get(EMERGENT_AUTH_URL, headers={"X-Session-ID": body.session_id})
        if r.status_code != 200:
            raise HTTPException(status_code=401, detail="Invalid session_id")
        data = r.json()

    email = data["email"]
    email_l = email.lower()
    existing = await db.users.find_one({"email": email_l}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        perms = await resolve_role_for_email(email_l)
        await db.users.update_one(
            {"user_id": user_id},
            {
                "$set": {
                    "name": data.get("name"),
                    "picture": data.get("picture"),
                    "role": perms["role"],
                    "can_approve_bookings": perms["can_approve_bookings"],
                    "can_approve_broadcasts": perms["can_approve_broadcasts"],
                }
            },
        )
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        perms = await resolve_role_for_email(email_l)
        await db.users.insert_one(
            {
                "user_id": user_id,
                "email": email_l,
                "name": data.get("name"),
                "picture": data.get("picture"),
                "role": perms["role"],
                "can_approve_bookings": perms["can_approve_bookings"],
                "can_approve_broadcasts": perms["can_approve_broadcasts"],
                "created_at": datetime.now(timezone.utc),
            }
        )

    session_token = data["session_token"]
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    await db.user_sessions.insert_one(
        {
            "user_id": user_id,
            "session_token": session_token,
            "expires_at": expires_at,
            "created_at": datetime.now(timezone.utc),
        }
    )

    response.set_cookie(
        key="session_token",
        value=session_token,
        httponly=True,
        secure=True,
        samesite="none",
        path="/",
        max_age=7 * 24 * 60 * 60,
    )

    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})

    # If the caller pre-registered a handoff_id (native app waiting for the
    # browser flow to complete), park the session for ~10 min so the app
    # can retrieve it via GET /api/auth/handoff/{id}.
    if body.handoff_id:
        try:
            await db.auth_handoffs.update_one(
                {"handoff_id": body.handoff_id},
                {
                    "$set": {
                        "session_token": session_token,
                        "user_id": user_id,
                        "ready_at": datetime.now(timezone.utc),
                        "expires_at": datetime.now(timezone.utc) + timedelta(minutes=10),
                    }
                },
                upsert=True,
            )
        except Exception:
            # Never let a handoff-write failure break the auth flow.
            pass

    return {"user": user, "session_token": session_token}

@router.post("/api/auth/handoff/init")
async def auth_handoff_init(body: Optional[HandoffInitBody] = None):
    hid = ((body.handoff_id if body else None) or str(uuid.uuid4())).strip()
    await db.auth_handoffs.delete_one({"handoff_id": hid})
    await db.auth_handoffs.insert_one({
        "handoff_id": hid,
        "created_at": datetime.now(timezone.utc),
        "expires_at": datetime.now(timezone.utc) + timedelta(minutes=10),
    })
    return {"handoff_id": hid}

@router.get("/api/auth/handoff/{handoff_id}")
async def auth_handoff_poll(handoff_id: str):
    doc = await db.auth_handoffs.find_one({"handoff_id": handoff_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Unknown handoff id")
    expires_at = doc.get("expires_at")
    if expires_at:
        # Motor sometimes returns datetimes as tz-naive UTC — coerce so the
        # comparison below never raises TypeError.
        if getattr(expires_at, "tzinfo", None) is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < datetime.now(timezone.utc):
            await db.auth_handoffs.delete_one({"handoff_id": handoff_id})
            raise HTTPException(status_code=410, detail="Handoff expired")
    if not doc.get("session_token"):
        return JSONResponse(status_code=202, content={"status": "pending"})
    user = await db.users.find_one({"user_id": doc["user_id"]}, {"_id": 0})
    await db.auth_handoffs.delete_one({"handoff_id": handoff_id})
    return {
        "status": "ready",
        "session_token": doc["session_token"],
        "user": user,
    }

@router.get("/api/auth/me")
async def auth_me(user=Depends(require_user)):
    # Decorate the user payload with the effective owner-tier flag so the
    # frontend can render the Full Access badge and unlock owner-only tabs
    # (Backups, Notifs, Availability, Homepage settings) without making a
    # second round-trip.
    out = dict(user)
    out["dashboard_full_access"] = bool(user.get("dashboard_full_access", False))
    out["dashboard_tabs"] = list(user.get("dashboard_tabs") or [])
    out["effective_owner"] = (user.get("role") == "owner") or out["dashboard_full_access"]
    # Personal messaging permissions:
    #   • Owner → always permitted.
    #   • Team members (any non-patient role) → permitted BY DEFAULT.
    #   • Patients → also permitted BY DEFAULT (in-app messaging is on
    #     for everyone). Owner can revoke an individual patient by
    #     setting the flag to False.
    role = user.get("role", "")
    explicit = user.get("can_send_personal_messages")
    if role in ("owner", "primary_owner", "super_owner", "partner"):
        # Owner tier — always permitted per hierarchy.
        out["can_send_personal_messages"] = True
    else:
        # Everyone else (staff + patients) — enabled unless explicitly
        # revoked (set to False) by the owner.
        out["can_send_personal_messages"] = (explicit is not False)
    # Account-deletion grace window — surfaced so the app can show the
    # "scheduled for deletion" banner with a one-tap Cancel.
    out["pending_deletion"] = bool(user.get("pending_deletion"))
    _pa = user.get("deletion_purge_at")
    if _pa is not None:
        try:
            out["deletion_purge_at"] = _pa.isoformat() if hasattr(_pa, "isoformat") else str(_pa)
        except Exception:
            out["deletion_purge_at"] = None
    return out

@router.post("/api/auth/magic/request")
@limiter.limit("5/minute")
async def auth_magic_request(request: Request, body: MagicRequestBody):
    """Send the user a one-time login link by email. Always returns ok=True
    (even for unknown emails) so we never leak which addresses exist —
    user-enumeration mitigation."""
    email_l = body.email.strip().lower()
    token = _secrets.token_urlsafe(32)
    await db.auth_magic_tokens.insert_one({
        "token": token,
        "email": email_l,
        "expires_at": datetime.now(timezone.utc) + timedelta(minutes=15),
        "used": False,
        "created_at": datetime.now(timezone.utc),
    })
    deep_link = f"consulturo://magic-link?token={token}"
    backend = (os.environ.get("PUBLIC_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://urology-pro.preview.emergentagent.com").rstrip("/")
    web_link = f"{backend}/auth/magic/redirect?token={token}"
    html = f"""
<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111">
  <h2 style="color:#0E7C8B;margin:0 0 8px">Sign in to ConsultUro</h2>
  <p>Tap the button below to finish signing in. The link expires in 15 minutes.</p>
  <p style="margin:24px 0">
    <a href="{web_link}" style="background:#0E7C8B;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;display:inline-block;font-weight:600">Open ConsultUro</a>
  </p>
  <p style="font-size:12px;color:#666">If the button doesn't work, copy this link:<br>
    <span style="word-break:break-all">{web_link}</span><br><br>
    Or paste this into the app: <code>{deep_link}</code>
  </p>
  <p style="font-size:12px;color:#999;margin-top:24px">If you didn't request this, you can safely ignore this email.</p>
</div>"""
    _send_email(email_l, "Sign in to ConsultUro", html)
    return {"ok": True}

@router.get("/auth/magic/redirect")
async def auth_magic_redirect(token: str):
    """Web bridge for magic-link emails.

    Strategy: try the native deep-link first (`consulturo://magic-link?...`)
    so an installed APK opens directly. If after ~1.5s the page is still
    visible (deep-link was a no-op because the app isn't installed, or the
    user is on desktop/laptop), redirect to the web app's `/magic-link`
    route — which exchanges the token via /api/auth/magic/exchange and
    signs the user in inside the browser.

    This makes the magic-link work in BOTH:
      • mobile with the APK installed (fastest path),
      • mobile without the APK (web fallback inside Chrome/Safari),
      • desktop / laptop (always web).
    """
    safe = (token or "").replace('"', '').replace('\\', '').replace('<', '').replace('>', '')
    # Use a SAME-ORIGIN relative URL — the bridge HTML is served from the
    # same Kubernetes ingress as the Expo web frontend, so /magic-link
    # resolves to the frontend route on whatever domain the user is on.
    web_link = f"/magic-link?token={safe}"
    # Use the TRIPLE-slash form so Expo Router treats `magic-link` as a
    # path (not a host). With `consulturo://magic-link?...` some Android
    # builds parse `magic-link` as the host, miss the route and show
    # the "Unmatched route" page. The `consulturo:///magic-link?...`
    # form unambiguously routes to /app/magic-link.tsx.
    deep_link = f"consulturo:///magic-link?token={safe}"
    html = f"""<!doctype html><html><head><meta charset="utf-8"><title>Signing you in…</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{{font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:48px 24px;text-align:center;color:#111;background:#F4F9F9}}
  .logo{{width:72px;height:72px;border-radius:18px;background:#0E7C8B;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:28px;margin-bottom:18px;letter-spacing:-1px}}
  h1{{color:#0E7C8B;margin:6px 0;font-size:22px}}
  p{{color:#5E7C81;margin:8px 0;font-size:14px;line-height:1.5}}
  .btn{{display:block;background:#0E7C8B;color:#fff;padding:14px 22px;border-radius:12px;text-decoration:none;margin:16px auto;font-weight:600;max-width:280px;border:0;cursor:pointer;font-size:15px}}
  .btn.alt{{background:#fff;color:#0E7C8B;border:1.5px solid #0E7C8B}}
  .spinner{{width:36px;height:36px;border:3px solid #E2ECEC;border-top-color:#0E7C8B;border-radius:50%;animation:spin 1s linear infinite;margin:24px auto 8px}}
  @keyframes spin{{to{{transform:rotate(360deg)}}}}
  .small{{font-size:11px;color:#A0B5B8;margin-top:24px}}
</style>
</head><body>
<div class="logo">CU</div>
<h1>Signing you in…</h1>
<p id="msg">Trying to open in the ConsultUro app first.<br/>If you don't have the app, we'll continue in your browser.</p>
<div class="spinner" id="spin"></div>
<a class="btn"     id="appBtn" href="{deep_link}">Open in app</a>
<a class="btn alt" id="webBtn" href="{web_link}">Continue in browser</a>
<p class="small">If nothing happens within a few seconds, tap "Continue in browser".</p>
<script>
  // Try the deep link automatically. If the APK is installed, the browser
  // tab will become hidden (the OS hands off to the app). After 1.5s of
  // remaining visible we assume no app and bounce to the web sign-in page.
  var didDeep = false;
  function tryDeep() {{ try {{ window.location.href = 'consulturo:///magic-link?token={safe}'; didDeep = true; }} catch(e) {{}} }}
  setTimeout(tryDeep, 50);
  setTimeout(function() {{
    if (document.visibilityState === 'visible') {{
      window.location.replace('{web_link}');
    }}
  }}, 1500);
</script>
</body></html>"""
    return HTMLResponse(content=html, status_code=200)

@router.post("/api/auth/magic/exchange")
@limiter.limit("20/minute")
async def auth_magic_exchange(request: Request, body: MagicExchangeBody):
    rec = await db.auth_magic_tokens.find_one({"token": body.token})
    if not rec:
        raise HTTPException(status_code=400, detail="Invalid or expired link")
    expires_at = rec.get("expires_at")
    if expires_at and expires_at.replace(tzinfo=timezone.utc) if expires_at.tzinfo is None else expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Link has expired")
    if rec.get("used"):
        raise HTTPException(status_code=400, detail="Link already used")
    await db.auth_magic_tokens.update_one({"token": body.token}, {"$set": {"used": True}})

    user_doc = await _ensure_user_for_email(rec["email"])
    session_token = _secrets.token_urlsafe(40)
    await db.user_sessions.insert_one({
        "user_id": user_doc["user_id"],
        "session_token": session_token,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "created_at": datetime.now(timezone.utc),
    })
    return {"user": user_doc, "session_token": session_token}

@router.post("/api/auth/otp/request")
@limiter.limit("5/minute")
async def auth_otp_request(request: Request, body: OtpRequestBody):
    email_l = body.email.strip().lower()
    code = f"{_secrets.randbelow(1000000):06d}"
    # Wipe any existing pending codes for this email so only the latest works.
    await db.auth_otp_codes.delete_many({"email": email_l})
    await db.auth_otp_codes.insert_one({
        "email": email_l,
        "code": code,
        "expires_at": datetime.now(timezone.utc) + timedelta(minutes=10),
        "attempts": 0,
        "created_at": datetime.now(timezone.utc),
    })
    html = f"""
<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111">
  <h2 style="color:#0E7C8B;margin:0 0 8px">Your sign-in code</h2>
  <p>Enter this 6-digit code in the ConsultUro app to finish signing in:</p>
  <div style="font-size:36px;letter-spacing:6px;font-weight:700;background:#F3F7F7;color:#0E7C8B;padding:16px 24px;border-radius:10px;text-align:center;margin:18px 0;display:inline-block">
    {code}
  </div>
  <p style="font-size:12px;color:#666">This code expires in 10 minutes. Don't share it with anyone.</p>
  <p style="font-size:12px;color:#999;margin-top:24px">If you didn't request this, you can safely ignore this email.</p>
</div>"""
    sent = _send_email(email_l, f"Your ConsultUro code: {code}", html)
    if not sent:
        # Surface the failure to the client so they can see why no
        # email arrived (instead of waiting for a code that never
        # comes). Most common cause is Resend's test-mode restriction.
        raise HTTPException(
            status_code=502,
            detail=(
                "Could not send the sign-in email. "
                "If the clinic's email sender domain isn't verified yet, "
                "Resend only delivers to the account owner. "
                "Please ask the admin to verify a domain at resend.com/domains."
            ),
        )
    return {"ok": True}

@router.post("/api/auth/otp/verify")
@limiter.limit("10/minute")
async def auth_otp_verify(request: Request, body: OtpVerifyBody):
    email_l = body.email.strip().lower()
    code = (body.code or "").strip()
    rec = await db.auth_otp_codes.find_one({"email": email_l})
    if not rec:
        raise HTTPException(status_code=400, detail="No pending code for this email")
    expires_at = rec.get("expires_at")
    if expires_at and (expires_at.replace(tzinfo=timezone.utc) if expires_at.tzinfo is None else expires_at) < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Code expired — request a new one")
    if rec.get("attempts", 0) >= 5:
        raise HTTPException(status_code=429, detail="Too many attempts — request a new code")
    if rec["code"] != code:
        await db.auth_otp_codes.update_one({"_id": rec["_id"]}, {"$inc": {"attempts": 1}})
        raise HTTPException(status_code=400, detail="Incorrect code")
    await db.auth_otp_codes.delete_one({"_id": rec["_id"]})

    user_doc = await _ensure_user_for_email(email_l)
    session_token = _secrets.token_urlsafe(40)
    await db.user_sessions.insert_one({
        "user_id": user_doc["user_id"],
        "session_token": session_token,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "created_at": datetime.now(timezone.utc),
    })
    return {"user": user_doc, "session_token": session_token}

@router.post("/api/auth/firebase-phone/verify")
@limiter.limit("20/minute")
async def auth_firebase_phone_verify(request: Request, body: FirebasePhoneVerifyBody):
    import httpx
    url = f"https://identitytoolkit.googleapis.com/v1/accounts:lookup?key={FIREBASE_API_KEY}"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, json={"idToken": body.id_token})
        if resp.status_code != 200:
            raise HTTPException(status_code=400, detail=f"Firebase token invalid: {resp.text[:200]}")
        data = resp.json()
        users = data.get("users") or []
        if not users:
            raise HTTPException(status_code=400, detail="Firebase token returned no user")
        fbuser = users[0]
        phone = (fbuser.get("phoneNumber") or "").strip()
        if not phone:
            raise HTTPException(status_code=400, detail="No phone number in token")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Token verify failed: {e}")

    # Find user by phone first, then by email (covers linking).
    user_doc = await db.users.find_one({"phone": phone}, {"_id": 0})
    needs_email = False
    if not user_doc:
        # New phone — must have email to create account (per the unified user model).
        if body.email:
            email_l = body.email.strip().lower()
            existing_by_email = await db.users.find_one({"email": email_l}, {"_id": 0})
            if existing_by_email:
                # User exists by email — LINK phone to it.
                await db.users.update_one(
                    {"user_id": existing_by_email["user_id"]},
                    {"$set": {"phone": phone, "phone_verified_at": datetime.now(timezone.utc)}},
                )
                user_doc = await db.users.find_one({"user_id": existing_by_email["user_id"]}, {"_id": 0})
            else:
                # Create a brand-new account with both phone + email.
                perms = await resolve_role_for_email(email_l)
                user_id = f"user_{uuid.uuid4().hex[:12]}"
                await db.users.insert_one({
                    "user_id": user_id,
                    "email": email_l,
                    "phone": phone,
                    "name": email_l.split("@")[0].replace(".", " ").title(),
                    "role": perms["role"],
                    "can_approve_bookings": perms["can_approve_bookings"],
                    "can_approve_broadcasts": perms["can_approve_broadcasts"],
                    "phone_verified_at": datetime.now(timezone.utc),
                    "created_at": datetime.now(timezone.utc),
                })
                user_doc = await db.users.find_one({"user_id": user_id}, {"_id": 0})
        else:
            # Phone OK, but no account & no email supplied → frontend must
            # show an "add email" screen and re-call this endpoint with email.
            return {"status": "needs_email", "phone": phone}

    session_token = _secrets.token_urlsafe(40)
    await db.user_sessions.insert_one({
        "user_id": user_doc["user_id"],
        "session_token": session_token,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "created_at": datetime.now(timezone.utc),
    })
    return {"status": "ok", "user": user_doc, "session_token": session_token}

@router.post("/api/auth/link-phone")
@limiter.limit("10/minute")
async def auth_link_phone(request: Request, body: LinkPhoneBody, user=Depends(require_user)):
    import httpx
    url = f"https://identitytoolkit.googleapis.com/v1/accounts:lookup?key={FIREBASE_API_KEY}"
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(url, json={"idToken": body.id_token})
    if resp.status_code != 200:
        raise HTTPException(status_code=400, detail="Invalid Firebase token")
    fbuser = (resp.json().get("users") or [{}])[0]
    phone = (fbuser.get("phoneNumber") or "").strip()
    if not phone:
        raise HTTPException(status_code=400, detail="No phone in token")
    other = await db.users.find_one({"phone": phone, "user_id": {"$ne": user["user_id"]}})
    if other:
        raise HTTPException(status_code=409, detail="This phone is already linked to another account")
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"phone": phone, "phone_verified_at": datetime.now(timezone.utc)}},
    )
    return {"ok": True, "phone": phone}

@router.post("/api/auth/link-email/request")
@limiter.limit("5/minute")
async def auth_link_email_request(request: Request, body: LinkEmailBody, user=Depends(require_user)):
    """Send an OTP to the email address being linked. Reuses the OTP store
    with a special `link_user_id` flag so verification is bound to the
    current session."""
    email_l = body.email.strip().lower()
    other = await db.users.find_one({"email": email_l, "user_id": {"$ne": user["user_id"]}})
    if other:
        raise HTTPException(status_code=409, detail="This email is already linked to another account")
    code = f"{_secrets.randbelow(1000000):06d}"
    await db.auth_otp_codes.delete_many({"email": email_l, "link_user_id": user["user_id"]})
    await db.auth_otp_codes.insert_one({
        "email": email_l,
        "code": code,
        "expires_at": datetime.now(timezone.utc) + timedelta(minutes=10),
        "attempts": 0,
        "link_user_id": user["user_id"],
        "created_at": datetime.now(timezone.utc),
    })
    html = f"""
<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111">
  <h2 style="color:#0E7C8B">Link this email to ConsultUro</h2>
  <p>Enter this 6-digit code in the app to confirm:</p>
  <div style="font-size:36px;letter-spacing:6px;font-weight:700;background:#F3F7F7;color:#0E7C8B;padding:16px 24px;border-radius:10px;text-align:center;margin:18px 0;display:inline-block">{code}</div>
  <p style="font-size:12px;color:#666">This code expires in 10 minutes.</p>
</div>"""
    _send_email(email_l, f"Confirm email for ConsultUro: {code}", html)
    return {"ok": True}

@router.post("/api/auth/link-email/verify")
@limiter.limit("10/minute")
async def auth_link_email_verify(request: Request, body: LinkEmailVerifyBody, user=Depends(require_user)):
    email_l = body.email.strip().lower()
    rec = await db.auth_otp_codes.find_one({"email": email_l, "link_user_id": user["user_id"]})
    if not rec or rec.get("code") != (body.code or "").strip():
        if rec:
            await db.auth_otp_codes.update_one({"_id": rec["_id"]}, {"$inc": {"attempts": 1}})
        raise HTTPException(status_code=400, detail="Incorrect or expired code")
    await db.auth_otp_codes.delete_one({"_id": rec["_id"]})
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"email": email_l, "email_verified_at": datetime.now(timezone.utc)}},
    )
    try:
        from services import auth_cache
        auth_cache.invalidate_user(user["user_id"])
    except Exception:
        pass
    return {"ok": True, "email": email_l}

@router.post("/api/auth/logout")
@limiter.limit("20/minute")
async def auth_logout(
    request: Request,
    response: Response,
    session_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None),
):
    token = session_token
    if not token and authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1]
    if token:
        await db.user_sessions.delete_one({"session_token": token})
        try:
            from services import auth_cache
            auth_cache.invalidate_token(token)
        except Exception:
            pass
    response.delete_cookie("session_token", path="/")
    return {"ok": True}

# Collections that hold ONLY personal/behavioural data for a single
# user — safe to hard-delete on account deletion. Clinical records
# (bookings / prescriptions / surgeries / receipts) are handled
# separately: they are ANONYMISED, not deleted, because a clinic must
# retain the medical-legal record even after the patient closes their
# app account.
_ACCOUNT_DELETE_PURGE_COLLECTIONS = [
    "ipss_history",
    "notes",
    "notifications",
    "notification_inbox",
    "comm_inbox_items",
    "comm_installations",
    "device_installations",
    "push_tokens",
    "drafts",
    "auth_magic_tokens",
    "auth_otp_codes",
]


# Grace period (days) between a patient scheduling deletion and the
# permanent purge. During this window the account stays fully usable and
# can be restored (either by signing back in and tapping "Cancel", or by
# the restore link in the deletion-receipt email).
ACCOUNT_DELETE_GRACE_DAYS = 30


async def purge_account(uid: str, user_snapshot: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """PERMANENTLY erase a patient account.

    Personal / behavioural data is HARD-deleted; clinical records
    (bookings / prescriptions / surgeries / receipts) are ANONYMISED and
    retained for the clinic's medical-legal record. The `users` document
    is removed last so a re-login creates a fresh identity.

    This is the terminal step run by the background sweep once the
    30-day grace window elapses (or immediately if the grace is 0).
    """
    now = datetime.now(timezone.utc)
    snap = user_snapshot or (await db.users.find_one({"user_id": uid})) or {}
    report: Dict[str, Any] = {"user_id": uid, "purged": {}, "anonymised": {}}

    # 1) Hard-delete personal collections.
    for coll in _ACCOUNT_DELETE_PURGE_COLLECTIONS:
        try:
            r = await db[coll].delete_many({"user_id": uid})
            report["purged"][coll] = int(r.deleted_count or 0)
        except Exception as e:
            report["purged"][coll] = f"error: {e}"

    try:
        await db.comm_installations.delete_many({"user_id": uid})
    except Exception:
        pass

    # 2) Patient ↔ clinic conversations + their messages.
    try:
        convo_ids = []
        async for c in db.comm_conversations.find({"patient_user_id": uid}, {"conversation_id": 1, "_id": 0}):
            cid = c.get("conversation_id")
            if cid:
                convo_ids.append(cid)
        if convo_ids:
            await db.comm_messages.delete_many({"conversation_id": {"$in": convo_ids}})
            await db.comm_message_receipts.delete_many({"conversation_id": {"$in": convo_ids}})
        cr = await db.comm_conversations.delete_many({"patient_user_id": uid})
        report["purged"]["comm_conversations"] = int(cr.deleted_count or 0)
    except Exception as e:
        report["purged"]["comm_conversations"] = f"error: {e}"

    # 3) Anonymise retained clinical records.
    _scrub = {
        "patient_name": "Deleted patient",
        "patient_phone": "",
        "patient_email": "",
        "patient_address": "",
        "deleted_account": True,
        "deleted_at": now,
        "user_id": None,
    }
    for coll in ("bookings", "prescriptions", "surgeries", "receipts"):
        try:
            r = await db[coll].update_many({"user_id": uid}, {"$set": _scrub})
            report["anonymised"][coll] = int(r.modified_count or 0)
        except Exception as e:
            report["anonymised"][coll] = f"error: {e}"

    # 4) Kill every active session + restore tokens.
    try:
        sr = await db.user_sessions.delete_many({"user_id": uid})
        report["purged"]["user_sessions"] = int(sr.deleted_count or 0)
    except Exception:
        pass
    try:
        await db.account_restore_tokens.delete_many({"user_id": uid})
    except Exception:
        pass
    try:
        from services import auth_cache
        auth_cache.invalidate_user(uid)
    except Exception:
        pass

    # 5) Delete the user document itself.
    try:
        await db.users.delete_one({"user_id": uid})
        report["user_deleted"] = True
    except Exception as e:
        report["user_deleted"] = f"error: {e}"

    # 6) Audit trail (retains no PII beyond the hashed identity).
    try:
        await db.audit_log.insert_one({
            "type": "account.purged",
            "user_id": uid,
            "email": snap.get("email"),
            "role": (snap.get("role") or ""),
            "created_at": now,
            "report": report,
        })
    except Exception:
        pass

    report["ok"] = True
    return report


async def sweep_purge_due_accounts(now: Optional[datetime] = None, limit: int = 50) -> Dict[str, Any]:
    """Background sweep — permanently purge accounts whose 30-day grace
    window has elapsed. Idempotent; safe to run on a timer."""
    now = now or datetime.now(timezone.utc)
    purged = 0
    cursor = db.users.find(
        {"pending_deletion": True, "deletion_purge_at": {"$lte": now}},
        {"user_id": 1, "email": 1, "role": 1},
    ).limit(limit)
    async for u in cursor:
        try:
            await purge_account(u["user_id"], u)
            purged += 1
        except Exception:
            pass
    return {"purged": purged, "at": now.isoformat()}


def _public_base_url() -> str:
    return (
        os.environ.get("PUBLIC_BACKEND_URL")
        or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
        or "https://urology-pro.preview.emergentagent.com"
    ).rstrip("/")


def _deletion_receipt_html(name: str, purge_date: str, restore_link: str) -> str:
    safe_name = (name or "there").strip() or "there"
    return f"""
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:24px 0">
  <tr><td align="center">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#111">
      <tr><td style="background:#0E7C8B;padding:20px 24px">
        <span style="color:#ffffff;font-size:18px;font-weight:700">ConsultUro</span>
      </td></tr>
      <tr><td style="padding:24px">
        <h2 style="margin:0 0 8px;font-size:19px;color:#111">Your account is scheduled for deletion</h2>
        <p style="margin:0 0 14px;font-size:14px;line-height:22px;color:#333">
          Hi {safe_name}, we've received your request to delete your ConsultUro account.
          Your personal data will be permanently removed on
          <strong>{purge_date}</strong>.
        </p>
        <p style="margin:0 0 14px;font-size:14px;line-height:22px;color:#333">
          Changed your mind? You have until then to restore your account and keep
          everything as it was — just tap the button below, or sign back in and
          tap <strong>Cancel deletion</strong>.
        </p>
        <p style="margin:22px 0">
          <a href="{restore_link}" style="background:#0E7C8B;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;display:inline-block;font-weight:600;font-size:14px">Restore my account</a>
        </p>
        <p style="margin:0 0 6px;font-size:12px;color:#666">If the button doesn't work, copy this link:</p>
        <p style="margin:0 0 18px;font-size:12px;color:#0E7C8B;word-break:break-all">{restore_link}</p>
        <p style="margin:0;font-size:12px;color:#999;line-height:18px">
          After {purge_date}, deletion is permanent and cannot be undone. Your clinical
          records are anonymised and retained by your clinic as required by medical-record law.
          Sent by ConsultUro. We never ask for your password or payment details by email.
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>"""


@router.delete("/api/auth/me")
async def delete_my_account(user=Depends(require_user)):
    """In-app account deletion with a 30-day restore window
    (Apple App Store Guideline 5.1.1(v)).

    Behaviour:
      • ONLY `patient` accounts may self-delete. Staff / owner-tier
        accounts are blocked (off-boarded by an admin via the Team panel).
      • The account is SCHEDULED for deletion — it stays fully usable
        during a 30-day grace window and shows a "scheduled for deletion"
        banner with a one-tap Cancel.
      • A deletion-receipt email is sent with the exact purge date and a
        single-use restore link.
      • Actual purge/anonymise runs from the background sweep once the
        grace window elapses (see `sweep_purge_due_accounts`).
    """
    role = (user.get("role") or "").lower()
    if role != "patient":
        raise HTTPException(
            status_code=403,
            detail=(
                "Only patient accounts can be deleted in-app. Staff and "
                "owner accounts must be removed by a clinic administrator "
                "from the Team panel."
            ),
        )

    uid = user["user_id"]
    now = datetime.now(timezone.utc)
    purge_at = now + timedelta(days=ACCOUNT_DELETE_GRACE_DAYS)

    await db.users.update_one(
        {"user_id": uid},
        {"$set": {
            "pending_deletion": True,
            "deletion_requested_at": now,
            "deletion_purge_at": purge_at,
        }},
    )
    try:
        from services import auth_cache
        auth_cache.invalidate_user(uid)
    except Exception:
        pass

    # Single-use restore token for the email link.
    token = _secrets.token_urlsafe(32)
    try:
        await db.account_restore_tokens.insert_one({
            "token": token,
            "user_id": uid,
            "expires_at": purge_at,
            "used": False,
            "created_at": now,
        })
    except Exception:
        pass

    # Deletion-receipt email (best-effort — never blocks the deletion).
    email_to = (user.get("email") or "").strip()
    if email_to:
        try:
            from services.mailer import send_email
            restore_link = f"{_public_base_url()}/api/auth/restore/redirect?token={token}"
            purge_date = purge_at.strftime("%d %b %Y")
            await send_email(
                to=email_to,
                subject="Your ConsultUro account is scheduled for deletion",
                html=_deletion_receipt_html(user.get("name") or "", purge_date, restore_link),
            )
        except Exception:
            pass

    try:
        await db.audit_log.insert_one({
            "type": "account.deletion_scheduled",
            "user_id": uid,
            "email": user.get("email"),
            "role": role,
            "created_at": now,
            "deletion_purge_at": purge_at,
        })
    except Exception:
        pass

    return {
        "ok": True,
        "pending_deletion": True,
        "deletion_purge_at": purge_at.isoformat(),
        "grace_days": ACCOUNT_DELETE_GRACE_DAYS,
    }


async def _cancel_pending_deletion(uid: str) -> bool:
    """Clear the pending-deletion flags + consume any restore tokens.
    Returns True if the account was actually pending deletion."""
    res = await db.users.update_one(
        {"user_id": uid, "pending_deletion": True},
        {"$set": {"pending_deletion": False, "deletion_restored_at": datetime.now(timezone.utc)},
         "$unset": {"deletion_requested_at": "", "deletion_purge_at": ""}},
    )
    try:
        await db.account_restore_tokens.delete_many({"user_id": uid})
    except Exception:
        pass
    try:
        from services import auth_cache
        auth_cache.invalidate_user(uid)
    except Exception:
        pass
    restored = bool(res.modified_count)
    if restored:
        try:
            await db.audit_log.insert_one({
                "type": "account.deletion_cancelled",
                "user_id": uid,
                "created_at": datetime.now(timezone.utc),
            })
        except Exception:
            pass
    return restored


@router.post("/api/auth/me/restore")
async def restore_my_account(user=Depends(require_user)):
    """Cancel a pending deletion for the signed-in user (the in-app
    "Cancel deletion" banner action)."""
    restored = await _cancel_pending_deletion(user["user_id"])
    return {"ok": True, "restored": restored, "pending_deletion": False}


@router.get("/api/auth/restore/redirect")
async def restore_via_link(token: str):
    """Browser-openable restore link (from the deletion-receipt email).
    Cancels the pending deletion and shows a confirmation page."""
    doc = await db.account_restore_tokens.find_one({"token": token})
    ok = False
    if doc and doc.get("user_id"):
        exp = doc.get("expires_at")
        if exp is not None and getattr(exp, "tzinfo", None) is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if not exp or exp >= datetime.now(timezone.utc):
            ok = await _cancel_pending_deletion(doc["user_id"])
            ok = ok or True  # already-restored token is still a success
    title = "Account restored" if ok else "Link expired"
    msg = (
        "Your ConsultUro account has been restored. Nothing was deleted — "
        "open the app and continue where you left off."
        if ok else
        "This restore link is no longer valid. If your account was already "
        "deleted, please sign up again from the app."
    )
    color = "#0E7C8B" if ok else "#B91C1C"
    html = f"""<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title} · ConsultUro</title></head>
<body style="margin:0;font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f6f8">
<div style="max-width:480px;margin:48px auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 6px 24px rgba(0,0,0,.08)">
  <div style="background:{color};padding:18px 24px;color:#fff;font-size:18px;font-weight:700">ConsultUro</div>
  <div style="padding:28px 24px;color:#111">
    <h2 style="margin:0 0 10px;font-size:20px">{title}</h2>
    <p style="margin:0 0 20px;font-size:15px;line-height:23px;color:#444">{msg}</p>
    <a href="consulturo://" style="background:{color};color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;display:inline-block;font-weight:600">Open ConsultUro</a>
  </div>
</div></body></html>"""
    return HTMLResponse(content=html, status_code=200)


@router.patch("/api/auth/me")
async def update_my_profile(body: MyProfileBody, user=Depends(require_user)):
    updates: Dict[str, Any] = {}
    if body.phone is not None:
        digits = re.sub(r"\D", "", body.phone)
        updates["phone"] = body.phone
        updates["phone_digits"] = digits
    if updates:
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": updates})
        try:
            from services import auth_cache
            auth_cache.invalidate_user(user["user_id"])
        except Exception:
            pass
    return await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
