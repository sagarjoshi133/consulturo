"""ConsultUro — Platform Reset router (super_owner ONLY).

Sister of `factory_reset.py`. While that one wipes data for a SINGLE
clinic, this endpoint wipes the same operational/clinical collections
across EVERY clinic on the platform. It is the nuclear option, intended
for use only at the very end of platform-wide testing (when the dev
team is ready to flip the switch to production with zero ghost data
across all tenants).

Endpoints:

  · POST /api/admin/platform-reset/request-otp
        Super_owner only. Sends a 6-digit OTP to the super_owner's
        registered email with `purpose=platform_reset`.

  · POST /api/admin/platform-reset/execute
        Body: {confirm_phrase: str, otp_code: str}
        `confirm_phrase` MUST equal "RESET ENTIRE PLATFORM" (case-
        sensitive). The OTP must match the latest issued code. Wipes
        the same operational collections as `factory_reset` but
        WITHOUT any clinic_id filter — i.e. across every tenant.

Preserved across the platform (same intent as the per-clinic reset):
  users, user_sessions, clinics, clinic_settings, app_settings,
  availability, unavailabilities, role_labels, referral_codes,
  referrers, team_invites, medicines_custom, drug_repository,
  gdrive_oauth(_states), announcements, blog_posts.

This is intentionally distinct from `factory_reset` so the destruction
boundary stays explicit — a primary_owner can fire factory_reset and
only loses their own clinic; only the super_owner can fire
platform_reset and end up purging every other tenant. The route lives
under `/admin/platform-reset/...` rather than reusing the
`factory-reset` namespace.
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


# Shared with factory_reset.py. Kept duplicated here (instead of
# importing) to keep this module independently auditable — anyone
# reviewing destructive routes should see the full list inline.
_COLLECTIONS_TO_WIPE: List[str] = [
    "admissions", "ipd_admissions", "ipd_bed_transfers", "ipd_drug_chart",
    "ipd_rounds", "ipd_vitals",
    "bookings", "patient_snapshots",
    "patients", "phr_summaries", "records",
    "prescriptions",
    "surgeries", "surgical_consents", "user_consents",
    "medical_certificates",
    "receipts",
    "notes", "reminders",
    "ipss_records", "ipss_scores", "ipss_submissions",
    "bladder_diary", "prostate_readings", "tool_scores",
    "broadcasts", "broadcast_inbox",
    "personal_messages",
    "notifications", "push_log", "push_register_log",
    "assistant_conversations", "assistant_messages",
    "review_requests", "referral_attributions",
    "featured_reviews",
    "audit_log", "client_crash_log",
    "counters",
]


# Exact phrase the super_owner must type to confirm. Case-sensitive
# AND match-exact (no leading/trailing whitespace tolerance) so a
# half-asleep tap can't sneak through.
_REQUIRED_PHRASE = "RESET ENTIRE PLATFORM"


class _PlatformResetExecuteBody(BaseModel):
    confirm_phrase: str = Field(..., min_length=1)
    otp_code: str = Field(..., min_length=4, max_length=10)


def _require_super_owner(user: Dict[str, Any]) -> None:
    role = (user or {}).get("role") or ""
    if role != "super_owner":
        raise HTTPException(
            403,
            "Only the platform Super Owner can reset the entire platform.",
        )


@router.post("/api/admin/platform-reset/request-otp")
async def platform_reset_request_otp(
    request: Request,
    user: Dict[str, Any] = Depends(require_user),
):
    """Send a fresh 6-digit OTP to the super_owner's registered email
    with `purpose=platform_reset`. No data is touched yet.
    """
    _require_super_owner(user)
    email_l = (user.get("email") or "").lower().strip()
    if not email_l:
        raise HTTPException(400, "Your account has no email on file.")

    await db.auth_otp_codes.delete_many({"email": email_l, "purpose": "platform_reset"})
    code = f"{_secrets.randbelow(1000000):06d}"
    await db.auth_otp_codes.insert_one({
        "email": email_l,
        "purpose": "platform_reset",
        "code": code,
        "expires_at": datetime.now(timezone.utc) + timedelta(minutes=10),
        "attempts": 0,
        "created_at": datetime.now(timezone.utc),
    })

    from server import _send_email  # local import — avoid circulars
    html = f"""
