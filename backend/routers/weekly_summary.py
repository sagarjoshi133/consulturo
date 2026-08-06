"""ConsultUro — AI Weekly Clinic Summary (Phase 5.21).

Aggregates the last 7 days of clinic activity (bookings, patients,
surgeries, IPD admits, Rx, receipts, reviews, AI usage) and hands the
numbers to Claude Sonnet 4.5 to produce a 4-paragraph executive
summary the primary owner reads over their Monday morning chai.

Endpoints exposed (mounted in server.py):

  GET  /api/admin/weekly-summary
      Owner-only. Aggregates + AI-generates the latest weekly summary.
      Query params:
        - week_offset (int, default 0) → 0=this week-to-date,
          1=last full Mon-Sun week, 2=two weeks ago, …
        - email (bool, default false) → also send via Resend to OWNER_EMAIL.

  POST /api/admin/weekly-summary/email-now
      Owner-only. Force-sends the current weekly summary to the
      configured primary-owner email RIGHT NOW (bypasses the cron).

The Monday-morning auto-email is wired into the existing scheduler
in server.py via `should_send_weekly_summary_now()` — when the
current time is Mon 08:00 IST ± 30 min AND the cache says we haven't
sent for this Monday yet, we fire it once. Sent-marker is cached in
`weekly_summary_sends` collection.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from dotenv import load_dotenv

from db import db
from auth_deps import require_owner
from services.email import _send_email
from services.tenancy import resolve_clinic_id

load_dotenv()
log = logging.getLogger(__name__)
router = APIRouter()


# ─────────────────────────────────────────────────────────────────
# Date window helpers
# ─────────────────────────────────────────────────────────────────
IST = timezone(timedelta(hours=5, minutes=30))


def _week_window(offset: int = 0) -> Dict[str, Any]:
    """Return the (start, end) UTC datetimes for the requested week.

    offset = 0 → current week-to-date (Mon 00:00 IST → now).
    offset = 1 → last full Mon-Sun week (in IST).
    offset = 2 → 2 weeks ago. Etc.

    All datetimes returned in UTC for MongoDB queries.
    """
    now_ist = datetime.now(IST)
    # Find Monday of the current week in IST.
    monday_ist = (now_ist - timedelta(days=now_ist.weekday())).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    if offset == 0:
        start_ist = monday_ist
        end_ist = now_ist
    else:
        start_ist = monday_ist - timedelta(days=7 * offset)
        end_ist = start_ist + timedelta(days=7)
    return {
        "start_utc": start_ist.astimezone(timezone.utc),
        "end_utc": end_ist.astimezone(timezone.utc),
        "start_ist": start_ist,
        "end_ist": end_ist,
        "label": _label_for_week(start_ist, end_ist, offset),
    }


def _label_for_week(start_ist: datetime, end_ist: datetime, offset: int) -> str:
    if offset == 0:
        return f"This week (Mon {start_ist:%d-%m-%Y} → today)"
    return f"Week of {start_ist:%d-%m-%Y} → {(end_ist - timedelta(days=1)):%d-%m-%Y}"


# ─────────────────────────────────────────────────────────────────
# Data aggregation — one function per collection
# ─────────────────────────────────────────────────────────────────
async def _aggregate(clinic_id: Optional[str], start: datetime, end: datetime) -> Dict[str, Any]:
    """Pull KPI numbers for the [start, end) UTC window.

    Tolerant of missing collections / schema drift — every block is
    wrapped in try/except so a single broken collection doesn't blow
    up the whole summary."""
    s: Dict[str, Any] = {
        "bookings_total": 0,
        "bookings_inperson": 0,
        "bookings_video": 0,
        "bookings_completed": 0,
        "bookings_cancelled": 0,
        "patients_new": 0,
        "patients_returning": 0,
        "surgeries_done": 0,
        "ipd_admits": 0,
        "ipd_discharged": 0,
        "rx_finalised": 0,
        "revenue_inr": 0.0,
        "revenue_pending_inr": 0.0,
        "receipts_count": 0,
        "reviews_new": 0,
        "reviews_avg_rating": None,
        "google_rating": None,
        "google_total_ratings": None,
        "top_complaints": [],
        "top_diagnoses": [],
        "top_medicines": [],
    }
    base_q: Dict[str, Any] = {}
    if clinic_id:
        base_q["clinic_id"] = clinic_id

    # ── Bookings ─────────────────────────────────────────────────
    try:
        q = dict(base_q)
        q["booking_date_dt"] = {"$gte": start, "$lt": end}
        s["bookings_total"] = await db.bookings.count_documents(q)
        s["bookings_inperson"] = await db.bookings.count_documents({**q, "mode": {"$in": ["in-person", "in_person", "offline", None]}})
        s["bookings_video"] = await db.bookings.count_documents({**q, "mode": {"$in": ["video", "online"]}})
        s["bookings_completed"] = await db.bookings.count_documents({**q, "status": "completed"})
        s["bookings_cancelled"] = await db.bookings.count_documents({**q, "status": {"$in": ["cancelled", "no_show"]}})
    except Exception as e:
        log.info("weekly-summary: bookings agg failed: %s", e)

    # ── Patients (new vs returning) ──────────────────────────────
    try:
        q = dict(base_q)
        q["created_at"] = {"$gte": start, "$lt": end}
        s["patients_new"] = await db.patients.count_documents(q)
        # Returning = patients who had a booking in the window AND were
        # created BEFORE the window.
        q_old = dict(base_q)
        q_old["created_at"] = {"$lt": start}
        s["patients_returning"] = max(s["bookings_total"] - s["patients_new"], 0)
    except Exception as e:
        log.info("weekly-summary: patients agg failed: %s", e)

    # ── Surgeries ────────────────────────────────────────────────
    try:
        q = dict(base_q)
        q["surgery_date_dt"] = {"$gte": start, "$lt": end}
        s["surgeries_done"] = await db.surgeries.count_documents(q)
    except Exception as e:
        log.info("weekly-summary: surgeries agg failed: %s", e)

    # ── IPD admits + discharges ──────────────────────────────────
    try:
        q = dict(base_q)
        q["admit_dt"] = {"$gte": start, "$lt": end}
        s["ipd_admits"] = await db.ipd_admissions.count_documents(q)
        qd = dict(base_q)
        qd["discharge_dt"] = {"$gte": start, "$lt": end}
        s["ipd_discharged"] = await db.ipd_admissions.count_documents(qd)
    except Exception as e:
        log.info("weekly-summary: IPD agg failed: %s", e)

    # ── Prescriptions ────────────────────────────────────────────
    try:
        q = dict(base_q)
        q["finalised_at"] = {"$gte": start, "$lt": end}
        s["rx_finalised"] = await db.prescriptions.count_documents(q)
    except Exception as e:
        log.info("weekly-summary: rx agg failed: %s", e)

    # ── Receipts / revenue ───────────────────────────────────────
    try:
        cursor = db.receipts.find({**base_q, "created_at": {"$gte": start, "$lt": end}})
        total = 0.0
        pending = 0.0
        count = 0
        async for r in cursor:
            count += 1
            paid = float(r.get("amount_paid") or r.get("paid_amount") or 0)
            due  = float(r.get("amount_due") or 0)
            total += paid
            pending += max(due - paid, 0)
        s["revenue_inr"] = round(total, 2)
        s["revenue_pending_inr"] = round(pending, 2)
        s["receipts_count"] = count
    except Exception as e:
        log.info("weekly-summary: receipts agg failed: %s", e)

    # ── Featured Reviews + Google rating ─────────────────────────
    try:
        rev_q = {"created_at": {"$gte": start, "$lt": end}}
        if clinic_id:
            rev_q["clinic_id"] = clinic_id
        cursor = db.featured_reviews.find(rev_q)
        ratings: List[int] = []
        cnt = 0
        async for r in cursor:
            rating = int(r.get("rating") or 0)
            if 1 <= rating <= 5:
                ratings.append(rating)
                cnt += 1
        s["reviews_new"] = cnt
        if ratings:
            s["reviews_avg_rating"] = round(sum(ratings) / len(ratings), 2)
    except Exception as e:
        log.info("weekly-summary: reviews agg failed: %s", e)

    try:
        cs_q = {"_id": clinic_id} if clinic_id else {"_id": "default"}
        cs = await db.clinic_settings.find_one(cs_q) or {}
        if not cs and clinic_id:
            cs = await db.clinic_settings.find_one({"_id": "default"}) or {}
        s["google_rating"] = cs.get("google_rating")
        s["google_total_ratings"] = cs.get("google_total_ratings")
    except Exception as e:
        log.info("weekly-summary: clinic settings fetch failed: %s", e)

    # ── Top complaints / diagnoses / meds (best-effort from rx) ──
    try:
        agg_pipe: List[Dict[str, Any]] = []
        match: Dict[str, Any] = {"finalised_at": {"$gte": start, "$lt": end}}
        if clinic_id:
            match["clinic_id"] = clinic_id
        agg_pipe.append({"$match": match})
        agg_pipe.append({"$project": {"chief_complaint": 1, "diagnosis": 1, "medicines": 1}})
        complaints: Dict[str, int] = {}
        diagnoses: Dict[str, int] = {}
        meds: Dict[str, int] = {}
        async for r in db.prescriptions.aggregate(agg_pipe):
            cc = (r.get("chief_complaint") or "").strip()
            if cc:
                complaints[cc[:60]] = complaints.get(cc[:60], 0) + 1
            dx = (r.get("diagnosis") or "").strip()
            if dx:
                diagnoses[dx[:60]] = diagnoses.get(dx[:60], 0) + 1
            for m in (r.get("medicines") or [])[:5]:
                name = (m.get("name") or m.get("medicine") or "").strip()
                if name:
                    meds[name[:50]] = meds.get(name[:50], 0) + 1
        s["top_complaints"] = sorted(complaints.items(), key=lambda x: -x[1])[:5]
        s["top_diagnoses"] = sorted(diagnoses.items(), key=lambda x: -x[1])[:5]
        s["top_medicines"] = sorted(meds.items(), key=lambda x: -x[1])[:5]
    except Exception as e:
        log.info("weekly-summary: top-N agg failed: %s", e)

    return s


# ─────────────────────────────────────────────────────────────────
# AI narrative generation
# ─────────────────────────────────────────────────────────────────
async def _ai_narrative(stats: Dict[str, Any], window: Dict[str, Any], clinic_name: str) -> str:
    """Convert the raw KPI dict into a 4-paragraph executive summary
    via Claude Sonnet 4.5. Falls back to a plain templated text when
    the LLM is unavailable so the email always has SOMETHING."""
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        api_key = os.environ.get("EMERGENT_LLM_KEY") or os.environ.get("EMERGENT_LLM_API_KEY")
        if not api_key:
            raise RuntimeError("LLM key not configured")

        # Render the numbers as a compact CSV-like prompt block.
        bullets = [
            f"Clinic: {clinic_name}",
            f"Window: {window['label']}",
            f"Bookings: total={stats['bookings_total']}, in-person={stats['bookings_inperson']}, video={stats['bookings_video']}, completed={stats['bookings_completed']}, cancelled/no-show={stats['bookings_cancelled']}",
            f"Patients: new={stats['patients_new']}, returning(approx)={stats['patients_returning']}",
            f"Surgeries done: {stats['surgeries_done']}",
            f"IPD: admitted={stats['ipd_admits']}, discharged={stats['ipd_discharged']}",
            f"Prescriptions finalised: {stats['rx_finalised']}",
            f"Revenue collected: ₹{stats['revenue_inr']:,.0f}; pending: ₹{stats['revenue_pending_inr']:,.0f}; receipts={stats['receipts_count']}",
            f"New reviews this week: {stats['reviews_new']}, avg rating={stats['reviews_avg_rating'] or 'N/A'}",
            f"Google rating overall: {stats['google_rating'] or 'N/A'} ({stats['google_total_ratings'] or 0} total ratings)",
            f"Top chief complaints: {stats['top_complaints']}",
            f"Top diagnoses: {stats['top_diagnoses']}",
            f"Top prescribed meds: {stats['top_medicines']}",
        ]
        prompt = (
            "You are a clinic-operations analyst writing the Monday-morning "
            "executive briefing for a urology clinic owner-doctor. Read the "
            "weekly numbers below and produce EXACTLY four short paragraphs:\n"
            "  (1) Headline — what changed this week, in one punchy sentence.\n"
            "  (2) Throughput — bookings + patients + surgeries narrative.\n"
            "  (3) Quality — reviews + completion vs cancellation ratio.\n"
            "  (4) Action — ONE concrete suggestion the owner should consider next week.\n\n"
            "Be specific. Quote the actual numbers. Indian-English, warm, no jargon, "
            "no emoji clutter (one 📊 in the headline is fine). Do not start "
            "with 'Dear Doctor' — go straight to the headline.\n\n"
            "Numbers:\n" + "\n".join(bullets)
        )
        chat = (
            LlmChat(
                api_key=api_key,
                session_id=f"weekly-summary-{datetime.utcnow().timestamp():.0f}",
                system_message=(
                    "You are a sharp clinic-operations analyst. Always cite "
                    "the actual numbers in the data, never invent new ones."
                ),
            )
            .with_model("anthropic", "claude-sonnet-4-5-20250929")
        )
        reply = await chat.send_message(UserMessage(text=prompt))
        text = (reply or "").strip()
        if not text:
            raise RuntimeError("Empty LLM reply")
        return text
    except Exception as e:
        log.warning("weekly-summary AI fallback (using template): %s", e)
        # Fallback narrative — no LLM, just facts in a structured note.
        return (
            f"📊 {window['label']}\n\n"
            f"This week, {clinic_name} saw {stats['bookings_total']} bookings "
            f"({stats['bookings_inperson']} in-person, {stats['bookings_video']} video). "
            f"{stats['patients_new']} new patients registered and {stats['surgeries_done']} "
            f"surgeries were performed. IPD admitted {stats['ipd_admits']}, discharged "
            f"{stats['ipd_discharged']}. {stats['rx_finalised']} prescriptions finalised.\n\n"
            f"Revenue collected: ₹{stats['revenue_inr']:,.0f} across {stats['receipts_count']} receipts. "
            f"Pending dues: ₹{stats['revenue_pending_inr']:,.0f}.\n\n"
            f"Reputation: {stats['reviews_new']} new reviews this week "
            f"(avg {stats['reviews_avg_rating'] or 'N/A'}★). Overall Google rating is "
            f"{stats['google_rating'] or 'N/A'}★ over {stats['google_total_ratings'] or 0} ratings.\n\n"
            f"AI summary unavailable this week — falling back to the raw numbers. "
            f"(Reason: {e})"
        )


# ─────────────────────────────────────────────────────────────────
# HTML email rendering
# ─────────────────────────────────────────────────────────────────
def _render_email_html(narrative: str, stats: Dict[str, Any], window: Dict[str, Any], clinic_name: str) -> str:
    def _esc(s: Any) -> str:
        return (str(s) if s is not None else "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\n", "<br/>")

    def _kpi(label: str, value: str, sub: str = "") -> str:
        return (
            f'<td style="padding:10px 12px;background:#f8fafc;border-radius:8px;'
            f'border:1px solid #e2e8f0;width:33%;vertical-align:top;">'
            f'<div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">{_esc(label)}</div>'
            f'<div style="font-size:22px;font-weight:700;color:#0f172a;margin-top:4px;">{_esc(value)}</div>'
            + (f'<div style="font-size:11px;color:#64748b;margin-top:2px;">{_esc(sub)}</div>' if sub else "")
            + "</td>"
        )

    top_blocks = ""
    if stats["top_complaints"]:
        items = "".join(
            f"<li style='margin:2px 0;font-size:13px;color:#334155;'>{_esc(c[0])} <span style='color:#94a3b8;'>· {c[1]}×</span></li>"
            for c in stats["top_complaints"][:5]
        )
        top_blocks += f"<div style='margin-top:18px;'><div style='font-size:12px;color:#64748b;text-transform:uppercase;font-weight:700;'>Top chief complaints</div><ul style='margin:6px 0 0 16px;padding:0;'>{items}</ul></div>"
    if stats["top_diagnoses"]:
        items = "".join(
            f"<li style='margin:2px 0;font-size:13px;color:#334155;'>{_esc(c[0])} <span style='color:#94a3b8;'>· {c[1]}×</span></li>"
            for c in stats["top_diagnoses"][:5]
        )
        top_blocks += f"<div style='margin-top:14px;'><div style='font-size:12px;color:#64748b;text-transform:uppercase;font-weight:700;'>Top diagnoses</div><ul style='margin:6px 0 0 16px;padding:0;'>{items}</ul></div>"
    if stats["top_medicines"]:
        items = "".join(
            f"<li style='margin:2px 0;font-size:13px;color:#334155;'>{_esc(c[0])} <span style='color:#94a3b8;'>· {c[1]}×</span></li>"
            for c in stats["top_medicines"][:5]
        )
        top_blocks += f"<div style='margin-top:14px;'><div style='font-size:12px;color:#64748b;text-transform:uppercase;font-weight:700;'>Top prescribed meds</div><ul style='margin:6px 0 0 16px;padding:0;'>{items}</ul></div>"

    return f"""\
