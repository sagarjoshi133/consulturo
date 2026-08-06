"""ConsultUro — export router.

  · /api/export/bookings.csv
  · /api/export/prescriptions.csv
  · /api/export/referrers.csv

Extracted from server.py during Phase 3 modularization.
Behaviour preserved EXACTLY.
"""
from datetime import datetime, timezone
from typing import Any, List
from fastapi import APIRouter, Depends
from db import db
from auth_deps import require_owner
from server import _csv_response, _fmt_dt

router = APIRouter()


@router.get("/api/export/bookings.csv")
async def export_bookings_csv(user=Depends(require_owner)):
    # Projection: only fields needed for the CSV to keep the payload small on large exports
    cursor = db.bookings.find(
        {},
        {
            "_id": 0,
            "booking_id": 1,
            "patient_name": 1,
            "patient_phone": 1,
            "patient_age": 1,
            "patient_gender": 1,
            "booking_date": 1,
            "booking_time": 1,
            "mode": 1,
            "status": 1,
            "reason": 1,
            "registration_no": 1,
            "created_at": 1,
        },
    ).sort("created_at", -1)
    docs = await cursor.to_list(length=10000)
    rows: List[List[Any]] = [[
        "booking_id", "patient_name", "patient_phone", "patient_age",
        "patient_gender", "booking_date", "booking_time", "mode",
        "status", "reason", "registration_no", "created_at",
    ]]
    for d in docs:
        rows.append([
            d.get("booking_id"),
            d.get("patient_name"),
            d.get("patient_phone"),
            d.get("patient_age"),
            d.get("patient_gender"),
            d.get("booking_date"),
            d.get("booking_time"),
            d.get("mode"),
            d.get("status"),
            (d.get("reason") or "").replace("\n", " ").replace("\r", " "),
            d.get("registration_no"),
            _fmt_dt(d.get("created_at")),
        ])
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return _csv_response(rows, f"bookings-{today}.csv")

@router.get("/api/export/prescriptions.csv")
async def export_prescriptions_csv(user=Depends(require_owner)):
    cursor = db.prescriptions.find({}, {"_id": 0}).sort("created_at", -1)
    docs = await cursor.to_list(length=10000)
    rows: List[List[Any]] = [[
        "prescription_id", "patient_name", "patient_phone", "patient_age",
        "patient_gender", "registration_no", "visit_date", "diagnosis",
        "medicines_count", "ref_doctor", "created_at", "updated_at",
    ]]
    for d in docs:
        meds = d.get("medicines") or []
        rows.append([
            d.get("prescription_id"),
            d.get("patient_name"),
            d.get("patient_phone"),
            d.get("patient_age"),
            d.get("patient_gender"),
            d.get("registration_no"),
            d.get("visit_date"),
            (d.get("diagnosis") or "").replace("\n", " ").replace("\r", " "),
            len(meds),
            d.get("ref_doctor"),
            _fmt_dt(d.get("created_at")),
            _fmt_dt(d.get("updated_at")),
        ])
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return _csv_response(rows, f"prescriptions-{today}.csv")

@router.get("/api/export/referrers.csv")
async def export_referrers_csv(user=Depends(require_owner)):
    cursor = db.referrers.find({}, {"_id": 0}).sort("created_at", -1)
    docs = await cursor.to_list(length=10000)
    rows: List[List[Any]] = [[
        "referrer_id", "name", "phone", "email", "specialty",
        "hospital", "city", "referrals_count", "notes", "created_at",
    ]]
    for d in docs:
        rows.append([
            d.get("referrer_id") or d.get("id"),
            d.get("name"),
            d.get("phone"),
            d.get("email"),
            d.get("specialty"),
            d.get("hospital"),
            d.get("city"),
            d.get("referrals_count", 0),
            (d.get("notes") or "").replace("\n", " ").replace("\r", " "),
            _fmt_dt(d.get("created_at")),
        ])
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return _csv_response(rows, f"referrers-{today}.csv")
