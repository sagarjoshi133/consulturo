"""ConsultUro — Phase E: Clinical Core.

Patient ENCOUNTERS (clinical notes) + DIAGNOSIS REGISTRY + AI dictation.

  · POST   /api/encounters                     create encounter (staff)
  · GET    /api/encounters                     paginated list (staff)
  · GET    /api/encounters/{encounter_id}      full detail (staff)
  · PATCH  /api/encounters/{encounter_id}      update (staff)
  · DELETE /api/encounters/{encounter_id}      delete (owner-tier or author)
  · POST   /api/encounters/{id}/link-rx        two-way link to a prescription
  · GET    /api/diagnoses                      registry typeahead (staff)
  · POST   /api/ai/encounter-dictation         audio → Whisper → Claude SOAP JSON

Design notes
  • Encounters are clinic-scoped (same tenancy rules as surgeries/Rx).
  • The diagnosis registry is auto-learned: every diagnosis saved on an
    encounter upserts into `diagnosis_registry` with a usage counter, so
    the typeahead ranks the clinic's most-used diagnoses first.
  • List responses are PROJECTED to summary fields only (SOAP bodies can
    be long) and paginated — never ship the full history in one payload.
"""
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel

from db import db
from auth_deps import require_staff, is_owner_or_partner
from services.tenancy import resolve_clinic_id, tenant_filter

router = APIRouter()

_LIST_PROJECTION = {
    "_id": 0,
    "encounter_id": 1,
    "patient_name": 1,
    "patient_phone": 1,
    "patient_age": 1,
    "patient_sex": 1,
    "chief_complaint": 1,
    "diagnoses": 1,
    "prescription_id": 1,
    "booking_id": 1,
    "created_by_name": 1,
    "created_at": 1,
}


class VitalsBody(BaseModel):
    bp: Optional[str] = None
    pulse: Optional[str] = None
    temp: Optional[str] = None
    spo2: Optional[str] = None
    weight: Optional[str] = None


class EncounterBody(BaseModel):
    patient_name: str
    patient_phone: Optional[str] = ""
    patient_age: Optional[str] = ""
    patient_sex: Optional[str] = ""
    booking_id: Optional[str] = None
    chief_complaint: Optional[str] = ""
    subjective: Optional[str] = ""
    objective: Optional[str] = ""
    assessment: Optional[str] = ""
    plan: Optional[str] = ""
    vitals: Optional[VitalsBody] = None
    diagnoses: Optional[List[str]] = None


class EncounterPatchBody(BaseModel):
    patient_name: Optional[str] = None
    patient_phone: Optional[str] = None
    patient_age: Optional[str] = None
    patient_sex: Optional[str] = None
    chief_complaint: Optional[str] = None
    subjective: Optional[str] = None
    objective: Optional[str] = None
    assessment: Optional[str] = None
    plan: Optional[str] = None
    vitals: Optional[VitalsBody] = None
    diagnoses: Optional[List[str]] = None


class LinkRxBody(BaseModel):
    prescription_id: str


def _clean_diagnoses(raw: Optional[List[str]]) -> List[str]:
    out: List[str] = []
    seen = set()
    for d in raw or []:
        label = " ".join(str(d or "").split()).strip()
        if not label:
            continue
        key = label.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(label[:120])
    return out[:15]


async def _register_diagnoses(clinic_id: Optional[str], labels: List[str]) -> None:
    """Upsert each diagnosis into the clinic's registry (usage counter)."""
    now = datetime.now(timezone.utc)
    for label in labels:
        try:
            await db.diagnosis_registry.update_one(
                {"clinic_id": clinic_id, "label_lower": label.lower()},
                {
                    "$set": {"label": label, "updated_at": now},
                    "$inc": {"usage_count": 1},
                    "$setOnInsert": {"clinic_id": clinic_id, "created_at": now},
                },
                upsert=True,
            )
        except Exception:
            pass  # registry is best-effort — never block the encounter save


