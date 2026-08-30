"""ConsultUro 2.0 — Phase D: patient registry router.

  · GET  /api/registry/patients                — search (patient-db capability)
  · GET  /api/registry/patients/{patient_id}   — profile + cross-module history
  · POST /api/registry/patients                — staff get-or-create
  · POST /api/registry/patients/{id}/merge     — owner: merge duplicates
"""
from __future__ import annotations

import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from auth_deps import require_owner
from db import db
from repositories.patients import patients as patients_repo
from services.capabilities import require_capability
from services.tenancy import resolve_clinic_id, tenant_filter

router = APIRouter()

require_registry_access = require_capability(
    "access_patient_db",
    detail="Patient Database access not granted. Ask a primary owner to enable it for your account.",
)

_ACTIVITY_SORT = {
    "bookings": ("booking_date", -1),
    "prescriptions": ("created_at", -1),
    "surgeries": ("date", -1),
    "receipts": ("created_at", -1),
}

# ── Registered-set cache ─────────────────────────────────────────────
# The Patients screen opens THREE endpoints at once (search list,
# /summary badges, /invites/analytics) and each previously streamed the
# ENTIRE users collection to work out which registry rows have an
# account. On a production Atlas cluster (~0.5s round-trips + real user
# volume) that tripled a multi-second scan on every screen open. We now
# compute the registered phone/email sets ONCE and cache them briefly so
# the three parallel calls (and rapid tab re-opens) reuse one sweep.
import time as _time
_REG_SET_TTL_S = 30.0
_reg_set_cache: Dict[str, Any] = {"at": 0.0, "phones": set(), "emails": set()}


async def _get_registered_sets() -> tuple:
    """Return (registered_phones:set, registered_emails:set), cached for
    _REG_SET_TTL_S seconds to avoid re-scanning `users` on every call."""
    now = _time.monotonic()
    if now - _reg_set_cache["at"] < _REG_SET_TTL_S and _reg_set_cache["phones"] is not None:
        return _reg_set_cache["phones"], _reg_set_cache["emails"]
    phones: set = set()
    emails: set = set()
    async for u in db.users.find(
        {"role": {"$in": ["patient", None]}},
        {"_id": 0, "phone": 1, "email": 1},
    ):
        ph = re.sub(r"\D", "", u.get("phone") or "")
        if ph:
            phones.add(ph[-10:])
        em = (u.get("email") or "").strip().lower()
        if em:
            emails.add(em)
    _reg_set_cache.update({"at": now, "phones": phones, "emails": emails})
    return phones, emails


def _iso(row: Dict[str, Any]) -> Dict[str, Any]:
    for k, v in list(row.items()):
        if isinstance(v, datetime):
            row[k] = v.isoformat()
    return row


