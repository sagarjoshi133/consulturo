"""ConsultUro — Patient-facing AI Assistant (Gemini-powered).

A trilingual (EN / HI / GU) chatbot that helps patients:
  • Triage symptoms — asks 2–3 follow-ups, recommends booking video /
    in-person, links to relevant Education / Disease content, and
    flags red-flags (haematuria, fever + pain, acute retention) that
    need urgent care.
  • Answers FAQ about procedures, post-op care, billing, clinic
    timings — grounded on the clinic's own Diseases / Education /
    Surgical-Consents corpus (lightweight keyword RAG).

Endpoints:
  POST /api/assistant/chat        — send a message, get a reply
  GET  /api/assistant/history     — load my last N messages
  POST /api/assistant/reset       — start a fresh session
  GET  /api/assistant/suggestions — starter prompt chips for the UI

Storage:
  • db.assistant_conversations  — one doc per (user_id|session_id)
  • db.assistant_messages       — append-only history (last 20 used
                                   as context per turn to bound cost)

Safety:
  • Hard guard-rails in the system prompt: NEVER prescribe, NEVER
    diagnose, ALWAYS recommend booking for definitive care, ALWAYS
    flag red-flags for urgent attention.
  • Quick-detect for emergency keywords → short-circuit response with
    a "go to ER" message regardless of LLM output.
"""
from __future__ import annotations

import os
import re
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from emergentintegrations.llm.chat import LlmChat, UserMessage
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from auth_deps import get_current_user
from db import db

load_dotenv()

router = APIRouter()

EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "").strip()
DEFAULT_MODEL = ("gemini", "gemini-2.5-flash")

# Cap history per session to keep prompt + cost bounded.
HISTORY_LIMIT = 6      # last 6 turns (≈ 12 messages) injected as ctx
RAG_DOC_LIMIT = 4

# ─── Safety: instant-reply for medical red-flags ──────────────────
EMERGENCY_PATTERNS = [
    r"\b(can\s*not|cannot|can't|unable to)\s+(pass\s+)?urine\b",
    r"\bcomplete\s+retention\b",
    r"\bcan'?t\s+pee\b",
    r"\bgross\s+(haematuria|hematuria|blood\s+in\s+urine\b.*clot)",
    r"\bsevere\s+pain\b.*\b(testic|scrotum|flank|kidney)\b",
    r"\bhigh\s+fever\b.*\b(flank|kidney|urinary|urine)\b",
    r"\bblood\s+clot.*\burine\b",
    r"\btesticular\s+pain\b.*\bsudden\b",
    r"\bदर्द\b.*\bपेशाब\b",      # Hindi pain+urine
    r"\bપેશાબ\b.*\bદુખાવો\b",     # Gujarati urine+pain
]

LANG_CODES = {"en", "hi", "gu"}

# ─── Models ────────────────────────────────────────────────────────


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    session_id: Optional[str] = Field(None, max_length=80)
    lang: str = Field("en", description="One of en, hi, gu")


class ChatReply(BaseModel):
    reply: str
    session_id: str
    suggested_actions: List[Dict[str, str]] = Field(default_factory=list)
    is_emergency: bool = False


# ─── RAG helpers ───────────────────────────────────────────────────


def _stopwords() -> set[str]:
    return {
        "the", "a", "an", "and", "or", "is", "are", "i", "me", "my",
        "you", "have", "has", "had", "for", "of", "to", "in", "on",
        "at", "with", "do", "does", "did", "be", "was", "were", "from",
        "what", "why", "how", "when", "where", "क्या", "कैसे", "मुझे",
        "મને", "છે", "છો",
    }


def _keywords(text: str) -> List[str]:
    tokens = re.findall(r"[A-Za-z\u0900-\u097F\u0A80-\u0AFF]{4,}", text.lower())
    stop = _stopwords()
    return [t for t in tokens if t not in stop][:10]


