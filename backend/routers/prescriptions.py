"""ConsultUro — prescriptions router.

  · /api/prescriptions
  · /api/prescriptions/{prescription_id}
  · /api/prescriptions/me

Extracted from server.py during Phase 3 modularization.
Behaviour preserved EXACTLY.
"""
from datetime import datetime, timezone
import uuid
import re
from typing import Any, Dict
from fastapi import APIRouter, Depends, HTTPException, Request
from db import db
from auth_deps import STAFF_ROLES, is_prescriber, require_staff, require_user
from models import PrescriptionCreate
from server import get_or_set_reg_no
from services.tenancy import resolve_clinic_id, tenant_filter

router = APIRouter()


@router.post("/api/prescriptions")
async def create_prescription(request: Request, payload: PrescriptionCreate, user=Depends(require_staff)):
    # Staff (reception/nursing/assistant) can only create DRAFT consultations
    # — they pre-fill patient details / vitals / complaints / IPSS so the
    # doctor can resume and finalise quickly. Only prescribers (owner /
    # doctor) can save a `final` Rx.
    is_rx = await is_prescriber(user)
    status = (payload.status or "final").lower().strip()
    if status not in ("draft", "final"):
        status = "final"
    if not is_rx:
        status = "draft"
    prescription_id = f"rx_{uuid.uuid4().hex[:10]}"
    # Auto-link to patient account via matching phone number so it appears in their My Records.
    patient_user_id = None
    if payload.patient_phone:
        digits = re.sub(r"\D", "", payload.patient_phone)
        if digits:
            match = await db.users.find_one({"phone_digits": digits}, {"_id": 0, "user_id": 1})
            if match:
                patient_user_id = match["user_id"]
    reg_no = await get_or_set_reg_no(payload.patient_phone, payload.registration_no, payload.patient_name)
    payload_data = payload.model_dump()
    payload_data["registration_no"] = reg_no
    payload_data["status"] = status
    # Phase E — tag the Rx with the active clinic.
    rx_clinic_id = await resolve_clinic_id(request, user)
    doc = {
        "prescription_id": prescription_id,
        "doctor_user_id": user["user_id"] if is_rx else None,
        "patient_user_id": patient_user_id,
        "created_by_user_id": user["user_id"],
        "created_by_name": user.get("name") or (user.get("email", "") or "").split("@")[0],
        "created_by_role": user.get("role"),
        "clinic_id": rx_clinic_id,
        **payload_data,
        "created_at": datetime.now(timezone.utc),
    }
    await db.prescriptions.insert_one(doc)
    doc.pop("_id", None)
    # When this Rx was created from a confirmed booking via the "Start
    # Consultation" flow, close the loop only when finalised. Drafts keep
    # the booking as `confirmed` so it stays in the upcoming consultations
    # list and the doctor can still resume.
    src_booking = (payload.source_booking_id or "").strip()
    if src_booking:
        try:
            if status == "final":
                await db.bookings.update_one(
                    {"booking_id": src_booking},
                    {
                        "$set": {
                            "status": "completed",
                            "consultation_rx_id": prescription_id,
                            "consultation_completed_at": datetime.now(timezone.utc),
                        }
                    },
                )
            else:
                # Mark which Rx is the active draft so the consults tab
                # can show "Resume draft" instead of "Start" — booking
                # status itself stays `confirmed`.
                await db.bookings.update_one(
                    {"booking_id": src_booking},
                    {
                        "$set": {
                            "draft_rx_id": prescription_id,
                            "draft_started_at": datetime.now(timezone.utc),
                            "draft_started_by": user.get("name")
                            or (user.get("email", "") or "").split("@")[0],
                        }
                    },
                )
        except Exception:
            pass
    return doc

