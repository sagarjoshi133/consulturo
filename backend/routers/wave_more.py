"""ConsultUro — combined router for Wave 3 (O · P), Wave 4 (R · S · T)
and the lightweight ops endpoints that round out the polish backlog.

Endpoints
─────────
  · O  POST /api/ai/rx-suggest         (prescriber — Claude returns a draft Rx)
  · P  POST /api/ai/messages/triage    (staff — tag inbox items urgent/routine/...)
  · R  GET  /api/analytics/dashboard   (owner — month-to-date clinic widgets)
  · S  GET  /api/analytics/referrers   (owner — top referring doctors)
  · T  GET  /api/analytics/outcomes    (owner — procedure outcome roll-up)
"""
from __future__ import annotations

import json
import os
import re
import uuid
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from db import db
from auth_deps import require_owner, require_prescriber, require_staff
from server import block_if_demo
from services.tenancy import resolve_clinic_id, tenant_filter

load_dotenv()
router = APIRouter()


def _llm_key() -> str:
    k = os.environ.get("EMERGENT_LLM_KEY") or ""
    if not k:
        raise HTTPException(503, detail="LLM key not configured")
    return k


async def _claude(system: str, prompt: str, session_id: str) -> str:
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
    except Exception as e:  # pragma: no cover
        raise HTTPException(503, detail=f"emergentintegrations missing: {e}")
    chat = (
        LlmChat(api_key=_llm_key(), session_id=session_id, system_message=system)
        .with_model("anthropic", "claude-sonnet-4-5-20250929")
    )
    res = await chat.send_message(UserMessage(text=prompt))
    return res if isinstance(res, str) else str(res or "")


def _extract_json(text: str) -> Optional[Dict[str, Any]]:
    if not text:
        return None
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    candidate = m.group(1) if m else None
    if not candidate:
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
# O · AI Rx Suggestion
# ──────────────────────────────────────────────────────────────────────


_RX_SUGGEST_SYSTEM = """You are an expert urology consultant in India. Given a
diagnosis (and optionally age, sex, allergies, notes), suggest a SAFE starter
prescription. Output a SINGLE JSON object — NO prose:

{
  "diagnosis": "echo back/normalise the diagnosis",
  "rationale": "≤25 words explaining why this regimen",
  "medicines": [
    {"name":"...","dose":"...","frequency":"BD|TDS|OD|HS|SOS",
     "duration":"X days","instructions":"After food/SOS/etc."}
  ],
  "investigations": "Comma-separated workup",
  "advice": "Lifestyle / dietary",
  "follow_up": "When to come back",
  "warnings": ["interaction or contraindication notes"]
}

Hard rules:
• NEVER suggest a drug the patient is allergic to (allergies list provided).
• Use Indian generics & brand-neutral names.
• Default to commonly accepted first-line therapy. If diagnosis is ambiguous,
  return medicines:[] and put a clarifying question in `warnings`.
• Output JSON only.
"""


class RxSuggestBody(BaseModel):
    diagnosis: str
    age: Optional[int] = None
    sex: Optional[str] = None
    allergies: List[str] = Field(default_factory=list)
    notes: Optional[str] = ""


@router.post("/api/ai/rx-suggest")
async def ai_rx_suggest(body: RxSuggestBody, user=Depends(require_prescriber)):
    block_if_demo(user)
    if not (body.diagnosis or "").strip():
        raise HTTPException(400, detail="diagnosis required")

    ctx = {
        "diagnosis": body.diagnosis.strip(),
        "age": body.age,
        "sex": body.sex,
        "allergies": [a for a in (body.allergies or []) if a],
        "notes": (body.notes or "").strip(),
    }
    sid = f"rxsug_{uuid.uuid4().hex[:10]}"
    out = await _claude(_RX_SUGGEST_SYSTEM,
                        "Clinical input (JSON):\n" + json.dumps(ctx),
                        sid)
    parsed = _extract_json(out) or {}
    return {
        "ok": True,
        "diagnosis": (parsed.get("diagnosis") or body.diagnosis).strip(),
        "rationale": (parsed.get("rationale") or "").strip(),
        "medicines": parsed.get("medicines") or [],
        "investigations": (parsed.get("investigations") or "").strip(),
        "advice": (parsed.get("advice") or "").strip(),
        "follow_up": (parsed.get("follow_up") or "").strip(),
        "warnings": parsed.get("warnings") or [],
        "model": "claude-sonnet-4-5",
    }


# ──────────────────────────────────────────────────────────────────────
# P · Smart Inbox Triage
# ──────────────────────────────────────────────────────────────────────


_TRIAGE_SYSTEM = """You are a clinic triage assistant. Classify each inbox
message into ONE of these categories: urgent | routine | admin | question.

Definitions:
• urgent   — pain, bleeding, fever, post-op complication, "can't urinate",
             severe symptoms.  Needs same-day attention.
• question — patient asking about a medication, dose, side-effect.
• admin    — appointment reschedule, payment, paperwork, certificates.
• routine  — feedback, thanks, lab uploads, follow-up confirmation.

Output a SINGLE JSON array. Each element matches the input by id:
[
  {"id":"...", "tag":"urgent|routine|admin|question",
   "reason":"≤8 words", "score":0-100}
]
Output JSON only — no markdown, no explanation.
"""


