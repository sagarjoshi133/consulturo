"""ConsultUro 2.0 — Phase D: patient registry router.

  · GET  /api/registry/patients                — search (patient-db capability)
  · GET  /api/registry/patients/{patient_id}   — profile + cross-module history
  · POST /api/registry/patients                — staff get-or-create
  · POST /api/registry/patients/{id}/merge     — owner: merge duplicates
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from auth_deps import require_owner
from db import db
from repositories.patients import patients as patients_repo
from services.capabilities import require_capability
from services.tenancy import resolve_clinic_id, tenant_filter

router = APIRouter()

require_registry_access = require_capability(
    "access_patient_db",
    detail="Patient Database access not granted. Ask a primary owner to enable it for your account.",
)

_ACTIVITY_SORT = {
    "bookings": ("booking_date", -1),
    "prescriptions": ("created_at", -1),
    "surgeries": ("date", -1),
    "receipts": ("created_at", -1),
}


def _iso(row: Dict[str, Any]) -> Dict[str, Any]:
    for k, v in list(row.items()):
        if isinstance(v, datetime):
            row[k] = v.isoformat()
    return row


@router.get("/api/registry/patients")
async def search_patients(q: str = "", limit: int = 50, skip: int = 0,
                          user=Depends(require_registry_access)):
    limit = max(1, min(int(limit or 50), 200))
    skip = max(0, int(skip or 0))
    flt: Dict[str, Any] = {}
    qs = (q or "").strip()
    if qs:
        safe = re.escape(qs)
        digits = re.sub(r"\D", "", qs)
        ors: List[Dict[str, Any]] = [
            {"name": {"$regex": safe, "$options": "i"}},
            {"reg_no": {"$regex": safe, "$options": "i"}},
            {"email": {"$regex": safe, "$options": "i"}},
        ]
        if digits:
            ors.append({"phone_digits": {"$regex": digits + "$"}})
        flt["$or"] = ors
    rows = await patients_repo.search(flt, limit=limit, skip=skip)
    return {"items": [_iso(r) for r in rows], "limit": limit, "skip": skip}


@router.get("/api/registry/patients/{patient_id}")
async def patient_profile(patient_id: str, request: Request,
                          user=Depends(require_registry_access)):
    """Unified patient view — profile + bookings / prescriptions /
    surgeries / receipts, joined by the canonical patient_id (indexed)
    with a phone-suffix fallback for legacy unstamped rows."""
    row = await patients_repo.get_active(patient_id)
    if not row:
        raise HTTPException(status_code=404, detail="Patient not found")

    clinic_id = await resolve_clinic_id(request, user)
    tenant = tenant_filter(user, clinic_id, allow_global=True)

    ors: List[Dict[str, Any]] = [{"patient_id": row["patient_id"]}]
    digits = row.get("phone_digits") or re.sub(r"\D", "", row.get("phone") or "")[-10:]
    if digits:
        ors.append({"patient_phone": {"$regex": re.escape(digits) + "$"}})
    hist_q = {"$or": ors, **tenant}

    out: Dict[str, Any] = {"profile": _iso(dict(row))}
    counts: Dict[str, int] = {}
    for coll, (sort_key, direction) in _ACTIVITY_SORT.items():
        items = []
        async for r in db[coll].find(hist_q, {"_id": 0}).sort(sort_key, direction).limit(50):
            items.append(_iso(r))
        out[coll] = items
        counts[coll] = len(items)
    out["counts"] = counts
    return out


class PatientUpsertBody(BaseModel):
    phone: Optional[str] = None
    email: Optional[str] = None
    name: Optional[str] = None
    age: Optional[str] = None
    gender: Optional[str] = None
    address: Optional[str] = None
    registration_no: Optional[str] = None


@router.post("/api/registry/patients")
async def upsert_patient(body: PatientUpsertBody, user=Depends(require_registry_access)):
    """Get-or-create a canonical patient. Allocates a reg_no when the
    row doesn't have one yet (same allocator as bookings/Rx)."""
    from services.patient_registry import resolve_patient
    from services.reg_no import get_or_set_reg_no

    if not (body.phone or body.email):
        raise HTTPException(status_code=400, detail="phone or email required")
    row = await resolve_patient(
        phone=body.phone, email=body.email, name=body.name,
        reg_no=(body.registration_no or "").strip() or None,
        age=body.age, gender=body.gender, address=body.address,
        create=True,
    )
    if not row.get("reg_no"):
        reg = await get_or_set_reg_no(body.phone, body.registration_no, body.name, email=body.email)
        if reg:
            await db.patients.update_one(
                {"patient_id": row["patient_id"]}, {"$set": {"reg_no": reg}}
            )
            row["reg_no"] = reg
    return {"ok": True, "patient": _iso(dict(row))}


class MergeBody(BaseModel):
    duplicate_patient_id: str


@router.post("/api/registry/patients/{patient_id}/merge")
async def merge_patients(patient_id: str, body: MergeBody, user=Depends(require_owner)):
    """Merge a duplicate registry row into the canonical one: activity
    rows are re-pointed, missing profile fields are absorbed, and the
    duplicate is flagged `merged_into` (kept for audit — storage has
    no hard-delete policy for medical records)."""
    dup_id = (body.duplicate_patient_id or "").strip()
    if not dup_id or dup_id == patient_id:
        raise HTTPException(status_code=400, detail="duplicate_patient_id must differ from the target")
    keep = await patients_repo.get(patient_id)
    dup = await patients_repo.get(dup_id)
    if not keep or not dup:
        raise HTTPException(status_code=404, detail="Patient not found")
    if keep.get("merged_into") or dup.get("merged_into"):
        raise HTTPException(status_code=400, detail="One of the rows was already merged")

    now = datetime.now(timezone.utc)
    repointed: Dict[str, int] = {}
    for coll in _ACTIVITY_SORT:
        res = await db[coll].update_many(
            {"patient_id": dup_id}, {"$set": {"patient_id": patient_id}}
        )
        repointed[coll] = res.modified_count

    # Absorb missing profile fields from the duplicate.
    patch: Dict[str, Any] = {}
    for f in ("name", "reg_no", "age", "gender", "email", "address", "phone", "phone_digits"):
        if dup.get(f) and not keep.get(f):
            patch[f] = dup[f]
    patch["updated_at"] = now
    await db.patients.update_one({"patient_id": patient_id}, {"$set": patch})
    await db.patients.update_one(
        {"patient_id": dup_id},
        {"$set": {"merged_into": patient_id, "merged_at": now, "merged_by": user["user_id"]}},
    )
    return {"ok": True, "kept": patient_id, "merged": dup_id, "repointed": repointed}
