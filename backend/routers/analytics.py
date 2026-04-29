"""ConsultUro — analytics router.

  · /api/analytics/dashboard

Extracted from server.py during Phase 3 modularization.
Behaviour preserved EXACTLY.
"""
from datetime import datetime, timezone
from typing import Dict
from fastapi import APIRouter, Depends
from db import db
from auth_deps import require_prescriber
from server import _last_n_days, _last_n_months, _month_bucket

router = APIRouter()


@router.get("/api/analytics/dashboard")
async def analytics_dashboard(
    months: int = 12,
    user=Depends(require_prescriber),
):
    """Returns aggregated analytics for the owner dashboard:
    - totals (lifetime)
    - monthly_bookings / monthly_surgeries / monthly_prescriptions (last N months)
    - daily_bookings (last 14 days)
    - status breakdown + mode breakdown
    - top diagnoses + top surgery names
    - top referrers (from surgeries.referred_by)
    """
    months = max(1, min(24, int(months or 12)))
    month_keys = _last_n_months(months)
    day_keys = _last_n_days(14)

    # --- totals ---
    total_bookings = await db.bookings.count_documents({})
    total_surgeries = await db.surgeries.count_documents({})
    total_rx = await db.prescriptions.count_documents({})
    total_patients = await db.patients.count_documents({})
    confirmed_bookings = await db.bookings.count_documents({"status": "confirmed"})
    pending_bookings = await db.bookings.count_documents({"status": "requested"})
    cancelled_bookings = await db.bookings.count_documents({"status": "cancelled"})

    # --- monthly bookings from booking_date (string YYYY-MM-DD) ---
    monthly_bookings = {k: 0 for k in month_keys}
    async for b in db.bookings.find({}, {"_id": 0, "booking_date": 1, "created_at": 1}):
        key = _month_bucket(b.get("booking_date") or b.get("created_at") or "")
        if key in monthly_bookings:
            monthly_bookings[key] += 1

    # --- monthly surgeries (from surgery date field, YYYY-MM-DD) ---
    monthly_surgeries = {k: 0 for k in month_keys}
    async for s in db.surgeries.find({}, {"_id": 0, "date": 1, "created_at": 1}):
        key = _month_bucket(s.get("date") or s.get("created_at") or "")
        if key in monthly_surgeries:
            monthly_surgeries[key] += 1

    # --- monthly prescriptions ---
    monthly_rx = {k: 0 for k in month_keys}
    async for r in db.prescriptions.find({}, {"_id": 0, "created_at": 1}):
        key = _month_bucket(r.get("created_at") or "")
        if key in monthly_rx:
            monthly_rx[key] += 1

    # --- daily bookings (last 14 days) ---
    daily_bookings = {k: 0 for k in day_keys}
    async for b in db.bookings.find({}, {"_id": 0, "booking_date": 1}):
        d = (b.get("booking_date") or "")[:10]
        if d in daily_bookings:
            daily_bookings[d] += 1

    # --- mode breakdown ---
    mode_online = await db.bookings.count_documents({"mode": "online"})
    mode_offline = await db.bookings.count_documents({"mode": "offline"})

    # --- top diagnoses (surgeries.diagnosis) ---
    diag_counter: Dict[str, int] = {}
    referrer_counter: Dict[str, int] = {}
    surgery_name_counter: Dict[str, int] = {}
    async for s in db.surgeries.find({}, {"_id": 0, "diagnosis": 1, "referred_by": 1, "surgery_name": 1}):
        d = (s.get("diagnosis") or "").strip()
        if d:
            diag_counter[d] = diag_counter.get(d, 0) + 1
        r = (s.get("referred_by") or "").strip()
        if r:
            referrer_counter[r] = referrer_counter.get(r, 0) + 1
        n = (s.get("surgery_name") or "").strip()
        if n:
            surgery_name_counter[n] = surgery_name_counter.get(n, 0) + 1

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
            "cancelled": cancelled_bookings,
        },
        "top_diagnoses": _top(diag_counter, 8),
        "top_surgeries": _top(surgery_name_counter, 8),
        "top_referrers": _top(referrer_counter, 8),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