@router.get("/api/registry/patients")
async def search_patients(q: str = "", limit: int = 50, skip: int = 0,
                          registration_status: str = "all",
                          user=Depends(require_registry_access)):
    """Search the canonical patient registry.

    `registration_status`:
      * `all`          — every non-merged row (default).
      * `registered`   — rows whose phone/email matches a `users` doc
                          with role='patient' (they have an account).
      * `unregistered` — rows with NO matching patient user account.
                          These are typically walk-in / phone-in bookings
                          from people who never signed up; their contact
                          details are captured so staff can convert them
                          into registered patients later.
    """
    limit = max(1, min(int(limit or 50), 200))
    skip = max(0, int(skip or 0))
    status = (registration_status or "all").lower().strip()
    if status not in ("all", "registered", "unregistered", "stale_invite"):
        raise HTTPException(status_code=400,
                             detail="registration_status must be all|registered|unregistered|stale_invite")

    # Patients invited on/before this cutoff who still haven't signed up
    # are surfaced for a gentle re-invite (7-day nudge window).
    reinvite_cutoff = datetime.now(timezone.utc) - timedelta(days=7)

    flt: Dict[str, Any] = {}
    qs = (q or "").strip()
    if qs:
        safe = re.escape(qs)
        digits = re.sub(r"\D", "", qs)
        ors: List[Dict[str, Any]] = [
            {"name": {"$regex": safe, "$options": "i"}},
            {"reg_no": {"$regex": safe, "$options": "i"}},
            {"email": {"$regex": safe, "$options": "i"}},
        ]
        if digits:
            ors.append({"phone_digits": {"$regex": digits + "$"}})
        flt["$or"] = ors

    # ── Registration-status classification ──
    # A patient is REGISTERED if a `users` row exists with matching
    # normalised phone (last-10 digits) OR email. This runs as a fast
    # $in filter after we materialise the set of patient user IDs.
    # (Sets are cached — also reused below to annotate needs_reinvite.)
    registered_phones, registered_emails = await _get_registered_sets()
    if status in ("registered", "unregistered", "stale_invite"):
        if status == "registered":
            flt.setdefault("$and", [])
            flt["$and"].append({
                "$or": [
                    {"phone_digits": {"$in": list(registered_phones)}},
                    {"email": {"$in": list(registered_emails)}},
                ]
            })
        else:  # unregistered OR stale_invite (both exclude registered rows)
            flt.setdefault("$and", [])
            flt["$and"].append({
                "phone_digits": {"$nin": list(registered_phones)},
                "email": {"$nin": list(registered_emails)},
            })
            if status == "stale_invite":
                # invited at least 7 days ago and still not signed up
                flt["$and"].append({"invited_at": {"$lte": reinvite_cutoff}})

    rows = await patients_repo.search(flt, limit=limit, skip=skip)

    # Annotate each row with needs_reinvite so the UI can badge stale
    # invites in any tab (unregistered + invited ≥7d ago).
    def _annotate(r: Dict[str, Any]) -> Dict[str, Any]:
        out = _iso(r)
        phone_d = r.get("phone_digits")
        email_l = (r.get("email") or "").lower()
        is_registered = (phone_d in registered_phones) or (email_l and email_l in registered_emails)
        inv = r.get("invited_at")
        inv_dt: Optional[datetime] = None
        if isinstance(inv, datetime):
            inv_dt = inv if inv.tzinfo else inv.replace(tzinfo=timezone.utc)
        elif isinstance(inv, str) and inv:
            try:
                inv_dt = datetime.fromisoformat(inv.replace("Z", "+00:00"))
                if not inv_dt.tzinfo:
                    inv_dt = inv_dt.replace(tzinfo=timezone.utc)
            except Exception:
                inv_dt = None
        invited_stale = inv_dt is not None and inv_dt <= reinvite_cutoff
        out["needs_reinvite"] = bool((not is_registered) and invited_stale)
        return out

    return {"items": [_annotate(r) for r in rows], "limit": limit, "skip": skip,
             "registration_status": status}


@router.get("/api/registry/patients/summary")
async def registry_summary(user=Depends(require_registry_access)):
    """One-shot counts for tab badges: total, registered, unregistered.

    Cheap enough to hit on every screen open — uses a single (cached)
    sweep of `db.users` to build the registered set, then two counts.
    """
    reg_phones, reg_emails = await _get_registered_sets()
    registered_phones = list(reg_phones)
    registered_emails = list(reg_emails)
    total = await db.patients.count_documents({"merged_into": {"$exists": False}})
    registered = await db.patients.count_documents({
        "merged_into": {"$exists": False},
        "$or": [
            {"phone_digits": {"$in": registered_phones}},
            {"email": {"$in": registered_emails}},
        ],
    })
    # Stale invites: unregistered + invited ≥7 days ago (re-invite nudge).
    reinvite_cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    stale_invite = await db.patients.count_documents({
        "merged_into": {"$exists": False},
        "phone_digits": {"$nin": registered_phones},
        "email": {"$nin": registered_emails},
        "invited_at": {"$lte": reinvite_cutoff},
    })
    return {
        "total": int(total),
        "registered": int(registered),
        "unregistered": int(total) - int(registered),
        "stale_invite": int(stale_invite),
    }