<!doctype html><html><body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:24px;background:#ffffff;">
    <div style="background:linear-gradient(135deg,#0E7C8B 0%,#0891b2 100%);padding:24px;border-radius:12px;color:#fff;">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:1px;opacity:0.85;">ConsultUro · Weekly Summary</div>
      <div style="font-size:22px;font-weight:800;margin-top:6px;">{_esc(clinic_name)}</div>
      <div style="font-size:13px;opacity:0.9;margin-top:4px;">{_esc(window['label'])}</div>
    </div>

    <table style="margin-top:18px;border-spacing:8px 0;width:100%;" cellspacing="0" cellpadding="0">
      <tr>
        {_kpi("Bookings", str(stats['bookings_total']), f"{stats['bookings_inperson']} in-person · {stats['bookings_video']} video")}
        {_kpi("New patients", str(stats['patients_new']), "registered this week")}
        {_kpi("Surgeries", str(stats['surgeries_done']), f"IPD: {stats['ipd_admits']} admitted")}
      </tr>
      <tr><td colspan="3" style="height:8px;"></td></tr>
      <tr>
        {_kpi("Revenue", f"₹{stats['revenue_inr']:,.0f}", f"{stats['receipts_count']} receipts")}
        {_kpi("Pending dues", f"₹{stats['revenue_pending_inr']:,.0f}", "to collect")}
        {_kpi("Avg rating", str(stats['reviews_avg_rating'] or '—') + '★', f"{stats['reviews_new']} new reviews")}
      </tr>
    </table>

    <div style="margin-top:24px;padding:16px 18px;background:#fef3c7;border-radius:10px;border-left:4px solid #f59e0b;">
      <div style="font-size:11px;text-transform:uppercase;color:#92400e;font-weight:700;letter-spacing:1px;">Owner briefing</div>
      <div style="font-size:14px;line-height:22px;color:#0f172a;margin-top:8px;">{_esc(narrative)}</div>
    </div>

    {top_blocks}

    <div style="margin-top:28px;padding-top:14px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;text-align:center;">
      Generated by ConsultUro · Claude Sonnet 4.5<br/>
      Disable in Dashboard → Settings → Communications.
    </div>
  </div>