class TriageBody(BaseModel):
    items: List[Dict[str, Any]] = Field(default_factory=list)


@router.post("/api/ai/messages/triage")
async def triage_messages(body: TriageBody, user=Depends(require_staff)):
    """Tag a batch of inbox items. Frontend passes the visible items;
    we annotate each with `triage_tag`, `triage_reason`, `triage_score`
    and (optionally) persist the tag back to `db.notifications`."""
    block_if_demo(user)
    items = body.items[:30]   # safety cap
    if not items:
        return {"ok": True, "results": []}

    simplified = [
        {"id": str(it.get("id") or it.get("notification_id") or i),
         "text": str(it.get("text") or it.get("message") or "")[:500]}
        for i, it in enumerate(items)
    ]
    sid = f"triage_{uuid.uuid4().hex[:10]}"
    out = await _claude(
        _TRIAGE_SYSTEM,
        "Inbox batch (JSON array):\n" + json.dumps(simplified, ensure_ascii=False),
        sid,
    )

    # Claude may return either a bare array or an object {results:[...]}.
    rows: List[Dict[str, Any]] = []
    text = out.strip()
    if text.startswith("```"):
        m = re.search(r"```(?:json)?\s*(\[.*?\]|\{.*?\})\s*```", text, re.DOTALL)
        if m:
            text = m.group(1)
    try:
        parsed: Any = json.loads(text)
    except Exception:
        parsed = _extract_json(text) or {}

    if isinstance(parsed, dict):
        parsed = parsed.get("results") or parsed.get("items") or []
    if isinstance(parsed, list):
        rows = parsed

    # Build a tag map keyed by ID; default to 'routine' for un-tagged items.
    by_id: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        if isinstance(r, dict) and r.get("id"):
            tag = str(r.get("tag") or "routine").lower()
            if tag not in {"urgent", "routine", "admin", "question"}:
                tag = "routine"
            by_id[str(r["id"])] = {
                "tag": tag,
                "reason": str(r.get("reason") or "")[:80],
                "score": int(r.get("score") or 0),
            }

    # Persist tags back where possible.
    for it in items:
        nid = it.get("notification_id") or it.get("id")
        if not nid:
            continue
        tag = by_id.get(str(nid))
        if not tag:
            continue
        try:
            await db.notifications.update_one(
                {"notification_id": nid},
                {"$set": {
                    "ai_triage_tag": tag["tag"],
                    "ai_triage_reason": tag["reason"],
                    "ai_triage_score": tag["score"],
                    "ai_triage_at": datetime.now(timezone.utc),
                }},
            )
        except Exception:
            pass

    return {
        "ok": True,
        "results": [
            {"id": k, **v} for k, v in by_id.items()
        ],
        "model": "claude-sonnet-4-5",
    }


# ──────────────────────────────────────────────────────────────────────
# R · Doctor / Clinic Dashboard widgets
# ──────────────────────────────────────────────────────────────────────


def _month_window(now: Optional[datetime] = None) -> tuple[datetime, datetime]:
    now = now or datetime.now(timezone.utc)
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return start, now


@router.get("/api/analytics/widgets")
async def analytics_dashboard(request: Request, user=Depends(require_owner)):
    clinic_id = await resolve_clinic_id(request, user)
    tenant = tenant_filter(user, clinic_id, allow_global=False)
    start, now = _month_window()

    # OPDs (bookings) this month.
    opd_count = await db.bookings.count_documents({
        **tenant,
        "created_at": {"$gte": start, "$lte": now},
    })

    # Surgeries this month.
    surgery_count = await db.surgeries.count_documents({
        **tenant,
        "created_at": {"$gte": start, "$lte": now},
    })

    # IPD admissions.
    try:
        ipd_count = await db.ipd_admissions.count_documents({
            **tenant,
            "created_at": {"$gte": start, "$lte": now},
        })
    except Exception:
        ipd_count = 0

    # Revenue: sum receipts.total or amount this month.
    pipe = [
        {"$match": {**tenant, "created_at": {"$gte": start, "$lte": now}}},
        {"$group": {"_id": None,
                    "total": {"$sum": {"$ifNull": ["$total", "$amount"]}}}},
    ]
    rev_agg = await db.receipts.aggregate(pipe).to_list(length=1)
    revenue = float((rev_agg[0] if rev_agg else {}).get("total") or 0)

    # Top procedure (most-named surgery in this month).
    sx_names: List[str] = []
    async for s in db.surgeries.find({**tenant, "created_at": {"$gte": start, "$lte": now}},
                                     {"_id": 0, "surgery_name": 1}):
        if s.get("surgery_name"):
            sx_names.append(s["surgery_name"].strip())
    top_procedure = Counter(sx_names).most_common(1)
    top_procedure_label = top_procedure[0][0] if top_procedure else "—"
    top_procedure_count = top_procedure[0][1] if top_procedure else 0

    # New patients this month.
    new_patients = await db.patients.count_documents(
        {"first_seen_at": {"$gte": start, "$lte": now}})

    # Pending receivables — bookings/receipts marked unpaid.
    try:
        pending = await db.receipts.count_documents({
            **tenant, "payment_status": "pending",
        })
    except Exception:
        pending = 0

    return {
        "ok": True,
        "month": start.strftime("%B %Y"),
        "widgets": {
            "opd_count": opd_count,
            "surgery_count": surgery_count,
            "ipd_count": ipd_count,
            "new_patients": new_patients,
            "revenue": round(revenue, 2),
            "pending_receivables": pending,
            "top_procedure": {
                "name": top_procedure_label,
                "count": top_procedure_count,
            },
        },
    }


