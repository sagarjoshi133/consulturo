"""ConsultUro — AI clinical-document assistance router.

Powers the three "Generate with AI" buttons across the clinical
workflow:

  · POST /api/ai/medical-certificate/draft  — diagnosis-aware advice
                                                 + start/end date hints
  · POST /api/ai/progress-note/draft        — SOAP draft for IPD daily
                                                 notes (uses vitals + prior
                                                 notes when provided)
  · POST /api/ai/discharge-summary/generate — full ≥2-page narrative
                                                 with detailed operative
                                                 note

Backed by the Emergent universal LLM key + emergentintegrations.
Gemini 2.5 Flash for short-form (cert / progress-note); Claude
Sonnet 4.5 for the discharge summary so we get a higher-quality
multi-page clinical write-up.

All endpoints require an authenticated clinician (super_owner /
primary_owner / owner / partner / doctor / prescriber) — patients
never see AI-draft endpoints to avoid liability concerns.
"""
from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from auth_deps import require_user

log = logging.getLogger(__name__)
router = APIRouter()

# ─── Auth gate ───────────────────────────────────────────────────
CLINICIAN_ROLES = {
    "super_owner", "primary_owner", "owner", "partner",
    "doctor", "prescriber",
}


def _require_clinician(user: Dict[str, Any]) -> None:
    role = (user.get("role") or "").lower()
    if role not in CLINICIAN_ROLES:
        raise HTTPException(
            status_code=403,
            detail="Only the treating clinician can generate AI drafts.",
        )


def _api_key() -> str:
    key = os.environ.get("EMERGENT_LLM_KEY") or os.environ.get("EMERGENT_LLM_API_KEY")
    if not key:
        raise HTTPException(status_code=503, detail="LLM not configured")
    return key


async def _chat(
    system: str,
    prompt: str,
    *,
    provider: str = "gemini",
    model: str = "gemini-2.5-flash",
    session_prefix: str = "ai-doc",
) -> str:
    """Single-turn helper. Returns the raw assistant text or raises 502
    on any LLM failure."""
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    sid = f"{session_prefix}-{uuid.uuid4().hex[:8]}"
    try:
        chat = (
            LlmChat(api_key=_api_key(), session_id=sid, system_message=system)
            .with_model(provider, model)
        )
        reply = await chat.send_message(UserMessage(text=prompt))
        text = (reply or "").strip()
        if not text:
            raise RuntimeError("Empty LLM reply")
        return text
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        log.exception("AI draft failed (%s/%s): %s", provider, model, exc)
        raise HTTPException(status_code=502, detail=f"AI draft failed: {exc}") from exc


# ─── Medical Certificate ──────────────────────────────────────────


class MedCertDraftBody(BaseModel):
    kind: str = Field(default="sick_leave")
    diagnosis: str = ""
    patient_age: Optional[int] = None
    patient_gender: Optional[str] = None
    days: Optional[int] = None
    addressed_to: Optional[str] = None
    extra_context: Optional[str] = ""


@router.post("/api/ai/medical-certificate/draft")
async def draft_medical_certificate(body: MedCertDraftBody, user=Depends(require_user)):
    _require_clinician(user)
    sys_msg = (
        "You are an experienced Indian urology consultant drafting "
        "a brief, professional Medical Certificate. Use formal "
        "clinical language. Output PLAIN TEXT, no markdown, no "
        "headings. Stay strictly factual and avoid making up "
        "specific dates that the user has not provided."
    )
    parts: List[str] = []
    parts.append(f"Certificate kind: {body.kind}")
    if body.diagnosis:
        parts.append(f"Diagnosis: {body.diagnosis}")
    if body.patient_age is not None:
        parts.append(f"Age: {body.patient_age}")
    if body.patient_gender:
        parts.append(f"Gender: {body.patient_gender}")
    if body.days is not None:
        parts.append(f"Days of rest / fitness window: {body.days}")
    if body.addressed_to:
        parts.append(f"Addressed to: {body.addressed_to}")
    if body.extra_context:
        parts.append(f"Notes from doctor: {body.extra_context}")
    user_msg = (
        "Draft 2–4 sentences of professional CLINICAL ADVICE / "
        "POST-CONSULTATION INSTRUCTIONS suitable to print on this "
        "medical certificate. Do NOT repeat the diagnosis verbatim. "
        "Output the advice text only.\n\n" + "\n".join(parts)
    )
    advice = await _chat(sys_msg, user_msg, session_prefix="medcert")
    return {"advice": advice}


