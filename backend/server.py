"""ConsultUro Backend - FastAPI server for Dr. Sagar Joshi's professional urology app."""
import os
import re
import uuid
import json
import html as htmllib
from datetime import datetime, timezone, timedelta
from pymongo import ReturnDocument
from typing import List, Optional, Dict, Any

import httpx
import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Depends, Request, Response, Cookie, Header, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.responses import JSONResponse, HTMLResponse
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr
# Pydantic request/response models extracted to ./models.py
from models import *  # noqa: F401,F403  re-export all schemas

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(ROOT_DIR, ".env"))

# --- Sentry (optional — leave SENTRY_DSN empty to disable) ---
_SENTRY_DSN = os.environ.get("SENTRY_DSN", "").strip()
if _SENTRY_DSN:
    sentry_sdk.init(
        dsn=_SENTRY_DSN,
        environment=os.environ.get("SENTRY_ENV", "production"),
        release=os.environ.get("SENTRY_RELEASE", "consulturo@1.1.0"),
        traces_sample_rate=float(os.environ.get("SENTRY_TRACES", "0.1")),
        send_default_pii=False,  # never send PII of patients
        integrations=[FastApiIntegration(transaction_style="endpoint"), StarletteIntegration()],
    )

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ.get("DB_NAME", "consulturo")
EMERGENT_AUTH_URL = os.environ.get(
    "EMERGENT_AUTH_URL",
    "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
)
OWNER_EMAIL = os.environ.get("OWNER_EMAIL", "sagar.joshi133@gmail.com").lower()
# Super Owner = platform-level admin (developer / "trustee"). Sits ABOVE
# all primary owners. Can promote/demote primary owners, audit any
# clinic operation, and execute platform-level commands. There can be
# only one in v1; future versions may support multiple super owners.
SUPER_OWNER_EMAIL = os.environ.get("SUPER_OWNER_EMAIL", "app.consulturo@gmail.com").lower()
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN")
TELEGRAM_OWNER_CHAT_ID = os.environ.get("TELEGRAM_OWNER_CHAT_ID")
BLOGGER_FEED_URL = os.environ.get(
    "BLOGGER_FEED_URL",
    "https://www.drsagarjoshi.com/feeds/posts/default?alt=json&max-results=30",
)

# Role hierarchy (top → bottom):
#   super_owner  → platform admin (only the SUPER_OWNER_EMAIL).
#   primary_owner → senior co-owners of the practice. Can promote / demote
#                   partners and other staff. Multiple allowed.
#   partner       → equal clinical / admin powers as primary_owner, EXCEPT
#                   cannot manage primary owners or partners.
#   doctor / assistant / reception / nursing → standard staff roles.
#   patient       → end user.
#
# The legacy "owner" role is retained in VALID_ROLES for backward
# compatibility during the migration window — the startup migration
# (see `_migrate_owner_to_primary_owner`) renames every existing
# `role: "owner"` to `role: "primary_owner"` on first boot, but old
# clients that still send/check "owner" continue to work via the
# `is_owner_or_partner` / `is_primary_owner` helpers below.
VALID_ROLES = [
    "super_owner",
    "primary_owner",
    "owner",  # legacy alias — auto-migrated on startup
    "partner",
    "doctor",
    "assistant",
    "reception",
    "nursing",
    "patient",
]
STAFF_ROLES = [
    "super_owner",
    "primary_owner",
    "owner",  # legacy
    "partner",
    "doctor",
    "assistant",
    "reception",
    "nursing",
]
OWNER_TIER_ROLES = {"super_owner", "primary_owner", "owner", "partner"}
PRIMARY_TIER_ROLES = {"super_owner", "primary_owner", "owner"}

# Roles whose Practice → Availability schedule is consulted when
# generating bookable slots for the patient Book screen. Owner-tier
# only by default (primary_owner / partner / super_owner / legacy
# owner) — these are the actual clinicians who run the practice.
# Other team members (doctor, nursing, reception, …) may also become
# prescribers if a Primary Owner / Partner explicitly enables their
# `can_prescribe` flag — see `_user_is_prescriber()`.
PRESCRIBER_AVAILABILITY_ROLES = ["super_owner", "primary_owner", "owner", "partner"]

# Hard cap on concurrent bookings per (date, time, mode) slot. Walk-ins
# and overbooks are explicitly allowed up to this limit (a 30-minute
# slot can accept up to 5 patients) to match how the clinic actually
# runs OPDs. Configurable via env so a future tier could relax it.
MAX_BOOKINGS_PER_SLOT = int(os.environ.get("MAX_BOOKINGS_PER_SLOT", "5"))


def is_owner_or_partner(user: Dict[str, Any]) -> bool:
    """True for every role that has 'full clinic admin' powers
    (super_owner, primary_owner, partner). Legacy 'owner' is treated as
    primary_owner during the migration window."""
    return (user or {}).get("role") in OWNER_TIER_ROLES


def is_primary_or_super(user: Dict[str, Any]) -> bool:
    """True only for primary_owner and super_owner (NOT partner). Used
    for actions that require ultimate authority — e.g. promoting /
    demoting partners themselves. Legacy 'owner' is treated as
    primary_owner."""
    return (user or {}).get("role") in PRIMARY_TIER_ROLES


def is_super_owner(user: Dict[str, Any]) -> bool:
    """True only for the platform-level super owner. Used for
    promoting/demoting primary owners and platform-level operations."""
    return (user or {}).get("role") == "super_owner"

# IST offset for "today" in Reg No. generation (patients register locally).
IST_OFFSET = timedelta(hours=5, minutes=30)


from services.reg_no import _normalize_phone  # (extracted)


from services.reg_no import allocate_reg_no  # (extracted)


from services.reg_no import get_or_set_reg_no  # (extracted)

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="ConsultUro API", version="1.1.0")

# ---------- Rate limiting (slowapi) ----------
# Protect sensitive endpoints from abuse / brute-force without changing UX
# for normal callers. Limits applied:
#   /api/auth/session  -> 20 req/min  (Google OAuth verification)
#   /api/auth/logout   -> 20 req/min
#   POST /api/bookings -> 10 req/min  (per IP — guests share IP, enough headroom)
# Excess requests get HTTP 429 + a friendly JSON message.
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware


def _client_ip(request: Request) -> str:
    """Per-client key for slowapi that honours K8s ingress.

    The cluster sits behind 2+ proxy IPs, so falling back to
    `request.client.host` would let a single client double-up the burst.
    Prefer the leftmost X-Forwarded-For entry if present (the original
    client), with X-Real-IP as a backup, and finally the direct peer.
    """
    xff = request.headers.get("x-forwarded-for")
    if xff:
        # First IP in the comma-separated list is the original client.
        first = xff.split(",")[0].strip()
        if first:
            return first
    real = request.headers.get("x-real-ip")
    if real:
        return real.strip()
    return get_remote_address(request)


limiter = Limiter(key_func=_client_ip, default_limits=[])
app.state.limiter = limiter
app.add_middleware(SlowAPIMiddleware)


@app.exception_handler(RateLimitExceeded)
async def _rate_limit_handler(request: Request, exc: RateLimitExceeded):
    # Friendly client-facing message; the structured detail keeps the same
    # `detail` shape FastAPI uses elsewhere so the existing error toasts work.
    return JSONResponse(
        status_code=429,
        content={
            "detail": "Too many requests. Please slow down and try again in a minute.",
            "limit": str(exc.detail),
        },
    )


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Demo Read-Only middleware ────────────────────────────────────────
# Strictly enforces read-only behaviour for any user with `is_demo: True`.
# Runs before request handlers, so we don't have to sprinkle
# `block_if_demo(user)` calls across every write endpoint and risk a miss.
#
# Whitelist (still allowed for demo users):
#   • /api/auth/*                  — must be able to log in / out / refresh
#   • /api/notifications/*read*    — marking own bell read is UX, not data
#   • /api/inbox/all/read          — marking own inbox read
#   • /api/broadcasts/inbox/read   — marking own broadcasts read
#   • /api/push/register           — device push tokens (per-device, not data)
#
# Everything else with a write method (POST/PUT/PATCH/DELETE) is 403'd
# with a friendly JSON body matching the shape used by the rest of the API.
DEMO_WRITE_WHITELIST_PREFIXES = (
    "/api/auth/",
)
DEMO_WRITE_WHITELIST_EXACT = {
    "/api/notifications/read-all",
    "/api/inbox/all/read",
    "/api/broadcasts/inbox/read",
    "/api/push/register",
}


async def _try_get_user_from_request(request: Request) -> Optional[Dict[str, Any]]:
    """Best-effort user lookup that mirrors `get_current_user` but
    swallows all errors so the middleware never crashes a request.
    Returns `None` for unauthenticated callers.
    """
    try:
        token = request.cookies.get("session_token")
        if not token:
            auth = request.headers.get("authorization") or ""
            if auth.startswith("Bearer "):
                token = auth.split(" ", 1)[1]
        if not token:
            return None
        session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
        if not session:
            return None
        expires_at = session.get("expires_at")
        if isinstance(expires_at, str):
            try:
                expires_at = datetime.fromisoformat(expires_at)
            except Exception:
                expires_at = None
        if expires_at and expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at and expires_at < datetime.now(timezone.utc):
            return None
        return await db.users.find_one({"user_id": session.get("user_id")}, {"_id": 0})
    except Exception:
        return None


@app.middleware("http")
async def demo_readonly_middleware(request: Request, call_next):
    method = (request.method or "").upper()
    if method in ("POST", "PUT", "PATCH", "DELETE"):
        path = request.url.path or ""
        if path.startswith("/api/") and not path.startswith(DEMO_WRITE_WHITELIST_PREFIXES) \
                and path not in DEMO_WRITE_WHITELIST_EXACT \
                and not (path.startswith("/api/notifications/") and path.endswith("/read")):
            user = await _try_get_user_from_request(request)
            if user and user.get("is_demo"):
                return JSONResponse(
                    status_code=403,
                    content={
                        "detail": "Demo mode — actions are disabled in this preview account.",
                        "demo": True,
                    },
                )
    return await call_next(request)


# Background: check for due reminders (notes + bookings) once every minute
# and fire an in-app + push notification so the bell updates on the home/
# dashboard/my-bookings screens.
@app.on_event("startup")
async def _migrate_owner_to_primary_owner() -> None:
    """One-time migration: rename every legacy `role: "owner"` →
    `role: "primary_owner"` across all collections that store roles.
    Idempotent — safe to run on every boot. Logs the count to stdout
    so operators can confirm the rename actually happened.

    Also auto-promotes the configured SUPER_OWNER_EMAIL to
    `super_owner` (if a record for that email exists in db.users).
    """
    try:
        # users collection
        u_res = await db.users.update_many(
            {"role": "owner"}, {"$set": {"role": "primary_owner"}}
        )
        # team_invites
        ti_res = await db.team_invites.update_many(
            {"role": "owner"}, {"$set": {"role": "primary_owner"}}
        )
        # Promote super-owner email if a user already exists for it.
        s_res = await db.users.update_many(
            {"email": SUPER_OWNER_EMAIL},
            {"$set": {
                "role": "super_owner",
                "can_approve_bookings": True,
                "can_approve_broadcasts": True,
                "can_send_personal_messages": True,
            }},
        )
        if u_res.modified_count or ti_res.modified_count or s_res.modified_count:
            print(
                f"[migration] owner→primary_owner: users={u_res.modified_count} "
                f"invites={ti_res.modified_count} super_promoted={s_res.modified_count}"
            )
    except Exception as e:
        # Migration failures must not crash the server — log and proceed.
        print(f"[migration] owner→primary_owner failed: {e}")


@app.on_event("startup")
async def _ensure_unique_indexes_and_cleanup_orphans() -> None:
    """Idempotent: codifies the unique constraints on users.email /
    users.phone / team_invites.email so a fresh DB re-creation also
    enforces them (previously they were only created via a one-off
    operator script). Also sweeps orphan `team_invites` rows that have
    no `role` set and where the same email already exists as a live
    user — these stubs were silently created by older versions of the
    blog-perm / dashboard-perm endpoints (now patched to upsert=False)
    and showed up as "ghost" duplicate Primary Owners in the UI.
    """
    try:
        # Skip create_index calls when an index with the desired name
        # already exists — MongoDB raises IndexOptionsConflict on
        # cosmetic spec differences (e.g. $type ordering) even when
        # the operator-created index already enforces what we want.
        existing_users = set()
        async for idx in db.users.list_indexes():
            existing_users.add(idx.get("name"))
        existing_invites = set()
        async for idx in db.team_invites.list_indexes():
            existing_invites.add(idx.get("name"))
        if "users_email_unique" not in existing_users:
            await db.users.create_index(
                "email", unique=True, name="users_email_unique",
                partialFilterExpression={"email": {"$gt": "", "$type": "string"}},
            )
        if "users_phone_unique" not in existing_users:
            await db.users.create_index(
                "phone", unique=True, name="users_phone_unique",
                partialFilterExpression={"phone": {"$gt": "", "$type": "string"}},
            )
        if not (existing_invites & {"invites_email_unique", "team_invites_email_unique"}):
            await db.team_invites.create_index(
                "email", unique=True, name="invites_email_unique",
                partialFilterExpression={"email": {"$gt": "", "$type": "string"}},
            )
    except Exception as e:
        # Index already exists with a different spec, or another race —
        # log and continue. Operators can drop+recreate manually if
        # this ever surfaces.
        print(f"[indexes] ensure_unique_indexes warning: {e}")

    # Orphan-invite sweep — only delete rows that are clearly stubs
    # (no role, not flagged as demo, and the email already maps to a
    # live user). Conservative on purpose: never delete rows with
    # role/is_demo/name set, even if the user already exists.
    try:
        emails_with_user = set()
        async for u in db.users.find({}, {"email": 1, "_id": 0}):
            em = (u.get("email") or "").lower().strip()
            if em:
                emails_with_user.add(em)
        if emails_with_user:
            res = await db.team_invites.delete_many({
                "email": {"$in": list(emails_with_user)},
                "$and": [
                    {"$or": [{"role": {"$exists": False}}, {"role": None}, {"role": ""}]},
                    {"$or": [{"is_demo": {"$exists": False}}, {"is_demo": False}, {"is_demo": None}]},
                    {"$or": [{"name": {"$exists": False}}, {"name": None}, {"name": ""}]},
                ],
            })
            if getattr(res, "deleted_count", 0):
                print(f"[cleanup] orphan team_invites removed: {res.deleted_count}")
    except Exception as e:
        print(f"[cleanup] orphan team_invites sweep failed: {e}")