async def _rag_context(user_msg: str) -> str:
    """RAG retrieval over the clinic's actual content sources:
       • disease_content (trilingual JSON, list_localized)
       • data.consent_procedures.PROCEDURES + PROCEDURES_PART2
    Returns a compact context block (~ 1-2 KB) the LLM can quote from.
    """
    kws = _keywords(user_msg)
    if not kws:
        return ""
    chunks: List[str] = []

    # ── 1. Diseases content (overview + when_to_see + treatments) ──
    try:
        from disease_content import list_localized
        diseases = list_localized("en")
        # Score by keyword hits across name + overview + symptoms + treatments
        scored: List[tuple[int, dict]] = []
        for d in diseases:
            hay = " ".join([
                str(d.get("name") or ""),
                str(d.get("tagline") or ""),
                str(d.get("overview") or ""),
                " ".join(d.get("symptoms") or []),
                " ".join(d.get("treatments") or []),
            ]).lower()
            score = sum(1 for kw in kws if kw in hay)
            if score:
                scored.append((score, d))
        scored.sort(key=lambda x: -x[0])
        for _score, d in scored[:RAG_DOC_LIMIT]:
            overview = (d.get("overview") or "")[:300]
            when = (d.get("when_to_see") or "")[:150]
            chunks.append(
                f"[DISEASE: {d.get('name')}]\n"
                f"  Overview: {overview}\n"
                f"  When to see doctor: {when}"
            )
    except Exception:
        pass

    # ── 2. Surgical procedures (consent corpus) ─────────────────────
    try:
        from data.consent_procedures import PROCEDURES  # auto-imports PART2 too
        scored: List[tuple[int, dict]] = []
        for key, proc in PROCEDURES.items():
            label = (proc.get("label") or {}).get("en", "")
            desc = (proc.get("description") or {}).get("en", "") or (proc.get("about") or {}).get("en", "")
            hay = f"{key} {label} {desc}".lower()
            score = sum(1 for kw in kws if kw in hay)
            if score:
                scored.append((score, {"key": key, "label": label, "desc": desc}))
        scored.sort(key=lambda x: -x[0])
        for _score, p in scored[:RAG_DOC_LIMIT]:
            blurb = (p["desc"] or "")[:280]
            if blurb or p["label"]:
                chunks.append(f"[PROCEDURE: {p['label'] or p['key']}]\n  {blurb}")
    except Exception:
        pass

    # ── 3. Pre-op checklist snippets ────────────────────────────────
    try:
        from data.preop_checklist import PREOP_CHECKLIST
        # Match procedure key
        for kw in kws:
            for key, items in PREOP_CHECKLIST.items():
                if kw in key.lower():
                    bullet_items = items if isinstance(items, list) else []
                    if bullet_items:
                        chunks.append(
                            f"[PRE-OP ({key.upper()})]\n  - "
                            + "\n  - ".join(str(x)[:140] for x in bullet_items[:6])
                        )
                    break
    except Exception:
        pass

    if not chunks:
        return ""
    block = "RELEVANT CLINIC CONTENT (quote these — do not invent):\n" + "\n\n".join(chunks[:8])
    return block[:3500]


def _is_emergency(text: str) -> bool:
    low = (text or "").lower()
    return any(re.search(p, low, flags=re.IGNORECASE) for p in EMERGENCY_PATTERNS)


def _emergency_reply(lang: str) -> str:
    if lang == "hi":
        return (
            "⚠️ यह लक्षण आपातकालीन हो सकते हैं। कृपया तुरंत निकटतम आपातकालीन कक्ष में जाएँ "
            "या डॉ. सागर जोशी के क्लिनिक को कॉल करें। पेशाब रुकना, गंभीर दर्द, या रक्त के थक्के "
            "तत्काल जाँच की आवश्यकता हो सकती है।"
        )
    if lang == "gu":
        return (
            "⚠️ આ લક્ષણો ગંભીર હોઈ શકે છે. કૃપા કરીને તાત્કાલિક નજીકના ઇમરજન્સી રૂમમાં જાઓ "
            "અથવા ડૉ. સાગર જોશીના ક્લિનિકને કૉલ કરો. પેશાબ રોકાય, તીવ્ર દુખાવો, કે લોહીના ગંઠા "
            "તાત્કાલિક તપાસની જરૂર પડી શકે છે."
        )
    return (
        "⚠️ Your symptoms could be a medical emergency. Please go to the nearest "
        "emergency room or call Dr. Sagar Joshi's clinic immediately. Inability to "
        "pass urine, severe pain, or blood clots in urine need urgent evaluation."
    )


STAFF_ROLES = {"primary_owner", "owner", "doctor", "front_desk", "ot_staff", "assistant"}


def _is_doctor_persona(user: Optional[Dict[str, Any]]) -> bool:
    if not user:
        return False
    return (user.get("role") or "").lower() in STAFF_ROLES