# ──────────────────────────────────────────────────────────────────────
# S · Referral source analytics
# ──────────────────────────────────────────────────────────────────────


@router.get("/api/analytics/referrers")
async def analytics_referrers(
    request: Request,
    months: int = Query(6, ge=1, le=24),
    user=Depends(require_owner),
):
    clinic_id = await resolve_clinic_id(request, user)
    tenant = tenant_filter(user, clinic_id, allow_global=False)
    cutoff = datetime.now(timezone.utc) - timedelta(days=30 * months)

    # Pull referred_by from bookings + prescriptions in the window.
    referrers: Counter[str] = Counter()
    by_month: Dict[str, Counter[str]] = defaultdict(Counter)

    async for r in db.bookings.find({**tenant, "created_at": {"$gte": cutoff}},
                                    {"_id": 0, "referred_by": 1, "created_at": 1}):
        ref = (r.get("referred_by") or "").strip()
        if not ref or ref.lower() in {"self", "walk in", "walk-in", "—"}:
            continue
        referrers[ref] += 1
        ts = r.get("created_at")
        key = (ts.strftime("%Y-%m") if hasattr(ts, "strftime") else "unknown")
        by_month[key][ref] += 1

    async for r in db.prescriptions.find({**tenant, "created_at": {"$gte": cutoff}},
                                         {"_id": 0, "referred_by": 1, "created_at": 1}):
        ref = (r.get("referred_by") or "").strip()
        if not ref or ref.lower() in {"self", "walk in", "walk-in", "—"}:
            continue
        referrers[ref] += 1
        ts = r.get("created_at")
        key = (ts.strftime("%Y-%m") if hasattr(ts, "strftime") else "unknown")
        by_month[key][ref] += 1

    top = referrers.most_common(20)
    series: Dict[str, List[Dict[str, Any]]] = {}
    for ref, _ in top[:5]:
        series[ref] = [
            {"month": m, "count": by_month[m].get(ref, 0)}
            for m in sorted(by_month.keys())
        ]

    return {
        "ok": True,
        "window_months": months,
        "total_referred": sum(referrers.values()),
        "top": [{"name": n, "count": c} for n, c in top],
        "series": series,
    }


# ──────────────────────────────────────────────────────────────────────
# T · Surgical outcome roll-up
# ──────────────────────────────────────────────────────────────────────


@router.get("/api/analytics/outcomes-summary")
async def analytics_outcomes(
    request: Request,
    months: int = Query(12, ge=1, le=60),
    user=Depends(require_owner),
):
    clinic_id = await resolve_clinic_id(request, user)
    tenant = tenant_filter(user, clinic_id, allow_global=False)
    cutoff = datetime.now(timezone.utc) - timedelta(days=30 * months)

    by_procedure: Dict[str, Dict[str, int]] = defaultdict(
        lambda: {"total": 0, "success": 0, "complications": 0, "unknown": 0}
    )

    async for s in db.surgeries.find({**tenant, "created_at": {"$gte": cutoff}}, {"_id": 0}):
        proc = (s.get("surgery_name") or "Unknown").strip() or "Unknown"
        status = (s.get("outcome") or s.get("surgery_status") or "").lower()
        bucket = by_procedure[proc]
        bucket["total"] += 1
        if any(k in status for k in ["complication", "infection", "bleed", "fail"]):
            bucket["complications"] += 1
        elif any(k in status for k in ["success", "uneventful", "complete", "discharged"]):
            bucket["success"] += 1
        else:
            bucket["unknown"] += 1

    rows: List[Dict[str, Any]] = []
    for proc, b in by_procedure.items():
        success_rate = (b["success"] / b["total"]) * 100.0 if b["total"] else 0.0
        complication_rate = (b["complications"] / b["total"]) * 100.0 if b["total"] else 0.0
        rows.append({
            "procedure": proc,
            "total": b["total"],
            "success": b["success"],
            "complications": b["complications"],
            "unknown": b["unknown"],
            "success_rate": round(success_rate, 1),
            "complication_rate": round(complication_rate, 1),
        })
    rows.sort(key=lambda r: r["total"], reverse=True)

    return {
        "ok": True,
        "window_months": months,
        "procedures": rows[:50],
        "total_surgeries": sum(r["total"] for r in rows),
    }