@app.on_event("startup")
async def _start_reminder_loop():
    import asyncio

    async def _loop():
        while True:
            try:
                now = datetime.now(timezone.utc)
                # ---- Note reminders ----
                cursor = db.notes.find({
                    "reminder_at": {"$lte": now},
                    "reminder_fired": {"$ne": True},
                }).limit(100)
                async for n in cursor:
                    try:
                        title_text = (n.get("title") or "").strip() or "Reminder"
                        snippet = (n.get("body") or "").strip().split("\n")[0][:140]
                        await create_notification(
                            user_id=n["user_id"],
                            title=f"⏰ {title_text}",
                            body=snippet or "You set a reminder for this note.",
                            kind="note_reminder",
                            data={"type": "note_reminder", "note_id": n.get("note_id")},
                            push=True,
                        )
                        await db.notes.update_one(
                            {"_id": n["_id"]},
                            {"$set": {"reminder_fired": True, "reminder_fired_at": now}},
                        )
                    except Exception:
                        pass

                # ---- Booking reminders (24h + 2h before) ----
                try:
                    await _scan_and_fire_booking_reminders(now)
                except Exception:
                    pass
            except Exception:
                pass
            await asyncio.sleep(60)

    asyncio.create_task(_loop())


async def _scan_and_fire_booking_reminders(now: datetime) -> None:
    """Fire booking reminders at T-24h and T-2h for confirmed bookings.

    Bookings are stored with booking_date (YYYY-MM-DD, local IST date) and
    booking_time (HH:mm, 24h). We convert to UTC using IST_OFFSET and fire
    once per window using the `reminder_24h_fired_at` / `reminder_2h_fired_at`
    boolean markers so a reminder is never sent twice.
    """
    # Look at confirmed bookings in the next 30 hours (comfortable window
    # that catches both 24h and 2h triggers with room for drift).
    horizon = now + timedelta(hours=30)
    # Crude date-string window (inclusive, IST-adjusted both ends)
    earliest_iso = (now + IST_OFFSET - timedelta(hours=1)).date().isoformat()
    latest_iso = (horizon + IST_OFFSET).date().isoformat()

    cursor = db.bookings.find({
        "status": "confirmed",
        "booking_date": {"$gte": earliest_iso, "$lte": latest_iso},
        "user_id": {"$ne": None},
    }).limit(500)
    async for b in cursor:
        try:
            b_date = (b.get("booking_date") or "").strip()
            b_time = (b.get("booking_time") or "10:00").strip()[:5]
            if not b_date:
                continue
            try:
                hh, mm = [int(x) for x in b_time.split(":")]
            except Exception:
                hh, mm = 10, 0
            # Construct IST datetime, convert to UTC
            try:
                yr, mo, dy = [int(x) for x in b_date.split("-")]
            except Exception:
                continue
            booking_ist = datetime(yr, mo, dy, hh, mm, tzinfo=timezone.utc) - IST_OFFSET
            # booking_ist is actually UTC naive adjusted: treat as UTC
            delta = booking_ist - now

            patient_name = (b.get("patient_name") or "").split(" ")[0] or "there"
            when_disp = _format_booking_display(b_date, b_time)
            uid = b.get("user_id")

            # 24-hour window: fire when delta is between 22.5h and 25.5h
            if timedelta(hours=22, minutes=30) <= delta <= timedelta(hours=25, minutes=30):
                if not b.get("reminder_24h_fired_at"):
                    await create_notification(
                        user_id=uid,
                        title="⏰ Appointment tomorrow",
                        body=f"Hi {patient_name}, your appointment with Dr. Sagar Joshi is tomorrow, {when_disp}.",
                        kind="booking_reminder",
                        data={"type": "booking_reminder", "booking_id": b.get("booking_id"), "window": "24h"},
                        push=True,
                    )
                    await db.bookings.update_one(
                        {"_id": b["_id"]},
                        {"$set": {"reminder_24h_fired_at": now}},
                    )

            # 2-hour window: fire when delta is between 1.5h and 2.5h
            if timedelta(hours=1, minutes=30) <= delta <= timedelta(hours=2, minutes=30):
                if not b.get("reminder_2h_fired_at"):
                    await create_notification(
                        user_id=uid,
                        title="⏰ Appointment in 2 hours",
                        body=f"Reminder {patient_name}: your appointment with Dr. Sagar Joshi is at {_time_12h(b_time)} today. Please arrive 10 minutes early.",
                        kind="booking_reminder",
                        data={"type": "booking_reminder", "booking_id": b.get("booking_id"), "window": "2h"},
                        push=True,
                    )
                    await db.bookings.update_one(
                        {"_id": b["_id"]},
                        {"$set": {"reminder_2h_fired_at": now}},
                    )
        except Exception:
            # Never let a single booking crash the loop
            continue


from services.booking_helpers import _time_12h  # (extracted)


from services.booking_helpers import _format_booking_display  # (extracted)


# ============================================================
# HELPERS
# ============================================================


from services.telegram import notify_telegram  # (extracted)


async def resolve_role_for_email(email: str) -> Dict[str, Any]:
    email_l = (email or "").lower()
    # Super Owner — platform-level admin, sits above all clinic owners.
    # Configurable via SUPER_OWNER_EMAIL env (default: app.consulturo@gmail.com).
    if email_l == SUPER_OWNER_EMAIL:
        return {
            "role": "super_owner",
            "can_approve_bookings": True,
            "can_approve_broadcasts": True,
            "can_send_personal_messages": True,
            "can_prescribe": True,
            "can_manage_surgeries": True,
            "can_manage_availability": True,
        }
    # Primary Owner — the original clinic owner email. Anyone the
    # super_owner promotes later is also a primary_owner (stored in
    # team_invites with role="primary_owner").
    if email_l == OWNER_EMAIL:
        return {
            "role": "primary_owner",
            "can_approve_bookings": True,
            "can_approve_broadcasts": True,
            "can_send_personal_messages": True,
            "can_prescribe": True,
            "can_manage_surgeries": True,
            "can_manage_availability": True,
        }
    invite = await db.team_invites.find_one({"email": email_l}, {"_id": 0})
    if invite:
        role = invite.get("role", "patient")
        # Migrate legacy "owner" → "primary_owner" on the fly.
        if role == "owner":
            role = "primary_owner"
        # Role is valid if it's a core role OR a custom role defined in role_labels.
        is_core = role in VALID_ROLES
        is_custom = False
        if not is_core:
            custom = await db.role_labels.find_one({"slug": role}, {"_id": 0})
            if custom:
                is_custom = True
        if is_core or is_custom:
            return {
                "role": role,
                # Owner-tier always; everyone else (including `doctor`)
                # must be explicitly granted via the Team panel.
                "can_approve_bookings": invite.get(
                    "can_approve_bookings", role in OWNER_TIER_ROLES
                ),
                "can_approve_broadcasts": invite.get(
                    "can_approve_broadcasts", role in OWNER_TIER_ROLES
                ),
                "can_send_personal_messages": invite.get("can_send_personal_messages", False),
                # Three independent prescriber-tier flags — owner-tier
                # always on; team-members opt-in per flag.
                "can_prescribe": invite.get(
                    "can_prescribe", role in OWNER_TIER_ROLES
                ),
                "can_manage_surgeries": invite.get(
                    "can_manage_surgeries", role in OWNER_TIER_ROLES
                ),
                "can_manage_availability": invite.get(
                    "can_manage_availability", role in OWNER_TIER_ROLES
                ),
            }
    return {
        "role": "patient",
        "can_approve_bookings": False,
        "can_approve_broadcasts": False,
        "can_send_personal_messages": False,
        "can_prescribe": False,
        "can_manage_surgeries": False,
        "can_manage_availability": False,
    }


async def get_effective_role(role: str) -> Dict[str, Any]:
    """Return {category, is_staff} for core OR custom role.
    `doctor` is now bucketed as a regular staff member (no longer a
    special prescriber tier) — `can_prescribe` is the gate, not the
    role label.
    """
    if role in STAFF_ROLES:
        return {"category": "doctor" if role in OWNER_TIER_ROLES else "staff", "is_staff": True}
    if role == "patient":
        return {"category": "patient", "is_staff": False}
    custom = await db.role_labels.find_one({"slug": role}, {"_id": 0})
    if custom:
        cat = custom.get("category", "staff")
        return {"category": cat, "is_staff": cat != "patient"}
    return {"category": "patient", "is_staff": False}


# ============================================================
# MODELS
# ============================================================


# (moved) class BookingCreate → /app/backend/models.py


# (moved) class IpssEntry → /app/backend/models.py


# (moved) class IpssSubmission → /app/backend/models.py


# (moved) class PrescriptionMedicine → /app/backend/models.py


# (moved) class PrescriptionCreate → /app/backend/models.py


# (moved) class SessionExchangeBody → /app/backend/models.py


# (moved) class TeamInviteBody → /app/backend/models.py


# (moved) class TeamUpdateBody → /app/backend/models.py


# (moved) class RoleLabelBody → /app/backend/models.py


# (moved) class HomepageSettingsBody → /app/backend/models.py


# (moved) class ReferrerBody → /app/backend/models.py


# (moved) class BookingStatusBody → /app/backend/models.py


# (moved) class PatientCancelBody → /app/backend/models.py


# (moved) class SurgeryBody → /app/backend/models.py


# (moved) class BlogPostBody → /app/backend/models.py


# (moved) class BlogReviewBody → /app/backend/models.py


# (moved) class AvailabilitySlot → /app/backend/models.py


# (moved) class DayAvailabilityBody → /app/backend/models.py


# ============================================================
# AUTH
# ============================================================


async def get_current_user(
    request: Request,
    authorization: Optional[str] = Header(None),
    session_token: Optional[str] = Cookie(None),
) -> Optional[Dict[str, Any]]:
    token = session_token
    if not token and authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1]
    if not token:
        return None
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        return None
    expires_at = session.get("expires_at")
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at and expires_at < datetime.now(timezone.utc):
        return None
    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    return user


async def require_user(user=Depends(get_current_user)) -> Dict[str, Any]:
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    # Block any user whose primary_owner account has been suspended by
    # the super_owner. Suspension is intended as a soft-pause (e.g. the
    # clinic is being on-boarded / off-boarded) and is fully reversible.
    if user.get("suspended"):
        raise HTTPException(
            status_code=403,
            detail="ACCOUNT_SUSPENDED: This account has been temporarily suspended by the platform admin. Please contact ConsultUro support.",
        )
    return user


async def require_staff(user=Depends(require_user)) -> Dict[str, Any]:
    role = user.get("role")
    if role in STAFF_ROLES:
        return user
    # Allow custom staff-category roles
    custom = await db.role_labels.find_one({"slug": role, "category": {"$in": ["staff", "doctor"]}}, {"_id": 0})
    if custom:
        return user
    raise HTTPException(status_code=403, detail="Staff access required")


async def require_owner(user=Depends(require_user)) -> Dict[str, Any]:
    """Pass for the full "owner tier" — super_owner, primary_owner,
    partner. Replaces the v1 owner-only check. Legacy "owner" role
    (pre-migration) is also accepted via OWNER_TIER_ROLES.

    For actions that require ULTIMATE authority (managing partners,
    transferring primary ownership, platform admin), use
    `require_primary_owner` or `require_super_owner` instead.
    """
    if not is_owner_or_partner(user):
        raise HTTPException(status_code=403, detail="Owner access required")
    return user


async def require_primary_owner(user=Depends(require_user)) -> Dict[str, Any]:
    """Pass only for primary_owner or super_owner — NOT partners. Used
    when an action must be authorised by someone with partner-management
    power. Examples: promote staff to partner, demote a partner,
    transfer primary ownership."""
    if not is_primary_or_super(user):
        raise HTTPException(status_code=403, detail="Primary owner access required")
    return user


async def require_primary_owner_strict(user=Depends(require_user)) -> Dict[str, Any]:
    """Pass ONLY for the primary_owner role (legacy "owner" alias also
    allowed for backward compat). Super-owner is intentionally NOT
    accepted because partner management is a clinic-owner concern, not
    a platform-admin concern. Used by /api/admin/partners/* so that the
    super-owner UI can hide the partner-management surface entirely.
    """
    if user.get("role") not in {"primary_owner", "owner"}:
        raise HTTPException(status_code=403, detail="Primary owner only — partner management is a clinic-owner action.")
    return user


async def require_super_owner(user=Depends(require_user)) -> Dict[str, Any]:
    """Pass only for the platform-level super owner. Used for
    promote/demote primary_owner endpoints and any platform-level
    operation that should never be delegated to a clinic owner."""
    if not is_super_owner(user):
        raise HTTPException(status_code=403, detail="Super owner access required")
    return user


async def require_full_dashboard_access(user=Depends(require_user)) -> Dict[str, Any]:
    """Pass for the owner tier OR any team member with
    `dashboard_full_access=True`. Used to gate every owner-only
    management endpoint that the doctor wants to delegate (Backups,
    Notifs, Team config, Homepage settings, push test, etc.). Granting
    / revoking this flag remains strictly primary-owner only.
    """
    if is_owner_or_partner(user):
        return user
    if bool(user.get("dashboard_full_access")):
        return user
    raise HTTPException(status_code=403, detail="Full dashboard access required")


async def require_doctor_or_full_access(user=Depends(require_user)) -> Dict[str, Any]:
    """Pass for owner-tier OR a team member explicitly granted
    `can_prescribe` / `dashboard_full_access`. Used by Availability
    and Unavailability writes — anyone trusted enough to manage the
    schedule.

    Note: the `doctor` role is no longer a special prescriber tier —
    it's a regular team-member label. A `doctor` may still pass this
    gate if the Primary Owner / Partner has enabled `can_prescribe`
    on their user record (same as any other team-member role).
    """
    role = user.get("role")
    if role in OWNER_TIER_ROLES:
        return user
    if bool(user.get("can_prescribe")):
        return user
    if bool(user.get("dashboard_full_access")):
        return user
    raise HTTPException(status_code=403, detail="Prescriber or Full-Access access required")


async def require_prescriber(user=Depends(require_user)) -> Dict[str, Any]:
    """Pass for owner-tier (super_owner / primary_owner / partner /
    legacy owner) OR any team member whose `can_prescribe` flag has
    been explicitly enabled by a Primary Owner / Partner.

    The `doctor` role is no longer auto-granted prescriber rights —
    it must be enabled per-user via the Team panel, same as for
    nursing / reception / assistant / custom roles.
    """
    role = user.get("role")
    if role in OWNER_TIER_ROLES:
        return user
    if bool(user.get("can_prescribe")):
        return user
    raise HTTPException(status_code=403, detail="Prescriber access required")