@router.get("/api/registry/patients/{patient_id}")
async def patient_profile(patient_id: str, request: Request,
                          user=Depends(require_registry_access)):
    """Unified patient view — profile + bookings / prescriptions /
    surgeries / receipts, joined by the canonical patient_id (indexed)
    with a phone-suffix fallback for legacy unstamped rows."""
    row = await patients_repo.get_active(patient_id)
    if not row:
        raise HTTPException(status_code=404, detail="Patient not found")

    clinic_id = await resolve_clinic_id(request, user)
    tenant = tenant_filter(user, clinic_id, allow_global=True)

    ors: List[Dict[str, Any]] = [{"patient_id": row["patient_id"]}]
    digits = row.get("phone_digits") or re.sub(r"\D", "", row.get("phone") or "")[-10:]
    if digits:
        ors.append({"patient_phone": {"$regex": re.escape(digits) + "$"}})
    hist_q = {"$or": ors, **tenant}

    out: Dict[str, Any] = {"profile": _iso(dict(row))}
    counts: Dict[str, int] = {}
    for coll, (sort_key, direction) in _ACTIVITY_SORT.items():
        items = []
        async for r in db[coll].find(hist_q, {"_id": 0}).sort(sort_key, direction).limit(50):
            items.append(_iso(r))
        out[coll] = items
        counts[coll] = len(items)
    out["counts"] = counts
    return out


class PatientUpsertBody(BaseModel):
    phone: Optional[str] = None
    email: Optional[str] = None
    name: Optional[str] = None
    age: Optional[str] = None
    gender: Optional[str] = None
    address: Optional[str] = None
    registration_no: Optional[str] = None


@router.post("/api/registry/patients")
async def upsert_patient(body: PatientUpsertBody, user=Depends(require_registry_access)):
    """Get-or-create a canonical patient. Allocates a reg_no when the
    row doesn't have one yet (same allocator as bookings/Rx)."""
    from services.patient_registry import resolve_patient
    from services.reg_no import get_or_set_reg_no

    if not (body.phone or body.email):
        raise HTTPException(status_code=400, detail="phone or email required")
    row = await resolve_patient(
        phone=body.phone, email=body.email, name=body.name,
        reg_no=(body.registration_no or "").strip() or None,
        age=body.age, gender=body.gender, address=body.address,
        create=True,
    )
    if not row.get("reg_no"):
        reg = await get_or_set_reg_no(body.phone, body.registration_no, body.name, email=body.email)
        if reg:
            await db.patients.update_one(
                {"patient_id": row["patient_id"]}, {"$set": {"reg_no": reg}}
            )
            row["reg_no"] = reg
    return {"ok": True, "patient": _iso(dict(row))}


class MergeBody(BaseModel):
    duplicate_patient_id: str


# ── Invite Walk-Ins & Duplicate Detection ──────────────────────

def _last10(raw: Optional[str]) -> str:
    return re.sub(r"\D", "", raw or "")[-10:]


def _norm_name(raw: Optional[str]) -> str:
    return re.sub(r"\s+", " ", (raw or "").strip().lower())


