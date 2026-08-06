"""ConsultUro — Medical Certificate router.

Endpoints (all owner-tier or prescriber-permitted):
  · POST   /api/medical-certificates           — create
  · GET    /api/medical-certificates           — list (filter by patient_phone / status)
  · GET    /api/medical-certificates/{id}      — single
  · PUT    /api/medical-certificates/{id}      — edit (issuer + 24-hour grace)
  · DELETE /api/medical-certificates/{id}      — soft-delete (owner only)
  · GET    /api/medical-certificates/{id}/pdf  — render as PDF (HTML→print)

Certificate kinds:
  - sick_leave       — "patient unfit for duty for N days"
  - fitness          — "patient fit to resume duty / travel / sports"
  - unfit_for_duty   — long-term incapacity for work
  - medical_summary  — free-text summary for insurance / school

Branding is pulled from clinic_settings (clinic_name, address, phone,
doctor name, registration number, signature image).  The PDF uses a
**gold accent** so medical certificates stand out from the teal
prescription / green receipt themes (Dr. Joshi spec 2026-06-01).
"""
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from db import db
from auth_deps import is_super_owner, require_user
from services.tenancy import resolve_clinic_id

router = APIRouter()


# ─── Pydantic models ──────────────────────────────────────────────


VALID_KINDS = {"sick_leave", "fitness", "unfit_for_duty", "medical_summary"}


class MedicalCertificateBody(BaseModel):
    kind: str = "sick_leave"
    patient_name: str
    patient_phone: Optional[str] = None
    patient_email: Optional[str] = None
    patient_age: Optional[int] = None
    patient_gender: Optional[str] = None
    patient_address: Optional[str] = None
    registration_no: Optional[str] = None
    # Clinical context
    diagnosis: str = ""
    advice: str = ""
    # Date range (used by sick_leave / unfit_for_duty)
    start_date: Optional[str] = None   # YYYY-MM-DD
    end_date: Optional[str] = None     # YYYY-MM-DD
    days: Optional[int] = None
    resume_date: Optional[str] = None  # YYYY-MM-DD (when patient may resume duty)
    # Phase 5.12 — extended clinical fields rendered in the new
    # Rx-styled Medical Certificate template (consultation /
    # admission / surgery / discharge timeline).
    consultation_date: Optional[str] = None  # YYYY-MM-DD — date the patient was last consulted
    admission_date: Optional[str] = None     # YYYY-MM-DD — IPD admission, if applicable
    surgery_date: Optional[str] = None       # YYYY-MM-DD — date of surgery, if applicable
    surgery_name: Optional[str] = None       # e.g. "TURP" / "URSL + DJ stenting"
    discharge_date: Optional[str] = None     # YYYY-MM-DD — discharge date, if applicable
    # Address — to / employer / school
    addressed_to: Optional[str] = None
    # Free-text summary used by `medical_summary` kind
    summary: Optional[str] = ""
    # Issuer override (defaults to current doctor / clinic owner)
    doctor_name: Optional[str] = None
    doctor_reg_no: Optional[str] = None
    # Soft-publish guard
    status: Optional[str] = Field(default="published", pattern="^(draft|published)$")


# ─── Helpers ─────────────────────────────────────────────────────


async def _require_certificate_writer(user: Dict[str, Any]) -> None:
    """Owner-tier OR anyone with `can_prescribe` may issue medical
    certificates (matches the prescription gate exactly — same
    clinical authority requirement)."""
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    role = user.get("role")
    if role in {"super_owner", "primary_owner", "owner", "partner"}:
        return
    if bool(user.get("can_prescribe")):
        return
    raise HTTPException(
        status_code=403,
        detail="Only prescribers can issue medical certificates. Ask the owner to grant 'Can prescribe' on the team panel.",
    )


# ─── Endpoints ────────────────────────────────────────────────────


