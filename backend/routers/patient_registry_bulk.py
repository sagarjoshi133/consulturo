"""Registry — bulk invites + invite conversion analytics.

Extends `routers/patient_registry.py` without touching it.

  · POST /api/registry/patients/bulk-invite     — multi-patient
  · GET  /api/registry/patients/invite-analytics — conversion metrics
  · GET  /api/registry/patients/invite-batches   — history + per-batch delta

Reuses the single-patient `/invite` machinery via
`_build_invite_payload(patient_row, user)`, exported below.
"""
from __future__ import annotations

import os
import re
import secrets as _secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import quote as _q, quote_plus as _qp

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from db import db
from repositories.patients import patients as patients_repo
from services.capabilities import require_capability

router = APIRouter()

require_registry_access = require_capability(
    "access_patient_db",
    detail="Patient Database access not granted. Ask a primary owner to enable it for your account.",
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt):
    """Coerce a Mongo-loaded naive datetime to UTC-aware so comparisons
    against `_now()` don't raise."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _last10(raw: Optional[str]) -> str:
    return re.sub(r"\D", "", raw or "")[-10:]


def _backend_url() -> str:
    return (
        os.environ.get("PUBLIC_BACKEND_URL")
        or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
        or "https://urology-pro.preview.emergentagent.com"
    ).rstrip("/")


async def _build_invite_payload(
    row: Dict[str, Any],
    user: Dict[str, Any],
    *,
    message_override: Optional[str] = None,
) -> Dict[str, Any]:
    """Same payload shape as the single /invite endpoint.

    If `message_override` is supplied (e.g. a Broadcast template body),
    that becomes the body of the share message.
    """
    phone_digits = row.get("phone_digits") or _last10(row.get("phone"))
    email = (row.get("email") or "").strip().lower()
    if not phone_digits and not email:
        return {"patient_id": row.get("patient_id"),
                "error": "no_contact",
                "error_message": "patient has no phone or email on file"}

    backend = _backend_url()

    # Magic link if email available.
    join_url: str
    if email:
        token = _secrets.token_urlsafe(32)
        await db.auth_magic_tokens.insert_one({
            "token": token, "email": email,
            "expires_at": _now() + timedelta(days=7),
            "used": False, "created_at": _now(),
            "kind": "walkin_invite",
            "invited_patient_id": row.get("patient_id"),
            "invited_by_user_id": user.get("user_id"),
        })
        join_url = f"{backend}/auth/magic/redirect?token={token}"
    else:
        join_url = f"{backend}/login?ref=walkin"

    if message_override:
        share_message = message_override.strip() + f"\n\n{join_url}"
    else:
        clinic = await db.clinics.find_one({"deleted_at": None},
                                             {"_id": 0, "name": 1}) or {}
        clinic_name = clinic.get("name") or "ConsultUro"
        name = row.get("name") or "there"
        first = name.split(" ")[0]
        share_message = (
            f"Hi {first},\n"
            f"{clinic_name} has saved your details after your visit.\n"
            "Tap the link below to sign in — you'll be able to see your "
            "prescriptions, upcoming appointments, and message the clinic "
            "directly from the app.\n\n"
            f"{join_url}"
        )

    wa_url = None
    sms_uri = None
    if phone_digits:
        cc = re.sub(r"\D", "", row.get("country_code") or "91") or "91"
        wa_url = f"https://wa.me/{cc}{phone_digits[-10:]}?text={_qp(share_message)}"
        sms_uri = f"sms:{phone_digits}?body={_q(share_message)}"
    mailto_uri = None
    if email:
        mailto_uri = (f"mailto:{email}?subject={_q('Your ConsultUro sign-in link')}"
                        f"&body={_q(share_message)}")

    # Stamp registry row.
    now = _now()
    await db.patients.update_one(
        {"patient_id": row["patient_id"]},
        {"$set": {"invited_at": now, "invited_by": user.get("user_id"),
                    "updated_at": now},
         "$inc": {"invite_count": 1}},
    )

    return {
        "patient_id": row["patient_id"],
        "name": row.get("name"),
        "phone": row.get("phone") or row.get("phone_digits"),
        "email": row.get("email"),
        "join_url": join_url,
        "share_message": share_message,
        "wa_url": wa_url,
        "sms_uri": sms_uri,
        "mailto_uri": mailto_uri,
    }


# ── Bulk invite ─────────────────────────────────────────────────

class BulkInviteBody(BaseModel):
    patient_ids: List[str] = Field(..., min_length=1, max_length=200)
    template_id: Optional[str] = None
    # Optional flags for future WA Business API integration (Feb-24
    # placeholder). When toggled, and a business channel is configured,
    # the batch will be dispatched server-side instead of returning a
    # tap-through queue. For now it silently falls back to queue mode.
    send_via_wa_business: bool = False


@router.post("/api/registry/invites/bulk")
async def bulk_invite(body: BulkInviteBody, user=Depends(require_registry_access)):
    """Prepare an invite queue for a batch of walk-in patients.

    Returns a per-patient share payload the frontend can iterate to
    open WhatsApp / SMS / Email one at a time. Recording of `invited_at`
    is done individually so a partially-completed batch still shows
    "invited" chips for those we processed.
    """
    # Deduplicate + drop empty IDs.
    ids = [p for p in (body.patient_ids or []) if p]
    if not ids:
        raise HTTPException(status_code=400, detail="patient_ids required")
    ids = list(dict.fromkeys(ids))
    if len(ids) > 200:
        raise HTTPException(status_code=400, detail="max 200 patients per batch")

    # Optional template body override.
    message_override: Optional[str] = None
    template_snapshot: Optional[Dict[str, Any]] = None
    if body.template_id:
        t = await db.comm_broadcast_templates.find_one(
            {"id": body.template_id, "is_active": True}, {"_id": 0},
        )
        if not t:
            raise HTTPException(status_code=404, detail="template_not_found_or_inactive")
        # Prepend title as a header line if present.
        parts: List[str] = []
        if t.get("title"):
            parts.append(t["title"])
        if t.get("body"):
            parts.append(t["body"])
        message_override = "\n\n".join(parts) if parts else None
        template_snapshot = {"id": t["id"], "name": t.get("name"),
                              "title": t.get("title")}
        # Bump the template's use_count/last_used_at (same accounting the
        # single-apply endpoint uses).
        await db.comm_broadcast_templates.update_one(
            {"id": t["id"]},
            {"$inc": {"use_count": 1}, "$set": {"last_used_at": _now()}},
        )

    batch_id = str(uuid.uuid4())
    now = _now()
    results: List[Dict[str, Any]] = []
    ok_count = 0
    err_count = 0
    for pid in ids:
        row = await patients_repo.get_active(pid)
        if not row:
            results.append({"patient_id": pid, "error": "not_found"})
            err_count += 1
            continue
        try:
            payload = await _build_invite_payload(
                row, user, message_override=message_override,
            )
            payload["batch_id"] = batch_id
            if payload.get("error"):
                err_count += 1
            else:
                ok_count += 1
            results.append(payload)
        except Exception as e:
            err_count += 1
            results.append({"patient_id": pid, "error": "invite_failed",
                             "error_message": str(e)[:200]})

    # Persist the batch — powers analytics + audit trail.
    batch_doc = {
        "batch_id": batch_id,
        "template_id": template_snapshot.get("id") if template_snapshot else None,
        "template_snapshot": template_snapshot,
        "send_via_wa_business_requested": bool(body.send_via_wa_business),
        "created_by": user.get("user_id"),
        "created_at": now,
        "patient_ids": ids,
        "ok_count": ok_count,
        "error_count": err_count,
    }
    await db.walkin_invite_batches.insert_one(batch_doc)

    return {
        "ok": True,
        "batch_id": batch_id,
        "ok_count": ok_count,
        "error_count": err_count,
        "count": len(results),
        "template": template_snapshot,
        "wa_business_available": False,   # future toggle
        "results": results,
    }


# ── Analytics ───────────────────────────────────────────────────

@router.get("/api/registry/invites/analytics")
async def invite_analytics(user=Depends(require_registry_access)):
    """Any-signup-after-invite conversion analytics.

    A "converted" invite = the patient's registry row was invited
    (invite_count ≥ 1) AND a `users` doc with the same phone (last-10)
    OR email exists whose `created_at` is AFTER the `invited_at`.

    Returns cumulative counts + a rolling 7d / 30d breakdown for the
    dashboard card. Uses in-memory joins because the invited set is
    O(hundreds), not billions.
    """
    now = _now()
    d7 = now - timedelta(days=7)
    d30 = now - timedelta(days=30)

    total_invited = 0
    invites_last_7d = 0
    invites_last_30d = 0
    converted_total = 0
    converted_7d = 0        # signed up within 7d of invite
    converted_30d = 0       # signed up within 30d of invite

    # Load users into lookup dicts once.
    phone_to_user: Dict[str, Dict[str, Any]] = {}
    email_to_user: Dict[str, Dict[str, Any]] = {}
    async for u in db.users.find(
        {"created_at": {"$exists": True}},
        {"_id": 0, "user_id": 1, "phone": 1, "email": 1, "created_at": 1,
         "role": 1, "name": 1},
    ):
        ph = _last10(u.get("phone") or "")
        if ph and ph not in phone_to_user:
            phone_to_user[ph] = u
        em = (u.get("email") or "").strip().lower()
        if em and em not in email_to_user:
            email_to_user[em] = u

    async for p in db.patients.find(
        {"invite_count": {"$gte": 1}, "merged_into": {"$exists": False}},
        {"_id": 0, "patient_id": 1, "phone_digits": 1, "phone": 1,
         "email": 1, "invited_at": 1, "invite_count": 1},
    ):
        total_invited += 1
        invited_at = _aware(p.get("invited_at"))
        if invited_at:
            if invited_at >= d7:
                invites_last_7d += 1
            if invited_at >= d30:
                invites_last_30d += 1
        ph = p.get("phone_digits") or _last10(p.get("phone") or "")
        em = (p.get("email") or "").strip().lower()
        u = None
        if ph and ph in phone_to_user:
            u = phone_to_user[ph]
        elif em and em in email_to_user:
            u = email_to_user[em]
        if not u:
            continue
        u_created = _aware(u.get("created_at"))
        if u_created and invited_at and u_created >= invited_at:
            converted_total += 1
            delta = (u_created - invited_at).total_seconds()
            if delta <= 7 * 86400:
                converted_7d += 1
            if delta <= 30 * 86400:
                converted_30d += 1

    def _rate(x: int, y: int) -> float:
        return round(x / y, 3) if y else 0.0

    return {
        "as_of": now.isoformat(),
        "total_invited": total_invited,
        "invites_last_7d": invites_last_7d,
        "invites_last_30d": invites_last_30d,
        "converted_total": converted_total,
        "converted_within_7d": converted_7d,
        "converted_within_30d": converted_30d,
        "conversion_rate_total": _rate(converted_total, total_invited),
        "conversion_rate_7d": _rate(converted_7d, invites_last_7d),
        "conversion_rate_30d": _rate(converted_30d, invites_last_30d),
    }


@router.get("/api/registry/invites/batches")
async def invite_batches(limit: int = 20,
                          user=Depends(require_registry_access)):
    """Recent bulk-invite batches with success/error counts."""
    limit = max(1, min(int(limit or 20), 100))
    rows: List[Dict[str, Any]] = []
    async for b in db.walkin_invite_batches.find({}, {"_id": 0}).sort(
        "created_at", -1
    ).limit(limit):
        # Redact patient_ids — dashboards only care about size.
        b["patient_count"] = len(b.get("patient_ids") or [])
        b.pop("patient_ids", None)
        if isinstance(b.get("created_at"), datetime):
            b["created_at"] = b["created_at"].isoformat()
        rows.append(b)
    return {"items": rows, "count": len(rows)}