@router.post("/api/encounters")
async def create_encounter(request: Request, body: EncounterBody, user=Depends(require_staff)):
    from server import block_if_demo
    block_if_demo(user)
    if not (body.patient_name or "").strip():
        raise HTTPException(400, detail="Patient name is required")
    clinic_id = await resolve_clinic_id(request, user)
    diagnoses = _clean_diagnoses(body.diagnoses)
    now = datetime.now(timezone.utc)
    doc: Dict[str, Any] = {
        "encounter_id": f"enc_{uuid.uuid4().hex[:12]}",
        "clinic_id": clinic_id,
        "patient_name": body.patient_name.strip(),
        "patient_phone": (body.patient_phone or "").strip(),
        "patient_age": (body.patient_age or "").strip(),
        "patient_sex": (body.patient_sex or "").strip(),
        "booking_id": body.booking_id or None,
        "chief_complaint": (body.chief_complaint or "").strip(),
        "subjective": (body.subjective or "").strip(),
        "objective": (body.objective or "").strip(),
        "assessment": (body.assessment or "").strip(),
        "plan": (body.plan or "").strip(),
        "vitals": body.vitals.dict() if body.vitals else {},
        "diagnoses": diagnoses,
        "prescription_id": None,
        "created_by": user.get("user_id"),
        "created_by_name": user.get("name") or user.get("email") or "",
        "created_at": now,
        "updated_at": now,
    }
    await db.encounters.insert_one(doc)
    await _register_diagnoses(clinic_id, diagnoses)
    doc.pop("_id", None)
    return doc


@router.get("/api/encounters")
async def list_encounters(
    request: Request,
    user=Depends(require_staff),
    limit: int = 50,
    skip: int = 0,
    q: str = "",
    patient_phone: str = "",
):
    clinic_id = await resolve_clinic_id(request, user)
    filt: Dict[str, Any] = tenant_filter(user, clinic_id, allow_global=True)
    if patient_phone.strip():
        digits = "".join(ch for ch in patient_phone if ch.isdigit())[-10:]
        if digits:
            filt["patient_phone"] = {"$regex": f"{digits}$"}
    if q.strip():
        import re as _re
        rx = {"$regex": _re.escape(q.strip()), "$options": "i"}
        filt["$or"] = [
            {"patient_name": rx},
            {"patient_phone": rx},
            {"chief_complaint": rx},
            {"diagnoses": rx},
        ]
    limit = max(1, min(int(limit or 50), 200))
    skip = max(0, int(skip or 0))
    total = await db.encounters.count_documents(filt)
    items = await (
        db.encounters.find(filt, _LIST_PROJECTION)
        .sort("created_at", -1)
        .skip(skip)
        .limit(limit)
        .to_list(length=limit)
    )
    return {"items": items, "total": total, "has_more": skip + len(items) < total}


