"""ConsultUro — analytics router.

  · /api/analytics/dashboard

Extracted from server.py during Phase 3 modularization.
Multi-tenant scoped: every counter/aggregation respects the resolved
`clinic_id` (from `X-Clinic-Id` header). super_owner with no header
sees totals across ALL clinics.
"""
from datetime import datetime, timezone
from typing import Any, Dict
from fastapi import APIRouter, Depends, Request
from db import db
from auth_deps import require_prescriber
from server import _last_n_days, _last_n_months, _month_bucket
from services.tenancy import resolve_clinic_id, tenant_filter

router = APIRouter()


def _merge(base: Dict[str, Any], extra: Dict[str, Any]) -> Dict[str, Any]:
    """Return `{**base, **extra}` without mutating either input."""
    out = dict(base)
    out.update(extra)
    return out


@router.get("/api/analytics/dashboard")
async def analytics_dashboard(
    request: Request,
    months: int = 12,
    user=Depends(require_prescriber),
):
    """Returns aggregated analytics for the owner dashboard:
    - totals (lifetime, scoped to active clinic)
    - monthly_bookings / monthly_surgeries / monthly_prescriptions (last N months)
    - daily_bookings (last 14 days)
    - status breakdown + mode breakdown
    - top diagnoses + top surgery names
    - top referrers (from surgeries.referred_by)

    Tenant scoping: results are limited to the clinic resolved from the
    `X-Clinic-Id` header. super_owner viewing "All Clinics" (no header)
    gets cross-clinic totals.
    """
    months = max(1, min(24, int(months or 12)))
    month_keys = _last_n_months(months)
    day_keys = _last_n_days(14)

    clinic_id = await resolve_clinic_id(request, user)
    # `allow_global=True` lets super_owner see every clinic when no
    # header is sent; for normal owners the helper has already returned
    # their default clinic, so `base` will contain {"clinic_id": ...}.
    base = tenant_filter(user, clinic_id, allow_global=True)

    # ── PERF: single pass per collection ─────────────────────────────
    # This endpoint previously fired ~19 separate DB operations (14
    # count_documents + 5 full cursor sweeps, several of them scanning
    # the SAME collection twice). On the sandbox (0ms latency) that was
    # invisible; on a production Atlas cluster (~0.5s round-trip) it
    # compounded into the 10-30s "everything loads forever" the owner
    # dashboard/Today tab suffered. We now stream each collection ONCE
    # with a tiny projection and compute every counter in Python — the
    # exact same numbers, but ~3 round-trips instead of ~19.

    # --- bookings: one pass → totals, status, mode, rescheduled,
    #     monthly (N months) and daily (14 days) ---
    monthly_bookings = {k: 0 for k in month_keys}
    daily_bookings = {k: 0 for k in day_keys}
    status_counts: Dict[str, int] = {}
    mode_online = mode_offline = 0
    rescheduled_bookings = 0
    total_bookings = 0
    async for b in db.bookings.find(
        base,
        {"_id": 0, "status": 1, "mode": 1, "booking_date": 1,
         "created_at": 1, "rescheduled_at": 1},
    ):
        total_bookings += 1
        st = (b.get("status") or "").strip()
        if st:
            status_counts[st] = status_counts.get(st, 0) + 1
        md = (b.get("mode") or "").strip()
        if md == "online":
            mode_online += 1
        elif md == "offline":
            mode_offline += 1
        if "rescheduled_at" in b:
            rescheduled_bookings += 1
        mkey = _month_bucket(b.get("booking_date") or b.get("created_at") or "")
        if mkey in monthly_bookings:
            monthly_bookings[mkey] += 1
        d = (b.get("booking_date") or "")[:10]
        if d in daily_bookings:
            daily_bookings[d] += 1

    confirmed_bookings = status_counts.get("confirmed", 0)
    pending_bookings = status_counts.get("requested", 0)
    cancelled_bookings = status_counts.get("cancelled", 0)
    completed_bookings = status_counts.get("completed", 0)
    rejected_bookings = status_counts.get("rejected", 0)
    missed_bookings = status_counts.get("missed", 0)

    # --- surgeries: one pass → total, monthly, top diagnoses /
    #     referrers / surgery names ---
    monthly_surgeries = {k: 0 for k in month_keys}
    diag_counter: Dict[str, int] = {}
    referrer_counter: Dict[str, int] = {}
    surgery_name_counter: Dict[str, int] = {}
    total_surgeries = 0
    async for s in db.surgeries.find(
        base,
        {"_id": 0, "date": 1, "created_at": 1, "diagnosis": 1,
         "referred_by": 1, "surgery_name": 1},
    ):
        total_surgeries += 1
        key = _month_bucket(s.get("date") or s.get("created_at") or "")
        if key in monthly_surgeries:
            monthly_surgeries[key] += 1
        d = (s.get("diagnosis") or "").strip()
        if d:
            diag_counter[d] = diag_counter.get(d, 0) + 1
        r = (s.get("referred_by") or "").strip()
        if r:
            referrer_counter[r] = referrer_counter.get(r, 0) + 1
        n = (s.get("surgery_name") or "").strip()
        if n:
            surgery_name_counter[n] = surgery_name_counter.get(n, 0) + 1

    # --- prescriptions: one pass → total + monthly ---
    monthly_rx = {k: 0 for k in month_keys}
    total_rx = 0
    async for r in db.prescriptions.find(base, {"_id": 0, "created_at": 1}):
        total_rx += 1
        key = _month_bucket(r.get("created_at") or "")
        if key in monthly_rx:
            monthly_rx[key] += 1

    # --- patients: single count ---
    total_patients = await db.patients.count_documents(base)

    def _top(counter: Dict[str, int], limit: int = 8):
        items = sorted(counter.items(), key=lambda kv: kv[1], reverse=True)[:limit]
        return [{"label": k, "count": v} for k, v in items]

    return {
        "totals": {
            "bookings": total_bookings,
            "confirmed_bookings": confirmed_bookings,
            "pending_bookings": pending_bookings,
            "cancelled_bookings": cancelled_bookings,
            "surgeries": total_surgeries,
            "prescriptions": total_rx,
            "patients": total_patients,
        },
        "monthly_bookings": [{"month": k, "count": monthly_bookings[k]} for k in month_keys],
        "monthly_surgeries": [{"month": k, "count": monthly_surgeries[k]} for k in month_keys],
        "monthly_prescriptions": [{"month": k, "count": monthly_rx[k]} for k in month_keys],
        "daily_bookings": [{"date": k, "count": daily_bookings[k]} for k in day_keys],
        "mode_breakdown": {"online": mode_online, "offline": mode_offline},
        "status_breakdown": {
            "requested": pending_bookings,
            "confirmed": confirmed_bookings,
            "rescheduled": rescheduled_bookings,
            "completed": completed_bookings,
            "cancelled": cancelled_bookings,
            "rejected": rejected_bookings,
            "missed": missed_bookings,
        },
        "top_diagnoses": _top(diag_counter, 8),
        "top_surgeries": _top(surgery_name_counter, 8),
        "top_referrers": _top(referrer_counter, 8),
        "clinic_id": clinic_id,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }



