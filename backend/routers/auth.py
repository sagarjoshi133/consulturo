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
    #     Owner can explicitly revoke a team member by setting
    #     `can_send_personal_messages` to False on that user.
    #   • Patients → not permitted by default. Owner can authorize an
    #     individual patient by setting the flag to True.
    role = user.get("role", "")
    explicit = user.get("can_send_personal_messages")
    if role in ("owner", "primary_owner", "super_owner", "partner"):
        # Owner tier — always permitted per hierarchy.
        out["can_send_personal_messages"] = True
    elif role and role != "patient":
        # Default-True for staff. Only False if explicitly set to False.
        out["can_send_personal_messages"] = (explicit is not False)
    else:
        out["can_send_personal_messages"] = bool(explicit)
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
    response.delete_cookie("session_token", path="/")
    return {"ok": True}

@router.patch("/api/auth/me")
async def update_my_profile(body: MyProfileBody, user=Depends(require_user)):
    updates: Dict[str, Any] = {}
    if body.phone is not None:
        digits = re.sub(r"\D", "", body.phone)
        updates["phone"] = body.phone
        updates["phone_digits"] = digits
    if updates:
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": updates})
    return await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
