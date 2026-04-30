"""ConsultUro — bookings router.

  · /api/bookings
  · /api/bookings/me
  · /api/bookings/all
  · /api/bookings/guest
  · /api/bookings/check-duplicate
  · /api/bookings/{booking_id}
  · /api/bookings/{booking_id}/cancel

Extracted from server.py during Phase 3 modularization.
Behaviour preserved EXACTLY.
"""
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional
import uuid
import re
from fastapi import APIRouter, Depends, HTTPException, Request
from db import db
from auth_deps import OWNER_TIER_ROLES, get_current_user, require_staff, require_user
from models import BookingCreate, BookingStatusBody, PatientCancelBody
from server import MAX_BOOKINGS_PER_SLOT, _unavailability_block_reason, _urlencode, create_notification, get_or_set_reg_no, htmllib, limiter, notify_telegram, push_to_owner, push_to_user, require_approver
from services.tenancy import resolve_clinic_id, tenant_filter

router = APIRouter()


@router.post("/api/bookings")
@limiter.limit("10/minute")
async def create_booking(request: Request, payload: BookingCreate, user=Depends(get_current_user)):
    # ── Soft block: phone-first signups must add an email before
    # they can book. Guests (anonymous) are still allowed (the front-
    # end captures their phone in the booking form). The `code` is
    # used by the frontend to show the email-link sheet inline. ──
    if user and not user.get("email"):
        raise HTTPException(
            status_code=403,
            detail={
                "code": "EMAIL_REQUIRED_FOR_BOOKING",
                "message": "Please add an email address to your profile before booking. We use it to send appointment confirmations and prescriptions.",
            },
        )

    # Per-slot capacity: allow up to MAX_BOOKINGS_PER_SLOT patients per
    # (date, time, mode). Overbooking is explicitly supported up to the
    # cap (clinic OPDs run that way); only reject when the cap is hit.
    slot_count = await db.bookings.count_documents({
        "booking_date": payload.booking_date,
        "booking_time": payload.booking_time,
        "mode": payload.mode,
        "status": {"$in": ["requested", "confirmed"]},
    })
    if slot_count >= MAX_BOOKINGS_PER_SLOT:
        raise HTTPException(
            status_code=409,
            detail=f"This slot is full ({MAX_BOOKINGS_PER_SLOT} bookings already). Please pick another time.",
        )

    # Honour the doctor's holiday / unavailability rules at WRITE time
    # too — the slot listing already filters them, but a hand-crafted
    # POST could otherwise still slip through.
    block_reason = await _unavailability_block_reason(
        payload.booking_date, payload.booking_time
    )
    if block_reason:
        raise HTTPException(
            status_code=409,
            detail=f"Doctor unavailable on this date/time. {block_reason}",
        )

    # Reject past slots (always evaluated in IST so the clock is consistent
    # with the doctor's clinic timezone, regardless of where the request
    # originates from).
    try:
        from zoneinfo import ZoneInfo
        ist_now = datetime.now(ZoneInfo("Asia/Kolkata"))
    except Exception:
        ist_now = datetime.now()
    try:
        slot_dt = datetime.strptime(
            f"{payload.booking_date} {payload.booking_time}", "%Y-%m-%d %H:%M"
        ).replace(tzinfo=ist_now.tzinfo)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid booking date/time format")
    if slot_dt < ist_now - timedelta(minutes=5):
        raise HTTPException(status_code=400, detail="That slot is in the past. Please pick a future slot.")

    booking_id = f"bk_{uuid.uuid4().hex[:10]}"
    reg_no = await get_or_set_reg_no(payload.patient_phone, payload.registration_no, payload.patient_name)
    # Phase E — tag the booking with the active clinic so /bookings/all
    # filters cleanly. Anonymous bookings (no user) inherit the clinic
    # from the X-Clinic-Id header (set by the public /c/<slug> page);
    # if missing we leave it null so it stays globally visible until
    # a clinic claims it.
    booking_clinic_id = await resolve_clinic_id(request, user)
    doc = {
        "booking_id": booking_id,
        "user_id": user["user_id"] if user else None,
        "clinic_id": booking_clinic_id,
        "patient_name": payload.patient_name,
        "patient_phone": payload.patient_phone,
        "country_code": (payload.country_code or "+91").strip(),
        "patient_age": payload.patient_age,
        "patient_gender": payload.patient_gender,
        "registration_no": reg_no,
        "reason": payload.reason,
        "booking_date": payload.booking_date,
        "booking_time": payload.booking_time,
        "original_date": payload.booking_date,
        "original_time": payload.booking_time,
        "mode": payload.mode,
        "status": "requested",
        "confirmed_by": None,
        "confirmed_at": None,
        "patient_notified_at": None,
        "created_at": datetime.now(timezone.utc),
    }
    await db.bookings.insert_one(doc)

    mode_label = "Online (WhatsApp)" if payload.mode == "online" else "In-person"
    # Build wa.me link with country-code-prefixed digits so the doctor / staff
    # can DM the patient with one tap from the Telegram alert.
    _phone_local = re.sub(r"\D", "", payload.patient_phone or "")
    _cc = re.sub(r"\D", "", payload.country_code or "+91") or "91"
    _wa_digits = _phone_local if len(_phone_local) > 10 else (_cc + _phone_local)
    _wa_text = (
        f"Hello {payload.patient_name}, regarding your appointment request on "
        f"{payload.booking_date} at {payload.booking_time}. — Dr. Sagar Joshi's clinic"
    )
    wa_link = f"https://wa.me/{_wa_digits}?text={_urlencode(_wa_text)}"
    msg = (
        "🔔 <b>NEW APPOINTMENT REQUEST</b>\n"
        f"👤 <b>{htmllib.escape(payload.patient_name)}</b>"
        f"{' · ' + str(payload.patient_age) + 'y' if payload.patient_age else ''}"
        f"{' · ' + htmllib.escape(payload.patient_gender) if payload.patient_gender else ''}\n"
        f"📞 {htmllib.escape(payload.country_code or '+91')} {htmllib.escape(payload.patient_phone)}\n"
        f"📅 {payload.booking_date} · 🕘 {payload.booking_time} ({mode_label})\n"
        f"📝 {htmllib.escape(payload.reason)[:400]}\n"
        f"🆔 <code>{booking_id}</code>\n"
        f'<a href="{wa_link}">📲 Send WhatsApp to patient</a>\n'
        f"⚠️ Awaiting your confirmation in the app."
    )
    await notify_telegram(msg)
    # Push to owner's devices too
    await push_to_owner(
        "New appointment request",
        f"{payload.patient_name} — {payload.booking_date} {payload.booking_time}",
        {"type": "new_booking", "booking_id": booking_id},
    )
    # Persist an in-app notification for every user who can approve bookings
    # (owner-tier + team members with can_approve_bookings) so the bell
    # lights up and they can action it from the notifications screen.
    approvers_cursor = db.users.find(
        {"$or": [
            {"role": {"$in": list(OWNER_TIER_ROLES)}},
            {"can_approve_bookings": True},
        ]},
        {"user_id": 1},
    )
    approver_uids = [u["user_id"] async for u in approvers_cursor if u.get("user_id")]
    for uid in approver_uids:
        await create_notification(
            user_id=uid,
            title="New appointment request",
            body=f"{payload.patient_name} — {payload.booking_date} {payload.booking_time}",
            kind="booking",
            data={"type": "new_booking", "booking_id": booking_id, "status": "requested"},
            push=True,
        )

    doc.pop("_id", None)
    return doc