<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111">
  <h2 style="color:#7F1D1D;margin:0 0 8px">☢️ PLATFORM-WIDE Reset Confirmation</h2>
  <p>A <b>platform-wide</b> reset has been requested from the ConsultUro app.
     This will erase clinical &amp; operational data for <b>EVERY clinic</b>
     on the platform — not just one.</p>
  <div style="font-size:36px;letter-spacing:6px;font-weight:700;background:#FEE2E2;color:#7F1D1D;padding:16px 24px;border-radius:10px;text-align:center;margin:18px 0;display:inline-block">
    {code}
  </div>
  <p style="font-size:13px;color:#666">This code expires in 10 minutes.</p>
  <p style="font-size:13px;color:#7F1D1D;margin-top:14px">
    <b>This is a Super-Owner-only action.</b> Every clinic admin,
    partner, doctor, nurse, reception &amp; patient on the platform
    will see their records empty within seconds of confirmation.
    Make sure platform-wide backups exist BEFORE you confirm.
  </p>
  <p style="font-size:12px;color:#999;margin-top:18px">If you did NOT request this, ignore this email — no data has been touched.</p>
</div>"""
    sent = _send_email(email_l, "ConsultUro Platform-Reset code", html)
    if not sent:
        raise HTTPException(502, "Could not deliver the confirmation email.")
    return {"ok": True, "sent_to": email_l}


@router.post("/api/admin/platform-reset/execute")
async def platform_reset_execute(
    request: Request,
    body: _PlatformResetExecuteBody,
    user: Dict[str, Any] = Depends(require_user),
):
    """Verify the confirm phrase + OTP, then wipe every operational
    collection across the ENTIRE platform (no clinic_id filter).

    Returns per-collection deletion counts + total. Also records a
    `platform_reset.executed` row in audit_log post-reset.
    """
    _require_super_owner(user)

    # 1. Exact-phrase match (case-sensitive, no trim).
    if (body.confirm_phrase or "") != _REQUIRED_PHRASE:
        raise HTTPException(
            400,
            f'Confirmation phrase must be exactly "{_REQUIRED_PHRASE}" (case-sensitive).',
        )

    # 2. OTP match.
    email_l = (user.get("email") or "").lower().strip()
    rec = await db.auth_otp_codes.find_one({"email": email_l, "purpose": "platform_reset"})
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
    await db.auth_otp_codes.delete_one({"_id": rec["_id"]})

    # 3. (Skipped) Pre-wipe audit insert — would be immediately
    #    destroyed by step 4 since `audit_log` is in the wipe list.
    #    The surviving post-wipe `platform_reset.completed` row at the
    #    bottom of this function is the only audit anchor we need.

    # 4. Wipe — NO clinic_id filter, i.e. across all tenants.
    #    For each collection we report (deleted_count, count_of_clinics_touched).
    deleted: Dict[str, int] = {}
    for coll_name in _COLLECTIONS_TO_WIPE:
        try:
            coll = db[coll_name]
            res = await coll.delete_many({})
            deleted[coll_name] = int(res.deleted_count or 0)
        except Exception as exc:
            deleted[coll_name] = -1
            print(f"[platform-reset] {coll_name} wipe failed: {exc}")

    # 5. Surviving audit marker.
    try:
        await db.audit_log.insert_one({
            "clinic_id": "*platform*",
            "actor_id": user.get("user_id"),
            "actor_email": email_l,
            "actor_role": user.get("role"),
            "event": "platform_reset.completed",
            "deleted_counts": deleted,
            "ts": datetime.now(timezone.utc),
        })
    except Exception:
        pass

    # Count distinct clinics that survived (i.e. preserved tenant
    # records) so the UI can reassure the super_owner the multi-
    # tenant skeleton is intact.
    try:
        clinics_preserved = await db.clinics.count_documents({})
    except Exception:
        clinics_preserved = -1

    total_deleted = sum(v for v in deleted.values() if v > 0)
    return {
        "ok": True,
        "deleted_total": total_deleted,
        "deleted": deleted,
        "clinics_preserved": clinics_preserved,
    }
