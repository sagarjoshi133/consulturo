"""ConsultUro — Registration-number allocator.

`allocate_reg_no(phone)` returns a stable 9-digit reg-no per patient
(format SSSDDMMYY). `get_or_set_reg_no(phone, explicit)` honours an
explicit reg-no override if supplied (used during prescription
creation when the doctor manually edits the field).
"""
import re
from datetime import datetime, timezone, timedelta
from typing import Optional

from pymongo import ReturnDocument

from db import db

# IST offset — used for the day-key portion of the reg-no so the
# allocator rolls over at midnight IST not UTC.
IST_OFFSET = timedelta(hours=5, minutes=30)


def _normalize_phone(raw: Optional[str]) -> str:
    """Return the last 10 digits of a phone number (Indian normalisation)."""
    digits = re.sub(r"\D", "", raw or "")
    return digits[-10:] if len(digits) >= 10 else digits

async def allocate_reg_no(phone: Optional[str], name: Optional[str] = None) -> Optional[str]:
    """Return a stable 9-digit registration number for this patient.
    Format: SSSDDMMYY where SSS is a zero-padded daily sequence (resets each day).
    If the phone is already known, the previously-allocated reg_no is returned
    (so the same patient keeps one reg_no across bookings/Rx/surgery)."""
    p = _normalize_phone(phone)
    if not p:
        return None
    existing = await db.patients.find_one({"phone": p}, {"_id": 0})
    if existing and existing.get("reg_no"):
        return existing["reg_no"]
    today_local = (datetime.now(timezone.utc) + IST_OFFSET).date()
    day_key = today_local.strftime("%d%m%y")
    counter_key = today_local.strftime("%Y-%m-%d")
    # Atomic increment-and-return of the daily counter.
    res = await db.counters.find_one_and_update(
        {"key": counter_key},
        {"$inc": {"count": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    seq = res.get("count", 1)
    reg_no = f"{seq:03d}{day_key}"
    await db.patients.update_one(
        {"phone": p},
        {
            "$set": {
                "phone": p,
                "reg_no": reg_no,
                "name": name,
                "updated_at": datetime.now(timezone.utc),
            },
            "$setOnInsert": {"first_seen_at": datetime.now(timezone.utc)},
        },
        upsert=True,
    )
    return reg_no

async def get_or_set_reg_no(phone: Optional[str], explicit: Optional[str], name: Optional[str] = None) -> Optional[str]:
    """If caller supplied an explicit reg_no, honour it (upsert against patient).
    Otherwise allocate a new one (or reuse existing)."""
    p = _normalize_phone(phone)
    if not p:
        return (explicit or "").strip() or None
    explicit = (explicit or "").strip() or None
    if explicit:
        await db.patients.update_one(
            {"phone": p},
            {
                "$set": {
                    "phone": p,
                    "reg_no": explicit,
                    "name": name,
                    "updated_at": datetime.now(timezone.utc),
                },
                "$setOnInsert": {"first_seen_at": datetime.now(timezone.utc)},
            },
            upsert=True,
        )
        return explicit
    return await allocate_reg_no(p, name)
