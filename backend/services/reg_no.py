"""ConsultUro — Registration-number allocator.

`allocate_reg_no(phone, email)` returns a stable 9-digit reg-no per
patient (format SSSDDMMYY). Phone is the strong identity key; email
is a secondary lookup key that auto-merges into a phone-matched
record when a new booking arrives with both phone+email and the
existing record has no email yet (Dr. Joshi spec 2026-05-21 — option
C, "auto-merge if a phone-match patient has no email and a new
booking arrives with that phone + a new email → attach the email to
the existing record").

`get_or_set_reg_no(phone, explicit, …)` honours an explicit reg-no
override if supplied (used during prescription creation when the
doctor manually edits the field).
"""
import re
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any

from pymongo import ReturnDocument

from db import db

# IST offset — used for the day-key portion of the reg-no so the
# allocator rolls over at midnight IST not UTC.
IST_OFFSET = timedelta(hours=5, minutes=30)


def _normalize_phone(raw: Optional[str]) -> str:
    """Return the last 10 digits of a phone number (Indian normalisation)."""
    digits = re.sub(r"\D", "", raw or "")
    return digits[-10:] if len(digits) >= 10 else digits


def _normalize_email(raw: Optional[str]) -> str:
    """Lower-case and trim. Returns '' for invalid / missing."""
    e = (raw or "").strip().lower()
    return e if "@" in e else ""


async def _resolve_patient(phone: str, email: str) -> Optional[Dict[str, Any]]:
    """Look up an existing patient by phone first, then email.

    Returns the matched doc (or None). Phone wins if both keys match
    different rows — see Dr. Joshi spec 2026-05-21 (phone is the
    strong identity key).
    """
    if phone:
        row = await db.patients.find_one({"phone": phone}, {"_id": 0})
        if row:
            return row
    if email:
        row = await db.patients.find_one({"email": email}, {"_id": 0})
        if row:
            return row
    return None


async def _maybe_merge_email(phone: str, email: str) -> None:
    """If a phone-matched patient has no email yet AND we received a
    new email this round, attach it to the existing record (auto-
    merge). Idempotent — safe to call on every allocation."""
    if not phone or not email:
        return
    # NOTE: NO projection here on purpose — `find_one(filter, {"email":1})`
    # returns `{}` for rows missing the field, and `{} and …` short-
    # circuits to falsy, silently skipping the update. Keep the full
    # doc so the truthiness check below is on the doc itself.
    existing = await db.patients.find_one({"phone": phone})
    if existing is not None and not (existing.get("email") or "").strip():
        await db.patients.update_one(
            {"phone": phone},
            {
                "$set": {
                    "email": email,
                    "email_attached_at": datetime.now(timezone.utc),
                    "updated_at": datetime.now(timezone.utc),
                }
            },
        )


async def allocate_reg_no(
    phone: Optional[str],
    name: Optional[str] = None,
    email: Optional[str] = None,
) -> Optional[str]:
    """Return a stable 9-digit registration number for this patient.

    Format: SSSDDMMYY where SSS is a zero-padded daily sequence (resets each day).
    Identity rules (2026-05-21):
      • Phone match → reuse that patient's reg_no.
      • Phone empty + email match → reuse that patient's reg_no.
      • New phone + new email → fresh allocation, doc stores both keys.
      • Phone match + new email → auto-merge email into existing doc.
    """
    p = _normalize_phone(phone)
    e = _normalize_email(email)

    # If neither key is present we can't allocate.
    if not p and not e:
        return None

    # Look up existing record by either key (phone wins on conflict).
    existing = await _resolve_patient(p, e)
    if existing and existing.get("reg_no"):
        # Auto-merge email if the matched record was found via phone
        # but the caller now supplied an email.
        await _maybe_merge_email(p, e)
        return existing["reg_no"]

    # Fresh allocation — atomic daily counter.
    today_local = (datetime.now(timezone.utc) + IST_OFFSET).date()
    day_key = today_local.strftime("%d%m%y")
    counter_key = today_local.strftime("%Y-%m-%d")
    res = await db.counters.find_one_and_update(
        {"key": counter_key},
        {"$inc": {"count": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    seq = res.get("count", 1)
    reg_no = f"{seq:03d}{day_key}"

    # Build the upsert filter — prefer phone, fallback to email.
    filt: Dict[str, Any] = {"phone": p} if p else {"email": e}
    set_fields: Dict[str, Any] = {
        "reg_no": reg_no,
        "name": name,
        "updated_at": datetime.now(timezone.utc),
    }
    if p:
        set_fields["phone"] = p
    if e:
        set_fields["email"] = e
    await db.patients.update_one(
        filt,
        {
            "$set": set_fields,
            "$setOnInsert": {"first_seen_at": datetime.now(timezone.utc)},
        },
        upsert=True,
    )
    return reg_no


async def get_or_set_reg_no(
    phone: Optional[str],
    explicit: Optional[str],
    name: Optional[str] = None,
    email: Optional[str] = None,
) -> Optional[str]:
    """If caller supplied an explicit reg_no, honour it (upsert against patient).
    Otherwise allocate a new one (or reuse existing). Email is stored
    on the patient record if supplied (auto-merge via allocate_reg_no)."""
    p = _normalize_phone(phone)
    e = _normalize_email(email)
    explicit = (explicit or "").strip() or None

    if not p and not e:
        return explicit

    if explicit:
        filt: Dict[str, Any] = {"phone": p} if p else {"email": e}
        set_fields: Dict[str, Any] = {
            "reg_no": explicit,
            "name": name,
            "updated_at": datetime.now(timezone.utc),
        }
        if p:
            set_fields["phone"] = p
        if e:
            set_fields["email"] = e
        await db.patients.update_one(
            filt,
            {
                "$set": set_fields,
                "$setOnInsert": {"first_seen_at": datetime.now(timezone.utc)},
            },
            upsert=True,
        )
        # Attempt email-merge if an existing phone-matched record had
        # no email and the caller just supplied one.
        await _maybe_merge_email(p, e)
        return explicit

    return await allocate_reg_no(p, name=name, email=e)
