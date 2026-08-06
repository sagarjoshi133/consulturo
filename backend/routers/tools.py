"""ConsultUro — tools router.

  · /api/tools/scores
  · /api/tools/scores/{tool_id}
  · /api/tools/scores/{score_id}
  · /api/tools/bladder-diary
  · /api/tools/bladder-diary/{entry_id}

Extracted from server.py during Phase 3 modularization.
Behaviour preserved EXACTLY.
"""
from datetime import datetime, timezone
from typing import Any, Dict, Optional
import uuid
from fastapi import APIRouter, Depends, HTTPException
from db import db
from auth_deps import require_user
from models import BladderEntryBody, ToolScoreBody
from server import TOOL_IDS

router = APIRouter()


@router.post("/api/tools/scores")
async def save_tool_score(body: ToolScoreBody, user=Depends(require_user)):
    tid = (body.tool_id or "").lower()
    if tid not in TOOL_IDS:
        raise HTTPException(status_code=400, detail="Unknown tool_id")
    # Normalise patient phone to last-10 digits so it matches the
    # patients / bookings / prescriptions collections.
    patient_phone_norm = None
    if body.patient_phone:
        digits = "".join(c for c in body.patient_phone if c.isdigit())
        patient_phone_norm = digits[-10:] if len(digits) >= 10 else digits or None
    doc = {
        "score_id": f"ts_{uuid.uuid4().hex[:10]}",
        "user_id": user["user_id"],
        "tool_id": tid,
        "score": body.score,
        "label": body.label,
        "details": body.details or {},
        "patient_phone": patient_phone_norm,
        "patient_name": (body.patient_name or "").strip() or None,
        "created_at": datetime.now(timezone.utc),
    }
    await db.tool_scores.insert_one(doc)
    doc.pop("_id", None)
    return doc

@router.get("/api/tools/scores/{tool_id}")
async def list_tool_scores(tool_id: str, user=Depends(require_user)):
    tid = tool_id.lower()
    cursor = db.tool_scores.find({"user_id": user["user_id"], "tool_id": tid}, {"_id": 0}).sort("created_at", -1)
    return await cursor.to_list(length=200)

@router.get("/api/tools/scores/by-patient/{phone}")
async def list_tool_scores_by_patient(phone: str, user=Depends(require_user)):
    """All calculator scores recorded against a patient (any tool, any
    user). Patient profile page uses this. Staff-only — patients only
    see their own /api/tools/scores/{tool_id} list."""
    role = user.get("role")
    if role not in {"super_owner", "primary_owner", "partner", "owner", "doctor", "assistant", "reception", "nursing"}:
        raise HTTPException(status_code=403, detail="Staff only")
    digits = "".join(c for c in (phone or "") if c.isdigit())
    norm = digits[-10:] if len(digits) >= 10 else digits
    if not norm:
        raise HTTPException(status_code=400, detail="Invalid phone")
    cursor = db.tool_scores.find({"patient_phone": norm}, {"_id": 0}).sort("created_at", -1)
    return await cursor.to_list(length=200)

@router.delete("/api/tools/scores/{score_id}")
async def delete_tool_score(score_id: str, user=Depends(require_user)):
    result = await db.tool_scores.delete_one({"score_id": score_id, "user_id": user["user_id"]})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}

@router.post("/api/tools/bladder-diary")
async def add_bladder_entry(body: BladderEntryBody, user=Depends(require_user)):
    entry = {
        "entry_id": f"bd_{uuid.uuid4().hex[:10]}",
        "user_id": user["user_id"],
        "date": body.date,
        "time": body.time,
        "volume_ml": body.volume_ml,
        "fluid_intake_ml": body.fluid_intake_ml,
        "urgency": body.urgency,
        "leak": bool(body.leak),
        "note": (body.note or "").strip() or None,
        "created_at": datetime.now(timezone.utc),
    }
    await db.bladder_diary.insert_one(entry)
    entry.pop("_id", None)
    return entry

@router.get("/api/tools/bladder-diary")
async def list_bladder_entries(from_date: Optional[str] = None, to_date: Optional[str] = None, user=Depends(require_user)):
    q: Dict[str, Any] = {"user_id": user["user_id"]}
    if from_date and to_date:
        q["date"] = {"$gte": from_date, "$lte": to_date}
    elif from_date:
        q["date"] = {"$gte": from_date}
    elif to_date:
        q["date"] = {"$lte": to_date}
    cursor = db.bladder_diary.find(q, {"_id": 0}).sort([("date", -1), ("time", -1)])
    rows = await cursor.to_list(length=3000)
    # Summarise daily totals — useful for the calendar heatmap.
    by_day: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        d = r.get("date", "")
        bucket = by_day.setdefault(d, {"date": d, "voids": 0, "total_volume": 0, "intake": 0, "leaks": 0, "max_urgency": 0})
        bucket["voids"] += 1 if r.get("volume_ml") is not None else 0
        if r.get("volume_ml"):
            bucket["total_volume"] += r["volume_ml"]
        if r.get("fluid_intake_ml"):
            bucket["intake"] += r["fluid_intake_ml"]
        if r.get("leak"):
            bucket["leaks"] += 1
        if r.get("urgency") is not None and r["urgency"] > bucket["max_urgency"]:
            bucket["max_urgency"] = r["urgency"]
    return {
        "entries": rows,
        "daily": sorted(by_day.values(), key=lambda x: x["date"], reverse=True),
    }

@router.delete("/api/tools/bladder-diary/{entry_id}")
async def delete_bladder_entry(entry_id: str, user=Depends(require_user)):
    result = await db.bladder_diary.delete_one({"entry_id": entry_id, "user_id": user["user_id"]})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}