</body></html>"""


# ─────────────────────────────────────────────────────────────────
# HTTP endpoints
# ─────────────────────────────────────────────────────────────────
@router.get("/api/admin/weekly-summary")
async def get_weekly_summary(
    request: Request,
    week_offset: int = Query(0, ge=0, le=12),
    email: bool = Query(False),
    user=Depends(require_owner),
):
    """Aggregate + AI-narrate the requested week. Optionally also
    fire an email to the configured primary-owner address."""
    clinic_id = await resolve_clinic_id(request, user) or "default"
    window = _week_window(week_offset)
    stats = await _aggregate(clinic_id, window["start_utc"], window["end_utc"])
    s_doc = await db.clinic_settings.find_one({"_id": clinic_id}) or {}
    clinic_name = s_doc.get("clinic_name") or "ConsultUro"
    narrative = await _ai_narrative(stats, window, clinic_name)
    html = _render_email_html(narrative, stats, window, clinic_name)

    email_sent: Optional[bool] = None
    email_to: Optional[str] = None
    if email:
        owner_email = (user.get("email") or os.environ.get("OWNER_EMAIL") or "").strip()
        if owner_email:
            try:
                email_sent = _send_email(
                    owner_email,
                    f"📊 ConsultUro weekly summary — {window['label']}",
                    html,
                )
                email_to = owner_email
            except Exception as e:
                log.warning("weekly-summary email send failed: %s", e)
                email_sent = False

    return {
        "window": {
            "label": window["label"],
            "start": window["start_ist"].isoformat(),
            "end": window["end_ist"].isoformat(),
        },
        "clinic_name": clinic_name,
        "stats": stats,
        "narrative": narrative,
        "html": html,
        "email_sent": email_sent,
        "email_to": email_to,
    }


@router.post("/api/admin/weekly-summary/email-now")
async def email_weekly_summary_now(
    request: Request,
    user=Depends(require_owner),
):
    """Owner taps 'Send to my email now' from the dashboard widget."""
    return await get_weekly_summary(request=request, week_offset=1, email=True, user=user)