def _system_prompt_patient(lang: str, rag: str, history: List[Dict[str, Any]]) -> str:
    lang_name = {"en": "English", "hi": "Hindi (हिन्दी)", "gu": "Gujarati (ગુજરાતી)"}[lang if lang in LANG_CODES else "en"]
    hist_block = _build_history_block(history)
    return (
        "You are ConsultUro Assistant — a friendly, careful AI helper for patients of "
        "Dr. Sagar Joshi's urology clinic in India.\n\n"
        f"REPLY LANGUAGE: ALWAYS reply in {lang_name}.\n\n"
        "ROLE & SAFETY (non-negotiable):\n"
        "  • You are NOT a doctor. NEVER diagnose. NEVER prescribe medicines or doses.\n"
        "  • For ANY new symptom: (a) ask 1-2 short clarifying questions, "
        "(b) share lay-friendly info, (c) ALWAYS recommend booking.\n"
        "  • Emergency symptoms (inability to pass urine, severe pain, gross bleeding "
        "with clots, fever + flank pain) → go to ER + book.\n"
        "  • Never invent clinic facts (timings, fees). Use [[ACTION:CALL]] for that.\n"
        "  • Be empathetic, calm, ≤ 100 words unless details are explicitly asked.\n"
        "  • You CAN discuss: BPH, kidney stones, prostate cancer, UTIs, incontinence, "
        "fertility, IPSS, pre-op preparation, post-op care, booking guidance, "
        "PROCEDURES from RELEVANT CLINIC CONTENT below.\n"
        "  • You CANNOT: prescribe, dose, interpret reports definitively, give second "
        "opinions on another doctor's plan, discuss non-urological conditions in detail.\n\n"
        "ACTION TOKENS (CRITICAL — affects UI; strip from displayed text):\n"
        "  Append on a NEW LINE at the end of your reply, exactly:\n"
        "    [[ACTION:BOOK]]                       — when recommending booking.\n"
        "    [[ACTION:ER]]                         — when advising the emergency room.\n"
        "    [[ACTION:CALL]]                       — when patient should phone the clinic.\n"
        "    [[ACTION:IPSS]]                       — for prostate/BPH symptoms.\n"
        "    [[ACTION:PROPOSE_BOOK|when=YYYY-MM-DD HH:MM|mode=video|reason=<≤60c>]]\n"
        "      — when proposing a SPECIFIC appointment slot. Use ISO time in IST.\n"
        "      mode is one of: video, in_person. The frontend renders a 'Confirm "
        "booking' button that opens the booking form pre-filled with these values.\n"
        "    [[ACTION:CANCEL_BOOKING|booking_id=...]]\n"
        "      — propose cancelling. Only emit when patient asks explicitly AND you "
        "know the booking id (from RECENT CONVERSATION block).\n"
        "  Multiple tokens may appear, each on its own line.\n\n"
        "FORMAT:\n"
        "  • Plain prose, no markdown.\n"
        "  • End with ONE short call-to-action line, then your action token(s).\n\n"
        f"{hist_block}"
        f"{rag if rag else ''}"
    ).strip()


def _system_prompt_doctor(lang: str, rag: str, history: List[Dict[str, Any]], doctor_name: str = "Dr. Sagar Joshi") -> str:
    hist_block = _build_history_block(history)
    return (
        f"You are ConsultUro Clinical Assistant — an AI co-pilot for {doctor_name}, a "
        "urologist in India. The user IS THE DOCTOR (or trusted staff) — you may use "
        "clinical language, suggest doses (always with 'review-before-sign' caveat), "
        "interpret IPSS/eGFR/PSA, and warn about drug interactions.\n\n"
        "REPLY LANGUAGE: English by default.\n\n"
        "WHAT YOU CAN DO:\n"
        "  • Search patient history — when the doctor asks 'show me PCNL patients with "
        "stones >10 mm last 6 months' or similar, propose a SEARCH_BOOKINGS or "
        "SEARCH_SURGERIES action token (see below). Do not make up numbers.\n"
        "  • Draft WhatsApp templates for follow-up / pre-op / post-op / no-show — "
        "always polite, signed as 'Dr. Sagar Joshi's clinic'.\n"
        "  • Summarise long call/clinical notes into SOAP.\n"
        "  • Interpret IPSS scores (0-7 mild, 8-19 moderate, 20-35 severe), eGFR "
        "context (CKD stages G1-G5), PSA ranges.\n"
        "  • Warn about urology-relevant drug interactions (alpha-blockers + PDE5i, "
        "anticholinergics + glaucoma, finasteride pregnancy risk, etc.).\n\n"
        "SAFETY:\n"
        "  • You provide DRAFTS; the doctor reviews & signs.\n"
        "  • If asked for non-urology advice (oncology systemic chemo, neurology, "
        "cardiology beyond perioperative basics) — politely redirect.\n"
        "  • Never fabricate patient data. If you need a search, propose the token.\n\n"
        "ACTION TOKENS (CRITICAL — affect UI; strip from displayed text):\n"
        "  [[ACTION:SEARCH_BOOKINGS|surgery_type=PCNL|months_back=6|stone_size_gt_mm=10]]\n"
        "    — Frontend runs a SAFE Mongo query (whitelisted fields only) and\n"
        "    surfaces a result chip the doctor can tap to view.\n"
        "    Allowed filter keys: surgery_type, mode, status, months_back,\n"
        "    age_gt, age_lt, sex, stone_size_gt_mm, stone_size_lt_mm, days_back.\n"
        "  [[ACTION:WA_TEMPLATE|kind=preop|surgery=PCNL]]\n"
        "    — Frontend renders a 'Copy / send' button for the message in your reply.\n"
        "    kind ∈ {preop, postop, followup, noshow, results}.\n"
        "  [[ACTION:IPSS|score=N]]                   — links to IPSS calculator UI.\n"
        "  [[ACTION:DRUG_CHECK|meds=tamsulosin,sildenafil]] — frontend opens an "
        "  interaction-check panel for these drugs.\n"
        "  Multiple tokens may appear, each on its own line.\n\n"
        "FORMAT:\n"
        "  • Concise clinical prose with bullet points OK.\n"
        "  • Be direct — the doctor values brevity.\n\n"
        f"{hist_block}"
        f"{rag if rag else ''}"
    ).strip()