# ─── IPD Progress Note (SOAP) ─────────────────────────────────────


class ProgressNoteDraftBody(BaseModel):
    patient_name: Optional[str] = None
    patient_age: Optional[int] = None
    patient_gender: Optional[str] = None
    diagnosis: Optional[str] = None
    pod: Optional[int] = Field(default=None, description="Post-op day, if applicable")
    vitals: Optional[Dict[str, Any]] = None
    prior_notes: Optional[str] = ""
    chief_complaints: Optional[str] = ""
    plan_hint: Optional[str] = ""


@router.post("/api/ai/progress-note/draft")
async def draft_progress_note(body: ProgressNoteDraftBody, user=Depends(require_user)):
    _require_clinician(user)
    sys_msg = (
        "You are a senior urology resident writing a concise daily "
        "IPD progress note in standard SOAP format. Use precise "
        "medical English; bullet style is fine for O / A / P. "
        "Never invent vital signs or findings; if a value isn't "
        "provided, say 'not documented'. Output plain text only."
    )
    bits: List[str] = []
    if body.patient_name:
        bits.append(f"Patient: {body.patient_name}")
    if body.patient_age is not None:
        bits.append(f"Age: {body.patient_age}")
    if body.patient_gender:
        bits.append(f"Gender: {body.patient_gender}")
    if body.diagnosis:
        bits.append(f"Working diagnosis: {body.diagnosis}")
    if body.pod is not None:
        bits.append(f"Post-op day: {body.pod}")
    if body.chief_complaints:
        bits.append(f"Chief complaints today: {body.chief_complaints}")
    if body.vitals:
        vline = ", ".join(f"{k}={v}" for k, v in body.vitals.items() if v not in (None, ""))
        if vline:
            bits.append(f"Vitals: {vline}")
    if body.prior_notes:
        bits.append(f"Yesterday's note (summary): {body.prior_notes}")
    if body.plan_hint:
        bits.append(f"Plan hint from doctor: {body.plan_hint}")
    user_msg = (
        "Write a SOAP progress note (S / O / A / P) for today. "
        "Keep it ≤180 words. End the P section with a clear, "
        "actionable plan in 3–5 bullets.\n\n" + "\n".join(bits)
    )
    note = await _chat(sys_msg, user_msg, session_prefix="progress")
    return {"note": note}


# ─── Discharge Summary (detailed, multi-page) ─────────────────────


class DischargeSummaryGenBody(BaseModel):
    patient_name: Optional[str] = None
    patient_age: Optional[int] = None
    patient_gender: Optional[str] = None
    registration_no: Optional[str] = None
    diagnosis: Optional[str] = None
    presenting_complaints: Optional[str] = ""
    past_history: Optional[str] = ""
    examination_findings: Optional[str] = ""
    investigations: Optional[str] = ""
    surgery_name: Optional[str] = None
    surgery_date: Optional[str] = None
    operative_note_seed: Optional[str] = Field(
        default="",
        description="Free-text seed for the operative note — surgeon will edit.",
    )
    course_in_hospital: Optional[str] = ""
    admission_date: Optional[str] = None
    discharge_date: Optional[str] = None
    discharge_medications: Optional[str] = ""
    advice: Optional[str] = ""
    follow_up: Optional[str] = ""
    final_status: Optional[str] = ""