@router.get("/api/bookings/me")
async def my_bookings(user=Depends(require_user)):
    # Merge by user_id OR by phone number so guests who later sign in see their history.
    email_phones = await db.users.find({"user_id": user["user_id"]}, {"_id": 0, "phone": 1}).to_list(length=1)
    phone = (email_phones[0].get("phone") if email_phones else None) or None
    q = {"$or": [{"user_id": user["user_id"]}]}
    if phone:
        q["$or"].append({"patient_phone": phone})
    cursor = db.bookings.find(q, {"_id": 0}).sort("created_at", -1)
    return await cursor.to_list(length=200)

async def _auto_mark_missed(clinic_filter: Dict[str, Any]) -> int:
    """Self-healing: mark any confirmed booking as `missed` when
    `now > booking_date + 1 day + 1 hour` AND the patient never showed
    up (no completion status was recorded).

    Called lazily from `GET /api/bookings/all` so we don't need a cron
    daemon. Idempotent: only flips rows currently in `confirmed`. Also
    fires a push notification to the patient so they know their slot
    was marked missed.

    Per Dr. Joshi's spec (2026-04-29): grace period = 1 hour past
    midnight of the appointment day (i.e. missed at 01:00 local the
    morning AFTER the scheduled date). We treat `booking_date` as a
    local-date string (YYYY-MM-DD) and use UTC+05:30 (IST) for the
    clinic's local midnight.
    """
    from datetime import time as dtime
    ist = timezone(timedelta(hours=5, minutes=30))
    now_ist = datetime.now(ist)
    # Cutoff = yesterday (in IST) at 01:00 — bookings ≤ this date haven't
    # had their 1-hour grace window end yet are excluded.
    # A booking on 2026-04-28 passes the cutoff on 2026-04-29 01:00 IST.
    cutoff_date = (now_ist - timedelta(hours=25)).date().isoformat()
    q = {
        **clinic_filter,
        "status": "confirmed",
        # booking_date as string — we can use lexical comparison because
        # the format is YYYY-MM-DD which sorts correctly.
        "booking_date": {"$lte": cutoff_date},
    }
    cursor = db.bookings.find(q, {"_id": 0})
    candidates = await cursor.to_list(length=500)
    flipped = 0
    for b in candidates:
        try:
            # Build the flip-threshold: booking_date + 1 day + 1 hour IST.
            bd = datetime.strptime(b["booking_date"], "%Y-%m-%d").date()
            threshold = datetime.combine(bd, dtime(1, 0), tzinfo=ist) + timedelta(days=1)
            if now_ist < threshold:
                continue  # still inside grace window
            await db.bookings.update_one(
                {"booking_id": b["booking_id"], "status": "confirmed"},
                {"$set": {
                    "status": "missed",
                    "missed_at": datetime.now(timezone.utc),
                    "missed_auto": True,
                }},
            )
            flipped += 1
            # Fire patient notification (fire-and-forget).
            try:
                uid = b.get("user_id")
                if uid:
                    await create_notification(
                        user_id=uid,
                        title="You missed your appointment",
                        body=f"Your appointment on {b['booking_date']} at {b.get('booking_time','')} was marked as missed.",
                        kind="booking_missed",
                        data={"booking_id": b["booking_id"], "type": "booking_missed"},
                    )
                    await push_to_user(
                        uid,
                        "Missed appointment",
                        f"Your appointment on {b['booking_date']} at {b.get('booking_time','')} was marked as missed.",
                        data={"booking_id": b["booking_id"], "type": "booking_missed"},
                    )
            except Exception:
                pass
        except Exception:
            continue
    return flipped