@router.delete("/api/prescriptions/{prescription_id}")
async def delete_prescription(prescription_id: str, user=Depends(require_user)):
    """Only owner-tier roles (super_owner / primary_owner / partner) can
    permanently delete a prescription record. Note: post-migration the
    legacy `'owner'` role label no longer exists — uses
    OWNER_TIER_ROLES so partner + primary_owner both qualify."""
    from auth_deps import OWNER_TIER_ROLES
    if user.get("role") not in OWNER_TIER_ROLES:
        raise HTTPException(status_code=403, detail="Only the Primary Owner / Partner can delete prescription records")
    result = await db.prescriptions.delete_one({"prescription_id": prescription_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}

@router.put("/api/prescriptions/{prescription_id}")
async def update_prescription(prescription_id: str, payload: PrescriptionCreate, user=Depends(require_staff)):
    """Edit an existing prescription. Staff can edit DRAFTS; only prescribers
    (owner + doctor) can edit a `final` Rx or upgrade a draft → final."""
    existing = await db.prescriptions.find_one({"prescription_id": prescription_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Not found")
    is_rx = await is_prescriber(user)
    cur_status = (existing.get("status") or "final").lower()
    new_status = (payload.status or cur_status).lower().strip()
    if new_status not in ("draft", "final"):
        new_status = cur_status
    if not is_rx:
        # Non-prescribers may only edit a draft and must keep it as draft.
        if cur_status != "draft":
            raise HTTPException(status_code=403, detail="Only doctor can edit a finalised prescription")
        new_status = "draft"
    # Re-link patient user by phone (may have changed)
    patient_user_id = existing.get("patient_user_id")
    if payload.patient_phone:
        digits = re.sub(r"\D", "", payload.patient_phone)
        if digits:
            match = await db.users.find_one({"phone_digits": digits}, {"_id": 0, "user_id": 1})
            if match:
                patient_user_id = match["user_id"]
    reg_no = await get_or_set_reg_no(payload.patient_phone, payload.registration_no, payload.patient_name)
    payload_data = payload.model_dump()
    payload_data["registration_no"] = reg_no
    payload_data["patient_user_id"] = patient_user_id
    payload_data["status"] = new_status
    payload_data["updated_at"] = datetime.now(timezone.utc)
    payload_data["updated_by"] = user["user_id"]
    if is_rx and cur_status == "draft" and new_status == "final":
        payload_data["doctor_user_id"] = user["user_id"]
        payload_data["finalised_at"] = datetime.now(timezone.utc)
    await db.prescriptions.update_one(
        {"prescription_id": prescription_id},
        {"$set": payload_data},
    )
    updated = await db.prescriptions.find_one({"prescription_id": prescription_id}, {"_id": 0})
    # Mirror booking status: if a draft was just finalised, complete the
    # source booking and clear its `draft_rx_id` pointer.
    src_booking = (existing.get("source_booking_id") or payload.source_booking_id or "").strip()
    if src_booking and is_rx and new_status == "final":
        try:
            await db.bookings.update_one(
                {"booking_id": src_booking},
                {
                    "$set": {
                        "status": "completed",
                        "consultation_rx_id": prescription_id,
                        "consultation_completed_at": datetime.now(timezone.utc),
                    },
                    "$unset": {"draft_rx_id": "", "draft_started_at": "", "draft_started_by": ""},
                },
            )
        except Exception:
            pass
    return updated

@router.get("/api/prescriptions/me")
async def my_prescriptions(user=Depends(require_user)):
    # A patient may have multiple phone numbers across bookings; surface all rxs by user_id OR phone match.
    q = {"$or": [{"patient_user_id": user["user_id"]}]}
    digits = user.get("phone_digits") or None
    if digits:
        q["$or"].append({"patient_phone": {"$regex": digits[-10:]}})
    cursor = db.prescriptions.find(q, {"_id": 0}).sort("created_at", -1)
    return await cursor.to_list(length=200)

@router.get("/api/prescriptions")
async def list_prescriptions(request: Request, user=Depends(require_staff)):
    # Phase E — scope by current clinic.
    clinic_id = await resolve_clinic_id(request, user)
    q: Dict[str, Any] = tenant_filter(user, clinic_id, allow_global=True)
    cursor = db.prescriptions.find(q, {"_id": 0}).sort("created_at", -1)
    return await cursor.to_list(length=500)

@router.get("/api/prescriptions/{prescription_id}")
async def get_prescription(prescription_id: str, user=Depends(require_user)):
    """Return a prescription. Prescribers (owner/doctor/staff) can read any
    prescription; regular patients can read ONLY prescriptions issued to them
    (matched by user_id or by registration number tied to their profile)."""
    doc = await db.prescriptions.find_one({"prescription_id": prescription_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    role = user.get("role") or "patient"
    if role not in STAFF_ROLES and role not in {"prescriber", "doctor"}:
        uid = user.get("user_id")
        reg_no = (user.get("registration_no") or "").strip()
        # Patient can view ONLY their own Rx — check by linked user_id or by
        # patient registration number (the number printed on the Rx that
        # uniquely identifies this patient across visits).
        rx_uid = doc.get("user_id") or doc.get("patient_user_id")
        rx_reg = (doc.get("registration_no") or "").strip()
        owns = (uid and rx_uid and uid == rx_uid) or (
            reg_no and rx_reg and reg_no == rx_reg
        )
        if not owns:
            raise HTTPException(status_code=404, detail="Not found")
    return doc
