"""ConsultUro — patients router.

  · /api/patients/lookup
  · /api/patients/history
  · /api/patients/reg_no

Extracted from server.py during Phase 3 modularization.
Phase E (multi-tenant): scoped to current clinic via X-Clinic-Id.
"""
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from db import db
from auth_deps import require_prescriber, require_staff, require_user
from models import PatientRegManual
from server import _normalize_phone
from services.tenancy import resolve_clinic_id, tenant_filter

router = APIRouter()


def _normalise_reg_no(s: Any) -> str:
    return ("" if s is None else str(s)).strip().upper()


@router.get("/api/patients/lookup")
async def lookup_patient(
    request: Request,
    phone: Optional[str] = "",
    registration_no: Optional[str] = "",
    user=Depends(require_user),
):
    """Compact resolver — given phone OR registration_no, return a
    flat patient record suitable for prefilling a form.

    Search order:
      1. canonical `patients` collection (by phone, then by reg_no)
      2. fallback to the most-recent booking / prescription / surgery /
         receipt carrying the same identifier (so legacy data without
         a `patients` row is still reachable)

    Returns `{found:true, ...fields}` or `{found:false}`. Never throws
    on "not found" — the UI treats absence as an empty profile so the
    doctor keeps typing without being interrupted.
    """
    p = _normalize_phone(phone) if phone else ""
    r = _normalise_reg_no(registration_no)
    if not p and not r:
        return {"found": False}

    clinic_id = await resolve_clinic_id(request, user)
    tenant = tenant_filter(user, clinic_id, allow_global=True)

    # 1) Canonical patients collection — NO tenant filter here because
    # auto-allocated patient rows historically lack a clinic_id field.
    profile: Optional[Dict[str, Any]] = None
    if p:
        profile = await db.patients.find_one({"phone": p}, {"_id": 0})
    if not profile and r:
        profile = await db.patients.find_one({"reg_no": r}, {"_id": 0})
        if not profile:
            profile = await db.patients.find_one({"registration_no": r}, {"_id": 0})

    # 1b) The patients-collection row only stores phone+name+reg_no
    # (allocate_reg_no never persists age/gender/email/address). Even
    # when it returns a hit, opportunistically enrich the profile from
    # the most-recent booking/prescription/surgery so the composer
    # auto-fills every legal-detail field, not just identification.
    if profile:
        missing = not all(profile.get(k) for k in ("age", "gender", "email", "address"))
        if missing:
            suffix = (profile.get("phone") or p or "")[-10:]
            if suffix:
                enrich_q = {"patient_phone": {"$regex": suffix + "$"}, **tenant}
                for coll in (db.bookings, db.prescriptions, db.surgeries, db.receipts):
                    cand = await coll.find_one(enrich_q, {"_id": 0}, sort=[("created_at", -1)])
                    if not cand:
                        continue
                    if not profile.get("age") and cand.get("patient_age"):
                        profile["age"] = cand.get("patient_age")
                    if not profile.get("gender"):
                        profile["gender"] = cand.get("patient_gender") or cand.get("patient_sex")
                    if not profile.get("email") and cand.get("patient_email"):
                        profile["email"] = cand.get("patient_email")
                    if not profile.get("address") and cand.get("patient_address"):
                        profile["address"] = cand.get("patient_address")
                    if all(profile.get(k) for k in ("age", "gender", "email", "address")):
                        break

    # 2) Activity-table fallback (tenant-scoped — legacy phone numbers
    # can collide across clinics, so restrict to the current one).
    if not profile:
        cand: Optional[Dict[str, Any]] = None
        q_pool: List[Dict[str, Any]] = []
        if p:
            suffix = p[-10:] if len(p) >= 10 else p
            q_pool.append({"patient_phone": {"$regex": suffix + "$"}, **tenant})
        if r:
            q_pool.append({"registration_no": r, **tenant})
        for q in q_pool:
            for coll in (db.bookings, db.prescriptions, db.surgeries, db.receipts):
                cand = await coll.find_one(q, {"_id": 0}, sort=[("created_at", -1)])
                if cand:
                    break
            if cand:
                break
        if cand:
            profile = {
                "phone": p or cand.get("patient_phone"),
                "name": cand.get("patient_name"),
                "reg_no": cand.get("registration_no"),
                "age": cand.get("patient_age"),
                "gender": cand.get("patient_gender") or cand.get("patient_sex"),
                "email": cand.get("patient_email"),
                "address": cand.get("patient_address"),
            }

    if not profile:
        return {"found": False, "phone": p, "registration_no": r}

    return {
        "found": True,
        "phone": profile.get("phone") or p or "",
        "name": profile.get("name") or profile.get("patient_name") or "",
        "registration_no": profile.get("reg_no") or profile.get("registration_no") or r or "",
        "age": profile.get("age") or profile.get("patient_age"),
        "gender": profile.get("gender") or profile.get("patient_gender"),
        "email": profile.get("email") or profile.get("patient_email"),
        "address": profile.get("address") or profile.get("patient_address"),
        "first_seen_at": (
            profile.get("first_seen_at").isoformat()
            if isinstance(profile.get("first_seen_at"), datetime)
            else profile.get("first_seen_at")
        ),
    }


@router.get("/api/patients/history")
async def patient_history_by_phone(request: Request, phone: str = "", user=Depends(require_staff)):
    """Full booking history for a given phone number. Used by the staff
    booking-detail screen to show 'Same patient history' inline."""
    p = _normalize_phone(phone)
    if not p:
        raise HTTPException(status_code=400, detail="Phone required")
    suffix = p[-10:] if len(p) >= 10 else p
    clinic_id = await resolve_clinic_id(request, user)
    q: Dict[str, Any] = {
        "patient_phone": {"$regex": f"{suffix}$"},
        **tenant_filter(user, clinic_id, allow_global=True),
    }
    cursor = db.bookings.find(q, {"_id": 0}).sort("created_at", -1)
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
    # Phase D — ensure the row carries canonical patient_id/phone_digits.
    from services.patient_registry import resolve_patient_id
    await resolve_patient_id(p, None, body.name)
    return {"ok": True, "phone": p, "registration_no": reg}
