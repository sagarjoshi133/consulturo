"""ConsultUro — Video consultation router (100ms integration).

Endpoints:
  POST /api/video/bookings/{booking_id}/room
        Idempotently create-or-fetch the 100ms room for a booking.
        Returns doctor + patient join URLs.

  GET  /api/video/bookings/{booking_id}/room
        Read-only — returns the existing room (404 if not provisioned).

  GET  /api/video/bookings/{booking_id}/room/status
        Live status: participant count, recording flag (polled by UI
        every ~10s while a room is open).

  GET  /api/video/health
        Reports whether 100ms env is configured. Used by the frontend
        to decide whether to show the "Start Video Call" button.

  GET  /api/video/settings
  PUT  /api/video/settings
        Clinic-wide preferences (auto-provision on confirm, default
        camera/mic state, allowed-join-window minutes, etc.).

Auth model:
  • Doctors (staff role) can provision rooms and get the doctor URL.
  • Patients can fetch the room their booking is attached to and get
    the patient URL only. They are never shown the doctor URL.
"""
from __future__ import annotations

from typing import Any, Dict, List

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth_deps import OWNER_TIER_ROLES, get_current_user
from db import db
from services import hms

router = APIRouter()


def _is_staff(user: Dict[str, Any] | None) -> bool:
    if not user:
        return False
    return user.get("role") in (OWNER_TIER_ROLES | {"doctor"})


