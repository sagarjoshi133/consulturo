"""ConsultUro 2.0 — Phase D: canonical patient registry.

Single source of truth for patient identity. Every patient gets a
stable `patient_id` (UUID) on the `patients` collection; all activity
rows (bookings, prescriptions, surgeries, receipts) are stamped with
it at creation, replacing fragile phone-regex joins with indexed
lookups.

Identity rules (unchanged from the reg-no allocator, Dr. Joshi spec
2026-05-21): phone (last-10-digit normalised) is the strong key;
email is the secondary key; phone wins on conflict.
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from db import db


def _last10(raw: Optional[str]) -> str:
    digits = re.sub(r"\D", "", raw or "")
    return digits[-10:] if len(digits) >= 10 else digits


def _norm_email(raw: Optional[str]) -> str:
    e = (raw or "").strip().lower()
    return e if "@" in e else ""


async def resolve_patient(
    *,
    phone: Optional[str] = None,
    email: Optional[str] = None,
    name: Optional[str] = None,
    reg_no: Optional[str] = None,
    age: Optional[Any] = None,
    gender: Optional[str] = None,
    address: Optional[str] = None,
    create: bool = True,
) -> Optional[Dict[str, Any]]:
    """Get-or-create the canonical patient row. Guarantees the returned
    row carries `patient_id` + `phone_digits`, opportunistically filling
    missing profile fields from the supplied values. Returns None when
    neither phone nor email identifies the patient."""
    p = _last10(phone)
    e = _norm_email(email)
    if not p and not e:
        return None
    now = datetime.now(timezone.utc)

    row: Optional[Dict[str, Any]] = None
    if p:
        row = await db.patients.find_one(
            {"$or": [{"phone_digits": p}, {"phone": {"$regex": re.escape(p) + "$"}}],
             "merged_into": {"$exists": False}},
            {"_id": 0},
        )
    if not row and e:
        row = await db.patients.find_one(
            {"email": e, "merged_into": {"$exists": False}}, {"_id": 0}
        )

    if row:
        patch: Dict[str, Any] = {}
        if not row.get("patient_id"):
            patch["patient_id"] = str(uuid.uuid4())
        if p and row.get("phone_digits") != p:
            patch["phone_digits"] = p
        for field, val in (
            ("name", name), ("reg_no", reg_no), ("age", age),
            ("gender", gender), ("email", e or None), ("address", address),
        ):
            if val and not row.get(field):
                patch[field] = val
        if patch:
            patch["updated_at"] = now
            filt = {"phone": row["phone"]} if row.get("phone") else {"email": row.get("email")}
            await db.patients.update_one(filt, {"$set": patch})
            row.update(patch)
        return row

    if not create:
        return None
    doc: Dict[str, Any] = {
        "patient_id": str(uuid.uuid4()),
        "phone": p or None,
        "phone_digits": p or None,
        "email": e or None,
        "name": name,
        "reg_no": reg_no,
        "age": age,
        "gender": gender,
        "address": address,
        "first_seen_at": now,
        "created_at": now,
        "updated_at": now,
    }
    await db.patients.insert_one(dict(doc))
    return doc


async def resolve_patient_id(
    phone: Optional[str] = None,
    email: Optional[str] = None,
    name: Optional[str] = None,
) -> Optional[str]:
    """Convenience: canonical patient_id (creating the registry row if
    needed) — used by booking / Rx / surgery / receipt creation."""
    row = await resolve_patient(phone=phone, email=email, name=name, create=True)
    return (row or {}).get("patient_id")