@router.post("/api/ai/discharge-summary/generate")
async def generate_discharge_summary(
    body: DischargeSummaryGenBody, user=Depends(require_user)
):
    _require_clinician(user)
    sys_msg = (
        "You are a board-certified urologist drafting a complete, "
        "professional Indian-format DISCHARGE SUMMARY for an inpatient. "
        "The output MUST be detailed, medically accurate, and span "
        "at least 2 printed A4 pages when typeset. Use clear section "
        "headings (UPPERCASE), short paragraphs, and clinical English. "
        "Include a fully-written OPERATIVE NOTE under its own heading "
        "with: indication, anaesthesia, position, incision/access, "
        "step-by-step procedure, intra-op findings, blood loss, "
        "complications (or 'nil'), closure, and post-op orders. "
        "Never invent specific lab values or imaging findings the user "
        "did not provide — if data is missing, write 'not documented' "
        "or 'as per file'."
    )

    sections_input = []
    sections_input.append(f"PATIENT: {body.patient_name or '—'}")
    if body.patient_age is not None or body.patient_gender:
        sections_input.append(
            f"AGE / SEX: {body.patient_age or '—'} / {body.patient_gender or '—'}"
        )
    if body.registration_no:
        sections_input.append(f"REG. NO.: {body.registration_no}")
    if body.admission_date:
        sections_input.append(f"DATE OF ADMISSION: {body.admission_date}")
    if body.discharge_date:
        sections_input.append(f"DATE OF DISCHARGE: {body.discharge_date}")
    if body.diagnosis:
        sections_input.append(f"FINAL DIAGNOSIS: {body.diagnosis}")
    if body.presenting_complaints:
        sections_input.append(f"PRESENTING COMPLAINTS: {body.presenting_complaints}")
    if body.past_history:
        sections_input.append(f"PAST HISTORY: {body.past_history}")
    if body.examination_findings:
        sections_input.append(f"EXAMINATION ON ADMISSION: {body.examination_findings}")
    if body.investigations:
        sections_input.append(f"INVESTIGATIONS: {body.investigations}")
    if body.surgery_name or body.surgery_date:
        sections_input.append(
            f"SURGERY: {body.surgery_name or '—'} on {body.surgery_date or 'date as per file'}"
        )
    if body.operative_note_seed:
        sections_input.append(f"OPERATIVE-NOTE SEED: {body.operative_note_seed}")
    if body.course_in_hospital:
        sections_input.append(f"COURSE IN HOSPITAL: {body.course_in_hospital}")
    if body.discharge_medications:
        sections_input.append(f"DISCHARGE MEDICATIONS: {body.discharge_medications}")
    if body.advice:
        sections_input.append(f"ADVICE: {body.advice}")
    if body.follow_up:
        sections_input.append(f"FOLLOW-UP: {body.follow_up}")
    if body.final_status:
        sections_input.append(f"CONDITION AT DISCHARGE: {body.final_status}")

    user_msg = (
        "Generate a complete discharge summary using EXACTLY the "
        "section order below. Each section MUST have content — "
        "expand provided notes into 2–3 sentences each, and write "
        "'Not documented' where the surgeon supplied nothing. "
        "Output PLAIN TEXT with the section headings UPPERCASED and "
        "followed by a colon. Do not use markdown.\n\n"
        "REQUIRED SECTIONS (in order):\n"
        "1) PATIENT IDENTIFICATION\n"
        "2) DIAGNOSIS\n"
        "3) PRESENTING COMPLAINTS\n"
        "4) PAST HISTORY\n"
        "5) EXAMINATION ON ADMISSION\n"
        "6) INVESTIGATIONS\n"
        "7) OPERATIVE NOTE  (detailed — indication, anaesthesia, "
        "position, incision/access, step-by-step procedure, findings, "
        "blood loss, complications, closure, post-op orders)\n"
        "8) COURSE IN HOSPITAL\n"
        "9) CONDITION AT DISCHARGE\n"
        "10) DISCHARGE MEDICATIONS  (drug · dose · route · "
        "frequency · duration)\n"
        "11) ADVICE ON DISCHARGE\n"
        "12) FOLLOW-UP PLAN\n\n"
        "INPUT FROM CLINICIAN:\n" + "\n".join(sections_input)
    )

    summary = await _chat(
        sys_msg,
        user_msg,
        provider="anthropic",
        model="claude-sonnet-4-5-20250929",
        session_prefix="discharge",
    )
    return {"summary": summary, "model": "claude-sonnet-4-5"}


# ─── Per-field Discharge Summary draft (IPD admission-aware) ──────
#
# The full /api/ai/discharge-summary/generate endpoint above produces
# the whole 2-page summary in one shot. Phase 6.3 lets the clinician
# generate JUST ONE field at a time (Course in Hospital, Condition at
# Discharge, Discharge Meds, Diet Advice, Follow-up Plan, Operative
# Notes) — using the FULL admission context (rounds, vitals, drug
# chart, consents, surgeries, operative notes) pulled from the IPD
# collections server-side. This way the clinician can re-generate any
# single field as the chart evolves without disturbing the others.

from db import db  # local import to keep router self-contained
from services.tenancy import resolve_clinic_id  # Phase 6.3 — scope by clinic

