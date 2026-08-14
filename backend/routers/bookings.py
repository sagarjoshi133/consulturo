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
from typing import Any, Dict, List, Optional
import uuid
import re
from fastapi import APIRouter, Body, Depends, HTTPException, Request
from db import db
from auth_deps import OWNER_TIER_ROLES, get_current_user, require_staff, require_user
from models import BookingCreate, BookingStatusBody, PatientCancelBody
from server import MAX_BOOKINGS_PER_SLOT, _unavailability_block_reason, _urlencode, create_notification, get_or_set_reg_no, htmllib, limiter, notify_telegram, push_to_owner, push_to_user, require_approver
from services.tenancy import resolve_clinic_id, tenant_filter
from services import hms

router = APIRouter()


async def _maybe_auto_provision_video(
    *, booking_id: str, existing: Dict[str, Any],
    final_date: str, final_time: str,
) -> None:
    """When a video booking is confirmed AND the clinic has enabled
    `auto_provision_on_confirm`, mint a 100ms room and store it on
    the booking. If `auto_notify_patient` is also on, immediately push
    + notify the patient with their join link.

    NEVER raises. The booking confirmation flow already succeeded;
    surfacing a 100ms error here would be confusing UX. We just log
    via Telegram so the doctor can investigate.
    """
    # ── 1. Booking eligibility ───────────────────────────────────
    mode = (existing.get("mode") or "").lower()
    if mode not in ("online", "video", "tele"):
        return  # not a video booking — silent
    # Skip HMS provisioning if patient/staff opted for WhatsApp video.
    # The clinic will WA-call the patient directly; no room needed.
    if (existing.get("online_channel") or "in_app") == "whatsapp":
        return
    if not hms.is_configured():
        return  # env vars missing — silent (e.g. local dev fork)
    if existing.get("video_room", {}).get("room_id"):
        return  # already provisioned — idempotent

    # ── 2. Read settings (with safe defaults) ───────────────────
    try:
        cs = await db.clinic_settings.find_one({}, {"_id": 0}) or {}
    except Exception:
        cs = {}
    video_cfg = (cs.get("video") or {})
    if not video_cfg.get("auto_provision_on_confirm", True):
        return  # admin disabled auto-provision

    # ── 3. Create the room ──────────────────────────────────────
    try:
        room = await hms.create_consultation_room(
            booking_id=booking_id,
            patient_name=existing.get("patient_name", ""),
            doctor_name="Dr Sagar Joshi",
        )
        await db.bookings.update_one(
            {"booking_id": booking_id},
            {"$set": {"video_room": room, "mode": "video"}},
        )
    except Exception as e:
        # Best-effort log; never block the confirmation flow.
        try:
            await notify_telegram(
                "⚠️ <b>Auto-provision video room FAILED</b>\n"
                f"🆔 <code>{booking_id}</code>\n"
                f"reason: {htmllib.escape(str(e)[:200])}"
            )
        except Exception:
            pass
        return

    # ── 4. Auto-notify patient ─────────────────────────────────
    if not video_cfg.get("auto_notify_patient", True):
        return
    patient_url = room.get("patient_url", "")
    patient_code = room.get("patient_code", "")
    doctor_url = room.get("doctor_url", "")
    doctor_code = room.get("doctor_code", "")
    if not patient_url:
        return

    # ── 4a. Patient push + bell — opens /video/[code]?role=patient ─
    # Both the original `patient_url` (web fallback) AND a `link`
    # alias are sent so the in-app tap handler can route to the
    # internal /video/[code] screen for a native in-app experience,
    # while users on older builds (no deep-link handler) still get the
    # url via the bell-card.
    try:
        await push_to_user(
            existing.get("user_id"),
            existing.get("patient_phone"),
            "Your video consultation link is ready 🎥",
            f"Tap to join your video appointment on {final_date} at {final_time}.",
            {
                "type": "video_room_ready",
                "role": "patient",
                "booking_id": booking_id,
                "patient_url": patient_url,
                "patient_code": patient_code,
                "code": patient_code,
                "link": patient_url,
            },
        )
        await create_notification(
            user_id=existing.get("user_id"),
            phone=existing.get("patient_phone"),
            email=existing.get("patient_email"),
            title="Video consultation link ready 🎥",
            body=(
                f"Your video appointment with Dr. Sagar Joshi is on "
                f"{final_date} at {final_time}.\n\n"
                f"Tap to join from inside the app — your call is encrypted "
                f"end-to-end. Link: {patient_url}"
            ),
            kind="booking",
            data={
                "booking_id": booking_id,
                "kind": "video_room_ready",
                "type": "video_room_ready",
                "role": "patient",
                "patient_url": patient_url,
                "patient_code": patient_code,
                "code": patient_code,
                "link": patient_url,
            },
            push=False,
        )
    except Exception:
        # Push provider errors must not block confirmation. The link
        # is still available on the booking record.
        pass

    # ── 4b. Primary-owner / doctor push — opens /video/[code]?role=doctor
    # Always sends the HOST link to the primary owner so they can join
    # with their own role token. (Per user spec 2026-06-01: "always
    # share doctor's link to primary owner & patient's link to the
    # patient in notifications for a video consultation".)
    if doctor_url:
        try:
            # Resolve all primary_owner / super_owner users — usually a
            # single doctor account but we broadcast to be safe across
            # multi-doctor clinics.
            owner_cur = db.users.find(
                {"role": {"$in": ["primary_owner", "super_owner", "owner"]}},
                {"_id": 0, "user_id": 1, "phone": 1, "email": 1},
            )
            owners = await owner_cur.to_list(length=10)
            doctor_data = {
                "type": "video_room_ready",
                "role": "doctor",
                "booking_id": booking_id,
                "doctor_url": doctor_url,
                "doctor_code": doctor_code,
                "code": doctor_code,
                "link": doctor_url,
            }
            for o in owners:
                try:
                    await push_to_user(
                        o.get("user_id"),
                        o.get("phone"),
                        "Video room is ready · join as host 🎥",
                        f"Patient {existing.get('patient_name','')} — {final_date} at {final_time}. Tap to start.",
                        doctor_data,
                    )
                    await create_notification(
                        user_id=o.get("user_id"),
                        phone=o.get("phone"),
                        email=o.get("email"),
                        title="Video room ready · join as host 🎥",
                        body=(
                            f"Video consultation with {existing.get('patient_name','')} "
                            f"({existing.get('patient_phone','')}) on {final_date} at "
                            f"{final_time}.\n\nTap to open the host room inside ConsultUro. "
                            f"Host link: {doctor_url}"
                        ),
                        kind="booking",
                        data={**doctor_data, "kind": "video_room_ready"},
                        push=False,
                    )
                except Exception:
                    continue
        except Exception:
            pass

    # Owner-facing breadcrumb so the doctor knows the room was minted.
    try:
        await notify_telegram(
            "🎥 <b>Video room auto-provisioned</b>\n"
            f"👤 {htmllib.escape(existing.get('patient_name',''))} — "
            f"{htmllib.escape(existing.get('patient_phone',''))}\n"
            f"🆔 <code>{booking_id}</code>\n"
            f"🔗 doctor: {room.get('doctor_url','')}"
        )
    except Exception:
        pass


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
    reg_no = await get_or_set_reg_no(
        payload.patient_phone,
        payload.registration_no,
        payload.patient_name,
        email=getattr(payload, "patient_email", None),
    )
    # Phase D — canonical patient registry id (indexed history joins).
    from services.patient_registry import resolve_patient_id
    booking_patient_id = await resolve_patient_id(
        payload.patient_phone, getattr(payload, "patient_email", None), payload.patient_name
    )
    # Phase E — tag the booking with the active clinic so /bookings/all
    # filters cleanly. Anonymous bookings (no user) inherit the clinic
    # from the X-Clinic-Id header (set by the public /c/<slug> page);
    # if missing we leave it null so it stays globally visible until
    # a clinic claims it.
    booking_clinic_id = await resolve_clinic_id(request, user)
    # 2026-05-29 fix — Online appointments not syncing: anonymous public
    # bookings (e.g. patient submitting from /book on a freshly opened
    # browser with no clinic context) were landing with clinic_id=null
    # and therefore disappeared from the staff /bookings/all view (which
    # is clinic-scoped). Fall back to the system's only/default clinic
    # so single-tenant deploys (the common case) just work. Multi-tenant
    # deploys MUST send X-Clinic-Id on the public booking page.
    #
    # 2026-06-18 hardening — when more than one active clinic exists
    # (e.g. a left-over test clinic from a platform-reset run),
    # the simple `count == 1` check fails and the booking still
    # silently lands as orphaned. We now prefer the *primary* clinic
    # of the first owner, then any clinic that has bookings already
    # (most-active wins), and only give up if truly ambiguous.
    if not booking_clinic_id:
        try:
            active_clinics = await db.clinics.find(
                {"deleted_at": None}, {"_id": 0, "clinic_id": 1, "name": 1}
            ).to_list(length=10)
            if len(active_clinics) == 1:
                booking_clinic_id = active_clinics[0].get("clinic_id")
            elif len(active_clinics) > 1:
                # Heuristic 1 — pick the clinic that has any primary_owner.
                owner_membership = await db.clinic_memberships.find_one(
                    {"role": {"$in": ["primary_owner", "owner"]}},
                    sort=[("created_at", 1)],
                )
                if owner_membership and owner_membership.get("clinic_id"):
                    booking_clinic_id = owner_membership["clinic_id"]
                else:
                    # Heuristic 2 — pick the clinic with the most existing
                    # bookings (the "real" tenant in a noisy dev DB).
                    most_active = await db.bookings.aggregate([
                        {"$match": {"clinic_id": {"$ne": None}}},
                        {"$group": {"_id": "$clinic_id", "n": {"$sum": 1}}},
                        {"$sort": {"n": -1}},
                        {"$limit": 1},
                    ]).to_list(length=1)
                    if most_active:
                        booking_clinic_id = most_active[0]["_id"]
            # Telemetry — never silently swallow a clinic-id miss.
            if not booking_clinic_id:
                print(
                    f"[bookings] WARNING: booking created with clinic_id=None — "
                    f"phone={payload.patient_phone} name={payload.patient_name} "
                    f"active_clinics={len(active_clinics)}"
                )
        except Exception as _e:
            print(f"[bookings] clinic fallback failed: {_e}")

    # ── Item 6 fix (2026-05-29): "user_id" must point at the PATIENT,
    # not the booking creator. Previously, when a staff member booked
    # on behalf of a patient, this field stored the staff's user_id
    # → patient never got the confirmation push and couldn't see the
    # booking under "My bookings". We now resolve the patient's
    # registered profile (if any) by phone OR email and store its
    # user_id here. The actual creator is preserved separately in the
    # new `created_by` field for audit/receipts.
    patient_user_id: Optional[str] = None
    creator_user_id: Optional[str] = user["user_id"] if user else None
    creator_role: Optional[str] = (user.get("role") if user else None)
    # The creator is the patient themselves only if they're a regular
    # patient AND their phone/email match what's being booked. For all
    # staff/owner roles, we always do a lookup to be safe.
    is_self_booking = bool(
        user
        and user.get("role") in (None, "patient", "")
        and (
            (user.get("phone") and payload.patient_phone and user["phone"] == payload.patient_phone)
            or (user.get("email") and getattr(payload, "patient_email", None) and user["email"] == payload.patient_email)
        )
    )
    if is_self_booking:
        patient_user_id = creator_user_id
    else:
        # Staff booking on behalf, OR anonymous booking. Try to find an
        # existing patient profile by phone or email.
        lookup_or = []
        if payload.patient_phone:
            lookup_or.append({"phone": payload.patient_phone})
        if getattr(payload, "patient_email", None):
            lookup_or.append({"email": payload.patient_email})
        if lookup_or:
            existing_patient = await db.users.find_one(
                {"$or": lookup_or, "role": {"$nin": list(OWNER_TIER_ROLES) + ["doctor", "assistant", "reception", "nursing"]}},
                {"user_id": 1, "_id": 0},
            )
            if existing_patient:
                patient_user_id = existing_patient.get("user_id")
        # If still not found, patient_user_id stays None — the booking
        # is "unclaimed" until the patient signs up; at that point the
        # auth flow back-fills user_id by phone/email match.

    doc = {
        "booking_id": booking_id,
        "user_id": patient_user_id,        # PATIENT (for "My bookings" + push)
        "created_by": creator_user_id,     # STAFF/OWNER who booked (audit)
        "created_by_role": creator_role,   # role at time of booking
        "clinic_id": booking_clinic_id,
        "patient_name": payload.patient_name,
        "patient_phone": payload.patient_phone,
        "country_code": (payload.country_code or "+91").strip(),
        "patient_age": payload.patient_age,
        "patient_gender": payload.patient_gender,
        "registration_no": reg_no,
        "patient_id": booking_patient_id,
        "reason": payload.reason,
        "booking_date": payload.booking_date,
        "booking_time": payload.booking_time,
        "original_date": payload.booking_date,
        "original_time": payload.booking_time,
        "mode": payload.mode,
        # Channel for online bookings: "in_app" (default — triggers HMS
        # auto-provision so patient can join in-app) or "whatsapp" (no
        # HMS room; clinic places a WhatsApp video call).
        "online_channel": (
            (payload.online_channel or "in_app") if payload.mode == "online" else None
        ),
        "status": "requested",
        "confirmed_by": None,
        "confirmed_at": None,
        "patient_notified_at": None,
        # Pending-offline payment marker — staff sets this when booking
        # on behalf of a patient over the phone. Backend stores
        # `payment_status="pending_offline"` so the UI can show a
        # "Mark as paid" button on the day of the visit. Patient-
        # initiated bookings ignore the flag.
        "payment_status": (
            "pending_offline"
            if (creator_user_id and bool(getattr(payload, "pending_offline", False)))
            else None
        ),
        "created_at": datetime.now(timezone.utc),
    }
    await db.bookings.insert_one(doc)

    # Refer-a-Patient — if the booking carries a referral code (set by
    # the booking flow when the patient landed via `?ref=<CODE>`), wire
    # the attribution to this booking so the dashboard tracks it.
    # Best-effort; never blocks booking creation.
    try:
        ref_code = (getattr(payload, "ref_code", "") or "").strip()
        if ref_code:
            from routers.referrals import attribute, AttributeBody
            await attribute(AttributeBody(
                code=ref_code,
                phone=payload.patient_phone,
                name=payload.patient_name,
                source=(getattr(payload, "ref_source", "") or "link"),
                booking_id=booking_id,
            ))
    except Exception:
        pass

    if payload.mode == "online":
        if (payload.online_channel or "in_app") == "whatsapp":
            mode_label = "Online (WhatsApp video)"
        else:
            mode_label = "Online (In-App video)"
    else:
        mode_label = "In-person"
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
    # Merge by user_id OR by phone number so guests who later sign in
    # see their full booking history regardless of which channel created
    # the booking (staff-on-behalf, anonymous, self-served).
    #
    # Sync bug 2026-06-18 — staff-created bookings stored
    # `patient_phone` as the raw 10-digit number, while the patient
    # signed in with "+91 98xxxxx" and the user doc's `phone` field
    # carried the country-prefixed form. Result: the $or arm matched
    # by `patient_phone` never fired and the patient saw an empty
    # "My bookings" list. Fix: also match on the last-10-digit
    # canonical form via a precomputed `patient_phone_e164` field OR
    # by issuing a regex match on the last 10 digits.
    email_phones = await db.users.find(
        {"user_id": user["user_id"]}, {"_id": 0, "phone": 1}
    ).to_list(length=1)
    raw_phone = (email_phones[0].get("phone") if email_phones else None) or None
    last10 = re.sub(r"\D", "", raw_phone or "")[-10:] if raw_phone else ""

    or_clauses: List[Dict[str, Any]] = [{"user_id": user["user_id"]}]
    if raw_phone:
        or_clauses.append({"patient_phone": raw_phone})
    if last10 and len(last10) == 10:
        # Loose-but-anchored match: any phone whose last 10 digits
        # match — handles "+91 98xxx", "919xxx", "98xxx" all alike.
        or_clauses.append({"patient_phone": {"$regex": last10 + r"$"}})

    q = {"$or": or_clauses}
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