# ──────────────────────────────────────────────────────────────────
# Phase 5.6 — Comprehensive analytics for primary_owner.
# Three new endpoints layered on top of /dashboard:
#   • /api/analytics/revenue
#   • /api/analytics/outcomes
#   • /api/analytics/footfall-heatmap
# Each is owner-scoped (require_owner) so staff cannot see revenue.
# ──────────────────────────────────────────────────────────────────
import re as _re
from collections import defaultdict as _dd
from auth_deps import require_owner


@router.get("/api/analytics/revenue")
async def analytics_revenue(
    request: Request,
    months: int = 12,
    user=Depends(require_owner),
):
    """Revenue breakdown from the receipts collection."""
    months = max(1, min(24, int(months or 12)))
    month_keys = _last_n_months(months)
    clinic_id = await resolve_clinic_id(request, user)
    base_filter = tenant_filter(user, clinic_id) if clinic_id else {}

    monthly_revenue: Dict[str, float] = {m: 0 for m in month_keys}
    mode_totals: Dict[str, float] = _dd(float)
    service_totals: Dict[str, float] = _dd(float)
    total_revenue = 0.0
    total_receipts = 0
    today_iso = datetime.now(timezone.utc).date().isoformat()
    today_revenue = 0.0

    cursor = db.receipts.find(base_filter)
    async for r in cursor:
        total = float(r.get("total") or 0)
        total_revenue += total
        total_receipts += 1
        mode_totals[(r.get("payment_mode") or "other").strip().lower()] += total
        # service grouping — use first line item's name (top 8 only).
        items = r.get("items") or []
        if items and isinstance(items, list):
            for it in items:
                nm = (it.get("name") or "").strip()
                if nm:
                    service_totals[nm[:40]] += float(it.get("amount") or 0)
        # month bucket
        ts = r.get("created_at")
        if isinstance(ts, datetime):
            mb = _month_bucket(ts)
            if mb in monthly_revenue:
                monthly_revenue[mb] += total
        # today
        if isinstance(ts, datetime) and ts.date().isoformat() == today_iso:
            today_revenue += total

    # MoM growth — latest vs previous month.
    sorted_months = sorted(monthly_revenue.keys())
    mom_growth = None
    if len(sorted_months) >= 2:
        cur = monthly_revenue[sorted_months[-1]]
        prev = monthly_revenue[sorted_months[-2]]
        if prev > 0:
            mom_growth = round(((cur - prev) / prev) * 100, 1)

    return {
        "total_revenue": round(total_revenue, 2),
        "total_receipts": total_receipts,
        "today_revenue": round(today_revenue, 2),
        "average_ticket": round(total_revenue / total_receipts, 2) if total_receipts else 0,
        "mom_growth_percent": mom_growth,
        "monthly_revenue": [{"month": m, "revenue": round(v, 2)} for m, v in sorted(monthly_revenue.items())],
        "by_mode": [{"mode": k, "amount": round(v, 2)} for k, v in sorted(mode_totals.items(), key=lambda x: -x[1])],
        "by_service": [{"name": k, "amount": round(v, 2)} for k, v in sorted(service_totals.items(), key=lambda x: -x[1])[:8]],
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/api/analytics/outcomes")
async def analytics_outcomes(
    request: Request,
    user=Depends(require_owner),
):
    """Clinical outcomes — IPSS improvement, no-show rate, follow-up
    adherence, average IPD length-of-stay, readmission rate.
    (Complication rate omitted per user request.)"""
    clinic_id = await resolve_clinic_id(request, user)
    base = tenant_filter(user, clinic_id) if clinic_id else {}

    # No-show rate = bookings with status='missed' or 'no_show' / total bookings.
    total_bookings = await db.bookings.count_documents(base)
    missed = await db.bookings.count_documents({**base, "status": {"$in": ["missed", "no_show", "no-show"]}})
    no_show_rate = round((missed / total_bookings) * 100, 1) if total_bookings else 0

    # Follow-up adherence — bookings with `is_follow_up=True` that completed.
    follow_up_total = await db.bookings.count_documents({**base, "is_follow_up": True})
    follow_up_done = await db.bookings.count_documents({**base, "is_follow_up": True, "status": "completed"})
    follow_up_adherence = round((follow_up_done / follow_up_total) * 100, 1) if follow_up_total else 0

    # IPD avg length-of-stay (days).
    los_days: list = []
    cursor = db.admissions.find({**base, "status": "discharged"})
    async for a in cursor:
        ad, dc = a.get("admitted_at"), a.get("discharged_at")
        if isinstance(ad, datetime) and isinstance(dc, datetime):
            los_days.append((dc - ad).total_seconds() / 86400.0)
    avg_los = round(sum(los_days) / len(los_days), 1) if los_days else 0

    # Readmission rate — same patient_phone with 2+ admissions within 30 days.
    readmits = 0
    phones_seen: dict = _dd(list)
    cursor = db.admissions.find({**base})
    async for a in cursor:
        ph = a.get("patient_phone")
        ad = a.get("admitted_at")
        if ph and isinstance(ad, datetime):
            phones_seen[ph].append(ad)
    for ph, dates in phones_seen.items():
        if len(dates) < 2:
            continue
        dates.sort()
        for i in range(1, len(dates)):
            if (dates[i] - dates[i - 1]).days <= 30:
                readmits += 1
                break
    total_unique_admits = len([p for p, d in phones_seen.items() if len(d) >= 1])
    readmission_rate = round((readmits / total_unique_admits) * 100, 1) if total_unique_admits else 0

    # IPSS improvement — for patients with ≥2 IPSS entries, % whose latest score < first.
    improved = 0
    total_paired = 0
    by_user = _dd(list)
    cursor = db.ipss_scores.find({**base})
    async for s in cursor:
        uid = s.get("user_id") or s.get("patient_phone")
        if not uid:
            continue
        by_user[uid].append((s.get("created_at"), s.get("total_score") or s.get("score")))
    for uid, rows in by_user.items():
        rows = [r for r in rows if r[0] is not None and r[1] is not None]
        if len(rows) < 2:
            continue
        rows.sort(key=lambda x: x[0])
        total_paired += 1
        if rows[-1][1] < rows[0][1]:
            improved += 1
    ipss_improvement_rate = round((improved / total_paired) * 100, 1) if total_paired else 0

    return {
        "no_show_rate_percent": no_show_rate,
        "no_show_count": missed,
        "follow_up_adherence_percent": follow_up_adherence,
        "follow_up_total": follow_up_total,
        "avg_length_of_stay_days": avg_los,
        "total_discharged": len(los_days),
        "readmission_rate_percent": readmission_rate,
        "readmission_count": readmits,
        "ipss_improvement_rate_percent": ipss_improvement_rate,
        "ipss_paired_patients": total_paired,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/api/analytics/footfall-heatmap")
async def analytics_footfall(
    request: Request,
    weeks: int = 12,
    user=Depends(require_owner),
):
    """Patient footfall by day-of-week × hour-of-day, last N weeks."""
    weeks = max(1, min(52, int(weeks or 12)))
    clinic_id = await resolve_clinic_id(request, user)
    base = tenant_filter(user, clinic_id) if clinic_id else {}

    # 7 dows x 24 hours = 168 cells.
    grid: Dict[int, Dict[int, int]] = {d: {h: 0 for h in range(24)} for d in range(7)}
    new_vs_returning = {"new": 0, "returning": 0}
    cursor = db.bookings.find({**base})
    seen_phones: set = set()
    async for b in cursor:
        ts = b.get("date")
        time_str = (b.get("time") or "10:00")
        try:
            d = datetime.fromisoformat(str(ts)[:10]) if not isinstance(ts, datetime) else ts
            dow = d.weekday()
            hr_match = _re.match(r"(\d{1,2})", time_str)
            hr = int(hr_match.group(1)) if hr_match else 10
            hr = max(0, min(23, hr))
            grid[dow][hr] += 1
        except Exception:
            pass
        ph = b.get("patient_phone")
        if ph:
            if ph in seen_phones:
                new_vs_returning["returning"] += 1
            else:
                seen_phones.add(ph)
                new_vs_returning["new"] += 1

    flat = [{"dow": d, "hour": h, "count": grid[d][h]} for d in range(7) for h in range(24)]
    return {
        "heatmap": flat,
        "new_vs_returning": new_vs_returning,
        "total_bookings": sum(c["count"] for c in flat),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