async def is_prescriber(user: Dict[str, Any]) -> bool:
    """Helper — does this user have prescribe permission?
    Owner-tier always; team members only if `can_prescribe` is True.
    """
    role = user.get("role")
    if role in OWNER_TIER_ROLES:
        return True
    return bool(user.get("can_prescribe"))


async def require_can_manage_surgeries(user=Depends(require_user)) -> Dict[str, Any]:
    """Pass for owner-tier OR any team member whose
    `can_manage_surgeries` flag has been enabled by a Primary Owner
    / Partner. Used by every surgery CRUD endpoint (POST/PATCH/
    DELETE /api/surgeries, /api/surgeries/import, surgeries.csv).
    """
    role = user.get("role")
    if role in OWNER_TIER_ROLES:
        return user
    if bool(user.get("can_manage_surgeries")):
        return user
    raise HTTPException(status_code=403, detail="Surgery management access required")


async def require_can_manage_availability(user=Depends(require_user)) -> Dict[str, Any]:
    """Pass for owner-tier OR any team member whose
    `can_manage_availability` flag has been enabled by a Primary
    Owner / Partner. Used by:
       - GET/PUT /api/availability/me  (own weekly schedule)
       - GET/POST/DELETE /api/unavailabilities  (holiday / time-off)
    """
    role = user.get("role")
    if role in OWNER_TIER_ROLES:
        return user
    if bool(user.get("can_manage_availability")):
        return user
    raise HTTPException(status_code=403, detail="Availability management access required")


# ── Blog write-access gate ─────────────────────────────────────────
# Default policy: ONLY super_owner can author / publish / approve /
# delete blog posts. Super-owner can grant the privilege to a specific
# primary_owner via PATCH /api/admin/primary-owners/{id}/blog-perm —
# that toggles `can_create_blog: true` on that user record.
#
# Partners and lower roles are NEVER allowed (the prior pending-review
# workflow for doctors is replaced by editorial gating at the source).
async def require_blog_writer(user=Depends(require_user)) -> Dict[str, Any]:
    """Pass for super_owner OR primary_owner with `can_create_blog`."""
    if is_super_owner(user):
        return user
    if user.get("role") == "primary_owner" and bool(user.get("can_create_blog")):
        return user
    raise HTTPException(
        status_code=403,
        detail="Blog editorial access required. The Super Owner must grant this privilege.",
    )


# ============================================================================
# /auth-callback BRIDGE — for native APK installs + production deploys
# ============================================================================
# Registered OUTSIDE /api/* so the Emergent ingress (which routes unknown paths
# to the backend on the production deploy domain) lands here instead of 404.
#
# Emergent Auth redirects the in-app browser to
#   https://{deploy-domain}/auth-callback?session_id=XXX
#   (or #session_id=XXX)
# This endpoint serves a tiny HTML bridge that:
#   1. Picks up the session_id from ?query or #fragment
#   2. Deep-links into the installed APK via `consulturo://auth-callback?…`
#      so expo-router resumes on the existing auth-callback screen and does
#      the session exchange.
#   3. If the deep-link doesn't fire within ~1.5s (e.g. plain web browser /
#      Expo Go), it falls back to the SPA route `/auth-callback#session_id=…`.
# (moved) auth block (L1003-1005) → /app/backend/routers/auth.py


# (moved) auth block (L1008-1014) → /app/backend/routers/auth.py


def _build_auth_callback_response(handoff_id_from_path: str = ""):
    # Inject the path-based handoff into the bridge so JS doesn't have to
    # hunt for it in the URL fragment (which Emergent Auth may strip).
    safe_handoff = (handoff_id_from_path or "").replace('"', '').replace('\\', '')
    html = """<!doctype html><html><head><meta charset="utf-8"><title>Signing you in…</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;font-family:-apple-system,Segoe UI,Roboto,sans-serif;
       background:#0E7C8B;color:#fff;display:flex;flex-direction:column;
       align-items:center;justify-content:center;height:100vh;text-align:center;padding:24px}
  .dot{width:10px;height:10px;border-radius:50%;background:#fff;display:inline-block;margin:0 4px;
       animation:b 1.2s infinite ease-in-out both}
  .dot:nth-child(1){animation-delay:-.32s}.dot:nth-child(2){animation-delay:-.16s}
  @keyframes b{0%,80%,100%{transform:scale(.6);opacity:.5}40%{transform:scale(1);opacity:1}}
  h1{font-size:22px;font-weight:700;margin:20px 0 6px}
  p{font-size:14px;opacity:.85;max-width:380px;line-height:1.5;margin:0}
  a.btn{margin-top:24px;display:inline-block;background:#fff;color:#0E7C8B;text-decoration:none;
        padding:14px 28px;border-radius:24px;font-weight:700;font-size:15px;
        box-shadow:0 4px 14px rgba(0,0,0,0.18)}
  a.btn:active{transform:translateY(1px)}
  .small{font-size:12px;opacity:.7;margin-top:14px}
</style></head>
<body>
  <div><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
  <h1>Signing you in…</h1>
  <p>Returning to the ConsultUro app.</p>
  <a id="manual" class="btn" href="#">Open ConsultUro app</a>
  <p class="small">If nothing happens, tap the button above to return to the app.</p>
<script>
(function(){
  var search = window.location.search || '';
  var hash = window.location.hash || '';
  var qp = {};
  (search.replace(/^\\?/, '') + '&' + hash.replace(/^#/, '')).split('&').forEach(function(p){
    if(!p) return; var i = p.indexOf('='); if(i<0) return;
    qp[decodeURIComponent(p.slice(0,i))] = decodeURIComponent(p.slice(i+1));
  });
  var sid = qp['session_id'] || '';
  var handoff = qp['handoff'] || '__PATH_HANDOFF__';
  // Use TRIPLE-slash so Expo Router treats `auth-callback` as a path
  // (not a host). With `consulturo://auth-callback?...` some Android
  // builds parse `auth-callback` as the host and miss the route.
  var deep = 'consulturo:///auth-callback' + (sid ? ('?session_id=' + encodeURIComponent(sid)) : '');
  // Android Intent URL — properly formatted: extras go AFTER #Intent;...; not as query params.
  // S.<key>=<value>   passes a string extra; the receiving Activity sees it via getStringExtra.
  // Without this, Chrome Custom Tabs sometimes ignores the URL entirely.
  var intentUrl = sid
    ? ('intent:///auth-callback'
       + '#Intent;scheme=consulturo;package=com.drsagarjoshi.consulturo;'
       + 'S.session_id=' + encodeURIComponent(sid) + ';'
       + 'S.browser_fallback_url=' + encodeURIComponent('https://expo.dev/artifacts/eas/4aFmagoh3Q55sS4cgbTJVj.apk') + ';'
       + 'end')
    : deep;

  var manual = document.getElementById('manual');
  manual.href = deep;

  // (1) Programmatic deep-link — works on most iOS Safari & some Android Chrome.
  var triedAuto = false;
  function tryAuto(){
    if (triedAuto) return; triedAuto = true;
    try { window.location.href = deep; } catch(e) {}
  }

  // (2) Auto-click the anchor as the SECOND attempt — Chrome Custom Tabs intercept
  //     anchor clicks on custom schemes more reliably than location.href.
  function tryClick(){
    try {
      var ua = (navigator.userAgent || '').toLowerCase();
      // Use the Android intent URL on Android — much higher success rate inside
      // Chrome Custom Tabs (which is what openAuthSessionAsync opens).
      manual.href = ua.indexOf('android') >= 0 ? intentUrl : deep;
      manual.click();
    } catch(e) {}
  }

  tryAuto();
  setTimeout(tryClick, 250);

  // (3) Session exchange — runs IMMEDIATELY so the polling app can pick it
  //     up within a second or two. The handoff_id we got from the URL
  //     PATH (`__PATH_HANDOFF__`) is preferred — it survives Emergent
  //     Auth's redirect handling (which can strip URL fragments).
  function doExchange(){
    if (!sid) { document.querySelector('h1').textContent = 'No session id in URL.'; document.querySelector('p').textContent = ''; return; }
    fetch('/api/auth/session', {
      method: 'POST',
      credentials: 'include',
      headers: {'Content-Type':'application/json','Accept':'application/json'},
      body: JSON.stringify({ session_id: sid, handoff_id: handoff })
    }).then(function(r){ return r.json().then(function(j){ return {ok:r.ok, body:j}; }); })
      .then(function(res){
        if (res.ok) {
          if (handoff) {
            // Native app is polling — show a friendly "you're done"
            // screen with a button so the user can clearly close the
            // browser and return to ConsultUro. The APK retrieves the
            // session via GET /api/auth/handoff/<id>.
            document.querySelector('h1').textContent = "You're signed in ✓";
            document.querySelector('p').textContent = 'You can return to the ConsultUro app now — it will pick up your session in a moment.';
            manual.textContent = 'Return to ConsultUro';
            manual.href = deep;
            // Try one more deep-link attempt now that the session is ready.
            setTimeout(function(){
              try { window.location.href = deep; } catch(e) {}
              setTimeout(tryClick, 200);
            }, 200);
            return;
          }
          window.location.replace('/');
        }
        else { document.querySelector('h1').textContent = 'Sign-in failed'; document.querySelector('p').textContent = (res.body && res.body.detail) || 'Please try again.'; }
      })
      .catch(function(){ document.querySelector('h1').textContent = 'Network error'; document.querySelector('p').textContent = 'Please try again in a moment.'; });
  }
  setTimeout(doExchange, 50);
})();
</script></body></html>"""
    html = html.replace("__PATH_HANDOFF__", safe_handoff)
    return HTMLResponse(content=html, status_code=200)




# (moved) auth block (L1141-1228) → /app/backend/routers/auth.py


# -- Native auth handoff (deep-link bypass) -------------------------------
# (moved) class HandoffInitBody → /app/backend/models.py


# (moved) auth block (L1235-1244) → /app/backend/routers/auth.py


# (moved) auth block (L1247-1269) → /app/backend/routers/auth.py


# (moved) auth block (L1272-1299) → /app/backend/routers/auth.py



# ──────────────────────────────────────────────────────────────────
# Profile quick-stats — small numeric tiles rendered in the right edge
# of the Profile screen header. Two stats per role:
#   • Staff   →  Today's bookings  +  Pending consultations
#   • Patient →  Total bookings    +  Total records
# Cheap to compute (count_documents on indexed fields). Refreshes on
# screen focus.
# ──────────────────────────────────────────────────────────────────
# (moved) STAFF_QUICKSTAT_ROLES → /app/backend/routers/profile.py


# (moved) GET /api/profile/quick-stats → /app/backend/routers/profile.py



# ──────────────────────────────────────────────────────────────────
# Email-based sign-in alternatives (Magic Link + OTP)
# ──────────────────────────────────────────────────────────────────
import secrets as _secrets
import resend as _resend

_resend.api_key = os.environ.get("RESEND_API_KEY") or ""
RESEND_FROM = os.environ.get("RESEND_FROM_EMAIL") or "ConsultUro <onboarding@resend.dev>"


async def _ensure_user_for_email(email: str) -> dict:
    """Find or create a user for the given email and return the doc."""
    email_l = email.strip().lower()
    existing = await db.users.find_one({"email": email_l}, {"_id": 0})
    if existing:
        # Refresh role from team-roles registry in case it was updated
        perms = await resolve_role_for_email(email_l)
        await db.users.update_one(
            {"user_id": existing["user_id"]},
            {"$set": {
                "role": perms["role"],
                "can_approve_bookings": perms["can_approve_bookings"],
                "can_approve_broadcasts": perms["can_approve_broadcasts"],
            }},
        )
        return await db.users.find_one({"email": email_l}, {"_id": 0})

    perms = await resolve_role_for_email(email_l)
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    await db.users.insert_one({
        "user_id": user_id,
        "email": email_l,
        "name": email_l.split("@")[0].replace(".", " ").title(),
        "role": perms["role"],
        "can_approve_bookings": perms["can_approve_bookings"],
        "can_approve_broadcasts": perms["can_approve_broadcasts"],
        "created_at": datetime.now(timezone.utc),
    })
    return await db.users.find_one({"email": email_l}, {"_id": 0})


from services.email import _send_email  # (extracted)


# ── Magic Link ───────────────────────────────────────────────────
# (moved) class MagicRequestBody → /app/backend/models.py


# (moved) class MagicExchangeBody → /app/backend/models.py


# (moved) auth block (L1406-1438) → /app/backend/routers/auth.py


# (moved) auth block (L1441-1503) → /app/backend/routers/auth.py


# (moved) auth block (L1506-1527) → /app/backend/routers/auth.py


# ── Email OTP ────────────────────────────────────────────────────
# (moved) class OtpRequestBody → /app/backend/models.py


# (moved) class OtpVerifyBody → /app/backend/models.py


# (moved) auth block (L1537-1575) → /app/backend/routers/auth.py


# (moved) auth block (L1578-1604) → /app/backend/routers/auth.py


# ── Firebase Phone Auth ──────────────────────────────────────────
# Frontend gets a Firebase ID token from Phone-Auth flow, posts it here;
# we lookup the phone number via Firebase Identity Toolkit REST and issue
# our own session_token (matching the rest of the auth model).
# (moved) class FirebasePhoneVerifyBody → /app/backend/models.py


FIREBASE_API_KEY = os.environ.get("FIREBASE_WEB_API_KEY") or "AIzaSyA8oPYsTL2OV9DvbGrUu8CM3DdszL3q4g4"


# (moved) auth block (L1617-1683) → /app/backend/routers/auth.py


# ── Profile linking — let signed-in users add the missing identifier ─
# (moved) class LinkPhoneBody → /app/backend/models.py


# (moved) auth block (L1690-1710) → /app/backend/routers/auth.py


# (moved) class LinkEmailBody → /app/backend/models.py


# (moved) auth block (L1716-1744) → /app/backend/routers/auth.py


# (moved) class LinkEmailVerifyBody → /app/backend/models.py


# (moved) auth block (L1750-1764) → /app/backend/routers/auth.py


# (moved) auth block (L1767-1781) → /app/backend/routers/auth.py


# ============================================================
# DOCTOR INFO
# ============================================================


# (moved) GET /api/doctor → /app/backend/routers/doctor.py


# ============================================================
# DISEASES
# ============================================================