@router.get("/api/bookings/pending-payments")
async def pending_payment_bookings(request: Request, user=Depends(require_staff)):
    """Confirmed bookings whose payment is outstanding (payment_status
    is 'pending_offline' OR not set / blank). Powers the "Pending
    payments" tab in Billing & Receipts so staff can settle these
    bookings without leaving the billing module.

    Filters:
      • status ∈ {confirmed}              — only confirmed bookings need money
      • payment_status ∈ {pending_offline, null, ""}  — actually outstanding
      • paid_offline ≠ True                — already settled by other staff
    """
    clinic_id = await resolve_clinic_id(request, user)
    base: Dict[str, Any] = tenant_filter(user, clinic_id, allow_global=True)
    q: Dict[str, Any] = {
        **base,
        "status": "confirmed",
        "$or": [
            {"payment_status": "pending_offline"},
            {"payment_status": {"$exists": False}},
            {"payment_status": None},
            {"payment_status": ""},
        ],
        "paid_offline": {"$ne": True},
    }
    cursor = db.bookings.find(
        q,
        {
            "_id": 0,
            "booking_id": 1,
            "patient_name": 1,
            "patient_phone": 1,
            "patient_email": 1,
            "patient_age": 1,
            "patient_gender": 1,
            "registration_no": 1,
            "booking_date": 1,
            "booking_time": 1,
            "reason": 1,
            "service_type": 1,
            "status": 1,
            "payment_status": 1,
            "amount_inr": 1,
            "created_at": 1,
        },
    ).sort("booking_date", -1)
    rows = await cursor.to_list(length=200)
    # Fill in the expected amount from clinic settings if the booking
    # didn't carry one (legacy bookings).
    try:
        settings = await db.clinic_settings.find_one(
            {"_id": clinic_id or "default"}, {"_id": 0}
        ) or {}
        if not settings and clinic_id:
            settings = await db.clinic_settings.find_one(
                {"_id": "default"}, {"_id": 0}
            ) or {}
    except Exception:
        settings = {}
    default_fee = float(settings.get("consultation_fee_inr") or 500)
    follow_fee = float(settings.get("follow_up_fee_inr") or default_fee)
    video_fee = float(settings.get("video_consultation_fee_inr") or default_fee)
    for r in rows:
        amt = r.get("amount_inr")
        if not amt or float(amt) <= 0:
            st = (r.get("service_type") or "").lower()
            if "video" in st or "tele" in st:
                r["amount_inr"] = video_fee
            elif "follow" in st:
                r["amount_inr"] = follow_fee
            else:
                r["amount_inr"] = default_fee
    return rows


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
            phone=existing.get("patient_phone"),
            email=existing.get("patient_email"),
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

        # ── Auto-provision 100ms video room when this is a video
        # booking and clinic_settings.video.auto_provision_on_confirm
        # is enabled. Failure here MUST NOT block the confirmation —
        # the doctor can always provision manually via the booking
        # detail screen.
        await _maybe_auto_provision_video(
            booking_id=booking_id,
            existing=existing,
            final_date=final_date,
            final_time=final_time,
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
            phone=existing.get("patient_phone"),
            email=existing.get("patient_email"),
            title="Visit marked complete",
            body=(
                (f"{note_line}\n" if note_line else "")
                + f"Thank you for visiting Dr. Sagar Joshi on {final_date}. Your prescription (if any) will appear shortly."
            ),
            kind="booking",
            data={"booking_id": booking_id, "status": "completed"},
            push=False,
        )
        # Google review auto-nudge (Phase 5 — June 2026). Best-effort,
        # NEVER blocks the booking status update.
        try:
            from services.review_request import schedule_review_request
            await schedule_review_request(
                trigger="booking_completed",
                user_id=existing.get("user_id"),
                patient_name=existing.get("patient_name"),
                phone=existing.get("patient_phone"),
                email=existing.get("patient_email"),
                source_id=booking_id,
                clinic_id=existing.get("clinic_id"),
            )
        except Exception:
            pass
        # Refer-a-Patient auto-flip (Phase 5 — June 2026). When this
        # booking is attributed to a referrer, mark the referral as
        # "visited" so leaderboard / counters stay in sync without
        # the owner having to touch anything. Best-effort.
        try:
            from routers.referrals import auto_mark_visited_on_booking_complete
            await auto_mark_visited_on_booking_complete(booking_id)
        except Exception:
            pass
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
            phone=existing.get("patient_phone"),
            email=existing.get("patient_email"),
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
            phone=existing.get("patient_phone"),
            email=existing.get("patient_email"),
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
            phone=existing.get("patient_phone"),
            email=existing.get("patient_email"),
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
            phone=existing.get("patient_phone"),
            email=existing.get("patient_email"),
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