@router.post("/api/registry/patients/{patient_id}/invite")
async def invite_patient(patient_id: str, user=Depends(require_registry_access)):
    """Generate a signup-invite share payload for a walk-in patient.

    Never sends anything itself — returns a ready-to-share bundle
    (WhatsApp URL, SMS body, mailto link, magic link if email present)
    so the staff can pick the channel their patient prefers. Also
    stamps `invited_at` / `invite_count` on the registry row and
    audits the action.

    Idempotent: re-inviting simply re-issues a fresh magic token and
    bumps the counter.
    """
    from services.patient_registry import resolve_patient
    row = await patients_repo.get_active(patient_id)
    if not row:
        raise HTTPException(status_code=404, detail="Patient not found")

    phone_digits = row.get("phone_digits") or _last10(row.get("phone"))
    email = (row.get("email") or "").strip().lower()
    if not phone_digits and not email:
        raise HTTPException(
            status_code=400,
            detail={"error_code": "no_contact",
                    "message": "This patient has no phone or email on file."})

    # Public web-app domain (Vercel / consulturo.com) for the patient-
    # facing invite link — NOT the backend host. Override via PUBLIC_APP_URL.
    app_url = (os.environ.get("PUBLIC_APP_URL") or "https://consulturo.com").rstrip("/")

    # Prefer magic-link when we have an email — one-tap sign-in.
    magic_link_web: Optional[str] = None
    magic_link_deep: Optional[str] = None
    if email:
        import secrets as _secrets
        token = _secrets.token_urlsafe(32)
        await db.auth_magic_tokens.insert_one({
            "token": token,
            "email": email,
            "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
            "used": False,
            "created_at": datetime.now(timezone.utc),
            "kind": "walkin_invite",
            "invited_patient_id": patient_id,
            "invited_by_user_id": user.get("user_id"),
        })
        # Land directly on the web app's /magic-link route — it exchanges
        # the token via the API and signs the patient in.
        magic_link_web = f"{app_url}/magic-link?token={token}"
        magic_link_deep = f"consulturo:///magic-link?token={token}"

    # Phone-first patients get the /login web URL (they'll sign up with OTP).
    signup_web = f"{app_url}/login?ref=walkin"
    join_url = magic_link_web or signup_web

    # ── Compose share-ready message ──
    name = row.get("name") or "there"
    clinic_row = await db.clinics.find_one({"deleted_at": None},
                                              {"_id": 0, "name": 1}) or {}
    clinic_name = clinic_row.get("name") or "ConsultUro"
    msg_lines = [
        f"Hi {name.split(' ')[0]},",
        f"{clinic_name} has saved your details after your visit.",
        "Tap the link below to sign in — you'll be able to see your "
        "prescriptions, upcoming appointments, and message the clinic "
        "directly from the app.",
        "",
        join_url,
    ]
    share_message = "\n".join(msg_lines)

    # WhatsApp URL — only usable if we have a phone number.
    wa_url: Optional[str] = None
    if phone_digits:
        # Prefix with country code if we have one on file; default +91.
        cc = re.sub(r"\D", "", row.get("country_code") or "91") or "91"
        wa_digits = f"{cc}{phone_digits[-10:]}"
        # Use the *encoded* body so any newlines/emojis render safely.
        try:
            from urllib.parse import quote_plus as _qp
        except Exception:
            _qp = lambda s: s
        wa_url = f"https://wa.me/{wa_digits}?text={_qp(share_message)}"

    # Native SMS URI — the frontend uses Linking.openURL('sms:...').
    sms_uri: Optional[str] = None
    if phone_digits:
        try:
            from urllib.parse import quote as _q
        except Exception:
            _q = lambda s: s
        sms_uri = f"sms:{phone_digits}?body={_q(share_message)}"

    # mailto for when we only have an email.
    mailto_uri: Optional[str] = None
    if email:
        try:
            from urllib.parse import quote as _q
        except Exception:
            _q = lambda s: s
        subject = _q(f"Your ConsultUro sign-in link")
        body = _q(share_message)
        mailto_uri = f"mailto:{email}?subject={subject}&body={body}"

    # ── Record the invite on the registry row ──
    now = datetime.now(timezone.utc)
    await db.patients.update_one(
        {"patient_id": patient_id},
        {
            "$set": {
                "invited_at": now,
                "invited_by": user.get("user_id"),
                "updated_at": now,
            },
            "$inc": {"invite_count": 1},
        },
    )

    return {
        "ok": True,
        "patient_id": patient_id,
        "join_url": join_url,
        "share_message": share_message,
        "wa_url": wa_url,
        "sms_uri": sms_uri,
        "mailto_uri": mailto_uri,
        "invited_at": now.isoformat(),
    }