# Category-based image URLs used on the disease detail hero banners.
# Sourced from professional Unsplash/Pexels medical stock imagery.
#
# Original 9 shared buckets (kept for backward-compat + default fallbacks):
_IMG_KIDNEY = "https://images.pexels.com/photos/18272488/pexels-photo-18272488.jpeg?auto=compress&cs=tinysrgb&w=1200"
_IMG_PROSTATE = "https://images.unsplash.com/photo-1638202993928-7267aad84c31?auto=format&fit=crop&w=1200&q=70"
_IMG_BLADDER = "https://images.pexels.com/photos/18272488/pexels-photo-18272488.jpeg?auto=compress&cs=tinysrgb&w=1200"
_IMG_MALE = "https://images.unsplash.com/photo-1768644675767-40b294727e10?auto=format&fit=crop&w=1200&q=70"
_IMG_CONSULT = "https://images.unsplash.com/photo-1666214277730-e9c7e755e5a3?auto=format&fit=crop&w=1200&q=70"
_IMG_SURGERY = "https://images.pexels.com/photos/7108257/pexels-photo-7108257.jpeg?auto=compress&cs=tinysrgb&w=1200"
_IMG_LAB = "https://images.pexels.com/photos/7723391/pexels-photo-7723391.jpeg?auto=compress&cs=tinysrgb&w=1200"
_IMG_DOCTOR = "https://images.pexels.com/photos/8376222/pexels-photo-8376222.jpeg?auto=compress&cs=tinysrgb&w=1200"
_IMG_ANATOMY = "https://images.pexels.com/photos/30133402/pexels-photo-30133402.jpeg?auto=compress&cs=tinysrgb&w=1200"

# Condition-appropriate specific imagery added on 2026-04 so every disease
# gets a unique visual (no more "same doctor photo" for 30 conditions).
_IMG_URINE_SAMPLE = "https://images.unsplash.com/photo-1585583983067-a7535737691f?auto=format&fit=crop&w=1200&q=70"
_IMG_SPECIMEN = "https://images.unsplash.com/photo-1584028377143-21f876eb9c1e?auto=format&fit=crop&w=1200&q=70"
_IMG_HEALTH_SAMPLE = "https://images.pexels.com/photos/24193876/pexels-photo-24193876.jpeg?auto=compress&cs=tinysrgb&w=1200"
_IMG_TEST_TUBES = "https://images.pexels.com/photos/8442376/pexels-photo-8442376.jpeg?auto=compress&cs=tinysrgb&w=1200"
_IMG_USG_IMAGES = "https://images.pexels.com/photos/6463624/pexels-photo-6463624.jpeg?auto=compress&cs=tinysrgb&w=1200"
_IMG_USG_MONITOR = "https://images.pexels.com/photos/7089623/pexels-photo-7089623.jpeg?auto=compress&cs=tinysrgb&w=1200"
_IMG_MICROSCOPE = "https://images.unsplash.com/photo-1526930382372-67bf22c0fce2?auto=format&fit=crop&w=1200&q=70"
_IMG_DR_CONSULT = "https://images.unsplash.com/photo-1536064479547-7ee40b74b807?auto=format&fit=crop&w=1200&q=70"
_IMG_DR_USG = "https://images.pexels.com/photos/7089394/pexels-photo-7089394.jpeg?auto=compress&cs=tinysrgb&w=1200"
_IMG_DR_TABLET = "https://images.pexels.com/photos/5327864/pexels-photo-5327864.jpeg?auto=compress&cs=tinysrgb&w=1200"
_IMG_DR_TESTTUBE = "https://images.unsplash.com/photo-1579165466991-467135ad3110?auto=format&fit=crop&w=1200&q=70"
_IMG_DR_COAT = "https://images.pexels.com/photos/4309557/pexels-photo-4309557.jpeg?auto=compress&cs=tinysrgb&w=1200"
_IMG_STETHO_CLOSE = "https://images.pexels.com/photos/20100299/pexels-photo-20100299.jpeg?auto=compress&cs=tinysrgb&w=1200"

DISEASE_IMAGE_MAP: Dict[str, str] = {
    # --- Kidney & stone disease ----------------------------------------
    "kidney-stones": _IMG_KIDNEY,                 # kidney macro image
    "ureteric-stricture": _IMG_USG_MONITOR,       # diagnostic imaging
    "hydronephrosis": _IMG_USG_IMAGES,            # ultrasound scans of kidney
    "puj-obstruction": _IMG_SURGERY,              # endoscopic surgery
    "kidney-cancer": _IMG_USG_MONITOR,            # CT / USG diagnostic look
    "ckd": _IMG_DR_TABLET,                        # nephrology follow-up
    "aki": _IMG_STETHO_CLOSE,                     # acute / clinical
    "pcos-kidney": _IMG_DR_USG,                   # doctor reviewing USG

    # --- Prostate ------------------------------------------------------
    "bph-prostate": _IMG_PROSTATE,
    "prostate-cancer": _IMG_MICROSCOPE,           # biopsy / pathology vibe

    # --- Bladder -------------------------------------------------------
    "bladder-cancer": _IMG_USG_MONITOR,           # cystoscopy / imaging
    "overactive-bladder": _IMG_BLADDER,
    "interstitial-cystitis": _IMG_DR_COAT,        # clinical consult
    "neurogenic-bladder": _IMG_ANATOMY,

    # --- Urinary tract / UTI / hematuria -------------------------------
    "uti": _IMG_URINE_SAMPLE,                     # red-lid urine container
    "hematuria": _IMG_SPECIMEN,                   # specimen container
    "urethral-stricture": _IMG_MICROSCOPE,        # endoscopic view

    # --- Incontinence --------------------------------------------------
    "incontinence": _IMG_DR_CONSULT,              # consultation
    "stress-incontinence": _IMG_DR_TESTTUBE,      # research / evaluation
    "nocturnal-enuresis": _IMG_DR_TABLET,         # paediatric follow-up

    # --- Male sexual / andrology --------------------------------------
    "erectile-dysfunction": _IMG_CONSULT,         # doctor consult (discreet)
    "male-infertility": _IMG_TEST_TUBES,          # andrology lab
    "peyronies": _IMG_HEALTH_SAMPLE,              # clinical workup
    "priapism": _IMG_STETHO_CLOSE,                # urgent / clinical

    # --- Scrotal / paediatric -----------------------------------------
    "testicular-cancer": _IMG_DR_COAT,
    "phimosis": _IMG_DR_CONSULT,
    "hydrocele": _IMG_HEALTH_SAMPLE,
    "varicocele": _IMG_USG_IMAGES,                # doppler USG
    "undescended-testis": _IMG_DR_USG,            # paediatric USG

    # --- Procedures ----------------------------------------------------
    "kidney-transplant": _IMG_SURGERY,

    # --- Additional conditions (previously falling back to default) ----
    "prostatitis": _IMG_DR_USG,                   # pelvic imaging
    "pmph": _IMG_PROSTATE,                        # premalignant prostate
    "neobladder": _IMG_SURGERY,                   # reconstructive surgery
    "female-urology": _IMG_DR_CONSULT,
    "paediatric-urology": _IMG_DR_USG,            # paediatric USG feel
    "vur": _IMG_USG_IMAGES,                       # MCU imaging
    "hypospadias": _IMG_DR_COAT,                  # paediatric surgery
    "paraphimosis": _IMG_DR_CONSULT,              # urgent consult
    "overactive-kidney-cyst": _IMG_USG_MONITOR,   # kidney cysts on USG
    "androgen-deficiency": _IMG_TEST_TUBES,       # hormone lab
    "hematospermia": _IMG_SPECIMEN,               # semen sample workup
}

_DEFAULT_DISEASE_IMAGE = _IMG_CONSULT


def disease_image(did: str) -> str:
    return DISEASE_IMAGE_MAP.get(did, _DEFAULT_DISEASE_IMAGE)


# (removed) Dead inline DISEASES list (~450 lines) — was unreferenced
# after Phase 2 extracted /api/diseases routes to routers/diseases.py.
# disease_content.py is now the canonical source for trilingual data.


from disease_content import (
    list_localized as _dis_list_localized,
    get_localized as _dis_get_localized,
)


# (moved) /api/diseases → /app/backend/routers/diseases.py


# (moved) /api/diseases/{disease_id} → /app/backend/routers/diseases.py


# ============================================================
# BOOKINGS
# ============================================================


async def require_approver(user=Depends(require_user)) -> Dict[str, Any]:
    """Pass for owner-tier OR any staff member whose
    `can_approve_bookings` flag has been enabled by a Primary Owner
    / Partner. The `doctor` role no longer auto-passes — it must be
    explicitly granted, same as for any other team-member role.
    """
    role = user.get("role")
    if role in OWNER_TIER_ROLES:
        return user
    if role in STAFF_ROLES and user.get("can_approve_bookings"):
        return user
    raise HTTPException(status_code=403, detail="Not allowed to approve bookings")


# (moved) bookings block (L1906-2043) → /app/backend/routers/bookings.py


# (moved) bookings block (L2046-2055) → /app/backend/routers/bookings.py


# (moved) bookings block (L2058-2061) → /app/backend/routers/bookings.py


# ---- Guest (anonymous) bookings lookup by phone ---------------------------
# Declared BEFORE /api/bookings/{booking_id} so that the literal path
# segment "guest" is matched before the path parameter catches it.
# (moved) bookings block (L2067-2080) → /app/backend/routers/bookings.py


# Declared BEFORE /api/bookings/{booking_id} for the same reason as /guest.
# (moved) bookings block (L2084-2106) → /app/backend/routers/bookings.py


# (moved) bookings block (L2109-2146) → /app/backend/routers/bookings.py


# ============================================================
# CSV EXPORTS (owner only)
# ============================================================
import csv as _csv
import io as _io


def _csv_response(rows: List[List[Any]], filename: str) -> StreamingResponse:
    """Turn a list-of-rows into a CSV streaming response."""
    buf = _io.StringIO()
    writer = _csv.writer(buf, quoting=_csv.QUOTE_MINIMAL)
    for r in rows:
        writer.writerow(["" if v is None else str(v) for v in r])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )


def _fmt_dt(v: Any) -> str:
    if not v:
        return ""
    if isinstance(v, datetime):
        return v.astimezone(timezone.utc).isoformat()
    return str(v)


# (moved) export block (L2181-2224) → /app/backend/routers/export.py


# (moved) export block (L2227-2253) → /app/backend/routers/export.py


# (moved) export block (L2256-2278) → /app/backend/routers/export.py


# (moved) bookings block (L2281-2592) → /app/backend/routers/bookings.py


# ---- Patient-initiated cancellation ---------------------------------------
# (moved) bookings block (L2596-2675) → /app/backend/routers/bookings.py


def _urlencode(s: str) -> str:
    from urllib.parse import quote
    return quote(s, safe="")


# ============================================================
# IPSS
# ============================================================


# (moved) ipss block (L3162-3176) → /app/backend/routers/ipss.py


# (moved) ipss block (L3179-3182) → /app/backend/routers/ipss.py


# ============================================================
# PRESCRIPTIONS (doctor/owner only)
# ============================================================


# ──────────────────────────────────────────────────────────────────
# PDF rendering bridge.
# Frontend sends the same HTML it previously printed via expo-print,
# we hand it to WeasyPrint (Cairo/Pango) and stream the PDF back.
# This makes Print/Download/Share consistent across web AND native
# (file URL is a real on-disk PDF, not an HTML preview).
# ──────────────────────────────────────────────────────────────────
# (moved) class RenderPdfBody → /app/backend/models.py


# (moved) render block (L2709-2743) → /app/backend/routers/render.py


# ──────────────────────────────────────────────────────────────────
# WeasyPrint warmup. The very first render after process start can
# take 5-15 s while Cairo/Pango lazy-load shared libraries and font
# caches build. We pre-render a tiny dummy PDF on startup (in a
# background thread so it never blocks app boot) to push that cost
# off the first user request — they then see the steady-state
# render time (~1-3 s) for the very first prescription.
# ──────────────────────────────────────────────────────────────────
async def _warmup_pdf_engine() -> None:
    try:
        from weasyprint import HTML  # type: ignore
    except Exception:
        return  # WeasyPrint not installed — render endpoint will 503 anyway
    import asyncio
    def _go() -> None:
        try:
            HTML(string="<html><body><h1>warmup</h1></body></html>").write_pdf()
        except Exception:
            pass  # warmup failures are non-fatal
    try:
        await asyncio.to_thread(_go)
    except Exception:
        pass


@app.on_event("startup")
async def _kickoff_pdf_warmup() -> None:
    # Don't block server startup — fire-and-forget the warmup.
    import asyncio
    asyncio.create_task(_warmup_pdf_engine())


# (moved) prescriptions block (L2778-2850) → /app/backend/routers/prescriptions.py


# (moved) prescriptions block (L2853-2861) → /app/backend/routers/prescriptions.py


# (moved) prescriptions block (L2864-2922) → /app/backend/routers/prescriptions.py


# (moved) prescriptions block (L2925-2933) → /app/backend/routers/prescriptions.py


# (moved) prescriptions block (L2936-2939) → /app/backend/routers/prescriptions.py


# (moved) prescriptions block (L2942-2964) → /app/backend/routers/prescriptions.py


# (moved) rx_verify block (L2967-3000) → /app/backend/routers/rx_verify.py


