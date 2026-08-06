"""
ConsultUro — Surgical Consents router.

Manages digital consent forms for the 50 most-common urology
procedures. NOT to be confused with /api/consent (privacy/data
consent for app onboarding) — this router handles SURGICAL
consent capture: procedure templates, patient signatures, witness
signatures, doctor signature, and PDF generation handoff.

Routes:
  GET    /api/surgical-consents/procedures     — list 50 procedure templates
  GET    /api/surgical-consents/procedures/{key} — get one template
  GET    /api/surgical-consents                 — list saved consents (filtered)
  GET    /api/surgical-consents/{cid}           — get one saved consent
  POST   /api/surgical-consents                 — save a new consent
  PATCH  /api/surgical-consents/{cid}           — update (e.g. add doctor signature)
  DELETE /api/surgical-consents/{cid}           — soft delete

Storage:
  collection `surgical_consents` :
    {
      consent_id,
      booking_id        (optional — links to booking)
      patient_user_id   (optional — if patient is registered)
      patient_name,
      patient_phone,
      patient_email,
      patient_age, patient_sex,
      procedure_key,
      procedure_snapshot     (frozen copy of the procedure template at sign time)
      language               (en|hi|gu — language used during consent)
      patient_signature_b64  (PNG dataURL)
      witness_name,
      witness_signature_b64,
      doctor_user_id,
      doctor_signature_b64,
      pdf_url                (optional — once generated)
      clinic_id,
      created_by             (user_id of staff/patient who initiated)
      created_at,
      updated_at,
      deleted_at             (soft delete)
    }
"""
from datetime import datetime, timezone
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
import uuid

from db import db
from auth_deps import require_user
from data.consent_procedures import PROCEDURES, PROCEDURES_BY_KEY


router = APIRouter()


# ─── Pydantic models ──────────────────────────────────────────────
class ConsentCreate(BaseModel):
    procedure_key: str = Field(..., description="Key from procedure templates")
    # Phase 6.2 — multi-procedure consents (e.g. RIRS + DJ Stent done
    # in the same OT session). When provided, `procedure_key` is the
    # FIRST entry of this list (for backward-compat with single-pick
    # consumers). `procedure_keys` is the full ordered list.
    procedure_keys: Optional[List[str]] = None
    language: str = Field("en", description="Language used for consent (en|hi|gu)")
    patient_name: str
    patient_phone: Optional[str] = None
    patient_email: Optional[str] = None
    patient_age: Optional[int] = None
    patient_sex: Optional[str] = None
    booking_id: Optional[str] = None
    # Phase 5.27 — Link consent to an active IPD admission so it
    # appears under "Consents" on the admission detail page and
    # eventually inside the combined IPD-file PDF on discharge.
    admission_id: Optional[str] = None
    patient_user_id: Optional[str] = None
    patient_signature_b64: Optional[str] = None     # data:image/png;base64,...
    witness_name: Optional[str] = None
    witness_signature_b64: Optional[str] = None
    doctor_signature_b64: Optional[str] = None


class ConsentUpdate(BaseModel):
    """Patch — typically used to add the doctor's signature later."""
    doctor_signature_b64: Optional[str] = None
    witness_name: Optional[str] = None
    witness_signature_b64: Optional[str] = None
    patient_signature_b64: Optional[str] = None
    pdf_url: Optional[str] = None


# ─── Procedure template endpoints (read-only) ─────────────────────
@router.get("/api/surgical-consents/procedures")
async def list_procedures(user=Depends(require_user)):
    """Return the full catalogue of 50 procedure templates."""
    # Strip nothing — frontend uses every field. Order maintained.
    return {"items": PROCEDURES, "count": len(PROCEDURES)}


@router.get("/api/surgical-consents/procedures/{key}")
async def get_procedure(key: str, user=Depends(require_user)):
    proc = PROCEDURES_BY_KEY.get(key)
    if not proc:
        raise HTTPException(404, f"Unknown procedure key: {key}")
    return proc


# ─── Consent-instance CRUD ────────────────────────────────────────
def _serialise(d: dict) -> dict:
    """Strip Mongo-internal fields. We never expose `_id` to clients."""
    if not d:
        return d
    d.pop("_id", None)
    return d