@router.get("/api/bookings/all")
async def all_bookings(request: Request, user=Depends(require_staff)):
    # Phase E — scope to the current clinic (X-Clinic-Id header). For
    # super_owner without a header, returns ALL clinics' bookings.
    clinic_id = await resolve_clinic_id(request, user)
    q: Dict[str, Any] = tenant_filter(user, clinic_id, allow_global=True)
    # Self-healing: sweep stale confirmed bookings → missed. Lazy job,
    # so the admin dashboard is always up-to-date without a cron.
    try:
        await _auto_mark_missed(q)
    except Exception:
        pass  # never let the sweep break the listing
    cursor = db.bookings.find(q, {"_id": 0}).sort("created_at", -1)
    return await cursor.to_list(length=500)


@router.delete("/api/bookings/{booking_id}")
async def delete_booking(booking_id: str, request: Request, user=Depends(require_user)):
    """Hard-delete a booking. PRIMARY_OWNER / SUPER_OWNER only. Silent —
    no patient notification is sent (per Dr. Joshi's spec: delete is
    a "mistake removal" operation, not a cancellation).

    The delete is tenant-scoped: owners can only delete bookings
    belonging to their active clinic (unless they're super_owner
    viewing All Clinics).
    """
    if user.get("role") not in ("super_owner", "primary_owner", "owner"):
        raise HTTPException(status_code=403, detail="Primary owner access required")
    clinic_id = await resolve_clinic_id(request, user)
    base = tenant_filter(user, clinic_id, allow_global=True)
    existing = await db.bookings.find_one({"booking_id": booking_id, **base}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Not found")
    await db.bookings.delete_one({"booking_id": booking_id, **base})
    return {"ok": True, "deleted": booking_id}

@router.get("/api/bookings/guest")
async def guest_bookings_by_phone(phone: str):
    """Allows unauthenticated patients to see their own bookings by entering
    their phone number. Matches against the last 10 digits to be tolerant
    of +91 / formatting differences."""
    digits = re.sub(r"\D", "", phone or "")
    if len(digits) < 6:
        raise HTTPException(status_code=400, detail="Please provide a valid phone number")
    suffix = digits[-10:] if len(digits) >= 10 else digits
    cursor = db.bookings.find(
        {"patient_phone": {"$regex": f"{suffix}$"}},
        {"_id": 0},
    ).sort("created_at", -1)
    return await cursor.to_list(length=100)

@router.get("/api/bookings/check-duplicate")
async def check_duplicate_booking(phone: str = ""):
    """Public (no-auth) endpoint so the /book flow can warn users that
    they already have open (pending/confirmed) bookings for the same
    phone number. Returns only aggregate info — no PII payload."""
    digits = re.sub(r"\D", "", phone or "")
    if len(digits) < 6:
        return {"count": 0, "open_count": 0, "next": None}
    suffix = digits[-10:] if len(digits) >= 10 else digits
    cursor = db.bookings.find(
        {"patient_phone": {"$regex": f"{suffix}$"}},
        {"_id": 0, "booking_date": 1, "booking_time": 1, "status": 1, "booking_id": 1},
    ).sort("created_at", -1)
    rows = await cursor.to_list(length=50)
    open_rows = [r for r in rows if r.get("status") in ("requested", "confirmed")]
    nxt = None
    if open_rows:
        nxt = {
            "booking_date": open_rows[0].get("booking_date"),
            "booking_time": open_rows[0].get("booking_time"),
            "status": open_rows[0].get("status"),
        }
    return {"count": len(rows), "open_count": len(open_rows), "next": nxt}

@router.get("/api/bookings/{booking_id}")
async def get_booking(
    booking_id: str,
    phone: Optional[str] = None,
    user=Depends(get_current_user),
):
    """Full booking detail. Patients can only fetch their own; staff can
    fetch any. Anonymous callers may pass `?phone=` that matches the
    booking's phone number as a lightweight ownership proof (used by
    guest booking flow)."""
    doc = await db.bookings.find_one({"booking_id": booking_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Booking not found")
    if user:
        role = user.get("role")
        is_staff = role in {"owner", "doctor", "assistant", "staff"} or user.get("can_approve_bookings")
        if is_staff:
            return doc
        # Patient: allow if either user_id or phone matches
        uid_match = doc.get("user_id") == user["user_id"]
        phone_match = (
            user.get("phone")
            and doc.get("patient_phone")
            and re.sub(r"\D", "", user["phone"]) == re.sub(r"\D", "", doc["patient_phone"])
        )
        if uid_match or phone_match:
            return doc
        raise HTTPException(status_code=403, detail="Not allowed")
    # Anonymous path: phone must match (last 10 digits)
    if not phone:
        raise HTTPException(status_code=401, detail="Authentication or phone required")
    _d1 = re.sub(r"\D", "", phone)
    _d2 = re.sub(r"\D", "", doc.get("patient_phone", ""))
    _d1 = _d1[-10:] if len(_d1) >= 10 else _d1
    _d2 = _d2[-10:] if len(_d2) >= 10 else _d2
    if not _d1 or _d1 != _d2:
        raise HTTPException(status_code=403, detail="Phone does not match this booking")
    return doc

@router.patch("/api/bookings/{booking_id}")
async def update_booking(booking_id: str, body: BookingStatusBody, user=Depends(require_approver)):
    existing = await db.bookings.find_one({"booking_id": booking_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Not found")

    updates: Dict[str, Any] = {}
    status_label = existing["status"]

    if body.booking_date and body.booking_date != existing["booking_date"]:
        updates["booking_date"] = body.booking_date
    if body.booking_time and body.booking_time != existing["booking_time"]:
        updates["booking_time"] = body.booking_time

    # Conflict + capacity check if rescheduling to a new date/time.
    # Same rules as POST: allow up to MAX_BOOKINGS_PER_SLOT bookings
    # per (date, time, mode), and honour any unavailability rule.
    if "booking_date" in updates or "booking_time" in updates:
        new_date = updates.get("booking_date", existing["booking_date"])
        new_time = updates.get("booking_time", existing["booking_time"])
        slot_count = await db.bookings.count_documents({
            "booking_id": {"$ne": booking_id},
            "booking_date": new_date,
            "booking_time": new_time,
            "mode": existing.get("mode"),
            "status": {"$in": ["requested", "confirmed"]},
        })
        if slot_count >= MAX_BOOKINGS_PER_SLOT:
            raise HTTPException(
                status_code=409,
                detail=f"That slot is full ({MAX_BOOKINGS_PER_SLOT} bookings already at {new_date} {new_time}).",
            )
        block_reason = await _unavailability_block_reason(new_date, new_time)
        if block_reason:
            raise HTTPException(
                status_code=409,
                detail=f"Doctor unavailable on {new_date} {new_time}. {block_reason}",
            )

    if body.status and body.status != existing["status"]:
        if body.status not in ["confirmed", "completed", "cancelled", "rejected", "missed"]:
            raise HTTPException(status_code=400, detail="Invalid status")
        updates["status"] = body.status
        status_label = body.status
        if body.status == "confirmed":
            updates["confirmed_by"] = user["user_id"]
            updates["confirmed_by_name"] = user.get("name") or (user.get("email", "") or "").split("@")[0] or "Team"
            updates["confirmed_by_email"] = user.get("email")
            updates["confirmed_at"] = datetime.now(timezone.utc)
            updates["patient_notified_at"] = datetime.now(timezone.utc)
            # If the approver attached a note on confirmation, store it
            # specifically so it shows up on the booking detail screen
            # separate from subsequent generic status notes.
            if body.note:
                updates["approver_note"] = body.note
        elif body.status == "rejected":
            if body.reason:
                updates["rejection_reason"] = body.reason.strip()
            updates["rejected_by"] = user["user_id"]
            updates["rejected_by_name"] = user.get("name") or (user.get("email", "") or "").split("@")[0] or "Team"
            updates["rejected_at"] = datetime.now(timezone.utc)
        elif body.status == "cancelled":
            if body.reason:
                updates["cancellation_reason"] = body.reason.strip()
            updates["cancelled_by"] = "staff"
            updates["cancelled_by_name"] = user.get("name") or (user.get("email", "") or "").split("@")[0] or "Team"
            updates["cancelled_at"] = datetime.now(timezone.utc)

    # Capture a dedicated reschedule_reason even when status is unchanged
    # (pure reschedule) or when reschedule happens alongside confirm.
    if (body.booking_date or body.booking_time) and body.reason:
        updates["reschedule_reason"] = body.reason.strip()
        updates["rescheduled_by"] = user["user_id"]
        updates["rescheduled_by_name"] = user.get("name") or (user.get("email", "") or "").split("@")[0] or "Team"
        updates["rescheduled_at"] = datetime.now(timezone.utc)

    if body.note:
        updates["last_note"] = body.note

    # Doctor's private note — stored separately from `approver_note` (patient
    # visible) and `last_note`. Empty string clears it; `None` is ignored.
    if body.doctor_note is not None:
        updates["doctor_note"] = body.doctor_note.strip()
        updates["doctor_note_at"] = datetime.now(timezone.utc)
        updates["doctor_note_by"] = user.get("user_id")
        updates["doctor_note_by_name"] = user.get("name") or (user.get("email", "") or "").split("@")[0]

    if not updates:
        return existing

    # If booking time/date/status changed, reset any already-fired reminder
    # flags so the scheduler can re-evaluate against the NEW time.
    status_changed = ("status" in updates) and (updates.get("status") != existing.get("status"))
    time_changed = ("booking_date" in updates) or ("booking_time" in updates)
    if status_changed or time_changed:
        updates["reminder_24h_fired_at"] = None
        updates["reminder_2h_fired_at"] = None

    await db.bookings.update_one({"booking_id": booking_id}, {"$set": updates})

    final_date = updates.get("booking_date", existing["booking_date"])
    final_time = updates.get("booking_time", existing["booking_time"])
    rescheduled = ("booking_date" in updates) or ("booking_time" in updates)

    # Telegram ping to owner on confirm/reschedule/cancel — serves as the "only confirmed bookings
    # go to external channels" rule and a single source of truth for the doctor.
    # Only fire status-transition notifications when the status ACTUALLY
    # changed — otherwise a note-only or pure-reschedule update on a
    # confirmed booking would double-fire "Appointment confirmed".
    status_just_changed = ("status" in updates) and (updates.get("status") != existing.get("status"))

    if status_just_changed and status_label == "confirmed":
        note_line = f"\nNote: {body.note}" if (body.note and body.note.strip()) else ""
        wa_text = (
            f"Dear {existing['patient_name']}, your appointment with Dr. Sagar Joshi is "
            f"CONFIRMED on {final_date} at {final_time}"
            f"{' (rescheduled from ' + existing['original_date'] + ' ' + existing['original_time'] + ')' if rescheduled else ''}. "
            f"Clinic: Sterling Hospitals, Vadodara. Ref: {booking_id}. — ConsultUro"
        )
        phone_digits_local = re.sub(r"\D", "", existing["patient_phone"])
        cc_digits = re.sub(r"\D", "", existing.get("country_code") or "+91") or "91"
        # If patient_phone already contains the country code (>10 digits)
        # use as-is, otherwise prefix the stored country_code so wa.me
        # opens correctly without a manual fix on the doctor's side.
        wa_digits = phone_digits_local if len(phone_digits_local) > 10 else (cc_digits + phone_digits_local)
        wa_link = f"https://wa.me/{wa_digits}?text={_urlencode(wa_text)}"
        await notify_telegram(
            "✅ <b>APPOINTMENT CONFIRMED</b>\n"
            f"👤 {htmllib.escape(existing['patient_name'])} — {htmllib.escape(existing['patient_phone'])}\n"
            f"📅 {final_date} · 🕘 {final_time}"
            f"{' (rescheduled)' if rescheduled else ''}\n"
            f"🆔 <code>{booking_id}</code>\n"
            f'<a href="{wa_link}">📲 Send WhatsApp to patient</a>'
        )
        push_body = (
            f"Your visit on {final_date} at {final_time} is confirmed by Dr. Sagar Joshi."
            + note_line
        )
        await push_to_user(
            existing.get("user_id"),
            existing.get("patient_phone"),
            "Appointment confirmed ✅",
            push_body,
            {"type": "booking_confirmed", "booking_id": booking_id},
        )
        await create_notification(
            user_id=existing.get("user_id"),
            title="Appointment confirmed ✅",
            body=(
                f"Your visit on {final_date} at {final_time} is confirmed by Dr. Sagar Joshi."
                + (" (Rescheduled)" if rescheduled else "")
                + note_line
            ),
            kind="booking",
            data={"booking_id": booking_id, "status": "confirmed"},
            push=False,
        )
    elif status_just_changed and status_label == "completed":
        # Newly-introduced notification for when staff marks a visit as
        # completed so the patient gets a gentle acknowledgement in their
        # bell + push (e.g. "your visit is marked complete; here are next
        # steps…"). The approver can attach a note that flows through.
        note_line = (body.note or "").strip()
        await push_to_user(
            existing.get("user_id"),
            existing.get("patient_phone"),
            "Visit marked complete 🎉",
            (f"{note_line} — " if note_line else "")
            + f"Thank you for visiting Dr. Sagar Joshi on {final_date}. Your prescription (if any) will appear shortly.",
            {"type": "booking_completed", "booking_id": booking_id},
        )
        await create_notification(
            user_id=existing.get("user_id"),
            title="Visit marked complete",
            body=(
                (f"{note_line}\n" if note_line else "")
                + f"Thank you for visiting Dr. Sagar Joshi on {final_date}. Your prescription (if any) will appear shortly."
            ),
            kind="booking",
            data={"booking_id": booking_id, "status": "completed"},
            push=False,
        )
    elif status_just_changed and status_label == "rejected":
        reason_text = (body.reason or "").strip()
        await notify_telegram(
            f"❌ <b>Appointment REJECTED</b>\n"
            f"👤 {htmllib.escape(existing['patient_name'])} · {existing['patient_phone']}\n"
            f"🆔 <code>{booking_id}</code>"
            + (f"\n📝 {htmllib.escape(reason_text)[:400]}" if reason_text else "")
        )
        await push_to_user(
            existing.get("user_id"),
            existing.get("patient_phone"),
            "Appointment could not be confirmed",
            (f"Reason: {reason_text[:100]} — " if reason_text else "")
            + f"Please contact clinic to reschedule. Ref: {booking_id}",
            {"type": "booking_rejected", "booking_id": booking_id},
        )
        await create_notification(
            user_id=existing.get("user_id"),
            title="Appointment rejected",
            body=(
                (f"Reason: {reason_text}. " if reason_text else "")
                + "Please contact the clinic to reschedule."
            ),
            kind="booking",
            data={"booking_id": booking_id, "status": "rejected"},
            push=False,
        )
    elif status_just_changed and status_label == "cancelled":
        reason_text = (body.reason or "").strip()
        await notify_telegram(
            f"🚫 <b>Appointment CANCELLED</b>\n"
            f"👤 {htmllib.escape(existing['patient_name'])}\n"
            f"🆔 <code>{booking_id}</code>"
            + (f"\n📝 {htmllib.escape(reason_text)[:400]}" if reason_text else "")
        )
        await push_to_user(
            existing.get("user_id"),
            existing.get("patient_phone"),
            "Appointment cancelled",
            (f"Reason: {reason_text[:100]} — " if reason_text else "")
            + f"Your {final_date} {final_time} appointment has been cancelled.",
            {"type": "booking_cancelled", "booking_id": booking_id},
        )
        await create_notification(
            user_id=existing.get("user_id"),
            title="Appointment cancelled",
            body=(
                (f"Reason: {reason_text}. " if reason_text else "")
                + f"Your {final_date} {final_time} appointment has been cancelled."
            ),
            kind="booking",
            data={"booking_id": booking_id, "status": "cancelled"},
            push=False,
        )

    doc = await db.bookings.find_one({"booking_id": booking_id}, {"_id": 0})
    doc["rescheduled"] = rescheduled
    # If the status was not changed but the date/time was (pure reschedule),
    # the block above skipped sending patient-facing alerts because those
    # live under the status-change branches. Send a dedicated reschedule
    # notification so the patient always knows.
    if rescheduled and (not body.status or body.status == existing["status"]):
        reason_text = (body.reason or "").strip()
        await push_to_user(
            existing.get("user_id"),
            existing.get("patient_phone"),
            "Appointment rescheduled",
            (f"Reason: {reason_text[:100]} — " if reason_text else "")
            + f"Your appointment has been moved to {final_date} at {final_time}.",
            {"type": "booking_rescheduled", "booking_id": booking_id},
        )
        await create_notification(
            user_id=existing.get("user_id"),
            title="Appointment rescheduled",
            body=(
                (f"Reason: {reason_text}. " if reason_text else "")
                + f"Your appointment has been moved to {final_date} at {final_time}"
                + (f" (from {existing['original_date']} {existing['original_time']})."
                   if existing.get("original_date") and existing.get("original_time") else ".")
            ),
            kind="booking",
            data={"booking_id": booking_id, "status": existing["status"]},
            push=False,
        )
        await notify_telegram(
            f"🔁 <b>Appointment rescheduled</b>\n"
            f"👤 {htmllib.escape(existing['patient_name'])} · {existing.get('patient_phone','')}\n"
            f"📅 {final_date} · 🕘 {final_time}\n"
            f"🆔 <code>{booking_id}</code>"
            + (f"\n📝 {htmllib.escape(reason_text)[:400]}" if reason_text else "")
        )

    # --- Note-only update ---------------------------------------------------
    # If the staff attached a note WITHOUT changing status and WITHOUT
    # rescheduling, still send a notification so the patient sees the
    # message in their bell + device push area.
    note_only = (
        body.note
        and (not body.status or body.status == existing["status"])
        and not rescheduled
    )
    if note_only:
        note_text = body.note.strip()
        current_status_label = (existing.get("status") or "").capitalize() or "Booking"
        await push_to_user(
            existing.get("user_id"),
            existing.get("patient_phone"),
            f"New note on your {current_status_label.lower()} booking",
            note_text[:160],
            {"type": "booking_note", "booking_id": booking_id},
        )
        await create_notification(
            user_id=existing.get("user_id"),
            title="📝 Note from the clinic",
            body=(
                f"On your {final_date} {final_time} appointment:\n{note_text}"
            ),
            kind="booking",
            data={"booking_id": booking_id, "status": existing.get("status")},
            push=False,
        )
        await notify_telegram(
            f"📝 <b>Clinic note on booking</b>\n"
            f"👤 {htmllib.escape(existing['patient_name'])}\n"
            f"📅 {final_date} · 🕘 {final_time}\n"
            f"🆔 <code>{booking_id}</code>\n"
            f"{htmllib.escape(note_text)[:500]}"
        )

    return doc

@router.post("/api/bookings/{booking_id}/cancel")
async def patient_cancel_booking(
    booking_id: str, body: PatientCancelBody, user=Depends(get_current_user)
):
    """The patient themselves (authenticated OR anonymous guest) can cancel
    a pending/confirmed booking with a reason. For anonymous guests we
    require a phone match as a lightweight ownership proof."""
    existing = await db.bookings.find_one({"booking_id": booking_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Booking not found")

    # Ownership / auth check
    def _last10(s: str) -> str:
        d = re.sub(r"\D", "", s or "")
        return d[-10:] if len(d) >= 10 else d

    if user:
        owner_uid_match = existing.get("user_id") and existing.get("user_id") == user["user_id"]
        # Some users link via phone (guest booking → later signed in). Allow phone match too.
        owner_phone_match = (
            user.get("phone")
            and existing.get("patient_phone")
            and _last10(user["phone"]) == _last10(existing["patient_phone"])
            and _last10(user["phone"])  # non-empty
        )
        if not (owner_uid_match or owner_phone_match):
            raise HTTPException(status_code=403, detail="Not allowed")
    else:
        # Anonymous: phone number must match the booking's phone (last 10 digits)
        if not body.patient_phone:
            raise HTTPException(status_code=400, detail="Phone number required for guest cancellation")
        if _last10(body.patient_phone) != _last10(existing.get("patient_phone", "")) or not _last10(body.patient_phone):
            raise HTTPException(status_code=403, detail="Phone number does not match this booking")

    if existing["status"] not in ("requested", "confirmed"):
        raise HTTPException(status_code=400, detail=f"This booking is already {existing['status']} and cannot be cancelled.")

    reason = (body.reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="A reason is required to cancel")

    updates = {
        "status": "cancelled",
        "cancelled_by": "patient",
        "cancellation_reason": reason,
        "cancelled_at": datetime.now(timezone.utc),
        "last_note": f"Cancelled by patient: {reason}",
    }
    await db.bookings.update_one({"booking_id": booking_id}, {"$set": updates})

    # Inform staff via Telegram + in-app notification
    await notify_telegram(
        "🚫 <b>Patient cancelled appointment</b>\n"
        f"👤 {htmllib.escape(existing['patient_name'])} · {existing.get('patient_phone','')}\n"
        f"📅 {existing['booking_date']} · 🕘 {existing['booking_time']}\n"
        f"🆔 <code>{booking_id}</code>\n"
        f"📝 {htmllib.escape(reason)[:400]}"
    )
    approvers_cursor = db.users.find(
        {"$or": [
            {"role": {"$in": list(OWNER_TIER_ROLES)}},
            {"can_approve_bookings": True},
        ]},
        {"user_id": 1},
    )
    async for u in approvers_cursor:
        uid = u.get("user_id")
        if not uid:
            continue
        await create_notification(
            user_id=uid,
            title="Patient cancelled appointment",
            body=f"{existing['patient_name']} — {existing['booking_date']} {existing['booking_time']}: {reason[:80]}",
            kind="booking",
            data={"type": "booking_cancelled_by_patient", "booking_id": booking_id, "status": "cancelled"},
            push=True,
        )

    doc = await db.bookings.find_one({"booking_id": booking_id}, {"_id": 0})
    return doc