def _verify_page_html(
    *,
    ok: bool,
    rx_id: str,
    issued_at: Optional[str],
    patient_initials: Optional[str],
    med_count: int,
) -> str:
    status_badge = (
        '<div style="background:#DCFCE7;color:#166534;padding:8px 16px;border-radius:999px;display:inline-flex;align-items:center;gap:6px;font-weight:600;font-size:14px;">'
        '<span style="font-size:18px;">✓</span> Authentic prescription</div>'
        if ok
        else '<div style="background:#FEE2E2;color:#991B1B;padding:8px 16px;border-radius:999px;display:inline-flex;align-items:center;gap:6px;font-weight:600;font-size:14px;">'
        '<span style="font-size:18px;">✗</span> No record found</div>'
    )
    rows = ""
    if ok:
        rows = (
            f'<div style="margin-top:18px;border-top:1px solid #E5E7EB;padding-top:14px;">'
            f'<div style="color:#6B7280;font-size:12px;text-transform:uppercase;letter-spacing:.6px;margin-bottom:3px;">Prescription ID</div>'
            f'<div style="font-family:monospace;font-size:14px;color:#111827;word-break:break-all;">{htmllib.escape(rx_id)}</div>'
            f'<div style="color:#6B7280;font-size:12px;text-transform:uppercase;letter-spacing:.6px;margin:12px 0 3px;">Patient</div>'
            f'<div style="font-size:15px;color:#111827;">{htmllib.escape(patient_initials or "—")}</div>'
            f'<div style="color:#6B7280;font-size:12px;text-transform:uppercase;letter-spacing:.6px;margin:12px 0 3px;">Issued at</div>'
            f'<div style="font-size:15px;color:#111827;">{htmllib.escape(issued_at or "—")}</div>'
            f'<div style="color:#6B7280;font-size:12px;text-transform:uppercase;letter-spacing:.6px;margin:12px 0 3px;">Medicines</div>'
            f'<div style="font-size:15px;color:#111827;">{med_count} item{"s" if med_count != 1 else ""}</div>'
            f'</div>'
        )
    else:
        rows = (
            f'<p style="color:#6B7280;font-size:14px;line-height:1.5;margin-top:10px;">We could not find a prescription with ID <code style="background:#F3F4F6;padding:2px 6px;border-radius:4px;">{htmllib.escape(rx_id)}</code>. '
            f'Please confirm the QR/ID with your doctor.</p>'
        )
    return f'''<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Verify Prescription · ConsultUro</title>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin:0; background:#F3F6F7; color:#1A2E35; }}
  .wrap {{ max-width: 420px; margin: 40px auto; padding: 0 16px; }}
  .head {{ background: linear-gradient(135deg,#0A5E6B,#0E7C8B,#16A6B8); color:#fff; padding: 24px 20px; border-radius: 16px 16px 0 0; }}
  .head h1 {{ margin:0; font-size:22px; }}
  .head p {{ margin: 4px 0 0; opacity: .9; font-size:13px; }}
  .card {{ background:#fff; padding: 20px; border-radius: 0 0 16px 16px; box-shadow: 0 8px 30px rgba(10,94,107,.08); }}
  .footer {{ text-align:center; color:#6B7280; font-size:11px; margin-top: 14px; line-height:1.6; }}
  a {{ color:#0E7C8B; text-decoration:none; font-weight:600; }}
</style></head>
<body>
<div class="wrap">
  <div class="head">
    <h1>ConsultUro</h1>
    <p>Dr. Sagar Joshi · Consultant Urologist</p>
  </div>
  <div class="card">
    {status_badge}
    {rows}
  </div>
  <div class="footer">
    Issued digitally. Clinical details are visible only on the physical prescription given to the patient.<br/>
    <a href="https://www.drsagarjoshi.com">www.drsagarjoshi.com</a>
  </div>
</div>
</body></html>'''


# ============================================================
# TEAM MANAGEMENT (owner only)
# ============================================================


# (moved) admin_extras block (L3075-3126) → /app/backend/routers/admin_extras.py