VALID_FIELDS = {
    "course_in_hospital",
    "condition_at_discharge",
    "discharge_meds",
    "diet_advice",
    "follow_up_plan",
    "operative_notes",
}

# Per-field instruction (≤120 words each) — kept compact so we can
# inline them into the prompt without bloating tokens. Each
# instruction tells the LLM exactly the format and length expected.
FIELD_INSTRUCTIONS = {
    "course_in_hospital": (
        "Write a CHRONOLOGICAL narrative of the patient's hospital "
        "stay in 4–8 sentences. Begin with admission, then walk "
        "through key daily-round findings, any procedure performed, "
        "post-op recovery milestones, response to medications, and "
        "complications (or 'uneventful'). Reference dates only if "
        "they appear in the source data. Plain text, no bullets, no "
        "markdown."
    ),
    "condition_at_discharge": (
        "In 1–2 short sentences describe the patient's CONDITION AT "
        "DISCHARGE: general status (stable/improved), vitals trend "
        "if normalised, wound/operative site status if a procedure "
        "was done, mobility, pain control, and any pending concerns. "
        "Plain text, no bullets."
    ),
    "discharge_meds": (
        "List the patient's DISCHARGE MEDICATIONS. Use the format: "
        "'Drug name — Strength — Route — Frequency — Duration'. "
        "One drug per line. Prefer drugs that are still ACTIVE on "
        "the chart at discharge (status != 'stopped'). Append "
        "anticipated add-ons based on diagnosis/surgery only if "
        "obviously required (e.g. analgesic + acid-suppressant + "
        "stool softener for any urology surgery). Plain text."
    ),
    "diet_advice": (
        "Give DIET ADVICE in 2–4 short sentences appropriate for "
        "the surgery/diagnosis. Be specific (e.g. 'High-fluid diet "
        "≥3 L/day; restrict oxalate-rich foods for 6 weeks' for "
        "stone disease). Plain text."
    ),
    "follow_up_plan": (
        "Write the FOLLOW-UP PLAN in 3–5 short lines. Include: "
        "next OPD visit window (e.g. 'After 7 days for suture / "
        "DJ stent review'), what to bring (reports, current "
        "medication list), red-flag symptoms requiring earlier "
        "review, and any scheduled procedure (e.g. DJ stent "
        "removal at 4 weeks). Plain text, one item per line."
    ),
    "operative_notes": (
        "Write a FULL OPERATIVE NOTE for the surgery. Use this "
        "exact structure as section labels on separate lines:\n"
        "DATE: …\nSURGEON: …\nANAESTHESIA: …\nPOSITION: …\n"
        "INDICATION: …\nINCISION / ACCESS: …\nPROCEDURE: …\n"
        "(step-by-step paragraph, 4–8 sentences)\n"
        "FINDINGS: …\nESTIMATED BLOOD LOSS: …\n"
        "COMPLICATIONS: …\nCLOSURE: …\nDRAINS / CATHETERS: …\n"
        "POST-OP ORDERS: …\n"
        "Use the surgeon's recorded `operative_note` from the "
        "surgery record verbatim where present; only expand "
        "missing sections from the planned procedure / consent "
        "template. Never invent specific findings."
    ),
}


class DischargeFieldDraftBody(BaseModel):
    field: str = Field(..., description="One of: " + ", ".join(sorted(VALID_FIELDS)))
    extra_hint: Optional[str] = Field(
        default="",
        description="Optional free-text hint from the doctor to bias the draft.",
    )


def _fmt_date(v: Any) -> str:
    if not v:
        return ""
    if isinstance(v, datetime):
        return v.isoformat()
    return str(v)


