"""ConsultUro — Compliance & Performance router (Waves 5 + 6).

Wave 5 — Compliance / trust
  · Z  GET  /api/dpdp/export?phone=     (patient self-service data export)
  · AA POST /api/security/2fa/setup     (owner-only TOTP enrolment)
  · AA POST /api/security/2fa/verify    (verify a TOTP code)
  · BB GET  /api/audit-log/search       (filterable audit log)

Wave 6 — Performance
  · DD GET  /api/perf/info              (perf summary — no-op endpoint
                                          documenting client-side resize)
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import io
import os
import secrets
import struct
import time
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel

from db import db
from auth_deps import require_owner, require_staff, require_user
from server import _normalize_phone, block_if_demo

router = APIRouter()


# ──────────────────────────────────────────────────────────────────────
# Z · DPDP-compliant patient data export
# ──────────────────────────────────────────────────────────────────────


@router.get("/api/dpdp/export")
async def dpdp_export(request: Request, phone: str = "", user=Depends(require_user)):
    """Return a JSON bundle of everything we hold about the requesting
    patient (DPDP §11 — Right to access). Staff may also export on
    behalf of a patient by passing ?phone=, but the result is logged.

    Bundle structure:
        {
          "exported_at": "...",
          "patient": {...},
          "bookings": [...],
          "prescriptions": [...],
          "lab_results": [...],
          "surgeries": [...],
          "ipd_admissions": [...],
          "medical_certificates": [...],
          "receipts": [...],
          "notifications": [...],
          "ipss_submissions": [...],
        }
    """
    role = (user or {}).get("role") or ""
    requested_phone = _normalize_phone(phone or "")
    if role == "patient":
        # Patients can only export their own data.
        own = _normalize_phone(user.get("phone") or "")
        if not own and (user.get("email") or ""):
            me = await db.patients.find_one(
                {"email": (user.get("email") or "").strip().lower()},
                {"_id": 0, "phone": 1},
            )
            if me and me.get("phone"):
                own = _normalize_phone(me["phone"])
        if not own:
            raise HTTPException(404, detail="No patient record on file for your account")
        target = own
    else:
        if not requested_phone:
            raise HTTPException(400, detail="phone required for staff export")
        target = requested_phone
        # Tenant gate (2026-06-18 hardening) — staff exports MUST be
        # scoped to the caller's clinic. Previously, any owner could
        # export a phone number from a different clinic in the same
        # database (a multi-tenant data-leak vector). Now we lookup
        # the caller's clinic_id and require the patient to belong
        # to it. We allow super_owner / platform_admin to skip this
        # check (cross-tenant view is part of their role).
        caller_role = role
        if caller_role not in {"super_owner", "platform_admin"}:
            from services.tenancy import resolve_clinic_id  # local import to avoid cycle
            try:
                caller_clinic = await resolve_clinic_id(request, user)
            except Exception:
                caller_clinic = None
            if not caller_clinic:
                # Fallback — look up the caller's primary membership.
                mem = await db.clinic_memberships.find_one(
                    {"user_id": user.get("user_id"), "role": {"$in": ["primary_owner", "owner", "partner", "doctor", "assistant", "reception", "nursing"]}},
                    {"_id": 0, "clinic_id": 1},
                )
                if mem:
                    caller_clinic = mem.get("clinic_id")
            if caller_clinic:
                # The patient must have at least one booking OR a
                # patient record in the caller's clinic to be exportable.
                suffix10 = target[-10:] if len(target) >= 10 else target
                in_clinic_b = await db.bookings.count_documents({
                    "clinic_id": caller_clinic,
                    "patient_phone": {"$regex": re.escape(suffix10) + r"$"},
                })
                in_clinic_p = await db.patients.count_documents({
                    "clinic_id": caller_clinic, "phone": target,
                })
                if in_clinic_b == 0 and in_clinic_p == 0:
                    raise HTTPException(
                        403,
                        detail="This patient does not belong to your clinic. "
                               "Use the platform-admin console for cross-clinic exports.",
                    )

    suffix = target[-10:] if len(target) >= 10 else target
    phone_q = {"patient_phone": {"$regex": suffix + "$"}}

    async def _list(coll, q, projection=None) -> List[Dict[str, Any]]:
        try:
            cursor = coll.find(q, projection or {"_id": 0})
            return await cursor.to_list(length=5000)
        except Exception:
            return []

    bundle = {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "patient": await db.patients.find_one({"phone": target}, {"_id": 0}) or {},
        "bookings": await _list(db.bookings, phone_q),
        "prescriptions": await _list(db.prescriptions, phone_q),
        "surgeries": await _list(db.surgeries, phone_q),
        "lab_results": await _list(db.lab_results, {"phone": target}),
        "ipd_admissions": await _list(db.ipd_admissions, phone_q),
        "medical_certificates": await _list(db.medical_certificates, phone_q),
        "receipts": await _list(db.receipts, phone_q),
        "ipss_submissions": await _list(db.ipss_submissions, {"phone_digits": target}),
    }

    # Audit log the export.
    try:
        await db.audit_logs.insert_one({
            "ts": datetime.now(timezone.utc),
            "action": "dpdp_export",
            "user_id": user.get("user_id"),
            "user_role": role,
            "target_phone": target,
            "by_role": role,
        })
    except Exception:
        pass

    # Stream as a downloadable file when called from a browser.
    payload = io.BytesIO()
    payload.write(_json_dumps(bundle).encode("utf-8"))
    payload.seek(0)
    filename = f"consulturo-export-{target}-{datetime.now(timezone.utc).strftime('%Y%m%d')}.json"
    return StreamingResponse(
        payload,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _json_dumps(obj: Any) -> str:
    import json
    def _default(o: Any) -> Any:
        if isinstance(o, datetime):
            return o.isoformat()
        return str(o)
    return json.dumps(obj, indent=2, default=_default, ensure_ascii=False)


# ──────────────────────────────────────────────────────────────────────
# AA · TOTP 2-FA for owner accounts
# ──────────────────────────────────────────────────────────────────────


def _b32_random(n_bytes: int = 20) -> str:
    return base64.b32encode(secrets.token_bytes(n_bytes)).decode("ascii").rstrip("=")


def _totp(secret: str, t: Optional[int] = None, step: int = 30, digits: int = 6) -> str:
    """RFC 6238 TOTP. Pure-stdlib, no dependency."""
    t = (t if t is not None else int(time.time())) // step
    # Decode the base32 secret (re-pad as needed).
    pad = "=" * ((8 - len(secret) % 8) % 8)
    key = base64.b32decode(secret + pad, casefold=True)
    msg = struct.pack(">Q", t)
    digest = hmac.new(key, msg, hashlib.sha1).digest()
    o = digest[-1] & 0x0F
    code = (struct.unpack(">I", digest[o:o + 4])[0] & 0x7FFFFFFF) % (10 ** digits)
    return str(code).zfill(digits)


def _totp_verify(secret: str, code: str, window: int = 1) -> bool:
    """Accept the code from the previous or next step too — handles clock drift."""
    try:
        if not code or not secret:
            return False
        code = code.strip().replace(" ", "")
        now_step = int(time.time()) // 30
        for d in range(-window, window + 1):
            expected = _totp(secret, t=(now_step + d) * 30)
            if hmac.compare_digest(expected, code):
                return True
    except Exception:
        return False
    return False


class TotpSetup(BaseModel):
    label: Optional[str] = "ConsultUro Owner"


@router.post("/api/security/2fa/setup")
async def totp_setup(body: TotpSetup, user=Depends(require_owner)):
    """Generate a fresh TOTP secret + otpauth URL for the owner.

    The secret is stored as `pending_totp_secret` until the owner
    confirms with a valid code via /api/security/2fa/verify, after
    which it's moved to `totp_secret` and 2FA becomes mandatory for
    future logins (enforcement is up to the auth layer).
    """
    block_if_demo(user)
    secret = _b32_random(20)
    uid = user.get("user_id")
    email = user.get("email") or "owner@consulturo"
    label = (body.label or "ConsultUro Owner").replace(" ", "%20")
    otpauth_url = f"otpauth://totp/ConsultUro:{email}?secret={secret}&issuer={label}"
    await db.users.update_one(
        {"user_id": uid},
        {"$set": {
            "pending_totp_secret": secret,
            "pending_totp_at": datetime.now(timezone.utc),
        }},
    )
    return {
        "ok": True,
        "secret": secret,
        "otpauth_url": otpauth_url,
        "instructions": (
            "Open Google Authenticator / Authy / 1Password → "
            "+ → Scan QR (or paste this secret). Then confirm with the 6-digit code."
        ),
    }


class TotpVerify(BaseModel):
    code: str


@router.post("/api/security/2fa/verify")
async def totp_verify(body: TotpVerify, user=Depends(require_owner)):
    block_if_demo(user)
    uid = user.get("user_id")
    me = await db.users.find_one({"user_id": uid}) or {}
    secret = me.get("pending_totp_secret") or me.get("totp_secret")
    if not secret:
        raise HTTPException(400, detail="Run /api/security/2fa/setup first")
    if not _totp_verify(secret, body.code):
        raise HTTPException(400, detail="Code didn't match — check the time on your phone")
    # Promote pending → active.
    await db.users.update_one(
        {"user_id": uid},
        {
            "$set": {
                "totp_secret": secret,
                "totp_enabled_at": datetime.now(timezone.utc),
            },
            "$unset": {"pending_totp_secret": "", "pending_totp_at": ""},
        },
    )
    return {"ok": True, "enabled": True}


@router.get("/api/security/2fa/status")
async def totp_status(user=Depends(require_owner)):
    uid = user.get("user_id")
    me = await db.users.find_one({"user_id": uid}, {"_id": 0, "totp_enabled_at": 1, "pending_totp_secret": 1}) or {}
    return {
        "enabled": bool(me.get("totp_enabled_at")),
        "pending": bool(me.get("pending_totp_secret")),
        "enabled_at": me.get("totp_enabled_at"),
    }


@router.post("/api/security/2fa/disable")
async def totp_disable(user=Depends(require_owner)):
    block_if_demo(user)
    uid = user.get("user_id")
    await db.users.update_one(
        {"user_id": uid},
        {"$unset": {"totp_secret": "", "totp_enabled_at": "", "pending_totp_secret": "", "pending_totp_at": ""}},
    )
    return {"ok": True, "enabled": False}


# ──────────────────────────────────────────────────────────────────────
# BB · Audit log search & filter
# ──────────────────────────────────────────────────────────────────────


@router.get("/api/audit-log/search")
async def audit_search(
    request: Request,
    q: str = "",
    action: str = "",
    user_id: str = "",
    days: int = Query(30, ge=1, le=365),
    limit: int = Query(100, ge=1, le=500),
    user=Depends(require_owner),
):
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    qx: Dict[str, Any] = {"ts": {"$gte": cutoff}}
    if action:
        qx["action"] = action
    if user_id:
        qx["user_id"] = user_id
    if q and len(q.strip()) >= 2:
        rx = {"$regex": q.strip(), "$options": "i"}
        qx["$or"] = [{"action": rx}, {"target_phone": rx}, {"detail": rx}, {"user_id": rx}]
    rows: List[Dict[str, Any]] = []
    try:
        cursor = db.audit_logs.find(qx, {"_id": 0}).sort("ts", -1).limit(limit)
        async for r in cursor:
            ts = r.get("ts")
            if hasattr(ts, "isoformat"):
                r["ts"] = ts.isoformat()
            rows.append(r)
    except Exception:
        pass

    # Distinct action names for the filter dropdown.
    actions: List[str] = []
    try:
        actions = sorted({a for a in await db.audit_logs.distinct("action") if a})
    except Exception:
        pass

    return {"ok": True, "count": len(rows), "rows": rows, "actions": actions, "window_days": days}


# ──────────────────────────────────────────────────────────────────────
# DD · Performance info — documenting client-side resize
# ──────────────────────────────────────────────────────────────────────


@router.get("/api/perf/info")
async def perf_info(user=Depends(require_user)):
    """Returns the current upload-size budget so the client can resize
    images locally before posting. Keeps the contract explicit."""
    return {
        "max_upload_bytes": 8 * 1024 * 1024,
        "preferred_max_long_edge_px": 1600,
        "preferred_quality": 0.85,
        "preferred_format": "image/jpeg",
        "note": "The client SHOULD downscale to ≤1600px long edge and re-encode at q=0.85 before upload. Cuts a typical clinic Wi-Fi upload from 7 s to <2 s.",
    }
