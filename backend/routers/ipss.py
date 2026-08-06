"""ConsultUro — ipss router.

  · /api/ipss
  · /api/ipss/history

Extracted from server.py during Phase 3 modularization.
Phase E (multi-tenant): tags each record with the patient's currently
active clinic so per-clinic dashboards & exports can include them.
"""
from datetime import datetime, timezone
import uuid
from fastapi import APIRouter, Depends, Request
from db import db
from auth_deps import require_user
from models import IpssSubmission
from services.tenancy import resolve_clinic_id

router = APIRouter()


@router.post("/api/ipss")
async def save_ipss(request: Request, payload: IpssSubmission, user=Depends(require_user)):
    record_id = f"ipss_{uuid.uuid4().hex[:10]}"
    # Tag with active clinic if the patient is browsing through a
    # specific clinic's app/landing page; otherwise null. Per-patient
    # history queries continue to filter by user_id only — clinic_id
    # is captured for cross-clinic analytics & exports.
    clinic_id = await resolve_clinic_id(request, user)
    doc = {
        "record_id": record_id,
        "user_id": user["user_id"],
        "clinic_id": clinic_id,
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
    """Per-user history — clinic-agnostic on purpose so a patient who
    moves between clinics still sees every IPSS reading they ever
    submitted in one place."""
    cursor = db.ipss_records.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1)
    return await cursor.to_list(length=100)