def _build_history_block(history: List[Dict[str, Any]]) -> str:
    if not history:
        return ""
    lines = []
    for h in history[-12:]:
        role = "User" if h.get("role") == "user" else "You"
        txt = (h.get("text") or "").strip().replace("\n", " ")
        if txt:
            lines.append(f"{role}: {txt[:400]}")
    if not lines:
        return ""
    return "RECENT CONVERSATION (most recent last):\n" + "\n".join(lines) + "\n\n"


def _system_prompt(lang: str, rag: str, history: List[Dict[str, Any]], user: Optional[Dict[str, Any]] = None) -> str:
    if _is_doctor_persona(user):
        return _system_prompt_doctor(lang, rag, history)
    return _system_prompt_patient(lang, rag, history)


# ─── DB helpers ────────────────────────────────────────────────────


def _normalize_session_id(user: Optional[Dict[str, Any]], explicit: Optional[str]) -> str:
    if explicit and len(explicit) <= 80 and re.match(r"^[A-Za-z0-9_\-]+$", explicit):
        return explicit
    if user and user.get("user_id"):
        return f"u-{user['user_id']}"
    return f"g-{uuid.uuid4().hex[:16]}"


async def _load_history(session_id: str) -> List[Dict[str, Any]]:
    cursor = db.assistant_messages.find(
        {"session_id": session_id},
        {"_id": 0, "role": 1, "text": 1, "at": 1},
    ).sort("at", -1).limit(HISTORY_LIMIT)
    rows = [r async for r in cursor]
    rows.reverse()
    return rows


async def _persist_message(session_id: str, user_id: Optional[str], role: str, text: str) -> None:
    try:
        await db.assistant_messages.insert_one({
            "id": str(uuid.uuid4()),
            "session_id": session_id,
            "user_id": user_id,
            "role": role,
            "text": text[:5000],
            "at": datetime.now(timezone.utc),
        })
        await db.assistant_conversations.update_one(
            {"session_id": session_id},
            {"$set": {
                "user_id": user_id,
                "last_active_at": datetime.now(timezone.utc),
            }, "$setOnInsert": {"created_at": datetime.now(timezone.utc)}},
            upsert=True,
        )
    except Exception:
        pass


# ─── Suggested-actions decoder ─────────────────────────────────────


