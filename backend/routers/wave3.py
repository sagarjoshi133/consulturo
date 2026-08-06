"""ConsultUro — Wave 3 router · AI features.

Bundles three AI-powered features:

  · M — Voice-to-Rx           POST /api/ai/voice-to-rx       (audio upload)
  · N — AI Patient Gist       GET  /api/ai/patient-gist?phone=
  · Q — Lab Report OCR        POST /api/ai/lab-ocr           (image upload)

All three use the Emergent universal LLM key. STT goes through
OpenAI Whisper-1 via emergentintegrations; parsing & vision use
Claude Sonnet 4.5. Demo accounts are write-blocked.

Caching: patient gist cached for 1 hour per phone.
"""
from __future__ import annotations

import base64
import io
import json
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from db import db
from auth_deps import require_prescriber, require_staff
from server import _normalize_phone, block_if_demo

load_dotenv()

router = APIRouter()


# ──────────────────────────────────────────────────────────────────────
# Shared LLM client helpers
# ──────────────────────────────────────────────────────────────────────

def _llm_key() -> str:
    """Return the Emergent universal key or raise 503."""
    k = os.environ.get("EMERGENT_LLM_KEY") or ""
    if not k:
        raise HTTPException(
            status_code=503,
            detail="LLM key not configured. Set EMERGENT_LLM_KEY in backend/.env.",
        )
    return k


async def _claude_one_shot(*, system: str, user_text: str, session_id: str,
                           image_b64: Optional[str] = None) -> str:
    """Send a single non-streaming Claude message and return the text.

    Lazy-imports emergentintegrations so the rest of the router still
    works when the package is missing.
    """
    try:
        from emergentintegrations.llm.chat import (
            LlmChat, UserMessage, ImageContent,
        )
    except Exception as e:  # pragma: no cover
        raise HTTPException(503, detail=f"emergentintegrations missing: {e}")

    chat = (
        LlmChat(api_key=_llm_key(), session_id=session_id, system_message=system)
        .with_model("anthropic", "claude-sonnet-4-5-20250929")
    )
    if image_b64:
        msg = UserMessage(text=user_text, file_contents=[ImageContent(image_base64=image_b64)])
    else:
        msg = UserMessage(text=user_text)
    res = await chat.send_message(msg)
    if isinstance(res, str):
        return res
    return str(res or "")


def _extract_json(text: str) -> Optional[Dict[str, Any]]:
    """Pull the first {...} JSON block from a Claude response.

    Claude often wraps JSON in ```json …``` fences or adds preamble; we
    look for the first balanced object. Returns None on failure.
    """
    if not text:
        return None
    # Strip fences if present.
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    candidate = m.group(1) if m else None
    if not candidate:
        # Fallback: first { to matching }
        start = text.find("{")
        if start < 0:
            return None
        depth = 0
        for i, c in enumerate(text[start:], start):
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    candidate = text[start:i + 1]
                    break
    if not candidate:
        return None
    try:
        return json.loads(candidate)
    except Exception:
        return None


# ──────────────────────────────────────────────────────────────────────
# M · Voice-to-Rx
# ──────────────────────────────────────────────────────────────────────


_VOICE_TO_RX_SYSTEM = """You are an expert medical scribe for an Indian urology clinic.
The doctor will dictate a prescription out loud. Convert the spoken transcript
into structured JSON that the EMR can apply directly.

Output a SINGLE JSON object — NO prose, NO markdown — with this exact shape:

{
  "diagnosis": "...",
  "medicines": [
    {"name": "...", "dose": "...", "frequency": "BD|TDS|OD|HS|SOS",
     "duration": "X days/weeks", "instructions": "After food/SOS/etc."}
  ],
  "investigations": "Comma-separated list",
  "advice": "Lifestyle / dietary advice",
  "follow_up": "When to come back"
}

Rules:
• If a field isn't mentioned, return an empty string (or empty array for medicines).
• Translate spoken frequencies: 'twice a day' → 'BD', 'three times' → 'TDS',
  'at bedtime' → 'HS', 'once daily' → 'OD', 'as needed' → 'SOS'.
• Preserve generic drug names exactly as spoken (Tamsulosin, Nitrofurantoin, etc.).
• Doses include units (mg, ml, units).
• Durations: "5 days", "2 weeks", "30 days".
• NEVER add medications the doctor didn't mention.
• Output JSON only — no preamble, no explanation.
"""


