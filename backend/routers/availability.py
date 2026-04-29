"""ConsultUro — availability router.

  · /api/availability/me
  · /api/availability/doctors
  · /api/availability/slots
  · /api/unavailabilities
  · /api/unavailabilities/{rule_id}

Phase E (multi-tenant): availability + unavailability docs are per-clinic
so a doctor can keep different schedules at different clinics.
`/api/availability/doctors` and `/api/availability/slots` are PUBLIC
endpoints (called by the patient booking page) and read X-Clinic-Id
from the request — when set (e.g. via /c/<slug> landing page), only
that clinic's prescribers + their schedules are returned.
"""
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import uuid
from fastapi import APIRouter, Depends, HTTPException, Request
from db import db
from auth_deps import get_current_user, require_can_manage_availability
from models import DayAvailabilityBody, UnavailabilityBody
from server import DAY_KEYS, MAX_BOOKINGS_PER_SLOT, PRESCRIBER_AVAILABILITY_ROLES, _default_availability, _notify_affected_bookings, _slot_to_minutes
from services.tenancy import resolve_clinic_id, tenant_filter, MEMBERSHIPS_COLL

router = APIRouter()


def _clinic_filter_or_empty(user: Optional[Dict[str, Any]], clinic_id: Optional[str]) -> Dict[str, Any]:
    """Like tenant_filter() but tolerates anonymous callers and missing
    clinic_id by returning {} (no filter). Used for PUBLIC availability
    endpoints called by patient booking flows."""
    if clinic_id:
        return {"clinic_id": clinic_id}
    return {}


@router.get("/api/availability/me")
async def get_my_availability(request: Request, user=Depends(require_can_manage_availability)):
    clinic_id = await resolve_clinic_id(request, user)
    q: Dict[str, Any] = {"user_id": user["user_id"]}
    if clinic_id:
        q["clinic_id"] = clinic_id
    doc = await db.availability.find_one(q, {"_id": 0})
    if not doc:
        return {"user_id": user["user_id"], "clinic_id": clinic_id, **_default_availability()}
    return doc

@router.put("/api/availability/me")
async def set_my_availability(request: Request, body: DayAvailabilityBody, user=Depends(require_can_manage_availability)):
    clinic_id = await resolve_clinic_id(request, user)
    payload = body.model_dump()
    payload["user_id"] = user["user_id"]
    payload["clinic_id"] = clinic_id
    payload["updated_at"] = datetime.now(timezone.utc)
    q: Dict[str, Any] = {"user_id": user["user_id"]}
    if clinic_id:
        q["clinic_id"] = clinic_id
    await db.availability.update_one(q, {"$set": payload}, upsert=True)
    return payload

@router.get("/api/availability/doctors")
async def list_doctor_availability(request: Request):
    """Public list of clinicians' weekly schedules (for patient
    booking UI). Includes:
      • owner-tier (primary_owner / partner / super_owner / legacy
        owner) — always treated as prescribers.
      • Any team member whose `can_prescribe` flag has been enabled
        by a Primary Owner / Partner.

    Phase E: when X-Clinic-Id is supplied (e.g. patient is on
    /c/<slug>), only members of THAT clinic are returned. When
    omitted, returns every prescriber across the platform (the legacy
    behaviour, used by the patient app's home screen on accounts that
    haven't been routed via a clinic landing page).
    """
    clinic_id = (request.headers.get("X-Clinic-Id") or "").strip() or None
    if clinic_id:
        # Only return prescribers who are members of this clinic.
        member_user_ids = [
            m["user_id"]
            async for m in db[MEMBERSHIPS_COLL].find(
                {"clinic_id": clinic_id, "is_active": True}, {"_id": 0, "user_id": 1}
            )
        ]
        if not member_user_ids:
            return []
        prescribers = await db.users.find(
            {
                "user_id": {"$in": member_user_ids},
                "$or": [
                    {"role": {"$in": PRESCRIBER_AVAILABILITY_ROLES}},
                    {"can_prescribe": True},
                ],
            }, {"_id": 0}
        ).to_list(length=50)
    else:
        prescribers = await db.users.find(
            {"$or": [
                {"role": {"$in": PRESCRIBER_AVAILABILITY_ROLES}},
                {"can_prescribe": True},
            ]}, {"_id": 0}
        ).to_list(length=50)
    out = []
    for p in prescribers:
        avq: Dict[str, Any] = {"user_id": p["user_id"]}
        if clinic_id:
            avq["clinic_id"] = clinic_id
        avail = await db.availability.find_one(avq, {"_id": 0}) or _default_availability()
        out.append({
            "user_id": p["user_id"],
            "name": p.get("name"),
            "role": p.get("role"),
            "picture": p.get("picture"),
            "availability": avail,
        })
    return out

