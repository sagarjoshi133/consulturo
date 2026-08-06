"""ConsultUro — IPD (In-Patient Department) module.

Provides admission lifecycle management:
  • Bed configuration (per clinic, owner-managed).
  • Patient admission → daily progress notes → vitals log → discharge.
  • Discharge Summary auto-generated as printable HTML
    (the frontend handles WeasyPrint conversion via existing
    /api/render/html endpoint).

Collections:
  - admissions          : the master row (one per IPD episode)
  - ipd_rounds          : daily progress notes (1:N → admission)
  - ipd_vitals          : vitals time-series (1:N → admission)
  - ipd_drug_chart      : medication chart entries (1:N → admission)

Bed configuration lives in clinic_settings.ipd_beds — a flat array
of {id, ward, bed_no, status}. status is computed dynamically by
joining against active admissions so we never go stale.

Generates a unique IPD No. on admit (IPDYYMMDDNNN — eg
IPD260615001) that prints on the discharge summary.
"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timezone, date
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from auth_deps import require_owner, require_staff
from db import db
from services.tenancy import resolve_clinic_id

log = logging.getLogger(__name__)
router = APIRouter()


# ──────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────
def _now() -> datetime:
    return datetime.now(timezone.utc)


def _digits10(p: Optional[str]) -> Optional[str]:
    if not p:
        return None
    d = re.sub(r"\D", "", p)
    return d[-10:] if len(d) >= 10 else None


async def _next_ipd_no(clinic_id: str) -> str:
    """Generate `IPDYYMMDDNNN` — daily-resetting 3-digit serial."""
    today = _now().strftime("%y%m%d")
    prefix = f"IPD{today}"
    # Use mongo count for the day to get next serial.
    count = await db.admissions.count_documents({
        "clinic_id": clinic_id,
        "ipd_no": {"$regex": f"^{prefix}"},
    })
    return f"{prefix}{(count + 1):03d}"


def _clean(row: Dict[str, Any]) -> Dict[str, Any]:
    if not row:
        return {}
    row.pop("_id", None)
    for k in ("admitted_at", "discharged_at", "created_at", "updated_at",
             "recorded_at", "note_at"):
        v = row.get(k)
        if isinstance(v, datetime):
            row[k] = v.isoformat()
    return row


# ──────────────────────────────────────────────────────────────────
# Bed configuration (clinic_settings.ipd_beds)
# ──────────────────────────────────────────────────────────────────
class BedRow(BaseModel):
    id: str
    ward: str = "General"
    bed_no: str
    notes: Optional[str] = None


@router.get("/api/ipd/beds")
async def list_beds(request: Request, user=Depends(require_staff)):
    """List configured beds + their current occupancy."""
    clinic_id = await resolve_clinic_id(request, user) or "default"
    cs = await db.clinic_settings.find_one(
        {"_id": clinic_id}, {"_id": 0, "ipd_beds": 1},
    ) or {}
    beds: List[Dict[str, Any]] = list(cs.get("ipd_beds") or [])

    # Compute occupancy.
    if beds:
        bed_ids = [b.get("id") for b in beds if b.get("id")]
        occupied: Dict[str, Dict[str, Any]] = {}
        cursor = db.admissions.find(
            {"clinic_id": clinic_id, "status": "active", "bed_id": {"$in": bed_ids}},
            {"_id": 0, "id": 1, "ipd_no": 1, "patient_name": 1, "bed_id": 1,
             "admitted_at": 1, "diagnosis": 1},
        )
        async for a in cursor:
            occupied[a["bed_id"]] = a
        for b in beds:
            if b.get("id") in occupied:
                b["status"] = "occupied"
                b["current_admission"] = _clean(occupied[b["id"]])
            else:
                b["status"] = "available"
    return {"items": beds, "count": len(beds)}


@router.post("/api/ipd/beds")
async def set_beds(
    request: Request,
    body: Dict[str, Any] = Body(...),
    user=Depends(require_owner),
):
    """Owner-only: overwrite the bed configuration array. Body:
    {beds: [{id?, ward, bed_no, notes?}]}. If `id` omitted, one is
    auto-generated (slug of "ward-bed_no").
    """
    clinic_id = await resolve_clinic_id(request, user) or "default"
    incoming = body.get("beds") or []
    if not isinstance(incoming, list):
        raise HTTPException(status_code=400, detail="`beds` must be a list")
    seen: set = set()
    cleaned: List[Dict[str, Any]] = []
    for b in incoming:
        ward = (b.get("ward") or "General").strip() or "General"
        bed_no = (b.get("bed_no") or "").strip()
        if not bed_no:
            continue
        bid = (b.get("id") or "").strip() or re.sub(r"\W+", "-", f"{ward}-{bed_no}").lower()
        if bid in seen:
            continue
        seen.add(bid)
        cleaned.append({
            "id": bid,
            "ward": ward,
            "bed_no": bed_no,
            "notes": (b.get("notes") or "").strip() or None,
        })
    await db.clinic_settings.update_one(
        {"_id": clinic_id},
        {"$set": {"ipd_beds": cleaned, "updated_at": _now()}},
        upsert=True,
    )
    return {"ok": True, "items": cleaned, "count": len(cleaned)}


# ──────────────────────────────────────────────────────────────────
# Admissions — CRUD
# ──────────────────────────────────────────────────────────────────
class AdmitBody(BaseModel):
    patient_name: str
    patient_phone: Optional[str] = None
    patient_age: Optional[int] = None
    patient_sex: Optional[str] = None
    # Phase 5.12 — accept the same field names used across Consent /
    # Surgery / Medical-Cert flows so the IPD admit form can be
    # populated from the shared patient-lookup endpoint without a
    # rename round-trip on the client.
    patient_gender: Optional[str] = None
    patient_email: Optional[str] = None
    address: Optional[str] = None
    registration_no: Optional[str] = None
    patient_user_id: Optional[str] = None
    reg_no: Optional[str] = None
    bed_id: Optional[str] = None
    ward: Optional[str] = None
    diagnosis: Optional[str] = None
    consulting_doctor: Optional[str] = None
    presenting_complaints: Optional[str] = None
    past_history: Optional[str] = None
    investigations_summary: Optional[str] = None
    planned_procedure: Optional[str] = None
    notes: Optional[str] = None
    estimated_stay_days: Optional[int] = None
    # Phase 5.26 — Cross-link back to the originating prescription so
    # the Patient Database can show "Admitted from Rx #..." and the
    # discharge bundle can attach the source Rx.
    from_prescription_id: Optional[str] = None


@router.post("/api/ipd/admissions")
async def admit(
    request: Request,
    body: AdmitBody,
    user=Depends(require_staff),
):
    clinic_id = await resolve_clinic_id(request, user) or "default"
    if not body.patient_name.strip():
        raise HTTPException(status_code=400, detail="patient_name is required")

    # If a bed is requested, ensure it's not occupied.
    if body.bed_id:
        existing = await db.admissions.find_one(
            {"clinic_id": clinic_id, "status": "active", "bed_id": body.bed_id},
            {"_id": 1, "ipd_no": 1},
        )
        if existing:
            raise HTTPException(
                status_code=409,
                detail=f"Bed already occupied by {existing.get('ipd_no')}",
            )

    ipd_no = await _next_ipd_no(clinic_id)
    now = _now()
    doc: Dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "ipd_no": ipd_no,
        "clinic_id": clinic_id,
        "patient_name": body.patient_name.strip(),
        "patient_phone": _digits10(body.patient_phone),
        "patient_age": body.patient_age,
        "patient_sex": ((body.patient_sex or body.patient_gender) or "").strip().lower() or None,
        "patient_email": (body.patient_email or "").strip().lower() or None,
        "address": (body.address or "").strip() or None,
        "patient_user_id": body.patient_user_id,
        "reg_no": ((body.reg_no or body.registration_no) or "").strip().upper() or None,
        "bed_id": body.bed_id,
        "ward": (body.ward or "General").strip(),
        "diagnosis": (body.diagnosis or "").strip(),
        "consulting_doctor": (body.consulting_doctor or "").strip(),
        "presenting_complaints": (body.presenting_complaints or "").strip(),
        "past_history": (body.past_history or "").strip(),
        "investigations_summary": (body.investigations_summary or "").strip(),
        "planned_procedure": (body.planned_procedure or "").strip(),
        "notes": (body.notes or "").strip(),
        "estimated_stay_days": body.estimated_stay_days,
        "from_prescription_id": body.from_prescription_id,
        "status": "active",
        "admitted_at": now,
        "admitted_by": user.get("user_id"),
        "created_at": now,
        "updated_at": now,
    }
    await db.admissions.insert_one(doc)
    # Notify the patient that they've been admitted — best-effort, never
    # blocks. Resolves the user_id by phone if no patient_user_id was
    # supplied (walk-in admit). The "type" field drives the
    # in-app tap router to /ipd/<admission_id>.
    try:
        from services.notifications import create_notification
        await create_notification(
            user_id=doc.get("patient_user_id"),
            phone=doc.get("patient_phone"),
            title="🏥 You've been admitted",
            body=(
                f"Admission No: {doc.get('ipd_no')} · {doc.get('ward') or 'General'}"
                f"{(' · Bed ' + doc.get('bed_id')) if doc.get('bed_id') else ''}.\n"
                "Tap to view your admission details."
            ),
            kind="ipd_admit",
            data={
                "type": "ipd_admit",
                "admission_id": doc.get("id"),
                "deep_link": f"/ipd/{doc.get('id')}",
            },
            push=True,
        )
    except Exception:
        pass
    return _clean(doc)


@router.get("/api/ipd/admissions")
async def list_admissions(
    request: Request,
    status: Optional[str] = None,
    q: Optional[str] = None,
    limit: int = 100,
    user=Depends(require_staff),
):
    clinic_id = await resolve_clinic_id(request, user) or "default"
    filt: Dict[str, Any] = {"clinic_id": clinic_id}
    if status:
        filt["status"] = status
    if q:
        regex = {"$regex": re.escape(q), "$options": "i"}
        filt["$or"] = [
            {"patient_name": regex}, {"ipd_no": regex},
            {"reg_no": regex}, {"diagnosis": regex},
        ]
    cursor = db.admissions.find(filt).sort("admitted_at", -1).limit(min(max(limit, 1), 500))
    rows: List[Dict[str, Any]] = []
    async for r in cursor:
        rows.append(_clean(r))
    return {"items": rows, "count": len(rows)}


@router.get("/api/ipd/admissions/{admission_id}")
async def get_admission(
    admission_id: str,
    request: Request,
    user=Depends(require_staff),
):
    clinic_id = await resolve_clinic_id(request, user) or "default"
    a = await db.admissions.find_one({"id": admission_id, "clinic_id": clinic_id})
    if not a:
        raise HTTPException(status_code=404, detail="Admission not found")
    # Load related rounds / vitals (latest first).
    rounds_cursor = db.ipd_rounds.find({"admission_id": admission_id}).sort("note_at", -1).limit(200)
    rounds: List[Dict[str, Any]] = [_clean(r) async for r in rounds_cursor]
    vitals_cursor = db.ipd_vitals.find({"admission_id": admission_id}).sort("recorded_at", -1).limit(200)
    vitals: List[Dict[str, Any]] = [_clean(v) async for v in vitals_cursor]
    drugs_cursor = db.ipd_drug_chart.find({"admission_id": admission_id}).sort("created_at", -1).limit(200)
    drugs: List[Dict[str, Any]] = [_clean(d) async for d in drugs_cursor]
    return {
        "admission": _clean(a),
        "rounds": rounds,
        "vitals": vitals,
        "drug_chart": drugs,
    }


@router.patch("/api/ipd/admissions/{admission_id}")
async def patch_admission(
    admission_id: str,
    request: Request,
    body: Dict[str, Any] = Body(...),
    user=Depends(require_staff),
):
    clinic_id = await resolve_clinic_id(request, user) or "default"
    allowed = {
        "diagnosis", "consulting_doctor", "presenting_complaints",
        "past_history", "investigations_summary", "planned_procedure",
        "notes", "bed_id", "ward", "estimated_stay_days",
    }
    update = {k: v for k, v in body.items() if k in allowed}
    if not update:
        return {"ok": True, "updated": 0}

    # Bed change → ensure new bed not occupied.
    new_bed = update.get("bed_id")
    if new_bed:
        clash = await db.admissions.find_one(
            {"clinic_id": clinic_id, "status": "active", "bed_id": new_bed,
             "id": {"$ne": admission_id}},
            {"_id": 1},
        )
        if clash:
            raise HTTPException(status_code=409, detail="Target bed is occupied")

    update["updated_at"] = _now()
    res = await db.admissions.update_one(
        {"id": admission_id, "clinic_id": clinic_id}, {"$set": update},
    )
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Admission not found")
    return {"ok": True, "updated": res.modified_count}


# ─── Bed Transfer (Phase 5.32) ────────────────────────────────────
class BedTransferBody(BaseModel):
    new_ward: str
    new_bed_id: Optional[str] = None
    reason: Optional[str] = None
    transferred_at: Optional[str] = None


@router.post("/api/ipd/admissions/{admission_id}/transfer-bed")
async def transfer_bed(
    admission_id: str,
    request: Request,
    body: BedTransferBody,
    user=Depends(require_staff),
):
    """Move an admitted patient to a different ward / bed and record an
    audit trail in `ipd_bed_transfers`. Common use-cases: Ward → ICU on
    deterioration, ICU → Ward on stabilisation, room upgrade, etc."""
    clinic_id = await resolve_clinic_id(request, user) or "default"
    a = await db.admissions.find_one({"id": admission_id, "clinic_id": clinic_id})
    if not a:
        raise HTTPException(status_code=404, detail="Admission not found")
    if a.get("status") != "active":
        raise HTTPException(status_code=400, detail="Cannot transfer a discharged admission")

    new_bed = (body.new_bed_id or "").strip() or None
    new_ward = (body.new_ward or "").strip()

    # Phase 5.33 — When a bed is selected, validate it exists in the
    # clinic's configured bed inventory (clinic_settings.ipd_beds) so
    # the transfer cannot drift away from the master bed register.
    # The ward is also auto-snapped to the bed's configured ward so
    # the two stay in sync even if the UI passes a stale `new_ward`.
    if new_bed:
        cs = await db.clinic_settings.find_one(
            {"_id": clinic_id}, {"_id": 0, "ipd_beds": 1},
        ) or {}
        configured = next(
            (b for b in (cs.get("ipd_beds") or []) if b.get("id") == new_bed),
            None,
        )
        if not configured:
            raise HTTPException(
                status_code=400,
                detail="Selected bed is not in the clinic's bed inventory. "
                       "Configure it under Manage Beds first.",
            )
        clash = await db.admissions.find_one(
            {"clinic_id": clinic_id, "status": "active", "bed_id": new_bed,
             "id": {"$ne": admission_id}},
            {"_id": 1},
        )
        if clash:
            raise HTTPException(status_code=409, detail="Target bed is occupied")
        # Snap ward to the configured ward of this bed.
        new_ward = (configured.get("ward") or new_ward or "General").strip()

    if not new_ward:
        raise HTTPException(status_code=400, detail="new_ward is required")

    transfer = {
        "id": str(uuid.uuid4()),
        "admission_id": admission_id,
        "clinic_id": clinic_id,
        "from_ward": a.get("ward"),
        "from_bed_id": a.get("bed_id"),
        "to_ward": new_ward,
        "to_bed_id": new_bed,
        "reason": (body.reason or "").strip() or None,
        "transferred_at": body.transferred_at or _now(),
        "transferred_by": user.get("name") or user.get("user_id"),
        "created_at": _now(),
    }
    await db.ipd_bed_transfers.insert_one(transfer)
    await db.admissions.update_one(
        {"id": admission_id},
        {"$set": {
            "ward": new_ward,
            "bed_id": new_bed,
            "last_transfer_at": _now(),
            "updated_at": _now(),
        }},
    )
    # Notify the patient (best-effort) that their bed / ward has
    # changed. Common reason: ICU step-down, room upgrade, post-op
    # recovery — having the patient know via push avoids confused
    # family members showing up at the old bed.
    try:
        from services.notifications import create_notification
        bed_note = f" · Bed {new_bed}" if new_bed else ""
        reason_note = f"\nReason: {transfer['reason']}" if transfer.get("reason") else ""
        await create_notification(
            user_id=a.get("patient_user_id"),
            phone=a.get("patient_phone"),
            title="🛏️ You've been moved",
            body=(
                f"Transferred to {new_ward}{bed_note}.{reason_note}"
            ),
            kind="ipd_transfer",
            data={
                "type": "ipd_transfer",
                "admission_id": admission_id,
                "deep_link": f"/ipd/{admission_id}",
            },
            push=True,
        )
    except Exception:
        pass
    return {"ok": True, "transfer": _clean(transfer)}


@router.get("/api/ipd/admissions/{admission_id}/bed-transfers")
async def list_bed_transfers(
    admission_id: str,
    request: Request,
    user=Depends(require_staff),
):
    """Return the full transfer history for an admission, oldest first
    so the UI can render it as a chronological timeline."""
    clinic_id = await resolve_clinic_id(request, user) or "default"
    cur = db.ipd_bed_transfers.find(
        {"admission_id": admission_id, "clinic_id": clinic_id}
    ).sort("transferred_at", 1)
    out: List[Dict[str, Any]] = []
    async for t in cur:
        out.append(_clean(t))
    return {"items": out, "count": len(out)}


@router.delete("/api/ipd/admissions/{admission_id}")
async def delete_admission(
    admission_id: str,
    request: Request,
    user=Depends(require_owner),
):
    """Owner-only — hard delete (with related rounds/vitals/drugs)."""
    clinic_id = await resolve_clinic_id(request, user) or "default"
    res = await db.admissions.delete_one(
        {"id": admission_id, "clinic_id": clinic_id},
    )
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Admission not found")
    await db.ipd_rounds.delete_many({"admission_id": admission_id})
    await db.ipd_vitals.delete_many({"admission_id": admission_id})
    await db.ipd_drug_chart.delete_many({"admission_id": admission_id})
    return {"ok": True}


# ──────────────────────────────────────────────────────────────────
# Progress notes
# ──────────────────────────────────────────────────────────────────
class RoundNoteBody(BaseModel):
    note_text: str
    note_at: Optional[str] = None
    written_by: Optional[str] = None


@router.post("/api/ipd/admissions/{admission_id}/rounds")
async def add_round(
    admission_id: str,
    request: Request,
    body: RoundNoteBody,
    user=Depends(require_staff),
):
    if not body.note_text.strip():
        raise HTTPException(status_code=400, detail="note_text is required")
    clinic_id = await resolve_clinic_id(request, user) or "default"
    a = await db.admissions.find_one(
        {"id": admission_id, "clinic_id": clinic_id}, {"_id": 1},
    )
    if not a:
        raise HTTPException(status_code=404, detail="Admission not found")
    note_at = _now()
    if body.note_at:
        try:
            note_at = datetime.fromisoformat(body.note_at.replace("Z", "+00:00"))
        except Exception:
            pass
    doc = {
        "id": str(uuid.uuid4()),
        "admission_id": admission_id,
        "clinic_id": clinic_id,
        "note_text": body.note_text.strip(),
        "note_at": note_at,
        "written_by": body.written_by or user.get("name") or user.get("phone"),
        "written_by_id": user.get("user_id"),
    }
    await db.ipd_rounds.insert_one(doc)
    return _clean(doc)


# ──────────────────────────────────────────────────────────────────
# Vitals
# ──────────────────────────────────────────────────────────────────
class VitalsBody(BaseModel):
    bp_sys: Optional[int] = None
    bp_dia: Optional[int] = None
    pulse: Optional[int] = None
    temp_c: Optional[float] = None
    spo2: Optional[int] = None
    rr: Optional[int] = None
    glucose_mg_dl: Optional[int] = None
    urine_output_ml: Optional[int] = None
    pain_score: Optional[int] = Field(None, ge=0, le=10)
    notes: Optional[str] = None
    recorded_at: Optional[str] = None


@router.post("/api/ipd/admissions/{admission_id}/vitals")
async def add_vitals(
    admission_id: str,
    request: Request,
    body: VitalsBody,
    user=Depends(require_staff),
):
    clinic_id = await resolve_clinic_id(request, user) or "default"
    a = await db.admissions.find_one(
        {"id": admission_id, "clinic_id": clinic_id}, {"_id": 1},
    )
    if not a:
        raise HTTPException(status_code=404, detail="Admission not found")
    recorded_at = _now()
    if body.recorded_at:
        try:
            recorded_at = datetime.fromisoformat(body.recorded_at.replace("Z", "+00:00"))
        except Exception:
            pass
    doc = {
        "id": str(uuid.uuid4()),
        "admission_id": admission_id,
        "clinic_id": clinic_id,
        "bp_sys": body.bp_sys,
        "bp_dia": body.bp_dia,
        "pulse": body.pulse,
        "temp_c": body.temp_c,
        "spo2": body.spo2,
        "rr": body.rr,
        "glucose_mg_dl": body.glucose_mg_dl,
        "urine_output_ml": body.urine_output_ml,
        "pain_score": body.pain_score,
        "notes": (body.notes or "").strip() or None,
        "recorded_at": recorded_at,
        "recorded_by": user.get("name") or user.get("phone"),
        "recorded_by_id": user.get("user_id"),
    }
    await db.ipd_vitals.insert_one(doc)
    return _clean(doc)


# ──────────────────────────────────────────────────────────────────
# Drug chart
# ──────────────────────────────────────────────────────────────────
class DrugChartBody(BaseModel):
    drug: str
    dose: Optional[str] = None
    route: Optional[str] = None
    frequency: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    notes: Optional[str] = None
    # Phase 5.29 — links into the Drug Repository so the discharge
    # bundle can include the original recipe metadata even after the
    # repo entry is edited.
    drug_id: Optional[str] = None
    brand: Optional[str] = None
    category: Optional[str] = None
    form: Optional[str] = None
    duration: Optional[str] = None
    status: Optional[str] = None      # "active" | "stopped"


@router.post("/api/ipd/admissions/{admission_id}/drugs")
async def add_drug(
    admission_id: str,
    request: Request,
    body: DrugChartBody,
    user=Depends(require_staff),
):
    if not body.drug.strip():
        raise HTTPException(status_code=400, detail="drug is required")
    clinic_id = await resolve_clinic_id(request, user) or "default"
    a = await db.admissions.find_one(
        {"id": admission_id, "clinic_id": clinic_id}, {"_id": 1},
    )
    if not a:
        raise HTTPException(status_code=404, detail="Admission not found")
    doc = {
        "id": str(uuid.uuid4()),
        "admission_id": admission_id,
        "clinic_id": clinic_id,
        "drug": body.drug.strip(),
        "drug_id": body.drug_id,
        "brand": (body.brand or "").strip() or None,
        "category": (body.category or "").strip() or None,
        "form": (body.form or "").strip() or None,
        "duration": (body.duration or "").strip() or None,
        "dose": (body.dose or "").strip() or None,
        "route": (body.route or "").strip() or None,
        "frequency": (body.frequency or "").strip() or None,
        "start_date": body.start_date,
        "end_date": body.end_date,
        "notes": (body.notes or "").strip() or None,
        "status": (body.status or "active").strip(),
        "created_at": _now(),
        "created_by": user.get("name") or user.get("phone"),
    }
    await db.ipd_drug_chart.insert_one(doc)
    return _clean(doc)


@router.get("/api/ipd/admissions/{admission_id}/drugs")
async def list_drugs(
    admission_id: str,
    request: Request,
    status: Optional[str] = None,
    user=Depends(require_staff),
):
    """Return the medication chart entries for an admission, newest first."""
    clinic_id = await resolve_clinic_id(request, user) or "default"
    q: Dict[str, Any] = {"admission_id": admission_id, "clinic_id": clinic_id}
    if status:
        q["status"] = status
    cur = db.ipd_drug_chart.find(q, {"_id": 0}).sort("created_at", -1)
    items: List[Dict[str, Any]] = []
    async for d in cur:
        items.append(d)
    return {"items": items, "count": len(items)}


@router.patch("/api/ipd/admissions/{admission_id}/drugs/{drug_row_id}")
async def patch_drug(
    admission_id: str,
    drug_row_id: str,
    request: Request,
    body: DrugChartBody,
    user=Depends(require_staff),
):
    """Modify a med chart entry — dose / freq / status (stop) / notes."""
    clinic_id = await resolve_clinic_id(request, user) or "default"
    update: Dict[str, Any] = {"updated_at": _now()}
    for field in ("drug", "dose", "route", "frequency", "start_date", "end_date", "notes", "brand", "category", "form", "duration", "status"):
        val = getattr(body, field, None)
        if val is not None:
            update[field] = (val.strip() if isinstance(val, str) else val) or None
    res = await db.ipd_drug_chart.update_one(
        {"id": drug_row_id, "admission_id": admission_id, "clinic_id": clinic_id},
        {"$set": update},
    )
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Drug entry not found")
    row = await db.ipd_drug_chart.find_one({"id": drug_row_id}, {"_id": 0})
    return row


@router.post("/api/ipd/admissions/{admission_id}/drugs/{drug_row_id}/stop")
async def stop_drug(
    admission_id: str,
    drug_row_id: str,
    request: Request,
    user=Depends(require_staff),
):
    """Mark a med as STOPPED — convenience over PATCH."""
    clinic_id = await resolve_clinic_id(request, user) or "default"
    res = await db.ipd_drug_chart.update_one(
        {"id": drug_row_id, "admission_id": admission_id, "clinic_id": clinic_id},
        {
            "$set": {
                "status": "stopped",
                "stopped_at": _now(),
                "stopped_by": user.get("name") or user.get("user_id"),
            }
        },
    )
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Drug entry not found")
    return {"ok": True}


# ──────────────────────────────────────────────────────────────────
# Discharge
# ──────────────────────────────────────────────────────────────────
class DischargeBody(BaseModel):
    final_diagnosis: Optional[str] = None
    procedures_done: Optional[str] = None
    operative_note: Optional[str] = None  # Phase 5.12 — detailed op note
    course_in_hospital: Optional[str] = None
    condition_at_discharge: Optional[str] = None
    discharge_meds: Optional[str] = None
    diet_advice: Optional[str] = None
    follow_up_plan: Optional[str] = None
    follow_up_date: Optional[str] = None
    advice: Optional[str] = None
    danger_signs: Optional[str] = None
    discharged_at: Optional[str] = None


@router.post("/api/ipd/admissions/{admission_id}/discharge")
async def discharge_patient(
    admission_id: str,
    request: Request,
    body: DischargeBody,
    user=Depends(require_staff),
):
    clinic_id = await resolve_clinic_id(request, user) or "default"
    a = await db.admissions.find_one(
        {"id": admission_id, "clinic_id": clinic_id},
    )
    if not a:
        raise HTTPException(status_code=404, detail="Admission not found")
    if a.get("status") == "discharged":
        raise HTTPException(status_code=409, detail="Admission already discharged")

    discharged_at = _now()
    if body.discharged_at:
        try:
            discharged_at = datetime.fromisoformat(body.discharged_at.replace("Z", "+00:00"))
        except Exception:
            pass

    summary: Dict[str, Any] = {
        "final_diagnosis": (body.final_diagnosis or a.get("diagnosis") or "").strip(),
        "procedures_done": (body.procedures_done or a.get("planned_procedure") or "").strip(),
        "operative_note": (body.operative_note or "").strip(),
        "course_in_hospital": (body.course_in_hospital or "").strip(),
        "condition_at_discharge": (body.condition_at_discharge or "Stable, improved").strip(),
        "discharge_meds": (body.discharge_meds or "").strip(),
        "diet_advice": (body.diet_advice or "").strip(),
        "follow_up_plan": (body.follow_up_plan or "").strip(),
        "follow_up_date": (body.follow_up_date or "").strip() or None,
        "advice": (body.advice or "").strip(),
        "danger_signs": (body.danger_signs or "").strip(),
        "discharged_at": discharged_at,
        "discharged_by": user.get("name") or user.get("phone"),
        "discharged_by_id": user.get("user_id"),
    }
    await db.admissions.update_one(
        {"id": admission_id},
        {"$set": {
            "status": "discharged",
            "discharge_summary": summary,
            "discharged_at": discharged_at,
            "bed_id": None,  # free the bed
            "updated_at": _now(),
        }},
    )
    # Best-effort: Google review nudge (discharge trigger).
    try:
        from services.review_request import schedule_review_request
        await schedule_review_request(
            trigger="discharge",
            user_id=a.get("patient_user_id"),
            patient_name=a.get("patient_name"),
            phone=a.get("patient_phone"),
            source_id=admission_id,
            clinic_id=clinic_id,
        )
    except Exception:
        pass
    # Push notification to patient (best-effort).
    try:
        from services.notifications import create_notification
        await create_notification(
            user_id=a.get("patient_user_id"),
            phone=a.get("patient_phone"),
            title="🏥 You've been discharged",
            body=f"Dr.'s discharge summary is ready. IPD No: {a.get('ipd_no')}",
            kind="discharge",
            data={"type": "discharge", "admission_id": admission_id, "deep_link": f"/ipd/{admission_id}"},
            push=True,
        )
    except Exception:
        pass

    refreshed = await db.admissions.find_one({"id": admission_id})
    return _clean(refreshed or {})


@router.get("/api/ipd/admissions/{admission_id}/discharge-summary")
async def get_discharge_summary(
    admission_id: str,
    request: Request,
    user=Depends(require_staff),
):
    """Return the full payload needed to render a Discharge Summary
    PDF on the frontend (which then uses /api/render/html → WeasyPrint).
    Includes admission + summary + vitals (last 5) + drug chart."""
    clinic_id = await resolve_clinic_id(request, user) or "default"
    a = await db.admissions.find_one(
        {"id": admission_id, "clinic_id": clinic_id},
    )
    if not a:
        raise HTTPException(status_code=404, detail="Admission not found")
    if a.get("status") != "discharged":
        raise HTTPException(status_code=409, detail="Patient not yet discharged")
    vitals_cursor = db.ipd_vitals.find({"admission_id": admission_id}).sort("recorded_at", -1).limit(5)
    drugs_cursor = db.ipd_drug_chart.find({"admission_id": admission_id}).sort("created_at", 1).limit(50)
    rounds_cursor = db.ipd_rounds.find({"admission_id": admission_id}).sort("note_at", 1).limit(50)
    vitals = [_clean(v) async for v in vitals_cursor]
    drugs = [_clean(d) async for d in drugs_cursor]
    rounds = [_clean(r) async for r in rounds_cursor]
    # Clinic letterhead bundle.
    cs = await db.clinic_settings.find_one({"_id": clinic_id}, {"_id": 0}) or {}
    return {
        "admission": _clean(a),
        "vitals_recent": vitals,
        "drug_chart": drugs,
        "rounds": rounds,
        "clinic": {
            "name": cs.get("clinic_name"),
            "address": cs.get("clinic_address"),
            "phone": cs.get("clinic_phone"),
            "doctor_name": cs.get("doctor_name") or "Dr. Sagar Joshi",
            "doctor_degrees": cs.get("doctor_degrees"),
            "doctor_regn": cs.get("doctor_regn"),
            "letterhead_image_b64": cs.get("letterhead_image_b64"),
            "use_letterhead": cs.get("use_letterhead"),
        },
    }


# ──────────────────────────────────────────────────────────────────
# Stats — quick KPI for the IPD dashboard tile.
# ──────────────────────────────────────────────────────────────────
@router.get("/api/ipd/stats")
async def ipd_stats(request: Request, user=Depends(require_staff)):
    clinic_id = await resolve_clinic_id(request, user) or "default"
    active = await db.admissions.count_documents(
        {"clinic_id": clinic_id, "status": "active"}
    )
    today_iso = _now().date().isoformat()
    today_admitted = await db.admissions.count_documents({
        "clinic_id": clinic_id,
        "admitted_at": {"$gte": datetime.fromisoformat(today_iso + "T00:00:00+00:00")},
    })
    today_discharged = await db.admissions.count_documents({
        "clinic_id": clinic_id,
        "status": "discharged",
        "discharged_at": {"$gte": datetime.fromisoformat(today_iso + "T00:00:00+00:00")},
    })
    cs = await db.clinic_settings.find_one({"_id": clinic_id}, {"_id": 0, "ipd_beds": 1}) or {}
    total_beds = len(cs.get("ipd_beds") or [])
    return {
        "active_admissions": active,
        "today_admitted": today_admitted,
        "today_discharged": today_discharged,
        "total_beds": total_beds,
        "free_beds": max(total_beds - active, 0),
    }



# ─── Discharge Summary registry (standalone listing) ───────────────
# Dr. Joshi wants a top-level "Discharge Summaries" section that
# lists every discharged admission so staff can search / edit / print
# without going through the IPD module. The data already lives on
# `admissions.discharge_summary`, so these endpoints are thin
# projections + an editor.

@router.get("/api/discharge-summaries")
async def list_discharge_summaries(
    request: Request,
    q: Optional[str] = None,                  # name / phone / IPD no. search
    patient_phone: Optional[str] = None,      # exact-phone filter (Patient DB drill-down)
    from_date: Optional[str] = None,          # YYYY-MM-DD
    to_date: Optional[str] = None,            # YYYY-MM-DD
    limit: int = 100,
    user=Depends(require_staff),
):
    """Return all discharged admissions for the active clinic. Limited
    to staff (no patient access — patients see their own via
    /api/phr already). Lightweight projection — full
    discharge summary fetched via the existing
    /api/ipd/admissions/{id}/discharge-summary route."""
    clinic_id = await resolve_clinic_id(request, user) or "default"
    query: Dict[str, Any] = {
        "clinic_id": clinic_id,
        "status": "discharged",
    }
    if patient_phone:
        # Exact / suffix match — phone normalisation strips +country.
        pp = patient_phone.strip()
        if pp:
            suffix = pp[-10:] if len(pp) >= 10 else pp
            query["patient_phone"] = {"$regex": suffix + "$"}
    if q:
        qs = q.strip()
        if qs:
            query["$or"] = [
                {"patient_name": {"$regex": qs, "$options": "i"}},
                {"patient_phone": {"$regex": qs, "$options": "i"}},
                {"ipd_no": {"$regex": qs, "$options": "i"}},
            ]
    if from_date:
        try:
            query.setdefault("discharged_at", {})["$gte"] = datetime.fromisoformat(from_date + "T00:00:00+00:00")
        except Exception:
            pass
    if to_date:
        try:
            query.setdefault("discharged_at", {})["$lte"] = datetime.fromisoformat(to_date + "T23:59:59+00:00")
        except Exception:
            pass
    cur = db.admissions.find(query, {
        "_id": 0,
        "id": 1,
        "ipd_no": 1,
        "patient_name": 1,
        "patient_phone": 1,
        "patient_age": 1,
        "patient_gender": 1,
        "admitted_at": 1,
        "discharged_at": 1,
        "diagnosis": 1,
        "discharge_summary": 1,
    }).sort("discharged_at", -1).limit(int(limit))
    items: List[Dict[str, Any]] = []
    async for a in cur:
        ds = a.get("discharge_summary") or {}
        items.append({
            "id": a.get("id"),
            "ipd_no": a.get("ipd_no"),
            "patient_name": a.get("patient_name"),
            "patient_phone": a.get("patient_phone"),
            "patient_age": a.get("patient_age"),
            "patient_gender": a.get("patient_gender") or a.get("patient_sex"),
            "admitted_at": _iso(a.get("admitted_at")),
            "discharged_at": _iso(a.get("discharged_at")),
            "diagnosis": a.get("diagnosis"),
            "final_diagnosis": ds.get("final_diagnosis"),
            "procedures_done": ds.get("procedures_done"),
            "condition_at_discharge": ds.get("condition_at_discharge"),
            "follow_up_date": ds.get("follow_up_date"),
            "discharged_by": ds.get("discharged_by"),
        })
    return {"items": items, "count": len(items)}


def _iso(v: Any) -> Optional[str]:
    if isinstance(v, datetime):
        return v.replace(microsecond=0).isoformat()
    return v if isinstance(v, str) else None


class DischargeSummaryEditBody(BaseModel):
    """Fields editable post-discharge. Mirrors `DischargeBody` so the
    edit page can use the same form. `discharged_at` is intentionally
    NOT editable here — that's an auditable event."""
    final_diagnosis: Optional[str] = None
    procedures_done: Optional[str] = None
    operative_note: Optional[str] = None  # Phase 5.12 — detailed op note
    course_in_hospital: Optional[str] = None
    condition_at_discharge: Optional[str] = None
    discharge_meds: Optional[str] = None
    diet_advice: Optional[str] = None
    follow_up_plan: Optional[str] = None
    follow_up_date: Optional[str] = None
    advice: Optional[str] = None
    danger_signs: Optional[str] = None