async def _gather_admission_context(admission_id: str, clinic_id: Optional[str] = None) -> Dict[str, Any]:
    """Pull the full IPD episode snapshot for AI context.

    Returns a compact dict containing the admission row plus chronological
    lists of rounds, vitals, drug-chart entries, consents, and surgeries
    (with their detailed operative notes). Designed to fit inside a
    single LLM context window even for long stays — we cap each list
    at sensible sizes and drop Mongo's `_id`.
    """
    # Scope by clinic when provided (matches the rest of routers/ipd.py).
    q: Dict[str, Any] = {"id": admission_id}
    if clinic_id:
        q["clinic_id"] = clinic_id
    adm = await db.admissions.find_one(q, {"_id": 0})
    if not adm:
        raise HTTPException(404, "Admission not found")

    rounds = [
        r async for r in db.ipd_rounds.find(
            {"admission_id": admission_id}, {"_id": 0}
        ).sort("note_at", 1).limit(60)
    ]
    vitals = [
        v async for v in db.ipd_vitals.find(
            {"admission_id": admission_id}, {"_id": 0}
        ).sort("recorded_at", 1).limit(80)
    ]
    drugs = [
        d async for d in db.ipd_drug_chart.find(
            {"admission_id": admission_id}, {"_id": 0}
        ).sort("created_at", 1).limit(80)
    ]
    consents = [
        c async for c in db.surgical_consents.find(
            {"admission_id": admission_id, "deleted_at": None}, {"_id": 0}
        ).sort("created_at", 1).limit(20)
    ]
    # Surgeries linked to this admission. We safely build the
    # `$or` arms only when we have something to match, and if no
    # admission_id and no booking_id are present we return an empty
    # list (don't fall back to "all surgeries minus deleted").
    or_arms: List[Dict[str, Any]] = [{"admission_id": admission_id}]
    if adm.get("booking_id"):
        or_arms.append({"booking_id": adm["booking_id"]})
    surg_query: Dict[str, Any] = {"$or": or_arms, "deleted_at": None}
    surgeries = [
        s async for s in db.surgeries.find(surg_query, {"_id": 0}).sort("created_at", 1).limit(10)
    ]

    return {
        "admission": adm,
        "rounds": rounds,
        "vitals": vitals,
        "drugs": drugs,
        "consents": consents,
        "surgeries": surgeries,
    }