def _human_bytes(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024.0:
            return f"{n:.1f} {unit}"
        n /= 1024.0
    return f"{n:.1f} TB"


# (moved) team block (L3611-3657) → /app/backend/routers/team.py


# (moved) team block (L3660-3711) → /app/backend/routers/team.py


# (moved) team block (L3714-3764) → /app/backend/routers/team.py


# -------- Custom Role Labels (owner only manages) -------- #

# (moved) team block (L3769-3783) → /app/backend/routers/team.py


# (moved) team block (L3786-3807) → /app/backend/routers/team.py


# (moved) team block (L3810-3818) → /app/backend/routers/team.py


# (moved) team block (L3821-3831) → /app/backend/routers/team.py


# ============================================================
# SURGERIES (doctor-added log of procedures per patient)
# ============================================================


# (moved) surgeries block (L3165-3205) → /app/backend/routers/surgeries.py


# (moved) surgeries block (L3208-3211) → /app/backend/routers/surgeries.py


# (moved) surgeries block (L3214-3274) → /app/backend/routers/surgeries.py


# (moved) surgeries block (L3277-3290) → /app/backend/routers/surgeries.py


# (moved) surgeries block (L3293-3298) → /app/backend/routers/surgeries.py


# (moved) surgeries block (L3301-3442) → /app/backend/routers/surgeries.py


# Preset list of common urological procedures (from Dr. Sagar Joshi's logbook)
COMMON_PROCEDURES = [
    # Endoscopic stone
    "Right URS", "Left URS", "Bilateral URS",
    "Right RIRS", "Left RIRS", "Bilateral RIRS",
    "Right URS + Right DJ Stenting", "Left URS + Left DJ Stenting", "Bilateral URS + Bilateral DJ Stenting",
    "Right DJ Stenting", "Left DJ Stenting", "Bilateral DJ Stenting",
    "Right DJ Stent Removal", "Left DJ Stent Removal", "Bilateral DJ Stent Removal",
    "Right PCNL", "Left PCNL", "Mini-PCNL",
    "Right PCN Insertion", "Left PCN Insertion", "Bilateral PCN Insertion",
    # Bladder / Prostate
    "Cystoscopy", "Cystoscopy + Bilateral RGP",
    "TURBT", "TURBT + Cystoscopy",
    "TURP", "Channel TURP", "Channel TURP + Bilateral Orchiectomy",
    "HoLEP", "ThuLEP", "Bipolar TURP",
    # Male / Genitourinary
    "Circumcision", "Stapler Circumcision",
    "Hydrocelectomy", "Varicocelectomy",
    "Orchidopexy", "Orchiectomy", "Bilateral Orchiectomy",
    # Reconstructive / Open
    "Pyeloplasty (open)", "Laparoscopic Pyeloplasty",
    "Radical Nephrectomy", "Partial Nephrectomy", "Simple Nephrectomy",
    "Radical Prostatectomy", "Radical Cystectomy",
    "Ureteric Reimplantation",
    # Transplant
    "Living Donor Kidney Transplant", "Deceased Donor Kidney Transplant",
    "Donor Nephrectomy (Laparoscopic)",
    # Others
    "ESWL", "Suprapubic Catheter Insertion", "Urethral Dilatation",
]


# (moved) surgeries block (L3477-3479) → /app/backend/routers/surgeries.py


# ============================================================
# PATIENT SELF-PROFILE / MY RECORDS
# ============================================================


# (moved) class MyProfileBody → /app/backend/models.py


# (moved) auth block (L3964-3973) → /app/backend/routers/auth.py


# ============================================================
# DOCTOR AVAILABILITY (weekly template)
# ============================================================


DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


def _default_availability() -> Dict[str, Any]:
    """Default: Mon-Sat 10:00-13:00 in-person, 17:00-20:00 online. Sunday off."""
    return {
        "mon_in": [{"start": "10:00", "end": "13:00"}],
        "tue_in": [{"start": "10:00", "end": "13:00"}],
        "wed_in": [{"start": "10:00", "end": "13:00"}],
        "thu_in": [{"start": "10:00", "end": "13:00"}],
        "fri_in": [{"start": "10:00", "end": "13:00"}],
        "sat_in": [{"start": "10:00", "end": "13:00"}],
        "sun_in": [],
        "mon_on": [{"start": "17:00", "end": "20:00"}],
        "tue_on": [{"start": "17:00", "end": "20:00"}],
        "wed_on": [{"start": "17:00", "end": "20:00"}],
        "thu_on": [{"start": "17:00", "end": "20:00"}],
        "fri_on": [{"start": "17:00", "end": "20:00"}],
        "sat_on": [],
        "sun_on": [],
        "off_days": ["sun"],
        "note": "",
    }


# (moved) availability block (L4223-4228) → /app/backend/routers/availability.py


# (moved) availability block (L4231-4241) → /app/backend/routers/availability.py


# (moved) availability block (L4244-4269) → /app/backend/routers/availability.py


def _slot_to_minutes(slot: str) -> int:
    try:
        h, m = slot.split(":")
        return int(h) * 60 + int(m)
    except Exception:
        return 0


async def _unavailability_block_reason(
    booking_date: str, booking_time: str
) -> Optional[str]:
    """Return a human-readable reason if the (date, time) intersects an
    unavailability rule (single-date or recurring-weekly). Returns None
    when the slot is free of any rule. Used by POST /api/bookings and
    PATCH /api/bookings/{id} so writes honour the same rules as the
    public slot listing — closing the gap where a hand-crafted request
    could sneak through despite the slot being hidden.
    """
    try:
        d = datetime.strptime(booking_date, "%Y-%m-%d")
    except ValueError:
        return None
    weekday = d.weekday()
    rules = await db.unavailabilities.find(
        {
            "$or": [
                {"date": booking_date},
                {"recurring_weekly": True, "day_of_week": weekday},
            ]
        },
        {"_id": 0},
    ).to_list(length=100)
    if not rules:
        return None
    # All-day rules block everything.
    for rule in rules:
        if bool(rule.get("all_day", True)):
            return rule.get("reason") or "Doctor unavailable on this day."
    # Time-range rules block when the slot starts inside the window.
    m = _slot_to_minutes(booking_time or "")
    for rule in rules:
        if rule.get("all_day"):
            continue
        s = _slot_to_minutes(rule.get("start_time", ""))
        e = _slot_to_minutes(rule.get("end_time", ""))
        if e <= s:
            continue
        if s <= m < e:
            return rule.get("reason") or "Doctor unavailable during the requested hours."
    return None


# (moved) availability block (L4324-4501) → /app/backend/routers/availability.py


# ============================================================
# UNAVAILABILITY — doctor / owner / full-access manage
# ============================================================
# (moved) class UnavailabilityBody → /app/backend/models.py


# (moved) availability block (L4510-4533) → /app/backend/routers/availability.py


# (moved) availability block (L4536-4578) → /app/backend/routers/availability.py


# (moved) availability block (L4581-4586) → /app/backend/routers/availability.py


async def _notify_affected_bookings(rule: Dict[str, Any]):
    """Find currently-open bookings that now collide with a fresh
    unavailability rule and (if a notification system exists) ping them.
    Currently a no-op stub — the frontend lists "affected bookings" so the
    doctor can manually reach out. Keeps the API forward-compatible."""
    return None


# (moved) records block (L3610-3670) → /app/backend/routers/records.py


# ============================================================
# BLOG — pulled live from drsagarjoshi.com (Blogger feed)
# ============================================================


_IMG_RE = re.compile(r'<img[^>]+src="([^"]+)"', re.IGNORECASE)
_TAG_RE = re.compile(r"<[^>]+>")


from services.blog_helpers import _extract_first_img  # (extracted)


from services.blog_helpers import _strip_html  # (extracted)


_BLOG_CACHE: Dict[str, Any] = {"at": None, "data": []}


from services.blog_helpers import _load_blog_from_blogger  # (extracted)


# (moved) blog block (L4428-4450) → /app/backend/routers/blog.py


# (moved) blog block (L4453-4472) → /app/backend/routers/blog.py


from services.blog_helpers import _admin_to_html  # (extracted)


# ============================================================
# ADMIN BLOG COMPOSER (owner only)
# ============================================================


# (moved) blog block (L4491-4518) → /app/backend/routers/blog.py


# (moved) blog block (L4521-4543) → /app/backend/routers/blog.py


# (moved) blog block (L4546-4567) → /app/backend/routers/blog.py


# (moved) blog block (L4570-4579) → /app/backend/routers/blog.py


# (moved) blog block (L4582-4594) → /app/backend/routers/blog.py


# ============================================================
# VIDEOS (YouTube Data API v3) + EDUCATION
# ============================================================


VIDEOS_SEED = [
    {"id": "v1", "title": "Kidney Stones — Causes, Symptoms & Treatment", "youtube_id": "dQw4w9WgXcQ", "thumbnail": "https://images.unsplash.com/photo-1559757148-5c350d0d3c56?w=800&q=80", "duration": "", "category": "Urology"},
]


# (moved) education block (L4911-4949) → /app/backend/routers/education.py


EDUCATION = [
    {"id": "kegel-exercises", "title": "Kegel (Pelvic Floor) Exercises", "summary": "Strengthen pelvic floor muscles to treat incontinence and improve sexual health.", "cover": "https://images.unsplash.com/photo-1518611012118-696072aa579a?w=800&q=80",
     "steps": ["Identify the right muscles: imagine stopping your urine mid-flow — those are the pelvic-floor muscles. (Do NOT repeatedly do this during urination, only to identify the muscles.)", "Empty your bladder and sit or lie down comfortably.", "Tighten the muscles and hold the contraction for 5 seconds.", "Relax for 5 seconds. Work up to 10-second holds with 10-second rests.", "Aim for 3 sets of 10 repetitions every day.", "Breathe normally throughout — do not hold your breath or squeeze your abdomen, thighs or buttocks.", "Results typically appear in 4–6 weeks of consistent practice."]},
    {"id": "bladder-training", "title": "Bladder Training", "summary": "Retrain your bladder to hold urine longer and reduce urgency / frequency.", "cover": "https://images.unsplash.com/photo-1559757148-5c350d0d3c56?w=800&q=80",
     "steps": ["Keep a bladder diary for 3 days — note each time you urinate and the volume.", "From the diary, find your current interval (e.g. every 60 minutes).", "Schedule voids at that interval — go even if you do not feel the urge.", "Increase the interval by 15 minutes each week until you reach 3–4 hours between voids.", "When urgency strikes early, sit down, take slow breaths and do 5 quick Kegels — the urge will pass.", "Limit bladder irritants: caffeine, carbonated drinks, alcohol and artificial sweeteners.", "Maintain normal fluid intake — restricting fluids concentrates urine and worsens symptoms."]},
    {"id": "fluid-management", "title": "Fluid Management for Urology Patients", "summary": "How much and what to drink for kidneys, stones and the prostate.", "cover": "https://images.unsplash.com/photo-1550505095-81378a674395?w=800&q=80",
     "steps": ["Aim for 2.5–3 litres of plain water/day (unless you have heart or kidney failure).", "Your urine should be pale straw-coloured; dark urine means you are dehydrated.", "Stop fluids 2 hours before bed to reduce night-time urination.", "For stone formers: add 1 lemon's juice or a sachet of potassium citrate daily.", "Limit coffee/tea to 2 cups/day — they are bladder irritants.", "Avoid alcohol and colas if you have urgency or recurrent UTIs."]},
    {"id": "pre-op-prep", "title": "Preparing for Urology Surgery", "summary": "A checklist of what to do before your operation.", "cover": "https://images.unsplash.com/photo-1551076805-e1869033e561?w=800&q=80",
     "steps": ["Bring ALL your medications and investigation reports to the pre-op visit.", "Inform the team if you are on blood thinners (Aspirin, Clopidogrel, Warfarin, DOACs).", "Stop smoking at least 2 weeks before — it reduces wound infections and chest complications.", "Fasting: clear fluids till 2 hours before, solid food till 6 hours before surgery.", "Pack loose comfortable clothes, slippers, and a charger for the hospital stay.", "Arrange a family member to stay with you for the first 24 hours post-surgery."]},
    {"id": "psa-testing", "title": "Understanding Your PSA Test", "summary": "What the numbers mean and when to act.", "cover": "https://images.unsplash.com/photo-1579154204601-01588f351e67?w=800&q=80",
     "steps": ["PSA is a protein made by the prostate — levels rise with age, BPH, infection and cancer.", "All men ≥50 should get an annual PSA (start at 45 with a family history).", "Avoid ejaculation, cycling and DRE for 48 hours before the test — they can falsely raise PSA.", "PSA > 4 ng/ml or a rapid rise (>0.75 ng/ml/year) needs urology review.", "MRI prostate and MRI-targeted biopsy are now preferred to blind biopsies.", "A normal PSA does NOT rule out cancer — still report urinary symptoms and blood in urine."]},
    {"id": "stone-prevention", "title": "Preventing Kidney Stones", "summary": "Lifestyle and dietary changes that cut recurrence by 50%.", "cover": "https://images.unsplash.com/photo-1559757175-5700dde675bc?w=800&q=80",
     "steps": ["Drink enough fluid to pass at least 2.5 litres of urine per day (~3 L intake).", "Add half a lemon/lime to 1 L water — citrate inhibits calcium-oxalate crystals.", "Moderate calcium: 2 glasses of milk or curd daily — avoid calcium supplements unless prescribed.", "Cut salt to <5 g/day — high salt increases urinary calcium loss.", "Limit animal protein: small portions of red meat, chicken or fish.", "Lose excess weight — obesity doubles stone risk.", "Avoid vitamin C mega-doses (>1 g/day) — they convert to oxalate."]},
    {"id": "uti-prevention", "title": "Preventing Recurrent UTI (Women)", "summary": "Practical steps to cut recurrence without daily antibiotics.", "cover": "https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=800&q=80",
     "steps": ["Drink 2 L water/day — consistent hydration flushes bacteria.", "Wipe front to back after using the toilet.", "Empty the bladder within 15 minutes after intercourse.", "Avoid douches, scented soaps and spermicides — they disturb vaginal flora.", "Consider D-mannose 2 g/day — evidence for E. coli prevention.", "Vaginal oestrogen cream for post-menopausal women (with gynaec input).", "Discuss low-dose prophylactic antibiotics only if ≥3 UTIs/year despite above."]},
    {"id": "post-surgery-care", "title": "Home Recovery After Urology Surgery", "summary": "Dos and don'ts for a smooth recovery.", "cover": "https://images.pexels.com/photos/7088530/pexels-photo-7088530.jpeg?auto=compress&cs=tinysrgb&w=1200",
     "steps": ["Walk short distances from day 1 — it prevents chest infections and clots.", "Drink 2–3 L water/day unless the surgeon advises fluid restriction.", "Take prescribed antibiotics for the full course; continue alpha-blockers until reviewed.", "Avoid heavy lifting (>5 kg), cycling and bike pillion for 4 weeks.", "Expect mild blood in urine for up to 2 weeks after stone / prostate surgery.", "Resume gentle sexual activity only after the follow-up review.", "Call the clinic immediately if you have fever, clot retention or inability to pass urine."]},
    {"id": "bph-lifestyle", "title": "Living with BPH (Enlarged Prostate)", "summary": "Daily habits that ease BPH symptoms.", "cover": "https://images.unsplash.com/photo-1556909114-44e3e9399a2f?w=800&q=80",
     "steps": ["Split fluid intake — big glass in the morning, small sips after 6 pm.", "Limit caffeine, alcohol, carbonated drinks and heavy curries in the evening.", "Urinate twice (double-voiding) — sit and relax for 30 seconds, then try again.", "Avoid medicines that worsen retention: cold remedies with pseudoephedrine, some antihistamines.", "Take alpha-blockers at night (dizziness risk — avoid driving for first dose).", "Take the IPSS questionnaire in the Tools tab every 3 months to track progress."]},
    {"id": "ed-overview", "title": "Erectile Dysfunction — First Steps", "summary": "Check your heart, lifestyle and hormones before pills.", "cover": "https://images.pexels.com/photos/4586709/pexels-photo-4586709.jpeg?auto=compress&cs=tinysrgb&w=1200",
     "steps": ["ED is often the first sign of vascular disease — get a cardiac check, BP and fasting sugar.", "Walk or jog 40 min daily, 5 days a week — the single best non-drug therapy.", "Stop smoking and cap alcohol to 2 standard drinks or less.", "Sleep 7–8 hours — most testosterone is produced during deep sleep.", "Check morning total testosterone, prolactin and fasting sugar.", "PDE5 inhibitors (sildenafil, tadalafil) work best taken on an empty stomach.", "Book a consultation if ED persists >3 months — we have non-pill options too."]},
    {"id": "catheter-care", "title": "Foley Catheter Home Care", "summary": "Keeping your catheter clean, functional and infection-free.", "cover": "https://images.unsplash.com/photo-1559757148-5c350d0d3c56?w=800&q=80",
     "steps": ["Wash hands with soap before handling the catheter or bag.", "Clean the catheter at the urethral meatus twice daily with plain soap & water.", "Keep the drainage bag below bladder level at all times — this prevents reflux.", "Empty the bag when it is 2/3 full to avoid traction on the urethra.", "Drink 2–3 L water/day unless restricted — dilute urine prevents encrustation.", "Report at once: no urine drainage for >2 hours, fever, blood clots, severe pain.", "Change the leg bag weekly and the large bag at the clinic every 2–4 weeks."]},
    {"id": "dj-stent-care", "title": "Living with a DJ (Ureteric) Stent", "summary": "What to expect and what to avoid.", "cover": "https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=800&q=80",
     "steps": ["A DJ stent keeps your ureter open after a URS / RIRS — it is a temporary soft tube.", "Flank pain on urination and urgency are common — they improve with fluids and painkillers.", "Drink 2–3 L water a day; avoid heavy gym workouts for the first 2 weeks.", "Pink urine and mild burning are expected; heavy clots or high fever are NOT — call us.", "A stent is ALWAYS temporary. Book the removal appointment (usually 2–4 weeks).", "Never delay stent removal — an encrusted stent is a serious complication."]},
    {"id": "travel-kidney-stones", "title": "Travelling with Kidney Stones", "summary": "Tips so a stone doesn't ruin your trip.", "cover": "https://images.unsplash.com/photo-1503220317375-aaad61436b1b?w=800&q=80",
     "steps": ["Carry a letter from your urologist listing diagnosis and medications.", "Pack a week's extra supply of painkillers, anti-nausea and tamsulosin.", "Identify the nearest emergency room at your destination (save in your phone).", "Keep hydrated on flights — one cup of water per hour of flight.", "Avoid alcohol, colas and salted snacks on the plane.", "If you get a stone attack mid-travel, a CT or ultrasound followed by DJ stenting is usually enough to let you continue travel — then complete treatment back home."]},
    {"id": "vasectomy-guide", "title": "Vasectomy — What to Expect", "summary": "A safe, reliable, permanent contraception option for men.", "cover": "https://images.unsplash.com/photo-1559757148-5c350d0d3c56?w=800&q=80",
     "steps": ["Out-patient procedure done under local anaesthetic in 15–20 minutes.", "Mild discomfort for 2–3 days — take paracetamol and wear a supportive underwear.", "Avoid intercourse for 7 days and heavy lifting for 14 days.", "Use an alternative contraceptive for 3 months and until semen analysis shows no sperm.", "Complication risk (haematoma, infection, chronic pain) is <2%.", "Vasectomy does NOT affect erection, libido or volume of ejaculation."]},
    {"id": "circumcision-care", "title": "Circumcision Aftercare", "summary": "How to heal quickly and avoid infection.", "cover": "https://images.unsplash.com/photo-1586015555751-63b9c7bab62c?w=800&q=80",
     "steps": ["Keep the dressing dry and untouched for 24 hours.", "After 24 hours, take short warm-water baths — do NOT use soap on the wound for 7 days.", "Apply the prescribed antibiotic ointment twice daily for 7 days.", "Wear loose cotton underwear; avoid tight jeans or cycling for 3 weeks.", "Avoid intercourse or masturbation for 4 weeks to let the wound mature.", "Call the clinic if you see pus, severe swelling, or inability to pass urine."]},
    {"id": "pregnancy-urology", "title": "Urology in Pregnancy", "summary": "Safe management of stones, UTIs and hydronephrosis.", "cover": "https://images.unsplash.com/photo-1576671081837-49000212a370?w=800&q=80",
     "steps": ["Mild right-sided hydronephrosis is normal in pregnancy and rarely needs intervention.", "Bacteriuria must be treated even if asymptomatic — untreated UTIs cause preterm labour.", "Use pregnancy-safe antibiotics: nitrofurantoin, cephalosporins, fosfomycin.", "Avoid fluoroquinolones, tetracyclines and sulfamethoxazole in pregnancy.", "Ureteric stone pain — MRI is preferred; if intervention is needed, DJ stent or URS is safe in 2nd trimester.", "Definitive stone treatment (RIRS/ESWL) is usually deferred to 6 weeks after delivery."]},
    {"id": "kidney-donor", "title": "Becoming a Living Kidney Donor", "summary": "What to expect when you gift a kidney.", "cover": "https://images.unsplash.com/photo-1559757175-5700dde675bc?w=800&q=80",
     "steps": ["Complete work-up: blood group, tissue typing, glomerular filtration rate, cardiac fitness and CT angiography.", "Counselling by a transplant coordinator — decision is entirely voluntary.", "Laparoscopic donor nephrectomy — 3–4 days in hospital.", "4–6 weeks rest from strenuous work; desk work can resume at 2 weeks.", "Life-long yearly check-up: BP, creatinine, urine protein.", "Donors generally live as long as the general population — the remaining kidney compensates by ~70%."]},
    {"id": "telehealth-tips", "title": "Getting the Most from Your Telehealth Visit", "summary": "Preparing for a productive online consultation.", "cover": "https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=800&q=80",
     "steps": ["Choose a quiet, well-lit room with stable internet.", "Keep your medications, recent blood & urine reports, and past surgery summaries handy.", "If you have a blood pressure or glucose meter, record a reading just before the call.", "Have a bladder diary ready if booked for LUTS — 3 days of fluid in and urine out.", "Use headphones to protect privacy and clearer audio.", "Write down 3 main questions you want answered by the end of the session."]},
    {"id": "sexual-health-general", "title": "Sexual Health — Red Flags to Never Ignore", "summary": "Symptoms that deserve urgent evaluation.", "cover": "https://images.pexels.com/photos/4058411/pexels-photo-4058411.jpeg?auto=compress&cs=tinysrgb&w=1200",
     "steps": ["Erection lasting > 4 hours → go to ER (priapism).", "Sudden painless lump in a testicle → urology within a week.", "Sudden curvature of the penis with painful erections → likely Peyronie's, start treatment early.", "Blood in semen that lasts > 3 weeks or is recurrent.", "Persistent pain or burning during ejaculation.", "New-onset ED in a man under 40 — often the first sign of vascular disease."]},
]


from education_content import list_localized as _edu_list_localized, get_localized as _edu_get_localized

# ---- Custom per-article cover images uploaded by Dr. Joshi ----
# Overrides the default image from education_content.TOPICS whenever the
# article id is present in this map. Remaining articles fall back to the
# existing stock images until new uploads arrive.
_EDU_CUSTOM_COVERS: Dict[str, str] = {
    "kegel-exercises": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/l8lew19k_kegel-exercises.png",
    "bladder-training": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/ldp1ptw5_bladder-training.png",
    "fluid-management": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/jp8oigj5_fluid-management.png",
    "pre-op-prep": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/20rjyu3l_pre-op-prep.png",
    "psa-testing": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/236tiy5s_psa-testing.png",
    "stone-prevention": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/owc6yhgd_stone-prevention.png",
    "uti-prevention": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/spbpzrg2_uti-prevention.png",
    "post-surgery-care": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/oosn7esm_post-surgery-care.png",
    "bph-lifestyle": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/a1theb2u_bph-lifestyle.png",
    "ed-overview": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/gji6t5ah_ed-overview.png",
    "catheter-care": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/v8h8jvl6_catheter-care.png",
    "dj-stent-care": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/cv2jr3re_dj-stent-care.png",
    "travel-kidney-stones": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/3ujztgy6_travel-kidney-stones.png",
    "vasectomy-guide": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/bmbsnu7x_vasectomy-guide.png",
    "circumcision-care": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/ag2i8ofo_circumcision-care.png",
    "pregnancy-urology": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/32bc4962_pregnancy-urology.png",
    "kidney-donor": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/h9uehlhe_kidney-donor.png",
    "telehealth-tips": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/yb5q5peq_telehealth-tips.png",
    "sexual-health-general": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/o3mji7p1_sexual-health-general.png",
    "prostate-cancer-screening": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/7eb0gtrq_prostate-cancer-screening.png",
    "bladder-cancer-haematuria": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/n0c9r1u1_bladder-cancer-haematuria.png",
    "kidney-cancer": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/vg21g7mo_kidney-cancer.png",
    "testicular-self-exam": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/3ds1nlgo_testicular-self-exam.png",
    "overactive-bladder": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/o7hd6yem_overactive-bladder.png",
    "nocturia": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/ifbhb30q_nocturia.png",
    "varicocele": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/ajluw3u8_varicocele.png",
    "male-infertility": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/uz8aytiq_male-infertility.png",
    "low-testosterone": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/7b4gmpxb_low-testosterone.png",
    "peyronies-disease": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/zn56l8pq_peyronies-disease.png",
    "prostatitis": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/rid3zc0e_prostatitis.png",
    "urethral-stricture": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/nuo4kjh7_urethral-stricture.png",
    "eswl-shockwave": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/5xmv39uz_eswl-shockwave.png",
    "rirs-flexible-ureteroscopy": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/1onj0b8c_rirs-flexible-ureteroscopy.png",
    "turp-holep-bph": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/md7v1jy2_turp-holep-bph.png",
    "paediatric-bedwetting": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/xndfw7qn_paediatric-bedwetting.png",
    "diet-for-urology": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/a73yftb4_diet-for-urology.png",
    "exercise-urology": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/f52bncsd_exercise-urology.png",
}


from services.blog_helpers import _apply_custom_cover  # (extracted)


# (moved) education block (L5050-5054) → /app/backend/routers/education.py


# (moved) education block (L5057-5064) → /app/backend/routers/education.py


# (moved) calculators block (L5067-5078) → /app/backend/routers/calculators.py


# ============================================================
# TOOL SCORES (unified calculator history + Bladder Diary)
# ============================================================

TOOL_IDS = {
    "ipss",
    "psa",
    "bmi",
    "iief5",
    "prostate_volume",
    "crcl",
    "egfr",
    "stone_risk",
    "creatinine",
    "bladder_diary",
}


# (moved) class ToolScoreBody → /app/backend/models.py


# (moved) tools block (L5102-5118) → /app/backend/routers/tools.py


# (moved) tools block (L5121-5125) → /app/backend/routers/tools.py


# (moved) tools block (L5128-5133) → /app/backend/routers/tools.py


# ---------- Bladder Diary (dedicated entries) ---------- #


# (moved) class BladderEntryBody → /app/backend/models.py


# (moved) tools block (L5142-5158) → /app/backend/routers/tools.py


# (moved) tools block (L5161-5189) → /app/backend/routers/tools.py


# (moved) tools block (L5192-5197) → /app/backend/routers/tools.py


# ============================================================
# PUSH NOTIFICATIONS
# ============================================================


# (moved) class PushRegisterBody → /app/backend/models.py


# (moved) class BroadcastCreate → /app/backend/models.py


# (moved) class BroadcastReview → /app/backend/models.py


from services.notifications import send_expo_push_batch  # (extracted)


from services.notifications import collect_user_tokens  # (extracted)


from services.notifications import collect_role_tokens  # (extracted)


from services.notifications import push_to_owner  # (extracted)


from services.notifications import push_to_user  # (extracted)


# ============================================================
# IN-APP NOTIFICATION CENTER
#
# Every user has an inbox (db.notifications). `create_notification`
# persists a doc AND fires an Expo push, so the recipient sees a push
# banner immediately and the app keeps a read/unread history.
# ============================================================

from services.notifications import ROLE_LABELS_BASIC  # (extracted)


from services.notifications import pretty_role  # (extracted)


from services.notifications import create_notification  # (extracted)


from services.notifications import notify_role_change  # (extracted)


# (moved) notifications block (L5011-5039) → /app/backend/routers/notifications.py


# (moved) notifications block (L5042-5050) → /app/backend/routers/notifications.py


# (moved) notifications block (L5053-5150) → /app/backend/routers/notifications.py


# (moved) notifications block (L5153-5159) → /app/backend/routers/notifications.py


# (moved) push block (L5162-5181) → /app/backend/routers/push.py


# (moved) push block (L5184-5189) → /app/backend/routers/push.py


# ============================================================
# PUSH DIAGNOSTICS (admin-only) + SELF-TEST
# ============================================================

# (moved) push block (L5196-5260) → /app/backend/routers/push.py


# (moved) push block (L5263-5299) → /app/backend/routers/push.py


# (moved) broadcasts block (L5302-5369) → /app/backend/routers/broadcasts.py


# (moved) broadcasts block (L5372-5378) → /app/backend/routers/broadcasts.py


# (moved) broadcasts block (L5381-5387) → /app/backend/routers/broadcasts.py


# (moved) broadcasts block (L5390-5501) → /app/backend/routers/broadcasts.py


# (moved) broadcasts block (L5504-5514) → /app/backend/routers/broadcasts.py


# (moved) broadcasts block (L5517-5522) → /app/backend/routers/broadcasts.py


# (moved) broadcasts block (L5525-5532) → /app/backend/routers/broadcasts.py


# ──────────────────────────────────────────────────────────────────
# Unified Inbox — merges three sources into a single sorted feed:
#   1. db.notifications      (user-specific: bookings, role changes,
#                             prescription updates, referrals, etc.)
#   2. db.broadcast_inbox    (clinic-wide announcements with image/link)
#   3. db.push_log           (raw push deliveries with no in-app row)
#
# Each row is normalised to a common shape with a `source_type` field
# (`user` | `broadcast` | `push` | `other`) so the frontend can render
# distinct icons per type.
# ──────────────────────────────────────────────────────────────────
# (moved) messaging block (L5546-5675) → /app/backend/routers/messaging.py


# (moved) messaging block (L5678-5691) → /app/backend/routers/messaging.py



# ──────────────────────────────────────────────────────────────────
# Personal in-app messages (one-to-one). Owner is always permitted;
# any other team member needs `can_send_personal_messages = True`
# (granted by the owner in Dashboard → Team).
# ──────────────────────────────────────────────────────────────────
# (moved) class MessageAttachment → /app/backend/models.py


# (moved) class PersonalMessageBody → /app/backend/models.py


def _can_send_personal_messages(user: Dict[str, Any]) -> bool:
    """Owner tier (owner / primary_owner / super_owner / partner) is
    implicit. All non-patient team members are permitted by default;
    primary_owner can explicitly revoke (False). Patients are not
    permitted unless owner explicitly authorises (True).
    """
    if not user:
        return False
    role = user.get("role", "")
    explicit = user.get("can_send_personal_messages")
    # Owner tier — always allowed regardless of the per-user flag
    # (the hierarchy SuperOwner > PrimaryOwner > Partner grants it).
    if role in ("owner", "primary_owner", "super_owner", "partner"):
        return True
    if role and role != "patient":
        return explicit is not False
    return bool(explicit)


# ── Owner-only: toggle messaging permission for ANY user (incl.
# patients). The Team panel handles staff via `PATCH /api/team/{email}`,
# but patients aren't in the team list — this endpoint covers them.
# (moved) class MessagingPermissionBody → /app/backend/models.py


# (moved) messaging block (L5731-5754) → /app/backend/routers/messaging.py


# ──────────────────────────────────────────────────────────────────
# Partner & Primary-Owner management endpoints (B-tier role hierarchy)
#
# Hierarchy:
#   super_owner   → app.consulturo@gmail.com (platform admin).
#                   Sole authority to promote/demote primary_owners.
#   primary_owner → senior co-owners. Can promote/demote partners and
#                   manage all staff. Multiple allowed.
#   partner       → equal admin/clinical powers EXCEPT cannot manage
#                   partners or primary_owners.
#
# All endpoints below are deliberately direct (no invite/accept flow)
# to keep v1 simple. Future: add a confirm-invite step so the promoted
# user must actively accept the elevation.
# ──────────────────────────────────────────────────────────────────
# (moved) class PromoteByEmailBody → /app/backend/models.py


async def _promote_user_to_role(
    email: str, role: str, *, actor: Dict[str, Any]
) -> Dict[str, Any]:
    """Persist a role assignment for `email` and audit-log the actor.
    Updates BOTH db.users (live session) and db.team_invites (so the
    role survives sign-out / sign-in)."""
    email_l = (email or "").strip().lower()
    if not email_l:
        raise HTTPException(status_code=400, detail="Email is required")
    if role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"Invalid role: {role}")
    target = await db.users.find_one({"email": email_l}, {"_id": 0})
    perms: Dict[str, Any] = {
        "role": role,
        "can_approve_bookings": True,
        "can_approve_broadcasts": True,
        "can_send_personal_messages": True,
        "can_prescribe": True,
        "can_manage_surgeries": True,
        "can_manage_availability": True,
    }
    # Demoting to a regular team-member role (doctor / nursing /
    # reception / assistant) clears every elevated flag — they must
    # be RE-ENABLED explicitly via the Team panel by a Primary Owner
    # / Partner. Aligns with the "doctor is just a team member" model.
    if role in ("doctor", "nursing", "reception", "assistant"):
        perms = {
            "role": role,
            "can_approve_bookings": False,
            "can_approve_broadcasts": False,
            "can_send_personal_messages": False,
            "can_prescribe": False,
            "can_manage_surgeries": False,
            "can_manage_availability": False,
        }
    if target:
        # Stamp `created_at` (now) only when this row never had one
        # before — preserves the original sign-up date for already
        # existing users while back-filling old rows that pre-date
        # the field.
        update_doc: Dict[str, Any] = {"$set": perms}
        if not target.get("created_at"):
            update_doc["$setOnInsert"] = {"created_at": datetime.now(timezone.utc)}
            # find_one_and_update with upsert isn't useful here since the
            # row already exists; instead do an explicit conditional set.
            await db.users.update_one({"email": email_l, "created_at": {"$exists": False}}, {"$set": {"created_at": datetime.now(timezone.utc)}})
        await db.users.update_one({"email": email_l}, {"$set": perms})
    # Always upsert into team_invites so future sign-ins keep the role.
    await db.team_invites.update_one(
        {"email": email_l},
        {"$set": {**perms, "email": email_l},
         "$setOnInsert": {"invited_at": datetime.now(timezone.utc)}},
        upsert=True,
    )
    # Audit log — best effort, never fails the request.
    try:
        await db.audit_log.insert_one({
            "ts": datetime.now(timezone.utc),
            "kind": "role_change",
            "target_email": email_l,
            "new_role": role,
            "actor_user_id": actor.get("user_id"),
            "actor_email": (actor.get("email") or "").lower(),
            "actor_role": actor.get("role"),
        })
    except Exception:
        pass
    return {"ok": True, "email": email_l, "role": role, "user_id": (target or {}).get("user_id")}