@router.put("/api/ipd/admissions/{admission_id}/discharge-summary")
async def edit_discharge_summary(
    admission_id: str,
    request: Request,
    body: DischargeSummaryEditBody,
    user=Depends(require_staff),
):
    """Edit an already-issued discharge summary. Owner-tier or the
    original discharging clinician can edit. Other staff get 403."""
    clinic_id = await resolve_clinic_id(request, user) or "default"
    a = await db.admissions.find_one({"id": admission_id, "clinic_id": clinic_id})
    if not a:
        raise HTTPException(status_code=404, detail="Admission not found")
    if a.get("status") != "discharged":
        raise HTTPException(status_code=409, detail="Patient not yet discharged")
    role = (user.get("role") or "").lower()
    is_owner = role in {"super_owner", "primary_owner", "owner", "partner"}
    summary_now = a.get("discharge_summary") or {}
    is_discharger = summary_now.get("discharged_by_id") == user.get("user_id")
    if not (is_owner or is_discharger):
        raise HTTPException(status_code=403, detail="Only the discharging clinician or an owner can edit this summary.")
    updates = {k: ("" if v is None else str(v).strip()) for k, v in body.model_dump(exclude_unset=True).items()}
    if not updates:
        return {"ok": True, "no_change": True}
    # Merge — preserve existing audit fields (discharged_at, discharged_by_id, ...)
    new_summary = {**summary_now, **updates, "edited_at": _now(), "edited_by_id": user.get("user_id"),
                   "edited_by": user.get("name") or user.get("phone")}
    await db.admissions.update_one(
        {"id": admission_id},
        {"$set": {"discharge_summary": new_summary, "updated_at": _now()}},
    )
    # Audit trail.
    try:
        await db.audit_log.insert_one({
            "ts": _now(),
            "kind": "discharge_summary_edit",
            "admission_id": admission_id,
            "ipd_no": a.get("ipd_no"),
            "actor_email": (user.get("email") or "").lower(),
            "fields": list(updates.keys()),
        })
    except Exception:
        pass
    fresh = await db.admissions.find_one({"id": admission_id})
    return _clean(fresh or {})


