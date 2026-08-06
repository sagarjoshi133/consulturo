"""ConsultUro — Factory Reset router.

Provides two endpoints that together implement a destructive, irreversible
"factory reset" capability for super_owner / primary_owner only:

  · POST /api/admin/factory-reset/request-otp
      Sends a fresh 6-digit OTP to the caller's registered email. The
      caller MUST type this code back along with the exact clinic name
      to actually trigger the reset. No data is touched yet.

  · POST /api/admin/factory-reset/execute
      Body: {clinic_name: str, otp_code: str}
      Verifies BOTH (clinic name must equal the configured clinic's
      name, OTP must match the one issued in the last 10 minutes), then
      wipes every clinical / operational / analytics collection while
      preserving user accounts, clinic settings, schedule/availability,
      bed & OT config, fee templates, partner permissions, platform
      content (announcements, blog, videos catalog), and the active
      session tokens (so the owner stays logged in).

Why two steps + OTP?
  ConsultUro uses passwordless email-OTP auth, so there's no "password"
  to re-enter (option (c) in the user's confirmation gate). The closest
  equivalent — and arguably stronger — is a fresh OTP delivered to the
  registered owner email at the moment of the reset. Combined with the
  clinic-name typed match, accidental presses are effectively
  impossible.

This module also writes a single timestamped row into the audit_log
BEFORE the wipe (so the audit trail itself survives long enough to be
recorded), and re-creates it AFTER the wipe so future audit queries
have something to point at.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List
import secrets as _secrets

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from db import db
from auth_deps import require_user

router = APIRouter()


# Collections that hold patient / clinical / operational / analytics
# data. Every doc inside (filtered by the caller's clinic_id) is
# erased on reset. Order matters only cosmetically (we report
# per-collection counts in the response).
_COLLECTIONS_TO_WIPE: List[str] = [
    # IPD
    "admissions", "ipd_admissions", "ipd_bed_transfers", "ipd_drug_chart",
    "ipd_rounds", "ipd_vitals",
    # Consults / bookings / consultations
    "bookings", "patient_snapshots",
    # Patients themselves
    "patients", "phr_summaries", "records",
    # Prescriptions + drug usage
    "prescriptions",
    # Surgery + consents
    "surgeries", "surgical_consents", "user_consents",
    # Discharge / medical certificates
    "medical_certificates",
    # Billing / receipts
    "receipts",
    # Notes / reminders / IPSS-style tools
    "notes", "reminders",
    "ipss_records", "ipss_scores", "ipss_submissions",
    "bladder_diary", "prostate_readings", "tool_scores",
    # Communication
    "broadcasts", "broadcast_inbox",
    "personal_messages",  # 1:1 inbox messages (if present)
    "notifications", "push_log", "push_register_log",
    # Patient-facing assistant chats
    "assistant_conversations", "assistant_messages",
    # Reviews / referrals
    "review_requests", "referral_attributions",
    "featured_reviews",  # clinic-curated quotes — operational, wipe
    # Auditing / crash trace
    "audit_log", "client_crash_log",
    # Counters reset so registration / IPD / receipt numbers start at 1
    "counters",
]


# Collections we DELIBERATELY do NOT touch. Documented here so future
# contributors don't have to guess. Each line explains the rationale.
_COLLECTIONS_PRESERVED: List[str] = [
    "users",                # auth — owner must stay signed in
    "user_sessions",        # ditto — active session tokens
    "auth_handoffs",        # in-flight web-to-app handoffs
    "auth_magic_tokens",    # in-flight magic-link tokens
    "auth_otp_codes",       # in-flight OTPs (including the one we issued for this reset)
    "clinics",              # the clinic record itself
    "clinic_settings",      # branding, letterhead, Rx print mode, perms
    "app_settings",         # other clinic-level toggles
    "availability",         # consulting schedule
    "unavailabilities",     # blocked dates / leaves
    "role_labels",          # clinic-custom role names
    "referral_codes",       # marketing tracking codes
    "referrers",            # referring doctor list (clinic-managed)
    "team_invites",         # pending team invitations
    "medicines_custom",     # clinic-custom drug library
    "drug_repository",      # platform-curated drug repository
    "gdrive_oauth",         # backup OAuth tokens (preserve!)
    "gdrive_oauth_states",  # in-flight OAuth states
    "announcements",        # platform content (user spec)
    "blog_posts",           # platform content (user spec)
]


class _FactoryResetOtpRequest(BaseModel):
    pass  # body is empty; caller is identified by their session


class _FactoryResetExecuteBody(BaseModel):
    clinic_name: str = Field(..., min_length=1)
    otp_code: str = Field(..., min_length=4, max_length=10)


def _is_super_or_primary(user: Dict[str, Any]) -> bool:
    role = (user or {}).get("role") or ""
    return role in ("super_owner", "primary_owner")


async def _clinic_name_for(user: Dict[str, Any]) -> str:
    """Best-effort: return the clinic name configured for this owner."""
    clinic_id = (user or {}).get("clinic_id") or "default"
    doc = await db.clinic_settings.find_one(
        {"clinic_id": clinic_id},
        {"_id": 0, "clinic_name": 1, "name": 1},
    )
    if doc:
        # `clinic_name` is the modern field; older clinics used `name`.
        return (doc.get("clinic_name") or doc.get("name") or "").strip()
    return ""


@router.post("/api/admin/factory-reset/request-otp")
async def factory_reset_request_otp(
    request: Request,
    user: Dict[str, Any] = Depends(require_user),
):
    """Issue a fresh 6-digit code to the caller's registered email so
    they can confirm the destructive reset in the next call.

    Rate-limiting is intentionally relaxed (the user has already proven
    they're the owner via their session token); the real safety is the
    `_is_super_or_primary` gate + clinic-name match in the execute step.
    """
    if not _is_super_or_primary(user):
        raise HTTPException(403, "Only the super_owner or primary_owner can factory-reset.")

    email_l = (user.get("email") or "").lower().strip()
    if not email_l:
        raise HTTPException(400, "Your account has no email on file.")

    # Wipe pending codes namespaced to this purpose so only the latest
    # works. We use a distinct `purpose` field so it can't collide
    # with the regular sign-in OTP flow.
    await db.auth_otp_codes.delete_many({"email": email_l, "purpose": "factory_reset"})
    code = f"{_secrets.randbelow(1000000):06d}"
    await db.auth_otp_codes.insert_one({
        "email": email_l,
        "purpose": "factory_reset",
        "code": code,
        "expires_at": datetime.now(timezone.utc) + timedelta(minutes=10),
        "attempts": 0,
        "created_at": datetime.now(timezone.utc),
    })

    # Send email via the same _send_email helper used by sign-in OTPs.
    from server import _send_email  # local import to avoid circulars
    html = f"""
<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111">
  <h2 style="color:#B91C1C;margin:0 0 8px">⚠️ Factory-Reset Confirmation Code</h2>
  <p>A factory reset of <b>{await _clinic_name_for(user) or 'your clinic'}</b> has been requested
     from the ConsultUro app. If this was YOU, enter this code in the app
     to proceed:</p>
  <div style="font-size:36px;letter-spacing:6px;font-weight:700;background:#FEE2E2;color:#B91C1C;padding:16px 24px;border-radius:10px;text-align:center;margin:18px 0;display:inline-block">
    {code}
  </div>
  <p style="font-size:13px;color:#666">This code expires in 10 minutes.</p>
  <p style="font-size:13px;color:#B91C1C;margin-top:14px">
    <b>Warning:</b> Confirming with this code will permanently erase
    every patient record, prescription, IPD admission, surgery, consent,
    receipt and notification on your clinic. Backups are recommended
    BEFORE you confirm.
  </p>
  <p style="font-size:12px;color:#999;margin-top:18px">If you did NOT request this, ignore this email — no data has been touched.</p>
</div>"""
    sent = _send_email(email_l, "ConsultUro Factory-Reset code", html)
    if not sent:
        raise HTTPException(
            502,
            "Could not deliver the confirmation email. Please verify your sender domain and retry.",
        )
    return {"ok": True, "sent_to": email_l}


@router.post("/api/admin/factory-reset/execute")
async def factory_reset_execute(
    request: Request,
    body: _FactoryResetExecuteBody,
    user: Dict[str, Any] = Depends(require_user),
):
    """Verify the OTP + clinic-name match, then wipe every operational
    collection scoped to the caller's clinic_id. Returns per-collection
    deletion counts so the UI can summarise to the user.

    Strictly clinic-scoped — even for super_owner, we only wipe THEIR
    current clinic. To wipe a different clinic, super_owner must
    impersonate that clinic via the clinic switcher first.
    """
    if not _is_super_or_primary(user):
        raise HTTPException(403, "Only the super_owner or primary_owner can factory-reset.")

    # 1. Clinic-name match (case-insensitive, trimmed).
    typed = (body.clinic_name or "").strip().lower()
    expected = (await _clinic_name_for(user) or "").lower()
    if not expected:
        raise HTTPException(
            400,
            "Clinic name is not configured. Please set it under Branding → Clinic info first.",
        )
    if typed != expected:
        raise HTTPException(400, "Clinic name doesn't match. Type it exactly as shown.")

    # 2. OTP match.
    email_l = (user.get("email") or "").lower().strip()
    rec = await db.auth_otp_codes.find_one({"email": email_l, "purpose": "factory_reset"})
    if not rec:
        raise HTTPException(400, "No pending confirmation code — request a new one.")
    expires_at = rec.get("expires_at")
    if expires_at and (expires_at.replace(tzinfo=timezone.utc) if expires_at.tzinfo is None else expires_at) < datetime.now(timezone.utc):
        raise HTTPException(400, "Confirmation code expired — request a new one.")
    if rec.get("attempts", 0) >= 5:
        raise HTTPException(429, "Too many incorrect attempts. Request a new code.")
    if rec.get("code") != (body.otp_code or "").strip():
        await db.auth_otp_codes.update_one({"_id": rec["_id"]}, {"$inc": {"attempts": 1}})
        raise HTTPException(400, "Incorrect confirmation code.")
    # Burn the code so it can't be re-used.
    await db.auth_otp_codes.delete_one({"_id": rec["_id"]})

    # 3. Record the action in the audit log BEFORE the wipe — this
    #    document will itself be erased, but it shows up in any
    #    pre-reset snapshot/backup.
    clinic_id = (user.get("clinic_id") or "default")
    try:
        await db.audit_log.insert_one({
            "clinic_id": clinic_id,
            "actor_id": user.get("user_id"),
            "actor_email": email_l,
            "actor_role": user.get("role"),
            "event": "factory_reset.execute",
            "ts": datetime.now(timezone.utc),
            "ip": (request.client.host if request.client else None),
        })
    except Exception:
        pass

    # 4. Delete in every operational collection, scoped by clinic_id.
    #    Collections without a `clinic_id` field (legacy / global)
    #    silently match zero docs, which is what we want.
    deleted: Dict[str, int] = {}
    for coll_name in _COLLECTIONS_TO_WIPE:
        try:
            coll = db[coll_name]
            res = await coll.delete_many({"clinic_id": clinic_id})
            deleted[coll_name] = int(res.deleted_count or 0)
        except Exception as exc:
            # Don't abort the whole reset on a single collection failure.
            deleted[coll_name] = -1
            print(f"[factory-reset] {coll_name} wipe failed: {exc}")

    # 5. Re-seed the audit_log with the post-reset marker so future
    #    audit queries always have at least one entry to anchor on.
    try:
        await db.audit_log.insert_one({
            "clinic_id": clinic_id,
            "actor_id": user.get("user_id"),
            "actor_email": email_l,
            "actor_role": user.get("role"),
            "event": "factory_reset.completed",
            "deleted_counts": deleted,
            "ts": datetime.now(timezone.utc),
        })
    except Exception:
        pass

    total_deleted = sum(v for v in deleted.values() if v > 0)
    return {
        "ok": True,
        "clinic_id": clinic_id,
        "deleted_total": total_deleted,
        "deleted": deleted,
        "preserved_collections": _COLLECTIONS_PRESERVED,
    }