@router.post("/api/surgical-consents")
async def create_consent(body: ConsentCreate, user=Depends(require_user)):
    # Phase 6.2 — multi-procedure consent. If the client sent a
    # `procedure_keys` array, validate every key and snapshot all the
    # templates. Otherwise fall back to the single-procedure path so
    # legacy callers continue to work unchanged.
    keys: List[str] = []
    if body.procedure_keys and len(body.procedure_keys) > 0:
        # Preserve order, drop duplicates.
        seen: set = set()
        for k in body.procedure_keys:
            if k and k not in seen:
                keys.append(k)
                seen.add(k)
    if not keys:
        keys = [body.procedure_key]
    snapshots = []
    for k in keys:
        p = PROCEDURES_BY_KEY.get(k)
        if not p:
            raise HTTPException(400, f"Unknown procedure key: {k}")
        snapshots.append(p)
    if body.language not in ("en", "hi", "gu"):
        raise HTTPException(400, "language must be en, hi, or gu")
    now = datetime.now(timezone.utc)
    consent_id = "cs_" + uuid.uuid4().hex[:12]
    # Snapshot the procedure template(s) at sign-time so future edits
    # to the catalogue don't retroactively rewrite history (audit
    # trail). Legacy clients read `procedure_snapshot` (singular);
    # new clients read `procedure_snapshots` (plural list).
    doc = {
        "consent_id": consent_id,
        "procedure_key": keys[0],
        "procedure_keys": keys,
        "procedure_snapshot": snapshots[0],
        "procedure_snapshots": snapshots,
        "language": body.language,
        "patient_name": body.patient_name,
        "patient_phone": body.patient_phone,
        "patient_email": body.patient_email,
        "patient_age": body.patient_age,
        "patient_sex": body.patient_sex,
        "booking_id": body.booking_id,
        "admission_id": body.admission_id,
        "patient_user_id": body.patient_user_id,
        "patient_signature_b64": body.patient_signature_b64,
        "witness_name": body.witness_name,
        "witness_signature_b64": body.witness_signature_b64,
        "doctor_user_id": user.get("user_id"),
        "doctor_signature_b64": body.doctor_signature_b64,
        "clinic_id": user.get("clinic_id"),
        "created_by": user.get("user_id"),
        "created_at": now,
        "updated_at": now,
        "deleted_at": None,
    }
    await db.surgical_consents.insert_one(doc)
    return _serialise(doc)


@router.get("/api/surgical-consents")
async def list_consents(
    user=Depends(require_user),
    booking_id: Optional[str] = Query(None),
    admission_id: Optional[str] = Query(None),
    patient_phone: Optional[str] = Query(None),
    patient_email: Optional[str] = Query(None),
    patient_user_id: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
):
    q: dict = {"deleted_at": None}
    if booking_id:
        q["booking_id"] = booking_id
    if admission_id:
        q["admission_id"] = admission_id
    if patient_user_id:
        q["patient_user_id"] = patient_user_id
    if patient_phone:
        q["patient_phone"] = patient_phone
    if patient_email:
        q["patient_email"] = patient_email
    cur = db.surgical_consents.find(q).sort("created_at", -1).limit(limit)
    items = [_serialise(d) async for d in cur]
    return {"items": items, "count": len(items)}


@router.get("/api/surgical-consents/{cid}")
async def get_consent(cid: str, user=Depends(require_user)):
    doc = await db.surgical_consents.find_one({"consent_id": cid, "deleted_at": None})
    if not doc:
        raise HTTPException(404, "Consent not found")
    return _serialise(doc)


@router.patch("/api/surgical-consents/{cid}")
async def update_consent(cid: str, body: ConsentUpdate, user=Depends(require_user)):
    doc = await db.surgical_consents.find_one({"consent_id": cid, "deleted_at": None})
    if not doc:
        raise HTTPException(404, "Consent not found")
    updates = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if not updates:
        raise HTTPException(400, "No fields to update")
    updates["updated_at"] = datetime.now(timezone.utc)
    await db.surgical_consents.update_one({"consent_id": cid}, {"$set": updates})
    fresh = await db.surgical_consents.find_one({"consent_id": cid})
    return _serialise(fresh)


@router.delete("/api/surgical-consents/{cid}")
async def delete_consent(cid: str, user=Depends(require_user)):
    res = await db.surgical_consents.update_one(
        {"consent_id": cid, "deleted_at": None},
        {"$set": {"deleted_at": datetime.now(timezone.utc)}},
    )
    if res.modified_count == 0:
        raise HTTPException(404, "Consent not found or already deleted")
    return {"ok": True}
