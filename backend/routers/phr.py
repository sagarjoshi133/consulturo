"""ConsultUro — Personal Health Record (PHR) consolidator (Phase 5.5).

Returns a single bundle for the signed-in patient containing:
  • profile          : core patient info
  • bookings         : last 100, newest first
  • prescriptions    : last 100
  • receipts         : last 100
  • surgeries        : all (usually few)
  • admissions       : all (with embedded discharge_summary)
  • ipss_scores      : last 20
  • notifications    : last 30 (in-app bell)
  • timeline         : chronological feed of all of the above
                       (event_type, ts, title, subtitle, deep_link)

Used by /my-records to render the new Timeline tab + power the
"Download for offline" button (one-shot fetch → AsyncStorage cache).
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Request

from auth_deps import require_user
from db import db

log = logging.getLogger(__name__)
router = APIRouter()


def _clean(row: Dict[str, Any]) -> Dict[str, Any]:
    if not row:
        return {}
    row.pop("_id", None)
    for k, v in list(row.items()):
        if isinstance(v, datetime):
            row[k] = v.isoformat()
    return row


def _ts_str(v: Any) -> str:
    """Best-effort to extract an ISO timestamp string from a row."""
    if isinstance(v, datetime):
        return v.isoformat()
    return str(v or "")


async def _list(collection: str, query: Dict[str, Any], sort_key: str, limit: int = 100):
    cursor = db[collection].find(query).sort(sort_key, -1).limit(limit)
    out: List[Dict[str, Any]] = []
    async for r in cursor:
        out.append(_clean(r))
    return out


@router.get("/api/patients/me/phr")
async def get_phr(request: Request, user=Depends(require_user)):
    user_id = user.get("user_id")
    phone = user.get("phone")
    # OR query — match by either user_id OR phone (last-10) so legacy
    # records that lack user_id still appear.
    or_match: List[Dict[str, Any]] = []
    if user_id:
        or_match.append({"user_id": user_id})
        or_match.append({"patient_user_id": user_id})
    if phone:
        digits = "".join(c for c in str(phone) if c.isdigit())[-10:]
        or_match.append({"patient_phone": digits})
        or_match.append({"phone": digits})
    if not or_match:
        return {"profile": user, "timeline": [], "bookings": [], "prescriptions": [], "receipts": [], "surgeries": [], "admissions": [], "ipss_scores": [], "notifications": []}
    q = {"$or": or_match}

    profile = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0, "session_token": 0})
    bookings = await _list("bookings", q, "date", 100)
    prescriptions = await _list("prescriptions", q, "created_at", 100)
    receipts = await _list("receipts", q, "created_at", 100)
    surgeries = await _list("surgeries", q, "surgery_date", 50)
    admissions = await _list("admissions", q, "admitted_at", 30)
    ipss = await _list("ipss_scores", q, "created_at", 20)
    # Notifications scoped strictly by user_id (phone-only notifs can be noisy).
    notif_q: Dict[str, Any] = {}
    notif_or: List[Dict[str, Any]] = []
    if user_id:
        notif_or.append({"user_id": user_id})
    if phone:
        digits = "".join(c for c in str(phone) if c.isdigit())[-10:]
        notif_or.append({"phone": digits})
    if notif_or:
        notif_q["$or"] = notif_or
    notifications = await _list("notifications", notif_q, "created_at", 30) if notif_q else []

    # ── Build timeline ───────────────────────────────────────────
    timeline: List[Dict[str, Any]] = []
    for b in bookings:
        ts = b.get("date") or b.get("created_at") or ""
        timeline.append({
            "event_type": "booking",
            "ts": _ts_str(ts),
            "title": f"Consultation — {b.get('mode', 'visit').replace('_', ' ').title()}",
            "subtitle": f"{b.get('reason') or 'Visit'} · {b.get('status') or 'scheduled'}",
            "deep_link": f"/booking/{b.get('booking_id') or b.get('id')}",
            "id": b.get("booking_id") or b.get("id"),
        })
    for p in prescriptions:
        timeline.append({
            "event_type": "prescription",
            "ts": _ts_str(p.get("created_at")),
            "title": "📄 Prescription issued",
            "subtitle": ", ".join([m.get("name", "") for m in (p.get("medicines") or [])][:3]) or (p.get("clinical_diagnosis") or "Rx"),
            "deep_link": f"/prescriptions/{p.get('prescription_id') or p.get('id')}",
            "id": p.get("prescription_id") or p.get("id"),
        })
    for r in receipts:
        timeline.append({
            "event_type": "receipt",
            "ts": _ts_str(r.get("created_at")),
            "title": f"🧾 Receipt — ₹{r.get('total', 0)}",
            "subtitle": f"{r.get('payment_mode', '')} · {r.get('receipt_no', '')}",
            "deep_link": f"/receipts/{r.get('receipt_id') or r.get('id')}",
            "id": r.get("receipt_id") or r.get("id"),
        })
    for s in surgeries:
        ts = s.get("surgery_date") or s.get("created_at")
        timeline.append({
            "event_type": "surgery",
            "ts": _ts_str(ts),
            "title": f"🔪 Surgery — {s.get('surgery_type', '')}",
            "subtitle": f"{s.get('surgery_status', 'scheduled')} · {s.get('hospital_name', '')}",
            "deep_link": f"/surgeries/{s.get('surgery_id') or s.get('id')}",
            "id": s.get("surgery_id") or s.get("id"),
        })
    for a in admissions:
        if a.get("status") == "discharged":
            timeline.append({
                "event_type": "discharge",
                "ts": _ts_str(a.get("discharged_at")),
                "title": "🏥 Discharged",
                "subtitle": (a.get("discharge_summary") or {}).get("final_diagnosis") or a.get("diagnosis") or "Discharge summary",
                "deep_link": f"/ipd/{a.get('id')}",
                "id": a.get("id"),
            })
        else:
            timeline.append({
                "event_type": "admission",
                "ts": _ts_str(a.get("admitted_at")),
                "title": f"🛏️ Admitted ({a.get('ipd_no', '')})",
                "subtitle": a.get("diagnosis") or a.get("planned_procedure") or "Inpatient stay",
                "deep_link": f"/ipd/{a.get('id')}",
                "id": a.get("id"),
            })
    for ip in ipss:
        timeline.append({
            "event_type": "ipss",
            "ts": _ts_str(ip.get("created_at")),
            "title": f"📊 IPSS — {ip.get('total_score') or '?'}/35",
            "subtitle": ip.get("severity") or "",
            "deep_link": "/ipss",
            "id": ip.get("id"),
        })

    # Sort timeline desc by ts.
    timeline.sort(key=lambda x: x.get("ts") or "", reverse=True)

    return {
        "profile": _clean(profile or user),
        "bookings": bookings,
        "prescriptions": prescriptions,
        "receipts": receipts,
        "surgeries": surgeries,
        "admissions": admissions,
        "ipss_scores": ipss,
        "notifications": notifications,
        "timeline": timeline,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/api/patients/me/phr/export.html")
async def export_phr_html(request: Request, user=Depends(require_user)):
    """Returns a self-contained HTML page summarising the PHR — the
    frontend pipes this through /api/render/html (WeasyPrint) to
    produce a downloadable PDF. Keeping the HTML server-side so the
    same template renders identically on phone vs web.
    """
    bundle = await get_phr(request, user)
    p = bundle["profile"] or {}
    name = p.get("name") or p.get("display_name") or "Patient"
    phone = p.get("phone") or ""
    reg = p.get("reg_no") or ""

    def section(title: str, rows: List[str]) -> str:
        if not rows:
            return ""
        return f"<h3>{title}</h3><ul>" + "".join(f"<li>{r}</li>" for r in rows) + "</ul>"

    bookings_html = section("Consultations", [
        f"<b>{b.get('date','—')} {b.get('time','')}</b> · {b.get('mode','').replace('_',' ')} · {b.get('reason','')} · <i>{b.get('status','')}</i>"
        for b in bundle["bookings"][:30]
    ])
    rx_html = section("Prescriptions", [
        f"<b>{(p.get('created_at') or '')[:10]}</b> · " + ", ".join([m.get("name","") for m in (p.get("medicines") or [])][:5])
        for p in bundle["prescriptions"][:20]
    ])
    receipts_html = section("Receipts", [
        f"<b>{r.get('receipt_no','')}</b> · ₹{r.get('total',0)} · {r.get('payment_mode','')} · {(r.get('created_at') or '')[:10]}"
        for r in bundle["receipts"][:30]
    ])
    surg_html = section("Surgeries", [
        f"<b>{s.get('surgery_date','—')}</b> · {s.get('surgery_type','')} · {s.get('surgery_status','')}"
        for s in bundle["surgeries"]
    ])
    adm_html = section("Hospital Admissions", [
        f"<b>{a.get('ipd_no','')}</b> · {(a.get('admitted_at') or '')[:10]} → "
        f"{(a.get('discharged_at') or '—')[:10] if a.get('discharged_at') else 'Active'} · {a.get('diagnosis','')}"
        for a in bundle["admissions"]
    ])
    ipss_html = section("IPSS Score Trends", [
        f"<b>{(s.get('created_at') or '')[:10]}</b> · {s.get('total_score','?')}/35 · {s.get('severity','')}"
        for s in bundle["ipss_scores"]
    ])

    return {
        "html": f"""