@router.post("/api/ai/voice-to-rx")
async def voice_to_rx(
    audio: UploadFile = File(...),
    language: str = Form("en"),
    user=Depends(require_prescriber),
):
    """Transcribe an audio file and parse it into a structured Rx draft.

    Two-stage:
      1. Whisper-1 (English/Hindi/Gujarati) → raw transcript.
      2. Claude Sonnet 4.5 → structured JSON.
    """
    block_if_demo(user)
    raw = await audio.read()
    if not raw:
        raise HTTPException(400, detail="Empty audio file")
    if len(raw) > 25 * 1024 * 1024:
        raise HTTPException(400, detail="Audio exceeds 25 MB limit (Whisper cap)")

    # Persist a temp file with the original extension so litellm/Whisper
    # detect the format correctly.
    suffix = (audio.filename or "audio.m4a").rsplit(".", 1)[-1].lower() or "m4a"
    if suffix not in {"mp3", "mp4", "mpeg", "mpga", "m4a", "wav", "webm"}:
        suffix = "m4a"
    tmp_path = f"/tmp/v2rx_{uuid.uuid4().hex}.{suffix}"
    with open(tmp_path, "wb") as fh:
        fh.write(raw)

    try:
        # 1) STT — Whisper-1 via emergentintegrations
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
                prompt="Indian urology clinic prescription. Common drugs: Tamsulosin, "
                       "Solifenacin, Nitrofurantoin, Ciprofloxacin, Paracetamol, "
                       "Drotaverine, Diclofenac. Frequencies: OD, BD, TDS, HS, SOS.",
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

        # 2) Parse — Claude Sonnet 4.5 → structured JSON
        sid = f"v2rx_{uuid.uuid4().hex[:10]}"
        claude_resp = await _claude_one_shot(
            system=_VOICE_TO_RX_SYSTEM,
            user_text=f"Transcript:\n\"\"\"\n{transcript}\n\"\"\"",
            session_id=sid,
        )
        parsed = _extract_json(claude_resp) or {}

        return {
            "ok": True,
            "transcript": transcript,
            "parsed": {
                "diagnosis": (parsed.get("diagnosis") or "").strip(),
                "medicines": parsed.get("medicines") or [],
                "investigations": (parsed.get("investigations") or "").strip(),
                "advice": (parsed.get("advice") or "").strip(),
                "follow_up": (parsed.get("follow_up") or "").strip(),
            },
            "model": "claude-sonnet-4-5",
            "stt_model": "whisper-1",
        }
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass


# ──────────────────────────────────────────────────────────────────────
# N · AI Patient Gist
# ──────────────────────────────────────────────────────────────────────


_GIST_SYSTEM = """You are a urology consultant. In ONE concise English sentence
(<= 22 words), summarise this patient based on the provided clinical context.
Format: "<age><M/F>, <key condition>, <current Rx>, <last visit Nd ago>, <trend>".
Examples:
  "65M, BPH on Tamsulosin 0.4mg, IPSS 22, last visit 12d ago, creatinine rising."
  "42F, recurrent UTI, off antibiotics 30d, no current meds, urine culture pending."
If a field is unknown, omit it. NO preamble, NO trailing period beyond the
sentence end. Output the sentence and nothing else."""


@router.get("/api/ai/patient-gist")
async def patient_gist(phone: str = "", refresh: bool = False, user=Depends(require_staff)):
    p = _normalize_phone(phone or "")
    if not p:
        raise HTTPException(400, detail="Phone required")

    now = datetime.now(timezone.utc)

    # 1-hour cache.
    if not refresh:
        cached = await db.patient_gist_cache.find_one({"phone": p}, {"_id": 0})
        if cached and cached.get("expires_at"):
            exp = cached["expires_at"]
            try:
                # MongoDB returns naive UTC datetimes — re-attach tz before compare.
                if isinstance(exp, datetime) and exp.tzinfo is None:
                    exp = exp.replace(tzinfo=timezone.utc)
                # Guard: only proceed with the comparison if `exp` is now a
                # proper aware datetime. Legacy rows that stored a string
                # would otherwise raise `can't compare datetime to str`.
                if isinstance(exp, datetime) and exp.tzinfo is not None and exp > now:
                    gen = cached.get("generated_at")
                    if isinstance(gen, datetime) and gen.tzinfo is None:
                        gen = gen.replace(tzinfo=timezone.utc)
                    return {
                        "phone": p, "gist": cached.get("gist") or "",
                        "cached": True, "generated_at": gen,
                    }
            except Exception as _e:
                # Cache hydration corrupt — fall through to regenerate.
                # This is defensive: never let cache parsing break the
                # request path; the fresh-compute branch will overwrite
                # the bad row.
                pass

    # Gather context.
    profile = await db.patients.find_one({"phone": p}, {"_id": 0}) or {}

    suffix = p[-10:] if len(p) >= 10 else p
    phone_q = {"patient_phone": {"$regex": suffix + "$"}}

    bookings: List[Dict[str, Any]] = []
    async for b in db.bookings.find(phone_q, {"_id": 0}).sort("created_at", -1).limit(3):
        bookings.append({"date": b.get("date"), "reason": b.get("reason") or b.get("purpose")})

    rxs: List[Dict[str, Any]] = []
    async for r in db.prescriptions.find(phone_q, {"_id": 0}).sort("created_at", -1).limit(3):
        meds = [m.get("name") for m in (r.get("medicines") or []) if m.get("name")][:4]
        rxs.append({
            "date": (r.get("created_at") or "").isoformat()[:10] if hasattr(r.get("created_at"), "isoformat") else "",
            "diagnosis": r.get("diagnosis"),
            "meds": meds,
        })

    labs: List[Dict[str, Any]] = []
    async for lab in db.lab_results.find({"phone": p}, {"_id": 0}).sort("date", -1).limit(8):
        labs.append({"date": lab.get("date"), "test": lab.get("test_name"), "value": lab.get("value"), "unit": lab.get("unit")})

    allergies = profile.get("allergies") or []

    # Compose JSON context for Claude.
    ctx = {
        "patient": {
            "age": profile.get("age"),
            "sex": profile.get("gender") or profile.get("sex"),
            "allergies": allergies,
        },
        "recent_bookings": bookings,
        "recent_prescriptions": rxs,
        "recent_labs": labs,
    }
    user_text = "Clinical context (JSON):\n" + json.dumps(ctx, indent=2, default=str)

    gist = ""
    try:
        out = await _claude_one_shot(
            system=_GIST_SYSTEM, user_text=user_text,
            session_id=f"gist_{p}_{int(now.timestamp())}",
        )
        gist = (out or "").strip().replace("\n", " ")
    except HTTPException:
        raise
    except Exception as e:
        # Degrade gracefully — return an empty gist with diagnostic message.
        gist = ""
        print(f"[patient_gist] Claude call failed: {e}")

    await db.patient_gist_cache.update_one(
        {"phone": p},
        {"$set": {
            "phone": p, "gist": gist,
            "generated_at": now,
            "expires_at": now + timedelta(hours=1),
        }},
        upsert=True,
    )
    return {"phone": p, "gist": gist, "cached": False, "generated_at": now}


