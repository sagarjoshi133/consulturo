"""ConsultUro — Profile router.

GET /api/profile/quick-stats — auth, returns 2 KPI tiles.

Extracted from server.py during Phase 2 modularization.
"""
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends

from db import db
from auth_deps import require_user

router = APIRouter()


STAFF_QUICKSTAT_ROLES = {"owner", "partner", "doctor", "assistant", "reception", "nursing"}


@router.get("/api/profile/quick-stats")
async def profile_quick_stats(user=Depends(require_user)):
    role = user.get("role") or "patient"
    role_label = role
    is_staff = role in STAFF_QUICKSTAT_ROLES
    if not is_staff:
        # Custom role labels also count as staff if categorised as such.
        custom = await db.role_labels.find_one({"slug": role}, {"_id": 0, "category": 1})
        if custom and custom.get("category") in ("staff", "doctor"):
            is_staff = True

    if is_staff:
        try:
            from zoneinfo import ZoneInfo
            today = datetime.now(ZoneInfo("Asia/Kolkata")).date().isoformat()
        except Exception:
            today = datetime.utcnow().date().isoformat()
        # Today's bookings — bookings store the date in `booking_date`
        # (not `date`) and use lowercase status values.
        today_count = await db.bookings.count_documents({"booking_date": today})
        # Pending consultations — bookings flagged as awaiting consultation.
        pending_count = await db.bookings.count_documents({
            "$or": [
                {"status": "requested"},
                {"status": "confirmed", "consultation_done": {"$ne": True}},
            ],
        })
        return {
            "role": "staff",
            "tiles": [
                {"label": "Today",   "value": today_count,    "icon": "calendar",      "color": "#0E7C8B"},
                {"label": "Pending", "value": pending_count,  "icon": "hourglass",     "color": "#F59E0B"},
            ],
        }

    # Patient
    total_bookings = await db.bookings.count_documents({"user_id": user["user_id"]})
    total_records = 0
    try:
        total_records = await db.records.count_documents({"user_id": user["user_id"]})
    except Exception:
        # Records collection may not exist yet on a fresh DB — treat as 0.
        total_records = 0
    return {
        "role": "patient",
        "tiles": [
            {"label": "Bookings", "value": total_bookings, "icon": "calendar",      "color": "#0E7C8B"},
            {"label": "Records",  "value": total_records,  "icon": "folder-open",   "color": "#10B981"},
        ],
        "_role_label": role_label,
    }