<!doctype html><html><head><meta charset='utf-8'>
<style>
body{{font-family:-apple-system,'Segoe UI',Roboto,sans-serif;color:#0f172a;padding:24px;line-height:1.5}}
h1{{color:#0d9488;margin:0 0 4px}}
h3{{color:#0d9488;margin-top:18px;padding-bottom:4px;border-bottom:1px solid #cbd5e1}}
.hdr{{padding-bottom:10px;border-bottom:2px solid #0d9488;margin-bottom:16px}}
ul{{padding-left:18px;margin:8px 0}}li{{margin:4px 0;font-size:12.5px}}
.meta{{color:#64748b;font-size:11px}}
.foot{{margin-top:30px;padding-top:10px;border-top:1px dashed #cbd5e1;font-size:10px;color:#64748b;text-align:center}}
</style></head><body>
<div class='hdr'>
<h1>Personal Health Record</h1>
<div class='meta'>{name} · {phone} {('· Reg ' + reg) if reg else ''}</div>
<div class='meta'>Generated: {bundle['generated_at'][:19].replace('T',' ')} · ConsultUro</div>
</div>
{bookings_html}
{rx_html}
{receipts_html}
{surg_html}
{adm_html}
{ipss_html}
<div class='foot'>This is a personal health summary. For full medical records, please contact the clinic.<br/>
Dr. Sagar Joshi — Consultant Urologist · Vadodara</div>
</body></html>
""",
        "filename": f"PHR-{(name or 'patient').replace(' ','-')}-{bundle['generated_at'][:10]}.pdf",
    }


@router.get("/api/patients/me/phr/monthly-summary")
async def phr_monthly_summary(request: Request, user=Depends(require_user)):
    """Gemini-powered one-paragraph summary of the patient's last 30
    days of activity. Cached for 24h to keep token cost bounded.
    Returns {summary, generated_at, cached:bool, period_start, period_end}.
    """
    import os
    from emergentintegrations.llm.chat import LlmChat, UserMessage

    # Cache check.
    user_id = user.get("user_id")
    if user_id:
        cached = await db.phr_summaries.find_one({"user_id": user_id})
        if cached and isinstance(cached.get("generated_at"), datetime):
            cached_at = cached["generated_at"]
            # MongoDB strips tz info -> normalize to UTC-aware before subtraction.
            if cached_at.tzinfo is None:
                cached_at = cached_at.replace(tzinfo=timezone.utc)
            age = (datetime.now(timezone.utc) - cached_at).total_seconds()
            if age < 24 * 3600:
                return {
                    "summary": cached.get("summary"),
                    "generated_at": cached_at.isoformat(),
                    "cached": True,
                    "period_start": cached.get("period_start"),
                    "period_end": cached.get("period_end"),
                }

    bundle = await get_phr(request, user)
    cutoff = datetime.now(timezone.utc) - __import__('datetime').timedelta(days=30)
    cutoff_iso = cutoff.isoformat()
    recent = [e for e in (bundle.get("timeline") or []) if (e.get("ts") or "") >= cutoff_iso]
    if not recent:
        return {
            "summary": "Nothing notable in the last 30 days. Keep up your healthy habits! 🌿",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "cached": False,
            "period_start": cutoff_iso[:10],
            "period_end": datetime.now(timezone.utc).date().isoformat(),
        }

    # Build a compact prompt.
    lines: List[str] = []
    for ev in recent[:40]:
        lines.append(f"- {ev.get('ts','')[:10]} · {ev.get('event_type','')} · {ev.get('title','')} — {ev.get('subtitle','') or ''}")
    timeline_txt = "\n".join(lines)

    name = (bundle.get("profile") or {}).get("name") or "the patient"
    prompt = (
        f"Write a warm, encouraging ONE-paragraph (max 60 words) summary in plain English "
        f"of {name}'s last 30 days of urology-care activity. Highlight key visits, prescriptions, "
        f"any surgeries/discharges, and gently encourage adherence. Avoid medical advice; "
        f"sound like a friendly nurse, not a doctor. End with a single supportive emoji.\n\n"
        f"Timeline:\n{timeline_txt}"
    )

    try:
        api_key = os.environ.get("EMERGENT_LLM_KEY") or os.environ.get("EMERGENT_LLM_API_KEY")
        if not api_key:
            raise RuntimeError("EMERGENT_LLM_KEY missing")
        chat = (
            LlmChat(
                api_key=api_key,
                session_id=f"phr-summary-{user_id}",
                system_message="You are a friendly clinic-care companion.",
            )
            .with_model("gemini", "gemini-2.5-flash")
        )
        reply = await chat.send_message(UserMessage(text=prompt))
        summary = (reply or "").strip()
        if not summary:
            raise RuntimeError("Empty Gemini reply")
    except Exception as e:
        log.warning("Gemini PHR summary failed: %s", e)
        # Fallback to a deterministic summary.
        visit_count = len([e for e in recent if e.get("event_type") == "booking"])
        rx_count = len([e for e in recent if e.get("event_type") == "prescription"])
        bits: List[str] = []
        if visit_count:
            bits.append(f"{visit_count} consultation{'s' if visit_count > 1 else ''}")
        if rx_count:
            bits.append(f"{rx_count} prescription{'s' if rx_count > 1 else ''}")
        summary = (
            f"In the last 30 days you had {' and '.join(bits) or 'a quiet month'}. "
            "Keep following your care plan and reach out for any concerns. 💙"
        )

    now = datetime.now(timezone.utc)
    if user_id:
        await db.phr_summaries.update_one(
            {"user_id": user_id},
            {"$set": {
                "user_id": user_id, "summary": summary,
                "generated_at": now,
                "period_start": cutoff_iso[:10],
                "period_end": now.date().isoformat(),
            }},
            upsert=True,
        )
    return {
        "summary": summary,
        "generated_at": now.isoformat(),
        "cached": False,
        "period_start": cutoff_iso[:10],
        "period_end": now.date().isoformat(),
    }
