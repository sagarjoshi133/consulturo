"""ConsultUro — availability router.

  · /api/availability/me
  · /api/availability/doctors
  · /api/availability/slots
  · /api/unavailabilities
  · /api/unavailabilities/{rule_id}

Extracted from server.py during Phase 3 modularization.
Behaviour preserved EXACTLY.
"""
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import uuid
from fastapi import APIRouter, Depends, HTTPException
from db import db
from auth_deps import require_can_manage_availability
from models import DayAvailabilityBody, UnavailabilityBody
from server import DAY_KEYS, MAX_BOOKINGS_PER_SLOT, PRESCRIBER_AVAILABILITY_ROLES, _default_availability, _notify_affected_bookings, _slot_to_minutes

router = APIRouter()


@router.get("/api/availability/me")
async def get_my_availability(user=Depends(require_can_manage_availability)):
    doc = await db.availability.find_one({"user_id": user["user_id"]}, {"_id": 0})
    if not doc:
        return {"user_id": user["user_id"], **_default_availability()}
    return doc

@router.put("/api/availability/me")
async def set_my_availability(body: DayAvailabilityBody, user=Depends(require_can_manage_availability)):
    payload = body.model_dump()
    payload["user_id"] = user["user_id"]
    payload["updated_at"] = datetime.now(timezone.utc)
    await db.availability.update_one(
        {"user_id": user["user_id"]},
        {"$set": payload},
        upsert=True,
    )
    return payload

@router.get("/api/availability/doctors")
async def list_doctor_availability():
    """Public list of clinicians' weekly schedules (for patient
    booking UI). Includes:
      • owner-tier (primary_owner / partner / super_owner / legacy
        owner) — always treated as prescribers.
      • Any team member whose `can_prescribe` flag has been enabled
        by a Primary Owner / Partner.
    """
    prescribers = await db.users.find(
        {"$or": [
            {"role": {"$in": PRESCRIBER_AVAILABILITY_ROLES}},
            {"can_prescribe": True},
        ]}, {"_id": 0}
    ).to_list(length=50)
    out = []
    for p in prescribers:
        avail = await db.availability.find_one({"user_id": p["user_id"]}, {"_id": 0}) or _default_availability()
        out.append({
            "user_id": p["user_id"],
            "name": p.get("name"),
            "role": p.get("role"),
            "picture": p.get("picture"),
            "availability": avail,
        })
    return out