async def _scoped_find(request: Request, user: Dict[str, Any], encounter_id: str,
                       projection: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    """Fetch an encounter WITH the same tenant scoping as the list
    endpoint — staff can only touch encounters of their own clinic."""
    clinic_id = await resolve_clinic_id(request, user)
    filt: Dict[str, Any] = tenant_filter(user, clinic_id, allow_global=True)
    filt["encounter_id"] = encounter_id
    return await db.encounters.find_one(filt, projection or {"_id": 0})


@router.get("/api/encounters/{encounter_id}")
async def get_encounter(request: Request, encounter_id: str, user=Depends(require_staff)):
    doc = await _scoped_find(request, user, encounter_id)
    if not doc:
        raise HTTPException(404, detail="Encounter not found")
    return doc


@router.patch("/api/encounters/{encounter_id}")
async def update_encounter(
    request: Request, encounter_id: str, body: EncounterPatchBody, user=Depends(require_staff),
):
    from server import block_if_demo
    block_if_demo(user)
    existing = await _scoped_find(request, user, encounter_id, {"_id": 0, "clinic_id": 1})
    if not existing:
        raise HTTPException(404, detail="Encounter not found")
    updates: Dict[str, Any] = {}
    for field in (
        "patient_name", "patient_phone", "patient_age", "patient_sex",
        "chief_complaint", "subjective", "objective", "assessment", "plan",
    ):
        val = getattr(body, field)
        if val is not None:
            updates[field] = str(val).strip()
    if body.vitals is not None:
        updates["vitals"] = body.vitals.dict()
    if body.diagnoses is not None:
        diagnoses = _clean_diagnoses(body.diagnoses)
        updates["diagnoses"] = diagnoses
        await _register_diagnoses(existing.get("clinic_id"), diagnoses)
    if not updates:
        raise HTTPException(400, detail="Nothing to update")
    updates["updated_at"] = datetime.now(timezone.utc)
    await db.encounters.update_one({"encounter_id": encounter_id}, {"$set": updates})
    return await db.encounters.find_one({"encounter_id": encounter_id}, {"_id": 0})


@router.delete("/api/encounters/{encounter_id}")
async def delete_encounter(request: Request, encounter_id: str, user=Depends(require_staff)):
    from server import block_if_demo
    block_if_demo(user)
    doc = await _scoped_find(request, user, encounter_id, {"_id": 0, "created_by": 1})
    if not doc:
        raise HTTPException(404, detail="Encounter not found")
    if not is_owner_or_partner(user) and doc.get("created_by") != user.get("user_id"):
        raise HTTPException(403, detail="Only the author or an owner can delete this encounter.")
    await db.encounters.delete_one({"encounter_id": encounter_id})
    return {"ok": True}


@router.post("/api/encounters/{encounter_id}/link-rx")
async def link_encounter_rx(request: Request, encounter_id: str, body: LinkRxBody, user=Depends(require_staff)):
    from server import block_if_demo
    block_if_demo(user)
    enc = await _scoped_find(request, user, encounter_id, {"_id": 0, "encounter_id": 1})
    if not enc:
        raise HTTPException(404, detail="Encounter not found")
    rx = await db.prescriptions.find_one({"prescription_id": body.prescription_id}, {"_id": 0, "prescription_id": 1})
    if not rx:
        raise HTTPException(404, detail="Prescription not found")
    now = datetime.now(timezone.utc)
    await db.encounters.update_one(
        {"encounter_id": encounter_id},
        {"$set": {"prescription_id": body.prescription_id, "updated_at": now}},
    )
    await db.prescriptions.update_one(
        {"prescription_id": body.prescription_id},
        {"$set": {"encounter_id": encounter_id}},
    )
    return {"ok": True, "encounter_id": encounter_id, "prescription_id": body.prescription_id}


@router.get("/api/diagnoses")
async def list_diagnoses(request: Request, user=Depends(require_staff), q: str = "", limit: int = 20):
    """Typeahead over the clinic's learned diagnosis registry — most
    used first."""
    clinic_id = await resolve_clinic_id(request, user)
    filt: Dict[str, Any] = tenant_filter(user, clinic_id, allow_global=True)
    if q.strip():
        import re as _re
        filt["label_lower"] = {"$regex": _re.escape(q.strip().lower())}
    limit = max(1, min(int(limit or 20), 50))
    rows = await (
        db.diagnosis_registry.find(filt, {"_id": 0, "label": 1, "usage_count": 1})
        .sort("usage_count", -1)
        .limit(limit)
        .to_list(length=limit)
    )
    return {"items": rows}


# ── AI dictation → structured SOAP note ──────────────────────────────

_ENCOUNTER_SYSTEM = """You are an expert medical scribe for an Indian urology clinic.
The doctor dictates a clinical encounter note out loud. Convert the spoken
transcript into structured JSON the EMR can apply directly.

Output a SINGLE JSON object — NO prose, NO markdown — with this exact shape:

{
  "chief_complaint": "one line — why the patient came",
  "subjective": "history / symptoms in the patient's words",
  "objective": "examination findings, vitals mentioned",
  "assessment": "clinical impression / differential",
  "plan": "management plan, investigations, medications, follow-up",
  "diagnoses": ["Diagnosis 1", "Diagnosis 2"]
}

Rules:
• If a section isn't mentioned, return an empty string (empty array for diagnoses).
• diagnoses: short standard labels (e.g. "BPH", "Renal calculus left", "UTI").
• Preserve clinical terms exactly as dictated. NEVER invent findings.
• Output JSON only — no preamble, no explanation.
"""


@router.post("/api/ai/encounter-dictation")
async def encounter_dictation(
    audio: UploadFile = File(...),
    language: str = Form("en"),
    user=Depends(require_staff),
):
    """Transcribe dictated audio and structure it into SOAP-note JSON.
    Same two-stage pipeline as /api/ai/voice-to-rx (Whisper → Claude)."""
    from server import block_if_demo
    block_if_demo(user)
    from routers.wave3 import _claude_one_shot, _extract_json, _llm_key

    raw = await audio.read()
    if not raw:
        raise HTTPException(400, detail="Empty audio file")
    if len(raw) > 25 * 1024 * 1024:
        raise HTTPException(400, detail="Audio exceeds 25 MB limit (Whisper cap)")

    suffix = (audio.filename or "audio.m4a").rsplit(".", 1)[-1].lower() or "m4a"
    if suffix not in {"mp3", "mp4", "mpeg", "mpga", "m4a", "wav", "webm"}:
        suffix = "m4a"
    tmp_path = f"/tmp/encdict_{uuid.uuid4().hex}.{suffix}"
    with open(tmp_path, "wb") as fh:
        fh.write(raw)

    try:
        try:
            from emergentintegrations.llm.openai.speech_to_text import OpenAISpeechToText
        except Exception as e:
            raise HTTPException(503, detail=f"STT library missing: {e}")

        stt = OpenAISpeechToText(api_key=_llm_key())
        with open(tmp_path, "rb") as fh:
            result = await stt.transcribe(
                file=fh,
                model="whisper-1",
                response_format="json",
                language=language[:2] if language else None,
                prompt="Indian urology clinic encounter note. Terms: BPH, IPSS, PSA, "
                       "hydronephrosis, ureteric calculus, DJ stent, TURP, PCNL, URS, "
                       "uroflowmetry, haematuria, LUTS.",
            )
        transcript = ""
        if isinstance(result, dict):
            transcript = (result.get("text") or "").strip()
        elif hasattr(result, "text"):
            transcript = (result.text or "").strip()
        else:
            transcript = str(result).strip()
        if not transcript:
            raise HTTPException(422, detail="Empty transcript from Whisper")

        sid = f"encd_{uuid.uuid4().hex[:10]}"
        claude_resp = await _claude_one_shot(
            system=_ENCOUNTER_SYSTEM,
            user_text=f"Transcript:\n\"\"\"\n{transcript}\n\"\"\"",
            session_id=sid,
        )
        parsed = _extract_json(claude_resp) or {}
        return {
            "ok": True,
            "transcript": transcript,
            "parsed": {
                "chief_complaint": (parsed.get("chief_complaint") or "").strip(),
                "subjective": (parsed.get("subjective") or "").strip(),
                "objective": (parsed.get("objective") or "").strip(),
                "assessment": (parsed.get("assessment") or "").strip(),
                "plan": (parsed.get("plan") or "").strip(),
                "diagnoses": [str(d).strip() for d in (parsed.get("diagnoses") or []) if str(d).strip()],
            },
            "model": "claude-sonnet-4-5",
            "stt_model": "whisper-1",
        }
    finally:
        try:
            import os as _os
            _os.unlink(tmp_path)
        except Exception:
            pass