def _parse_actions_from_tokens(text: str, lang: str) -> tuple[str, List[Dict[str, Any]]]:
    """Strip [[ACTION:X]] or [[ACTION:X|k=v|k=v]] tokens. Return
    (clean_text, action_chips). Supports both simple and parameterised
    tokens; parameters become extra fields on the action dict."""
    actions: List[Dict[str, Any]] = []
    seen: set[str] = set()

    # Match either bare or pipe-arg form
    pattern = re.compile(r"\[\[ACTION:([A-Z_]+)((?:\|[^\]\n]*)?)\]\]", re.IGNORECASE)

    for m in pattern.finditer(text):
        kind = m.group(1).upper()
        args_part = (m.group(2) or "").strip()
        params: Dict[str, str] = {}
        if args_part.startswith("|"):
            for kv in args_part[1:].split("|"):
                if "=" in kv:
                    k, v = kv.split("=", 1)
                    params[k.strip()] = v.strip()
        sig = kind + "|" + "&".join(f"{k}={v}" for k, v in sorted(params.items()))
        if sig in seen:
            continue
        seen.add(sig)

        if kind == "BOOK":
            actions.append({"label": _label("book", lang), "deep_link": "/book"})
        elif kind == "CALL" or kind == "ER":
            actions.append({"label": _label("call", lang), "deep_link": "tel:+918155075669"})
        elif kind == "IPSS":
            actions.append({"label": _label("ipss", lang), "deep_link": "/ipss",
                            "score": params.get("score", "")})
        elif kind == "PROPOSE_BOOK":
            # Build a deep-link with prefilled query params
            qp = []
            when = params.get("when", "")
            if when:
                # "YYYY-MM-DD HH:MM" → date + time params
                try:
                    d, t = when.split(" ", 1)
                    qp.append(f"date={d}")
                    qp.append(f"time={t}")
                except ValueError:
                    qp.append(f"when={when}")
            mode = params.get("mode", "")
            if mode:
                qp.append(f"mode={mode}")
            reason = params.get("reason", "")
            if reason:
                qp.append(f"reason={reason}")
            actions.append({
                "label": _label("propose_book", lang),
                "deep_link": "/book?" + "&".join(qp),
                "kind": "propose_book",
                **params,
            })
        elif kind == "CANCEL_BOOKING":
            bid = params.get("booking_id", "")
            actions.append({
                "label": _label("cancel", lang),
                "deep_link": f"/bookings/{bid}" if bid else "/bookings",
                "kind": "cancel_booking",
                "booking_id": bid,
            })
        elif kind == "SEARCH_BOOKINGS":
            actions.append({
                "label": "Run search",
                "deep_link": "_assistant_search_",  # special handler in UI
                "kind": "search_bookings",
                **params,
            })
        elif kind == "WA_TEMPLATE":
            actions.append({
                "label": "Copy / send",
                "deep_link": "_assistant_wa_",
                "kind": "wa_template",
                **params,
            })
        elif kind == "DRUG_CHECK":
            actions.append({
                "label": "Check interactions",
                "deep_link": "_assistant_drug_check_",
                "kind": "drug_check",
                **params,
            })

    clean = pattern.sub("", text)
    clean = re.sub(r"\n{3,}", "\n\n", clean).strip()
    return clean, actions[:5]


def _detect_actions(text: str, lang: str) -> List[Dict[str, str]]:
    """Tiny heuristic: if the assistant's reply contains a question
    about booking, add a 'Book consultation' chip. If it mentions
    urgent / ER, add a 'Call clinic' chip. The frontend renders these
    as quick-action buttons under the bubble."""
    actions: List[Dict[str, str]] = []
    low = text.lower()
    if "book" in low or "consultation" in low or "बुक" in text or "બુક" in text:
        actions.append({"label": _label("book", lang), "deep_link": "/book"})
    if "emergency" in low or "er " in low or "तुरंत" in text or "તાત્કાલિક" in text:
        actions.append({"label": _label("call", lang), "deep_link": "tel:+918155075669"})
    if "ipss" in low or "score" in low and "prostate" in low:
        actions.append({"label": _label("ipss", lang), "deep_link": "/ipss"})
    return actions[:3]


def _label(key: str, lang: str) -> str:
    table = {
        "book": {"en": "Book consultation", "hi": "अपॉइंटमेंट बुक करें", "gu": "મુલાકાત બુક કરો"},
        "call": {"en": "Call clinic", "hi": "क्लिनिक को कॉल करें", "gu": "ક્લિનિકને કૉલ કરો"},
        "ipss": {"en": "Take IPSS score", "hi": "IPSS स्कोर करें", "gu": "IPSS સ્કોર કરો"},
        "propose_book": {"en": "Confirm this booking", "hi": "बुकिंग की पुष्टि करें", "gu": "બુકિંગ પુષ્ટિ કરો"},
        "cancel": {"en": "Cancel booking", "hi": "बुकिंग रद्द करें", "gu": "બુકિંગ રદ કરો"},
    }
    return table.get(key, {}).get(lang, table.get(key, {}).get("en", key))


# ─── Endpoints ─────────────────────────────────────────────────────


@router.get("/api/assistant/health")
async def assistant_health() -> Dict[str, Any]:
    return {
        "configured": bool(EMERGENT_LLM_KEY),
        "model": "/".join(DEFAULT_MODEL),
    }