# ─── Combined IPD File PDF (Phase 5.30) ────────────────────────
class PrivateNoteBody(BaseModel):
    private_note: str = ""


@router.patch("/api/ipd/admissions/{admission_id}/private-note")
async def patch_private_note(
    admission_id: str,
    request: Request,
    body: PrivateNoteBody,
    user=Depends(require_staff),
):
    """Doctor private note — visible only to clinical staff, never to patients."""
    clinic_id = await resolve_clinic_id(request, user) or "default"
    res = await db.admissions.update_one(
        {"id": admission_id, "clinic_id": clinic_id},
        {"$set": {"private_note": (body.private_note or "").strip(), "private_note_updated_at": _now(), "private_note_by": user.get("name") or user.get("user_id")}},
    )
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Admission not found")
    return {"ok": True}


@router.get("/api/ipd/admissions/{admission_id}/ipd-file-html")
async def get_ipd_file_html(
    admission_id: str,
    request: Request,
    user=Depends(require_staff),
):
    """Builds and returns the combined IPD File HTML (Admission Form
    → Vitals → Progress Notes → Meds → Consents → Operative Note →
    Discharge Summary → Medical Certificates → Private Note).

    The frontend posts this HTML to /api/render/html to produce a PDF
    (the same flow used by the standalone discharge summary)."""
    from services.ipd_file_bundler import build_ipd_file_html

    clinic_id = await resolve_clinic_id(request, user) or "default"
    a = await db.admissions.find_one({"id": admission_id, "clinic_id": clinic_id})
    if not a:
        raise HTTPException(status_code=404, detail="Admission not found")
    rounds_list = [r async for r in db.ipd_rounds.find({"admission_id": admission_id}).sort("created_at", -1)]
    vitals_list = [v async for v in db.ipd_vitals.find({"admission_id": admission_id}).sort("recorded_at", -1)]
    meds_list = [m async for m in db.ipd_drug_chart.find({"admission_id": admission_id}).sort("created_at", -1)]
    consents_list = []
    try:
        consents_list = [c async for c in db.surgical_consents.find({"admission_id": admission_id, "deleted_at": None}).sort("created_at", -1)]
    except Exception:
        pass
    certs_list = []
    try:
        q_certs = {"$or": [{"admission_id": admission_id}]}
        if a.get("patient_phone"):
            q_certs["$or"].append({"patient_phone": a["patient_phone"]})
        certs_list = [c async for c in db.medical_certificates.find(q_certs).sort("created_at", -1)]
    except Exception:
        pass
    settings = await db.clinic_settings.find_one({"clinic_id": clinic_id}) or {}
    html = build_ipd_file_html(
        admission=a,
        rounds=rounds_list,
        vitals=vitals_list,
        meds=meds_list,
        consents=consents_list,
        discharge_summary=a.get("discharge_summary"),
        medical_certificates=certs_list,
        clinic_settings=settings,
        operative_note=a.get("operative_note"),
    )
    return {"html": html, "ipd_no": a.get("ipd_no"), "patient_name": a.get("patient_name"), "admitted_at": str(a.get("admitted_at") or ""), "discharged_at": str(a.get("discharged_at") or "")}

