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
    "follow_up_date": 1,
}


def _parse_follow_up(date_str: Optional[str]) -> tuple[Optional[str], Optional[datetime]]:
    """Normalise a 'YYYY-MM-DD' follow-up date to (clean_str, reminder_dt).
    The reminder fires at 09:00 IST (03:30 UTC) on that day."""
    s = (date_str or "").strip()[:10]
    if not s:
        return None, None
    try:
        y, m, d = (int(x) for x in s.split("-"))
        dt = datetime(y, m, d, 3, 30, 0, tzinfo=timezone.utc)  # 09:00 IST
        return s, dt
    except Exception:
        return None, None


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
    follow_up_date: Optional[str] = None


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
    follow_up_date: Optional[str] = None


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
    fu_str, fu_at = _parse_follow_up(body.follow_up_date)
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
        "follow_up_date": fu_str,
        "follow_up_at": fu_at,
        "follow_up_notified": False,
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


@router.get("/api/encounters/followups")
async def list_followups(
    request: Request,
    user=Depends(require_staff),
    scope: str = "upcoming",
    limit: int = 100,
):
    """Follow-ups due. scope='today' → only today's (IST); 'upcoming' →
    today onward (default). Clinic-scoped, sorted by date ascending."""
    clinic_id = await resolve_clinic_id(request, user)
    filt: Dict[str, Any] = tenant_filter(user, clinic_id, allow_global=True)
    # Today's date in IST.
    from datetime import timedelta as _td
    ist_now = datetime.now(timezone.utc) + _td(hours=5, minutes=30)
    today = ist_now.strftime("%Y-%m-%d")
    filt["follow_up_done"] = {"$ne": True}
    if scope == "today":
        filt["follow_up_date"] = today
    else:
        filt["follow_up_date"] = {"$gte": today}
    limit = max(1, min(int(limit or 100), 300))
    proj = dict(_LIST_PROJECTION)
    items = await (
        db.encounters.find(filt, proj)
        .sort("follow_up_date", 1)
        .limit(limit)
        .to_list(length=limit)
    )
    return {"items": items, "today": today, "count": len(items)}


@router.post("/api/encounters/{encounter_id}/followup/done")
async def complete_followup(encounter_id: str, request: Request, user=Depends(require_staff)):
    """Mark a follow-up complete — it drops off the Follow-ups list but
    the encounter itself is retained (nothing is deleted)."""
    clinic_id = await resolve_clinic_id(request, user)
    filt = tenant_filter(user, clinic_id, allow_global=True)
    filt["encounter_id"] = encounter_id
    existing = await db.encounters.find_one(filt, {"_id": 1})
    if not existing:
        raise HTTPException(status_code=404, detail="Encounter not found")
    await db.encounters.update_one(
        {"_id": existing["_id"]},
        {"$set": {
            "follow_up_done": True,
            "follow_up_done_at": datetime.now(timezone.utc),
            "follow_up_notified": True,  # suppress any pending reminder
        }},
    )
    return {"ok": True, "encounter_id": encounter_id, "follow_up_done": True}


async def scan_and_fire_encounter_followups(now: datetime) -> None:
    """Notify the encounter's provider on the morning of the follow-up
    day. Fired from the server 60s reminder loop."""
    cursor = db.encounters.find({
        "follow_up_at": {"$lte": now},
        "follow_up_notified": {"$ne": True},
    }).limit(100)
    async for enc in cursor:
        try:
            from server import create_notification
            name = (enc.get("patient_name") or "Patient").strip()
            provider = enc.get("created_by")
            if provider:
                await create_notification(
                    user_id=provider,
                    title=f"📅 Follow-up today: {name}",
                    body=(enc.get("chief_complaint") or "Scheduled follow-up visit.")[:140],
                    kind="encounter_followup",
                    data={"type": "encounter_followup", "encounter_id": enc.get("encounter_id")},
                    push=True,
                )
            await db.encounters.update_one(
                {"_id": enc["_id"]},
                {"$set": {"follow_up_notified": True, "follow_up_notified_at": now}},
            )
        except Exception:
            pass


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
    if body.follow_up_date is not None:
        fu_str, fu_at = _parse_follow_up(body.follow_up_date)
        updates["follow_up_date"] = fu_str
        updates["follow_up_at"] = fu_at
        # Changing/clearing the date re-arms the reminder and re-opens a
        # previously-completed follow-up.
        updates["follow_up_notified"] = False
        updates["follow_up_done"] = False
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