@router.get("/api/availability/slots")
async def get_available_slots(date: str, mode: str = "in-person", user_id: Optional[str] = None):
    """
    Returns 30-minute slots for a given ISO date (YYYY-MM-DD) and mode ('in-person' or 'online').
    If user_id is provided, filters to that doctor's availability.
    Slots already booked (status: requested / confirmed) for the same date+mode are excluded.
    Slots blocked by an entry in the `unavailabilities` collection (specific
    date or recurring weekly) are also excluded; if the whole day is marked
    all-day-unavailable, an empty slot list and a `reason` are returned so
    the booking UI can show a friendly message.
    """
    try:
        d = datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format (YYYY-MM-DD)")

    day_key = DAY_KEYS[d.weekday()]
    field = f"{day_key}_{'on' if mode == 'online' else 'in'}"

    # When a specific doctor is requested, honour only their availability.
    # When none is specified (typical patient booking UI), we must NOT UNION
    # every prescriber's hours — that leaks default or duplicated test-
    # account hours and shows slots the real doctor didn't actually select.
    # Strategy: prefer users who have a saved availability document. If none
    # exist, fall back to the default set (one doctor, first-time boot).
    # Eligible: owner-tier OR any team member with `can_prescribe:true`.
    doctors_q: Dict[str, Any] = {"$or": [
        {"role": {"$in": PRESCRIBER_AVAILABILITY_ROLES}},
        {"can_prescribe": True},
    ]}
    if user_id:
        doctors_q = {"user_id": user_id}

    doctors = await db.users.find(doctors_q, {"_id": 0}).to_list(length=50)

    # Split doctors by whether they have a saved availability doc.
    doctors_with_avail: List[Dict[str, Any]] = []
    for doc in doctors:
        avail_doc = await db.availability.find_one({"user_id": doc["user_id"]}, {"_id": 0})
        if avail_doc:
            doctors_with_avail.append({"user": doc, "avail": avail_doc})

    # If at least one doctor has configured availability, use ONLY those —
    # orphan / test accounts with no saved schedule no longer contribute.
    if doctors_with_avail:
        sources = doctors_with_avail
    else:
        # Every doctor account is still on defaults → show default slots once.
        fallback_doctor = doctors[0] if doctors else None
        sources = (
            [{"user": fallback_doctor, "avail": _default_availability()}]
            if fallback_doctor
            else []
        )

    slots_set: set = set()
    for src in sources:
        avail = src["avail"]
        if day_key in (avail.get("off_days") or []):
            continue
        windows = avail.get(field) or []
        for w in windows:
            s = _slot_to_minutes(w.get("start", ""))
            e = _slot_to_minutes(w.get("end", ""))
            if e <= s:
                continue
            t = s
            while t + 30 <= e:
                hh = t // 60
                mm = t % 60
                slots_set.add(f"{hh:02d}:{mm:02d}")
                t += 30

    # Aggregate booking counts per slot (allow up to MAX_BOOKINGS_PER_SLOT
    # patients per 30-min slot — overbooking is explicitly supported up to
    # the cap because the clinic runs OPDs that way). Status whitelist is
    # the same as before: requested + confirmed both reserve a seat.
    booked_counts: Dict[str, int] = {}
    booked_cursor = db.bookings.find(
        {
            "booking_date": date,
            "mode": "online" if mode == "online" else "in-person",
            "status": {"$in": ["requested", "confirmed"]},
        },
        {"_id": 0, "booking_time": 1},
    )
    async for b in booked_cursor:
        t = b.get("booking_time")
        if t:
            booked_counts[t] = booked_counts.get(t, 0) + 1
    # A slot is "full" only when it has reached the hard cap.
    full_times = {t for t, c in booked_counts.items() if c >= MAX_BOOKINGS_PER_SLOT}

    # Same-day filtering — never offer a slot that has already passed in IST.
    # Adds a 15-minute lead so the patient can still reach the clinic if
    # they tap "Confirm" right away (per user request, the +15 buffer is
    # restored — earlier removed in error).
    try:
        from zoneinfo import ZoneInfo  # py3.9+
        ist_now = datetime.now(ZoneInfo("Asia/Kolkata"))
    except Exception:
        # Fallback: treat server time as IST (server is configured to IST in production).
        ist_now = datetime.now()
    past_times: set = set()
    if d.date() == ist_now.date():
        cutoff_minutes = ist_now.hour * 60 + ist_now.minute + 15
        for s in list(slots_set):
            try:
                hh, mm = s.split(":")
                if int(hh) * 60 + int(mm) <= cutoff_minutes:
                    past_times.add(s)
            except Exception:
                continue

    slots = sorted(slots_set - full_times - past_times)

    # ── Unavailability filter ────────────────────────────────────────────
    # Block dates/time-ranges marked unavailable by the doctor. Supports
    # both single-date and recurring-weekly entries. If any rule covers
    # the whole day, return zero slots + a reason for the UI.
    unavail_reason: Optional[str] = None
    weekday = d.weekday()  # Mon=0 … Sun=6
    unavail_rules = await db.unavailabilities.find(
        {
            "$or": [
                {"date": date},
                {"recurring_weekly": True, "day_of_week": weekday},
            ]
        },
        {"_id": 0},
    ).to_list(length=100)
    if unavail_rules:
        for rule in unavail_rules:
            if bool(rule.get("all_day", True)):
                unavail_reason = rule.get("reason") or "Doctor unavailable on this day."
                slots = []
                break
        if slots:
            # Strip slots that fall inside any time-range rule
            blocked: set = set()
            for rule in unavail_rules:
                if rule.get("all_day"):
                    continue
                s = _slot_to_minutes(rule.get("start_time", ""))
                e = _slot_to_minutes(rule.get("end_time", ""))
                if e <= s:
                    continue
                for s_str in slots:
                    try:
                        hh, mm = s_str.split(":")
                        m = int(hh) * 60 + int(mm)
                        if s <= m < e:
                            blocked.add(s_str)
                    except Exception:
                        continue
            if blocked:
                slots = [x for x in slots if x not in blocked]
                if not slots:
                    unavail_reason = (unavail_rules[0].get("reason") or
                                       "Doctor unavailable during the requested hours.")

    return {
        "date": date,
        "mode": mode,
        "day": day_key,
        "slots": slots,
        # Per-slot occupancy ("HH:MM" → count). Useful for the UI to
        # render badges like "3/5". Includes both partially-booked and
        # full slots for context.
        "booked_counts": booked_counts,
        "max_per_slot": MAX_BOOKINGS_PER_SLOT,
        # `full_slots` carries slots dropped from `slots` because the
        # cap is reached. `booked_slots` is kept for legacy callers.
        "full_slots": sorted(full_times),
        "booked_slots": sorted(booked_counts.keys()),
        "past_slots": sorted(past_times),
        "unavailable_reason": unavail_reason,
    }

