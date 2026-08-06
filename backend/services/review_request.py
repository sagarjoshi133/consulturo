"""ConsultUro — Google Review request service.

When a patient completes a visit (booking marked completed, prescription
finalised, or surgery discharged), schedule a friendly nudge to leave a
Google review.

Storage  : `review_requests` collection.
Triggers : booking_completed | rx_final | discharge.
Delivery : push + bell notification (handled by the background sweeper).
Dedup    : one row per (user_id|phone, trigger) within the last 7 days.

The actual send happens via the background loop in `server.py` once
`due_at <= now`, so the patient gets the nudge after the configured
delay (default 24h after the event — gives them a chance to rest).
"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional
from urllib.parse import quote

from db import db

log = logging.getLogger(__name__)

DEFAULT_DELAY_HOURS = 24
DEDUP_WINDOW_DAYS = 7
DEFAULT_TRIGGERS = ("booking_completed", "rx_final", "discharge")
DEFAULT_MESSAGE = (
    "Hi {first_name}, thank you for visiting {clinic_name}! 🙏 "
    "If we made a difference, would you mind sharing your experience on "
    "Google? It takes 30 seconds and means the world to a small clinic.\n\n"
    "{review_url}"
)


def _digits10(phone: Optional[str]) -> Optional[str]:
    if not phone:
        return None
    d = re.sub(r"\D", "", phone)
    return d[-10:] if len(d) >= 10 else None


def _render_message(template: str, *, first_name: str, clinic_name: str, review_url: str) -> str:
    text = template or DEFAULT_MESSAGE
    return (
        text.replace("{first_name}", first_name or "there")
        .replace("{clinic_name}", clinic_name or "the clinic")
        .replace("{review_url}", review_url or "")
    )


def _wa_link(phone10: Optional[str], message: str) -> str:
    """Build a WhatsApp share link (clinic-side) for the staff handoff."""
    base = "https://wa.me/"
    body = quote(message, safe="")
    return f"{base}{('91' + phone10) if phone10 else ''}?text={body}"


async def _get_clinic_settings(clinic_id: Optional[str]) -> Dict[str, Any]:
    """Resolve the clinic-scoped settings doc; fall back to `default`."""
    settings_id = (clinic_id or "").strip() or "default"
    doc = await db.clinic_settings.find_one({"_id": settings_id}) or {}
    if not doc and settings_id != "default":
        doc = await db.clinic_settings.find_one({"_id": "default"}) or {}
    return doc


async def schedule_review_request(
    *,
    trigger: str,
    user_id: Optional[str] = None,
    patient_name: Optional[str] = None,
    phone: Optional[str] = None,
    email: Optional[str] = None,
    source_id: Optional[str] = None,
    clinic_id: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Insert a pending review-request row if (a) the clinic has it
    enabled, (b) a review_url is configured, (c) the trigger is in the
    allowed set, and (d) we haven't already scheduled one for this
    patient+trigger in the dedup window.

    Returns the inserted doc or None when skipped. NEVER raises — the
    caller (booking/prescription/surgery hook) must be non-blocking.
    """
    try:
        if trigger not in DEFAULT_TRIGGERS:
            return None
        settings = await _get_clinic_settings(clinic_id)
        if not settings.get("google_review_request_enabled"):
            return None
        review_url = (settings.get("google_review_url") or "").strip()
        if not review_url:
            return None
        triggers = settings.get("google_review_triggers") or list(DEFAULT_TRIGGERS)
        if trigger not in triggers:
            return None

        phone10 = _digits10(phone)
        # Dedup: one row per (user/phone, trigger) per window.
        cutoff = datetime.now(timezone.utc) - timedelta(days=DEDUP_WINDOW_DAYS)
        existing_query: Dict[str, Any] = {
            "trigger": trigger,
            "created_at": {"$gte": cutoff},
        }
        if user_id:
            existing_query["user_id"] = user_id
        elif phone10:
            existing_query["phone"] = phone10
        else:
            return None
        if await db.review_requests.find_one(existing_query):
            return None

        delay = int(settings.get("google_review_delay_hours") or DEFAULT_DELAY_HOURS)
        delay = max(0, min(delay, 24 * 14))  # cap 0-14d
        now = datetime.now(timezone.utc)
        first_name = (patient_name or "").strip().split(" ")[0] or "there"
        clinic_name = (settings.get("clinic_name") or "the clinic").strip()
        message = _render_message(
            settings.get("google_review_message_template") or DEFAULT_MESSAGE,
            first_name=first_name,
            clinic_name=clinic_name,
            review_url=review_url,
        )

        doc: Dict[str, Any] = {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "phone": phone10,
            "email": (email or "").strip().lower() or None,
            "name": patient_name or None,
            "trigger": trigger,
            "source_id": source_id,
            "clinic_id": clinic_id or settings.get("clinic_id") or "default",
            "review_url": review_url,
            "message": message,
            "wa_link": _wa_link(phone10, message),
            "due_at": now + timedelta(hours=delay),
            "status": "pending",
            "sent_at": None,
            "created_at": now,
        }
        await db.review_requests.insert_one(doc)
        doc.pop("_id", None)
        log.info(
            "review_request scheduled: trigger=%s user_id=%s phone=%s due_in_h=%s",
            trigger, user_id, phone10, delay,
        )
        return doc
    except Exception as e:
        log.warning("schedule_review_request error: %s", e)
        return None


async def fire_due_review_requests(now: datetime) -> int:
    """Background sweeper — fires push + bell for any pending request
    whose `due_at` is in the past. Marks status='sent' on success.

    Returns the number of rows fired this pass.
    """
    fired = 0
    try:
        from services.notifications import create_notification

        cursor = db.review_requests.find(
            {"status": "pending", "due_at": {"$lte": now}}
        ).limit(50)
        async for row in cursor:
            try:
                await create_notification(
                    user_id=row.get("user_id"),
                    phone=row.get("phone"),
                    email=row.get("email"),
                    title="⭐ Loved your visit? Share a quick review",
                    body=row.get("message") or DEFAULT_MESSAGE,
                    kind="review_request",
                    data={
                        "type": "review_request",
                        "review_url": row.get("review_url"),
                        "trigger": row.get("trigger"),
                        "request_id": row.get("id"),
                        "deep_link": row.get("review_url"),
                    },
                    push=True,
                )
                await db.review_requests.update_one(
                    {"_id": row["_id"]},
                    {"$set": {"status": "sent", "sent_at": now}},
                )
                fired += 1
            except Exception as e:
                log.warning("fire_due_review_requests row error: %s", e)
                # Mark as 'failed' so it doesn't loop forever.
                try:
                    await db.review_requests.update_one(
                        {"_id": row["_id"]},
                        {"$set": {"status": "failed", "error": str(e)[:240]}},
                    )
                except Exception:
                    pass
    except Exception as e:
        log.warning("fire_due_review_requests outer error: %s", e)
    return fired