@router.get("/api/assistant/suggestions")
async def assistant_suggestions(request: Request, lang: str = "en") -> Dict[str, Any]:
    """Starter prompts the UI renders as chip buttons under the empty
    chat state. Doctor accounts get a clinical-tools bank; everyone
    else gets the patient bank."""
    user = None
    try:
        from server import _try_get_user_from_request
        user = await _try_get_user_from_request(request)
    except Exception:
        user = None

    if _is_doctor_persona(user):
        return {
            "suggestions": [
                "Show me PCNL cases from the last 6 months",
                "Draft a post-op WhatsApp for a TURP patient",
                "Interpret an IPSS score of 22",
                "Check interactions: tamsulosin + sildenafil",
                "Summarise: 'Pt 58M c/o weak stream x 6 mo, PSA 4.2, IPSS 18, USG showed enlarged prostate 65 g, PVR 95 mL.'",
            ],
            "lang": lang,
            "persona": "doctor",
        }

    bank = {
        "en": [
            "I have burning urination since 2 days — what should I do?",
            "What is the IPSS score for prostate?",
            "I have a kidney stone — should I do PCNL or RIRS?",
            "Tell me about post-op care after TURP",
            "Book me next Tuesday at 10 AM for a video consult",
        ],
        "hi": [
            "मुझे 2 दिनों से पेशाब में जलन है — क्या करूँ?",
            "प्रोस्टेट IPSS स्कोर क्या होता है?",
            "किडनी स्टोन के लिए PCNL या RIRS?",
            "TURP के बाद देखभाल कैसे करें?",
            "मुझे अगले मंगलवार 10 बजे वीडियो परामर्श बुक करें",
        ],
        "gu": [
            "મને 2 દિવસથી પેશાબમાં બળતરા છે — શું કરું?",
            "પ્રોસ્ટેટ IPSS સ્કોર શું છે?",
            "કિડની સ્ટોન માટે PCNL કે RIRS?",
            "TURP પછી કાળજી કેવી રીતે રાખું?",
            "મને આગલા મંગળવાર 10 વાગ્યે વિડિયો કન્સલ્ટ બુક કરો",
        ],
    }
    return {"suggestions": bank.get(lang, bank["en"]), "lang": lang, "persona": "patient"}


@router.get("/api/assistant/history")
async def assistant_history(
    request: Request,
    session_id: Optional[str] = None,
) -> Dict[str, Any]:
    # Optional auth — guests can browse their own session by passing session_id
    user = None
    try:
        from server import _try_get_user_from_request
        user = await _try_get_user_from_request(request)
    except Exception:
        user = None
    sid = _normalize_session_id(user, session_id)
    rows = await _load_history(sid)
    return {"session_id": sid, "messages": rows}


@router.post("/api/assistant/reset")
async def assistant_reset(
    request: Request,
    session_id: Optional[str] = None,
) -> Dict[str, Any]:
    user = None
    try:
        from server import _try_get_user_from_request
        user = await _try_get_user_from_request(request)
    except Exception:
        user = None
    sid = _normalize_session_id(user, session_id)
    try:
        await db.assistant_messages.delete_many({"session_id": sid})
        await db.assistant_conversations.delete_one({"session_id": sid})
    except Exception:
        pass
    return {"ok": True, "session_id": sid}


@router.post("/api/assistant/chat", response_model=ChatReply)
async def assistant_chat(body: ChatRequest, request: Request) -> ChatReply:
    if not EMERGENT_LLM_KEY:
        raise HTTPException(503, "Assistant not configured — admin must set EMERGENT_LLM_KEY.")
    user = None
    try:
        from server import _try_get_user_from_request
        user = await _try_get_user_from_request(request)
    except Exception:
        user = None
    user_id = (user or {}).get("user_id")
    lang = body.lang if body.lang in LANG_CODES else "en"
    sid = _normalize_session_id(user, body.session_id)

    # 1. Emergency short-circuit
    if _is_emergency(body.message):
        reply = _emergency_reply(lang)
        await _persist_message(sid, user_id, "user", body.message)
        await _persist_message(sid, user_id, "assistant", reply)
        return ChatReply(
            reply=reply,
            session_id=sid,
            suggested_actions=[
                {"label": _label("call", lang), "deep_link": "tel:+918155075669"},
                {"label": _label("book", lang), "deep_link": "/book"},
            ],
            is_emergency=True,
        )

    # 2. RAG retrieval (best-effort)
    rag_block = await _rag_context(body.message)

    # 3. Load chat history (last HISTORY_LIMIT turns) — embedded in
    #    the system prompt rather than replayed, so we keep this to
    #    a SINGLE LLM call per turn.
    history = await _load_history(sid)

    # 4. Build LLM session — fresh chat per turn (we own conversation
    #    memory via the system prompt block; the library's session
    #    persistence is intentionally bypassed so timeouts stay short).
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"{sid}-{uuid.uuid4().hex[:8]}",
        system_message=_system_prompt(lang, rag_block, history, user),
    ).with_model(*DEFAULT_MODEL)

    # 5. Send the new user message and await reply (one API call total)
    try:
        user_msg = UserMessage(text=body.message)
        reply = await chat.send_message(user_msg)
    except Exception as e:
        raise HTTPException(502, f"Assistant temporarily unavailable: {str(e)[:200]}")

    if not isinstance(reply, str):
        reply = str(reply or "")
    reply = reply.strip()

    # 6. Parse action tokens out of the LLM reply
    clean_reply, llm_actions = _parse_actions_from_tokens(reply, lang)

    # 7. If the LLM forgot to emit any tokens but the text obviously
    #    recommends booking, fall back to the heuristic detector.
    actions = llm_actions if llm_actions else _detect_actions(clean_reply, lang)

    await _persist_message(sid, user_id, "user", body.message)
    await _persist_message(sid, user_id, "assistant", clean_reply)

    return ChatReply(
        reply=clean_reply,
        session_id=sid,
        suggested_actions=actions,
        is_emergency=False,
    )