@router.get("/api/registry/patients/{patient_id}/duplicates")
async def find_duplicates(patient_id: str, user=Depends(require_registry_access)):
    """Return candidate duplicate registry rows for the patient.

    Signals (never merges — only surfaces candidates):
      * STRONG — matching phone_digits (last-10) or normalised email.
      * WEAK   — normalised-name overlap (first two tokens) when neither
                 phone nor email conflict. Useful for spotting
                 walk-ins recorded twice as e.g. "Sagar J." vs
                 "Sagar Joshi".

    Excludes:
      * self
      * rows already merged (`merged_into` set)
    """
    row = await patients_repo.get_active(patient_id)
    if not row:
        raise HTTPException(status_code=404, detail="Patient not found")

    phone_digits = row.get("phone_digits") or _last10(row.get("phone"))
    email = (row.get("email") or "").strip().lower()
    name_norm = _norm_name(row.get("name"))
    name_tokens = name_norm.split()[:2]

    strong_or: List[Dict[str, Any]] = []
    if phone_digits:
        strong_or.append({"phone_digits": phone_digits})
    if email:
        strong_or.append({"email": email})

    candidates: List[Dict[str, Any]] = []
    seen: set = {patient_id}
    if strong_or:
        async for c in db.patients.find(
            {"$or": strong_or,
             "merged_into": {"$exists": False},
             "patient_id": {"$ne": patient_id}},
            {"_id": 0},
        ).limit(20):
            cid = c.get("patient_id")
            if not cid or cid in seen:
                continue
            seen.add(cid)
            reasons: List[str] = []
            if phone_digits and c.get("phone_digits") == phone_digits:
                reasons.append("same phone")
            if email and (c.get("email") or "").strip().lower() == email:
                reasons.append("same email")
            candidates.append({**_iso(dict(c)),
                                 "confidence": "strong",
                                 "reasons": reasons})

    # WEAK — name-token overlap. Skip if we already gave a strong hit
    # for the same row.
    if name_tokens:
        # Build a regex that matches first + second token (order-insensitive).
        parts = [re.escape(t) for t in name_tokens if len(t) >= 2]
        if parts:
            joined = ".*".join(parts)
            async for c in db.patients.find(
                {"name": {"$regex": joined, "$options": "i"},
                 "merged_into": {"$exists": False},
                 "patient_id": {"$ne": patient_id}},
                {"_id": 0},
            ).limit(20):
                cid = c.get("patient_id")
                if not cid or cid in seen:
                    continue
                # Skip if this candidate CONFLICTS on both phone AND email
                # (different phone AND different email = probably different
                # person with a similar name).
                c_phone = c.get("phone_digits") or _last10(c.get("phone"))
                c_email = (c.get("email") or "").strip().lower()
                if (phone_digits and c_phone and c_phone != phone_digits
                    and email and c_email and c_email != email):
                    continue
                seen.add(cid)
                candidates.append({**_iso(dict(c)),
                                     "confidence": "weak",
                                     "reasons": ["similar name"]})

    return {"ok": True, "patient_id": patient_id,
             "candidates": candidates,
             "count": len(candidates)}


@router.post("/api/registry/patients/{patient_id}/merge")
async def merge_patients(patient_id: str, body: MergeBody, user=Depends(require_owner)):
    """Merge a duplicate registry row into the canonical one: activity
    rows are re-pointed, missing profile fields are absorbed, and the
    duplicate is flagged `merged_into` (kept for audit — storage has
    no hard-delete policy for medical records)."""
    dup_id = (body.duplicate_patient_id or "").strip()
    if not dup_id or dup_id == patient_id:
        raise HTTPException(status_code=400, detail="duplicate_patient_id must differ from the target")
    keep = await patients_repo.get(patient_id)
    dup = await patients_repo.get(dup_id)
    if not keep or not dup:
        raise HTTPException(status_code=404, detail="Patient not found")
    if keep.get("merged_into") or dup.get("merged_into"):
        raise HTTPException(status_code=400, detail="One of the rows was already merged")

    now = datetime.now(timezone.utc)
    repointed: Dict[str, int] = {}
    for coll in _ACTIVITY_SORT:
        res = await db[coll].update_many(
            {"patient_id": dup_id}, {"$set": {"patient_id": patient_id}}
        )
        repointed[coll] = res.modified_count

    # Absorb missing profile fields from the duplicate.
    patch: Dict[str, Any] = {}
    for f in ("name", "reg_no", "age", "gender", "email", "address", "phone", "phone_digits"):
        if dup.get(f) and not keep.get(f):
            patch[f] = dup[f]
    patch["updated_at"] = now
    await db.patients.update_one({"patient_id": patient_id}, {"$set": patch})
    await db.patients.update_one(
        {"patient_id": dup_id},
        {"$set": {"merged_into": patient_id, "merged_at": now, "merged_by": user["user_id"]}},
    )
    return {"ok": True, "kept": patient_id, "merged": dup_id, "repointed": repointed}