# (moved) admin_owners block (L5845-5850) → /app/backend/routers/admin_owners.py


# (moved) admin_owners block (L5853-5865) → /app/backend/routers/admin_owners.py


# (moved) admin_owners block (L5868-5910) → /app/backend/routers/admin_owners.py


# (moved) class BlogPermBody → /app/backend/models.py


# (moved) class DashboardPermBody → /app/backend/models.py


# (moved) class SuspendBody → /app/backend/models.py


# ---------------------------------------------------------------------
# Super-owner analytics — per-Primary-Owner usage stats
# ---------------------------------------------------------------------
# Aggregates how each Primary Owner is using the platform, kept
# strictly separate from the Platform Administration endpoints (which
# are about CRUD'ing the Primary Owner accounts themselves). Returns
# one row per primary_owner with: bookings (today/week/month/total),
# Rx written, surgeries logged, team size, last-active, language,
# and a 90-day daily series for the growth chart.
# (moved) admin_owners block (L5931-6048) → /app/backend/routers/admin_owners.py


# (moved) admin_owners block (L6051-6083) → /app/backend/routers/admin_owners.py


# (moved) admin_owners block (L6086-6124) → /app/backend/routers/admin_owners.py


# (moved) admin_owners block (L6127-6161) → /app/backend/routers/admin_owners.py


# (moved) admin_owners block (L6164-6201) → /app/backend/routers/admin_owners.py


# (moved) admin_owners block (L6204-6208) → /app/backend/routers/admin_owners.py


# (moved) admin_owners block (L6211-6225) → /app/backend/routers/admin_owners.py


# (moved) admin_owners block (L6228-6269) → /app/backend/routers/admin_owners.py


# (moved) me_tier block (L6272-6303) → /app/backend/routers/me_tier.py


# (moved) messaging block (L6306-6347) → /app/backend/routers/messaging.py


# (moved) messaging block (L6350-6398) → /app/backend/routers/messaging.py


# (moved) messaging block (L6401-6511) → /app/backend/routers/messaging.py






# ── Sent personal messages ──
# (moved) messaging block (L6519-6580) → /app/backend/routers/messaging.py


# ── Lookup user_id by phone (for "Send Message" buttons on bookings) ──
# (moved) messaging block (L6584-6609) → /app/backend/routers/messaging.py


# ============================================================
# APP SETTINGS (homepage customization by owner)
# ============================================================

DEFAULT_DOCTOR_PHOTO = "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/6ng2cxnu_IMG_20260421_191126.jpg"
DEFAULT_COVER_PHOTO = "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/68qb2iws_1710790362938%20%281%29.jpg"
DEFAULT_DOCTOR_NAME = "Dr. Sagar Joshi"
DEFAULT_TAGLINE = "Consultant Urologist · Laparoscopic & Transplant Surgeon"
DEFAULT_CLINIC_NAME = "Sterling Hospitals"
DEFAULT_CLINIC_ADDRESS = "Opd 5, Mahi, Ground floor, Sterling Hospital, Racecourse Road, Vadodara"
DEFAULT_CLINIC_PHONE = "+91 81550 75669"
DEFAULT_DEGREES = "MBBS · MS · DrNB (Urology)"
DEFAULT_REG_NO = "G-53149"
DEFAULT_CLINIC_WHATSAPP = "+918155075669"
DEFAULT_CLINIC_EMAIL = "drsagarjoshi133@gmail.com"
DEFAULT_CLINIC_MAP_URL = "https://maps.app.goo.gl/NsrKSY93pKmaa8RA8?g_st=ac"
DEFAULT_CLINIC_HOURS = "Mon–Sat 8:00 AM – 8:00 PM"
DEFAULT_EMERGENCY_NOTE = "Emergency consultations available on Sundays"


async def get_homepage_settings() -> Dict[str, Any]:
    doc = await db.app_settings.find_one({"key": "homepage"}, {"_id": 0})
    defaults = {
        "doctor_photo_url": DEFAULT_DOCTOR_PHOTO,
        "cover_photo_url": DEFAULT_COVER_PHOTO,
        "doctor_name": DEFAULT_DOCTOR_NAME,
        "tagline": DEFAULT_TAGLINE,
        "clinic_name": DEFAULT_CLINIC_NAME,
        "clinic_address": DEFAULT_CLINIC_ADDRESS,
        "clinic_phone": DEFAULT_CLINIC_PHONE,
        "doctor_degrees": DEFAULT_DEGREES,
        "doctor_reg_no": DEFAULT_REG_NO,
        "signature_url": "",
        "clinic_whatsapp": DEFAULT_CLINIC_WHATSAPP,
        "clinic_email": DEFAULT_CLINIC_EMAIL,
        "clinic_map_url": DEFAULT_CLINIC_MAP_URL,
        "clinic_hours": DEFAULT_CLINIC_HOURS,
        "emergency_note": DEFAULT_EMERGENCY_NOTE,
    }
    if not doc:
        doc = {"key": "homepage", **defaults, "updated_at": datetime.now(timezone.utc)}
        await db.app_settings.insert_one(dict(doc))
    out = {}
    for k, default_val in defaults.items():
        # signature_url may legitimately be empty string → respect that
        if k == "signature_url":
            out[k] = doc.get(k) or ""
        else:
            out[k] = doc.get(k) or default_val
    out["updated_at"] = doc.get("updated_at")
    return out


# (moved) settings_homepage block (L6665-6668) → /app/backend/routers/settings_homepage.py


# (moved) settings_homepage block (L6671-6700) → /app/backend/routers/settings_homepage.py


# ============================================================
# CONSENT TRACKING (medical data, privacy, marketing)
# ============================================================


# (moved) class ConsentBody → /app/backend/models.py


# (moved) consent block (L7149-7158) → /app/backend/routers/consent.py


# (moved) consent block (L7161-7180) → /app/backend/routers/consent.py


# ============================================================
# PATIENTS (unified registration across booking/Rx/surgery)
# ============================================================

# (moved) patients block (L7187-7197) → /app/backend/routers/patients.py


# (moved) patients block (L7200-7213) → /app/backend/routers/patients.py


# (moved) class PatientRegManual → /app/backend/models.py


# (moved) patients block (L7219-7246) → /app/backend/routers/patients.py


# ============================================================
# REFERRING DOCTORS (CRM-style list managed by staff)
# ============================================================