@router.get("/api/availability/slots")
async def get_available_slots(request: Request, date: str, mode: str = "in-person", user_id: Optional[str] = None):
    """30-minute slots for ISO date + mode. PUBLIC. Reads X-Clinic-Id
    so booking from /c/<slug> only shows that clinic's hours."""
    clinic_id = (request.headers.get("X-Clinic-Id") or "").strip() or None
    try:
        d = datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format (YYYY-MM-DD)")

    day_key = DAY_KEYS[d.weekday()]
    field = f"{day_key}_{'on' if mode == 'online' else 'in'}"

    doctors_q: Dict[str, Any] = {"$or": [
        {"role": {"$in": PRESCRIBER_AVAILABILITY_ROLES}},
        {"can_prescribe": True},
    ]}
    if user_id:
        doctors_q = {"user_id": user_id}
    if clinic_id:
        # Restrict to members of the requested clinic.
        member_ids = [
            m["user_id"]
            async for m in db[MEMBERSHIPS_COLL].find(
                {"clinic_id": clinic_id, "is_active": True}, {"_id": 0, "user_id": 1}
            )
        ]
        # Combine with role filter via $and to keep the prescriber gate.
        if member_ids:
            doctors_q = {"$and": [doctors_q, {"user_id": {"$in": member_ids}}]}
        else:
            return {"date": date, "mode": mode, "day": day_key, "slots": [], "booked_counts": {}, "max_per_slot": MAX_BOOKINGS_PER_SLOT, "full_slots": [], "booked_slots": [], "past_slots": [], "unavailable_reason": None}

    doctors = await db.users.find(doctors_q, {"_id": 0}).to_list(length=50)

    # Split doctors by whether they have a saved availability doc (per-clinic).
    doctors_with_avail: List[Dict[str, Any]] = []
    for doc in doctors:
        avq: Dict[str, Any] = {"user_id": doc["user_id"]}
        if clinic_id:
            avq["clinic_id"] = clinic_id
        avail_doc = await db.availability.find_one(avq, {"_id": 0})
        if avail_doc:
            doctors_with_avail.append({"user": doc, "avail": avail_doc})

    if doctors_with_avail:
        sources = doctors_with_avail
    else:
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

    booked_counts: Dict[str, int] = {}
    bq: Dict[str, Any] = {
        "booking_date": date,
        "mode": "online" if mode == "online" else "in-person",
        "status": {"$in": ["requested", "confirmed"]},
    }
    if clinic_id:
        bq["clinic_id"] = clinic_id
    booked_cursor = db.bookings.find(bq, {"_id": 0, "booking_time": 1})
    async for b in booked_cursor:
        t = b.get("booking_time")
        if t:
            booked_counts[t] = booked_counts.get(t, 0) + 1
    full_times = {t for t, c in booked_counts.items() if c >= MAX_BOOKINGS_PER_SLOT}

    try:
        from zoneinfo import ZoneInfo
        ist_now = datetime.now(ZoneInfo("Asia/Kolkata"))
    except Exception:
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

    unavail_reason: Optional[str] = None
    weekday = d.weekday()
    uq: Dict[str, Any] = {
        "$or": [
            {"date": date},
            {"recurring_weekly": True, "day_of_week": weekday},
        ]
    }
    if clinic_id:
        uq["clinic_id"] = clinic_id
    unavail_rules = await db.unavailabilities.find(uq, {"_id": 0}).to_list(length=100)
    if unavail_rules:
        for rule in unavail_rules:
            if bool(rule.get("all_day", True)):
                unavail_reason = rule.get("reason") or "Doctor unavailable on this day."
                slots = []
                break
        if slots:
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
        "booked_counts": booked_counts,
        "max_per_slot": MAX_BOOKINGS_PER_SLOT,
        "full_slots": sorted(full_times),
        "booked_slots": sorted(booked_counts.keys()),
        "past_slots": sorted(past_times),
        "unavailable_reason": unavail_reason,
    }

@router.get("/api/unavailabilities")
async def list_unavailabilities(request: Request, user=Depends(require_can_manage_availability)):
    """List all currently-effective unavailability rules for the active clinic."""
    today = datetime.now(timezone.utc).date().isoformat()
    clinic_id = await resolve_clinic_id(request, user)
    q: Dict[str, Any] = {
        "$or": [
            {"recurring_weekly": True},
            {"date": {"$gte": today}},
        ],
        **tenant_filter(user, clinic_id, allow_global=True),
    }
    rules = await db.unavailabilities.find(q, {"_id": 0}).to_list(length=500)
    rules.sort(key=lambda r: (
        not bool(r.get("recurring_weekly")),
        r.get("day_of_week") if r.get("recurring_weekly") else 99,
        r.get("date") or "",
        r.get("start_time") or "",
    ))
    return rules

@router.post("/api/unavailabilities")
async def create_unavailability(request: Request, body: UnavailabilityBody, user=Depends(require_can_manage_availability)):
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

    clinic_id = await resolve_clinic_id(request, user)
    doc = {
        "id": str(uuid.uuid4()),
        "clinic_id": clinic_id,
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
    try:
        await _notify_affected_bookings(doc)
    except Exception:
        pass
    return doc

@router.delete("/api/unavailabilities/{rule_id}")
async def delete_unavailability(request: Request, rule_id: str, user=Depends(require_can_manage_availability)):
    clinic_id = await resolve_clinic_id(request, user)
    q: Dict[str, Any] = {"id": rule_id, **tenant_filter(user, clinic_id, allow_global=True)}
    res = await db.unavailabilities.delete_one(q)
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Rule not found")
    return {"ok": True}