# ─── Doctor-side helper endpoints (safe Mongo search + tools) ──────


@router.get("/api/assistant/search/bookings")
async def search_bookings(
    request: Request,
    surgery_type: Optional[str] = None,
    mode: Optional[str] = None,
    status: Optional[str] = None,
    months_back: int = 6,
    days_back: Optional[int] = None,
    age_gt: Optional[int] = None,
    age_lt: Optional[int] = None,
    sex: Optional[str] = None,
    stone_size_gt_mm: Optional[float] = None,
    stone_size_lt_mm: Optional[float] = None,
    limit: int = 25,
) -> Dict[str, Any]:
    """STAFF-ONLY safe Mongo search for clinical history.

    Whitelisted filters only — prevents injection / abuse. Returns
    summarised rows (no PHI beyond what the doctor would already see
    in the bookings list).
    """
    user = None
    try:
        from server import _try_get_user_from_request
        user = await _try_get_user_from_request(request)
    except Exception:
        user = None
    if not _is_doctor_persona(user):
        raise HTTPException(403, "Staff only.")

    # Build query against db.bookings (and optionally db.surgeries)
    q: Dict[str, Any] = {}
    if surgery_type:
        q["surgery_type"] = {"$regex": re.escape(surgery_type), "$options": "i"}
    if mode:
        q["mode"] = mode
    if status:
        q["status"] = status
    if sex:
        q["$or"] = [{"sex": sex}, {"patient_sex": sex}]
    if age_gt is not None or age_lt is not None:
        age_q: Dict[str, Any] = {}
        if age_gt is not None:
            age_q["$gte"] = age_gt
        if age_lt is not None:
            age_q["$lte"] = age_lt
        q["$or"] = q.get("$or") or []
        q["$or"].extend([{"age": age_q}, {"patient_age": age_q}])

    # date range
    if days_back:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=int(days_back))).date().isoformat()
    else:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=int(months_back) * 30)).date().isoformat()
    q["booking_date"] = {"$gte": cutoff}

    cursor = db.bookings.find(q, {
        "_id": 0, "booking_id": 1, "patient_name": 1,
        "patient_age": 1, "patient_sex": 1, "patient_phone": 1,
        "surgery_type": 1, "mode": 1, "status": 1,
        "booking_date": 1, "booking_time": 1,
        "stone_size_mm": 1, "stone_size": 1, "diagnosis": 1,
    }).sort("booking_date", -1).limit(min(int(limit) or 25, 100))
    rows = [r async for r in cursor]

    # Apply stone-size filter in Python (covers strings & numerics)
    if stone_size_gt_mm is not None or stone_size_lt_mm is not None:
        def _sz(r: Dict[str, Any]) -> Optional[float]:
            v = r.get("stone_size_mm") or r.get("stone_size")
            if v is None:
                return None
            try:
                return float(re.findall(r"[\d.]+", str(v))[0])
            except Exception:
                return None
        filtered = []
        for r in rows:
            sz = _sz(r)
            if sz is None:
                continue
            if stone_size_gt_mm is not None and sz < float(stone_size_gt_mm):
                continue
            if stone_size_lt_mm is not None and sz > float(stone_size_lt_mm):
                continue
            filtered.append(r)
        rows = filtered

    return {"count": len(rows), "results": rows, "filters_applied": {
        k: v for k, v in {
            "surgery_type": surgery_type, "mode": mode, "status": status,
            "months_back": months_back, "days_back": days_back,
            "age_gt": age_gt, "age_lt": age_lt, "sex": sex,
            "stone_size_gt_mm": stone_size_gt_mm, "stone_size_lt_mm": stone_size_lt_mm,
        }.items() if v is not None
    }}


