"""ConsultUro — referrers router.

  · /api/referrers
  · /api/referrers/{referrer_id}

Multi-tenant scoped: each referring-doctor record belongs to a single
clinic. Lists/updates/deletes are filtered by the resolved `clinic_id`
so different clinics never see each other's CRM contacts.
"""
from datetime import datetime, timezone
import uuid
from fastapi import APIRouter, Depends, HTTPException, Request
from db import db
from auth_deps import require_prescriber, require_staff
from models import ReferrerBody
from server import create_notification
from services.tenancy import resolve_clinic_id, tenant_filter

router = APIRouter()


@router.post("/api/referrers")
async def create_referrer(
    body: ReferrerBody,
    request: Request,
    user=Depends(require_staff),
):
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    clinic_id = await resolve_clinic_id(request, user)
    referrer_id = f"ref_{uuid.uuid4().hex[:10]}"
    doc = {
        "referrer_id": referrer_id,
        "clinic_id": clinic_id,
        "name": name,
        "phone": (body.phone or "").strip(),
        "whatsapp": (body.whatsapp or "").strip(),
        "email": (body.email or "").strip(),
        "clinic": (body.clinic or "").strip(),
        "speciality": (body.speciality or "").strip(),
        "city": (body.city or "").strip(),
        "notes": (body.notes or "").strip(),
        "created_by": user["user_id"],
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }
    await db.referrers.insert_one(doc)
    doc.pop("_id", None)
    # Notify the owner when a non-owner adds a new referring doctor so they
    # can track their team's CRM growth from the notifications bell.
    if user.get("role") != "owner":
        owners_cursor = db.users.find({"role": "owner"}, {"user_id": 1})
        owner_uids = [u["user_id"] async for u in owners_cursor if u.get("user_id")]
        for uid in owner_uids:
            await create_notification(
                user_id=uid,
                title="New referring doctor added",
                body=f"{user.get('name') or 'Staff'} added Dr. {name}"
                + (f" ({(body.speciality or '').strip()})" if body.speciality else ""),
                kind="referral",
                data={"referrer_id": referrer_id},
            )
    return doc


@router.get("/api/referrers")
async def list_referrers(request: Request, user=Depends(require_staff)):
    clinic_id = await resolve_clinic_id(request, user)
    base = tenant_filter(user, clinic_id, allow_global=True)
    cursor = db.referrers.find(base, {"_id": 0}).sort("name", 1)
    items = await cursor.to_list(length=2000)
    # Attach surgery-count (how many surgeries reference this name via referred_by)
    # Cheap: one aggregation for the whole set — also scoped to the clinic.
    try:
        match: dict = {"referred_by": {"$exists": True, "$ne": ""}, **base}
        pipeline = [
            {"$match": match},
            {"$group": {"_id": "$referred_by", "c": {"$sum": 1}}},
        ]
        agg = await db.surgeries.aggregate(pipeline).to_list(length=5000)
        counts = {(a.get("_id") or "").strip().lower(): a.get("c", 0) for a in agg}
        for it in items:
            it["surgery_count"] = counts.get((it.get("name") or "").strip().lower(), 0)
    except Exception:
        for it in items:
            it["surgery_count"] = 0
    return items


@router.patch("/api/referrers/{referrer_id}")
async def update_referrer(
    referrer_id: str,
    body: ReferrerBody,
    request: Request,
    user=Depends(require_staff),
):
    clinic_id = await resolve_clinic_id(request, user)
    base = tenant_filter(user, clinic_id, allow_global=True)
    existing = await db.referrers.find_one(
        {"referrer_id": referrer_id, **base}, {"_id": 0}
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Referrer not found")
    updates = {
        "name": (body.name or existing.get("name", "")).strip(),
        "phone": (body.phone or "").strip(),
        "whatsapp": (body.whatsapp or "").strip(),
        "email": (body.email or "").strip(),
        "clinic": (body.clinic or "").strip(),
        "speciality": (body.speciality or "").strip(),
        "city": (body.city or "").strip(),
        "notes": (body.notes or "").strip(),
        "updated_at": datetime.now(timezone.utc),
    }
    await db.referrers.update_one(
        {"referrer_id": referrer_id, **base}, {"$set": updates}
    )
    merged = {**existing, **updates}
    merged.pop("_id", None)
    return merged


@router.delete("/api/referrers/{referrer_id}")
async def delete_referrer(
    referrer_id: str,
    request: Request,
    user=Depends(require_prescriber),
):
    clinic_id = await resolve_clinic_id(request, user)
    base = tenant_filter(user, clinic_id, allow_global=True)
    res = await db.referrers.delete_one({"referrer_id": referrer_id, **base})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Referrer not found")
    return {"ok": True}