async def _load_booking(booking_id: str) -> Dict[str, Any]:
    doc = await db.bookings.find_one({"booking_id": booking_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Booking not found")
    return doc


def _can_user_join(user: Dict[str, Any] | None, booking: Dict[str, Any]) -> bool:
    """Patient or staff associated with the booking may join."""
    if _is_staff(user):
        return True
    if not user:
        return False
    uid = user.get("user_id") or user.get("id")
    if uid and booking.get("user_id") == uid:
        return True
    # Last-resort fallback for guest-booking flows where the booking
    # carries only the phone number (no user_id linkage).
    phone = (user.get("phone") or "").strip()
    if phone and booking.get("patient_phone", "").endswith(phone[-10:]):
        return True
    return False


@router.get("/api/video/health")
async def video_health() -> Dict[str, Any]:
    return {
        "configured": hms.is_configured(),
        "template_id_set": bool(hms.HMS_TEMPLATE_ID),
        "region": hms.HMS_REGION,
    }


@router.post("/api/video/bookings/{booking_id}/room")
async def provision_room(booking_id: str, user=Depends(get_current_user)) -> Dict[str, Any]:
    if not hms.is_configured():
        raise HTTPException(503, "Video consultations not configured — contact admin.")
    if not _is_staff(user):
        raise HTTPException(403, "Only the doctor / clinic staff can provision a video room.")

    booking = await _load_booking(booking_id)
    existing = booking.get("video_room") or {}
    # Idempotent: if a room already exists, just return it.
    if existing.get("room_id") and existing.get("doctor_url") and existing.get("patient_url"):
        return {**existing, "reused": True}

    room = await hms.create_consultation_room(
        booking_id=booking_id,
        patient_name=booking.get("patient_name", ""),
        doctor_name=(user.get("name") or "Dr Sagar Joshi"),
    )
    await db.bookings.update_one(
        {"booking_id": booking_id},
        {"$set": {"video_room": room, "mode": "video"}},
    )
    return {**room, "reused": False}


@router.get("/api/video/bookings/{booking_id}/room")
async def get_room(booking_id: str, user=Depends(get_current_user)) -> Dict[str, Any]:
    booking = await _load_booking(booking_id)
    if not _can_user_join(user, booking):
        raise HTTPException(403, "Not allowed to access this video room.")
    room = booking.get("video_room") or {}
    if not room.get("room_id"):
        raise HTTPException(404, "Video room not provisioned yet for this booking.")
    if _is_staff(user):
        # Doctor sees the full payload (both URLs — so they can re-share)
        return {**room, "is_staff": True}
    # Patient view: hide the doctor URL so the patient can't accidentally
    # share the doctor link with anyone else.
    return {
        "room_id": room.get("room_id"),
        "patient_url": room.get("patient_url"),
        "created_at_unix": room.get("created_at_unix"),
        "is_staff": False,
    }



# ─── Live room status ───────────────────────────────────────────
@router.get("/api/video/bookings/{booking_id}/room/status")
async def room_status(booking_id: str, user=Depends(get_current_user)) -> Dict[str, Any]:
    """Live status for the staff in-app console — polled every ~10s
    while the room card is open. Returns the participant count, the
    "doctor connected" / "patient connected" flags, and whether a
    recording is in progress.

    Quietly degrades to {participants: 0, …} if the 100ms API is
    momentarily unreachable so the polling loop doesn't crash the UI.
    """
    if not _is_staff(user):
        raise HTTPException(403, "Staff only.")
    booking = await _load_booking(booking_id)
    room = booking.get("video_room") or {}
    room_id = room.get("room_id") or ""
    if not room_id:
        raise HTTPException(404, "Video room not provisioned yet.")

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(
                f"{hms.HMS_API_BASE}/active-rooms/{room_id}",
                headers={"Authorization": f"Bearer {hms.management_token()}"},
            )
        if r.status_code == 404:
            # Room exists but has no active session right now.
            return {
                "room_id": room_id,
                "active": False,
                "participants": 0,
                "doctor_connected": False,
                "patient_connected": False,
                "recording": False,
                "session_id": None,
            }
        if r.status_code >= 400:
            return {"room_id": room_id, "active": False, "participants": 0, "error": r.text[:200]}
        data = r.json() or {}
    except Exception as e:
        return {"room_id": room_id, "active": False, "participants": 0, "error": str(e)[:200]}

    # Parse role-aware counts
    peers: List[Dict[str, Any]] = data.get("peers") or []
    doctor = any(p.get("role") == "doctor" for p in peers)
    patient = any(p.get("role") == "patient" for p in peers)
    recording = bool((data.get("recording") or {}).get("enabled"))

    return {
        "room_id": room_id,
        "active": True,
        "participants": len(peers),
        "doctor_connected": doctor,
        "patient_connected": patient,
        "recording": recording,
        "session_id": data.get("session_id"),
        "session_started_at": data.get("session_started_at"),
    }


# ─── Clinic-wide video settings ─────────────────────────────────
class VideoSettings(BaseModel):
    """Clinic-wide preferences that influence how ConsultUro behaves
    around video consultations. Stored in `clinic_settings.video`."""

    auto_provision_on_confirm: bool = Field(
        True,
        description="When a video booking is confirmed, immediately "
        "create the 100ms room so the patient receives the join link "
        "in the confirmation message.",
    )
    auto_notify_patient: bool = Field(
        True,
        description="On provision, automatically send the patient a "
        "WhatsApp / push message with their join link.",
    )
    default_mic_on: bool = Field(False, description="Patient joins with mic ON by default.")
    default_camera_on: bool = Field(True, description="Patient joins with camera ON by default.")
    waiting_room: bool = Field(
        True,
        description="Patient lands in a clinic-branded waiting screen "
        "until the doctor admits them.",
    )
    auto_record: bool = Field(
        False,
        description="Recommended OFF unless patient has explicitly "
        "consented. Recordings are stored in 100ms cloud.",
    )
    allow_join_minutes_before: int = Field(
        15, ge=0, le=180,
        description="Patient join link is active this many minutes "
        "before the appointment time.",
    )
    allow_join_minutes_after: int = Field(
        60, ge=0, le=360,
        description="And this many minutes after — gives leeway if "
        "the consult runs over.",
    )
    pre_call_reminder_minutes: int = Field(
        5, ge=0, le=120,
        description="Send a WhatsApp / push reminder this many minutes "
        "before the appointment.",
    )
    show_clinic_branding: bool = Field(
        True,
        description="Show ConsultUro + doctor + clinic branding in the "
        "in-app waiting room.",
    )
    # ── Bundle A+B+C+D (2026-05-31) ─────────────────────────────────
    enable_precall_intake: bool = Field(
        True,
        description="Show the patient a vitals + symptoms form before "
        "joining the call. Visible to the doctor on the staff console.",
    )
    no_show_grace_minutes: int = Field(
        15, ge=0, le=180,
        description="Auto-mark a video booking 'no_show' if the patient "
        "never joined this many minutes after the scheduled start.",
    )
    enable_post_call_feedback: bool = Field(
        True,
        description="Ask the patient for a 1-tap 5-star rating + "
        "comment after the call ends.",
    )
    # ── G: Recording consent + auto-summary ────────────────────────
    enable_recording_consent: bool = Field(
        False,
        description="Show the patient an explicit consent screen "
        "before joining when auto-record is enabled. Recording will "
        "ONLY start after the patient taps 'I consent'.",
    )
    enable_auto_summary: bool = Field(
        True,
        description="Show a 'Generate post-call summary' button on "
        "the staff console. Uses Gemini to draft a SOAP note + "
        "follow-up WhatsApp message from the call notes + intake.",
    )
    # ── E + F + I: workflow accelerators ─────────────────────────
    enable_rx_draft: bool = Field(
        True,
        description="Show 'Generate Rx draft' on the post-call summary "
        "card. Uses Gemini to pre-fill a Prescription form (doctor "
        "MUST review before signing).",
    )
    enable_queue_position: bool = Field(
        True,
        description="Show the patient their queue position ('You are "
        "#2 in line, est wait 8 min') while waiting for the doctor.",
    )
    enable_attachments: bool = Field(
        True,
        description="Let patient & doctor upload reports / images "
        "before or during the call. Stored on the booking.",
    )


DEFAULT_VIDEO_SETTINGS = VideoSettings().model_dump()


async def _get_settings_doc(clinic_id: str | None = None) -> Dict[str, Any]:
    cs = await db.clinic_settings.find_one({}, {"_id": 0}) or {}
    return cs


@router.get("/api/video/settings")
async def get_video_settings(user=Depends(get_current_user)) -> Dict[str, Any]:
    if not _is_staff(user):
        raise HTTPException(403, "Staff only.")
    cs = await _get_settings_doc()
    video = (cs.get("video") or {})
    merged = {**DEFAULT_VIDEO_SETTINGS, **video}
    return {"settings": merged, "domain": hms.HMS_PREBUILT_DOMAIN, "region": hms.HMS_REGION}


@router.put("/api/video/settings")
async def update_video_settings(payload: VideoSettings, user=Depends(get_current_user)) -> Dict[str, Any]:
    # Restrict mutation to owner-tier roles — doctors don't need to
    # change clinic-wide policy ad hoc.
    if user.get("role") not in OWNER_TIER_ROLES:
        raise HTTPException(403, "Only the owner / super-owner can change clinic video settings.")
    new_settings = payload.model_dump()
    await db.clinic_settings.update_one(
        {},
        {"$set": {"video": new_settings}},
        upsert=True,
    )
    return {"settings": new_settings, "domain": hms.HMS_PREBUILT_DOMAIN}


# ─── Bundle A+B+C+D (2026-05-31) ────────────────────────────────────
# A. Pre-call vitals + symptom intake (patient → staff console)
# B. No-show / late-arrival auto-detection — `mark_joined` endpoint
#    powers it; the cron in server.py reads `joined_at`.
# C. Post-call patient feedback (rating + comment)
# D. One-tap "re-send join link" for the staff console
# ───────────────────────────────────────────────────────────────────


class PreCallVitals(BaseModel):
    """Optional self-reported vitals + chief complaint that the
    patient fills BEFORE joining a video consultation. Everything is
    optional — empty / null fields are simply not displayed to the
    doctor.
    """
    bp_systolic: int | None = Field(None, ge=40, le=300)
    bp_diastolic: int | None = Field(None, ge=20, le=200)
    pulse: int | None = Field(None, ge=20, le=250)
    temperature_c: float | None = Field(None, ge=30.0, le=45.0)
    spo2: int | None = Field(None, ge=50, le=100)
    weight_kg: float | None = Field(None, ge=10.0, le=400.0)
    chief_complaint: str | None = Field(None, max_length=500)
    duration: str | None = Field(None, max_length=120)
    symptoms: List[str] = Field(default_factory=list, max_length=20)
    notes: str | None = Field(None, max_length=1500)


@router.post("/api/video/bookings/{booking_id}/precall")
async def save_precall_intake(
    booking_id: str,
    payload: PreCallVitals,
    user=Depends(get_current_user),
) -> Dict[str, Any]:
    """Patient (or staff acting on their behalf) submits the pre-call
    vitals / symptoms form. Idempotent — overwrites any earlier
    submission for the same booking.
    """
    booking = await _load_booking(booking_id)
    if not _can_user_join(user, booking):
        raise HTTPException(403, "Not allowed to update this booking.")
    from datetime import datetime, timezone  # local import — small file
    data = payload.model_dump()
    data["symptoms"] = [s.strip() for s in (data.get("symptoms") or []) if (s or "").strip()]
    data["submitted_at"] = datetime.now(timezone.utc)
    data["submitted_by"] = user.get("user_id") or user.get("id")
    await db.bookings.update_one(
        {"booking_id": booking_id},
        {"$set": {"precall_intake": data}},
    )
    return {"ok": True, "precall_intake": data}


@router.get("/api/video/bookings/{booking_id}/precall")
async def get_precall_intake(
    booking_id: str,
    user=Depends(get_current_user),
) -> Dict[str, Any]:
    booking = await _load_booking(booking_id)
    if not (_is_staff(user) or _can_user_join(user, booking)):
        raise HTTPException(403, "Not allowed to access this booking.")
    return {"precall_intake": booking.get("precall_intake") or {}}


@router.post("/api/video/bookings/{booking_id}/joined")
async def mark_patient_joined(
    booking_id: str,
    user=Depends(get_current_user),
) -> Dict[str, Any]:
    """Patient taps "Join now" → frontend hits this BEFORE mounting
    the WebView. Powers the no-show auto-detection cron: a booking
    with `patient_joined_at` set is exempt from the no-show sweep.
    """
    from datetime import datetime, timezone
    booking = await _load_booking(booking_id)
    if not _can_user_join(user, booking):
        raise HTTPException(403, "Not allowed to access this booking.")
    now = datetime.now(timezone.utc)
    await db.bookings.update_one(
        {"booking_id": booking_id},
        {"$set": {
            "video_room.patient_joined_at": now,
            "no_show_at": None,
        }},
    )
    return {"ok": True, "joined_at": now.isoformat()}


class CallFeedback(BaseModel):
    rating: int = Field(..., ge=1, le=5)
    comment: str | None = Field(None, max_length=1000)
    call_quality: int | None = Field(None, ge=1, le=5)


@router.post("/api/video/bookings/{booking_id}/feedback")
async def submit_call_feedback(
    booking_id: str,
    payload: CallFeedback,
    user=Depends(get_current_user),
) -> Dict[str, Any]:
    """Patient rates the consult right after they leave the room.
    One submission per booking — re-submitting overwrites. Triggers
    a Telegram alert to the doctor when rating ≤ 3 so unhappy
    patients can be reached out to immediately.
    """
    from datetime import datetime, timezone
    booking = await _load_booking(booking_id)
    if not _can_user_join(user, booking):
        raise HTTPException(403, "Not allowed to rate this booking.")
    data = payload.model_dump()
    data["submitted_at"] = datetime.now(timezone.utc)
    data["submitted_by"] = user.get("user_id") or user.get("id")
    await db.bookings.update_one(
        {"booking_id": booking_id},
        {"$set": {"call_feedback": data}},
    )

    if data["rating"] <= 3:
        try:
            from server import notify_telegram, htmllib
            stars = "⭐" * data["rating"] + "☆" * (5 - data["rating"])
            comment_html = (
                f"\n💬 <i>{htmllib.escape((data.get('comment') or '').strip()[:300])}</i>"
                if data.get("comment") else ""
            )
            await notify_telegram(
                "⚠️ <b>LOW VIDEO-CONSULT RATING</b>\n"
                f"👤 <b>{htmllib.escape(booking.get('patient_name', ''))}</b> — "
                f"{htmllib.escape(booking.get('patient_phone', ''))}\n"
                f"🆔 <code>{booking_id}</code>\n"
                f"⭐ {stars}  ({data['rating']}/5)"
                f"{comment_html}"
            )
        except Exception:
            pass
    return {"ok": True, "feedback": data}


@router.get("/api/video/bookings/{booking_id}/feedback")
async def get_call_feedback(
    booking_id: str,
    user=Depends(get_current_user),
) -> Dict[str, Any]:
    booking = await _load_booking(booking_id)
    if not (_is_staff(user) or _can_user_join(user, booking)):
        raise HTTPException(403, "Not allowed.")
    return {"feedback": booking.get("call_feedback") or {}}


@router.post("/api/video/bookings/{booking_id}/reinvite")
async def reinvite_patient(
    booking_id: str,
    user=Depends(get_current_user),
) -> Dict[str, Any]:
    """Staff one-tap re-send of the patient join link. Useful when:
       • patient dropped mid-call,
       • patient never tapped the original WhatsApp message,
       • doctor wants to bump the patient who hasn't joined.
    """
    from datetime import datetime, timezone
    if not _is_staff(user):
        raise HTTPException(403, "Staff only.")
    booking = await _load_booking(booking_id)
    room = booking.get("video_room") or {}
    patient_url = room.get("patient_url") or ""
    doctor_url = room.get("doctor_url") or ""
    if not patient_url:
        raise HTTPException(
            404,
            "Video room not provisioned yet — start the call first to "
            "mint a room.",
        )

    from server import (
        _urlencode,
        create_notification,
        htmllib,
        notify_telegram,
        push_to_user,
    )
    import re as _re

    patient_name = (booking.get("patient_name") or "").strip() or "Patient"
    first_name = patient_name.split(" ")[0]
    patient_phone = (booking.get("patient_phone") or "").strip()
    patient_user_id = booking.get("user_id")
    final_date = booking.get("booking_date") or ""
    final_time = booking.get("booking_time") or ""

    body = (
        f"Hi {first_name}, here is your video consultation link "
        f"({final_date} {final_time}). Tap to join: {patient_url}\n\n"
        "If you were just disconnected, simply tap again — the doctor "
        "is waiting in the same room."
    )

    try:
        await create_notification(
            user_id=patient_user_id,
            phone=patient_phone or None,
            title="🎥 Video consult — please rejoin",
            body=body,
            kind="video_reinvite",
            data={
                "type": "video_reinvite",
                "booking_id": booking_id,
                "patient_url": patient_url,
            },
            push=True,
        )
    except Exception:
        pass
    if not patient_user_id and patient_phone:
        try:
            await push_to_user(
                None,
                patient_phone,
                "🎥 Video consult — please rejoin",
                body,
                {"type": "video_reinvite", "booking_id": booking_id, "patient_url": patient_url},
            )
        except Exception:
            pass

    try:
        digits = _re.sub(r"\D", "", patient_phone or "")
        wa_link = ""
        if digits:
            wa_digits = digits if len(digits) > 10 else ("91" + digits)
            wa_link = f"https://wa.me/{wa_digits}?text={_urlencode(body)}"
        msg = (
            "🔁 <b>VIDEO RE-INVITE</b>\n"
            f"👤 <b>{htmllib.escape(patient_name)}</b>\n"
            f"📞 {htmllib.escape(patient_phone or '—')}\n"
            f"🆔 <code>{booking_id}</code>\n"
            f"🔗 patient: {patient_url}\n"
            f"🔗 host:    {doctor_url}\n"
        )
        if wa_link:
            msg += f'<a href="{wa_link}">📲 Send WhatsApp to patient</a>'
        await notify_telegram(msg)
    except Exception:
        pass

    try:
        await db.bookings.update_one(
            {"booking_id": booking_id},
            {"$push": {
                "reinvite_log": {
                    "at": datetime.now(timezone.utc),
                    "by": user.get("user_id") or user.get("id"),
                }
            }},
        )
    except Exception:
        pass

    return {"ok": True, "patient_url": patient_url}


# ─── Bundle G+H (2026-05-31) ────────────────────────────────────────
# G. Call recording with explicit patient consent
# H. Auto post-call summary via Gemini (SOAP + WhatsApp follow-up)
# ───────────────────────────────────────────────────────────────────


class RecordingConsent(BaseModel):
    granted: bool


@router.post("/api/video/bookings/{booking_id}/recording/consent")
async def submit_recording_consent(
    booking_id: str,
    payload: RecordingConsent,
    user=Depends(get_current_user),
) -> Dict[str, Any]:
    """Patient grants or declines consent for this consultation to be
    recorded. Stored as `recording_consent` on the booking with a
    timestamp. The staff console can only start recording when this
    flag is True."""
    from datetime import datetime, timezone
    booking = await _load_booking(booking_id)
    if not _can_user_join(user, booking):
        raise HTTPException(403, "Not allowed.")
    now = datetime.now(timezone.utc)
    await db.bookings.update_one(
        {"booking_id": booking_id},
        {"$set": {
            "recording_consent": {
                "granted": bool(payload.granted),
                "at": now,
                "by": user.get("user_id") or user.get("id"),
            },
        }},
    )
    return {"ok": True, "granted": payload.granted}


@router.post("/api/video/bookings/{booking_id}/recording/start")
async def start_call_recording(
    booking_id: str,
    user=Depends(get_current_user),
) -> Dict[str, Any]:
    """Staff begins 100ms beam-recording for the active room. Refuses
    if the patient has not granted consent."""
    from datetime import datetime, timezone
    if not _is_staff(user):
        raise HTTPException(403, "Staff only.")
    booking = await _load_booking(booking_id)
    consent = (booking.get("recording_consent") or {})
    if not consent.get("granted"):
        raise HTTPException(
            400,
            "Patient has not consented to recording — ask them to "
            "tap 'I consent' on their pre-call screen first.",
        )
    room = booking.get("video_room") or {}
    room_id = room.get("room_id") or ""
    patient_url = room.get("patient_url") or ""
    if not room_id:
        raise HTTPException(404, "Video room not provisioned.")
    try:
        data = await hms.start_recording(room_id, meeting_url=patient_url)
    except Exception as e:
        raise HTTPException(502, f"100ms refused: {str(e)[:200]}")
    rec_id = data.get("id") or data.get("recording_id") or ""
    await db.bookings.update_one(
        {"booking_id": booking_id},
        {"$set": {
            "recording": {
                "recording_id": rec_id,
                "started_at": datetime.now(timezone.utc),
                "started_by": user.get("user_id") or user.get("id"),
                "status": "recording",
            },
        }},
    )
    return {"ok": True, "recording_id": rec_id}


@router.post("/api/video/bookings/{booking_id}/recording/stop")
async def stop_call_recording(
    booking_id: str,
    user=Depends(get_current_user),
) -> Dict[str, Any]:
    from datetime import datetime, timezone
    if not _is_staff(user):
        raise HTTPException(403, "Staff only.")
    booking = await _load_booking(booking_id)
    room = booking.get("video_room") or {}
    room_id = room.get("room_id") or ""
    if not room_id:
        raise HTTPException(404, "Video room not provisioned.")
    try:
        await hms.stop_recording(room_id)
    except Exception as e:
        # Surface but still mark the local row stopped so UI updates
        await db.bookings.update_one(
            {"booking_id": booking_id},
            {"$set": {"recording.status": "stop_failed", "recording.stop_error": str(e)[:200]}},
        )
        raise HTTPException(502, f"100ms refused: {str(e)[:200]}")
    await db.bookings.update_one(
        {"booking_id": booking_id},
        {"$set": {
            "recording.stopped_at": datetime.now(timezone.utc),
            "recording.status": "stopped",
        }},
    )
    return {"ok": True}


@router.get("/api/video/bookings/{booking_id}/recording")
async def get_recording(
    booking_id: str,
    user=Depends(get_current_user),
) -> Dict[str, Any]:
    """Returns current recording row + any available CDN-hosted assets
    discovered via 100ms's list-assets API. Recording files appear a
    few minutes after the room ends — caller can poll."""
    if not _is_staff(user):
        raise HTTPException(403, "Staff only.")
    booking = await _load_booking(booking_id)
    room = booking.get("video_room") or {}
    room_id = room.get("room_id") or ""
    assets: List[Dict[str, Any]] = []
    if room_id:
        try:
            assets = await hms.list_recording_assets(room_id)
        except Exception:
            assets = []
    return {
        "recording": booking.get("recording") or {},
        "consent": booking.get("recording_consent") or {},
        "assets": assets,
    }


# ─── H. Auto post-call summary via Gemini ────────────────────────


class SummaryRequest(BaseModel):
    doctor_notes: str | None = Field(None, max_length=4000)
    diagnosis_hint: str | None = Field(None, max_length=300)


@router.post("/api/video/bookings/{booking_id}/summary")
async def generate_call_summary(
    booking_id: str,
    payload: SummaryRequest,
    user=Depends(get_current_user),
) -> Dict[str, Any]:
    """Generate a SOAP-style post-call summary + a draft follow-up
    WhatsApp message via Gemini. Reads from the booking:
      • patient_name, age, sex (if present)
      • precall_intake (vitals + chief complaint + symptoms)
      • call_feedback (rating + comment)
      • doctor_notes / diagnosis_hint (from the request)

    Saves the result onto the booking as `auto_summary` so the next
    fetch returns it without re-billing the LLM.
    """
    from datetime import datetime, timezone
    import os
    if not _is_staff(user):
        raise HTTPException(403, "Staff only.")
    booking = await _load_booking(booking_id)

    emergent_key = os.environ.get("EMERGENT_LLM_KEY", "").strip()
    if not emergent_key:
        raise HTTPException(503, "LLM not configured — set EMERGENT_LLM_KEY.")

    # Build a structured prompt for the LLM
    pn = booking.get("patient_name") or "Patient"
    pa = booking.get("patient_age") or booking.get("age") or "?"
    ps = booking.get("patient_sex") or booking.get("sex") or "?"
    intake = booking.get("precall_intake") or {}

    def _maybe(k: str, label: str) -> str:
        v = intake.get(k)
        return f"  • {label}: {v}\n" if v else ""

    intake_block = ""
    if intake:
        intake_block = (
            "PRE-CALL INTAKE (patient-self-reported):\n"
            f"{_maybe('bp_systolic','BP sys')}{_maybe('bp_diastolic','BP dia')}"
            f"{_maybe('pulse','Pulse')}{_maybe('temperature_c','Temp °C')}"
            f"{_maybe('spo2','SpO₂')}{_maybe('weight_kg','Weight kg')}"
            f"  • Chief complaint: {intake.get('chief_complaint') or '—'}\n"
            f"  • Duration: {intake.get('duration') or '—'}\n"
            f"  • Symptoms: {', '.join(intake.get('symptoms') or []) or '—'}\n"
            f"  • Patient notes: {intake.get('notes') or '—'}\n"
        )

    notes_block = (
        f"\nDOCTOR'S CALL NOTES:\n{(payload.doctor_notes or '').strip() or '(none provided)'}\n"
    )
    hint_block = (
        f"\nDIAGNOSIS HINT (from doctor): {payload.diagnosis_hint}\n"
        if (payload.diagnosis_hint or "").strip() else ""
    )

    prompt = (
        f"You are a clinical scribe assisting Dr. Sagar Joshi, a urologist. "
        f"Generate a structured post-call summary for the consultation below.\n\n"
        f"PATIENT: {pn}  ·  Age: {pa}  ·  Sex: {ps}\n\n"
        f"{intake_block}{notes_block}{hint_block}\n"
        "Produce STRICTLY this JSON shape (no markdown, no commentary):\n"
        "{\n"
        '  "subjective": "1-3 short sentences describing complaint + history",\n'
        '  "objective":  "vitals + relevant exam findings if mentioned",\n'
        '  "assessment": "most-likely diagnosis + DDx (2-3 bullets joined by \';\')",\n'
        '  "plan":       "investigations, medications (generic class names only, NO doses), follow-up timing",\n'
        '  "red_flags":  "any red-flags to watch for (or empty string)",\n'
        '  "whatsapp_followup": "a friendly 80-120 word WhatsApp message in the patient\'s likely language (English unless their name/notes suggest Hindi/Gujarati) summarising the plan and giving clear next steps. Include a polite sign-off as Dr. Sagar Joshi\'s clinic."\n'
        "}\n\n"
        "RULES:\n"
        "  • NEVER include specific medicine doses — only generic drug classes (e.g. 'alpha-blocker', 'antibiotic per sensitivity').\n"
        "  • If information is missing, write 'Not documented' rather than inventing facts.\n"
        "  • Keep the JSON valid — escape quotes inside string values.\n"
    )

    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        chat = (
            LlmChat(
                api_key=emergent_key,
                session_id=f"summary-{booking_id}",
                system_message=(
                    "You are a meticulous clinical scribe. You produce only "
                    "valid JSON conforming exactly to the requested schema. "
                    "You never prescribe medicine doses."
                ),
            ).with_model("gemini", "gemini-2.5-pro")
        )
        raw = await chat.send_message(UserMessage(text=prompt))
        raw_text = raw if isinstance(raw, str) else str(raw or "")
    except Exception as e:
        raise HTTPException(502, f"LLM failed: {str(e)[:200]}")

    # Parse the JSON — strip code fences if the model wrapped it
    import json
    import re as _re
    cleaned = _re.sub(r"^```(?:json)?\s*|\s*```$", "", raw_text.strip(), flags=_re.MULTILINE)
    parsed: Dict[str, Any] = {}
    try:
        parsed = json.loads(cleaned)
    except Exception:
        # As a fallback, try to find the first {...} block
        m = _re.search(r"\{[\s\S]*\}", cleaned)
        if m:
            try:
                parsed = json.loads(m.group(0))
            except Exception:
                parsed = {"_raw": cleaned[:3000]}
        else:
            parsed = {"_raw": cleaned[:3000]}

    summary_doc = {
        **parsed,
        "generated_at": datetime.now(timezone.utc),
        "generated_by": user.get("user_id") or user.get("id"),
        "model": "gemini/gemini-2.5-pro",
    }
    await db.bookings.update_one(
        {"booking_id": booking_id},
        {"$set": {"auto_summary": summary_doc}},
    )
    return {"ok": True, "summary": summary_doc}


@router.get("/api/video/bookings/{booking_id}/summary")
async def get_call_summary(
    booking_id: str,
    user=Depends(get_current_user),
) -> Dict[str, Any]:
    if not _is_staff(user):
        raise HTTPException(403, "Staff only.")
    booking = await _load_booking(booking_id)
    return {"summary": booking.get("auto_summary") or {}}



# ─── Bundle E + F + I (2026-05-31) ──────────────────────────────────
# E. Auto-Rx draft from call notes (Gemini)
# F. Live waiting-room queue position
# I. In-call attachment sharing (base64 — proxy-safe)
# ───────────────────────────────────────────────────────────────────


# ─── E. Auto-Rx draft ──────────────────────────────────────────────

class RxDraftRequest(BaseModel):
    doctor_notes: str | None = Field(None, max_length=4000)
    diagnosis_hint: str | None = Field(None, max_length=300)


@router.post("/api/video/bookings/{booking_id}/rx-draft")
async def generate_rx_draft(
    booking_id: str,
    payload: RxDraftRequest,
    user=Depends(get_current_user),
) -> Dict[str, Any]:
    """Gemini-drafted Prescription pre-fill. Returns the parsed draft
    fields (diagnosis, complaints, advice, investigationsAdvised,
    followUp, meds[]) AND persists them onto the booking under
    `rx_draft` so /prescriptions/new can pick them up.

    SAFETY: The doctor MUST review and sign before sending — the
    response is clearly marked as a draft. We DO suggest doses here
    (unlike the post-call summary) because the prescription form is
    not auto-sent — it's a pre-fill the doctor edits.
    """
    from datetime import datetime, timezone
    import os
    if not _is_staff(user):
        raise HTTPException(403, "Staff only.")
    booking = await _load_booking(booking_id)

    emergent_key = os.environ.get("EMERGENT_LLM_KEY", "").strip()
    if not emergent_key:
        raise HTTPException(503, "LLM not configured.")

    pn = booking.get("patient_name") or "Patient"
    pa = booking.get("patient_age") or booking.get("age") or "?"
    ps = booking.get("patient_sex") or booking.get("sex") or "?"
    intake = booking.get("precall_intake") or {}

    # Build intake context
    intake_lines = []
    if intake.get("bp_systolic") or intake.get("bp_diastolic"):
        intake_lines.append(f"BP: {intake.get('bp_systolic')}/{intake.get('bp_diastolic')} mmHg")
    if intake.get("pulse"):
        intake_lines.append(f"Pulse: {intake['pulse']} bpm")
    if intake.get("temperature_c"):
        intake_lines.append(f"Temp: {intake['temperature_c']}°C")
    if intake.get("spo2"):
        intake_lines.append(f"SpO₂: {intake['spo2']}%")
    if intake.get("weight_kg"):
        intake_lines.append(f"Weight: {intake['weight_kg']} kg")
    intake_block = ""
    if intake_lines or intake.get("chief_complaint") or intake.get("symptoms"):
        intake_block = (
            "INTAKE:\n  " + " · ".join(intake_lines) + "\n"
            f"  Chief complaint: {intake.get('chief_complaint') or '—'}\n"
            f"  Symptoms: {', '.join(intake.get('symptoms') or []) or '—'}\n"
            f"  Patient notes: {intake.get('notes') or '—'}\n"
        )

    prompt = (
        f"You are a clinical scribe drafting a urology prescription for Dr. Sagar Joshi. "
        f"This is a DRAFT — the doctor will review and sign before issuing. So you MAY "
        f"include suggested doses & strengths.\n\n"
        f"PATIENT: {pn} · Age {pa} · Sex {ps}\n\n"
        f"{intake_block}\n"
        f"DOCTOR'S CALL NOTES:\n{(payload.doctor_notes or '').strip() or '(none)'}\n"
        f"DIAGNOSIS HINT: {(payload.diagnosis_hint or '').strip() or '(not provided)'}\n\n"
        "Produce STRICTLY this JSON shape (no markdown):\n"
        "{\n"
        '  "complaints":   "1-2 sentence chief-complaint summary",\n'
        '  "diagnosis":    "primary diagnosis (most likely)",\n'
        '  "investigationsAdvised": "comma-separated list of tests (urine R/M, USG KUB, uroflowmetry, PSA, etc.)",\n'
        '  "advice":       "lifestyle / hydration / diet / red-flag warnings",\n'
        '  "followUp":     "follow-up timing (e.g. \'after 2 weeks with reports\')",\n'
        '  "meds": [\n'
        '    {"name": "<INN/brand>", "strength": "<e.g. 500 mg>", "frequency": "<e.g. 1-0-1>", "duration": "<e.g. 5 days>", "instructions": "<e.g. after food>"}\n'
        "  ]\n"
        "}\n\n"
        "RULES:\n"
        "  • Use generic urology-relevant medicines (alpha-blockers, anticholinergics, "
        "    PDE5-inhibitors, antibiotics per typical sensitivity, alpha-reductase inhibitors).\n"
        "  • If antibiotic is needed, suggest a sensible empiric choice (e.g. Nitrofurantoin 100mg or Cefixime 200mg).\n"
        "  • Max 5 medicines. Skip the meds array entirely if no medicines indicated.\n"
        "  • Use Indian medication conventions (1-0-1 = morning-noon-night).\n"
        "  • If information is missing, write 'Review with patient' rather than inventing facts.\n"
        "  • Keep JSON valid — escape quotes inside strings.\n"
    )

    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        chat = (
            LlmChat(
                api_key=emergent_key,
                session_id=f"rx-{booking_id}",
                system_message=(
                    "You are a meticulous clinical scribe. You produce only valid JSON "
                    "matching the requested schema. The doctor reviews everything before signing."
                ),
            ).with_model("gemini", "gemini-2.5-flash")
        )
        raw = await chat.send_message(UserMessage(text=prompt))
        raw_text = raw if isinstance(raw, str) else str(raw or "")
    except Exception as e:
        raise HTTPException(502, f"LLM failed: {str(e)[:200]}")

    import json
    import re as _re
    cleaned = _re.sub(r"^```(?:json)?\s*|\s*```$", "", raw_text.strip(), flags=_re.MULTILINE)
    try:
        parsed = json.loads(cleaned)
    except Exception:
        m = _re.search(r"\{[\s\S]*\}", cleaned)
        parsed = json.loads(m.group(0)) if m else {"_raw": cleaned[:3000]}

    # Sanitise meds list (always an array of dicts with our fields)
    raw_meds = parsed.get("meds") if isinstance(parsed.get("meds"), list) else []
    meds = []
    for m in raw_meds[:5]:
        if not isinstance(m, dict):
            continue
        meds.append({
            "name": str(m.get("name") or "").strip()[:120],
            "strength": str(m.get("strength") or "").strip()[:60],
            "frequency": str(m.get("frequency") or "").strip()[:40],
            "duration": str(m.get("duration") or "").strip()[:40],
            "instructions": str(m.get("instructions") or "").strip()[:200],
        })

    draft = {
        "complaints": str(parsed.get("complaints") or "").strip()[:2000],
        "diagnosis": str(parsed.get("diagnosis") or "").strip()[:500],
        "investigationsAdvised": str(parsed.get("investigationsAdvised") or "").strip()[:1000],
        "advice": str(parsed.get("advice") or "").strip()[:2000],
        "followUp": str(parsed.get("followUp") or "").strip()[:200],
        "meds": meds,
        "generated_at": datetime.now(timezone.utc),
        "generated_by": user.get("user_id") or user.get("id"),
        "model": "gemini/gemini-2.5-flash",
        "is_draft": True,
    }

    await db.bookings.update_one(
        {"booking_id": booking_id},
        {"$set": {"rx_draft": draft}},
    )
    return {"ok": True, "rx_draft": draft}


@router.get("/api/video/bookings/{booking_id}/rx-draft")
async def get_rx_draft(
    booking_id: str,
    user=Depends(get_current_user),
) -> Dict[str, Any]:
    if not _is_staff(user):
        raise HTTPException(403, "Staff only.")
    booking = await _load_booking(booking_id)
    return {"rx_draft": booking.get("rx_draft") or {}}


# ─── F. Live waiting-room queue position ────────────────────────────


DEFAULT_AVG_CONSULT_MIN = 12


@router.get("/api/video/bookings/{booking_id}/queue-position")
async def queue_position(
    booking_id: str,
    user=Depends(get_current_user),
) -> Dict[str, Any]:
    """Count confirmed video bookings TODAY scheduled BEFORE this one
    where the patient hasn't been marked completed/no_show yet.

    Returns:
      • position (int)        — 1 = next in line (or being seen now)
      • ahead_of_you (int)    — patients ahead, excluding self
      • est_wait_minutes (int)
      • doctor_in_call (bool) — true if any video booking has
                                patient_joined_at within last 30 min
                                and not yet completed
    """
    from datetime import datetime, timezone
    booking = await _load_booking(booking_id)
    if not (_is_staff(user) or _can_user_join(user, booking)):
        raise HTTPException(403, "Not allowed.")

    b_date = (booking.get("booking_date") or "").strip()
    if not b_date:
        return {"position": 1, "ahead_of_you": 0, "est_wait_minutes": 0, "doctor_in_call": False}

    # Pull today's confirmed video bookings (excluding cancelled / completed / no_show)
    cursor = db.bookings.find({
        "booking_date": b_date,
        "mode": {"$in": ["video", "online", "tele"]},
        "status": {"$in": ["confirmed", "waiting", "in_call"]},
    }, {
        "_id": 0, "booking_id": 1, "booking_time": 1,
        "video_room.patient_joined_at": 1, "completed_at": 1,
    })
    items = [b async for b in cursor]

    # Sort by time
    def _key(b: Dict[str, Any]) -> str:
        return (b.get("booking_time") or "00:00")[:5]
    items.sort(key=_key)

    # Find position of this booking among non-completed ones
    me_idx = next((i for i, b in enumerate(items) if b.get("booking_id") == booking_id), -1)
    if me_idx < 0:
        return {"position": 1, "ahead_of_you": 0, "est_wait_minutes": 0, "doctor_in_call": False}

    ahead = me_idx
    avg_min = DEFAULT_AVG_CONSULT_MIN
    est_wait = max(0, ahead * avg_min)

    # Doctor-in-call heuristic: any booking ahead that joined within last 30 min
    now = datetime.now(timezone.utc)
    doctor_in_call = False
    for b in items[:me_idx + 1]:
        joined = (b.get("video_room") or {}).get("patient_joined_at")
        if isinstance(joined, datetime) and (now - joined).total_seconds() < 1800:
            doctor_in_call = True
            break

    return {
        "position": me_idx + 1,
        "ahead_of_you": ahead,
        "est_wait_minutes": est_wait,
        "doctor_in_call": doctor_in_call,
        "total_in_queue": len(items),
    }


# ─── I. Attachment sharing ──────────────────────────────────────────


class AttachmentUpload(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    content_base64: str = Field(..., min_length=4)  # raw base64 (no data: prefix)
    mime_type: str = Field("application/octet-stream", max_length=80)


MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024  # 8 MB per file


@router.post("/api/video/bookings/{booking_id}/attachments")
async def upload_attachment(
    booking_id: str,
    payload: AttachmentUpload,
    user=Depends(get_current_user),
) -> Dict[str, Any]:
    """Store a base64-encoded file blob against the booking. Designed
    for small clinical artifacts (reports, X-ray/USG snapshots, lab
    PDFs) — capped at 8 MB to keep MongoDB doc size reasonable.

    Either staff OR the booking-owner patient may upload.
    """
    from datetime import datetime, timezone
    import base64
    import uuid

    booking = await _load_booking(booking_id)
    if not (_is_staff(user) or _can_user_join(user, booking)):
        raise HTTPException(403, "Not allowed.")

    # Strip "data:..;base64," prefix if patient sent one accidentally
    raw_b64 = payload.content_base64
    if raw_b64.startswith("data:"):
        comma = raw_b64.find(",")
        if comma > 0:
            raw_b64 = raw_b64[comma + 1:]

    try:
        decoded_len = len(base64.b64decode(raw_b64, validate=False))
    except Exception:
        raise HTTPException(400, "Invalid base64 payload.")
    if decoded_len > MAX_ATTACHMENT_BYTES:
        raise HTTPException(413, f"File too large (max {MAX_ATTACHMENT_BYTES // 1024 // 1024} MB).")

    att = {
        "id": str(uuid.uuid4())[:12],
        "name": payload.name.strip()[:200] or "file",
        "mime_type": payload.mime_type.strip()[:80] or "application/octet-stream",
        "size": decoded_len,
        "content_base64": raw_b64,
        "uploaded_at": datetime.now(timezone.utc),
        "uploaded_by": user.get("user_id") or user.get("id"),
        "uploaded_by_role": user.get("role"),
    }

    await db.bookings.update_one(
        {"booking_id": booking_id},
        {"$push": {"attachments": att}},
    )

    # Don't return the base64 content in the upload response — saves
    # bandwidth, the GET endpoint serves it lazily.
    return {
        "ok": True,
        "attachment": {k: v for k, v in att.items() if k != "content_base64"},
    }


@router.get("/api/video/bookings/{booking_id}/attachments")
async def list_attachments(
    booking_id: str,
    include_content: bool = False,
    user=Depends(get_current_user),
) -> Dict[str, Any]:
    """List attachments. Set `?include_content=1` to also receive
    each file's base64 payload (used by the gallery for previewing
    images). For thumbnails-only, leave it off."""
    booking = await _load_booking(booking_id)
    if not (_is_staff(user) or _can_user_join(user, booking)):
        raise HTTPException(403, "Not allowed.")
    atts = booking.get("attachments") or []
    if include_content:
        return {"attachments": atts}
    return {"attachments": [
        {k: v for k, v in a.items() if k != "content_base64"} for a in atts
    ]}


@router.get("/api/video/bookings/{booking_id}/attachments/{attachment_id}")
async def get_attachment(
    booking_id: str,
    attachment_id: str,
    user=Depends(get_current_user),
) -> Dict[str, Any]:
    """Fetch a single attachment WITH its base64 content (for the
    image viewer / file download)."""
    booking = await _load_booking(booking_id)
    if not (_is_staff(user) or _can_user_join(user, booking)):
        raise HTTPException(403, "Not allowed.")
    for a in booking.get("attachments") or []:
        if a.get("id") == attachment_id:
            return {"attachment": a}
    raise HTTPException(404, "Attachment not found.")


@router.delete("/api/video/bookings/{booking_id}/attachments/{attachment_id}")
async def delete_attachment(
    booking_id: str,
    attachment_id: str,
    user=Depends(get_current_user),
) -> Dict[str, Any]:
    booking = await _load_booking(booking_id)
    if not (_is_staff(user) or _can_user_join(user, booking)):
        raise HTTPException(403, "Not allowed.")
    await db.bookings.update_one(
        {"booking_id": booking_id},
        {"$pull": {"attachments": {"id": attachment_id}}},
    )
    return {"ok": True}