@router.get("/api/unavailabilities")
async def list_unavailabilities(user=Depends(require_can_manage_availability)):
    """List all currently-effective unavailability rules.

    Excludes single-date rules in the past so the dashboard stays uncluttered.
    Recurring weekly rules are always returned.
    """
    today = datetime.now(timezone.utc).date().isoformat()
    rules = await db.unavailabilities.find(
        {
            "$or": [
                {"recurring_weekly": True},
                {"date": {"$gte": today}},
            ]
        },
        {"_id": 0},
    ).to_list(length=500)
    rules.sort(key=lambda r: (
        not bool(r.get("recurring_weekly")),  # recurring first
        r.get("day_of_week") if r.get("recurring_weekly") else 99,
        r.get("date") or "",
        r.get("start_time") or "",
    ))
    return rules

@router.post("/api/unavailabilities")
async def create_unavailability(body: UnavailabilityBody, user=Depends(require_can_manage_availability)):
    if not body.recurring_weekly and not body.date:
        raise HTTPException(status_code=400, detail="Provide a date or mark as recurring weekly")
    if not body.all_day and (not body.start_time or not body.end_time):
        raise HTTPException(status_code=400, detail="Time range requires both start_time and end_time")
    if not body.all_day:
        s = _slot_to_minutes(body.start_time or "")
        e = _slot_to_minutes(body.end_time or "")
        if e <= s:
            raise HTTPException(status_code=400, detail="end_time must be after start_time")

    day_of_week = body.day_of_week
    if body.recurring_weekly and day_of_week is None and body.date:
        try:
            day_of_week = datetime.strptime(body.date, "%Y-%m-%d").weekday()
        except Exception:
            day_of_week = None
    if body.recurring_weekly and (day_of_week is None or not 0 <= day_of_week <= 6):
        raise HTTPException(status_code=400, detail="Recurring rules need a valid day_of_week (0..6)")

    doc = {
        "id": str(uuid.uuid4()),
        "date": None if body.recurring_weekly else body.date,
        "all_day": bool(body.all_day),
        "start_time": body.start_time if not body.all_day else None,
        "end_time": body.end_time if not body.all_day else None,
        "recurring_weekly": bool(body.recurring_weekly),
        "day_of_week": day_of_week if body.recurring_weekly else None,
        "reason": (body.reason or "").strip() or None,
        "created_by": user["user_id"],
        "created_by_name": user.get("name"),
        "created_at": datetime.now(timezone.utc),
    }
    await db.unavailabilities.insert_one(doc)
    doc.pop("_id", None)
    # Notify any patients whose existing bookings now fall in the unavailable
    # window so they can rebook. Best-effort; ignore failures.
    try:
        await _notify_affected_bookings(doc)
    except Exception:
        pass
    return doc

@router.delete("/api/unavailabilities/{rule_id}")
async def delete_unavailability(rule_id: str, user=Depends(require_can_manage_availability)):
    res = await db.unavailabilities.delete_one({"id": rule_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Rule not found")
    return {"ok": True}
