"""ConsultUro — ipss router.

  · /api/ipss
  · /api/ipss/history

Extracted from server.py during Phase 3 modularization.
Behaviour preserved EXACTLY.
"""
from datetime import datetime, timezone
import uuid
from fastapi import APIRouter, Depends
from db import db
from auth_deps import require_user
from models import IpssSubmission

router = APIRouter()


@router.post("/api/ipss")
async def save_ipss(payload: IpssSubmission, user=Depends(require_user)):
    record_id = f"ipss_{uuid.uuid4().hex[:10]}"
    doc = {
        "record_id": record_id,
        "user_id": user["user_id"],
        "entries": [e.model_dump() for e in payload.entries],
        "total_score": payload.total_score,
        "severity": payload.severity,
        "qol_score": payload.qol_score,
        "created_at": datetime.now(timezone.utc),
    }
    await db.ipss_records.insert_one(doc)
    doc.pop("_id", None)
    return doc

@router.get("/api/ipss/history")
async def ipss_history(user=Depends(require_user)):
    cursor = db.ipss_records.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1)
    return await cursor.to_list(length=100)