# ─── Offline payment recording ─────────────────────────────────────
@router.post("/api/bookings/{booking_id}/mark-paid-offline")
async def mark_booking_paid_offline(
    booking_id: str,
    body: Dict[str, Any] = Body(default={}),
    user=Depends(get_current_user),
):
    """Staff records a cash/UPI/card payment collected in person.

    Body (all optional):
      - amount_inr  — defaults to clinic_settings.consultation_fee_inr
      - mode        — 'cash' | 'upi' | 'card' | 'other' (default 'cash')
      - notes       — free text shown on receipt

    Owner-tier / staff with `can_manage_billing` may flip the booking
    payment status. Patients can NOT call this (they pay online).
    """
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    role = user.get("role")
    is_owner = role in {"super_owner", "primary_owner", "owner", "partner"}
    if not (is_owner or bool(user.get("can_manage_billing")) or bool(user.get("can_approve_bookings"))):
        raise HTTPException(status_code=403, detail="Billing permission required")
    existing = await db.bookings.find_one({"booking_id": booking_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Booking not found")
    if (existing.get("payment_status") or "").lower() == "paid":
        return existing  # idempotent — already paid
    try:
        amount_inr = float(body.get("amount_inr") or 0)
    except Exception:
        amount_inr = 0.0
    if amount_inr <= 0:
        # Pull the default consultation fee from clinic settings.
        try:
            settings = await db.clinic_settings.find_one({"_id": "default"}, {"_id": 0}) or {}
            amount_inr = float(settings.get("consultation_fee_inr") or 500)
        except Exception:
            amount_inr = 500.0
    mode_str = (body.get("mode") or "cash").strip().lower()
    # Accept the new Razorpay-tagged + UPI-direct variants. The
    # canonical mode stored on the booking maps cleanly to one of the
    # 4 buckets the analytics screen tracks.
    if "upi" in mode_str:
        mode_str = "upi"
    elif "card" in mode_str or "wallet" in mode_str:
        mode_str = "card"
    elif "cash" in mode_str:
        mode_str = "cash"
    elif mode_str not in {"cash", "upi", "card", "other"}:
        mode_str = "other"
    notes = (body.get("notes") or "").strip()[:240]
    now = datetime.now(timezone.utc)
    await db.bookings.update_one(
        {"booking_id": booking_id},
        {"$set": {
            "payment_status": "paid",
            "paid_amount_inr": amount_inr,
            "payment_mode": mode_str,
            "paid_offline": True,
            "paid_offline_by": user.get("user_id"),
            "paid_offline_by_name": user.get("name"),
            "paid_offline_notes": notes,
            "paid_at": now,
        }},
    )
    # Audit trail.
    try:
        await db.audit_log.insert_one({
            "ts": now,
            "kind": "booking_marked_paid_offline",
            "booking_id": booking_id,
            "amount_inr": amount_inr,
            "mode": mode_str,
            "actor_email": (user.get("email") or "").lower(),
        })
    except Exception:
        pass
    doc = await db.bookings.find_one({"booking_id": booking_id}, {"_id": 0})
    return doc


@router.post("/api/bookings/{booking_id}/mark-payment-pending")
async def mark_booking_payment_pending(
    booking_id: str,
    user=Depends(get_current_user),
):
    """Staff flips an already-confirmed booking back to
    pending_offline (e.g. they recorded a paid status by mistake).

    Reverses `mark-paid-offline` only — does NOT touch real Razorpay
    payments. Owner-tier / billing-permitted users only.
    """
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    role = user.get("role")
    is_owner = role in {"super_owner", "primary_owner", "owner", "partner"}
    if not (is_owner or bool(user.get("can_manage_billing"))):
        raise HTTPException(status_code=403, detail="Billing permission required")
    existing = await db.bookings.find_one({"booking_id": booking_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Booking not found")
    # Refuse to undo a real Razorpay payment — those are linked to a
    # payment_id and must be refunded properly.
    if existing.get("paid_offline") is not True and (existing.get("payment_status") or "").lower() == "paid":
        raise HTTPException(
            status_code=400,
            detail="This booking was paid online via Razorpay. Use the refund flow instead.",
        )
    await db.bookings.update_one(
        {"booking_id": booking_id},
        {"$set": {
            "payment_status": "pending_offline",
            "paid_offline": False,
        }, "$unset": {
            "paid_amount_inr": "",
            "payment_mode": "",
            "paid_offline_by": "",
            "paid_offline_by_name": "",
            "paid_offline_notes": "",
            "paid_at": "",
        }},
    )
    doc = await db.bookings.find_one({"booking_id": booking_id}, {"_id": 0})
    return doc
