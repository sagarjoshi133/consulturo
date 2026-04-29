"""ConsultUro — patients router.

  · /api/patients/lookup
  · /api/patients/history
  · /api/patients/reg_no

Extracted from server.py during Phase 3 modularization.
Behaviour preserved EXACTLY.
"""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from db import db
from auth_deps import require_prescriber, require_staff
from models import PatientRegManual
from server import _normalize_phone

router = APIRouter()


@router.get("/api/patients/lookup")
async def lookup_patient(phone: str = "", user=Depends(require_staff)):
    """Find a patient by phone (last-10-digit normalised) — used by staff forms
    to pre-fill name and reg_no when entering a repeat visitor."""
    p = _normalize_phone(phone)
    if not p:
        raise HTTPException(status_code=400, detail="Phone required")
    doc = await db.patients.find_one({"phone": p}, {"_id": 0})
    if not doc:
        return {"found": False, "phone": p}
    return {"found": True, **doc}

@router.get("/api/patients/history")
async def patient_history_by_phone(phone: str = "", user=Depends(require_staff)):
    """Full booking history for a given phone number. Used by the staff
    booking-detail screen to show 'Same patient history' inline."""
    p = _normalize_phone(phone)
    if not p:
        raise HTTPException(status_code=400, detail="Phone required")
    suffix = p[-10:] if len(p) >= 10 else p
    cursor = db.bookings.find(
        {"patient_phone": {"$regex": f"{suffix}$"}},
        {"_id": 0},
    ).sort("created_at", -1)
    bookings = await cursor.to_list(length=100)
    return {"phone": p, "count": len(bookings), "bookings": bookings}

@router.patch("/api/patients/reg_no")
async def set_patient_reg_no(body: PatientRegManual, user=Depends(require_prescriber)):
    """Allow clinicians to manually assign / override a patient's reg_no (e.g. when
    merging legacy records or correcting a misallocation)."""
    p = _normalize_phone(body.phone)
    if not p:
        raise HTTPException(status_code=400, detail="Phone required")
    reg = (body.registration_no or "").strip()
    if not reg:
        raise HTTPException(status_code=400, detail="Registration number required")
    await db.patients.update_one(
        {"phone": p},
        {
            "$set": {
                "phone": p,
                "reg_no": reg,
                "name": body.name,
                "updated_at": datetime.now(timezone.utc),
            },
            "$setOnInsert": {"first_seen_at": datetime.now(timezone.utc)},
        },
        upsert=True,
    )
    # Back-fill existing records for this phone so everything matches.
    await db.bookings.update_many({"patient_phone": {"$regex": p + "$"}}, {"$set": {"registration_no": reg}})
    await db.prescriptions.update_many({"patient_phone": {"$regex": p + "$"}}, {"$set": {"registration_no": reg}})
    await db.surgeries.update_many({"patient_phone": {"$regex": p + "$"}}, {"$set": {"registration_no": reg}})
    return {"ok": True, "phone": p, "registration_no": reg}
