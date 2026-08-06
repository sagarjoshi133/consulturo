"""ConsultUro — Review Request admin router.

Lets the primary owner (and staff) audit Google-review nudges, manually
trigger one for a patient, or dismiss a pending one.

Endpoints (all under /api/review-requests):
  GET    /                       — list, filter by status / trigger / phone
  GET    /summary                — counts by status + trigger
  POST   /{id}/send-now          — force-fire immediately
  POST   /{id}/dismiss           — cancel pending row
  POST   /manual                 — create one ad-hoc (e.g. for walk-ins)
  GET    /me/pending             — patient-side: am I owed a review nudge?
                                    (used by the patient banner)
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from auth_deps import require_owner, require_staff, require_user
from db import db
from services.review_request import (
    DEFAULT_TRIGGERS,
    _digits10,
    fire_due_review_requests,
    schedule_review_request,
)
from services.tenancy import resolve_clinic_id

router = APIRouter()


def _clean(row: Dict[str, Any]) -> Dict[str, Any]:
    row.pop("_id", None)
    for k in ("due_at", "sent_at", "created_at"):
        v = row.get(k)
        if isinstance(v, datetime):
            row[k] = v.isoformat()
    return row


@router.get("/api/review-requests")
async def list_review_requests(
    request: Request,
    status: Optional[str] = Query(None),       # pending|sent|dismissed|failed
    trigger: Optional[str] = Query(None),
    phone: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    user=Depends(require_staff),
):
    clinic_id = await resolve_clinic_id(request, user)
    q: Dict[str, Any] = {}
    # Tenant scoping — staff only see their clinic's rows. super_owner
    # without a header sees the legacy "default" bucket.
    q["clinic_id"] = clinic_id or "default"
    if status:
        q["status"] = status
    if trigger:
        q["trigger"] = trigger
    p10 = _digits10(phone) if phone else None
    if p10:
        q["phone"] = p10
    cursor = db.review_requests.find(q).sort("created_at", -1).limit(limit)
    rows: List[Dict[str, Any]] = []
    async for r in cursor:
        rows.append(_clean(r))
    return {"items": rows, "count": len(rows)}


@router.get("/api/review-requests/summary")
async def review_request_summary(
    request: Request,
    user=Depends(require_staff),
):
    clinic_id = await resolve_clinic_id(request, user) or "default"
    pipeline = [
        {"$match": {"clinic_id": clinic_id}},
        {"$group": {"_id": {"status": "$status", "trigger": "$trigger"}, "count": {"$sum": 1}}},
    ]
    agg: Dict[str, Any] = {"by_status": {}, "by_trigger": {}, "total": 0}
    async for row in db.review_requests.aggregate(pipeline):
        st = (row["_id"].get("status") or "unknown")
        tg = (row["_id"].get("trigger") or "unknown")
        n = int(row.get("count") or 0)
        agg["total"] += n
        agg["by_status"][st] = agg["by_status"].get(st, 0) + n
        agg["by_trigger"][tg] = agg["by_trigger"].get(tg, 0) + n
    return agg


@router.post("/api/review-requests/{request_id}/send-now")
async def review_request_send_now(
    request_id: str,
    request: Request,
    user=Depends(require_owner),
):
    row = await db.review_requests.find_one({"id": request_id})
    if not row:
        raise HTTPException(status_code=404, detail="Review request not found")
    if row.get("status") not in (None, "pending", "failed"):
        return {"ok": True, "status": row.get("status"), "msg": "Already processed"}
    await db.review_requests.update_one(
        {"id": request_id},
        {"$set": {"due_at": datetime.now(timezone.utc), "status": "pending"}},
    )
    fired = await fire_due_review_requests(datetime.now(timezone.utc))
    return {"ok": True, "fired": fired}


@router.post("/api/review-requests/{request_id}/dismiss")
async def review_request_dismiss(
    request_id: str,
    user=Depends(require_owner),
):
    res = await db.review_requests.update_one(
        {"id": request_id, "status": "pending"},
        {"$set": {"status": "dismissed", "dismissed_at": datetime.now(timezone.utc)}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="No pending review request with that id")
    return {"ok": True}


class ManualReviewRequestBody(BaseModel):
    patient_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    user_id: Optional[str] = None
    trigger: Optional[str] = "manual"
    source_id: Optional[str] = None
    send_now: Optional[bool] = True


@router.post("/api/review-requests/manual")
async def review_request_manual(
    request: Request,
    body: ManualReviewRequestBody,
    user=Depends(require_owner),
):
    if not (body.user_id or body.phone or body.email):
        raise HTTPException(status_code=400, detail="user_id, phone, or email required")
    trigger = (body.trigger or "manual").strip() or "manual"
    if trigger not in (*DEFAULT_TRIGGERS, "manual"):
        trigger = "manual"
    clinic_id = await resolve_clinic_id(request, user)
    # Temporarily allow trigger='manual' by patching the settings cache —
    # easier: schedule_review_request only allows whitelisted triggers,
    # so for 'manual' we craft the row directly.
    if trigger == "manual":
        # Mimic the helper but bypass the trigger-in-triggers gate so an
        # owner can manually nudge any patient regardless of settings.
        from services.review_request import (
            DEFAULT_DELAY_HOURS,
            DEFAULT_MESSAGE,
            _render_message,
            _wa_link,
            _get_clinic_settings,
        )
        import uuid
        settings = await _get_clinic_settings(clinic_id)
        review_url = (settings.get("google_review_url") or "").strip()
        if not review_url:
            raise HTTPException(status_code=400, detail="Google review URL is not configured for this clinic")
        first_name = (body.patient_name or "").strip().split(" ")[0] or "there"
        clinic_name = (settings.get("clinic_name") or "the clinic").strip()
        msg = _render_message(
            settings.get("google_review_message_template") or DEFAULT_MESSAGE,
            first_name=first_name,
            clinic_name=clinic_name,
            review_url=review_url,
        )
        p10 = _digits10(body.phone) if body.phone else None
        now = datetime.now(timezone.utc)
        doc = {
            "id": str(uuid.uuid4()),
            "user_id": body.user_id,
            "phone": p10,
            "email": (body.email or "").strip().lower() or None,
            "name": body.patient_name,
            "trigger": "manual",
            "source_id": body.source_id,
            "clinic_id": clinic_id or settings.get("clinic_id") or "default",
            "review_url": review_url,
            "message": msg,
            "wa_link": _wa_link(p10, msg),
            "due_at": now,
            "status": "pending",
            "sent_at": None,
            "created_at": now,
        }
        await db.review_requests.insert_one(doc)
    else:
        doc = await schedule_review_request(
            trigger=trigger,
            user_id=body.user_id,
            patient_name=body.patient_name,
            phone=body.phone,
            email=body.email,
            source_id=body.source_id,
            clinic_id=clinic_id,
        )
        if not doc:
            raise HTTPException(
                status_code=400,
                detail="Could not schedule review request — check that the clinic has Google review URL + trigger enabled.",
            )
    if body.send_now:
        await db.review_requests.update_one(
            {"id": doc["id"]},
            {"$set": {"due_at": datetime.now(timezone.utc)}},
        )
        await fire_due_review_requests(datetime.now(timezone.utc))
    refreshed = await db.review_requests.find_one({"id": doc["id"]}) or doc
    return _clean(refreshed)


@router.get("/api/review-requests/me/pending")
async def my_pending_review(
    request: Request,
    user=Depends(require_user),
):
    """Patient-side: return one pending/sent-but-not-acked review nudge
    for the current user (used by the in-app banner). Returns 204-ish
    empty payload when nothing is owed."""
    now = datetime.now(timezone.utc)
    # Pull anything sent in the last 30 days OR due any time within
    # the next 7 days for this user.
    q: Dict[str, Any] = {
        "$or": [
            {"user_id": user.get("user_id"), "status": {"$in": ["pending", "sent"]}},
        ],
    }
    phone10 = _digits10(user.get("phone"))
    if phone10:
        q["$or"].append({"phone": phone10, "status": {"$in": ["pending", "sent"]}})
    row = await db.review_requests.find_one(q, sort=[("created_at", -1)])
    if not row:
        return {"pending": False}
    if row.get("acked_at"):
        return {"pending": False}
    return {
        "pending": True,
        "request_id": row.get("id"),
        "review_url": row.get("review_url"),
        "message": row.get("message"),
        "trigger": row.get("trigger"),
        "sent_at": row.get("sent_at").isoformat() if isinstance(row.get("sent_at"), datetime) else row.get("sent_at"),
    }


@router.post("/api/review-requests/{request_id}/ack")
async def review_request_ack(
    request_id: str,
    user=Depends(require_user),
):
    """Patient taps "Leave a review" or "Maybe later" — either way we
    record it so the banner doesn't keep nagging them."""
    res = await db.review_requests.update_one(
        {"id": request_id},
        {"$set": {"acked_at": datetime.now(timezone.utc), "acked_by": user.get("user_id")}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Review request not found")
    return {"ok": True}