def _build_context_block(ctx: Dict[str, Any]) -> str:
    """Compact, LLM-friendly markdown-style summary of the admission."""
    adm = ctx["admission"]
    lines: List[str] = []
    lines.append("=== PATIENT ===")
    lines.append(
        f"{adm.get('patient_name','—')} · {adm.get('patient_age','—')}y · "
        f"{adm.get('patient_sex') or adm.get('patient_gender') or '—'}"
    )
    if adm.get("registration_no"):
        lines.append(f"Reg. No.: {adm['registration_no']}")
    lines.append(f"IPD No.: {adm.get('ipd_no','—')}")
    lines.append(f"Admitted: {_fmt_date(adm.get('admitted_at'))}")
    if adm.get("discharged_at"):
        lines.append(f"Discharged: {_fmt_date(adm['discharged_at'])}")
    if adm.get("diagnosis"):
        lines.append(f"Working diagnosis: {adm['diagnosis']}")
    if adm.get("planned_procedure"):
        lines.append(f"Planned procedure: {adm['planned_procedure']}")
    if adm.get("presenting_complaints"):
        lines.append(f"Presenting complaints: {adm['presenting_complaints']}")
    if adm.get("past_history"):
        lines.append(f"Past history: {adm['past_history']}")
    if adm.get("investigations_summary"):
        lines.append(f"Investigations on admission: {adm['investigations_summary']}")
    # Additional admission fields that often appear in the New
    # Admission form — surface them when present so the AI can weave
    # them into the Course-in-Hospital / Condition-at-Discharge
    # narrative without us having to fan-out to other collections.
    if adm.get("chief_complaints"):
        lines.append(f"Chief complaints: {adm['chief_complaints']}")
    if adm.get("examination") or adm.get("clinical_examination"):
        lines.append(f"Clinical examination: {adm.get('examination') or adm.get('clinical_examination')}")
    if adm.get("allergies"):
        lines.append(f"Allergies: {adm['allergies']}")
    if adm.get("comorbidities") or adm.get("comorbid_conditions"):
        lines.append(f"Co-morbidities: {adm.get('comorbidities') or adm.get('comorbid_conditions')}")
    if adm.get("consulting_doctor"):
        lines.append(f"Consulting doctor: {adm['consulting_doctor']}")
    if adm.get("ward") or adm.get("bed_no"):
        lines.append(f"Ward / Bed: {adm.get('ward') or '—'} · {adm.get('bed_no') or '—'}")

    rounds = ctx.get("rounds") or []
    if rounds:
        lines.append("")
        lines.append("=== DAILY PROGRESS NOTES (chronological) ===")
        for r in rounds:
            ts = _fmt_date(r.get("note_at") or r.get("created_at"))[:16]
            note = (r.get("note") or "").strip().replace("\n", " ")
            if len(note) > 400:
                note = note[:400] + "…"
            lines.append(f"[{ts}] {note}")

    vitals = ctx.get("vitals") or []
    if vitals:
        lines.append("")
        lines.append("=== VITALS (chronological) ===")
        # Sample at most 12 entries (first 2 + every Nth + last 2) so
        # we don't overflow context for long stays.
        vsamples = vitals if len(vitals) <= 12 else (
            vitals[:2] + vitals[2:-2:max(1, (len(vitals) - 4) // 8)] + vitals[-2:]
        )
        for v in vsamples:
            ts = _fmt_date(v.get("recorded_at") or v.get("created_at"))[:16]
            parts = []
            for k in ("temp_c", "pulse", "bp_sys", "bp_dia", "spo2", "rr", "pain"):
                if v.get(k) not in (None, ""):
                    parts.append(f"{k}={v[k]}")
            lines.append(f"[{ts}] " + ", ".join(parts))

    drugs = ctx.get("drugs") or []
    if drugs:
        lines.append("")
        lines.append("=== DRUG CHART ===")
        for d in drugs:
            status = d.get("status") or "active"
            name = d.get("drug_name") or d.get("name") or "—"
            dose = d.get("dose") or ""
            freq = d.get("frequency") or ""
            route = d.get("route") or ""
            started = _fmt_date(d.get("started_at") or d.get("created_at"))[:10]
            stopped = _fmt_date(d.get("stopped_at"))[:10] if d.get("stopped_at") else ""
            lines.append(
                f"- {name} {dose} {route} {freq} "
                f"(started {started}{', stopped ' + stopped if stopped else ''}) [{status}]"
            )

    consents = ctx.get("consents") or []
    if consents:
        lines.append("")
        lines.append("=== CONSENTS (signed) ===")
        for c in consents:
            keys = c.get("procedure_keys") or ([c.get("procedure_key")] if c.get("procedure_key") else [])
            snaps = c.get("procedure_snapshots") or ([c.get("procedure_snapshot")] if c.get("procedure_snapshot") else [])
            lang = c.get("language") or "en"
            names = [
                (s or {}).get("name", {}).get("en") or (s or {}).get("name", {}).get(lang) or ""
                for s in snaps
            ] if snaps else keys
            signed = _fmt_date(c.get("signed_at") or c.get("created_at"))[:16]
            lines.append(f"- {' + '.join(filter(None, names))} (lang={lang}, signed={signed})")
            # Surface the snapshot's clinical description + anaesthesia
            # so the AI can quote it verbatim when drafting Operative
            # Notes / Course-in-Hospital for cases where the surgeon
            # didn't separately record an `operative_note` on the
            # surgery row. The English snapshot is authoritative.
            for s in (snaps or []):
                proc_desc = (s or {}).get("procedure", {}).get("en") if s else ""
                anaes = (s or {}).get("anesthesia") or ""
                if proc_desc:
                    short = proc_desc.strip().replace("\n", " ")
                    if len(short) > 320:
                        short = short[:320] + "…"
                    lines.append(f"  Procedure description: {short}")
                if anaes:
                    lines.append(f"  Anaesthesia (planned): {anaes}")
            # Doctor's added notes on the consent (if any)
            extra = (c.get("doctor_notes") or c.get("additional_notes") or "").strip()
            if extra:
                if len(extra) > 240:
                    extra = extra[:240] + "…"
                lines.append(f"  Doctor's consent notes: {extra}")

    surgeries = ctx.get("surgeries") or []
    if surgeries:
        lines.append("")
        lines.append("=== SURGERIES (with operative notes) ===")
        for s in surgeries:
            d = s.get("scheduled_date") or s.get("date") or ""
            t = s.get("scheduled_time") or s.get("start_time") or ""
            name = s.get("surgery_name") or "—"
            room = s.get("ot_room") or ""
            dx = s.get("diagnosis") or ""
            status = s.get("surgery_status") or "scheduled"
            lines.append(f"- {name} on {d} {t} ({room}) — status={status}")
            if dx:
                lines.append(f"  Diagnosis: {dx}")
            surgeon = s.get("surgeon") or s.get("primary_surgeon") or ""
            if surgeon:
                lines.append(f"  Surgeon: {surgeon}")
            anaes = s.get("anesthesia") or s.get("anaesthesia") or ""
            if anaes:
                lines.append(f"  Anaesthesia: {anaes}")
            # Intra-op + post-op clinical details — the surgeon often
            # records these on the surgery row instead of the long
            # `operative_note` field. We surface them line-by-line so
            # the AI can splice them into the discharge narrative.
            if s.get("operative_findings"):
                of = (s["operative_findings"] or "").strip().replace("\n", " ")
                if len(of) > 600:
                    of = of[:600] + "…"
                lines.append(f"  Operative findings: {of}")
            if s.get("blood_loss"):
                lines.append(f"  Estimated blood loss: {s['blood_loss']}")
            if s.get("complications"):
                lines.append(f"  Intra-op complications: {s['complications']}")
            if s.get("post_op_investigations"):
                pi = (s["post_op_investigations"] or "").strip().replace("\n", " ")
                if len(pi) > 400:
                    pi = pi[:400] + "…"
                lines.append(f"  Post-op investigations: {pi}")
            if s.get("notes"):
                nn = (s["notes"] or "").strip().replace("\n", " ")
                if len(nn) > 400:
                    nn = nn[:400] + "…"
                lines.append(f"  Surgeon's notes: {nn}")
            op_note = (s.get("operative_note") or "").strip()
            if op_note:
                if len(op_note) > 1500:
                    op_note = op_note[:1500] + "…"
                lines.append("  OPERATIVE NOTE (verbatim from surgeon):")
                for ln in op_note.splitlines():
                    lines.append(f"    {ln}")

    return "\n".join(lines)


@router.post("/api/ai/ipd/{admission_id}/discharge-field")
async def draft_discharge_field(
    admission_id: str,
    body: DischargeFieldDraftBody,
    request: Request,
    user=Depends(require_user),
):
    """Generate AI-drafted text for ONE field of the Discharge Summary.

    The server pulls the full admission context (rounds, vitals, drug
    chart, consents, surgeries with operative notes) so the clinician
    doesn't have to hand-feed it. Returns plain text that the front-
    end then drops into the corresponding field (still editable).
    """
    _require_clinician(user)
    if body.field not in VALID_FIELDS:
        raise HTTPException(
            400, f"Unknown field. Allowed: {', '.join(sorted(VALID_FIELDS))}"
        )
    clinic_id = await resolve_clinic_id(request, user) or "default"
    ctx = await _gather_admission_context(admission_id, clinic_id=clinic_id)
    context_block = _build_context_block(ctx)
    if len(context_block) > 18000:
        # Hard cap to keep token use sane; trim daily notes section.
        context_block = context_block[:18000] + "\n…(context truncated)"

    sys_msg = (
        "You are a board-certified urologist drafting one section of "
        "an Indian-format DISCHARGE SUMMARY. You will be given the "
        "patient's full IPD chart — admission details, daily rounds, "
        "vitals trends, drug chart (with start/stop dates), signed "
        "surgical CONSENTS (with their snapshotted procedure "
        "description + anaesthesia + risks), and SURGERIES with their "
        "operative findings, anaesthesia, blood loss, complications "
        "and the surgeon's verbatim operative note. Your job: write "
        "ONLY the requested section, in clear clinical English, using "
        "the EXACT format described in the field instruction below. "
        "STRICT rules:\n"
        "  • NEVER invent values not present in the chart — write "
        "'not documented' or omit the line if data is missing.\n"
        "  • Prefer the surgeon's verbatim `operative_note` over the "
        "consent's generic procedure description.\n"
        "  • When the surgery row has structured fields "
        "(operative_findings, blood_loss, complications, "
        "post_op_investigations), use them verbatim.\n"
        "  • Quote dates exactly as they appear in the chart (do not "
        "convert timezones).\n"
        "  • Output plain text, no markdown, no headings other than "
        "what the field instruction explicitly requires."
    )
    user_msg = (
        f"FIELD TO GENERATE: {body.field}\n\n"
        f"FIELD INSTRUCTION:\n{FIELD_INSTRUCTIONS[body.field]}\n\n"
        + (f"DOCTOR'S HINT: {body.extra_hint}\n\n" if body.extra_hint else "")
        + "PATIENT CHART:\n"
        + context_block
        + "\n\nNow output the field text only."
    )

    draft = await _chat(
        sys_msg,
        user_msg,
        provider="anthropic",
        model="claude-sonnet-4-5-20250929",
        session_prefix=f"discharge-field-{body.field}",
    )
    return {"field": body.field, "text": draft, "model": "claude-sonnet-4-5"}
