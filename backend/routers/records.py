"""ConsultUro — records router.

  · /api/records/me
  · /api/records/prostate-volume
  · /api/records/prostate-volume/{reading_id}

Extracted from server.py during Phase 3 modularization.
Behaviour preserved EXACTLY.
"""
from datetime import datetime, timedelta, timezone
from typing import Any, Dict
import uuid
from fastapi import APIRouter, Depends, HTTPException
from db import db
from auth_deps import require_user
from models import ProstateVolumeBody
from server import _VALID_PROSTATE_SOURCES, _parse_measured_on

router = APIRouter()


@router.get("/api/records/me")
async def my_records(user=Depends(require_user)):
    uid = user["user_id"]
    phone_digits = user.get("phone_digits") or ""

    phone_q = []
    if phone_digits:
        phone_q.append({"patient_phone": {"$regex": phone_digits[-10:]}})

    booking_q = {"$or": [{"user_id": uid}] + phone_q}
    rx_q = {"$or": [{"patient_user_id": uid}] + phone_q}
    sx_q = {"$or": [{"patient_user_id": uid}] + phone_q}

    bookings = await db.bookings.find(booking_q, {"_id": 0}).sort("booking_date", -1).to_list(length=200)
    prescriptions = await db.prescriptions.find(rx_q, {"_id": 0}).sort("created_at", -1).to_list(length=200)
    surgeries = await db.surgeries.find(sx_q, {"_id": 0}).sort("date", -1).to_list(length=200)
    ipss = await db.ipss_records.find({"user_id": uid}, {"_id": 0}).sort("created_at", -1).to_list(length=100)
    prostate_readings = await db.prostate_readings.find(
        {"user_id": uid}, {"_id": 0}
    ).sort("measured_on", -1).to_list(length=50)

    # Latest-per-tool snapshot from the unified tool_scores collection.
    # Drives the "My Vitals" grid on the patient's My Records screen so
    # every calculator they have ever used can surface its last reading.
    tool_scores_latest: Dict[str, Any] = {}
    pipeline = [
        {"$match": {"user_id": uid}},
        {"$sort": {"created_at": -1}},
        {"$group": {"_id": "$tool_id", "doc": {"$first": "$$ROOT"}}},
    ]
    async for row in db.tool_scores.aggregate(pipeline):
        doc = row.get("doc") or {}
        doc.pop("_id", None)
        tool_scores_latest[row["_id"]] = doc

    # Aggregate urology "conditions" from prescription diagnoses for a quick clinical overview.
    diagnoses = []
    seen = set()
    for rx in prescriptions:
        d = (rx.get("diagnosis") or "").strip()
        if d and d.lower() not in seen:
            seen.add(d.lower())
            diagnoses.append({"diagnosis": d, "date": rx.get("visit_date") or ""})

    return {
        "summary": {
            "appointments": len(bookings),
            "prescriptions": len(prescriptions),
            "surgeries": len(surgeries),
            "ipss_entries": len(ipss),
            "prostate_readings": len(prostate_readings),
            "tool_scores_count": len(tool_scores_latest),
        },
        "appointments": bookings,
        "prescriptions": prescriptions,
        "surgeries": surgeries,
        "ipss_history": ipss,
        "prostate_readings": prostate_readings,
        "tool_scores_latest": tool_scores_latest,
        "urology_conditions": diagnoses,
    }

@router.get("/api/records/prostate-volume")
async def prostate_volume_list(user=Depends(require_user)):
    uid = user["user_id"]
    cursor = db.prostate_readings.find(
        {"user_id": uid}, {"_id": 0}
    ).sort("measured_on", -1)
    rows = await cursor.to_list(length=200)
    latest = rows[0] if rows else None
    return {
        "count": len(rows),
        "latest": latest,
        "readings": rows,
    }

@router.post("/api/records/prostate-volume")
async def prostate_volume_create(body: ProstateVolumeBody, user=Depends(require_user)):
    try:
        vol = float(body.volume_ml)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="volume_ml must be a number")
    # Clinically plausible range: small adult prostate ~12 mL, massive BPH ~400 mL.
    if vol < 5 or vol > 500:
        raise HTTPException(
            status_code=400,
            detail="volume_ml must be between 5 and 500 mL",
        )
    source = (body.source or "USG").strip() or "USG"
    if source not in _VALID_PROSTATE_SOURCES:
        source = "Other"
    measured_on = _parse_measured_on(body.measured_on)
    # Disallow dates in the future (clock-skew-safe: allow 1 day ahead).
    if measured_on > datetime.now(timezone.utc) + timedelta(days=1):
        raise HTTPException(status_code=400, detail="measured_on cannot be in the future")

    doc = {
        "reading_id": f"pv_{uuid.uuid4().hex[:10]}",
        "user_id": user["user_id"],
        "phone_digits": user.get("phone_digits") or "",
        "volume_ml": round(vol, 1),
        "source": source,
        "measured_on": measured_on,
        "notes": (body.notes or "").strip()[:500],
        "created_at": datetime.now(timezone.utc),
    }
    await db.prostate_readings.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc

@router.delete("/api/records/prostate-volume/{reading_id}")
async def prostate_volume_delete(reading_id: str, user=Depends(require_user)):
    res = await db.prostate_readings.delete_one(
        {"reading_id": reading_id, "user_id": user["user_id"]}
    )
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Reading not found")
    return {"ok": True, "deleted": reading_id}