@router.get("/api/assistant/drug-check")
async def drug_check(
    request: Request,
    meds: str = "",
) -> Dict[str, Any]:
    """Quick urology-focused drug-interaction check.
    Pass comma-separated medicine names. Returns a short, manual list
    of common interactions relevant to urology practice. NOT a
    replacement for a formulary — clearly labelled as guidance only."""
    user = None
    try:
        from server import _try_get_user_from_request
        user = await _try_get_user_from_request(request)
    except Exception:
        user = None
    if not _is_doctor_persona(user):
        raise HTTPException(403, "Staff only.")

    items = [m.strip().lower() for m in (meds or "").split(",") if m.strip()]
    if not items:
        return {"warnings": [], "meds": []}

    # Curated urology interaction matrix (NOT exhaustive)
    INTERACTIONS = {
        ("tamsulosin", "sildenafil"): "Risk of symptomatic hypotension when alpha-blocker is co-administered with PDE5 inhibitors. Separate doses by ≥4 h; start sildenafil at 25 mg.",
        ("tamsulosin", "tadalafil"): "Symptomatic hypotension possible. Avoid stacking; if combo needed for BPH + ED, prefer tadalafil 5 mg once-daily monotherapy.",
        ("silodosin", "ketoconazole"): "Strong CYP3A4 inhibitor — contraindicated with silodosin (markedly raises plasma levels).",
        ("solifenacin", "fluconazole"): "Increases solifenacin exposure; reduce solifenacin to 5 mg/day.",
        ("oxybutynin", "donepezil"): "Antagonistic — anticholinergic worsens cognitive function in elderly on cholinesterase inhibitors.",
        ("finasteride", "pregnancy"): "Pregnancy Category X — handle with gloves; do NOT give to women of child-bearing potential.",
        ("warfarin", "ciprofloxacin"): "INR rises sharply — monitor closely.",
        ("nitrofurantoin", "eGFR"): "Avoid if eGFR <45 mL/min — peripheral neuropathy + reduced efficacy.",
        ("methotrexate", "trimethoprim"): "Bone marrow suppression — avoid combo.",
    }

    findings: List[Dict[str, str]] = []
    item_set = set(items)
    for (a, b), warn in INTERACTIONS.items():
        if (a in item_set or any(a in m for m in items)) and (
            b in item_set or any(b in m for m in items)
        ):
            findings.append({"pair": f"{a} + {b}", "severity": "moderate", "advice": warn})

    return {
        "meds": items,
        "warnings": findings,
        "disclaimer": (
            "ConsultUro drug-check covers common urology-relevant interactions only. "
            "For a comprehensive review use a formulary (BNF / Lexicomp / Medscape)."
        ),
    }


@router.get("/api/assistant/wa-template")
async def wa_template(
    request: Request,
    kind: str = "followup",
    surgery: str = "",
    patient_name: str = "",
) -> Dict[str, Any]:
    """Return a polished WhatsApp template the doctor can edit + send.
    Kinds: preop, postop, followup, noshow, results."""
    user = None
    try:
        from server import _try_get_user_from_request
        user = await _try_get_user_from_request(request)
    except Exception:
        user = None
    if not _is_doctor_persona(user):
        raise HTTPException(403, "Staff only.")

    name = (patient_name or "{patient}").split(" ")[0]
    sx = surgery or "your procedure"
    BANK = {
        "preop": (
            f"Hello {name},\n\nThis is a reminder that {sx} is scheduled tomorrow. "
            "Please observe the following:\n"
            "• Nothing to eat/drink (NPO) from midnight\n"
            "• Continue routine medicines with sips of water unless told otherwise\n"
            "• Reach the hospital 1 hour before the scheduled time\n"
            "• Bring all reports + insurance papers\n\n"
            "If you have fever, cough, or any new symptom in the last 24 h, please "
            "call us before coming.\n\n— Dr. Sagar Joshi's clinic"
        ),
        "postop": (
            f"Hello {name},\n\nHope you're recovering well after {sx}. A gentle reminder:\n"
            "• Take all medicines exactly as prescribed\n"
            "• Drink 2.5-3 L water per day unless restricted\n"
            "• Avoid heavy lifting for 2 weeks\n"
            "• Watch for: high fever, bleeding, severe pain, or burning urination "
            "lasting > 48 h — call us if any of these appear.\n\n"
            "Follow-up appointment as scheduled.\n— Dr. Sagar Joshi's clinic"
        ),
        "followup": (
            f"Hello {name},\n\nThis is a friendly follow-up — please update us on "
            "how you're doing. If symptoms are improving, you can continue as advised. "
            "If anything is unusual, reply here or book a quick consultation.\n\n"
            "— Dr. Sagar Joshi's clinic"
        ),
        "noshow": (
            f"Hello {name},\n\nWe noticed you missed your scheduled appointment. "
            "We hope everything is okay. Please reply with a convenient day & time "
            "to reschedule, or tap below to book directly.\n\n— Dr. Sagar Joshi's clinic"
        ),
        "results": (
            f"Hello {name},\n\nYour reports have arrived and Dr. Sagar Joshi has reviewed them. "
            "Please book a short consultation to discuss the findings and the next steps.\n\n"
            "— Dr. Sagar Joshi's clinic"
        ),
    }
    return {"kind": kind, "message": BANK.get(kind, BANK["followup"])}