@router.post("/api/medical-certificates")
async def create_certificate(request: Request, body: MedicalCertificateBody, user=Depends(require_user)):
    await _require_certificate_writer(user)
    if body.kind not in VALID_KINDS:
        raise HTTPException(status_code=400, detail=f"Invalid kind. Choose from {sorted(VALID_KINDS)}.")
    if not (body.patient_name or "").strip():
        raise HTTPException(status_code=400, detail="Patient name is required.")
    clinic_id = await resolve_clinic_id(request, user)
    cert_id = f"mc_{uuid.uuid4().hex[:10]}"
    now = datetime.now(timezone.utc)
    doc = body.model_dump()
    doc.update({
        "cert_id": cert_id,
        "clinic_id": clinic_id,
        "issued_by": user.get("user_id"),
        "issued_by_name": user.get("name"),
        "issued_by_email": (user.get("email") or "").lower(),
        "doctor_name": (body.doctor_name or user.get("name") or "").strip(),
        "doctor_reg_no": (body.doctor_reg_no or "").strip(),
        "created_at": now,
        "updated_at": now,
        "deleted_at": None,
    })
    await db.medical_certificates.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.get("/api/medical-certificates")
async def list_certificates(
    request: Request,
    patient_phone: Optional[str] = None,
    kind: Optional[str] = None,
    limit: int = 100,
    user=Depends(require_user),
):
    """List active certificates for the current clinic. Patient-side
    callers can pass their own phone to fetch only their own
    certificates."""
    await _require_certificate_writer(user) if user.get("role") != "patient" else None
    q: Dict[str, Any] = {"deleted_at": None}
    clinic_id = await resolve_clinic_id(request, user)
    if clinic_id:
        q["clinic_id"] = clinic_id
    if patient_phone:
        q["patient_phone"] = patient_phone.strip()
    if kind:
        if kind not in VALID_KINDS:
            raise HTTPException(status_code=400, detail="Invalid kind filter.")
        q["kind"] = kind
    # Patients only see their own certificates (by phone or email).
    if user.get("role") == "patient":
        or_clauses = []
        if user.get("phone"):
            or_clauses.append({"patient_phone": user["phone"]})
        if user.get("email"):
            or_clauses.append({"patient_email": (user.get("email") or "").lower()})
        if not or_clauses:
            return {"items": []}
        q["$or"] = or_clauses
    items: List[Dict[str, Any]] = []
    async for r in db.medical_certificates.find(q, {"_id": 0}).sort("created_at", -1).limit(int(limit)):
        items.append(r)
    return {"items": items, "count": len(items)}


@router.get("/api/medical-certificates/{cert_id}")
async def get_certificate(cert_id: str, user=Depends(require_user)):
    doc = await db.medical_certificates.find_one({"cert_id": cert_id, "deleted_at": None}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Certificate not found")
    # Patients can only fetch their own.
    if user.get("role") == "patient":
        ph = user.get("phone") or ""
        em = (user.get("email") or "").lower()
        if doc.get("patient_phone") != ph and doc.get("patient_email") != em:
            raise HTTPException(status_code=403, detail="Not your certificate")
    return doc


@router.put("/api/medical-certificates/{cert_id}")
async def edit_certificate(cert_id: str, body: MedicalCertificateBody, user=Depends(require_user)):
    await _require_certificate_writer(user)
    existing = await db.medical_certificates.find_one({"cert_id": cert_id, "deleted_at": None}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Certificate not found")
    is_owner = user.get("role") in {"super_owner", "primary_owner", "owner", "partner"}
    is_issuer = existing.get("issued_by") == user.get("user_id")
    if not (is_owner or is_issuer):
        raise HTTPException(status_code=403, detail="Only the issuer or an owner can edit this certificate.")
    update = body.model_dump(exclude_unset=True)
    update["updated_at"] = datetime.now(timezone.utc)
    await db.medical_certificates.update_one({"cert_id": cert_id}, {"$set": update})
    doc = await db.medical_certificates.find_one({"cert_id": cert_id}, {"_id": 0})
    return doc


@router.delete("/api/medical-certificates/{cert_id}")
async def delete_certificate(cert_id: str, user=Depends(require_user)):
    """Soft-delete — owner-tier only (preserves audit history)."""
    if user.get("role") not in {"super_owner", "primary_owner", "owner", "partner"}:
        raise HTTPException(status_code=403, detail="Owner permission required")
    existing = await db.medical_certificates.find_one({"cert_id": cert_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Certificate not found")
    await db.medical_certificates.update_one(
        {"cert_id": cert_id},
        {"$set": {"deleted_at": datetime.now(timezone.utc), "deleted_by": user.get("user_id")}},
    )
    return {"ok": True}