# ──────────────────────────────────────────────────────────────────────
# Q · Lab Report OCR
# ──────────────────────────────────────────────────────────────────────


_LAB_OCR_SYSTEM = """You are a medical lab report parser. The user uploads a
photo of a printed lab report. Extract every quantitative test value into a
JSON object.

Output a SINGLE JSON object — NO prose, NO markdown — with this exact shape:

{
  "report_date": "YYYY-MM-DD or empty",
  "results": [
    {"test_name": "PSA", "value": 4.2, "unit": "ng/mL", "ref_range": "0-4"},
    {"test_name": "Creatinine", "value": 1.1, "unit": "mg/dL", "ref_range": "0.6-1.2"}
  ]
}

Rules:
• value MUST be a number (float). Skip any test that doesn't have a numeric reading.
• Map common abbreviations:  S.Creat → Creatinine, Hb → Hemoglobin, T.Bili → Bilirubin.
• If the report has tests we don't recognise, include them with the verbatim name.
• Skip qualitative results ("Positive", "Negative", "Normal") — numeric only.
• If you can't see the image clearly, return {"report_date":"","results":[]}.
• Output JSON only.
"""


@router.post("/api/ai/lab-ocr")
async def lab_ocr(
    image: UploadFile = File(...),
    phone: str = Form(""),
    auto_save: bool = Form(False),
    user=Depends(require_staff),
):
    """Run vision OCR on a lab report photo and optionally save the
    extracted rows into db.lab_results for the given phone.
    """
    block_if_demo(user)
    p = _normalize_phone(phone or "")
    if not p and auto_save:
        raise HTTPException(400, detail="phone is required when auto_save=true")

    raw = await image.read()
    if not raw:
        raise HTTPException(400, detail="Empty image")
    if len(raw) > 8 * 1024 * 1024:
        raise HTTPException(400, detail="Image exceeds 8 MB limit")
    # Quick MIME sniff — accept PNG / JPEG / WebP.
    head = raw[:12]
    if not (head.startswith(b"\x89PNG")
            or head.startswith(b"\xff\xd8\xff")
            or head[:4] == b"RIFF"):
        raise HTTPException(400, detail="Only PNG, JPEG, or WebP supported")

    image_b64 = base64.b64encode(raw).decode("ascii")
    sid = f"labocr_{uuid.uuid4().hex[:10]}"

    claude_resp = await _claude_one_shot(
        system=_LAB_OCR_SYSTEM,
        user_text="Parse this lab report image into structured JSON.",
        session_id=sid,
        image_b64=image_b64,
    )
    parsed = _extract_json(claude_resp) or {}
    results = [r for r in (parsed.get("results") or []) if isinstance(r, dict) and isinstance(r.get("value"), (int, float))]
    report_date = (parsed.get("report_date") or "").strip()

    saved_ids: List[str] = []
    if auto_save and p and results:
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        date_to_use = report_date or today
        for r in results:
            rid = f"lab_{uuid.uuid4().hex[:10]}"
            await db.lab_results.insert_one({
                "result_id": rid,
                "phone": p,
                "test_name": str(r.get("test_name") or "").strip()[:80],
                "test_key": str(r.get("test_name") or "").strip().lower(),
                "value": float(r.get("value")),
                "unit": str(r.get("unit") or "").strip()[:24],
                "date": date_to_use,
                "notes": f"OCR · ref {r.get('ref_range') or '—'}",
                "added_by": user.get("user_id"),
                "ocr": True,
                "created_at": datetime.now(timezone.utc),
            })
            saved_ids.append(rid)

    return {
        "ok": True,
        "phone": p,
        "report_date": report_date,
        "results": results,
        "saved": saved_ids,
        "saved_count": len(saved_ids),
        "model": "claude-sonnet-4-5",
    }