# (moved) referrers block (L7254-7290) → /app/backend/routers/referrers.py


# (moved) referrers block (L7293-7311) → /app/backend/routers/referrers.py


# (moved) referrers block (L7314-7333) → /app/backend/routers/referrers.py


# (moved) referrers block (L7336-7341) → /app/backend/routers/referrers.py


# ============================================================
# ANALYTICS (Owner / Prescriber dashboard)
# ============================================================


def _month_bucket(dt) -> str:
    """Return YYYY-MM key from a datetime or date-like string."""
    if isinstance(dt, datetime):
        return dt.strftime("%Y-%m")
    if isinstance(dt, str):
        # Handle 'YYYY-MM-DD' or ISO strings
        return dt[:7] if len(dt) >= 7 else dt
    return ""


def _last_n_months(n: int) -> List[str]:
    today = datetime.now(timezone.utc).replace(day=1)
    out = []
    y, m = today.year, today.month
    for _ in range(n):
        out.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            m = 12
            y -= 1
    return list(reversed(out))


def _last_n_days(n: int) -> List[str]:
    today = datetime.now(timezone.utc).date()
    return [(today - timedelta(days=i)).isoformat() for i in range(n - 1, -1, -1)]


# (moved) analytics block (L4604-4705) → /app/backend/routers/analytics.py


# ============================================================
# HEALTH
# ============================================================


# (moved) api_root block (L4713-4715) → /app/backend/routers/api_root.py


# (moved) health block (L7491-7497) → /app/backend/routers/health.py


# === MY NOTES (per-user private notes) ====================================
# Every logged-in user — patient, staff, owner — has a personal notes
# scratchpad. Isolated by user_id so no cross-user leakage.

# (moved) class NoteBody → /app/backend/models.py


def _clean_labels(raw: Optional[List[str]]) -> List[str]:
    if not raw:
        return []
    seen: List[str] = []
    for item in raw:
        if not isinstance(item, str):
            continue
        s = item.strip()[:24]
        if not s:
            continue
        # De-dup case-insensitively but preserve original casing from first use.
        if any(s.lower() == e.lower() for e in seen):
            continue
        seen.append(s)
        if len(seen) >= 12:
            break
    return seen


# (moved) notes block (L7526-7531) → /app/backend/routers/notes.py


# (moved) notes block (L7534-7549) → /app/backend/routers/notes.py


def _parse_reminder(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        # Accept both with and without trailing Z
        s2 = s.replace("Z", "+00:00")
        dt = datetime.fromisoformat(s2)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid reminder_at datetime")


# (moved) notes block (L7566-7585) → /app/backend/routers/notes.py


# (moved) notes block (L7588-7610) → /app/backend/routers/notes.py


# (moved) notes block (L7613-7618) → /app/backend/routers/notes.py


# === SURGERY LOGBOOK — FIELD-LEVEL SUGGESTIONS ============================
# Staff typing a new surgery entry should see prefix-matching suggestions
# drawn from past log rows, ranked by frequency. Saves time and enforces
# consistent spelling (e.g. "Dr Vibha Naik" vs "DR VIBHA NAIK").

_SUGGESTABLE_SURGERY_FIELDS = {
    "surgery_name",
    "diagnosis",
    "referred_by",
    "hospital",
    "imaging",
    "clinical_examination",
    "operative_findings",
    "post_op_investigations",
    "follow_up",
    "patient_category",
    "notes",
}


# === MEDICINE CATALOGUE ====================================================
# Prescriber-facing autocomplete: as the doctor types into the medicine
# name field, we surface matching entries from the curated seed catalogue
# (medicines_catalog.py). Clinic-specific additions live in the DB
# collection `medicines_custom` so owners/admins can add their own later
# (CSV upload feature to come).

from medicines_catalog import get_medicine_catalog as _get_med_seed

_MEDICINE_SEED = _get_med_seed()  # loaded once at module import


def _normalize_q(q: Optional[str]) -> str:
    return (q or "").strip().lower()


# (moved) medicines block (L7657-7737) → /app/backend/routers/medicines.py


# (moved) medicines block (L7740-7754) → /app/backend/routers/medicines.py


# (moved) class MedicineCustomBody → /app/backend/models.py


# (moved) medicines block (L7760-7784) → /app/backend/routers/medicines.py


# (moved) medicines block (L7787-7795) → /app/backend/routers/medicines.py


# (moved) surgeries block (L4827-4869) → /app/backend/routers/surgeries.py


# === PROSTATE VOLUME (patient-reported readings) =========================
# Any logged-in user can log a prostate-volume reading against their own
# account. Intended use-case: a patient gets a USG done elsewhere and
# enters the volume into the app so that it becomes part of his timeline
# and is visible to the doctor on the next visit.

# (moved) class ProstateVolumeBody → /app/backend/models.py


_VALID_PROSTATE_SOURCES = {"USG", "MRI", "DRE", "Other"}


def _parse_measured_on(s: Optional[str]) -> datetime:
    """Accepts YYYY-MM-DD (preferred) or ISO datetime. Defaults to today IST."""
    if s:
        s = s.strip()
        try:
            if "T" in s:
                return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc)
            dt = datetime.strptime(s, "%Y-%m-%d")
            return dt.replace(tzinfo=timezone.utc)
        except Exception:
            raise HTTPException(status_code=400, detail="measured_on must be YYYY-MM-DD")
    return datetime.now(timezone.utc)


# (moved) records block (L4898-4910) → /app/backend/routers/records.py


# (moved) records block (L4913-4945) → /app/backend/routers/records.py


# (moved) records block (L4948-4955) → /app/backend/routers/records.py


# ══════════════════════════════════════════════════════════════════
# Plan-B Phase-2: Clinic Branding · Demo Mode · Partner Permissions
# ══════════════════════════════════════════════════════════════════

# (moved) class ClinicSettingsPatch → /app/backend/models.py


# (moved) _DEFAULT_CLINIC_SETTINGS → /app/backend/routers/clinic_settings.py


# (moved) GET /api/clinic-settings → /app/backend/routers/clinic_settings.py


# (moved) PATCH /api/clinic-settings → /app/backend/routers/clinic_settings.py


# ── Demo accounts (Primary Owner + Patient) ───────────────────────
# (moved) class CreateDemoBody → /app/backend/models.py


async def _seed_demo_patient_data(user_id: str, email: str, name: str) -> Dict[str, int]:
    """Pre-populate the patient demo account with one fake booking,
    one fake prescription, and one fake IPSS submission so the demo
    "looks rich" the moment they sign in. Returns a count summary."""
    now = datetime.now(timezone.utc)
    phone = "+910000000001"
    # Reg no — try to allocate via the helper if present; else fall
    # back to a deterministic-ish value so the demo stays stable.
    try:
        reg_no = await allocate_reg_no(phone, name)  # type: ignore[name-defined]
    except Exception:
        reg_no = "001" + now.strftime("%d%m%y")

    # 1) Booking — completed, day before yesterday so it lands in history.
    booking_id = f"bk_demo_{uuid.uuid4().hex[:8]}"
    booking = {
        "booking_id": booking_id,
        "user_id": user_id,
        "registration_no": reg_no,
        "patient_name": name,
        "patient_phone": phone,
        "patient_email": email,
        "patient_age": 52,
        "patient_gender": "Male",
        "patient_address": "Demo address · for preview only",
        "consultation_type": "in_clinic",
        "preferred_date": (now - timedelta(days=2)).date().isoformat(),
        "preferred_time": "10:30",
        "symptoms": "Mild urinary urgency · sample data for demo preview.",
        "status": "completed",
        "created_at": (now - timedelta(days=3)).isoformat(),
        "updated_at": now.isoformat(),
        "is_demo_seed": True,
    }
    await db.bookings.insert_one(booking)

    # 2) Prescription — linked to the same patient.
    rx_id = f"rx_demo_{uuid.uuid4().hex[:8]}"
    rx = {
        "prescription_id": rx_id,
        "user_id": user_id,
        "registration_no": reg_no,
        "patient_name": name,
        "patient_phone": phone,
        "patient_age": 52,
        "patient_gender": "Male",
        "diagnosis": "Benign Prostatic Hyperplasia (sample)",
        "medications": [
            {"name": "Tamsulosin", "dosage": "0.4 mg", "frequency": "Once at night", "duration": "30 days"},
            {"name": "Solifenacin", "dosage": "5 mg", "frequency": "Once a day", "duration": "30 days"},
        ],
        "investigations_advised": ["Urine routine", "Uroflowmetry"],
        "advice": "Avoid late-night fluids · review after 4 weeks. (DEMO sample — not real medical advice.)",
        "follow_up_days": 30,
        "doctor_name": "Demo Doctor",
        "created_at": (now - timedelta(days=2)).isoformat(),
        "is_demo_seed": True,
    }
    await db.prescriptions.insert_one(rx)

    # 3) IPSS — sample score.
    ipss_id = f"ipss_demo_{uuid.uuid4().hex[:8]}"
    ipss = {
        "ipss_id": ipss_id,
        "user_id": user_id,
        "registration_no": reg_no,
        "patient_name": name,
        "scores": {
            "incomplete_emptying": 2, "frequency": 3, "intermittency": 1,
            "urgency": 2, "weak_stream": 3, "straining": 1, "nocturia": 2,
        },
        "total_score": 14,
        "qol_score": 3,
        "severity": "moderate",
        "submitted_at": (now - timedelta(days=5)).isoformat(),
        "is_demo_seed": True,
    }
    await db.ipss_submissions.insert_one(ipss)

    return {"bookings": 1, "prescriptions": 1, "ipss": 1, "registration_no": reg_no}


# (moved) admin_extras block (L5060-5132) → /app/backend/routers/admin_extras.py


# (moved) admin_extras block (L5135-5168) → /app/backend/routers/admin_extras.py


# (moved) admin_extras block (L5171-5199) → /app/backend/routers/admin_extras.py


# Helper for write-endpoints to call: raises 403 for demo accounts.
def block_if_demo(user: Dict[str, Any]) -> None:
    """Drop into any write endpoint to 403 demo accounts. Returns
    silently for everyone else."""
    if user.get("is_demo"):
        raise HTTPException(
            status_code=403,
            detail="Demo mode — actions are disabled in this preview account.",
        )


# ── Super-owner platform stats (dashboard refactor) ───────────────
# (moved) admin_extras block (L5214-5236) → /app/backend/routers/admin_extras.py


# (moved) admin_extras block (L5239-5249) → /app/backend/routers/admin_extras.py


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8001, reload=True)


# ─── Phase-2 router registrations (mechanical extraction) ───
# Imported at file-end so every `require_*` dependency that the
# router modules lazily resolve is already bound on the server
# module by this point — avoids the circular-import trap.
from routers.diseases import router as _diseases_router
from routers.doctor import router as _doctor_router
from routers.profile import router as _profile_router
from routers.clinic_settings import router as _clinic_settings_router
app.include_router(_diseases_router)
app.include_router(_doctor_router)
app.include_router(_profile_router)
app.include_router(_clinic_settings_router)

# ─── Phase-3 router registrations ───
from routers.health import router as _health_router
from routers.calculators import router as _calculators_router
from routers.education import router as _education_router
from routers.consent import router as _consent_router
from routers.medicines import router as _medicines_router
from routers.notes import router as _notes_router
from routers.availability import router as _availability_router
from routers.ipss import router as _ipss_router
from routers.referrers import router as _referrers_router
from routers.patients import router as _patients_router
from routers.tools import router as _tools_router
app.include_router(_health_router)
app.include_router(_calculators_router)
app.include_router(_education_router)
app.include_router(_consent_router)
app.include_router(_medicines_router)
app.include_router(_notes_router)
app.include_router(_availability_router)
app.include_router(_ipss_router)
app.include_router(_referrers_router)
app.include_router(_patients_router)
app.include_router(_tools_router)

# ─── Phase-3 router registrations ───
from routers.me_tier import router as _me_tier_router
from routers.settings_homepage import router as _settings_homepage_router
from routers.blog import router as _blog_router
from routers.push import router as _push_router
from routers.notifications import router as _notifications_router
from routers.broadcasts import router as _broadcasts_router
from routers.messaging import router as _messaging_router
from routers.team import router as _team_router
from routers.admin_owners import router as _admin_owners_router
app.include_router(_me_tier_router)
app.include_router(_settings_homepage_router)
app.include_router(_blog_router)
app.include_router(_push_router)
app.include_router(_notifications_router)
app.include_router(_broadcasts_router)
app.include_router(_messaging_router)
app.include_router(_team_router)
app.include_router(_admin_owners_router)

# ─── Phase-3 router registrations ───
from routers.auth import router as _auth_router
app.include_router(_auth_router)

# ─── Phase-3 router registrations ───
from routers.rx_verify import router as _rx_verify_router
from routers.render import router as _render_router
from routers.analytics import router as _analytics_router
from routers.api_root import router as _api_root_router
from routers.export import router as _export_router
from routers.records import router as _records_router
from routers.admin_extras import router as _admin_extras_router
from routers.surgeries import router as _surgeries_router
from routers.prescriptions import router as _prescriptions_router
from routers.bookings import router as _bookings_router
app.include_router(_rx_verify_router)
app.include_router(_render_router)
app.include_router(_analytics_router)
app.include_router(_api_root_router)
app.include_router(_export_router)
app.include_router(_records_router)
app.include_router(_admin_extras_router)
app.include_router(_surgeries_router)
app.include_router(_prescriptions_router)
app.include_router(_bookings_router)

# ─── Phase A multi-tenant ────────────────────────────────────────────
# Registers the new /api/clinics CRUD endpoints + ensures Mongo
# indexes for the clinics / clinic_memberships collections at startup.
# Existing routers are NOT scoped yet — Phase B/C/D will progressively
# wire X-Clinic-Id into each one.
from routers.clinics import router as _clinics_router
app.include_router(_clinics_router)

# ─── Phase D multi-tenant invitations ────────────────────────────────
from routers.invitations import router as _invitations_router
app.include_router(_invitations_router)


@app.on_event("startup")
async def _ensure_tenant_indexes() -> None:
    try:
        from services.tenancy import ensure_indexes as _tenant_ensure_indexes
        await _tenant_ensure_indexes()
        # Phase D — invitation token lookup index.
        from db import db as _db
        await _db["clinic_invitations"].create_index("token", unique=True)
        await _db["clinic_invitations"].create_index("clinic_id")
        await _db["clinic_invitations"].create_index("email")
    except Exception as _e:  # noqa: BLE001
        # Don't crash boot — index creation is best-effort and idempotent.
        print(f"[startup] tenant index ensure skipped: {_e}")

