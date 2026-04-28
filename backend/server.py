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
# generating bookable slots for the patient Book screen. Includes
# `primary_owner` and `partner` (which were missed earlier and caused
# the "saved availability not in sync with Book page" bug — slots fell
# back to a stale default for an orphan doctor account).
PRESCRIBER_AVAILABILITY_ROLES = ["owner", "doctor", "primary_owner", "partner"]

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


def _normalize_phone(raw: Optional[str]) -> str:
    """Return the last 10 digits of a phone number (Indian normalisation)."""
    digits = re.sub(r"\D", "", raw or "")
    return digits[-10:] if len(digits) >= 10 else digits


async def allocate_reg_no(phone: Optional[str], name: Optional[str] = None) -> Optional[str]:
    """Return a stable 9-digit registration number for this patient.
    Format: SSSDDMMYY where SSS is a zero-padded daily sequence (resets each day).
    If the phone is already known, the previously-allocated reg_no is returned
    (so the same patient keeps one reg_no across bookings/Rx/surgery)."""
    p = _normalize_phone(phone)
    if not p:
        return None
    existing = await db.patients.find_one({"phone": p}, {"_id": 0})
    if existing and existing.get("reg_no"):
        return existing["reg_no"]
    today_local = (datetime.now(timezone.utc) + IST_OFFSET).date()
    day_key = today_local.strftime("%d%m%y")
    counter_key = today_local.strftime("%Y-%m-%d")
    # Atomic increment-and-return of the daily counter.
    res = await db.counters.find_one_and_update(
        {"key": counter_key},
        {"$inc": {"count": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    seq = res.get("count", 1)
    reg_no = f"{seq:03d}{day_key}"
    await db.patients.update_one(
        {"phone": p},
        {
            "$set": {
                "phone": p,
                "reg_no": reg_no,
                "name": name,
                "updated_at": datetime.now(timezone.utc),
            },
            "$setOnInsert": {"first_seen_at": datetime.now(timezone.utc)},
        },
        upsert=True,
    )
    return reg_no


async def get_or_set_reg_no(phone: Optional[str], explicit: Optional[str], name: Optional[str] = None) -> Optional[str]:
    """If caller supplied an explicit reg_no, honour it (upsert against patient).
    Otherwise allocate a new one (or reuse existing)."""
    p = _normalize_phone(phone)
    if not p:
        return (explicit or "").strip() or None
    explicit = (explicit or "").strip() or None
    if explicit:
        await db.patients.update_one(
            {"phone": p},
            {
                "$set": {
                    "phone": p,
                    "reg_no": explicit,
                    "name": name,
                    "updated_at": datetime.now(timezone.utc),
                },
                "$setOnInsert": {"first_seen_at": datetime.now(timezone.utc)},
            },
            upsert=True,
        )
        return explicit
    return await allocate_reg_no(p, name)

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


def _time_12h(hhmm: str) -> str:
    """'14:30' -> '2:30 PM'. Defensive."""
    try:
        hh, mm = [int(x) for x in hhmm.split(":")]
        suffix = "AM" if hh < 12 else "PM"
        h12 = hh % 12
        if h12 == 0:
            h12 = 12
        return f"{h12}:{mm:02d} {suffix}"
    except Exception:
        return hhmm


def _format_booking_display(iso_date: str, hhmm: str) -> str:
    """YYYY-MM-DD + HH:mm -> 'DD-MM-YYYY at H:MM AM/PM'."""
    try:
        yr, mo, dy = iso_date.split("-")
        return f"{dy}-{mo}-{yr} at {_time_12h(hhmm)}"
    except Exception:
        return f"{iso_date} at {_time_12h(hhmm)}"


# ============================================================
# HELPERS
# ============================================================


async def notify_telegram(text: str) -> None:
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_OWNER_CHAT_ID:
        return
    try:
        async with httpx.AsyncClient(timeout=6.0) as hc:
            await hc.post(
                f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
                json={
                    "chat_id": TELEGRAM_OWNER_CHAT_ID,
                    "text": text,
                    "parse_mode": "HTML",
                    "disable_web_page_preview": True,
                },
            )
    except Exception:
        pass


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
                "can_approve_bookings": invite.get(
                    "can_approve_bookings", role in OWNER_TIER_ROLES or role == "doctor"
                ),
                "can_approve_broadcasts": invite.get(
                    "can_approve_broadcasts", role in OWNER_TIER_ROLES or role == "doctor"
                ),
                "can_send_personal_messages": invite.get("can_send_personal_messages", False),
            }
    return {
        "role": "patient",
        "can_approve_bookings": False,
        "can_approve_broadcasts": False,
        "can_send_personal_messages": False,
    }


async def get_effective_role(role: str) -> Dict[str, Any]:
    """Return {category, is_staff} for core OR custom role."""
    if role in STAFF_ROLES:
        return {"category": "doctor" if role in ["owner", "doctor"] else "staff", "is_staff": True}
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


class BookingCreate(BaseModel):
    patient_name: str
    patient_phone: str
    # International calling code stored separately so the WhatsApp / Call
    # deep-links always compose a valid E.164 number. Defaults to India.
    country_code: Optional[str] = "+91"
    patient_age: Optional[int] = None
    patient_gender: Optional[str] = None
    reason: str
    booking_date: str
    booking_time: str
    mode: str = "in-person"
    registration_no: Optional[str] = None


class IpssEntry(BaseModel):
    question: str
    score: int


class IpssSubmission(BaseModel):
    entries: List[IpssEntry]
    total_score: int
    severity: str
    qol_score: Optional[int] = None


class PrescriptionMedicine(BaseModel):
    name: str
    dosage: str
    frequency: str
    duration: str
    instructions: Optional[str] = ""
    timing: Optional[str] = ""


class PrescriptionCreate(BaseModel):
    patient_name: str
    patient_age: Optional[int] = None
    patient_gender: Optional[str] = None
    patient_phone: Optional[str] = None
    patient_address: Optional[str] = None
    registration_no: Optional[str] = None
    ref_doctor: Optional[str] = None
    visit_date: str
    chief_complaints: str = ""
    vitals: Optional[str] = ""        # legacy single-line field — preserved
    vitals_pulse: Optional[str] = ""  # e.g. "76/min"
    vitals_bp: Optional[str] = ""     # e.g. "120/80 mmHg"
    ipss_recent: Optional[str] = ""   # e.g. "12 / 35 (moderate)" or freeform
    # Examination subsections (urology-specific)
    exam_pa: Optional[str] = ""           # Per Abdomen
    exam_ext_genitalia: Optional[str] = ""
    exam_eum: Optional[str] = ""          # External Urinary Meatus
    exam_testis: Optional[str] = ""
    exam_dre: Optional[str] = ""          # Digital Rectal Examination
    # Investigation findings — split per modality
    investigation_findings: Optional[str] = ""  # legacy free text
    inv_blood: Optional[str] = ""
    inv_psa: Optional[str] = ""
    inv_usg: Optional[str] = ""
    inv_uroflowmetry: Optional[str] = ""
    inv_ct: Optional[str] = ""
    inv_mri: Optional[str] = ""
    inv_pet: Optional[str] = ""
    investigations_advised: Optional[str] = ""
    diagnosis: Optional[str] = ""
    medicines: List[PrescriptionMedicine] = []
    advice: Optional[str] = ""
    follow_up: Optional[str] = ""
    # Workflow status — staff (reception/nursing/assistant) may save a
    # `draft` consultation containing only patient/vitals/complaints/IPSS;
    # the doctor later resumes and finalises it as a `final` Rx.
    status: Optional[str] = "final"  # draft | final
    # Traceability: links this Rx back to the booking it was started from.
    # Set by the "Start Consultation" workflow from a confirmed booking so
    # the whole patient journey stays linked (booking → consult → Rx).
    source_booking_id: Optional[str] = None


class SessionExchangeBody(BaseModel):
    session_id: str
    # Optional one-time-use handoff id generated by the native app before
    # opening the OAuth browser. The bridge HTML forwards it here so the
    # native app can poll GET /api/auth/handoff/{id} to retrieve the
    # finished session — bypassing flaky Chrome Custom Tabs deep-links.
    handoff_id: Optional[str] = None


class TeamInviteBody(BaseModel):
    email: EmailStr
    name: Optional[str] = None
    role: str
    can_approve_bookings: bool = False
    can_approve_broadcasts: bool = False
    can_send_personal_messages: bool = False


class TeamUpdateBody(BaseModel):
    role: Optional[str] = None
    can_approve_bookings: Optional[bool] = None
    can_approve_broadcasts: Optional[bool] = None
    can_send_personal_messages: Optional[bool] = None
    dashboard_full_access: Optional[bool] = None
    # When `dashboard_full_access` is False, owner can pick a SUBSET of
    # dashboard tab ids (e.g. ["bookings", "rx"]) the team member is
    # allowed to see. Null/empty list ⇒ no extra tabs (default).
    dashboard_tabs: Optional[List[str]] = None


class RoleLabelBody(BaseModel):
    label: str
    # Optional category to derive permissions: "clinical" (doctor-level) | "staff" | "patient"
    category: str = "staff"


class HomepageSettingsBody(BaseModel):
    doctor_photo_url: Optional[str] = None
    cover_photo_url: Optional[str] = None
    doctor_name: Optional[str] = None  # display name shown on home hero (e.g. "Dr. Sagar Joshi")
    tagline: Optional[str] = None
    clinic_name: Optional[str] = None
    clinic_address: Optional[str] = None
    clinic_phone: Optional[str] = None
    doctor_degrees: Optional[str] = None
    doctor_reg_no: Optional[str] = None
    signature_url: Optional[str] = None  # owner digital signature (rendered on Rx PDFs)
    # --- Added for in-app Help/Contact screen ---
    clinic_whatsapp: Optional[str] = None  # e.g. +918155075669
    clinic_email: Optional[str] = None  # support email
    clinic_map_url: Optional[str] = None  # Google Maps deep link
    clinic_hours: Optional[str] = None  # freeform string e.g. "Mon–Sat 8am–8pm"
    emergency_note: Optional[str] = None  # e.g. "Emergency on Sundays"


class ReferrerBody(BaseModel):
    name: str
    phone: Optional[str] = ""
    whatsapp: Optional[str] = ""
    email: Optional[str] = ""
    clinic: Optional[str] = ""
    speciality: Optional[str] = ""
    city: Optional[str] = ""
    notes: Optional[str] = ""


class BookingStatusBody(BaseModel):
    status: Optional[str] = None  # confirmed | completed | cancelled | rejected
    booking_date: Optional[str] = None
    booking_time: Optional[str] = None
    note: Optional[str] = ""
    # Free-text reason captured when staff rejects, cancels (staff-initiated),
    # or reschedules a booking. Shown to the patient on their booking card
    # and included in the in-app notification body.
    reason: Optional[str] = None
    # Private clinical note attached by the doctor. NOT shown to the patient
    # and NOT included in the Rx PDF — used only on the dashboard's
    # Consultations tab for doctor's own recall.
    doctor_note: Optional[str] = None


class PatientCancelBody(BaseModel):
    """Patient-initiated cancellation. `patient_phone` is required when the
    caller is unauthenticated (guest booking) as a lightweight ownership
    check. Reason is mandatory so staff can understand the no-show pattern."""
    reason: str
    patient_phone: Optional[str] = None


class SurgeryBody(BaseModel):
    patient_phone: str
    patient_name: str
    patient_age: Optional[int] = None
    patient_sex: Optional[str] = None
    patient_id_ipno: Optional[str] = ""
    registration_no: Optional[str] = ""
    address: Optional[str] = ""
    patient_category: Optional[str] = ""  # Regular / Insurance / Charity etc.
    consultation_date: Optional[str] = ""
    referred_by: Optional[str] = ""
    clinical_examination: Optional[str] = ""
    diagnosis: Optional[str] = ""
    imaging: Optional[str] = ""
    department: Optional[str] = ""  # OPD / IPD
    date_of_admission: Optional[str] = ""
    surgery_name: str
    date: str  # Date of Surgery/Procedure
    hospital: Optional[str] = ""
    operative_findings: Optional[str] = ""
    post_op_investigations: Optional[str] = ""
    date_of_discharge: Optional[str] = ""
    follow_up: Optional[str] = ""
    notes: Optional[str] = ""


class BlogPostBody(BaseModel):
    title: str
    category: Optional[str] = "Urology"
    excerpt: Optional[str] = ""
    content: str  # plain text or light HTML
    cover: Optional[str] = ""  # URL or base64 data URI
    published: bool = True  # legacy; kept for backward compat
    status: Optional[str] = None  # draft | pending_review | published | rejected


class BlogReviewBody(BaseModel):
    status: str  # pending_review | published | rejected | draft
    review_note: Optional[str] = ""


class AvailabilitySlot(BaseModel):
    start: str  # HH:MM
    end: str  # HH:MM


class DayAvailabilityBody(BaseModel):
    # Each day key: 'mon', 'tue', ..., 'sun'
    mon_in: List[AvailabilitySlot] = []
    tue_in: List[AvailabilitySlot] = []
    wed_in: List[AvailabilitySlot] = []
    thu_in: List[AvailabilitySlot] = []
    fri_in: List[AvailabilitySlot] = []
    sat_in: List[AvailabilitySlot] = []
    sun_in: List[AvailabilitySlot] = []
    mon_on: List[AvailabilitySlot] = []
    tue_on: List[AvailabilitySlot] = []
    wed_on: List[AvailabilitySlot] = []
    thu_on: List[AvailabilitySlot] = []
    fri_on: List[AvailabilitySlot] = []
    sat_on: List[AvailabilitySlot] = []
    sun_on: List[AvailabilitySlot] = []
    # days the doctor is fully unavailable (e.g. Sunday)
    off_days: List[str] = []  # ['sun', 'sat']
    note: Optional[str] = ""


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
    """Pass for owner / doctor / full-access team. Used by Availability and
    Unavailability writes — anyone trusted enough to manage the schedule.
    """
    role = user.get("role")
    if role in ("owner", "doctor"):
        return user
    if bool(user.get("dashboard_full_access")):
        return user
    custom = await db.role_labels.find_one({"slug": role, "category": "doctor"}, {"_id": 0})
    if custom:
        return user
    raise HTTPException(status_code=403, detail="Doctor or Full-Access access required")


async def require_prescriber(user=Depends(require_user)) -> Dict[str, Any]:
    role = user.get("role")
    # Full owner-tier (super_owner, primary_owner, partner, legacy owner) +
    # doctor are all prescribers. Partners are clinical-equal to primary_owner.
    if role in ["super_owner", "primary_owner", "owner", "partner", "doctor"]:
        return user
    # Custom roles tagged as "doctor" category also get prescriber powers
    custom = await db.role_labels.find_one({"slug": role, "category": "doctor"}, {"_id": 0})
    if custom:
        return user
    raise HTTPException(status_code=403, detail="Doctor/Owner access required")


async def is_prescriber(user: Dict[str, Any]) -> bool:
    """Helper — does this user have prescribe permission?"""
    role = user.get("role")
    if role in ["super_owner", "primary_owner", "owner", "partner", "doctor"]:
        return True
    custom = await db.role_labels.find_one({"slug": role, "category": "doctor"}, {"_id": 0})
    return bool(custom)


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
@app.get("/auth-callback")
async def auth_callback_bridge(request: Request):
    return _build_auth_callback_response(handoff_id_from_path="")


@app.get("/auth-callback/{handoff_id}")
async def auth_callback_bridge_with_handoff(handoff_id: str, request: Request):
    """Path-based variant — handoff_id is encoded in the URL path so it
    survives Emergent Auth's redirect handling (which sometimes strips
    fragments / appends query params and clobbers our state).
    """
    return _build_auth_callback_response(handoff_id_from_path=handoff_id or "")


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




@app.post("/api/auth/session")
@limiter.limit("20/minute")
async def auth_session(request: Request, body: SessionExchangeBody, response: Response):
    async with httpx.AsyncClient(timeout=10.0) as hc:
        r = await hc.get(EMERGENT_AUTH_URL, headers={"X-Session-ID": body.session_id})
        if r.status_code != 200:
            raise HTTPException(status_code=401, detail="Invalid session_id")
        data = r.json()

    email = data["email"]
    email_l = email.lower()
    existing = await db.users.find_one({"email": email_l}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        perms = await resolve_role_for_email(email_l)
        await db.users.update_one(
            {"user_id": user_id},
            {
                "$set": {
                    "name": data.get("name"),
                    "picture": data.get("picture"),
                    "role": perms["role"],
                    "can_approve_bookings": perms["can_approve_bookings"],
                    "can_approve_broadcasts": perms["can_approve_broadcasts"],
                }
            },
        )
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        perms = await resolve_role_for_email(email_l)
        await db.users.insert_one(
            {
                "user_id": user_id,
                "email": email_l,
                "name": data.get("name"),
                "picture": data.get("picture"),
                "role": perms["role"],
                "can_approve_bookings": perms["can_approve_bookings"],
                "can_approve_broadcasts": perms["can_approve_broadcasts"],
                "created_at": datetime.now(timezone.utc),
            }
        )

    session_token = data["session_token"]
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    await db.user_sessions.insert_one(
        {
            "user_id": user_id,
            "session_token": session_token,
            "expires_at": expires_at,
            "created_at": datetime.now(timezone.utc),
        }
    )

    response.set_cookie(
        key="session_token",
        value=session_token,
        httponly=True,
        secure=True,
        samesite="none",
        path="/",
        max_age=7 * 24 * 60 * 60,
    )

    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})

    # If the caller pre-registered a handoff_id (native app waiting for the
    # browser flow to complete), park the session for ~10 min so the app
    # can retrieve it via GET /api/auth/handoff/{id}.
    if body.handoff_id:
        try:
            await db.auth_handoffs.update_one(
                {"handoff_id": body.handoff_id},
                {
                    "$set": {
                        "session_token": session_token,
                        "user_id": user_id,
                        "ready_at": datetime.now(timezone.utc),
                        "expires_at": datetime.now(timezone.utc) + timedelta(minutes=10),
                    }
                },
                upsert=True,
            )
        except Exception:
            # Never let a handoff-write failure break the auth flow.
            pass

    return {"user": user, "session_token": session_token}


# -- Native auth handoff (deep-link bypass) -------------------------------
class HandoffInitBody(BaseModel):
    handoff_id: Optional[str] = None  # client-provided UUID (preferred)


@app.post("/api/auth/handoff/init")
async def auth_handoff_init(body: Optional[HandoffInitBody] = None):
    hid = ((body.handoff_id if body else None) or str(uuid.uuid4())).strip()
    await db.auth_handoffs.delete_one({"handoff_id": hid})
    await db.auth_handoffs.insert_one({
        "handoff_id": hid,
        "created_at": datetime.now(timezone.utc),
        "expires_at": datetime.now(timezone.utc) + timedelta(minutes=10),
    })
    return {"handoff_id": hid}


@app.get("/api/auth/handoff/{handoff_id}")
async def auth_handoff_poll(handoff_id: str):
    doc = await db.auth_handoffs.find_one({"handoff_id": handoff_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Unknown handoff id")
    expires_at = doc.get("expires_at")
    if expires_at:
        # Motor sometimes returns datetimes as tz-naive UTC — coerce so the
        # comparison below never raises TypeError.
        if getattr(expires_at, "tzinfo", None) is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < datetime.now(timezone.utc):
            await db.auth_handoffs.delete_one({"handoff_id": handoff_id})
            raise HTTPException(status_code=410, detail="Handoff expired")
    if not doc.get("session_token"):
        return JSONResponse(status_code=202, content={"status": "pending"})
    user = await db.users.find_one({"user_id": doc["user_id"]}, {"_id": 0})
    await db.auth_handoffs.delete_one({"handoff_id": handoff_id})
    return {
        "status": "ready",
        "session_token": doc["session_token"],
        "user": user,
    }


@app.get("/api/auth/me")
async def auth_me(user=Depends(require_user)):
    # Decorate the user payload with the effective owner-tier flag so the
    # frontend can render the Full Access badge and unlock owner-only tabs
    # (Backups, Notifs, Availability, Homepage settings) without making a
    # second round-trip.
    out = dict(user)
    out["dashboard_full_access"] = bool(user.get("dashboard_full_access", False))
    out["dashboard_tabs"] = list(user.get("dashboard_tabs") or [])
    out["effective_owner"] = (user.get("role") == "owner") or out["dashboard_full_access"]
    # Personal messaging permissions:
    #   • Owner → always permitted.
    #   • Team members (any non-patient role) → permitted BY DEFAULT.
    #     Owner can explicitly revoke a team member by setting
    #     `can_send_personal_messages` to False on that user.
    #   • Patients → not permitted by default. Owner can authorize an
    #     individual patient by setting the flag to True.
    role = user.get("role", "")
    explicit = user.get("can_send_personal_messages")
    if role in ("owner", "primary_owner", "super_owner", "partner"):
        # Owner tier — always permitted per hierarchy.
        out["can_send_personal_messages"] = True
    elif role and role != "patient":
        # Default-True for staff. Only False if explicitly set to False.
        out["can_send_personal_messages"] = (explicit is not False)
    else:
        out["can_send_personal_messages"] = bool(explicit)
    return out



# ──────────────────────────────────────────────────────────────────
# Profile quick-stats — small numeric tiles rendered in the right edge
# of the Profile screen header. Two stats per role:
#   • Staff   →  Today's bookings  +  Pending consultations
#   • Patient →  Total bookings    +  Total records
# Cheap to compute (count_documents on indexed fields). Refreshes on
# screen focus.
# ──────────────────────────────────────────────────────────────────
STAFF_QUICKSTAT_ROLES = {"owner", "partner", "doctor", "assistant", "reception", "nursing"}


@app.get("/api/profile/quick-stats")
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


def _send_email(to: str, subject: str, html: str) -> bool:
    """Send a transactional email via Resend.

    NOTE: Resend's default test sender (`onboarding@resend.dev`) is
    restricted — it can ONLY deliver to the email address registered on
    the Resend account. To send OTPs / magic-links to arbitrary users,
    a verified custom domain must be set up at https://resend.com/domains
    and `RESEND_FROM_EMAIL` updated to `noreply@<your-domain>`.
    """
    if not _resend.api_key:
        try:
            print(f"[resend] no API key configured — skipping send to={to}")
        except Exception:
            pass
        return False
    try:
        resp = _resend.Emails.send({
            "from": RESEND_FROM,
            "to": [to],
            "subject": subject,
            "html": html,
        })
        try:
            # Resend returns {"id": "..."} on success; log it so we can
            # correlate later in the Resend dashboard / debug stuck mail.
            print(f"[resend] sent ok to={to} id={resp.get('id') if isinstance(resp, dict) else resp}")
        except Exception:
            pass
        return True
    except Exception as e:
        try:
            # Always surface the full error message so test-mode
            # restrictions ("you can only send to your own email") are
            # visible in supervisor logs instead of failing silently.
            print(f"[resend] send failed to={to}: {type(e).__name__}: {e}")
        except Exception:
            pass
        return False


# ── Magic Link ───────────────────────────────────────────────────
class MagicRequestBody(BaseModel):
    email: EmailStr


class MagicExchangeBody(BaseModel):
    token: str


@app.post("/api/auth/magic/request")
@limiter.limit("5/minute")
async def auth_magic_request(request: Request, body: MagicRequestBody):
    """Send the user a one-time login link by email. Always returns ok=True
    (even for unknown emails) so we never leak which addresses exist —
    user-enumeration mitigation."""
    email_l = body.email.strip().lower()
    token = _secrets.token_urlsafe(32)
    await db.auth_magic_tokens.insert_one({
        "token": token,
        "email": email_l,
        "expires_at": datetime.now(timezone.utc) + timedelta(minutes=15),
        "used": False,
        "created_at": datetime.now(timezone.utc),
    })
    deep_link = f"consulturo://magic-link?token={token}"
    backend = (os.environ.get("PUBLIC_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://urology-pro.preview.emergentagent.com").rstrip("/")
    web_link = f"{backend}/auth/magic/redirect?token={token}"
    html = f"""
<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111">
  <h2 style="color:#0E7C8B;margin:0 0 8px">Sign in to ConsultUro</h2>
  <p>Tap the button below to finish signing in. The link expires in 15 minutes.</p>
  <p style="margin:24px 0">
    <a href="{web_link}" style="background:#0E7C8B;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;display:inline-block;font-weight:600">Open ConsultUro</a>
  </p>
  <p style="font-size:12px;color:#666">If the button doesn't work, copy this link:<br>
    <span style="word-break:break-all">{web_link}</span><br><br>
    Or paste this into the app: <code>{deep_link}</code>
  </p>
  <p style="font-size:12px;color:#999;margin-top:24px">If you didn't request this, you can safely ignore this email.</p>
</div>"""
    _send_email(email_l, "Sign in to ConsultUro", html)
    return {"ok": True}


@app.get("/auth/magic/redirect")
async def auth_magic_redirect(token: str):
    """Web bridge for magic-link emails.

    Strategy: try the native deep-link first (`consulturo://magic-link?...`)
    so an installed APK opens directly. If after ~1.5s the page is still
    visible (deep-link was a no-op because the app isn't installed, or the
    user is on desktop/laptop), redirect to the web app's `/magic-link`
    route — which exchanges the token via /api/auth/magic/exchange and
    signs the user in inside the browser.

    This makes the magic-link work in BOTH:
      • mobile with the APK installed (fastest path),
      • mobile without the APK (web fallback inside Chrome/Safari),
      • desktop / laptop (always web).
    """
    safe = (token or "").replace('"', '').replace('\\', '').replace('<', '').replace('>', '')
    # Use a SAME-ORIGIN relative URL — the bridge HTML is served from the
    # same Kubernetes ingress as the Expo web frontend, so /magic-link
    # resolves to the frontend route on whatever domain the user is on.
    web_link = f"/magic-link?token={safe}"
    # Use the TRIPLE-slash form so Expo Router treats `magic-link` as a
    # path (not a host). With `consulturo://magic-link?...` some Android
    # builds parse `magic-link` as the host, miss the route and show
    # the "Unmatched route" page. The `consulturo:///magic-link?...`
    # form unambiguously routes to /app/magic-link.tsx.
    deep_link = f"consulturo:///magic-link?token={safe}"
    html = f"""<!doctype html><html><head><meta charset="utf-8"><title>Signing you in…</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{{font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:48px 24px;text-align:center;color:#111;background:#F4F9F9}}
  .logo{{width:72px;height:72px;border-radius:18px;background:#0E7C8B;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:28px;margin-bottom:18px;letter-spacing:-1px}}
  h1{{color:#0E7C8B;margin:6px 0;font-size:22px}}
  p{{color:#5E7C81;margin:8px 0;font-size:14px;line-height:1.5}}
  .btn{{display:block;background:#0E7C8B;color:#fff;padding:14px 22px;border-radius:12px;text-decoration:none;margin:16px auto;font-weight:600;max-width:280px;border:0;cursor:pointer;font-size:15px}}
  .btn.alt{{background:#fff;color:#0E7C8B;border:1.5px solid #0E7C8B}}
  .spinner{{width:36px;height:36px;border:3px solid #E2ECEC;border-top-color:#0E7C8B;border-radius:50%;animation:spin 1s linear infinite;margin:24px auto 8px}}
  @keyframes spin{{to{{transform:rotate(360deg)}}}}
  .small{{font-size:11px;color:#A0B5B8;margin-top:24px}}
</style>
</head><body>
<div class="logo">CU</div>
<h1>Signing you in…</h1>
<p id="msg">Trying to open in the ConsultUro app first.<br/>If you don't have the app, we'll continue in your browser.</p>
<div class="spinner" id="spin"></div>
<a class="btn"     id="appBtn" href="{deep_link}">Open in app</a>
<a class="btn alt" id="webBtn" href="{web_link}">Continue in browser</a>
<p class="small">If nothing happens within a few seconds, tap "Continue in browser".</p>
<script>
  // Try the deep link automatically. If the APK is installed, the browser
  // tab will become hidden (the OS hands off to the app). After 1.5s of
  // remaining visible we assume no app and bounce to the web sign-in page.
  var didDeep = false;
  function tryDeep() {{ try {{ window.location.href = 'consulturo:///magic-link?token={safe}'; didDeep = true; }} catch(e) {{}} }}
  setTimeout(tryDeep, 50);
  setTimeout(function() {{
    if (document.visibilityState === 'visible') {{
      window.location.replace('{web_link}');
    }}
  }}, 1500);
</script>
</body></html>"""
    return HTMLResponse(content=html, status_code=200)


@app.post("/api/auth/magic/exchange")
@limiter.limit("20/minute")
async def auth_magic_exchange(request: Request, body: MagicExchangeBody):
    rec = await db.auth_magic_tokens.find_one({"token": body.token})
    if not rec:
        raise HTTPException(status_code=400, detail="Invalid or expired link")
    expires_at = rec.get("expires_at")
    if expires_at and expires_at.replace(tzinfo=timezone.utc) if expires_at.tzinfo is None else expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Link has expired")
    if rec.get("used"):
        raise HTTPException(status_code=400, detail="Link already used")
    await db.auth_magic_tokens.update_one({"token": body.token}, {"$set": {"used": True}})

    user_doc = await _ensure_user_for_email(rec["email"])
    session_token = _secrets.token_urlsafe(40)
    await db.user_sessions.insert_one({
        "user_id": user_doc["user_id"],
        "session_token": session_token,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "created_at": datetime.now(timezone.utc),
    })
    return {"user": user_doc, "session_token": session_token}


# ── Email OTP ────────────────────────────────────────────────────
class OtpRequestBody(BaseModel):
    email: EmailStr


class OtpVerifyBody(BaseModel):
    email: EmailStr
    code: str


@app.post("/api/auth/otp/request")
@limiter.limit("5/minute")
async def auth_otp_request(request: Request, body: OtpRequestBody):
    email_l = body.email.strip().lower()
    code = f"{_secrets.randbelow(1000000):06d}"
    # Wipe any existing pending codes for this email so only the latest works.
    await db.auth_otp_codes.delete_many({"email": email_l})
    await db.auth_otp_codes.insert_one({
        "email": email_l,
        "code": code,
        "expires_at": datetime.now(timezone.utc) + timedelta(minutes=10),
        "attempts": 0,
        "created_at": datetime.now(timezone.utc),
    })
    html = f"""
<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111">
  <h2 style="color:#0E7C8B;margin:0 0 8px">Your sign-in code</h2>
  <p>Enter this 6-digit code in the ConsultUro app to finish signing in:</p>
  <div style="font-size:36px;letter-spacing:6px;font-weight:700;background:#F3F7F7;color:#0E7C8B;padding:16px 24px;border-radius:10px;text-align:center;margin:18px 0;display:inline-block">
    {code}
  </div>
  <p style="font-size:12px;color:#666">This code expires in 10 minutes. Don't share it with anyone.</p>
  <p style="font-size:12px;color:#999;margin-top:24px">If you didn't request this, you can safely ignore this email.</p>
</div>"""
    sent = _send_email(email_l, f"Your ConsultUro code: {code}", html)
    if not sent:
        # Surface the failure to the client so they can see why no
        # email arrived (instead of waiting for a code that never
        # comes). Most common cause is Resend's test-mode restriction.
        raise HTTPException(
            status_code=502,
            detail=(
                "Could not send the sign-in email. "
                "If the clinic's email sender domain isn't verified yet, "
                "Resend only delivers to the account owner. "
                "Please ask the admin to verify a domain at resend.com/domains."
            ),
        )
    return {"ok": True}


@app.post("/api/auth/otp/verify")
@limiter.limit("10/minute")
async def auth_otp_verify(request: Request, body: OtpVerifyBody):
    email_l = body.email.strip().lower()
    code = (body.code or "").strip()
    rec = await db.auth_otp_codes.find_one({"email": email_l})
    if not rec:
        raise HTTPException(status_code=400, detail="No pending code for this email")
    expires_at = rec.get("expires_at")
    if expires_at and (expires_at.replace(tzinfo=timezone.utc) if expires_at.tzinfo is None else expires_at) < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Code expired — request a new one")
    if rec.get("attempts", 0) >= 5:
        raise HTTPException(status_code=429, detail="Too many attempts — request a new code")
    if rec["code"] != code:
        await db.auth_otp_codes.update_one({"_id": rec["_id"]}, {"$inc": {"attempts": 1}})
        raise HTTPException(status_code=400, detail="Incorrect code")
    await db.auth_otp_codes.delete_one({"_id": rec["_id"]})

    user_doc = await _ensure_user_for_email(email_l)
    session_token = _secrets.token_urlsafe(40)
    await db.user_sessions.insert_one({
        "user_id": user_doc["user_id"],
        "session_token": session_token,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "created_at": datetime.now(timezone.utc),
    })
    return {"user": user_doc, "session_token": session_token}


# ── Firebase Phone Auth ──────────────────────────────────────────
# Frontend gets a Firebase ID token from Phone-Auth flow, posts it here;
# we lookup the phone number via Firebase Identity Toolkit REST and issue
# our own session_token (matching the rest of the auth model).
class FirebasePhoneVerifyBody(BaseModel):
    id_token: str
    email: Optional[EmailStr] = None  # required for first-time signups


FIREBASE_API_KEY = os.environ.get("FIREBASE_WEB_API_KEY") or "AIzaSyA8oPYsTL2OV9DvbGrUu8CM3DdszL3q4g4"


@app.post("/api/auth/firebase-phone/verify")
@limiter.limit("20/minute")
async def auth_firebase_phone_verify(request: Request, body: FirebasePhoneVerifyBody):
    import httpx
    url = f"https://identitytoolkit.googleapis.com/v1/accounts:lookup?key={FIREBASE_API_KEY}"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, json={"idToken": body.id_token})
        if resp.status_code != 200:
            raise HTTPException(status_code=400, detail=f"Firebase token invalid: {resp.text[:200]}")
        data = resp.json()
        users = data.get("users") or []
        if not users:
            raise HTTPException(status_code=400, detail="Firebase token returned no user")
        fbuser = users[0]
        phone = (fbuser.get("phoneNumber") or "").strip()
        if not phone:
            raise HTTPException(status_code=400, detail="No phone number in token")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Token verify failed: {e}")

    # Find user by phone first, then by email (covers linking).
    user_doc = await db.users.find_one({"phone": phone}, {"_id": 0})
    needs_email = False
    if not user_doc:
        # New phone — must have email to create account (per the unified user model).
        if body.email:
            email_l = body.email.strip().lower()
            existing_by_email = await db.users.find_one({"email": email_l}, {"_id": 0})
            if existing_by_email:
                # User exists by email — LINK phone to it.
                await db.users.update_one(
                    {"user_id": existing_by_email["user_id"]},
                    {"$set": {"phone": phone, "phone_verified_at": datetime.now(timezone.utc)}},
                )
                user_doc = await db.users.find_one({"user_id": existing_by_email["user_id"]}, {"_id": 0})
            else:
                # Create a brand-new account with both phone + email.
                perms = await resolve_role_for_email(email_l)
                user_id = f"user_{uuid.uuid4().hex[:12]}"
                await db.users.insert_one({
                    "user_id": user_id,
                    "email": email_l,
                    "phone": phone,
                    "name": email_l.split("@")[0].replace(".", " ").title(),
                    "role": perms["role"],
                    "can_approve_bookings": perms["can_approve_bookings"],
                    "can_approve_broadcasts": perms["can_approve_broadcasts"],
                    "phone_verified_at": datetime.now(timezone.utc),
                    "created_at": datetime.now(timezone.utc),
                })
                user_doc = await db.users.find_one({"user_id": user_id}, {"_id": 0})
        else:
            # Phone OK, but no account & no email supplied → frontend must
            # show an "add email" screen and re-call this endpoint with email.
            return {"status": "needs_email", "phone": phone}

    session_token = _secrets.token_urlsafe(40)
    await db.user_sessions.insert_one({
        "user_id": user_doc["user_id"],
        "session_token": session_token,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "created_at": datetime.now(timezone.utc),
    })
    return {"status": "ok", "user": user_doc, "session_token": session_token}


# ── Profile linking — let signed-in users add the missing identifier ─
class LinkPhoneBody(BaseModel):
    id_token: str  # Firebase phone-auth token


@app.post("/api/auth/link-phone")
@limiter.limit("10/minute")
async def auth_link_phone(request: Request, body: LinkPhoneBody, user=Depends(require_user)):
    import httpx
    url = f"https://identitytoolkit.googleapis.com/v1/accounts:lookup?key={FIREBASE_API_KEY}"
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(url, json={"idToken": body.id_token})
    if resp.status_code != 200:
        raise HTTPException(status_code=400, detail="Invalid Firebase token")
    fbuser = (resp.json().get("users") or [{}])[0]
    phone = (fbuser.get("phoneNumber") or "").strip()
    if not phone:
        raise HTTPException(status_code=400, detail="No phone in token")
    other = await db.users.find_one({"phone": phone, "user_id": {"$ne": user["user_id"]}})
    if other:
        raise HTTPException(status_code=409, detail="This phone is already linked to another account")
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"phone": phone, "phone_verified_at": datetime.now(timezone.utc)}},
    )
    return {"ok": True, "phone": phone}


class LinkEmailBody(BaseModel):
    email: EmailStr


@app.post("/api/auth/link-email/request")
@limiter.limit("5/minute")
async def auth_link_email_request(request: Request, body: LinkEmailBody, user=Depends(require_user)):
    """Send an OTP to the email address being linked. Reuses the OTP store
    with a special `link_user_id` flag so verification is bound to the
    current session."""
    email_l = body.email.strip().lower()
    other = await db.users.find_one({"email": email_l, "user_id": {"$ne": user["user_id"]}})
    if other:
        raise HTTPException(status_code=409, detail="This email is already linked to another account")
    code = f"{_secrets.randbelow(1000000):06d}"
    await db.auth_otp_codes.delete_many({"email": email_l, "link_user_id": user["user_id"]})
    await db.auth_otp_codes.insert_one({
        "email": email_l,
        "code": code,
        "expires_at": datetime.now(timezone.utc) + timedelta(minutes=10),
        "attempts": 0,
        "link_user_id": user["user_id"],
        "created_at": datetime.now(timezone.utc),
    })
    html = f"""
<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111">
  <h2 style="color:#0E7C8B">Link this email to ConsultUro</h2>
  <p>Enter this 6-digit code in the app to confirm:</p>
  <div style="font-size:36px;letter-spacing:6px;font-weight:700;background:#F3F7F7;color:#0E7C8B;padding:16px 24px;border-radius:10px;text-align:center;margin:18px 0;display:inline-block">{code}</div>
  <p style="font-size:12px;color:#666">This code expires in 10 minutes.</p>
</div>"""
    _send_email(email_l, f"Confirm email for ConsultUro: {code}", html)
    return {"ok": True}


class LinkEmailVerifyBody(BaseModel):
    email: EmailStr
    code: str


@app.post("/api/auth/link-email/verify")
@limiter.limit("10/minute")
async def auth_link_email_verify(request: Request, body: LinkEmailVerifyBody, user=Depends(require_user)):
    email_l = body.email.strip().lower()
    rec = await db.auth_otp_codes.find_one({"email": email_l, "link_user_id": user["user_id"]})
    if not rec or rec.get("code") != (body.code or "").strip():
        if rec:
            await db.auth_otp_codes.update_one({"_id": rec["_id"]}, {"$inc": {"attempts": 1}})
        raise HTTPException(status_code=400, detail="Incorrect or expired code")
    await db.auth_otp_codes.delete_one({"_id": rec["_id"]})
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"email": email_l, "email_verified_at": datetime.now(timezone.utc)}},
    )
    return {"ok": True, "email": email_l}


@app.post("/api/auth/logout")
@limiter.limit("20/minute")
async def auth_logout(
    request: Request,
    response: Response,
    session_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None),
):
    token = session_token
    if not token and authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1]
    if token:
        await db.user_sessions.delete_one({"session_token": token})
    response.delete_cookie("session_token", path="/")
    return {"ok": True}


# ============================================================
# DOCTOR INFO
# ============================================================


@app.get("/api/doctor")
async def get_doctor_info(lang: str = "en"):
    from doctor_content import get_locale as _doc_locale, localize_stats, localize_past_experience
    if lang not in ("en", "hi", "gu"):
        lang = "en"
    loc = _doc_locale(lang)
    stats = localize_stats([
        {"label": "Years of experience", "value": "11+"},
        {"label": "Surgeries performed", "value": "3000+"},
        {"label": "Kidney transplants", "value": "150+"},
        {"label": "Consultations", "value": "15000+"},
    ], lang)
    past_exp = localize_past_experience([
        {"role": "Resident Doctor — General Surgery", "place": "Sir T Hospital, Bhavnagar"},
        {"role": "Senior Resident — General Surgery", "place": "Sir T Hospital, Bhavnagar"},
        {"role": "Assistant Professor — General Surgery", "place": "Shantabaa Medical College & Civil Hospital"},
        {"role": "Urology Resident (DrNB)", "place": "Gleneagles Super-speciality Hospital & Transplant Centre, Parel, Mumbai"},
    ], lang)
    return {
        "name": "Dr. Sagar Joshi",
        "title": loc["title"],
        "tagline": loc["tagline"],
        "short_bio": loc["short_bio"],
        "personal_statement": loc["personal_statement"],
        "stats": stats,
        "highlights": loc["highlights"],
        "languages": ["English", "Gujarati", "Hindi"],
        "qualifications": [
            {"degree": "MBBS", "institute": "Government Medical College, Bhavnagar", "year": "2014", "note": "Bachelor of Medicine and Bachelor of Surgery."},
            {"degree": "MS (General Surgery)", "institute": "Government Medical College, Bhavnagar", "year": "2018", "note": "Master of Surgery — comprehensive training in open and laparoscopic general surgery."},
            {
                "degree": "DrNB Urology",
                "institute": "Gleneagles Global Hospital, Parel, Mumbai",
                "year": "2022",
                "note": "Super-specialty board certification in Urology. Trained in endourology, advanced laparoscopy, robotic surgery, laser lithotripsy, prostate laser surgery, kidney transplantation, vascular access for haemodialysis and urologic ultrasonography.",
            },
        ],
        "past_experience": past_exp,
        "memberships": [
            {"name": "Urological Society of India (USI)", "icon": "ribbon"},
            {"name": "Association of Surgeons of India (ASI)", "icon": "ribbon"},
            {"name": "Indian Medical Association (IMA)", "icon": "ribbon"},
        ],
        "clinics": [
            {"name": "Sterling Hospitals, Race Course", "address": "Opp. Inox Cinema, Race Course Road, Vadodara, Gujarat", "hours": "Mon–Sat, 10:00 AM – 1:00 PM"},
            {"name": "Sterling Hospitals, Bhayli", "address": "Behind Waves Club, Bhayli, Vadodara – 391410, Gujarat", "hours": "Mon–Sat, 5:00 PM – 8:00 PM"},
        ],
        "availability": {
            "mon_sat": loc["availability_phrases"]["mon_sat"],
            "sunday": loc["availability_phrases"]["sunday"],
            "whatsapp": "+91 81550 75669",
        },
        "service_categories": [
            {
                "title": "Kidney & Stone",
                "icon": "water",
                "items": [
                    "Laser Stone Surgery (RIRS)",
                    "PCNL (Percutaneous)",
                    "ESWL (Shock-Wave)",
                    "Kidney Cancer Surgery",
                    "Hydronephrosis & PUJ Repair",
                ],
            },
            {
                "title": "Kidney Transplantation",
                "icon": "heart",
                "items": [
                    "Living-donor Kidney Transplant",
                    "Deceased-donor (Cadaveric) Transplant",
                    "ABO-incompatible Transplant",
                    "Pre-transplant Evaluation",
                    "Post-transplant Follow-up & Care",
                    "Vascular Access for Haemodialysis",
                ],
            },
            {
                "title": "Prostate",
                "icon": "medkit",
                "items": [
                    "HoLEP Laser Prostate Surgery",
                    "TURP (Bipolar / Saline)",
                    "MRI-targeted Prostate Biopsy",
                    "Prostate Cancer Surgery",
                    "PSA & IPSS Screening",
                ],
            },
            {
                "title": "Laparoscopy & Robotics",
                "icon": "hardware-chip",
                "items": [
                    "Laparoscopic Nephrectomy",
                    "Laparoscopic Pyeloplasty",
                    "Laparoscopic Adrenalectomy",
                    "Robotic-assisted Urology",
                ],
            },
            {
                "title": "Male Health & Andrology",
                "icon": "male",
                "items": [
                    "Erectile Dysfunction",
                    "Male Infertility",
                    "Peyronie's Disease",
                    "Varicocelectomy",
                    "Vasectomy",
                    "Circumcision",
                ],
            },
            {
                "title": "Bladder, Female & General Urology",
                "icon": "people",
                "items": [
                    "Bladder Cancer (TURBT)",
                    "Urinary Incontinence",
                    "Recurrent UTI",
                    "Urethral Stricture",
                    "Paediatric Urology",
                ],
            },
        ],
        # Flat list retained for legacy clients (chips rendering)
        "services": [
            "Kidney Stone Treatment (Laser / RIRS / PCNL)",
            "Prostate (BPH) Laser Surgery (HoLEP / TURP)",
            "Urologic Cancer Surgery (Kidney, Prostate, Bladder)",
            "Advanced Laparoscopy & Robotic Urology",
            "Kidney Transplantation",
            "Male Infertility & Andrology",
            "Erectile Dysfunction Management",
            "Female Urology & Incontinence",
            "Paediatric Urology",
            "Endourology & URSL",
        ],
        "contact": {
            "whatsapp": "+918155075669",
            "phone": "+918155075669",
            "email": "contact@drsagarjoshi.com",
            "website": "https://www.drsagarjoshi.com",
        },
        "socials": {
            "website": "https://www.drsagarjoshi.com",
            "youtube": "https://www.youtube.com/@dr_sagar_j",
            "facebook": "https://www.facebook.com/drsagarjoshi1",
            "instagram": "https://www.instagram.com/sagar_joshi133",
            "twitter": "http://twitter.com/Sagar_j_joshi",
        },
        "photo_url": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/6ng2cxnu_IMG_20260421_191126.jpg",
    }


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


DISEASES = [
    {
        "id": "kidney-stones",
        "name": "Kidney Stones",
        "icon": "water",
        "tagline": "Hard mineral deposits in kidneys causing severe pain.",
        "overview": "Kidney stones (renal calculi) are hard deposits of minerals and salts that form inside the kidneys. They can affect any part of the urinary tract — from kidneys to bladder — and often form when urine becomes concentrated, allowing minerals to crystallise and stick together.",
        "symptoms": ["Severe, sharp pain in the side and back, below the ribs", "Pain radiating to the lower abdomen and groin", "Pain during urination", "Pink, red, or brown urine (blood in urine)", "Cloudy or foul-smelling urine", "Nausea and vomiting", "Persistent need to urinate, urinating more often", "Fever and chills if an infection is present"],
        "causes": ["Dehydration / low water intake", "High salt, sugar, or animal-protein diet", "Obesity and metabolic syndrome", "Family or personal history of stones", "Certain medical conditions (hyperparathyroidism, gout, UTI)"],
        "treatments": ["Hydration and medical expulsive therapy (for small stones)", "Extracorporeal Shock Wave Lithotripsy (ESWL)", "Ureteroscopy with laser lithotripsy (RIRS)", "Percutaneous Nephrolithotomy (PCNL) for large stones"],
        "when_to_see": "Seek urgent care if you have severe pain, blood in urine, fever, inability to pass urine, or persistent vomiting.",
    },
    {
        "id": "bph-prostate",
        "name": "Enlarged Prostate (BPH)",
        "icon": "human-male-height",
        "tagline": "Non-cancerous prostate enlargement causing urinary symptoms.",
        "overview": "Benign Prostatic Hyperplasia (BPH) is a common condition in men over 50 where the prostate gland enlarges and blocks urine flow, causing bothersome urinary symptoms.",
        "symptoms": ["Weak or slow urinary stream", "Difficulty starting urination", "Frequent urination, especially at night (nocturia)", "Sudden urge to urinate", "Intermittent stream", "Incomplete bladder emptying", "Straining to urinate"],
        "causes": ["Ageing and hormonal changes", "Family history of prostate problems", "Obesity, diabetes, heart disease"],
        "treatments": ["Lifestyle & fluid management", "Alpha-blockers and 5-alpha-reductase inhibitors", "HoLEP (Holmium Laser Enucleation of Prostate)", "TURP (Transurethral Resection of Prostate)", "Prostatic Urethral Lift (UroLift)"],
        "when_to_see": "Take the IPSS score in the app — a score of 8+ warrants a urology consultation.",
    },
    {
        "id": "prostate-cancer",
        "name": "Prostate Cancer",
        "icon": "alert-decagram",
        "tagline": "Most common cancer in men — early detection saves lives.",
        "overview": "Prostate cancer develops in the prostate gland. Early-stage prostate cancer often has no symptoms; it is usually detected via PSA blood tests and digital rectal examination (DRE).",
        "symptoms": ["Trouble urinating", "Decreased force in the stream of urine", "Blood in urine or semen", "Bone pain (advanced stage)", "Unexplained weight loss", "Erectile dysfunction"],
        "causes": ["Age above 50", "Family history / genetic factors (BRCA1/2)", "Obesity"],
        "treatments": ["Active surveillance (low-risk cases)", "Robotic radical prostatectomy", "Radiation therapy", "Hormone therapy and chemotherapy"],
        "when_to_see": "All men above 50 (or 45 with family history) should get a yearly PSA screening.",
    },
    {
        "id": "uti",
        "name": "Urinary Tract Infection (UTI)",
        "icon": "bacteria",
        "tagline": "Bacterial infection of the urinary system.",
        "overview": "A UTI is an infection in any part of your urinary system — kidneys, ureters, bladder or urethra. Most infections involve the lower urinary tract and are much more common in women.",
        "symptoms": ["Burning sensation on urination", "Frequent urge to urinate with little urine passed", "Cloudy, red, or strong-smelling urine", "Pelvic pain (women) or rectal pain (men)", "Fever, chills, back pain (kidney involvement)"],
        "causes": ["E. coli from the gastrointestinal tract", "Inadequate hydration", "Urinary retention", "Catheter use", "Diabetes"],
        "treatments": ["Targeted antibiotics based on urine culture", "Hydration and urinary alkalisers", "Prophylactic antibiotics for recurrent UTIs", "Treatment of underlying cause"],
        "when_to_see": "Consult immediately if you have fever, back pain, vomiting, or blood in urine.",
    },
    {
        "id": "incontinence",
        "name": "Urinary Incontinence",
        "icon": "water-off",
        "tagline": "Involuntary leakage of urine — treatable at any age.",
        "overview": "Urinary incontinence is the loss of bladder control. It ranges from occasional leakage when coughing or sneezing to an urgent need to urinate that prevents reaching a toilet in time.",
        "symptoms": ["Leakage on coughing/sneezing (stress type)", "Sudden intense urge followed by leakage (urge type)", "Frequent dribbling (overflow type)", "Constant leakage (total incontinence)"],
        "causes": ["Weak pelvic floor (post-childbirth, menopause)", "Enlarged prostate / post-prostate-surgery", "Neurological disorders", "UTIs and constipation"],
        "treatments": ["Pelvic floor (Kegel) exercises — see Education section", "Bladder training", "Medications (anticholinergics, beta-3 agonists)", "Sling procedures / bulking agents", "Sacral neuromodulation"],
        "when_to_see": "See a urologist if leakage affects your daily activities or quality of life.",
    },
    {
        "id": "erectile-dysfunction",
        "name": "Erectile Dysfunction",
        "icon": "heart-broken",
        "tagline": "Common, treatable — often a warning sign of heart disease.",
        "overview": "Erectile dysfunction (ED) is the inability to get or keep an erection firm enough for sexual intercourse. It can signal underlying vascular or metabolic disease.",
        "symptoms": ["Trouble getting an erection", "Trouble keeping an erection", "Reduced sexual desire"],
        "causes": ["Diabetes, hypertension, high cholesterol", "Obesity and sedentary lifestyle", "Smoking, alcohol, and drug use", "Psychological (stress, anxiety, depression)", "Low testosterone, thyroid disorders"],
        "treatments": ["Lifestyle modification, exercise, weight loss", "Oral medications (PDE5 inhibitors)", "Injections / vacuum devices", "Hormonal therapy if deficient", "Penile implant surgery (refractory cases)"],
        "when_to_see": "If ED persists for more than a few weeks, get evaluated — it can be the first sign of heart disease.",
    },
    {
        "id": "kidney-transplant",
        "name": "Kidney Transplant",
        "icon": "medical-bag",
        "tagline": "Life-changing treatment for end-stage kidney disease.",
        "overview": "A kidney transplant is surgery to place a healthy kidney from a living or deceased donor into a person whose kidneys no longer function properly. It offers better quality of life and survival than long-term dialysis.",
        "symptoms": ["Considered for patients with CKD Stage 5 / on dialysis", "eGFR < 15 ml/min/1.73m²", "Uncontrolled complications of uraemia"],
        "causes": ["Diabetes mellitus", "Hypertension", "Chronic glomerulonephritis", "Polycystic kidney disease"],
        "treatments": ["Pre-transplant work-up (HLA, crossmatch, virology)", "Living-donor transplant (preferred)", "Deceased-donor transplant", "Life-long immunosuppression"],
        "when_to_see": "Discuss transplant options once your kidney function falls below 20% — earlier is better.",
    },
    {
        "id": "bladder-cancer",
        "name": "Bladder Cancer",
        "icon": "alert-octagon",
        "tagline": "Painless blood in urine is the commonest warning sign.",
        "overview": "Bladder cancer begins most often in the cells that line the inside of the bladder. It is more common in smokers and older adults.",
        "symptoms": ["Blood in urine (haematuria) — often painless", "Frequent urination", "Burning on urination", "Pelvic pain", "Back pain"],
        "causes": ["Smoking (biggest risk factor)", "Exposure to industrial chemicals / dyes", "Chronic bladder inflammation", "Family history"],
        "treatments": ["TURBT (transurethral resection of bladder tumour)", "Intravesical BCG therapy", "Radical cystectomy with neobladder", "Chemotherapy / immunotherapy"],
        "when_to_see": "Painless blood in the urine — even a single episode — needs urgent urology review.",
    },
    {
        "id": "male-infertility",
        "name": "Male Infertility",
        "icon": "dna",
        "tagline": "Affects ~50% of infertility cases — mostly treatable.",
        "overview": "Male infertility is any health issue in a man that lowers the chances of his female partner getting pregnant. It contributes to roughly half of all infertility cases.",
        "symptoms": ["Inability to conceive after 1 year of trying", "Low libido / erectile problems", "Pain or swelling in the testicle area", "Recurrent respiratory infections (rare)"],
        "causes": ["Varicocele", "Infections / STDs", "Hormonal imbalance", "Obstruction (post-vasectomy, congenital)", "Lifestyle factors – heat, smoking, alcohol"],
        "treatments": ["Varicocelectomy", "Hormonal therapy", "Surgical sperm retrieval (PESA/TESE)", "Assisted reproduction (IUI / IVF / ICSI)"],
        "when_to_see": "Couples should see a specialist if they have been trying for 12 months (6 months if the woman is over 35).",
    },
    {
        "id": "kidney-cancer",
        "name": "Kidney Cancer (RCC)",
        "icon": "kidney",
        "tagline": "Often found incidentally on ultrasound or CT scan.",
        "overview": "Renal cell carcinoma (RCC) is the commonest kidney cancer in adults. Early tumours have no symptoms and are usually found on scans done for another reason.",
        "symptoms": ["Blood in urine", "Flank pain or a lump in the side", "Unexplained weight loss, fever, fatigue", "High blood pressure (sometimes)"],
        "causes": ["Smoking", "Obesity, hypertension", "Long-term dialysis", "Family syndromes (VHL, tuberous sclerosis)"],
        "treatments": ["Partial nephrectomy (small tumours)", "Radical nephrectomy (laparoscopic / robotic)", "Ablation (RFA, cryotherapy) for small tumours", "Targeted therapy / immunotherapy for advanced RCC"],
        "when_to_see": "Any solid kidney mass on ultrasound needs urology review — most are curable when small.",
    },
    {
        "id": "testicular-cancer",
        "name": "Testicular Cancer",
        "icon": "gender-male",
        "tagline": "Young men's cancer — highly curable when caught early.",
        "overview": "Testicular cancer is the most common cancer in men aged 15–35. Almost all stages are highly curable.",
        "symptoms": ["Painless lump or swelling in a testicle", "Heaviness in the scrotum", "Dull ache in the abdomen or groin", "Sudden collection of fluid in the scrotum"],
        "causes": ["Undescended testis (cryptorchidism)", "Family history", "HIV infection", "Klinefelter syndrome"],
        "treatments": ["Radical inguinal orchiectomy", "Retroperitoneal lymph-node dissection", "Chemotherapy (BEP regimen)", "Surveillance for stage I disease"],
        "when_to_see": "Any hard, painless lump in a testicle \u2014 see a urologist the same week.",
    },
    {
        "id": "phimosis",
        "name": "Phimosis",
        "icon": "circle-slice-1",
        "tagline": "Tight foreskin that won't retract \u2014 simple surgery fixes it.",
        "overview": "Phimosis is a condition where the foreskin of the penis cannot be retracted over the glans. It can be physiological (in children) or pathological (due to scarring, BXO).",
        "symptoms": ["Difficulty pulling back the foreskin", "Ballooning of foreskin during urination", "Pain during erection or intercourse", "Recurrent balanitis (infection)"],
        "causes": ["BXO / lichen sclerosus", "Recurrent infections", "Poor hygiene", "Diabetes"],
        "treatments": ["Topical steroid cream (0.05% betamethasone)", "Circumcision (open or stapler)", "Preputioplasty (for mild cases)"],
        "when_to_see": "If the foreskin is splitting, bleeding or causing painful intercourse \u2014 book a consultation.",
    },
    {
        "id": "hydrocele",
        "name": "Hydrocele",
        "icon": "water-circle",
        "tagline": "Painless fluid collection around the testicle.",
        "overview": "A hydrocele is a painless build-up of fluid around a testicle. It is common in newborns and also in men over 40.",
        "symptoms": ["Painless scrotal swelling, larger in the evening", "Feeling of heaviness or drag", "Bluish translucent swelling on torch test"],
        "causes": ["Idiopathic (most adults)", "After infection / trauma / surgery", "Filariasis (in endemic regions)", "Malignancy (rare)"],
        "treatments": ["Observation for small, asymptomatic hydroceles", "Open hydrocelectomy (Jaboulay / Lord's procedure)", "Aspiration + sclerotherapy (frail patients)"],
        "when_to_see": "Any new scrotal swelling should be scanned to exclude tumour or hernia.",
    },
    {
        "id": "varicocele",
        "name": "Varicocele",
        "icon": "chart-tree",
        "tagline": "Varicose veins of the scrotum \u2014 commonest reversible cause of male infertility.",
        "overview": "A varicocele is an enlargement of the pampiniform plexus of veins inside the scrotum, most often on the left. It can cause reduced sperm count and testicular atrophy.",
        "symptoms": ["'Bag of worms' feel in the scrotum", "Dull ache worse on standing, relieved on lying", "Reduced testicular size", "Infertility"],
        "causes": ["Incompetent valves in testicular veins", "Longer left testicular vein drainage into left renal vein"],
        "treatments": ["Sub-inguinal microsurgical varicocelectomy", "Laparoscopic varicocelectomy", "Percutaneous embolisation"],
        "when_to_see": "If you have scrotal ache, testicular shrinkage or subfertility \u2014 get a Doppler ultrasound.",
    },
    {
        "id": "undescended-testis",
        "name": "Undescended Testis",
        "icon": "arrow-up-down",
        "tagline": "If not corrected by age 1, increases cancer risk.",
        "overview": "Cryptorchidism is a condition where one or both testicles have not descended into the scrotum by birth. Early correction prevents infertility and lowers cancer risk.",
        "symptoms": ["Empty scrotum on one or both sides", "Palpable testis in the groin", "Asymmetric scrotum"],
        "causes": ["Prematurity", "Low birth weight", "Family history", "Hormonal factors"],
        "treatments": ["Observation up to 6 months", "Orchidopexy (surgery) between 6\u201318 months of age", "Laparoscopy for non-palpable testis"],
        "when_to_see": "Any boy with one or both testes not in the scrotum by 6 months needs paediatric urology review.",
    },
    {
        "id": "ureteric-stricture",
        "name": "Ureteric Stricture",
        "icon": "pipe",
        "tagline": "Narrowing of the ureter that blocks urine flow.",
        "overview": "A ureteric stricture is a narrow segment of the ureter that obstructs urine drainage from the kidney, risking permanent damage if untreated.",
        "symptoms": ["Flank pain", "Recurrent UTIs", "Silent loss of kidney function (detected on scans)", "Blood in urine"],
        "causes": ["Post-surgical (pelvic / gynaec surgery)", "Stone or stent-related injury", "Radiotherapy", "TB, schistosomiasis"],
        "treatments": ["Endoscopic dilatation / laser incision", "Ureteric re-implantation (Boari flap / psoas hitch)", "Ileal ureter for long strictures"],
        "when_to_see": "Persistent hydronephrosis on scan without a stone needs urology assessment.",
    },
    {
        "id": "hematuria",
        "name": "Blood in Urine (Haematuria)",
        "icon": "water-alert",
        "tagline": "Never ignore \u2014 may be the earliest sign of cancer.",
        "overview": "Haematuria is the presence of red blood cells in urine \u2014 visible (gross) or found on testing (microscopic). Every episode deserves evaluation.",
        "symptoms": ["Red/pink/tea-coloured urine", "Clots in urine", "May be painless (urothelial cancer) or painful (stones / infection)"],
        "causes": ["Urinary tract infection", "Stones", "Bladder / kidney / prostate cancer", "BPH", "Glomerular disease"],
        "treatments": ["Urine culture, cytology, CT-urogram", "Cystoscopy (flexible, OPD)", "Treat the underlying cause"],
        "when_to_see": "Even a single episode of painless blood in urine warrants urology review \u2014 especially if you are over 40 or a smoker.",
    },
    {
        "id": "overactive-bladder",
        "name": "Overactive Bladder (OAB)",
        "icon": "water-pump",
        "tagline": "Sudden urges, frequent trips \u2014 very treatable.",
        "overview": "OAB is a syndrome of urinary urgency, frequency, nocturia and urge-incontinence. It affects 1 in 6 adults and responds well to training plus medication.",
        "symptoms": ["Sudden, compelling urge to urinate", "Urinary frequency (>8 times a day)", "Waking at night to urinate (>2 times)", "Urge incontinence"],
        "causes": ["Detrusor overactivity", "Ageing, weak pelvic floor", "Bladder stones / tumours / stones", "Neurological (Parkinson's, stroke, MS)"],
        "treatments": ["Bladder training + Kegel exercises", "Reduce caffeine / alcohol", "Anti-muscarinics (solifenacin, tolterodine)", "Beta-3 agonist (mirabegron)", "Sacral neuromodulation / Botox injections"],
        "when_to_see": "If the urgency disrupts work, sleep or social life \u2014 book a consultation.",
    },
    {
        "id": "ckd",
        "name": "Chronic Kidney Disease (CKD)",
        "icon": "kidney",
        "tagline": "Silent disease \u2014 early detection prevents dialysis.",
        "overview": "CKD is a gradual loss of kidney function over months to years, staged by eGFR. Many patients have no symptoms until very late stages.",
        "symptoms": ["Fatigue, swelling in feet/face", "Reduced urine output", "Itching, poor appetite", "Hypertension", "Anaemia"],
        "causes": ["Diabetes mellitus", "Hypertension", "Chronic glomerulonephritis", "Polycystic kidneys, obstructive uropathy"],
        "treatments": ["Tight BP and sugar control, SGLT2 inhibitors", "Protein-restricted diet, avoid NSAIDs", "Treat anaemia, bone\u2011mineral disease", "Plan for dialysis / transplant when eGFR <20"],
        "when_to_see": "Annual kidney profile (creatinine, eGFR, urine ACR) is mandatory if you have diabetes or hypertension.",
    },
    {
        "id": "aki",
        "name": "Acute Kidney Injury (AKI)",
        "icon": "alert",
        "tagline": "Rapid loss of kidney function \u2014 often reversible if treated early.",
        "overview": "AKI is a sudden drop in kidney function over hours to days, commonly seen after dehydration, sepsis, contrast scans or nephrotoxic drugs.",
        "symptoms": ["Reduced urine output", "Swelling, breathlessness", "Confusion, drowsiness", "Nausea, vomiting"],
        "causes": ["Dehydration, sepsis, shock (pre\u2011renal)", "Drugs \u2014 NSAIDs, aminoglycosides, contrast", "Obstruction (stones, BPH, tumour)"],
        "treatments": ["Fluid resuscitation, stop offending drugs", "Relieve obstruction \u2014 DJ stent / PCN", "Temporary dialysis if severe"],
        "when_to_see": "Sudden drop in urine output + swelling \u2014 go to an emergency room.",
    },
    {
        "id": "pcos-kidney",
        "name": "Polycystic Kidney Disease (PKD)",
        "icon": "circle-multiple",
        "tagline": "Inherited kidney cysts that enlarge over decades.",
        "overview": "Autosomal Dominant PKD is an inherited condition where multiple fluid-filled cysts grow in both kidneys, eventually causing kidney failure.",
        "symptoms": ["Flank pain", "Blood in urine", "Hypertension from young age", "Recurrent UTIs / cyst infection"],
        "causes": ["PKD1 / PKD2 gene mutations (dominant inheritance)"],
        "treatments": ["Tight BP control, tolvaptan for rapidly progressing disease", "Cyst deroofing if painful", "Dialysis / transplant at end-stage"],
        "when_to_see": "Screen all first-degree relatives of a PKD patient with an ultrasound.",
    },
    {
        "id": "hydronephrosis",
        "name": "Hydronephrosis",
        "icon": "water",
        "tagline": "Swelling of the kidney due to urine build-up.",
        "overview": "Hydronephrosis refers to dilatation of the kidney drainage system caused by obstruction to urine flow \u2014 from stones, PUJ obstruction, tumours or BPH.",
        "symptoms": ["Flank pain or dull ache", "Often silent (found incidentally)", "Nausea / vomiting", "UTIs"],
        "causes": ["Ureteric stones", "PUJ obstruction (congenital)", "Retroperitoneal fibrosis, tumours", "BPH with chronic retention"],
        "treatments": ["Treat the cause (URS, PCN, DJ stent, pyeloplasty)", "Percutaneous nephrostomy if sepsis / AKI"],
        "when_to_see": "Any newly diagnosed hydronephrosis on scan needs urology review within 2 weeks.",
    },
    {
        "id": "puj-obstruction",
        "name": "PUJ Obstruction",
        "icon": "pipe-disconnected",
        "tagline": "Congenital narrowing where kidney joins the ureter.",
        "overview": "Pelvi-ureteric junction obstruction is usually a congenital narrowing or aberrant vessel causing intermittent flank pain and hydronephrosis.",
        "symptoms": ["Intermittent flank pain (Dietl's crisis)", "Pain after drinking fluids or alcohol", "Recurrent UTI", "Haematuria"],
        "causes": ["Intrinsic narrowing", "Crossing vessel", "Ureteric polyps (rare)"],
        "treatments": ["Observation if function preserved", "Laparoscopic pyeloplasty (gold standard)", "Endopyelotomy for select cases"],
        "when_to_see": "Recurrent flank pain with hydronephrosis \u2014 ask for a renogram (DTPA / MAG3).",
    },
    {
        "id": "urethral-stricture",
        "name": "Urethral Stricture",
        "icon": "pipe",
        "tagline": "Narrow urethra causing weak stream and straining.",
        "overview": "Urethral stricture is scarring that narrows the urethra, most common in men after trauma, infection or catheterisation.",
        "symptoms": ["Weak or splitting urinary stream", "Straining, hesitancy, incomplete emptying", "Recurrent UTIs", "Blood in urine or semen"],
        "causes": ["Trauma (straddle injury, catheterisation)", "Infection (STI, prostatitis)", "Previous urethral surgery", "Lichen sclerosus"],
        "treatments": ["Dilatation or optical internal urethrotomy (short strictures)", "Urethroplasty (buccal mucosa graft)"],
        "when_to_see": "If uroflow is <10 ml/s or the stream splits and sprays \u2014 get a urethral evaluation.",
    },
    {
        "id": "neurogenic-bladder",
        "name": "Neurogenic Bladder",
        "icon": "brain",
        "tagline": "Bladder issues from nerve injury or disease.",
        "overview": "The bladder and its outlet rely on an intact nervous system. Spinal cord injury, MS, Parkinson\u2019s or spina bifida can cause a neurogenic bladder.",
        "symptoms": ["Inability to fully empty the bladder", "Urinary retention / overflow", "Sudden urge incontinence", "Recurrent UTIs, stones"],
        "causes": ["Spinal cord injury / tumour", "Multiple sclerosis, Parkinson's", "Diabetic neuropathy", "Spina bifida"],
        "treatments": ["Clean intermittent self-catheterisation (CISC)", "Anti-muscarinics / beta-3 agonists", "Botox detrusor injection", "Augmentation cystoplasty, sacral neuromodulation"],
        "when_to_see": "Any neurological disease with new bladder symptoms \u2014 see a urologist within a month.",
    },
    {
        "id": "nocturnal-enuresis",
        "name": "Bedwetting (Enuresis)",
        "icon": "weather-night",
        "tagline": "Night-time wetting in children and adults \u2014 treatable.",
        "overview": "Nocturnal enuresis is involuntary urination during sleep, common until age 6. Persisting beyond 7 years deserves evaluation.",
        "symptoms": ["Wetting during sleep, multiple nights per week", "Large-volume wetting", "Family history common"],
        "causes": ["Reduced nocturnal ADH", "Small bladder capacity", "Deep sleep pattern", "UTI, constipation, OSA"],
        "treatments": ["Bedtime fluid control, bladder training", "Enuresis alarm", "Desmopressin tablets", "Treat constipation / OSA"],
        "when_to_see": "Daily bedwetting beyond age 7, or any adult new-onset bedwetting.",
    },
    {
        "id": "stress-incontinence",
        "name": "Stress Incontinence",
        "icon": "run",
        "tagline": "Leak on cough / sneeze \u2014 common after childbirth.",
        "overview": "Stress urinary incontinence is leakage of urine during physical activity \u2014 coughing, sneezing, laughing, running \u2014 due to weak pelvic-floor support.",
        "symptoms": ["Leak on coughing/sneezing/laughing", "Leak on exercise or lifting", "No urgency sensation"],
        "causes": ["Childbirth / multiparity", "Menopause", "Obesity", "Chronic cough / constipation"],
        "treatments": ["Supervised pelvic-floor physiotherapy", "Weight loss, stop smoking", "Mid-urethral sling (TVT/TOT)", "Urethral bulking agents"],
        "when_to_see": "If leakage affects exercise, intimacy or daily activities.",
    },
    {
        "id": "interstitial-cystitis",
        "name": "Interstitial Cystitis / BPS",
        "icon": "emoticon-sad",
        "tagline": "Chronic bladder pain with urgency \u2014 no infection.",
        "overview": "IC/Bladder Pain Syndrome is a chronic condition of bladder pain, pressure and urinary frequency without infection, affecting quality of life.",
        "symptoms": ["Pelvic / suprapubic pain, worse as bladder fills", "Urgency and frequency (>10 times/day)", "Pain with intercourse", "Flares after coffee, citrus, stress"],
        "causes": ["Damaged GAG layer of bladder", "Auto-immune or neurogenic factors"],
        "treatments": ["Diet modification (avoid triggers)", "Amitriptyline, pentosan polysulfate", "Intravesical DMSO / heparin instillations", "Hydrodistension, Botox, sacral neuromodulation"],
        "when_to_see": "Persistent bladder pain >6 weeks with negative urine cultures.",
    },
    {
        "id": "peyronies",
        "name": "Peyronie's Disease",
        "icon": "alpha-c",
        "tagline": "Penile curvature due to scar plaque.",
        "overview": "Peyronie's is the development of fibrous scar (plaque) in the penis, causing curvature, pain and sometimes erectile dysfunction.",
        "symptoms": ["Painful erections (early phase)", "New penile curvature", "Palpable plaque", "Difficulty with penetration"],
        "causes": ["Micro-trauma during intercourse", "Genetic factors", "Diabetes / smoking"],
        "treatments": ["Observation in early phase", "Oral pentoxifylline, tadalafil", "Collagenase (Xiaflex) injections", "Penile traction devices", "Penile plication / grafting surgery"],
        "when_to_see": "Any new curvature, painful erections or palpable penile lump.",
    },
    {
        "id": "priapism",
        "name": "Priapism",
        "icon": "alarm-light",
        "tagline": "Prolonged erection \u2014 urological emergency!",
        "overview": "Priapism is a painful erection lasting over 4 hours, unrelated to sexual stimulation. Low-flow (ischaemic) priapism needs emergency decompression to prevent permanent ED.",
        "symptoms": ["Erection lasting > 4 hours", "Penile pain (ischaemic type)", "Rigid shaft with soft glans"],
        "causes": ["Sickle cell disease", "Intra-cavernosal injections", "Medications (trazodone, cocaine)", "Trauma, leukaemia"],
        "treatments": ["Aspiration + phenylephrine injection (first-line)", "Surgical shunt (T-shunt, Al-Ghorab)", "Penile prosthesis in refractory cases"],
        "when_to_see": "Any erection lasting over 4 hours \u2014 go to a 24-hour emergency immediately.",
    },
    {
        "id": "prostatitis",
        "name": "Prostatitis",
        "icon": "thermometer-high",
        "tagline": "Prostate inflammation \u2014 acute or chronic.",
        "overview": "Prostatitis is inflammation of the prostate gland. It can be acute bacterial, chronic bacterial, or chronic pelvic pain syndrome.",
        "symptoms": ["Pelvic / perineal pain, lower back pain", "Pain on urination / ejaculation", "Fever, chills (acute bacterial)", "Urinary frequency / urgency"],
        "causes": ["E. coli and other bacteria (acute/chronic)", "Unknown cause (CPPS)", "Pelvic floor dysfunction"],
        "treatments": ["4-week course of fluoroquinolones (bacterial)", "Alpha-blockers to relax prostate", "Pelvic-floor physiotherapy (CPPS)", "Warm sitz baths, avoid bike saddle"],
        "when_to_see": "Fever with severe perineal pain and difficulty urinating \u2014 same-day consultation.",
    },
    {
        "id": "pmph",
        "name": "Premature Ejaculation",
        "icon": "timer-sand",
        "tagline": "The commonest male sexual dysfunction \u2014 very treatable.",
        "overview": "PE is uncontrolled ejaculation within 1 minute of penetration, causing distress. Affects 20\u201330% of men at some point.",
        "symptoms": ["Ejaculation before or shortly after penetration", "Unable to delay ejaculation on all/nearly all occasions", "Distress or avoidance of intimacy"],
        "causes": ["Psychological (anxiety, early experiences)", "Hypersensitive glans", "Hormonal (low prolactin, thyroid)", "Prostatitis / ED"],
        "treatments": ["Behavioural therapy (squeeze / stop-start technique)", "Topical lidocaine / prilocaine sprays", "Dapoxetine / daily SSRIs", "Tadalafil combination"],
        "when_to_see": "If PE affects relationships or self-esteem \u2014 a single consult can help.",
    },
    {
        "id": "neobladder",
        "name": "Neobladder & Urinary Diversion",
        "icon": "water-pump",
        "tagline": "Life after bladder removal \u2014 options and rehabilitation.",
        "overview": "After radical cystectomy for bladder cancer, urine can be diverted through an ileal conduit, continent reservoir or orthotopic neobladder built from intestine.",
        "symptoms": ["N/A \u2014 post-surgical living guide"],
        "causes": ["Muscle-invasive bladder cancer", "Neurogenic bladder with poor function", "Radiation damage"],
        "treatments": ["Ileal conduit with stoma", "Indiana pouch (continent)", "Orthotopic neobladder (Studer, T-pouch)"],
        "when_to_see": "Discuss diversion options with your urologist before bladder cancer surgery.",
    },
    {
        "id": "female-urology",
        "name": "Female Urology",
        "icon": "gender-female",
        "tagline": "UTI, incontinence, prolapse \u2014 sensitive comprehensive care.",
        "overview": "Female urology covers UTIs, stress / urge incontinence, pelvic-organ prolapse, bladder pain and urethral diverticula \u2014 often under-discussed but very treatable.",
        "symptoms": ["Recurrent UTI (3+ episodes/year)", "Leakage on cough / sneeze / exercise", "Pelvic heaviness or bulge", "Painful intercourse", "Urgency / frequency"],
        "causes": ["Pregnancy & delivery trauma", "Menopausal hormonal changes", "Pelvic-floor weakness", "Chronic constipation, obesity"],
        "treatments": ["Personalised antibiotics / vaginal oestrogen", "Pelvic-floor physiotherapy", "Mid-urethral sling, sacrocolpopexy", "Botox for OAB, urethral bulking"],
        "when_to_see": "Any urinary symptom bothering you for more than 2 weeks \u2014 female urology is a confidential consultation.",
    },
    {
        "id": "paediatric-urology",
        "name": "Paediatric Urology",
        "icon": "baby-carriage",
        "tagline": "Children's urology \u2014 from antenatal to teenage.",
        "overview": "Paediatric urology covers antenatal hydronephrosis, VUR, posterior urethral valves, hypospadias, undescended testis, enuresis and stones in children.",
        "symptoms": ["Antenatal hydronephrosis on scan", "Recurrent UTI in a child", "Abnormal stream / dribbling urine", "Bedwetting > age 7", "Undescended testis"],
        "causes": ["Congenital anomalies (PUJO, VUR, PUV)", "Vesico-ureteric reflux", "Congenital phimosis"],
        "treatments": ["Prophylactic antibiotics, DMSA / VCUG imaging", "Endoscopic STING / ureteric re-implantation", "Hypospadias repair (TIP urethroplasty)", "Orchidopexy for undescended testis"],
        "when_to_see": "Any antenatal hydronephrosis should be rechecked in the baby by 6 weeks of age.",
    },
    {
        "id": "vur",
        "name": "Vesico-Ureteric Reflux (VUR)",
        "icon": "arrow-u-down-left",
        "tagline": "Urine flowing back to the kidneys in children \u2014 preventable kidney damage.",
        "overview": "VUR is backward flow of urine from the bladder up the ureter to the kidney. It predisposes children to kidney infection and scarring.",
        "symptoms": ["Recurrent febrile UTI in a child", "Hydronephrosis on antenatal or post-natal scan", "Failure to thrive"],
        "causes": ["Short intravesical ureter (primary VUR)", "Posterior urethral valves", "Neurogenic bladder"],
        "treatments": ["Low-dose antibiotic prophylaxis", "Endoscopic Deflux injection", "Ureteric re-implantation (Cohen / Lich-Gr\u00e9goir)"],
        "when_to_see": "Any child with >1 febrile UTI deserves an ultrasound and VCUG.",
    },
    {
        "id": "hypospadias",
        "name": "Hypospadias",
        "icon": "baby-face-outline",
        "tagline": "Urinary opening on the under-side of the penis \u2014 surgery fixes it.",
        "overview": "Hypospadias is a birth defect where the urethral opening is on the under-side of the penis. Severity ranges from distal (near glans) to proximal (scrotum).",
        "symptoms": ["Abnormal urinary opening", "Downward-curved penis (chordee)", "Hooded foreskin", "Splitting of stream"],
        "causes": ["Developmental \u2014 hormonal / genetic factors"],
        "treatments": ["Surgery between 6 and 18 months of age", "TIP (Snodgrass) urethroplasty", "Staged repair for severe proximal hypospadias"],
        "when_to_see": "Diagnosis at birth \u2014 consult a paediatric urologist early.",
    },
    {
        "id": "paraphimosis",
        "name": "Paraphimosis",
        "icon": "alert-octagon-outline",
        "tagline": "Stuck retracted foreskin \u2014 emergency!",
        "overview": "Paraphimosis is a condition where the foreskin is retracted behind the glans and cannot be replaced, causing swelling and pain.",
        "symptoms": ["Swollen painful glans with tight ring of foreskin", "Blue/purple discoloration", "Inability to pull foreskin forward"],
        "causes": ["Forgotten after catheterisation", "Forceful retraction during intercourse", "Phimotic ring"],
        "treatments": ["Manual reduction with ice / sugar / compression", "Dorsal slit under local anaesthetic", "Emergency circumcision"],
        "when_to_see": "Go to the nearest emergency room immediately \u2014 delay risks tissue loss.",
    },
    {
        "id": "overactive-kidney-cyst",
        "name": "Simple Kidney Cyst",
        "icon": "water-circle",
        "tagline": "Very common, usually harmless.",
        "overview": "Simple kidney cysts are fluid-filled sacs, present in up to 50% of people over 50. They rarely cause symptoms or complications.",
        "symptoms": ["Usually found incidentally", "Flank pain if large or complicated", "Haematuria (rare)"],
        "causes": ["Age-related", "Acquired cystic disease in CKD / dialysis"],
        "treatments": ["Observation if Bosniak I/II", "Percutaneous aspiration + sclerotherapy (symptomatic)", "Laparoscopic deroofing (rare)"],
        "when_to_see": "Only if the cyst has complex walls / solid component (Bosniak III / IV) \u2014 your radiologist will flag it.",
    },
    {
        "id": "androgen-deficiency",
        "name": "Testosterone Deficiency (Hypogonadism)",
        "icon": "gauge-low",
        "tagline": "Low T \u2014 treatable cause of fatigue, low libido & mood issues.",
        "overview": "Hypogonadism is a clinical syndrome of low serum testosterone with symptoms. Prevalence rises with age, obesity and diabetes.",
        "symptoms": ["Low libido, erectile dysfunction", "Fatigue, low mood", "Loss of muscle mass, weight gain", "Reduced body hair, hot flushes"],
        "causes": ["Ageing, obesity, diabetes", "Pituitary tumours", "Klinefelter syndrome", "Post-mumps orchitis / chemotherapy"],
        "treatments": ["Testosterone gels / injections / pellets", "Weight loss, strength training, sleep", "Clomiphene if fertility needed", "Monitor PSA and haematocrit"],
        "when_to_see": "If your morning testosterone is <300 ng/dL on two tests with symptoms \u2014 book a consultation.",
    },
    {
        "id": "hematospermia",
        "name": "Blood in Semen (Haematospermia)",
        "icon": "water-alert-outline",
        "tagline": "Common and usually benign \u2014 but deserves a check.",
        "overview": "Haematospermia is blood in the ejaculate. In men under 40 it is usually benign and self-limiting; in older men, rule out prostate pathology.",
        "symptoms": ["Red / brown semen", "Pelvic discomfort (occasional)"],
        "causes": ["Prostatitis, seminal vesiculitis", "After prostate biopsy / vasectomy", "BPH, prostate cancer", "Hypertension, clotting disorders"],
        "treatments": ["Observation for single episode in <40y", "Transrectal ultrasound / MRI in older men", "Treat infection or identified cause"],
        "when_to_see": "Recurrent episodes, age >40, or pain \u2014 book a consultation.",
    },
]


from disease_content import (
    list_localized as _dis_list_localized,
    get_localized as _dis_get_localized,
)


@app.get("/api/diseases")
async def list_diseases(lang: str = "en"):
    if lang not in ("en", "hi", "gu"):
        lang = "en"
    items = _dis_list_localized(lang)
    return [
        {
            "id": d["id"],
            "name": d["name"],
            "icon": d["icon"],
            "tagline": d["tagline"],
            "image_url": disease_image(d["id"]),
        }
        for d in items
    ]


@app.get("/api/diseases/{disease_id}")
async def get_disease(disease_id: str, lang: str = "en"):
    if lang not in ("en", "hi", "gu"):
        lang = "en"
    item = _dis_get_localized(disease_id, lang)
    if not item:
        raise HTTPException(status_code=404, detail="Disease not found")
    return {**item, "image_url": disease_image(disease_id)}


# ============================================================
# BOOKINGS
# ============================================================


async def require_approver(user=Depends(require_user)) -> Dict[str, Any]:
    role = user.get("role")
    if role in ["owner", "doctor"]:
        return user
    if role in STAFF_ROLES and user.get("can_approve_bookings"):
        return user
    raise HTTPException(status_code=403, detail="Not allowed to approve bookings")


@app.post("/api/bookings")
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
    doc = {
        "booking_id": booking_id,
        "user_id": user["user_id"] if user else None,
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
    # (owner + team members with can_approve_bookings) so the bell lights
    # up and they can action it from the notifications screen.
    approvers_cursor = db.users.find(
        {"$or": [{"role": "owner"}, {"can_approve_bookings": True}]},
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


@app.get("/api/bookings/me")
async def my_bookings(user=Depends(require_user)):
    # Merge by user_id OR by phone number so guests who later sign in see their history.
    email_phones = await db.users.find({"user_id": user["user_id"]}, {"_id": 0, "phone": 1}).to_list(length=1)
    phone = (email_phones[0].get("phone") if email_phones else None) or None
    q = {"$or": [{"user_id": user["user_id"]}]}
    if phone:
        q["$or"].append({"patient_phone": phone})
    cursor = db.bookings.find(q, {"_id": 0}).sort("created_at", -1)
    return await cursor.to_list(length=200)


@app.get("/api/bookings/all")
async def all_bookings(user=Depends(require_staff)):
    cursor = db.bookings.find({}, {"_id": 0}).sort("created_at", -1)
    return await cursor.to_list(length=500)


# ---- Guest (anonymous) bookings lookup by phone ---------------------------
# Declared BEFORE /api/bookings/{booking_id} so that the literal path
# segment "guest" is matched before the path parameter catches it.
@app.get("/api/bookings/guest")
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


# Declared BEFORE /api/bookings/{booking_id} for the same reason as /guest.
@app.get("/api/bookings/check-duplicate")
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


@app.get("/api/bookings/{booking_id}")
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


@app.get("/api/export/bookings.csv")
async def export_bookings_csv(user=Depends(require_owner)):
    # Projection: only fields needed for the CSV to keep the payload small on large exports
    cursor = db.bookings.find(
        {},
        {
            "_id": 0,
            "booking_id": 1,
            "patient_name": 1,
            "patient_phone": 1,
            "patient_age": 1,
            "patient_gender": 1,
            "booking_date": 1,
            "booking_time": 1,
            "mode": 1,
            "status": 1,
            "reason": 1,
            "registration_no": 1,
            "created_at": 1,
        },
    ).sort("created_at", -1)
    docs = await cursor.to_list(length=10000)
    rows: List[List[Any]] = [[
        "booking_id", "patient_name", "patient_phone", "patient_age",
        "patient_gender", "booking_date", "booking_time", "mode",
        "status", "reason", "registration_no", "created_at",
    ]]
    for d in docs:
        rows.append([
            d.get("booking_id"),
            d.get("patient_name"),
            d.get("patient_phone"),
            d.get("patient_age"),
            d.get("patient_gender"),
            d.get("booking_date"),
            d.get("booking_time"),
            d.get("mode"),
            d.get("status"),
            (d.get("reason") or "").replace("\n", " ").replace("\r", " "),
            d.get("registration_no"),
            _fmt_dt(d.get("created_at")),
        ])
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return _csv_response(rows, f"bookings-{today}.csv")


@app.get("/api/export/prescriptions.csv")
async def export_prescriptions_csv(user=Depends(require_owner)):
    cursor = db.prescriptions.find({}, {"_id": 0}).sort("created_at", -1)
    docs = await cursor.to_list(length=10000)
    rows: List[List[Any]] = [[
        "prescription_id", "patient_name", "patient_phone", "patient_age",
        "patient_gender", "registration_no", "visit_date", "diagnosis",
        "medicines_count", "ref_doctor", "created_at", "updated_at",
    ]]
    for d in docs:
        meds = d.get("medicines") or []
        rows.append([
            d.get("prescription_id"),
            d.get("patient_name"),
            d.get("patient_phone"),
            d.get("patient_age"),
            d.get("patient_gender"),
            d.get("registration_no"),
            d.get("visit_date"),
            (d.get("diagnosis") or "").replace("\n", " ").replace("\r", " "),
            len(meds),
            d.get("ref_doctor"),
            _fmt_dt(d.get("created_at")),
            _fmt_dt(d.get("updated_at")),
        ])
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return _csv_response(rows, f"prescriptions-{today}.csv")


@app.get("/api/export/referrers.csv")
async def export_referrers_csv(user=Depends(require_owner)):
    cursor = db.referrers.find({}, {"_id": 0}).sort("created_at", -1)
    docs = await cursor.to_list(length=10000)
    rows: List[List[Any]] = [[
        "referrer_id", "name", "phone", "email", "specialty",
        "hospital", "city", "referrals_count", "notes", "created_at",
    ]]
    for d in docs:
        rows.append([
            d.get("referrer_id") or d.get("id"),
            d.get("name"),
            d.get("phone"),
            d.get("email"),
            d.get("specialty"),
            d.get("hospital"),
            d.get("city"),
            d.get("referrals_count", 0),
            (d.get("notes") or "").replace("\n", " ").replace("\r", " "),
            _fmt_dt(d.get("created_at")),
        ])
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return _csv_response(rows, f"referrers-{today}.csv")


@app.patch("/api/bookings/{booking_id}")
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
        if body.status not in ["confirmed", "completed", "cancelled", "rejected"]:
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


# ---- Patient-initiated cancellation ---------------------------------------
@app.post("/api/bookings/{booking_id}/cancel")
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
        {"$or": [{"role": "owner"}, {"can_approve_bookings": True}]},
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


def _urlencode(s: str) -> str:
    from urllib.parse import quote
    return quote(s, safe="")


# ============================================================
# IPSS
# ============================================================


@app.post("/api/ipss")
async def save_ipss(payload: IpssSubmission, user=Depends(require_user)):
    record_id = f"ipss_{uuid.uuid4().hex[:10]}"
    doc = {
        "record_id": record_id,
        "user_id": user["user_id"],
        "entries": [e.model_dump() for e in payload.entries],
        "total_score": payload.total_score,
        "severity": payload.severity,
        "qol_score": payload.qol_score,
        "created_at": datetime.now(timezone.utc),
    }
    await db.ipss_records.insert_one(doc)
    doc.pop("_id", None)
    return doc


@app.get("/api/ipss/history")
async def ipss_history(user=Depends(require_user)):
    cursor = db.ipss_records.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1)
    return await cursor.to_list(length=100)


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
class RenderPdfBody(BaseModel):
    html: str
    filename: Optional[str] = None


@app.post("/api/render/pdf")
async def render_pdf(body: RenderPdfBody, user=Depends(require_user)):
    if not body.html or len(body.html) < 50:
        raise HTTPException(status_code=400, detail="HTML payload missing or too short")
    try:
        # Lazy import so the app can boot even if the wheel isn't installed
        # in dev — the route just 503s instead of crashing the server.
        from weasyprint import HTML  # type: ignore
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"PDF engine unavailable: {e}")

    # Run the (synchronous, CPU-bound) render in a worker thread so we
    # don't block the asyncio event loop. WeasyPrint itself is CPU-heavy
    # (~1-3 s for a typical Rx); offloading frees the loop to serve
    # other requests in parallel.
    import asyncio
    def _do_render() -> bytes:
        return HTML(string=body.html, base_url="https://www.drsagarjoshi.com/").write_pdf()
    try:
        pdf_bytes = await asyncio.to_thread(_do_render)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF render failed: {e}")

    fname = (body.filename or "prescription.pdf").strip().replace('"', '')
    if not fname.lower().endswith(".pdf"):
        fname += ".pdf"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{fname}"',
            "Cache-Control": "no-store",
        },
    )


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


@app.post("/api/prescriptions")
async def create_prescription(payload: PrescriptionCreate, user=Depends(require_staff)):
    # Staff (reception/nursing/assistant) can only create DRAFT consultations
    # — they pre-fill patient details / vitals / complaints / IPSS so the
    # doctor can resume and finalise quickly. Only prescribers (owner /
    # doctor) can save a `final` Rx.
    is_rx = await is_prescriber(user)
    status = (payload.status or "final").lower().strip()
    if status not in ("draft", "final"):
        status = "final"
    if not is_rx:
        status = "draft"
    prescription_id = f"rx_{uuid.uuid4().hex[:10]}"
    # Auto-link to patient account via matching phone number so it appears in their My Records.
    patient_user_id = None
    if payload.patient_phone:
        digits = re.sub(r"\D", "", payload.patient_phone)
        if digits:
            match = await db.users.find_one({"phone_digits": digits}, {"_id": 0, "user_id": 1})
            if match:
                patient_user_id = match["user_id"]
    reg_no = await get_or_set_reg_no(payload.patient_phone, payload.registration_no, payload.patient_name)
    payload_data = payload.model_dump()
    payload_data["registration_no"] = reg_no
    payload_data["status"] = status
    doc = {
        "prescription_id": prescription_id,
        "doctor_user_id": user["user_id"] if is_rx else None,
        "patient_user_id": patient_user_id,
        "created_by_user_id": user["user_id"],
        "created_by_name": user.get("name") or (user.get("email", "") or "").split("@")[0],
        "created_by_role": user.get("role"),
        **payload_data,
        "created_at": datetime.now(timezone.utc),
    }
    await db.prescriptions.insert_one(doc)
    doc.pop("_id", None)
    # When this Rx was created from a confirmed booking via the "Start
    # Consultation" flow, close the loop only when finalised. Drafts keep
    # the booking as `confirmed` so it stays in the upcoming consultations
    # list and the doctor can still resume.
    src_booking = (payload.source_booking_id or "").strip()
    if src_booking:
        try:
            if status == "final":
                await db.bookings.update_one(
                    {"booking_id": src_booking},
                    {
                        "$set": {
                            "status": "completed",
                            "consultation_rx_id": prescription_id,
                            "consultation_completed_at": datetime.now(timezone.utc),
                        }
                    },
                )
            else:
                # Mark which Rx is the active draft so the consults tab
                # can show "Resume draft" instead of "Start" — booking
                # status itself stays `confirmed`.
                await db.bookings.update_one(
                    {"booking_id": src_booking},
                    {
                        "$set": {
                            "draft_rx_id": prescription_id,
                            "draft_started_at": datetime.now(timezone.utc),
                            "draft_started_by": user.get("name")
                            or (user.get("email", "") or "").split("@")[0],
                        }
                    },
                )
        except Exception:
            pass
    return doc


@app.delete("/api/prescriptions/{prescription_id}")
async def delete_prescription(prescription_id: str, user=Depends(require_user)):
    """Only the owner can delete a prescription record."""
    if user.get("role") != "owner":
        raise HTTPException(status_code=403, detail="Only the owner can delete prescription records")
    result = await db.prescriptions.delete_one({"prescription_id": prescription_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


@app.put("/api/prescriptions/{prescription_id}")
async def update_prescription(prescription_id: str, payload: PrescriptionCreate, user=Depends(require_staff)):
    """Edit an existing prescription. Staff can edit DRAFTS; only prescribers
    (owner + doctor) can edit a `final` Rx or upgrade a draft → final."""
    existing = await db.prescriptions.find_one({"prescription_id": prescription_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Not found")
    is_rx = await is_prescriber(user)
    cur_status = (existing.get("status") or "final").lower()
    new_status = (payload.status or cur_status).lower().strip()
    if new_status not in ("draft", "final"):
        new_status = cur_status
    if not is_rx:
        # Non-prescribers may only edit a draft and must keep it as draft.
        if cur_status != "draft":
            raise HTTPException(status_code=403, detail="Only doctor can edit a finalised prescription")
        new_status = "draft"
    # Re-link patient user by phone (may have changed)
    patient_user_id = existing.get("patient_user_id")
    if payload.patient_phone:
        digits = re.sub(r"\D", "", payload.patient_phone)
        if digits:
            match = await db.users.find_one({"phone_digits": digits}, {"_id": 0, "user_id": 1})
            if match:
                patient_user_id = match["user_id"]
    reg_no = await get_or_set_reg_no(payload.patient_phone, payload.registration_no, payload.patient_name)
    payload_data = payload.model_dump()
    payload_data["registration_no"] = reg_no
    payload_data["patient_user_id"] = patient_user_id
    payload_data["status"] = new_status
    payload_data["updated_at"] = datetime.now(timezone.utc)
    payload_data["updated_by"] = user["user_id"]
    if is_rx and cur_status == "draft" and new_status == "final":
        payload_data["doctor_user_id"] = user["user_id"]
        payload_data["finalised_at"] = datetime.now(timezone.utc)
    await db.prescriptions.update_one(
        {"prescription_id": prescription_id},
        {"$set": payload_data},
    )
    updated = await db.prescriptions.find_one({"prescription_id": prescription_id}, {"_id": 0})
    # Mirror booking status: if a draft was just finalised, complete the
    # source booking and clear its `draft_rx_id` pointer.
    src_booking = (existing.get("source_booking_id") or payload.source_booking_id or "").strip()
    if src_booking and is_rx and new_status == "final":
        try:
            await db.bookings.update_one(
                {"booking_id": src_booking},
                {
                    "$set": {
                        "status": "completed",
                        "consultation_rx_id": prescription_id,
                        "consultation_completed_at": datetime.now(timezone.utc),
                    },
                    "$unset": {"draft_rx_id": "", "draft_started_at": "", "draft_started_by": ""},
                },
            )
        except Exception:
            pass
    return updated


@app.get("/api/prescriptions/me")
async def my_prescriptions(user=Depends(require_user)):
    # A patient may have multiple phone numbers across bookings; surface all rxs by user_id OR phone match.
    q = {"$or": [{"patient_user_id": user["user_id"]}]}
    digits = user.get("phone_digits") or None
    if digits:
        q["$or"].append({"patient_phone": {"$regex": digits[-10:]}})
    cursor = db.prescriptions.find(q, {"_id": 0}).sort("created_at", -1)
    return await cursor.to_list(length=200)


@app.get("/api/prescriptions")
async def list_prescriptions(user=Depends(require_staff)):
    cursor = db.prescriptions.find({}, {"_id": 0}).sort("created_at", -1)
    return await cursor.to_list(length=500)


@app.get("/api/prescriptions/{prescription_id}")
async def get_prescription(prescription_id: str, user=Depends(require_user)):
    """Return a prescription. Prescribers (owner/doctor/staff) can read any
    prescription; regular patients can read ONLY prescriptions issued to them
    (matched by user_id or by registration number tied to their profile)."""
    doc = await db.prescriptions.find_one({"prescription_id": prescription_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    role = user.get("role") or "patient"
    if role not in STAFF_ROLES and role not in {"prescriber", "doctor"}:
        uid = user.get("user_id")
        reg_no = (user.get("registration_no") or "").strip()
        # Patient can view ONLY their own Rx — check by linked user_id or by
        # patient registration number (the number printed on the Rx that
        # uniquely identifies this patient across visits).
        rx_uid = doc.get("user_id") or doc.get("patient_user_id")
        rx_reg = (doc.get("registration_no") or "").strip()
        owns = (uid and rx_uid and uid == rx_uid) or (
            reg_no and rx_reg and reg_no == rx_reg
        )
        if not owns:
            raise HTTPException(status_code=404, detail="Not found")
    return doc


@app.get("/api/rx/verify/{prescription_id}")
async def verify_prescription(prescription_id: str):
    """Public verification page for a prescription QR code.
    Only exposes issue metadata (no clinical details) to protect patient privacy."""
    doc = await db.prescriptions.find_one({"prescription_id": prescription_id}, {"_id": 0})
    if not doc:
        return HTMLResponse(
            status_code=404,
            content=_verify_page_html(
                ok=False,
                rx_id=prescription_id,
                issued_at=None,
                patient_initials=None,
                med_count=0,
            ),
        )
    # Patient privacy: only expose initials like "R.S." and the issue date.
    name = (doc.get("patient_name") or "").strip()
    initials = ".".join([p[0].upper() for p in name.split() if p])[:6] or "—"
    created = doc.get("created_at")
    if isinstance(created, datetime):
        issued_at = created.strftime("%d-%m-%Y %H:%M UTC")
    else:
        issued_at = str(created) if created else "—"
    med_count = len(doc.get("medicines") or [])
    return HTMLResponse(
        content=_verify_page_html(
            ok=True,
            rx_id=prescription_id,
            issued_at=issued_at,
            patient_initials=initials,
            med_count=med_count,
        ),
    )


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


@app.get("/api/admin/backup/status")
async def admin_backup_status(user=Depends(require_owner)):
    """Owner-only: surface the latest mongodump + off-host mirror status.

    Reads /app/backups/.mirror_status.json (written by mirror_backups.sh)
    and decorates it with details of the most recent local archive so the
    dashboard can show "last backup at X, mirrored to Y".
    """
    import os
    import json
    from pathlib import Path

    backup_dir = Path("/app/backups")
    archives = []
    try:
        for p in sorted(backup_dir.glob("consulturo-*.tar.gz"), reverse=True)[:5]:
            try:
                st = p.stat()
                archives.append({
                    "name": p.name,
                    "size_bytes": st.st_size,
                    "size_human": _human_bytes(st.st_size),
                    "modified": datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat(),
                })
            except Exception:
                continue
    except Exception:
        pass

    mirror = None
    status_path = backup_dir / ".mirror_status.json"
    if status_path.exists():
        try:
            mirror = json.loads(status_path.read_text())
        except Exception:
            mirror = {"error": "could not parse mirror_status.json"}

    # Inspect env (read directly from /app/backend/.env so we don't mistakenly
    # surface a missing variable when supervisor has loaded it from a different
    # source — keeps the response truthful).
    mode = os.environ.get("BACKUP_MIRROR_MODE", "").strip().lower() or "none"
    return {
        "mode": mode,
        "configured": mode not in ("", "none"),
        "local": {
            "dir": str(backup_dir),
            "count": len(archives),
            "recent": archives,
        },
        "mirror": mirror,
        "now": datetime.now(timezone.utc).isoformat(),
    }


def _human_bytes(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024.0:
            return f"{n:.1f} {unit}"
        n /= 1024.0
    return f"{n:.1f} TB"


@app.post("/api/team/invites")
async def create_invite(body: TeamInviteBody, user=Depends(require_owner)):
    # Allow core role OR a registered custom role_label slug.
    if body.role not in VALID_ROLES:
        custom = await db.role_labels.find_one({"slug": body.role}, {"_id": 0})
        if not custom:
            raise HTTPException(status_code=400, detail="Invalid role")
    email_l = body.email.lower()
    # Look up the *previous* role (if any) so we only notify on a real change.
    existing_invite = await db.team_invites.find_one({"email": email_l}, {"_id": 0})
    existing_user = await db.users.find_one({"email": email_l}, {"_id": 0})
    prev_role = (existing_user or {}).get("role") or (existing_invite or {}).get("role")
    # Derive permission defaults by effective category.
    eff = await get_effective_role(body.role)
    doctor_like = eff["category"] == "doctor"
    can_approve_book = body.can_approve_bookings or doctor_like
    can_approve_bc = body.can_approve_broadcasts or doctor_like
    invite_doc = {
        "email": email_l,
        "name": body.name,
        "role": body.role,
        "can_approve_bookings": can_approve_book,
        "can_approve_broadcasts": can_approve_bc,
        "invited_by": user["user_id"],
        "created_at": datetime.now(timezone.utc),
    }
    await db.team_invites.update_one({"email": email_l}, {"$set": invite_doc}, upsert=True)
    await db.users.update_one(
        {"email": email_l},
        {
            "$set": {
                "role": body.role,
                "can_approve_bookings": can_approve_book,
                "can_approve_broadcasts": can_approve_bc,
            }
        },
    )
    # Notify the team member about the new role assignment (first time or change).
    if existing_user and prev_role != body.role:
        await notify_role_change(existing_user.get("user_id"), email_l, prev_role, body.role)
    return {
        "ok": True,
        "email": email_l,
        "role": body.role,
        "can_approve_bookings": can_approve_book,
        "can_approve_broadcasts": can_approve_bc,
    }


@app.patch("/api/team/{email}")
async def update_team_member(email: str, body: TeamUpdateBody, user=Depends(require_owner)):
    email_l = email.lower()
    if email_l == OWNER_EMAIL:
        raise HTTPException(status_code=400, detail="Owner role cannot be modified")
    updates: Dict[str, Any] = {}
    if body.role is not None:
        if body.role not in VALID_ROLES:
            custom = await db.role_labels.find_one({"slug": body.role}, {"_id": 0})
            if not custom:
                raise HTTPException(status_code=400, detail="Invalid role")
        if body.role == "owner":
            raise HTTPException(status_code=400, detail="Owner cannot be assigned via team panel")
        updates["role"] = body.role
    if body.can_approve_bookings is not None:
        updates["can_approve_bookings"] = bool(body.can_approve_bookings)
    if body.can_approve_broadcasts is not None:
        updates["can_approve_broadcasts"] = bool(body.can_approve_broadcasts)
    if body.can_send_personal_messages is not None:
        updates["can_send_personal_messages"] = bool(body.can_send_personal_messages)
    if body.dashboard_full_access is not None:
        # Only the owner can grant Full Dashboard Access. Cascading is
        # disabled by design (require_owner above already enforces this).
        updates["dashboard_full_access"] = bool(body.dashboard_full_access)
    if body.dashboard_tabs is not None:
        # Whitelist known dashboard tab ids so a malformed PATCH can't
        # accidentally grant access to an unknown future surface.
        ALLOWED_TABS = {
            "bookings", "consultations", "rx", "availability",
            "team", "push", "homepage", "backups",
        }
        clean = [t for t in body.dashboard_tabs if isinstance(t, str) and t in ALLOWED_TABS]
        updates["dashboard_tabs"] = clean
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    existing_invite = await db.team_invites.find_one({"email": email_l}, {"_id": 0})
    existing_user = await db.users.find_one({"email": email_l}, {"_id": 0})
    if not existing_invite and not existing_user:
        raise HTTPException(status_code=404, detail="Team member not found")
    prev_role = (existing_user or {}).get("role") or (existing_invite or {}).get("role")
    await db.team_invites.update_one({"email": email_l}, {"$set": updates}, upsert=False)
    await db.users.update_one({"email": email_l}, {"$set": updates})
    # Notify the team member if their role actually changed.
    if existing_user and "role" in updates and prev_role != updates["role"]:
        await notify_role_change(existing_user.get("user_id"), email_l, prev_role, updates["role"])
    return {"ok": True, "email": email_l, **updates}


@app.get("/api/team")
async def list_team(user=Depends(require_owner)):
    invites = await db.team_invites.find({}, {"_id": 0}).to_list(length=500)
    users = await db.users.find({}, {"_id": 0}).to_list(length=1000)
    role_labels = await db.role_labels.find({}, {"_id": 0}).to_list(length=100)
    by_email = {}
    for iv in invites:
        by_email[iv["email"]] = {
            "email": iv["email"],
            "name": iv.get("name"),
            "role": iv["role"],
            "can_approve_bookings": iv.get("can_approve_bookings", False),
            "can_approve_broadcasts": iv.get("can_approve_broadcasts", False),
            "can_send_personal_messages": iv.get("can_send_personal_messages", False),
            "status": "invited",
        }
    # Determine custom role slugs so we include their holders as staff
    custom_slugs = {rl["slug"] for rl in role_labels if rl.get("category") in ("staff", "doctor")}
    for u in users:
        role = u.get("role")
        if role in STAFF_ROLES or role in custom_slugs:
            by_email[u["email"]] = {
                "email": u["email"],
                "name": u.get("name"),
                "role": role,
                "can_approve_bookings": u.get("can_approve_bookings", role in ["owner", "doctor"]),
                "can_approve_broadcasts": u.get("can_approve_broadcasts", role in ["owner", "doctor"]),
                "can_send_personal_messages": bool(u.get("can_send_personal_messages", role == "owner")),
                "dashboard_full_access": bool(u.get("dashboard_full_access", False)),
                "dashboard_tabs": list(u.get("dashboard_tabs") or []),
                "status": "active",
                "picture": u.get("picture"),
                "user_id": u.get("user_id"),
            }
    return sorted(by_email.values(), key=lambda x: (x["role"], x["email"]))


# -------- Custom Role Labels (owner only manages) -------- #

@app.get("/api/team/roles")
async def list_roles(user=Depends(require_user)):
    """Return the union of core roles + owner's custom labels so UI can render pickers."""
    core = [
        {"slug": "doctor", "label": "Doctor", "category": "doctor", "builtin": True},
        {"slug": "assistant", "label": "Assistant", "category": "staff", "builtin": True},
        {"slug": "reception", "label": "Reception", "category": "staff", "builtin": True},
        {"slug": "nursing", "label": "Nursing Staff", "category": "staff", "builtin": True},
    ]
    custom = await db.role_labels.find({}, {"_id": 0}).to_list(length=100)
    for c in custom:
        c["builtin"] = False
    return {"roles": core + custom}


@app.post("/api/team/roles")
async def create_role(body: RoleLabelBody, user=Depends(require_owner)):
    label = (body.label or "").strip()
    if not label:
        raise HTTPException(status_code=400, detail="Label required")
    slug = re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")[:40]
    if not slug or slug in VALID_ROLES:
        raise HTTPException(status_code=400, detail="Invalid or reserved role label")
    category = body.category if body.category in ("staff", "doctor", "patient") else "staff"
    existing = await db.role_labels.find_one({"slug": slug}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=409, detail="Role label already exists")
    doc = {
        "slug": slug,
        "label": label,
        "category": category,
        "created_by": user["user_id"],
        "created_at": datetime.now(timezone.utc),
    }
    await db.role_labels.insert_one(doc)
    doc.pop("_id", None)
    return doc


@app.delete("/api/team/roles/{slug}")
async def delete_role(slug: str, user=Depends(require_owner)):
    if slug in VALID_ROLES:
        raise HTTPException(status_code=400, detail="Core roles cannot be removed")
    in_use = await db.users.count_documents({"role": slug}) + await db.team_invites.count_documents({"role": slug})
    if in_use:
        raise HTTPException(status_code=400, detail=f"Cannot remove role: {in_use} member(s) still assigned")
    await db.role_labels.delete_one({"slug": slug})
    return {"ok": True}


@app.delete("/api/team/{email}")
async def remove_team_member(email: str, user=Depends(require_owner)):
    email_l = email.lower()
    if email_l == OWNER_EMAIL:
        raise HTTPException(status_code=400, detail="Cannot remove the owner")
    await db.team_invites.delete_one({"email": email_l})
    await db.users.update_one(
        {"email": email_l},
        {"$set": {"role": "patient", "can_approve_bookings": False, "can_approve_broadcasts": False}},
    )
    return {"ok": True}


# ============================================================
# SURGERIES (doctor-added log of procedures per patient)
# ============================================================


@app.post("/api/surgeries")
async def create_surgery(body: SurgeryBody, user=Depends(require_prescriber)):
    surgery_id = f"sx_{uuid.uuid4().hex[:10]}"
    digits = re.sub(r"\D", "", body.patient_phone)
    patient_user_id = None
    if digits:
        m = await db.users.find_one({"phone_digits": digits}, {"_id": 0, "user_id": 1})
        if m:
            patient_user_id = m["user_id"]
    doc = {
        "surgery_id": surgery_id,
        "doctor_user_id": user["user_id"],
        "patient_user_id": patient_user_id,
        "patient_phone": body.patient_phone,
        "patient_name": body.patient_name,
        "patient_age": body.patient_age,
        "patient_sex": body.patient_sex,
        "patient_id_ipno": body.patient_id_ipno,
        "registration_no": await get_or_set_reg_no(body.patient_phone, getattr(body, "registration_no", None), body.patient_name),
        "address": body.address,
        "patient_category": body.patient_category,
        "consultation_date": body.consultation_date,
        "referred_by": body.referred_by,
        "clinical_examination": body.clinical_examination,
        "diagnosis": body.diagnosis,
        "imaging": body.imaging,
        "department": body.department,
        "date_of_admission": body.date_of_admission,
        "surgery_name": body.surgery_name,
        "date": body.date,
        "hospital": body.hospital,
        "operative_findings": body.operative_findings,
        "post_op_investigations": body.post_op_investigations,
        "date_of_discharge": body.date_of_discharge,
        "follow_up": body.follow_up,
        "notes": body.notes,
        "created_at": datetime.now(timezone.utc),
    }
    await db.surgeries.insert_one(doc)
    doc.pop("_id", None)
    return doc


@app.get("/api/surgeries")
async def list_surgeries(user=Depends(require_staff)):
    cursor = db.surgeries.find({}, {"_id": 0}).sort("date", -1)
    return await cursor.to_list(length=5000)


@app.get("/api/surgeries/export.csv")
async def export_surgeries_csv(user=Depends(require_prescriber)):
    """Download the full surgery logbook as a CSV, sorted latest first."""
    import csv as _csv
    from io import StringIO
    from fastapi.responses import StreamingResponse

    cursor = db.surgeries.find({}, {"_id": 0}).sort("date", -1)
    rows = await cursor.to_list(length=10000)

    columns = [
        ("date", "Date of Surgery"),
        ("patient_name", "Name"),
        ("patient_phone", "Mobile"),
        ("patient_age", "Age"),
        ("patient_sex", "Sex"),
        ("patient_id_ipno", "IP No."),
        ("address", "Address"),
        ("patient_category", "Category"),
        ("consultation_date", "Consultation Date"),
        ("referred_by", "Referred By"),
        ("clinical_examination", "Clinical Examination"),
        ("diagnosis", "Diagnosis"),
        ("imaging", "Imaging"),
        ("department", "Department"),
        ("date_of_admission", "Date of Admission"),
        ("surgery_name", "Name of Surgery"),
        ("hospital", "Hospital"),
        ("operative_findings", "Operative Findings"),
        ("post_op_investigations", "Post-op Investigations"),
        ("date_of_discharge", "Date of Discharge"),
        ("follow_up", "Follow up"),
        ("notes", "Notes"),
        ("surgery_id", "Ref ID"),
    ]

    def _fmt(v: Any) -> str:
        if v is None:
            return ""
        if isinstance(v, datetime):
            return v.strftime("%d-%m-%Y")
        # ISO date strings like 2025-03-12 → DD-MM-YYYY
        if isinstance(v, str) and re.match(r"^\d{4}-\d{2}-\d{2}$", v):
            return f"{v[8:10]}-{v[5:7]}-{v[0:4]}"
        return str(v)

    buf = StringIO()
    writer = _csv.writer(buf, quoting=_csv.QUOTE_MINIMAL)
    writer.writerow([label for _, label in columns])
    for r in rows:
        writer.writerow([_fmt(r.get(k)) for k, _ in columns])
    csv_text = buf.getvalue()
    buf.close()

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    filename = f"consulturo-surgeries-{today}.csv"
    return StreamingResponse(
        iter([csv_text]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.patch("/api/surgeries/{surgery_id}")
async def update_surgery(surgery_id: str, body: SurgeryBody, user=Depends(require_prescriber)):
    digits = re.sub(r"\D", "", body.patient_phone)
    patient_user_id = None
    if digits:
        m = await db.users.find_one({"phone_digits": digits}, {"_id": 0, "user_id": 1})
        if m:
            patient_user_id = m["user_id"]
    updates = body.model_dump()
    updates["patient_user_id"] = patient_user_id
    res = await db.surgeries.update_one({"surgery_id": surgery_id}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Surgery not found")
    return await db.surgeries.find_one({"surgery_id": surgery_id}, {"_id": 0})


@app.delete("/api/surgeries/{surgery_id}")
async def delete_surgery(surgery_id: str, user=Depends(require_prescriber)):
    res = await db.surgeries.delete_one({"surgery_id": surgery_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Surgery not found")
    return {"ok": True}


@app.post("/api/surgeries/import")
async def import_surgeries(
    payload: Dict[str, Any] = Body(...),
    user=Depends(require_prescriber),
):
    """
    Bulk import historic logbook rows.
    Payload: { "rows": [ { ...surgery fields }, ... ] }
    Accepts free-form keys (case-insensitive mapping) and normalises dates to ISO yyyy-MM-dd.
    """
    rows: List[Dict[str, Any]] = payload.get("rows", []) or []
    if not isinstance(rows, list):
        raise HTTPException(status_code=400, detail="rows must be a list")

    # Column aliases → canonical keys (lowercased, no spaces / underscores)
    alias = {
        # patient
        "name": "patient_name", "patientname": "patient_name", "patient": "patient_name",
        "mobile": "patient_phone", "mobileno": "patient_phone", "phone": "patient_phone", "contact": "patient_phone", "patientphone": "patient_phone",
        "age": "patient_age", "patientage": "patient_age",
        "sex": "patient_sex", "gender": "patient_sex", "patientsex": "patient_sex",
        "ipno": "patient_id_ipno", "ipnumber": "patient_id_ipno", "patientid": "patient_id_ipno", "patientidipno": "patient_id_ipno",
        "address": "address",
        "category": "patient_category", "patientcategory": "patient_category",
        # consultation
        "consultationdate": "consultation_date", "dateofconsultation": "consultation_date", "opddate": "consultation_date",
        "referredby": "referred_by", "referrer": "referred_by",
        "examination": "clinical_examination", "clinicalexamination": "clinical_examination", "oe": "clinical_examination",
        "diagnosis": "diagnosis", "dx": "diagnosis",
        "imaging": "imaging", "usg": "imaging", "ct": "imaging", "mri": "imaging",
        "department": "department", "dept": "department", "departmentopdipd": "department",
        "dateofadmission": "date_of_admission", "admissiondate": "date_of_admission", "doa": "date_of_admission",
        # surgery
        "nameofsurgery": "surgery_name", "surgery": "surgery_name", "procedure": "surgery_name", "operation": "surgery_name", "nameofsurgeryprocedure": "surgery_name", "surgeryname": "surgery_name",
        "dateofsurgery": "date", "dateofsurgeryprocedure": "date", "doc": "date", "surgerydate": "date", "operationdate": "date", "dos": "date", "date": "date",
        "hospital": "hospital", "centre": "hospital", "institution": "hospital",
        "operativefindings": "operative_findings", "opnotes": "operative_findings", "findings": "operative_findings",
        "postopinvestigations": "post_op_investigations", "postop": "post_op_investigations", "postopinvestigation": "post_op_investigations",
        "dateofdischarge": "date_of_discharge", "dischargedate": "date_of_discharge", "dod": "date_of_discharge",
        "followup": "follow_up", "fu": "follow_up",
        "notes": "notes", "remarks": "notes", "additionalnotes": "notes",
    }

    # Canonical keys always map to themselves (normalised form)
    canonical_set = {
        "patient_name", "patient_phone", "patient_age", "patient_sex", "patient_id_ipno",
        "address", "patient_category", "consultation_date", "referred_by",
        "clinical_examination", "diagnosis", "imaging", "department", "date_of_admission",
        "surgery_name", "date", "hospital", "operative_findings", "post_op_investigations",
        "date_of_discharge", "follow_up", "notes",
    }

    def _normkey(k: str) -> str:
        return re.sub(r"[^a-z0-9]", "", (k or "").strip().lower())

    # Add canonical keys to alias (their normalised form maps to themselves)
    for c in canonical_set:
        alias.setdefault(_normkey(c), c)

    def _normdate(v: Any) -> str:
        if not v:
            return ""
        s = str(v).strip()
        # Try DD-MM-YYYY, DD/MM/YYYY, YYYY-MM-DD, YYYY/MM/DD, DD.MM.YYYY, "3-Mar-2025"
        cleaned = s.replace("/", "-").replace(".", "-").replace(" ", "-")
        for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d-%m-%y", "%d-%b-%Y", "%d-%B-%Y", "%Y-%m-%dT%H:%M:%S"):
            try:
                return datetime.strptime(cleaned, fmt).strftime("%Y-%m-%d")
            except Exception:
                pass
        return s

    inserted = 0
    errors: List[Dict[str, Any]] = []
    for idx, raw in enumerate(rows):
        if not isinstance(raw, dict):
            errors.append({"row": idx, "error": "not an object"})
            continue

        mapped: Dict[str, Any] = {}
        for k, v in raw.items():
            canonical = alias.get(_normkey(k), _normkey(k))
            # Also allow already-canonical keys passed through
            mapped[canonical] = v

        if not mapped.get("patient_name") or not mapped.get("surgery_name") or not mapped.get("date"):
            errors.append({"row": idx, "error": "missing patient_name / surgery_name / date"})
            continue

        digits = re.sub(r"\D", "", str(mapped.get("patient_phone", "")))
        patient_user_id = None
        if digits:
            m = await db.users.find_one({"phone_digits": digits}, {"_id": 0, "user_id": 1})
            if m:
                patient_user_id = m["user_id"]

        try:
            age_val = mapped.get("patient_age")
            if isinstance(age_val, str) and age_val.strip().isdigit():
                age_val = int(age_val.strip())
            elif not isinstance(age_val, int):
                age_val = None
        except Exception:
            age_val = None

        doc = {
            "surgery_id": f"sx_{uuid.uuid4().hex[:10]}",
            "doctor_user_id": user["user_id"],
            "patient_user_id": patient_user_id,
            "patient_phone": str(mapped.get("patient_phone", "") or ""),
            "patient_name": str(mapped.get("patient_name", "") or ""),
            "patient_age": age_val,
            "patient_sex": str(mapped.get("patient_sex", "") or ""),
            "patient_id_ipno": str(mapped.get("patient_id_ipno", "") or ""),
            "address": str(mapped.get("address", "") or ""),
            "patient_category": str(mapped.get("patient_category", "") or ""),
            "consultation_date": _normdate(mapped.get("consultation_date")),
            "referred_by": str(mapped.get("referred_by", "") or ""),
            "clinical_examination": str(mapped.get("clinical_examination", "") or ""),
            "diagnosis": str(mapped.get("diagnosis", "") or ""),
            "imaging": str(mapped.get("imaging", "") or ""),
            "department": str(mapped.get("department", "") or ""),
            "date_of_admission": _normdate(mapped.get("date_of_admission")),
            "surgery_name": str(mapped.get("surgery_name", "") or ""),
            "date": _normdate(mapped.get("date")),
            "hospital": str(mapped.get("hospital", "") or ""),
            "operative_findings": str(mapped.get("operative_findings", "") or ""),
            "post_op_investigations": str(mapped.get("post_op_investigations", "") or ""),
            "date_of_discharge": _normdate(mapped.get("date_of_discharge")),
            "follow_up": str(mapped.get("follow_up", "") or ""),
            "notes": str(mapped.get("notes", "") or ""),
            "imported": True,
            "imported_at": datetime.now(timezone.utc),
            "created_at": datetime.now(timezone.utc),
        }
        try:
            await db.surgeries.insert_one(doc)
            inserted += 1
        except Exception as ex:
            errors.append({"row": idx, "error": str(ex)[:140]})

    return {"inserted": inserted, "errors": errors, "total": len(rows)}


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


@app.get("/api/surgeries/presets")
async def surgery_presets():
    return {"procedures": COMMON_PROCEDURES}


# ============================================================
# PATIENT SELF-PROFILE / MY RECORDS
# ============================================================


class MyProfileBody(BaseModel):
    phone: Optional[str] = None


@app.patch("/api/auth/me")
async def update_my_profile(body: MyProfileBody, user=Depends(require_user)):
    updates: Dict[str, Any] = {}
    if body.phone is not None:
        digits = re.sub(r"\D", "", body.phone)
        updates["phone"] = body.phone
        updates["phone_digits"] = digits
    if updates:
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": updates})
    return await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})


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


@app.get("/api/availability/me")
async def get_my_availability(user=Depends(require_prescriber)):
    doc = await db.availability.find_one({"user_id": user["user_id"]}, {"_id": 0})
    if not doc:
        return {"user_id": user["user_id"], **_default_availability()}
    return doc


@app.put("/api/availability/me")
async def set_my_availability(body: DayAvailabilityBody, user=Depends(require_prescriber)):
    payload = body.model_dump()
    payload["user_id"] = user["user_id"]
    payload["updated_at"] = datetime.now(timezone.utc)
    await db.availability.update_one(
        {"user_id": user["user_id"]},
        {"$set": payload},
        upsert=True,
    )
    return payload


@app.get("/api/availability/doctors")
async def list_doctor_availability():
    """Public list of doctors' weekly schedules (for patient booking UI)."""
    # Includes primary_owner / partner so a clinic where the chief is a
    # primary_owner (e.g. sagar.joshi133@gmail.com) doesn't silently
    # disappear from the patient-facing roster.
    prescribers = await db.users.find(
        {"role": {"$in": PRESCRIBER_AVAILABILITY_ROLES}}, {"_id": 0}
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


@app.get("/api/availability/slots")
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
    # Includes primary_owner / partner — see PRESCRIBER_AVAILABILITY_ROLES.
    doctors_q: Dict[str, Any] = {"role": {"$in": PRESCRIBER_AVAILABILITY_ROLES}}
    if user_id:
        doctors_q["user_id"] = user_id

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

    # Same-day filtering — never offer a slot whose start time has
    # already passed in IST. The previous +15 minute lead is REMOVED
    # at user request: patients may grab a slot up to its actual start
    # minute. (POST /api/bookings still has a small 5-minute leniency
    # for clock skew / network round-trip.)
    try:
        from zoneinfo import ZoneInfo  # py3.9+
        ist_now = datetime.now(ZoneInfo("Asia/Kolkata"))
    except Exception:
        # Fallback: treat server time as IST (server is configured to IST in production).
        ist_now = datetime.now()
    past_times: set = set()
    if d.date() == ist_now.date():
        cutoff_minutes = ist_now.hour * 60 + ist_now.minute
        for s in list(slots_set):
            try:
                hh, mm = s.split(":")
                if int(hh) * 60 + int(mm) < cutoff_minutes:
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


# ============================================================
# UNAVAILABILITY — doctor / owner / full-access manage
# ============================================================
class UnavailabilityBody(BaseModel):
    date: Optional[str] = None       # YYYY-MM-DD (omitted for recurring rules)
    all_day: bool = True
    start_time: Optional[str] = None  # "HH:MM" (24h)
    end_time: Optional[str] = None
    recurring_weekly: bool = False
    day_of_week: Optional[int] = None  # 0..6 (Mon..Sun); inferred from date if missing
    reason: Optional[str] = None


@app.get("/api/unavailabilities")
async def list_unavailabilities(user=Depends(require_doctor_or_full_access)):
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


@app.post("/api/unavailabilities")
async def create_unavailability(body: UnavailabilityBody, user=Depends(require_doctor_or_full_access)):
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


@app.delete("/api/unavailabilities/{rule_id}")
async def delete_unavailability(rule_id: str, user=Depends(require_doctor_or_full_access)):
    res = await db.unavailabilities.delete_one({"id": rule_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Rule not found")
    return {"ok": True}


async def _notify_affected_bookings(rule: Dict[str, Any]):
    """Find currently-open bookings that now collide with a fresh
    unavailability rule and (if a notification system exists) ping them.
    Currently a no-op stub — the frontend lists "affected bookings" so the
    doctor can manually reach out. Keeps the API forward-compatible."""
    return None


@app.get("/api/records/me")
async def my_records(user=Depends(require_user)):
    uid = user["user_id"]
    phone_digits = user.get("phone_digits") or ""

    phone_q = []
    if phone_digits:
        phone_q.append({"patient_phone": {"$regex": phone_digits[-10:]}})

    booking_q = {"$or": [{"user_id": uid}] + phone_q}
    rx_q = {"$or": [{"patient_user_id": uid}] + phone_q}
    sx_q = {"$or": [{"patient_user_id": uid}] + phone_q}

    bookings = await db.bookings.find(booking_q, {"_id": 0}).sort("booking_date", -1).to_list(length=200)
    prescriptions = await db.prescriptions.find(rx_q, {"_id": 0}).sort("created_at", -1).to_list(length=200)
    surgeries = await db.surgeries.find(sx_q, {"_id": 0}).sort("date", -1).to_list(length=200)
    ipss = await db.ipss_records.find({"user_id": uid}, {"_id": 0}).sort("created_at", -1).to_list(length=100)
    prostate_readings = await db.prostate_readings.find(
        {"user_id": uid}, {"_id": 0}
    ).sort("measured_on", -1).to_list(length=50)

    # Latest-per-tool snapshot from the unified tool_scores collection.
    # Drives the "My Vitals" grid on the patient's My Records screen so
    # every calculator they have ever used can surface its last reading.
    tool_scores_latest: Dict[str, Any] = {}
    pipeline = [
        {"$match": {"user_id": uid}},
        {"$sort": {"created_at": -1}},
        {"$group": {"_id": "$tool_id", "doc": {"$first": "$$ROOT"}}},
    ]
    async for row in db.tool_scores.aggregate(pipeline):
        doc = row.get("doc") or {}
        doc.pop("_id", None)
        tool_scores_latest[row["_id"]] = doc

    # Aggregate urology "conditions" from prescription diagnoses for a quick clinical overview.
    diagnoses = []
    seen = set()
    for rx in prescriptions:
        d = (rx.get("diagnosis") or "").strip()
        if d and d.lower() not in seen:
            seen.add(d.lower())
            diagnoses.append({"diagnosis": d, "date": rx.get("visit_date") or ""})

    return {
        "summary": {
            "appointments": len(bookings),
            "prescriptions": len(prescriptions),
            "surgeries": len(surgeries),
            "ipss_entries": len(ipss),
            "prostate_readings": len(prostate_readings),
            "tool_scores_count": len(tool_scores_latest),
        },
        "appointments": bookings,
        "prescriptions": prescriptions,
        "surgeries": surgeries,
        "ipss_history": ipss,
        "prostate_readings": prostate_readings,
        "tool_scores_latest": tool_scores_latest,
        "urology_conditions": diagnoses,
    }


# ============================================================
# BLOG — pulled live from drsagarjoshi.com (Blogger feed)
# ============================================================


_IMG_RE = re.compile(r'<img[^>]+src="([^"]+)"', re.IGNORECASE)
_TAG_RE = re.compile(r"<[^>]+>")


def _extract_first_img(html: str) -> Optional[str]:
    m = _IMG_RE.search(html or "")
    if not m:
        return None
    url = m.group(1).replace(r"\/", "/")
    url = re.sub(r"/s\d+(-[wh]\d+(-[ch])?)?/", "/s800/", url)
    url = re.sub(r"/w\d+-h\d+(-c)?/", "/s800/", url)
    return url


def _strip_html(html: str) -> str:
    # Remove script/style blocks first (their content is junk for excerpts)
    cleaned = re.sub(r"<(script|style)[\s\S]*?</\1>", " ", html or "", flags=re.IGNORECASE)
    # Remove HTML comments
    cleaned = re.sub(r"<!--([\s\S]*?)-->", " ", cleaned)
    txt = _TAG_RE.sub(" ", cleaned)
    txt = htmllib.unescape(txt)
    txt = re.sub(r"\s+", " ", txt).strip()
    return txt


_BLOG_CACHE: Dict[str, Any] = {"at": None, "data": []}


async def _load_blog_from_blogger() -> List[Dict[str, Any]]:
    now = datetime.now(timezone.utc)
    if _BLOG_CACHE["at"] and (now - _BLOG_CACHE["at"]).total_seconds() < 900:
        return _BLOG_CACHE["data"]
    try:
        async with httpx.AsyncClient(timeout=10.0) as hc:
            r = await hc.get(BLOGGER_FEED_URL)
            r.raise_for_status()
            feed = r.json().get("feed", {})
            posts = []
            for e in feed.get("entry", []):
                raw = e.get("content", {}).get("$t", "") or ""
                cats = [c.get("term") for c in e.get("category", []) if c.get("term")]
                alt_link = next(
                    (lk.get("href") for lk in e.get("link", []) if lk.get("rel") == "alternate"),
                    None,
                )
                post_id = (e.get("id", {}).get("$t") or "").split(".post-")[-1] or uuid.uuid4().hex
                cover = _extract_first_img(raw) or (e.get("media$thumbnail", {}) or {}).get("url") or ""
                posts.append(
                    {
                        "id": post_id,
                        "title": e.get("title", {}).get("$t", "Untitled"),
                        "category": cats[0] if cats else "Urology",
                        "categories": cats,
                        "cover": cover,
                        "excerpt": _strip_html(raw)[:240] + ("…" if len(raw) > 240 else ""),
                        "content_html": raw,
                        "published_at": (e.get("published", {}).get("$t") or "")[:10],
                        "link": alt_link,
                    }
                )
            _BLOG_CACHE["at"] = now
            _BLOG_CACHE["data"] = posts
            return posts
    except Exception:
        return _BLOG_CACHE["data"] or []


@app.get("/api/blog")
async def list_blog():
    # Merge owner-composed posts (first) with live Blogger posts.
    admin_cursor = db.blog_posts.find({"published": True}, {"_id": 0}).sort("created_at", -1)
    admin_posts_raw = await admin_cursor.to_list(length=100)
    admin_posts = [
        {
            "id": p["post_id"],
            "title": p["title"],
            "category": p.get("category") or "Urology",
            "cover": p.get("cover") or "",
            "excerpt": p.get("excerpt") or (p.get("content", "")[:240] + ("…" if len(p.get("content", "")) > 240 else "")),
            "content_html": _admin_to_html(p.get("content", "")),
            "published_at": (p.get("created_at") or datetime.now(timezone.utc)).strftime("%Y-%m-%d"),
            "link": None,
            "source": "in-app",
        }
        for p in admin_posts_raw
    ]
    blogger_posts = await _load_blog_from_blogger()
    for bp in blogger_posts:
        bp["source"] = "website"
    return admin_posts + blogger_posts


@app.get("/api/blog/{post_id}")
async def get_blog(post_id: str):
    admin = await db.blog_posts.find_one({"post_id": post_id}, {"_id": 0})
    if admin:
        return {
            "id": admin["post_id"],
            "title": admin["title"],
            "category": admin.get("category") or "Urology",
            "cover": admin.get("cover") or "",
            "excerpt": admin.get("excerpt") or "",
            "content_html": _admin_to_html(admin.get("content", "")),
            "published_at": (admin.get("created_at") or datetime.now(timezone.utc)).strftime("%Y-%m-%d"),
            "link": None,
            "source": "in-app",
        }
    posts = await _load_blog_from_blogger()
    for p in posts:
        if p["id"] == post_id:
            return p
    raise HTTPException(status_code=404, detail="Post not found")


def _admin_to_html(text: str) -> str:
    """Convert the composer's plain-text body into light HTML
    (paragraphs + preserve existing tags the user may have typed)."""
    if not text:
        return ""
    if "<p>" in text or "<img" in text or "<h" in text:
        return text
    paras = [p.strip() for p in re.split(r"\n\s*\n+", text) if p.strip()]
    return "".join(f"<p>{htmllib.escape(p).replace(chr(10), '<br/>')}</p>" for p in paras)


# ============================================================
# ADMIN BLOG COMPOSER (owner only)
# ============================================================


@app.post("/api/admin/blog")
async def admin_create_post(body: BlogPostBody, user=Depends(require_blog_writer)):
    """Super-owner (and any primary_owner explicitly granted
    `can_create_blog`) can create blog posts. Posts auto-publish
    immediately — review workflow no longer required since only
    editors can author. Other roles get a 403 from the gate."""
    post_id = f"ap_{uuid.uuid4().hex[:10]}"
    status = body.status or "published"
    doc = {
        "post_id": post_id,
        "title": body.title,
        "category": body.category or "Urology",
        "excerpt": body.excerpt or (body.content[:240] + ("…" if len(body.content) > 240 else "")),
        "content": body.content,
        "cover": body.cover or "",
        "status": status,
        "published": status == "published",
        "author_user_id": user["user_id"],
        "author_email": user.get("email"),
        "author_name": user.get("name"),
        "author_role": user.get("role"),
        "review_note": "",
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }
    await db.blog_posts.insert_one(doc)
    doc.pop("_id", None)
    return doc


@app.put("/api/admin/blog/{post_id}")
async def admin_update_post(post_id: str, body: BlogPostBody, user=Depends(require_blog_writer)):
    existing = await db.blog_posts.find_one({"post_id": post_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Not found")
    # Super-owner can edit any post; primary_owner editors can edit
    # their own. Stays simple now that authoring is editor-only.
    is_super = is_super_owner(user)
    if not is_super and existing.get("author_user_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="You can only edit your own posts")
    new_status = body.status or existing.get("status") or "published"
    updates = {
        "title": body.title,
        "category": body.category or "Urology",
        "excerpt": body.excerpt or (body.content[:240] + ("…" if len(body.content) > 240 else "")),
        "content": body.content,
        "cover": body.cover or "",
        "status": new_status,
        "published": new_status == "published",
        "updated_at": datetime.now(timezone.utc),
    }
    await db.blog_posts.update_one({"post_id": post_id}, {"$set": updates})
    return {"ok": True}


@app.post("/api/admin/blog/{post_id}/review")
async def admin_review_post(post_id: str, body: BlogReviewBody, user=Depends(require_owner)):
    """Owner-only: change a post's review status (publish/reject/send back to draft)."""
    new_status = body.status
    if new_status not in {"draft", "pending_review", "published", "rejected"}:
        raise HTTPException(status_code=400, detail="Invalid status")
    res = await db.blog_posts.update_one(
        {"post_id": post_id},
        {
            "$set": {
                "status": new_status,
                "published": new_status == "published",
                "review_note": body.review_note or "",
                "reviewed_by": user["user_id"],
                "reviewed_at": datetime.now(timezone.utc),
                "updated_at": datetime.now(timezone.utc),
            }
        },
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True, "status": new_status}


@app.delete("/api/admin/blog/{post_id}")
async def admin_delete_post(post_id: str, user=Depends(require_blog_writer)):
    existing = await db.blog_posts.find_one({"post_id": post_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Not found")
    is_super = is_super_owner(user)
    if not is_super and existing.get("author_user_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="You can only delete your own posts")
    await db.blog_posts.delete_one({"post_id": post_id})
    return {"ok": True}


@app.get("/api/admin/blog")
async def admin_list_posts(
    status: Optional[str] = None,
    user=Depends(require_blog_writer),
):
    q: Dict[str, Any] = {}
    is_super = is_super_owner(user)
    if not is_super:
        q["author_user_id"] = user["user_id"]
    if status:
        q["status"] = status
    cursor = db.blog_posts.find(q, {"_id": 0}).sort("created_at", -1)
    return await cursor.to_list(length=500)


# ============================================================
# VIDEOS (YouTube Data API v3) + EDUCATION
# ============================================================


VIDEOS_SEED = [
    {"id": "v1", "title": "Kidney Stones — Causes, Symptoms & Treatment", "youtube_id": "dQw4w9WgXcQ", "thumbnail": "https://images.unsplash.com/photo-1559757148-5c350d0d3c56?w=800&q=80", "duration": "", "category": "Urology"},
]


@app.get("/api/videos")
async def list_videos():
    api_key = os.environ.get("YOUTUBE_API_KEY")
    channel_id = os.environ.get("YOUTUBE_CHANNEL_ID")
    cache = getattr(list_videos, "_cache", None)
    now = datetime.now(timezone.utc)
    if cache and (now - cache["at"]).total_seconds() < 600:
        return cache["data"]
    if api_key and channel_id:
        try:
            async with httpx.AsyncClient(timeout=10.0) as hc:
                ch = await hc.get(
                    "https://www.googleapis.com/youtube/v3/channels",
                    params={"part": "contentDetails", "id": channel_id, "key": api_key},
                )
                ch.raise_for_status()
                uploads = ch.json()["items"][0]["contentDetails"]["relatedPlaylists"]["uploads"]
                pl = await hc.get(
                    "https://www.googleapis.com/youtube/v3/playlistItems",
                    params={"part": "snippet,contentDetails", "playlistId": uploads, "maxResults": 25, "key": api_key},
                )
                pl.raise_for_status()
                items = []
                for it in pl.json().get("items", []):
                    sn = it["snippet"]
                    vid = it["contentDetails"]["videoId"]
                    thumbs = sn.get("thumbnails", {})
                    thumb = (thumbs.get("maxres") or thumbs.get("high") or thumbs.get("medium") or thumbs.get("default") or {}).get("url") or f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"
                    items.append({
                        "id": vid, "title": sn["title"], "youtube_id": vid, "thumbnail": thumb,
                        "duration": "", "category": sn.get("channelTitle", "YouTube"),
                        "published_at": sn.get("publishedAt", ""),
                    })
                if items:
                    list_videos._cache = {"at": now, "data": items}
                    return items
        except Exception:
            pass
    return VIDEOS_SEED


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


def _apply_custom_cover(item: Dict[str, Any]) -> Dict[str, Any]:
    if not item:
        return item
    override = _EDU_CUSTOM_COVERS.get(item.get("id", ""))
    if override:
        item = {**item, "cover": override}
    return item


@app.get("/api/education")
async def list_education(lang: str = "en"):
    if lang not in ("en", "hi", "gu"):
        lang = "en"
    return [_apply_custom_cover(i) for i in _edu_list_localized(lang)]


@app.get("/api/education/{eid}")
async def get_education(eid: str, lang: str = "en"):
    if lang not in ("en", "hi", "gu"):
        lang = "en"
    item = _edu_get_localized(eid, lang)
    if not item:
        raise HTTPException(status_code=404, detail="Not found")
    return _apply_custom_cover(item)


@app.get("/api/calculators")
async def list_calculators():
    return [
        {"id": "ipss", "name": "IPSS", "category": "Prostate", "description": "7-item score with history tracking."},
        {"id": "psa-density", "name": "PSA Density", "category": "Prostate", "description": "PSA ÷ prostate volume."},
        {"id": "egfr", "name": "eGFR (CKD-EPI 2021)", "category": "Kidney", "description": "Estimate GFR from creatinine."},
        {"id": "bmi", "name": "BMI", "category": "General", "description": "Body-mass index."},
        {"id": "iief5", "name": "IIEF-5", "category": "Sexual Health", "description": "5-item erectile function score."},
        {"id": "prostate-volume", "name": "Prostate Volume", "category": "Prostate", "description": "Ellipsoid formula (0.524 × L × W × H)."},
        {"id": "crcl", "name": "Creatinine Clearance", "category": "Kidney", "description": "Cockcroft-Gault formula."},
        {"id": "stone-risk", "name": "Stone Passage Predictor", "category": "Stones", "description": "Estimate spontaneous passage %."},
    ]


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


class ToolScoreBody(BaseModel):
    tool_id: str
    score: Optional[float] = None
    label: Optional[str] = None  # Human-readable summary (e.g. "Moderate 13/35")
    details: Optional[Dict[str, Any]] = None  # Inputs + derived numbers


@app.post("/api/tools/scores")
async def save_tool_score(body: ToolScoreBody, user=Depends(require_user)):
    tid = (body.tool_id or "").lower()
    if tid not in TOOL_IDS:
        raise HTTPException(status_code=400, detail="Unknown tool_id")
    doc = {
        "score_id": f"ts_{uuid.uuid4().hex[:10]}",
        "user_id": user["user_id"],
        "tool_id": tid,
        "score": body.score,
        "label": body.label,
        "details": body.details or {},
        "created_at": datetime.now(timezone.utc),
    }
    await db.tool_scores.insert_one(doc)
    doc.pop("_id", None)
    return doc


@app.get("/api/tools/scores/{tool_id}")
async def list_tool_scores(tool_id: str, user=Depends(require_user)):
    tid = tool_id.lower()
    cursor = db.tool_scores.find({"user_id": user["user_id"], "tool_id": tid}, {"_id": 0}).sort("created_at", -1)
    return await cursor.to_list(length=200)


@app.delete("/api/tools/scores/{score_id}")
async def delete_tool_score(score_id: str, user=Depends(require_user)):
    result = await db.tool_scores.delete_one({"score_id": score_id, "user_id": user["user_id"]})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


# ---------- Bladder Diary (dedicated entries) ---------- #


class BladderEntryBody(BaseModel):
    date: str  # YYYY-MM-DD
    time: str  # HH:mm (24h)
    volume_ml: Optional[int] = None  # null allowed if only leak entry
    fluid_intake_ml: Optional[int] = None
    urgency: Optional[int] = None  # 0..4
    leak: Optional[bool] = False
    note: Optional[str] = None


@app.post("/api/tools/bladder-diary")
async def add_bladder_entry(body: BladderEntryBody, user=Depends(require_user)):
    entry = {
        "entry_id": f"bd_{uuid.uuid4().hex[:10]}",
        "user_id": user["user_id"],
        "date": body.date,
        "time": body.time,
        "volume_ml": body.volume_ml,
        "fluid_intake_ml": body.fluid_intake_ml,
        "urgency": body.urgency,
        "leak": bool(body.leak),
        "note": (body.note or "").strip() or None,
        "created_at": datetime.now(timezone.utc),
    }
    await db.bladder_diary.insert_one(entry)
    entry.pop("_id", None)
    return entry


@app.get("/api/tools/bladder-diary")
async def list_bladder_entries(from_date: Optional[str] = None, to_date: Optional[str] = None, user=Depends(require_user)):
    q: Dict[str, Any] = {"user_id": user["user_id"]}
    if from_date and to_date:
        q["date"] = {"$gte": from_date, "$lte": to_date}
    elif from_date:
        q["date"] = {"$gte": from_date}
    elif to_date:
        q["date"] = {"$lte": to_date}
    cursor = db.bladder_diary.find(q, {"_id": 0}).sort([("date", -1), ("time", -1)])
    rows = await cursor.to_list(length=3000)
    # Summarise daily totals — useful for the calendar heatmap.
    by_day: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        d = r.get("date", "")
        bucket = by_day.setdefault(d, {"date": d, "voids": 0, "total_volume": 0, "intake": 0, "leaks": 0, "max_urgency": 0})
        bucket["voids"] += 1 if r.get("volume_ml") is not None else 0
        if r.get("volume_ml"):
            bucket["total_volume"] += r["volume_ml"]
        if r.get("fluid_intake_ml"):
            bucket["intake"] += r["fluid_intake_ml"]
        if r.get("leak"):
            bucket["leaks"] += 1
        if r.get("urgency") is not None and r["urgency"] > bucket["max_urgency"]:
            bucket["max_urgency"] = r["urgency"]
    return {
        "entries": rows,
        "daily": sorted(by_day.values(), key=lambda x: x["date"], reverse=True),
    }


@app.delete("/api/tools/bladder-diary/{entry_id}")
async def delete_bladder_entry(entry_id: str, user=Depends(require_user)):
    result = await db.bladder_diary.delete_one({"entry_id": entry_id, "user_id": user["user_id"]})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


# ============================================================
# PUSH NOTIFICATIONS
# ============================================================


class PushRegisterBody(BaseModel):
    token: str
    platform: Optional[str] = None
    device_name: Optional[str] = None


class BroadcastCreate(BaseModel):
    title: str
    body: str
    image_url: Optional[str] = None
    link: Optional[str] = None
    target: Optional[str] = "all"  # all | patients | staff


class BroadcastReview(BaseModel):
    action: str  # approve | reject
    reject_reason: Optional[str] = None


async def send_expo_push_batch(
    tokens: List[str],
    title: str,
    body: str,
    data: Optional[Dict[str, Any]] = None,
    image_url: Optional[str] = None,
) -> Dict[str, Any]:
    """Fan-out push via Expo's public Push API. No FCM keys needed.
    Tokens that come back as invalid (DeviceNotRegistered / InvalidCredentials) are purged.
    Every batch is also recorded in `push_log` for observability.
    """
    log_entry: Dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "title": (title or "")[:240],
        "body": (body or "")[:500],
        "data_type": (data or {}).get("type") if isinstance(data, dict) else None,
        "total": 0,
        "sent": 0,
        "purged": 0,
        "errors": [],
        "created_at": datetime.now(timezone.utc),
    }
    if not tokens:
        log_entry["note"] = "no_tokens_supplied"
        try:
            await db.push_log.insert_one(log_entry)
        except Exception:
            pass
        return {"sent": 0, "errors": [], "total": 0, "purged": 0, "note": "no_tokens_supplied"}
    # Filter to valid Expo tokens (ExponentPushToken[...] or ExpoPushToken[...])
    clean = [
        t for t in {t for t in tokens if t}
        if isinstance(t, str) and (t.startswith("ExponentPushToken[") or t.startswith("ExpoPushToken["))
    ]
    log_entry["total"] = len(clean)
    if not clean:
        log_entry["errors"] = [{"error": "no valid tokens"}]
        try:
            await db.push_log.insert_one(log_entry)
        except Exception:
            pass
        return {"sent": 0, "errors": [{"error": "no valid tokens"}], "total": 0, "purged": 0}
    messages = []
    for t in clean:
        msg: Dict[str, Any] = {
            "to": t,
            "sound": "default",
            "title": title[:240],
            "body": body[:1000],
            "priority": "high",
            "channelId": "default",
        }
        if data:
            msg["data"] = data
        if image_url:
            # iOS rich & Android bigPicture
            msg["richContent"] = {"image": image_url}
            msg["_displayInForeground"] = True
        messages.append(msg)
    sent = 0
    errors: List[Dict[str, Any]] = []
    invalid: List[str] = []
    try:
        # Expo recommends chunks of 100
        async with httpx.AsyncClient(timeout=15.0) as hc:
            for i in range(0, len(messages), 100):
                chunk = messages[i:i + 100]
                resp = await hc.post(
                    "https://exp.host/--/api/v2/push/send",
                    json=chunk,
                    headers={
                        "Accept": "application/json",
                        "Accept-Encoding": "gzip, deflate",
                        "Content-Type": "application/json",
                    },
                )
                try:
                    data_resp = resp.json()
                except Exception:
                    errors.append({"error": f"non-json response {resp.status_code}"})
                    continue
                receipts = data_resp.get("data", [])
                for j, r in enumerate(receipts):
                    if isinstance(r, dict) and r.get("status") == "ok":
                        sent += 1
                    else:
                        err_msg = r.get("message") if isinstance(r, dict) else str(r)
                        err_detail = r.get("details", {}) if isinstance(r, dict) else {}
                        errors.append({"error": err_msg, "details": err_detail})
                        if err_detail.get("error") in ("DeviceNotRegistered", "InvalidCredentials"):
                            invalid.append(chunk[j]["to"])
    except Exception as e:
        errors.append({"error": str(e)})
    if invalid:
        await db.push_tokens.delete_many({"token": {"$in": invalid}})
    log_entry["sent"] = sent
    log_entry["errors"] = errors[:10]  # keep log rows bounded
    log_entry["purged"] = len(invalid)
    try:
        await db.push_log.insert_one(log_entry)
        # Keep only last 2000 log rows for space
        total = await db.push_log.count_documents({})
        if total > 2200:
            # Drop the oldest 200
            cutoff_doc = await db.push_log.find({}, {"created_at": 1}).sort("created_at", 1).skip(200).limit(1).to_list(1)
            if cutoff_doc:
                await db.push_log.delete_many({"created_at": {"$lt": cutoff_doc[0]["created_at"]}})
    except Exception:
        pass
    return {"sent": sent, "errors": errors, "total": len(clean), "purged": len(invalid)}


async def collect_user_tokens(user_ids: Optional[List[str]] = None) -> List[str]:
    q: Dict[str, Any] = {}
    if user_ids is not None:
        q["user_id"] = {"$in": user_ids}
    rows = await db.push_tokens.find(q, {"_id": 0, "token": 1}).to_list(length=5000)
    return [r["token"] for r in rows if r.get("token")]


async def collect_role_tokens(roles: List[str]) -> List[str]:
    uids = [u["user_id"] async for u in db.users.find({"role": {"$in": roles}}, {"user_id": 1})]
    return await collect_user_tokens(uids)


async def push_to_owner(title: str, body: str, data: Optional[Dict[str, Any]] = None):
    tokens = await collect_role_tokens(["owner"])
    if tokens:
        await send_expo_push_batch(tokens, title, body, data)


async def push_to_user(user_id: Optional[str], phone: Optional[str], title: str, body: str, data: Optional[Dict[str, Any]] = None):
    user_ids: List[str] = []
    if user_id:
        user_ids.append(user_id)
    if phone:
        digits = re.sub(r"\D", "", phone or "")
        if digits:
            rows = await db.users.find({"phone": {"$regex": digits + "$"}}, {"user_id": 1}).to_list(length=5)
            for r in rows:
                if r["user_id"] not in user_ids:
                    user_ids.append(r["user_id"])
    if not user_ids:
        return False
    tokens = await collect_user_tokens(user_ids)
    if tokens:
        await send_expo_push_batch(tokens, title, body, data)
        return True
    return False


# ============================================================
# IN-APP NOTIFICATION CENTER
#
# Every user has an inbox (db.notifications). `create_notification`
# persists a doc AND fires an Expo push, so the recipient sees a push
# banner immediately and the app keeps a read/unread history.
# ============================================================

ROLE_LABELS_BASIC: Dict[str, str] = {
    "owner": "Owner",
    "doctor": "Doctor",
    "assistant": "Assistant",
    "staff": "Staff",
    "patient": "Patient",
}


async def pretty_role(role_slug: Optional[str]) -> str:
    if not role_slug:
        return "—"
    if role_slug in ROLE_LABELS_BASIC:
        return ROLE_LABELS_BASIC[role_slug]
    custom = await db.role_labels.find_one({"slug": role_slug}, {"_id": 0, "label": 1})
    if custom and custom.get("label"):
        return custom["label"]
    return role_slug.replace("_", " ").title()


async def create_notification(
    user_id: Optional[str],
    title: str,
    body: str,
    kind: str = "info",
    data: Optional[Dict[str, Any]] = None,
    push: bool = True,
):
    """Persist an in-app notification and (optionally) also fire a push.
    Set `push=False` when the caller already handles the push via
    `push_to_user` or another channel (e.g. phone-based broadcast)."""
    if not user_id:
        return None
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "title": title,
        "body": body,
        "kind": kind,
        "data": data or {},
        "read": False,
        "created_at": datetime.now(timezone.utc),
    }
    await db.notifications.insert_one(doc)
    if push:
        try:
            await push_to_user(user_id, None, title, body, {**(data or {}), "kind": kind})
        except Exception:
            pass
    return doc


async def notify_role_change(
    user_id: Optional[str],
    email: str,
    prev_role: Optional[str],
    new_role: str,
):
    """Send the 'your role changed' notification to the team member."""
    new_label = await pretty_role(new_role)
    if prev_role:
        prev_label = await pretty_role(prev_role)
        title = "Your role has been updated"
        body = f"You are now a {new_label} (was {prev_label})."
    else:
        title = "You've been added to the team"
        body = f"You've been assigned the {new_label} role."
    await create_notification(
        user_id=user_id,
        title=title,
        body=body,
        kind="role_change",
        data={"email": email, "prev_role": prev_role, "new_role": new_role},
    )


@app.get("/api/notifications")
async def list_notifications(user=Depends(require_user), unread_only: bool = False, limit: int = 50):
    q: Dict[str, Any] = {"user_id": user["user_id"]}
    if unread_only:
        q["read"] = False
    limit = max(1, min(limit, 200))
    cursor = db.notifications.find(q, {"_id": 0}).sort("created_at", -1)
    rows = await cursor.to_list(length=limit)
    unread = await db.notifications.count_documents({"user_id": user["user_id"], "read": False})
    return {"items": rows, "unread_count": unread}


@app.post("/api/notifications/{notification_id}/read")
async def mark_notification_read(notification_id: str, user=Depends(require_user)):
    result = await db.notifications.update_one(
        {"id": notification_id, "user_id": user["user_id"]},
        {"$set": {"read": True, "read_at": datetime.now(timezone.utc)}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"ok": True}


@app.get("/api/notifications/{notification_id}")
async def get_notification(notification_id: str, user=Depends(require_user)):
    """Fetch a single notification (or broadcast inbox row) by id for the
    current user. Used by the personal-message / notification detail
    screen at /messages/[id]. Marks the row as read on access (when the
    current user is the recipient).

    Senders can also view their own sent personal messages — useful for
    surfacing WhatsApp-style receipts (✓ sent · ✓✓ delivered · ✓✓ read).
    """
    n = await db.notifications.find_one(
        {"id": notification_id, "user_id": user["user_id"]},
        {"_id": 0},
    )
    src = "notification"
    is_sender = False
    if not n:
        # Sender accessing their own sent message?
        sent = await db.notifications.find_one(
            {
                "id": notification_id,
                "kind": "personal",
                "data.sender_user_id": user["user_id"],
            },
            {"_id": 0},
        )
        if sent:
            n = sent
            is_sender = True
            src = "sent"
    if not n:
        # Try broadcast inbox (broadcasts have inbox_id)
        b = await db.broadcast_inbox.find_one(
            {"$or": [{"inbox_id": notification_id}, {"broadcast_id": notification_id}], "user_id": user["user_id"]},
            {"_id": 0},
        )
        if not b:
            raise HTTPException(status_code=404, detail="Not found")
        # Normalise broadcast row -> common shape
        n = {
            "id": b.get("inbox_id") or b.get("broadcast_id"),
            "title": b.get("title") or "",
            "body": b.get("body") or "",
            "kind": "broadcast",
            "read": bool(b.get("read_at")),
            "created_at": b.get("created_at"),
            "data": {
                "image_url": b.get("image_url"),
                "link": b.get("link"),
            },
        }
        src = "broadcast"
        # Mark broadcast as read
        if not b.get("read_at"):
            await db.broadcast_inbox.update_one(
                {"inbox_id": b.get("inbox_id"), "user_id": user["user_id"]},
                {"$set": {"read_at": datetime.now(timezone.utc)}},
            )
    elif not is_sender:
        # Mark notification as read on access (only when the viewer is
        # the recipient — senders viewing their own sent messages must
        # not toggle the read state).
        if not n.get("read"):
            await db.notifications.update_one(
                {"id": notification_id, "user_id": user["user_id"]},
                {"$set": {"read": True, "read_at": datetime.now(timezone.utc)}},
            )
            n["read"] = True
            n["read_at"] = datetime.now(timezone.utc)

    # Surface receipt fields explicitly so the frontend doesn't have
    # to dig into `data` for ticks rendering.
    n["delivered"] = bool(n.get("delivered_at"))
    n["recipient_read"] = bool(n.get("read"))
    n["recipient_read_at"] = n.get("read_at")
    n["is_sender_view"] = is_sender

    # Augment with sender info (for personal messages)
    data = n.get("data") or {}
    if (n.get("kind") == "personal") and data.get("sender_user_id"):
        sender = await db.users.find_one(
            {"user_id": data["sender_user_id"]},
            {"_id": 0, "user_id": 1, "name": 1, "email": 1, "role": 1, "picture": 1},
        )
        if sender:
            data["sender"] = sender
    # When the viewer is the SENDER, also resolve recipient details so
    # the detail screen can show "TO" attribution.
    if is_sender and n.get("user_id"):
        recipient = await db.users.find_one(
            {"user_id": n["user_id"]},
            {"_id": 0, "user_id": 1, "name": 1, "email": 1, "role": 1, "picture": 1, "phone": 1},
        )
        if recipient:
            data["recipient"] = recipient
    n["data"] = data
    n["source"] = src
    return n


@app.post("/api/notifications/read-all")
async def mark_all_notifications_read(user=Depends(require_user)):
    result = await db.notifications.update_many(
        {"user_id": user["user_id"], "read": False},
        {"$set": {"read": True, "read_at": datetime.now(timezone.utc)}},
    )
    return {"ok": True, "marked": result.modified_count}


@app.post("/api/push/register")
async def register_push_token(body: PushRegisterBody, user=Depends(require_user)):
    if not body.token or not (body.token.startswith("ExponentPushToken[") or body.token.startswith("ExpoPushToken[")):
        raise HTTPException(status_code=400, detail="Invalid Expo push token")
    now = datetime.now(timezone.utc)
    await db.push_tokens.update_one(
        {"token": body.token},
        {
            "$set": {
                "user_id": user["user_id"],
                "email": user.get("email"),
                "platform": body.platform,
                "device_name": body.device_name,
                "updated_at": now,
            },
            "$setOnInsert": {"created_at": now},
        },
        upsert=True,
    )
    return {"ok": True}


@app.delete("/api/push/register")
async def unregister_push_token(token: str = "", user=Depends(require_user)):
    if not token:
        raise HTTPException(status_code=400, detail="token query required")
    await db.push_tokens.delete_one({"token": token, "user_id": user["user_id"]})
    return {"ok": True}


# ============================================================
# PUSH DIAGNOSTICS (admin-only) + SELF-TEST
# ============================================================

@app.get("/api/push/diagnostics")
async def push_diagnostics(user=Depends(require_owner)):
    """Snapshot of the push-notification health for the clinic.
    Returns: per-user token counts, last-24h send stats, and the last
    20 push attempts with errors so the admin can pinpoint silent
    failures without reading Mongo."""
    now = datetime.now(timezone.utc)
    last_24h = now - timedelta(hours=24)

    # --- users + token counts ---
    tokens_per_user: List[Dict[str, Any]] = []
    user_rows = await db.users.find(
        {"$or": [{"role": "owner"}, {"role": "doctor"}, {"can_approve_bookings": True}]},
        {"_id": 0, "user_id": 1, "email": 1, "name": 1, "role": 1},
    ).to_list(length=200)
    for u in user_rows:
        toks = await db.push_tokens.find({"user_id": u["user_id"]}, {"_id": 0}).to_list(length=20)
        tokens_per_user.append({
            "user_id": u["user_id"],
            "email": u.get("email"),
            "name": u.get("name"),
            "role": u.get("role"),
            "token_count": len(toks),
            "tokens": [
                {
                    "platform": t.get("platform"),
                    "device_name": t.get("device_name"),
                    "created_at": t.get("created_at"),
                    "updated_at": t.get("updated_at"),
                    "token_preview": (t.get("token") or "")[:30] + "…",
                }
                for t in toks
            ],
        })

    # --- aggregates ---
    total_tokens = await db.push_tokens.count_documents({})
    sends_24h = await db.push_log.count_documents({"created_at": {"$gte": last_24h}})
    successes_24h = 0
    failures_24h = 0
    async for row in db.push_log.find(
        {"created_at": {"$gte": last_24h}}, {"_id": 0, "sent": 1, "errors": 1, "total": 1}
    ):
        sent = row.get("sent") or 0
        total = row.get("total") or 0
        successes_24h += sent
        failures_24h += max(0, total - sent)

    # --- last 20 send attempts ---
    recent: List[Dict[str, Any]] = []
    async for row in db.push_log.find({}).sort("created_at", -1).limit(20):
        row.pop("_id", None)
        recent.append(row)

    return {
        "total_tokens": total_tokens,
        "sends_last_24h": sends_24h,
        "successes_last_24h": successes_24h,
        "failures_last_24h": failures_24h,
        "users": tokens_per_user,
        "recent": recent,
    }


@app.post("/api/push/test")
async def push_self_test(user=Depends(require_user)):
    """Fire a test push to the calling user's devices so they can
    verify end-to-end delivery in <30s."""
    tokens = await collect_user_tokens([user["user_id"]])
    if not tokens:
        return {
            "ok": False,
            "reason": "no_tokens",
            "message": "No push tokens registered for this account. Grant notification permission in the app and restart.",
            "tokens_found": 0,
        }
    result = await send_expo_push_batch(
        tokens,
        "🔔 Test notification",
        "If you see this, push notifications are working!",
        {"type": "self_test", "user_id": user["user_id"]},
    )
    # Also drop an in-app note so it's visible in the bell
    try:
        await create_notification(
            user_id=user["user_id"],
            title="🔔 Test notification",
            body="If you see this, push notifications are working!",
            kind="self_test",
            data={"type": "self_test"},
            push=False,  # push already fired above
        )
    except Exception:
        pass
    return {
        "ok": (result.get("sent") or 0) > 0,
        "tokens_found": len(tokens),
        "sent": result.get("sent"),
        "errors": result.get("errors"),
        "purged": result.get("purged"),
    }


@app.post("/api/broadcasts")
async def create_broadcast(payload: BroadcastCreate, user=Depends(require_staff)):
    title = (payload.title or "").strip()
    body = (payload.body or "").strip()
    if not title or not body:
        raise HTTPException(status_code=400, detail="Title and body are required")
    if len(title) > 240 or len(body) > 2000:
        raise HTTPException(status_code=400, detail="Title max 240 chars, body max 2000 chars")
    target = payload.target if payload.target in ("all", "patients", "staff") else "all"
    bid = f"bc_{uuid.uuid4().hex[:10]}"
    is_owner = user.get("role") == "owner"
    is_approver = is_owner or bool(user.get("can_approve_broadcasts"))
    doc = {
        "broadcast_id": bid,
        "title": title,
        "body": body,
        "image_url": (payload.image_url or "").strip() or None,
        "link": (payload.link or "").strip() or None,
        "target": target,
        "author_id": user["user_id"],
        "author_name": user.get("name") or user.get("email"),
        # Owner / approvers: auto-approved (but still need explicit approve to send).
        "status": "approved" if is_approver else "pending_approval",
        "created_at": datetime.now(timezone.utc),
        "approved_by": user["user_id"] if is_approver else None,
        "approved_at": datetime.now(timezone.utc) if is_approver else None,
        "rejected_by": None,
        "rejected_at": None,
        "reject_reason": None,
        "sent_at": None,
        "sent_count": 0,
    }
    await db.broadcasts.insert_one(doc)
    doc.pop("_id", None)
    # Ping owner on Telegram for new pending broadcast
    if doc["status"] == "pending_approval":
        await notify_telegram(
            f"📝 <b>Broadcast awaiting approval</b>\n"
            f"By: {htmllib.escape(doc['author_name'] or '')}\n"
            f"<b>{htmllib.escape(title)}</b>\n{htmllib.escape(body)[:300]}"
        )
        # Push to owner + all users with broadcast approver permission
        approver_uids_cursor = db.users.find(
            {"$or": [{"role": "owner"}, {"can_approve_broadcasts": True}]},
            {"user_id": 1},
        )
        approver_uids = [u["user_id"] async for u in approver_uids_cursor]
        if approver_uids:
            tokens = await collect_user_tokens(approver_uids)
            if tokens:
                await send_expo_push_batch(
                    tokens,
                    "Broadcast awaiting approval",
                    f"{doc['author_name']}: {title}",
                    {"type": "broadcast_review", "broadcast_id": bid},
                )
            # Persist an in-app notification for each approver so they see
            # it in their bell even if the push arrived while offline.
            for uid in approver_uids:
                await create_notification(
                    user_id=uid,
                    title="Broadcast awaiting approval",
                    body=f"{doc['author_name']}: {title}",
                    kind="broadcast",
                    data={"broadcast_id": bid, "status": "pending_approval"},
                    push=False,
                )
    return doc


@app.get("/api/broadcasts")
async def list_broadcasts(status: Optional[str] = None, user=Depends(require_staff)):
    q: Dict[str, Any] = {}
    if status:
        q["status"] = status
    cursor = db.broadcasts.find(q, {"_id": 0}).sort("created_at", -1)
    return await cursor.to_list(length=300)


@app.get("/api/broadcasts/pending_count")
async def broadcasts_pending_count(user=Depends(require_staff)):
    is_approver = user.get("role") == "owner" or bool(user.get("can_approve_broadcasts"))
    if not is_approver:
        return {"count": 0}
    n = await db.broadcasts.count_documents({"status": "pending_approval"})
    return {"count": n}


@app.patch("/api/broadcasts/{bid}")
async def review_broadcast(bid: str, body: BroadcastReview, user=Depends(require_user)):
    role = user.get("role")
    is_owner = role == "owner"
    is_approver = bool(user.get("can_approve_broadcasts"))
    if not (is_owner or is_approver):
        raise HTTPException(status_code=403, detail="Only owner or designated approvers can review broadcasts")
    existing = await db.broadcasts.find_one({"broadcast_id": bid}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Not found")
    now = datetime.now(timezone.utc)
    action = (body.action or "").lower()
    updates: Dict[str, Any] = {}
    send_now = False
    if action == "approve":
        if existing["status"] in ("sent",):
            raise HTTPException(status_code=400, detail="Already sent")
        updates["status"] = "approved"
        updates["approved_by"] = user["user_id"]
        updates["approved_at"] = now
        updates["reject_reason"] = None
        send_now = True
    elif action == "reject":
        updates["status"] = "rejected"
        updates["rejected_by"] = user["user_id"]
        updates["rejected_at"] = now
        updates["reject_reason"] = (body.reject_reason or "").strip() or None
    else:
        raise HTTPException(status_code=400, detail="action must be approve or reject")

    await db.broadcasts.update_one({"broadcast_id": bid}, {"$set": updates})

    if send_now:
        # Gather target tokens
        target = existing.get("target") or "all"
        if target == "staff":
            target_roles = STAFF_ROLES
        elif target == "patients":
            target_roles = ["patient"]
        else:
            target_roles = VALID_ROLES
        tokens = await collect_role_tokens(target_roles)
        res = await send_expo_push_batch(
            tokens,
            existing["title"],
            existing["body"],
            {"type": "broadcast", "broadcast_id": bid, "link": existing.get("link") or ""},
            image_url=existing.get("image_url"),
        )
        # Build inbox records for every user in the target audience — not just those
        # with push tokens — so the in-app inbox is always reliable.
        target_users = await db.users.find(
            {"role": {"$in": target_roles}},
            {"user_id": 1},
        ).to_list(length=10000)
        uids = [u["user_id"] for u in target_users if u.get("user_id")]
        if uids:
            inbox_docs = [
                {
                    "inbox_id": f"ib_{uuid.uuid4().hex[:10]}",
                    "broadcast_id": bid,
                    "user_id": uid,
                    "title": existing["title"],
                    "body": existing["body"],
                    "image_url": existing.get("image_url"),
                    "link": existing.get("link"),
                    "created_at": now,
                    "read_at": None,
                }
                for uid in uids
            ]
            await db.broadcast_inbox.insert_many(inbox_docs)
        await db.broadcasts.update_one(
            {"broadcast_id": bid},
            {"$set": {"status": "sent", "sent_at": now, "sent_count": res.get("sent", 0)}},
        )
        # Notify the original author
        await push_to_user(
            existing["author_id"],
            None,
            "Broadcast approved & sent ✅",
            f"{existing['title']} — reached {res.get('sent', 0)} devices",
            {"type": "broadcast_sent", "broadcast_id": bid},
        )
        await create_notification(
            user_id=existing.get("author_id"),
            title="Broadcast approved & sent ✅",
            body=f"{existing['title']} — reached {res.get('sent', 0)} devices",
            kind="broadcast",
            data={"broadcast_id": bid, "status": "sent"},
            push=False,
        )
    else:
        # Reject path — notify author
        reason = (body.reject_reason or "").strip()
        await push_to_user(
            existing["author_id"],
            None,
            "Broadcast not approved",
            existing["title"] + (f" — {reason}" if reason else ""),
            {"type": "broadcast_rejected", "broadcast_id": bid},
        )
        await create_notification(
            user_id=existing.get("author_id"),
            title="Broadcast not approved",
            body=existing["title"] + (f" — Reason: {reason}" if reason else ""),
            kind="broadcast",
            data={"broadcast_id": bid, "status": "rejected"},
            push=False,
        )

    return await db.broadcasts.find_one({"broadcast_id": bid}, {"_id": 0})


@app.delete("/api/broadcasts/{bid}")
async def delete_broadcast(bid: str, user=Depends(require_user)):
    existing = await db.broadcasts.find_one({"broadcast_id": bid}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Not found")
    if user.get("role") != "owner" and existing.get("author_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Not allowed")
    if existing.get("status") == "sent":
        raise HTTPException(status_code=400, detail="Cannot delete a broadcast already sent")
    await db.broadcasts.delete_one({"broadcast_id": bid})
    return {"ok": True}


@app.get("/api/broadcasts/inbox")
async def broadcasts_inbox(user=Depends(require_user)):
    cursor = db.broadcast_inbox.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1)
    rows = await cursor.to_list(length=200)
    unread = sum(1 for r in rows if not r.get("read_at"))
    return {"items": rows, "unread": unread}


@app.post("/api/broadcasts/inbox/read")
async def mark_inbox_read(user=Depends(require_user)):
    now = datetime.now(timezone.utc)
    await db.broadcast_inbox.update_many(
        {"user_id": user["user_id"], "read_at": None},
        {"$set": {"read_at": now}},
    )
    return {"ok": True}


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
@app.get("/api/inbox/all")
async def inbox_all(user=Depends(require_user), limit: int = 100):
    limit = max(1, min(limit, 300))
    user_id = user["user_id"]

    # 1) User-specific notifications.
    notif_cursor = db.notifications.find({"user_id": user_id}, {"_id": 0}).sort("created_at", -1).limit(limit)
    notifs = await notif_cursor.to_list(length=limit)

    # Stamp `delivered_at` on any personal message that doesn't have it
    # yet. From the recipient's perspective, fetching the inbox means
    # the device has the message — that's our in-app "delivered" signal
    # (sender's WhatsApp-style ✓✓). Best-effort and idempotent.
    pending_delivered = [
        n.get("id") for n in notifs
        if n.get("kind") == "personal"
        and not n.get("delivered_at")
        and n.get("id")
    ]
    if pending_delivered:
        try:
            now = datetime.now(timezone.utc)
            await db.notifications.update_many(
                {"id": {"$in": pending_delivered}, "delivered_at": {"$in": [None, False]}},
                {"$set": {"delivered_at": now}},
            )
            for n in notifs:
                if n.get("id") in pending_delivered:
                    n["delivered_at"] = now
        except Exception:
            pass

    # 2) Broadcast inbox deliveries.
    bx_cursor = db.broadcast_inbox.find({"user_id": user_id}, {"_id": 0}).sort("created_at", -1).limit(limit)
    broadcasts = await bx_cursor.to_list(length=limit)
    # 3) Push log entries that don't have an in-app row (rare).
    push_cursor = db.push_log.find({"user_ids": user_id}, {"_id": 0}).sort("created_at", -1).limit(limit)
    pushes = await push_cursor.to_list(length=limit)

    feed: List[Dict[str, Any]] = []

    for n in notifs:
        kind = (n.get("kind") or "info").lower()
        # Broadcasts that flowed through `create_notification` are tagged
        # with kind="broadcast" already — preserve that so the frontend
        # icon picker stays consistent.
        if kind == "broadcast":
            stype = "broadcast"
        elif kind == "personal":
            stype = "personal"
        elif kind in ("push", "system"):
            stype = "push"
        else:
            stype = "user"
        feed.append({
            "id": n.get("id"),
            "title": n.get("title") or "",
            "body": n.get("body") or "",
            "kind": kind,
            "source_type": stype,
            "read": bool(n.get("read")),
            "created_at": n.get("created_at"),
            "data": n.get("data") or {},
            "image_url": (n.get("data") or {}).get("image_url"),
            "link": (n.get("data") or {}).get("link"),
        })

    # Track ids already in feed (broadcasts that also have a notification
    # row will be deduped via broadcast_id key).
    notif_ids = {f["id"] for f in feed if f.get("id")}

    for b in broadcasts:
        bid = b.get("broadcast_id") or b.get("inbox_id")
        if bid and bid in notif_ids:
            continue
        feed.append({
            "id": b.get("inbox_id") or bid,
            "broadcast_id": b.get("broadcast_id"),
            "title": b.get("title") or "",
            "body": b.get("body") or "",
            "kind": "broadcast",
            "source_type": "broadcast",
            "read": bool(b.get("read_at")),
            "created_at": b.get("created_at"),
            "image_url": b.get("image_url"),
            "link": b.get("link"),
            "data": {},
        })

    # Push log entries — only include if not already represented by a
    # notification or broadcast (most pushes have one). We match by title
    # within a 24h window, conservatively. Coerce datetimes to ISO str
    # before slicing — Mongo returns datetime objects which can't be
    # subscripted with [:13].
    def _ck(v):
        if isinstance(v, datetime):
            return v.isoformat()[:13]
        return (str(v) if v else '')[:13]
    seen_titles = {f"{(f.get('title') or '').strip()}::{_ck(f.get('created_at'))}" for f in feed}
    for p in pushes:
        key = f"{(p.get('title') or '').strip()}::{_ck(p.get('created_at'))}"
        if key in seen_titles:
            continue
        feed.append({
            "id": f"push_{p.get('_id') or _secrets.token_hex(4)}",
            "title": p.get("title") or "Notification",
            "body": p.get("body") or "",
            "kind": "push",
            "source_type": "push",
            "read": True,  # push log has no read state per-user
            "created_at": p.get("created_at"),
            "data": p.get("data") or {},
            "image_url": None,
            "link": None,
        })

    # Sort newest-first by `created_at`.
    def _ts(x):
        v = x.get("created_at")
        if isinstance(v, datetime):
            return v.timestamp()
        if isinstance(v, str):
            try: return datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp()
            except Exception: return 0
        return 0
    feed.sort(key=_ts, reverse=True)
    feed = feed[:limit]

    unread_total = sum(1 for f in feed if not f.get("read"))
    return {"items": feed, "unread": unread_total}


@app.post("/api/inbox/all/read")
async def inbox_all_mark_read(user=Depends(require_user)):
    """Mark every item in the unified inbox as read for this user
    (covers both notifications and broadcast_inbox)."""
    now = datetime.now(timezone.utc)
    a = await db.notifications.update_many(
        {"user_id": user["user_id"], "read": False},
        {"$set": {"read": True, "read_at": now}},
    )
    b = await db.broadcast_inbox.update_many(
        {"user_id": user["user_id"], "read_at": None},
        {"$set": {"read_at": now}},
    )
    return {"ok": True, "marked": a.modified_count + b.modified_count}



# ──────────────────────────────────────────────────────────────────
# Personal in-app messages (one-to-one). Owner is always permitted;
# any other team member needs `can_send_personal_messages = True`
# (granted by the owner in Dashboard → Team).
# ──────────────────────────────────────────────────────────────────
class MessageAttachment(BaseModel):
    """Base64-encoded attachment for personal messages.
    Mime is required; size is bytes (best-effort, the server
    re-validates from the data URI). The client sends `data_url` in
    the form `data:<mime>;base64,<...>` so we can persist raw and
    render it back without a separate upload endpoint.
    """
    name: str
    mime: str
    size_bytes: Optional[int] = 0
    data_url: str
    kind: Optional[str] = None  # "image" | "video" | "file" — hint for renderer


class PersonalMessageBody(BaseModel):
    recipient_user_id: Optional[str] = None
    recipient_email: Optional[EmailStr] = None
    title: str
    body: str
    attachments: Optional[List[MessageAttachment]] = None


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
class MessagingPermissionBody(BaseModel):
    allowed: bool


@app.post("/api/admin/users/{user_id}/messaging-permission")
async def set_messaging_permission(
    user_id: str,
    body: MessagingPermissionBody,
    user=Depends(require_owner),
):
    target = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if is_owner_or_partner(target):
        return {"ok": True, "user_id": user_id, "allowed": True, "note": "Owner / Partner is always permitted"}
    await db.users.update_one(
        {"user_id": user_id},
        {"$set": {"can_send_personal_messages": bool(body.allowed)}},
    )
    # Mirror onto team_invites if a row exists (so role assignment via
    # invite flow doesn't reset the bit later).
    if target.get("email"):
        await db.team_invites.update_one(
            {"email": target["email"].lower()},
            {"$set": {"can_send_personal_messages": bool(body.allowed)}},
            upsert=False,
        )
    return {"ok": True, "user_id": user_id, "allowed": bool(body.allowed)}


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
class PromoteByEmailBody(BaseModel):
    email: str


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
    }
    # Demoting back to 'doctor' should NOT keep the elevated approval
    # / messaging flags — reset them so an ex-partner doesn't silently
    # retain owner-level powers via the team_invites row.
    if role == "doctor":
        perms = {
            "role": role,
            "can_approve_bookings": True,  # doctors usually can approve
            "can_approve_broadcasts": False,
            "can_send_personal_messages": False,
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


@app.post("/api/admin/primary-owners/promote")
async def promote_primary_owner(body: PromoteByEmailBody, user=Depends(require_super_owner)):
    """Promote any email to primary_owner. Only the super_owner may
    invoke this — primary_owners managing other primary_owners is
    explicitly disallowed (the super_owner has ultimate authority)."""
    return await _promote_user_to_role(body.email, "primary_owner", actor=user)


@app.delete("/api/admin/primary-owners/{user_id}")
async def demote_primary_owner(user_id: str, user=Depends(require_super_owner)):
    """Demote a primary_owner back to a regular `doctor` role. Only the
    super_owner may invoke this. Cannot demote the configured
    OWNER_EMAIL — that account always remains a primary_owner."""
    target = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if (target.get("email") or "").lower() == OWNER_EMAIL:
        raise HTTPException(status_code=400, detail="Cannot demote the configured primary owner")
    if target.get("role") != "primary_owner":
        raise HTTPException(status_code=400, detail="User is not a primary owner")
    return await _promote_user_to_role(target["email"], "doctor", actor=user)


@app.get("/api/admin/primary-owners")
async def list_primary_owners(user=Depends(require_owner)):
    """List all primary_owners + super_owner. Visible to anyone in the
    owner tier. Includes `can_create_blog` + `dashboard_full_access`
    so the super-owner UI can render per-row toggles. Also includes
    `created_at` (ISO string — set on first promotion or earliest
    timestamp recoverable from the user doc) and `suspended` so the
    super-owner UI can render an "Active since X" tag and a
    Suspend/Resume button per row."""
    rows: List[Dict[str, Any]] = []
    seen_emails: set = set()
    async for u in db.users.find({"role": {"$in": ["primary_owner", "super_owner"]}}, {"_id": 0}):
        # Defensive dedupe — the unique email index should make this
        # impossible, but a legacy snapshot or a race during migration
        # could still surface duplicates. Render at most one card per
        # email (case-insensitive).
        em_key = (u.get("email") or "").lower().strip()
        if em_key and em_key in seen_emails:
            continue
        if em_key:
            seen_emails.add(em_key)
        dfa_raw = u.get("dashboard_full_access")
        dfa = (dfa_raw is not False) if u.get("role") in {"primary_owner", "super_owner"} else bool(dfa_raw)
        # `created_at` may be missing on rows that pre-date the field —
        # fall back to `promoted_at`, then to a stable string so the UI
        # can still render an Active-since label.
        created_at = u.get("created_at") or u.get("promoted_at")
        if isinstance(created_at, datetime):
            created_at = created_at.isoformat()
        rows.append({
            "user_id": u.get("user_id"),
            "email": u.get("email"),
            "name": u.get("name"),
            "role": u.get("role"),
            "picture": u.get("picture"),
            "can_create_blog": bool(u.get("can_create_blog")) or u.get("role") == "super_owner",
            "dashboard_full_access": dfa,
            "created_at": created_at,
            "suspended": bool(u.get("suspended")),
            "suspended_at": (u.get("suspended_at").isoformat() if isinstance(u.get("suspended_at"), datetime) else u.get("suspended_at")),
            "suspended_reason": u.get("suspended_reason"),
        })
    return {"items": rows}


class BlogPermBody(BaseModel):
    can_create_blog: bool


class DashboardPermBody(BaseModel):
    dashboard_full_access: bool


class SuspendBody(BaseModel):
    suspended: bool
    reason: Optional[str] = None


@app.patch("/api/admin/primary-owners/{user_id}/suspend")
async def set_primary_owner_suspended(
    user_id: str, body: SuspendBody, user=Depends(require_super_owner)
):
    """Super-owner-only. Temporarily suspend (or resume) a primary owner.
    A suspended user is blocked from logging in and from making any
    authenticated API call (auth middleware enforces). Useful when the
    super-owner needs to pause a clinic without deleting historical
    data."""
    target = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.get("role") not in ("primary_owner", "owner"):
        raise HTTPException(status_code=400, detail="Only primary owners can be suspended")
    update: Dict[str, Any] = {"suspended": bool(body.suspended)}
    if body.suspended:
        update["suspended_at"] = datetime.utcnow()
        update["suspended_by"] = user.get("user_id")
        update["suspended_reason"] = (body.reason or "").strip() or None
    else:
        update["suspended_at"] = None
        update["suspended_by"] = None
        update["suspended_reason"] = None
        # Drop any active sessions for this user so they're forced to
        # re-authenticate after we resume them. This is a low-cost
        # hygiene step — sessions for suspended-then-resumed accounts
        # may carry stale role flags.
    await db.users.update_one({"user_id": user_id}, {"$set": update})
    if body.suspended:
        # Hard-stop: invalidate every existing session token so the
        # user is logged out immediately on their next request.
        await db.user_sessions.delete_many({"user_id": user_id})
    return {"ok": True, "suspended": bool(body.suspended)}


@app.patch("/api/admin/primary-owners/{user_id}/blog-perm")
async def set_primary_owner_blog_perm(
    user_id: str, body: BlogPermBody, user=Depends(require_super_owner)
):
    """Super-owner-only. Grant / revoke blog editorial access for a
    specific primary_owner. Super_owner is always allowed regardless of
    this flag (immutable)."""
    target = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.get("role") != "primary_owner":
        raise HTTPException(status_code=400, detail="Target must be a primary_owner")
    val = bool(body.can_create_blog)
    await db.users.update_one({"user_id": user_id}, {"$set": {"can_create_blog": val}})
    # Persist on team_invites too so the flag survives sign-out / sign-in.
    email_l = (target.get("email") or "").lower()
    if email_l:
        # NOTE: upsert=False — we must NOT auto-create a stub team_invites
        # row that only carries the `can_create_blog` flag (no role, no
        # name). Such stubs surface later as "ghost" pending invites and
        # were the root cause of the duplicate Primary Owner perception
        # for sagar.joshi133@gmail.com. The flag is already persisted on
        # the live `users` row above; mirroring onto an existing invite
        # is best-effort only.
        await db.team_invites.update_one(
            {"email": email_l}, {"$set": {"can_create_blog": val}}, upsert=False
        )
    try:
        await db.audit_log.insert_one({
            "ts": datetime.now(timezone.utc),
            "kind": "blog_perm_change",
            "target_email": email_l,
            "target_user_id": user_id,
            "new_value": val,
            "actor_email": (user.get("email") or "").lower(),
        })
    except Exception:
        pass
    return {"ok": True, "user_id": user_id, "can_create_blog": val}


@app.patch("/api/admin/primary-owners/{user_id}/dashboard-perm")
async def set_primary_owner_dashboard_perm(
    user_id: str, body: DashboardPermBody, user=Depends(require_super_owner)
):
    """Super-owner-only. Grant / revoke full-dashboard access for a
    specific primary_owner. All owner-tier accounts start with full
    access by default — this flips the explicit override. Super_owner
    can never be limited (flag is forced True)."""
    target = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.get("role") != "primary_owner":
        raise HTTPException(status_code=400, detail="Target must be a primary_owner")
    val = bool(body.dashboard_full_access)
    await db.users.update_one(
        {"user_id": user_id}, {"$set": {"dashboard_full_access": val}}
    )
    email_l = (target.get("email") or "").lower()
    if email_l:
        # See blog-perm above — same rationale: never upsert a stub.
        await db.team_invites.update_one(
            {"email": email_l}, {"$set": {"dashboard_full_access": val}}, upsert=False
        )
    try:
        await db.audit_log.insert_one({
            "ts": datetime.now(timezone.utc),
            "kind": "dashboard_perm_change",
            "target_email": email_l,
            "target_user_id": user_id,
            "new_value": val,
            "actor_email": (user.get("email") or "").lower(),
        })
    except Exception:
        pass
    return {"ok": True, "user_id": user_id, "dashboard_full_access": val}


@app.post("/api/admin/partners/promote")
async def promote_partner(body: PromoteByEmailBody, user=Depends(require_primary_owner_strict)):
    """Promote any email to partner. primary_owner or super_owner may
    invoke this — partners themselves cannot create partners."""
    return await _promote_user_to_role(body.email, "partner", actor=user)


@app.delete("/api/admin/partners/{user_id}")
async def demote_partner(user_id: str, user=Depends(require_primary_owner_strict)):
    """Demote a partner to a regular doctor role.
    Accepts user_id='pending:<email>' to revoke a partner who hasn't
    signed in yet (only the team_invite exists)."""
    if user_id.startswith("pending:"):
        email_l = user_id.split(":", 1)[1].strip().lower()
        res = await db.team_invites.delete_many({"email": email_l, "role": "partner"})
        return {"ok": True, "revoked_invites": res.deleted_count, "email": email_l}
    target = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.get("role") != "partner":
        raise HTTPException(status_code=400, detail="User is not a partner")
    return await _promote_user_to_role(target["email"], "doctor", actor=user)


@app.get("/api/admin/partners")
async def list_partners(user=Depends(require_owner)):
    """List all partners — visible to anyone in the owner tier.
    Includes both LIVE users with role='partner' AND pending team_invites
    (partners promoted via email but who haven't signed in yet). The
    pending row carries `signed_in:false` and `user_id:null`."""
    rows: List[Dict[str, Any]] = []
    seen_emails: set = set()
    async for u in db.users.find({"role": "partner"}, {"_id": 0}):
        em = (u.get("email") or "").lower()
        if em in seen_emails:
            continue
        seen_emails.add(em)
        rows.append({
            "user_id": u.get("user_id"),
            "email": em,
            "name": u.get("name"),
            "role": u.get("role"),
            "picture": u.get("picture"),
            "signed_in": True,
        })
    async for iv in db.team_invites.find({"role": "partner"}, {"_id": 0}):
        em = (iv.get("email") or "").lower()
        if em in seen_emails:
            continue
        seen_emails.add(em)
        rows.append({
            "user_id": None,
            "email": em,
            "name": iv.get("name"),
            "role": "partner",
            "picture": None,
            "signed_in": False,
        })
    return {"items": rows}


@app.get("/api/me/tier")
async def get_my_tier(user=Depends(require_user)):
    """Flat boolean flags describing the current user's tier so the
    frontend can render role-gated UI without re-implementing the
    hierarchy logic. Always safe to call."""
    can_blog = is_super_owner(user) or (
        user.get("role") == "primary_owner" and bool(user.get("can_create_blog"))
    )
    # Dashboard access — all owner-tier roles (super_owner, primary_owner,
    # partner, legacy owner) get FULL dashboard access BY DEFAULT. The
    # super_owner can demote a specific primary_owner to LIMITED by
    # flipping `dashboard_full_access: false` on their user record.
    # Non-owner roles (doctor/assistant/etc) keep the legacy per-user
    # opt-in semantic.
    role = user.get("role")
    dfa_raw = user.get("dashboard_full_access")
    if role in {"super_owner", "primary_owner", "owner", "partner"}:
        dashboard_full_access = (dfa_raw is not False)  # default True unless explicitly revoked
    else:
        dashboard_full_access = bool(dfa_raw)
    return {
        "role": role,
        "is_super_owner": is_super_owner(user),
        "is_primary_owner": (role in {"primary_owner", "owner"}),
        "is_partner": role == "partner",
        "is_owner_tier": is_owner_or_partner(user),
        "can_manage_partners": is_primary_or_super(user),
        "can_manage_primary_owners": is_super_owner(user),
        "can_create_blog": can_blog,
        "dashboard_full_access": dashboard_full_access,
        "is_demo": bool(user.get("is_demo")),
    }


@app.get("/api/admin/messaging-permissions")
async def list_messaging_permissions(
    role: Optional[str] = None,
    q: str = "",
    user=Depends(require_owner),
):
    """List users alongside their messaging-permission status. Used by
    the new Owner UI panel for managing patient/user authorisations.
    Filterable by role and a free-text query.
    """
    base: Dict[str, Any] = {}
    if role:
        base["role"] = role
    if q:
        rx = {"$regex": re.escape(q.strip()), "$options": "i"}
        base["$or"] = [{"name": rx}, {"email": rx}, {"phone": rx}]
    rows = await db.users.find(
        base,
        {"_id": 0, "user_id": 1, "name": 1, "email": 1, "phone": 1, "role": 1, "picture": 1, "can_send_personal_messages": 1},
    ).limit(500).to_list(length=500)
    out = []
    for u in rows:
        role_ = u.get("role", "")
        explicit = u.get("can_send_personal_messages")
        if role_ == "owner":
            allowed = True; default_allowed = True
        elif role_ and role_ != "patient":
            allowed = (explicit is not False); default_allowed = True
        else:
            allowed = bool(explicit); default_allowed = False
        out.append({
            "user_id": u.get("user_id"),
            "name": u.get("name"),
            "email": u.get("email"),
            "phone": u.get("phone"),
            "role": role_,
            "picture": u.get("picture"),
            "allowed": allowed,
            "default_allowed": default_allowed,
            "explicit": explicit,
        })
    return {"items": out}


@app.get("/api/messages/recipients")
async def messages_recipients(
    q: str = "",
    scope: str = "team",
    user=Depends(require_user),
):
    """Search-as-you-type recipient picker for the personal-message
    composer. `scope` ∈ {team, patients}.
      • team     — staff members (owner + non-patient roles).
      • patients — users with role="patient".
    Returns at most 20 lightweight rows: user_id, name, email, phone,
    role, picture.
    """
    if not _can_send_personal_messages(user):
        raise HTTPException(status_code=403, detail="Not permitted to send personal messages")
    qs = (q or "").strip().lower()
    base: Dict[str, Any]
    # Patients can only message the clinic team, never other patients.
    requester_role = (user or {}).get("role", "")
    is_patient = requester_role in ("", "patient")
    effective_scope = "team" if is_patient else scope
    if effective_scope == "patients":
        base = {"role": "patient"}
    else:
        # Team recipients:
        #   • never patients (use scope="patients" for that)
        #   • never super_owner — EXCEPT when the caller is a
        #     primary_owner. Per the hierarchy rule only Primary
        #     Owners can personally message the Super Owner; partners,
        #     doctors and other staff cannot see the super_owner in
        #     their recipient search.
        exclude_roles: List[str] = ["patient"]
        if requester_role != "primary_owner":
            exclude_roles.append("super_owner")
        base = {"role": {"$nin": exclude_roles}}
    base["user_id"] = {"$ne": user["user_id"]}
    if qs:
        regex = {"$regex": re.escape(qs), "$options": "i"}
        base["$or"] = [
            {"name": regex},
            {"email": regex},
            {"phone": regex},
        ]
    cur = db.users.find(
        base,
        {"_id": 0, "user_id": 1, "name": 1, "email": 1, "phone": 1, "role": 1, "picture": 1},
    ).limit(25)
    rows = await cur.to_list(length=25)
    return {"items": rows}


@app.post("/api/messages/send")
async def messages_send(body: PersonalMessageBody, user=Depends(require_user)):
    if not _can_send_personal_messages(user):
        raise HTTPException(status_code=403, detail="Not permitted to send personal messages")
    title = (body.title or "").strip()
    msg_body = (body.body or "").strip()
    if not title or not msg_body:
        raise HTTPException(status_code=400, detail="Title and body are required")
    if len(title) > 140 or len(msg_body) > 2000:
        raise HTTPException(status_code=400, detail="Message too long")

    recipient = None
    if body.recipient_user_id:
        recipient = await db.users.find_one({"user_id": body.recipient_user_id}, {"_id": 0})
    elif body.recipient_email:
        recipient = await db.users.find_one(
            {"email": body.recipient_email.lower()}, {"_id": 0}
        )
    if not recipient:
        raise HTTPException(status_code=404, detail="Recipient not found")
    if recipient["user_id"] == user["user_id"]:
        raise HTTPException(status_code=400, detail="Cannot message yourself")
    # Hierarchy rule: only Primary Owners can message the Super Owner.
    if recipient.get("role") == "super_owner" and user.get("role") != "primary_owner":
        raise HTTPException(
            status_code=403,
            detail="Only Primary Owners can send personal messages to the Super Owner.",
        )

    sender_name = user.get("name") or user.get("email") or "Team"
    sender_role = user.get("role") or "staff"
    # Sanitize attachments — cap count and per-file size to keep
    # MongoDB documents reasonable. Larger files should later move to
    # an object-store; for now we store the data URI inline so the
    # detail screen renders without an extra fetch.
    MAX_ATTACHMENTS = 6
    MAX_BYTES = 8 * 1024 * 1024  # 8 MB per attachment
    attachments_clean: List[Dict[str, Any]] = []
    for a in (body.attachments or [])[:MAX_ATTACHMENTS]:
        d = a.model_dump() if hasattr(a, "model_dump") else (a.dict() if hasattr(a, "dict") else dict(a))
        url = (d.get("data_url") or "").strip()
        if not url.startswith("data:"):
            continue
        # Estimate size from base64 length when not provided.
        if not d.get("size_bytes"):
            try:
                b64 = url.split(",", 1)[1] if "," in url else ""
                d["size_bytes"] = int(len(b64) * 3 / 4)
            except Exception:
                d["size_bytes"] = 0
        if int(d.get("size_bytes") or 0) > MAX_BYTES:
            raise HTTPException(status_code=400, detail=f"Attachment '{d.get('name')}' exceeds 8 MB limit")
        # Infer kind from mime if missing.
        if not d.get("kind"):
            mime = (d.get("mime") or "").lower()
            d["kind"] = "image" if mime.startswith("image/") else "video" if mime.startswith("video/") else "file"
        attachments_clean.append(d)

    note_data: Dict[str, Any] = {
        "sender_user_id": user["user_id"],
        "sender_name": sender_name,
        "sender_role": sender_role,
    }
    if attachments_clean:
        note_data["attachments"] = attachments_clean
    note = await create_notification(
        recipient["user_id"],
        title=title,
        body=msg_body,
        kind="personal",
        data=note_data,
        # Suppress the implicit push fired by create_notification — we
        # send our own one below with the correct payload (`type` +
        # `kind` + optional attachment label). This avoids a double-push
        # that earlier delivered ONLY `kind` (no `type`), which the
        # frontend tap handler couldn't route into /inbox.
        push=False,
    )

    try:
        push_body = msg_body[:160]
        if attachments_clean:
            kinds = {a.get("kind") for a in attachments_clean}
            label = "📷 photo" if kinds == {"image"} else ("🎥 video" if kinds == {"video"} else "📎 attachment")
            push_body = f"{label} · {push_body}" if push_body else label
        push_ok = await push_to_user(
            recipient["user_id"],
            None,
            title=f"{sender_name}: {title}",
            body=push_body,
            # `type` is the convention used by every other push payload
            # (booking_*, broadcast, note_reminder…) — the frontend
            # `_layout.tsx` tap handler routes on `data.type`. We keep
            # `kind` for backward compatibility with older clients.
            data={"type": "personal", "kind": "personal"},
        )
        # If a push was actually fanned out to at least one device, the
        # message is considered "delivered" right now (WhatsApp ✓✓).
        if push_ok and isinstance(note, dict) and note.get("id"):
            await db.notifications.update_one(
                {"id": note["id"]},
                {"$set": {"delivered_at": datetime.now(timezone.utc)}},
            )
    except Exception:
        pass

    return {
        "ok": True,
        "notification_id": note.get("id") if isinstance(note, dict) else None,
        "recipient_user_id": recipient["user_id"],
    }






# ── Sent personal messages ──
@app.get("/api/messages/sent")
async def messages_sent(user=Depends(require_user), limit: int = 100):
    """List personal messages SENT by the current user, newest first.

    Returns rows shaped like inbox items (so the frontend can re-use the
    InboxItem renderer): each row contains the title/body/created_at +
    `data.recipient_*` (recipient name/role/email when available).
    """
    limit = max(1, min(limit, 300))
    cursor = (
        db.notifications.find(
            {"kind": "personal", "data.sender_user_id": user["user_id"]},
            {"_id": 0},
        )
        .sort("created_at", -1)
        .limit(limit)
    )
    docs = await cursor.to_list(length=limit)
    # Resolve recipient details once per request to enrich the response.
    recipient_ids = list({d.get("user_id") for d in docs if d.get("user_id")})
    recipients_by_id: Dict[str, Dict[str, Any]] = {}
    if recipient_ids:
        rcursor = db.users.find(
            {"user_id": {"$in": recipient_ids}},
            {"_id": 0, "user_id": 1, "name": 1, "email": 1, "phone": 1, "role": 1, "picture": 1},
        )
        async for r in rcursor:
            recipients_by_id[r["user_id"]] = r

    items: List[Dict[str, Any]] = []
    for n in docs:
        data = dict(n.get("data") or {})
        rid = n.get("user_id")
        rec = recipients_by_id.get(rid) if rid else None
        if rec:
            data.setdefault("recipient_name", rec.get("name"))
            data.setdefault("recipient_email", rec.get("email"))
            data.setdefault("recipient_phone", rec.get("phone"))
            data.setdefault("recipient_role", rec.get("role"))
            data.setdefault("recipient_picture", rec.get("picture"))
        items.append({
            "id": n.get("id"),
            "title": n.get("title") or "",
            "body": n.get("body") or "",
            "kind": "personal",
            "source_type": "personal",
            # Sender's perspective: this is read=True (sender authored
            # it). The recipient's read state is exposed separately so
            # the UI can render WhatsApp-style ticks (✓ sent · ✓✓
            # delivered · ✓✓ blue read).
            "read": True,
            "recipient_read": bool(n.get("read")),
            "recipient_read_at": n.get("read_at"),
            "delivered": bool(n.get("delivered_at")),
            "delivered_at": n.get("delivered_at"),
            "created_at": n.get("created_at"),
            "data": data,
            "image_url": data.get("image_url"),
            "link": data.get("link"),
            "recipient_user_id": rid,
        })
    return {"items": items, "count": len(items)}


# ── Lookup user_id by phone (for "Send Message" buttons on bookings) ──
@app.get("/api/messages/lookup-by-phone")
async def messages_lookup_by_phone(phone: str = "", user=Depends(require_user)):
    """Resolve a phone number to a registered user so the staff can open
    the personal-message composer pre-filled. Returns 200 with
    {"found": false} when no user is registered under that phone — the
    frontend can then suggest WhatsApp instead.
    """
    p = _normalize_phone(phone)
    if not p:
        raise HTTPException(status_code=400, detail="Phone required")
    suffix = p[-10:] if len(p) >= 10 else p
    # Phones in `users` are stored with country code; match by suffix so
    # legacy records still resolve.
    doc = await db.users.find_one(
        {"phone": {"$regex": f"{suffix}$"}},
        {"_id": 0, "user_id": 1, "name": 1, "email": 1, "phone": 1, "role": 1, "picture": 1},
    )
    if not doc:
        return {"found": False, "phone": p}
    role = (user.get("role") or "").lower()
    if role not in ("owner", "partner", "doctor", "assistant", "reception", "nursing"):
        # Patients can only resolve clinic team accounts.
        target_role = (doc.get("role") or "").lower()
        if target_role not in ("owner", "partner", "doctor", "assistant", "reception", "nursing"):
            return {"found": False, "phone": p}
    return {"found": True, "user": doc}


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


@app.get("/api/settings/homepage")
async def settings_homepage_public():
    """Public — patients & guests see this to render the home hero."""
    return await get_homepage_settings()


@app.patch("/api/settings/homepage")
async def settings_homepage_update(body: HomepageSettingsBody, user=Depends(require_owner)):
    updates: Dict[str, Any] = {"updated_at": datetime.now(timezone.utc), "updated_by": user["user_id"]}
    defaults_map = {
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
    for key, default_val in defaults_map.items():
        val = getattr(body, key, None)
        if val is not None:
            if key == "signature_url":
                # signature can be explicitly cleared with empty string
                updates[key] = val.strip()
            else:
                updates[key] = val.strip() or default_val
    await db.app_settings.update_one({"key": "homepage"}, {"$set": updates}, upsert=True)
    return await get_homepage_settings()


# ============================================================
# CONSENT TRACKING (medical data, privacy, marketing)
# ============================================================


class ConsentBody(BaseModel):
    data_consent: bool = False         # consent to medical-data storage
    policy_consent: bool = False       # agrees to Privacy + Terms
    marketing_consent: bool = False    # optional — reminders via WA/SMS


@app.get("/api/consent")
async def consent_get(user=Depends(require_user)):
    doc = await db.user_consents.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return doc or {
        "user_id": user["user_id"],
        "data_consent": False,
        "policy_consent": False,
        "marketing_consent": False,
        "consented_at": None,
    }


@app.post("/api/consent")
async def consent_set(body: ConsentBody, user=Depends(require_user)):
    # Both mandatory consents must be true for acceptance to be valid
    if not (body.data_consent and body.policy_consent):
        raise HTTPException(400, "You must accept data storage and privacy/terms to continue")
    now = datetime.now(timezone.utc)
    doc = {
        "user_id": user["user_id"],
        "email": user.get("email"),
        "data_consent": True,
        "policy_consent": True,
        "marketing_consent": bool(body.marketing_consent),
        "consented_at": now,
        "updated_at": now,
        "version": "1.0",
    }
    await db.user_consents.update_one(
        {"user_id": user["user_id"]}, {"$set": doc}, upsert=True
    )
    return {"ok": True, **doc}


# ============================================================
# PATIENTS (unified registration across booking/Rx/surgery)
# ============================================================

@app.get("/api/patients/lookup")
async def lookup_patient(phone: str = "", user=Depends(require_staff)):
    """Find a patient by phone (last-10-digit normalised) — used by staff forms
    to pre-fill name and reg_no when entering a repeat visitor."""
    p = _normalize_phone(phone)
    if not p:
        raise HTTPException(status_code=400, detail="Phone required")
    doc = await db.patients.find_one({"phone": p}, {"_id": 0})
    if not doc:
        return {"found": False, "phone": p}
    return {"found": True, **doc}


@app.get("/api/patients/history")
async def patient_history_by_phone(phone: str = "", user=Depends(require_staff)):
    """Full booking history for a given phone number. Used by the staff
    booking-detail screen to show 'Same patient history' inline."""
    p = _normalize_phone(phone)
    if not p:
        raise HTTPException(status_code=400, detail="Phone required")
    suffix = p[-10:] if len(p) >= 10 else p
    cursor = db.bookings.find(
        {"patient_phone": {"$regex": f"{suffix}$"}},
        {"_id": 0},
    ).sort("created_at", -1)
    bookings = await cursor.to_list(length=100)
    return {"phone": p, "count": len(bookings), "bookings": bookings}


class PatientRegManual(BaseModel):
    phone: str
    registration_no: str
    name: Optional[str] = None


@app.patch("/api/patients/reg_no")
async def set_patient_reg_no(body: PatientRegManual, user=Depends(require_prescriber)):
    """Allow clinicians to manually assign / override a patient's reg_no (e.g. when
    merging legacy records or correcting a misallocation)."""
    p = _normalize_phone(body.phone)
    if not p:
        raise HTTPException(status_code=400, detail="Phone required")
    reg = (body.registration_no or "").strip()
    if not reg:
        raise HTTPException(status_code=400, detail="Registration number required")
    await db.patients.update_one(
        {"phone": p},
        {
            "$set": {
                "phone": p,
                "reg_no": reg,
                "name": body.name,
                "updated_at": datetime.now(timezone.utc),
            },
            "$setOnInsert": {"first_seen_at": datetime.now(timezone.utc)},
        },
        upsert=True,
    )
    # Back-fill existing records for this phone so everything matches.
    await db.bookings.update_many({"patient_phone": {"$regex": p + "$"}}, {"$set": {"registration_no": reg}})
    await db.prescriptions.update_many({"patient_phone": {"$regex": p + "$"}}, {"$set": {"registration_no": reg}})
    await db.surgeries.update_many({"patient_phone": {"$regex": p + "$"}}, {"$set": {"registration_no": reg}})
    return {"ok": True, "phone": p, "registration_no": reg}


# ============================================================
# REFERRING DOCTORS (CRM-style list managed by staff)
# ============================================================


@app.post("/api/referrers")
async def create_referrer(body: ReferrerBody, user=Depends(require_staff)):
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    referrer_id = f"ref_{uuid.uuid4().hex[:10]}"
    doc = {
        "referrer_id": referrer_id,
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


@app.get("/api/referrers")
async def list_referrers(user=Depends(require_staff)):
    cursor = db.referrers.find({}, {"_id": 0}).sort("name", 1)
    items = await cursor.to_list(length=2000)
    # Attach surgery-count (how many surgeries reference this name via referred_by)
    # Cheap: one aggregation for the whole set.
    try:
        pipeline = [
            {"$match": {"referred_by": {"$exists": True, "$ne": ""}}},
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


@app.patch("/api/referrers/{referrer_id}")
async def update_referrer(referrer_id: str, body: ReferrerBody, user=Depends(require_staff)):
    existing = await db.referrers.find_one({"referrer_id": referrer_id}, {"_id": 0})
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
    await db.referrers.update_one({"referrer_id": referrer_id}, {"$set": updates})
    merged = {**existing, **updates}
    merged.pop("_id", None)
    return merged


@app.delete("/api/referrers/{referrer_id}")
async def delete_referrer(referrer_id: str, user=Depends(require_prescriber)):
    res = await db.referrers.delete_one({"referrer_id": referrer_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Referrer not found")
    return {"ok": True}


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


@app.get("/api/analytics/dashboard")
async def analytics_dashboard(
    months: int = 12,
    user=Depends(require_prescriber),
):
    """Returns aggregated analytics for the owner dashboard:
    - totals (lifetime)
    - monthly_bookings / monthly_surgeries / monthly_prescriptions (last N months)
    - daily_bookings (last 14 days)
    - status breakdown + mode breakdown
    - top diagnoses + top surgery names
    - top referrers (from surgeries.referred_by)
    """
    months = max(1, min(24, int(months or 12)))
    month_keys = _last_n_months(months)
    day_keys = _last_n_days(14)

    # --- totals ---
    total_bookings = await db.bookings.count_documents({})
    total_surgeries = await db.surgeries.count_documents({})
    total_rx = await db.prescriptions.count_documents({})
    total_patients = await db.patients.count_documents({})
    confirmed_bookings = await db.bookings.count_documents({"status": "confirmed"})
    pending_bookings = await db.bookings.count_documents({"status": "requested"})
    cancelled_bookings = await db.bookings.count_documents({"status": "cancelled"})

    # --- monthly bookings from booking_date (string YYYY-MM-DD) ---
    monthly_bookings = {k: 0 for k in month_keys}
    async for b in db.bookings.find({}, {"_id": 0, "booking_date": 1, "created_at": 1}):
        key = _month_bucket(b.get("booking_date") or b.get("created_at") or "")
        if key in monthly_bookings:
            monthly_bookings[key] += 1

    # --- monthly surgeries (from surgery date field, YYYY-MM-DD) ---
    monthly_surgeries = {k: 0 for k in month_keys}
    async for s in db.surgeries.find({}, {"_id": 0, "date": 1, "created_at": 1}):
        key = _month_bucket(s.get("date") or s.get("created_at") or "")
        if key in monthly_surgeries:
            monthly_surgeries[key] += 1

    # --- monthly prescriptions ---
    monthly_rx = {k: 0 for k in month_keys}
    async for r in db.prescriptions.find({}, {"_id": 0, "created_at": 1}):
        key = _month_bucket(r.get("created_at") or "")
        if key in monthly_rx:
            monthly_rx[key] += 1

    # --- daily bookings (last 14 days) ---
    daily_bookings = {k: 0 for k in day_keys}
    async for b in db.bookings.find({}, {"_id": 0, "booking_date": 1}):
        d = (b.get("booking_date") or "")[:10]
        if d in daily_bookings:
            daily_bookings[d] += 1

    # --- mode breakdown ---
    mode_online = await db.bookings.count_documents({"mode": "online"})
    mode_offline = await db.bookings.count_documents({"mode": "offline"})

    # --- top diagnoses (surgeries.diagnosis) ---
    diag_counter: Dict[str, int] = {}
    referrer_counter: Dict[str, int] = {}
    surgery_name_counter: Dict[str, int] = {}
    async for s in db.surgeries.find({}, {"_id": 0, "diagnosis": 1, "referred_by": 1, "surgery_name": 1}):
        d = (s.get("diagnosis") or "").strip()
        if d:
            diag_counter[d] = diag_counter.get(d, 0) + 1
        r = (s.get("referred_by") or "").strip()
        if r:
            referrer_counter[r] = referrer_counter.get(r, 0) + 1
        n = (s.get("surgery_name") or "").strip()
        if n:
            surgery_name_counter[n] = surgery_name_counter.get(n, 0) + 1

    def _top(counter: Dict[str, int], limit: int = 8):
        items = sorted(counter.items(), key=lambda kv: kv[1], reverse=True)[:limit]
        return [{"label": k, "count": v} for k, v in items]

    return {
        "totals": {
            "bookings": total_bookings,
            "confirmed_bookings": confirmed_bookings,
            "pending_bookings": pending_bookings,
            "cancelled_bookings": cancelled_bookings,
            "surgeries": total_surgeries,
            "prescriptions": total_rx,
            "patients": total_patients,
        },
        "monthly_bookings": [{"month": k, "count": monthly_bookings[k]} for k in month_keys],
        "monthly_surgeries": [{"month": k, "count": monthly_surgeries[k]} for k in month_keys],
        "monthly_prescriptions": [{"month": k, "count": monthly_rx[k]} for k in month_keys],
        "daily_bookings": [{"date": k, "count": daily_bookings[k]} for k in day_keys],
        "mode_breakdown": {"online": mode_online, "offline": mode_offline},
        "status_breakdown": {
            "requested": pending_bookings,
            "confirmed": confirmed_bookings,
            "cancelled": cancelled_bookings,
        },
        "top_diagnoses": _top(diag_counter, 8),
        "top_surgeries": _top(surgery_name_counter, 8),
        "top_referrers": _top(referrer_counter, 8),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


# ============================================================
# HEALTH
# ============================================================


@app.get("/api/")
async def root():
    return {"service": "ConsultUro API", "status": "ok"}


@app.get("/api/health")
async def health():
    try:
        await db.command("ping")
        return {"ok": True, "db": "connected"}
    except Exception as e:
        return JSONResponse(status_code=500, content={"ok": False, "error": str(e)})


# === MY NOTES (per-user private notes) ====================================
# Every logged-in user — patient, staff, owner — has a personal notes
# scratchpad. Isolated by user_id so no cross-user leakage.

class NoteBody(BaseModel):
    title: Optional[str] = ""
    body: str
    # ISO datetime string (UTC) at which the user wants to be reminded.
    # Null = no reminder. Stored as datetime in Mongo.
    reminder_at: Optional[str] = None
    # Free-text chip labels (max 12, each <=24 chars).
    labels: Optional[List[str]] = None


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


@app.get("/api/notes")
async def notes_list(user=Depends(require_user)):
    cursor = db.notes.find(
        {"user_id": user["user_id"]}, {"_id": 0}
    ).sort("updated_at", -1)
    return await cursor.to_list(length=500)


@app.get("/api/notes/labels")
async def notes_labels(user=Depends(require_user)):
    """Return distinct labels the current user has used across notes, with
    usage counts, sorted by frequency desc. Used by the editor to power
    autocomplete / recent-chip suggestions."""
    pipeline = [
        {"$match": {"user_id": user["user_id"]}},
        {"$unwind": "$labels"},
        {"$match": {"labels": {"$nin": [None, ""]}}},
        {"$group": {"_id": {"$toLower": "$labels"}, "label": {"$first": "$labels"}, "count": {"$sum": 1}}},
        {"$sort": {"count": -1, "label": 1}},
        {"$limit": 50},
        {"$project": {"_id": 0, "label": 1, "count": 1}},
    ]
    rows = await db.notes.aggregate(pipeline).to_list(length=50)
    return rows


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


@app.post("/api/notes")
async def notes_create(body: NoteBody, user=Depends(require_user)):
    text = (body.body or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Note body is required")
    now = datetime.now(timezone.utc)
    doc = {
        "note_id": f"note_{uuid.uuid4().hex[:10]}",
        "user_id": user["user_id"],
        "title": (body.title or "").strip()[:120],
        "body": text[:20000],
        "reminder_at": _parse_reminder(body.reminder_at),
        "reminder_fired": False,
        "labels": _clean_labels(body.labels),
        "created_at": now,
        "updated_at": now,
    }
    await db.notes.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


@app.patch("/api/notes/{note_id}")
async def notes_update(note_id: str, body: NoteBody, user=Depends(require_user)):
    text = (body.body or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Note body is required")
    existing = await db.notes.find_one({"note_id": note_id, "user_id": user["user_id"]})
    if not existing:
        raise HTTPException(status_code=404, detail="Note not found")
    new_reminder = _parse_reminder(body.reminder_at)
    updates = {
        "title": (body.title or "").strip()[:120],
        "body": text[:20000],
        "reminder_at": new_reminder,
        "labels": _clean_labels(body.labels),
        "updated_at": datetime.now(timezone.utc),
    }
    # If user re-set the reminder to a future date, reset the "fired" flag
    # so it can alert again.
    if new_reminder and new_reminder > datetime.now(timezone.utc):
        updates["reminder_fired"] = False
    await db.notes.update_one({"note_id": note_id}, {"$set": updates})
    doc = await db.notes.find_one({"note_id": note_id}, {"_id": 0})
    return doc


@app.delete("/api/notes/{note_id}")
async def notes_delete(note_id: str, user=Depends(require_user)):
    res = await db.notes.delete_one({"note_id": note_id, "user_id": user["user_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Note not found")
    return {"ok": True, "deleted": note_id}


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


@app.get("/api/medicines/catalog")
async def medicines_catalog(
    q: Optional[str] = None,
    category: Optional[str] = None,
    limit: int = 40,
    user=Depends(require_prescriber),
):
    """Search the combined (seed + clinic custom) medicine catalogue.

    Query:
      - q: substring match against name / generic / category (case-insensitive)
      - category: exact-match category filter (optional)
      - limit: 1..50 (default 40)

    Response: list[{name, generic, category, dosage, frequency, duration,
    timing, instructions, source("seed"|"custom")}]. Every key is always
    present (empty string when unspecified) so the client can rely on
    the shape.
    """
    try:
        limit = max(1, min(int(limit), 50))
    except Exception:
        limit = 40
    qn = _normalize_q(q)

    # Pull clinic-custom medicines from Mongo so staff-added drugs show up too.
    custom_cursor = db.medicines_custom.find({}, {"_id": 0})
    custom_rows = await custom_cursor.to_list(length=500)

    DEFAULTS = {
        "name": "",
        "generic": "",
        "category": "",
        "dosage": "",
        "frequency": "",
        "duration": "",
        "timing": "",
        "instructions": "",
        "brands": [],
    }

    combined: List[Dict[str, Any]] = []
    for row in _MEDICINE_SEED:
        combined.append({**DEFAULTS, **row, "source": "seed"})
    for row in custom_rows:
        combined.append({**DEFAULTS, **row, "source": "custom"})

    def matches(m: Dict[str, Any]) -> bool:
        if category and (m.get("category") or "").lower() != category.lower():
            return False
        if not qn:
            return True
        # Search across name, generic, category AND brand names (Indian
        # practices often type the brand they remember rather than the INN).
        hay_parts = [
            str(m.get(k) or "") for k in ("name", "generic", "category")
        ]
        brands = m.get("brands") or []
        if isinstance(brands, list):
            hay_parts.extend(str(b) for b in brands)
        hay = " ".join(hay_parts).lower()
        return qn in hay

    # Rank: exact name prefix > name contains > generic contains > brand match > other.
    def rank_key(m: Dict[str, Any]) -> tuple:
        name = (m.get("name") or "").lower()
        generic = (m.get("generic") or "").lower()
        brands = [str(b).lower() for b in (m.get("brands") or []) if isinstance(b, (str,))]
        if qn and name.startswith(qn):
            return (0, name)
        if qn and qn in name:
            return (1, name)
        if qn and qn in generic:
            return (2, name)
        if qn and any(qn in b for b in brands):
            return (3, name)
        return (4, name)

    filtered = [m for m in combined if matches(m)]
    filtered.sort(key=rank_key)
    return filtered[:limit]


@app.get("/api/medicines/categories")
async def medicines_categories(user=Depends(require_prescriber)):
    """Return distinct medicine categories across seed + custom, with counts."""
    counts: Dict[str, int] = {}
    for row in _MEDICINE_SEED:
        c = row.get("category") or "Other"
        counts[c] = counts.get(c, 0) + 1
    custom_rows = await db.medicines_custom.find({}, {"_id": 0}).to_list(length=500)
    for row in custom_rows:
        c = row.get("category") or "Other"
        counts[c] = counts.get(c, 0) + 1
    return sorted(
        [{"category": k, "count": v} for k, v in counts.items()],
        key=lambda x: (-x["count"], x["category"]),
    )


class MedicineCustomBody(BaseModel):
    name: str
    generic: Optional[str] = ""
    category: Optional[str] = "Other"
    dosage: Optional[str] = ""
    frequency: Optional[str] = ""
    duration: Optional[str] = ""
    timing: Optional[str] = ""
    instructions: Optional[str] = ""


@app.post("/api/medicines/custom")
async def medicines_custom_create(
    body: MedicineCustomBody, user=Depends(require_prescriber)
):
    """Owner/doctor can add a clinic-specific medicine that isn't in the seed
    (e.g. local brand, a new trial drug). Returns the stored doc."""
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Medicine name is required")
    doc = {
        "medicine_id": f"med_{uuid.uuid4().hex[:10]}",
        "name": name[:120],
        "generic": (body.generic or "").strip()[:120],
        "category": (body.category or "Other").strip()[:60] or "Other",
        "dosage": (body.dosage or "").strip()[:60],
        "frequency": (body.frequency or "").strip()[:40],
        "duration": (body.duration or "").strip()[:40],
        "timing": (body.timing or "").strip()[:60],
        "instructions": (body.instructions or "").strip()[:300],
        "created_by": user["user_id"],
        "created_at": datetime.now(timezone.utc),
    }
    await db.medicines_custom.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


@app.delete("/api/medicines/custom/{medicine_id}")
async def medicines_custom_delete(
    medicine_id: str, user=Depends(require_owner)
):
    """Owner can remove a clinic-specific medicine. Seed items cannot be removed."""
    res = await db.medicines_custom.delete_one({"medicine_id": medicine_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Custom medicine not found")
    return {"ok": True, "deleted": medicine_id}


@app.get("/api/surgeries/suggestions")
async def surgery_suggestions(
    field: str,
    q: Optional[str] = None,
    limit: int = 15,
    user=Depends(require_staff),
):
    """Return distinct past values for `field` across the surgeries
    collection, ranked by frequency descending. If `q` is given, filter
    to values whose lower-cased form contains the lower-cased query
    (substring match — more forgiving than prefix)."""
    if field not in _SUGGESTABLE_SURGERY_FIELDS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported field. Allowed: {sorted(_SUGGESTABLE_SURGERY_FIELDS)}",
        )
    try:
        limit = max(1, min(int(limit), 50))
    except Exception:
        limit = 15

    # Build pipeline: filter to non-empty values for the field, optionally
    # apply a case-insensitive substring match on the raw value, then
    # group by a lower-cased key so we de-dup "Dr X" / "DR X" together.
    match: Dict[str, Any] = {field: {"$exists": True, "$nin": [None, ""]}}
    if q and q.strip():
        # Escape regex special chars so users can search "Dr. X" literally.
        q_safe = re.escape(q.strip())
        match[field] = {"$regex": q_safe, "$options": "i", "$nin": [None, ""]}

    pipeline = [
        {"$match": match},
        # First surface a canonical form for the lower-cased group key.
        {"$project": {field: 1, "_k": {"$toLower": {"$ifNull": [f"${field}", ""]}}}},
        {"$match": {"_k": {"$ne": ""}}},
        {"$group": {"_id": "$_k", "value": {"$first": f"${field}"}, "count": {"$sum": 1}}},
        {"$sort": {"count": -1, "value": 1}},
        {"$limit": limit},
        {"$project": {"_id": 0, "value": 1, "count": 1}},
    ]
    rows = await db.surgeries.aggregate(pipeline).to_list(length=limit)
    # Final safety: strip any None/"" that slipped through.
    return [r for r in rows if r.get("value")]


# === PROSTATE VOLUME (patient-reported readings) =========================
# Any logged-in user can log a prostate-volume reading against their own
# account. Intended use-case: a patient gets a USG done elsewhere and
# enters the volume into the app so that it becomes part of his timeline
# and is visible to the doctor on the next visit.

class ProstateVolumeBody(BaseModel):
    volume_ml: float
    source: Optional[str] = None  # USG / MRI / DRE / Other
    measured_on: Optional[str] = None  # YYYY-MM-DD; defaults to today
    notes: Optional[str] = ""


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


@app.get("/api/records/prostate-volume")
async def prostate_volume_list(user=Depends(require_user)):
    uid = user["user_id"]
    cursor = db.prostate_readings.find(
        {"user_id": uid}, {"_id": 0}
    ).sort("measured_on", -1)
    rows = await cursor.to_list(length=200)
    latest = rows[0] if rows else None
    return {
        "count": len(rows),
        "latest": latest,
        "readings": rows,
    }


@app.post("/api/records/prostate-volume")
async def prostate_volume_create(body: ProstateVolumeBody, user=Depends(require_user)):
    try:
        vol = float(body.volume_ml)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="volume_ml must be a number")
    # Clinically plausible range: small adult prostate ~12 mL, massive BPH ~400 mL.
    if vol < 5 or vol > 500:
        raise HTTPException(
            status_code=400,
            detail="volume_ml must be between 5 and 500 mL",
        )
    source = (body.source or "USG").strip() or "USG"
    if source not in _VALID_PROSTATE_SOURCES:
        source = "Other"
    measured_on = _parse_measured_on(body.measured_on)
    # Disallow dates in the future (clock-skew-safe: allow 1 day ahead).
    if measured_on > datetime.now(timezone.utc) + timedelta(days=1):
        raise HTTPException(status_code=400, detail="measured_on cannot be in the future")

    doc = {
        "reading_id": f"pv_{uuid.uuid4().hex[:10]}",
        "user_id": user["user_id"],
        "phone_digits": user.get("phone_digits") or "",
        "volume_ml": round(vol, 1),
        "source": source,
        "measured_on": measured_on,
        "notes": (body.notes or "").strip()[:500],
        "created_at": datetime.now(timezone.utc),
    }
    await db.prostate_readings.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


@app.delete("/api/records/prostate-volume/{reading_id}")
async def prostate_volume_delete(reading_id: str, user=Depends(require_user)):
    res = await db.prostate_readings.delete_one(
        {"reading_id": reading_id, "user_id": user["user_id"]}
    )
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Reading not found")
    return {"ok": True, "deleted": reading_id}


# ══════════════════════════════════════════════════════════════════
# Plan-B Phase-2: Clinic Branding · Demo Mode · Partner Permissions
# ══════════════════════════════════════════════════════════════════

class ClinicSettingsPatch(BaseModel):
    """All fields optional — only provided keys are written. Free-text
    fields are length-capped to keep documents reasonable.
    """
    main_photo_url: Optional[str] = None     # data: URI or external URL
    cover_photo_url: Optional[str] = None
    doctor_name: Optional[str] = None        # e.g. "Dr Ajay Mehta"
    doctor_title: Optional[str] = None       # e.g. "Consultant Urologist"
    doctor_tagline: Optional[str] = None
    doctor_short_bio: Optional[str] = None
    clinic_name: Optional[str] = None
    clinic_website: Optional[str] = None
    social_facebook: Optional[str] = None
    social_instagram: Optional[str] = None
    social_twitter: Optional[str] = None
    social_linkedin: Optional[str] = None
    social_youtube: Optional[str] = None
    social_whatsapp: Optional[str] = None
    external_blog_links: Optional[List[Dict[str, str]]] = None  # [{title,url}]
    # Partner-permission toggles (controlled by primary_owner only).
    # `partner_can_edit_branding` is the legacy umbrella toggle (still
    # honoured for backwards compat as a fallback). New granular flags
    # below override it on a per-section basis.
    partner_can_edit_branding: Optional[bool] = None
    partner_can_edit_about_doctor: Optional[bool] = None
    partner_can_edit_blog: Optional[bool] = None
    partner_can_edit_videos: Optional[bool] = None
    partner_can_edit_education: Optional[bool] = None
    partner_can_manage_broadcasts: Optional[bool] = None
    # Granular branding sub-toggles (Primary-Owner-only). Default True.
    partner_can_edit_main_photo: Optional[bool] = None
    partner_can_edit_cover_photo: Optional[bool] = None
    partner_can_edit_clinic_info: Optional[bool] = None       # clinic_name + website
    partner_can_edit_socials: Optional[bool] = None           # all social_* handles


_DEFAULT_CLINIC_SETTINGS: Dict[str, Any] = {
    "_id": "default",
    "doctor_name": "Dr. Sagar Joshi",
    "doctor_title": "Consultant Urologist & Laparoscopic Surgeon",
    "doctor_tagline": "Restoring health, dignity, and confidence — one patient at a time.",
    "doctor_short_bio": "DrNB Urology · MS General Surgery · MBBS · 10+ years of clinical practice.",
    "clinic_name": "ConsultUro · Dr. Sagar Joshi's Urology Practice",
    "clinic_website": "https://www.drsagarjoshi.com",
    "main_photo_url": "",
    "cover_photo_url": "",
    "social_facebook": "",
    "social_instagram": "",
    "social_twitter": "",
    "social_linkedin": "",
    "social_youtube": "",
    "social_whatsapp": "",
    "external_blog_links": [],
    "partner_can_edit_branding": True,
    "partner_can_edit_about_doctor": True,
    "partner_can_edit_blog": True,
    "partner_can_edit_videos": True,
    "partner_can_edit_education": True,
    "partner_can_manage_broadcasts": True,
    # Granular sub-toggles default to True (matches legacy "branding"
    # umbrella) — primary_owner switches them off on a per-section basis.
    "partner_can_edit_main_photo": True,
    "partner_can_edit_cover_photo": True,
    "partner_can_edit_clinic_info": True,
    "partner_can_edit_socials": True,
}


@app.get("/api/clinic-settings")
async def get_clinic_settings():
    """Public read — patients also use this to render About Doctor and
    branding without auth. Falls back to hard-coded defaults if no
    document exists yet."""
    doc = await db.clinic_settings.find_one({"_id": "default"}, {"_id": 0}) or {}
    out = {**_DEFAULT_CLINIC_SETTINGS, **doc}
    out.pop("_id", None)
    return out


@app.patch("/api/clinic-settings")
async def patch_clinic_settings(
    body: ClinicSettingsPatch,
    user=Depends(require_owner),
):
    """Owner-tier write. Partners are gated per-field via the
    partner_can_edit_* toggles below — partners receive 403 if they
    try to modify a field whose toggle is off."""
    # Cap free-text payloads to ~2 MB each (data: URIs of photos
    # included). Anything bigger is almost certainly a UI bug.
    payload = body.model_dump(exclude_unset=True)
    for k in ("main_photo_url", "cover_photo_url"):
        v = payload.get(k)
        if isinstance(v, str) and len(v) > 6_000_000:  # ~6 MB safety cap
            raise HTTPException(status_code=413, detail=f"{k} too large")
    # Partner-permission gating: a partner can only modify fields the
    # primary_owner has unlocked for them. Primary/super always pass.
    if user.get("role") == "partner":
        cur = await db.clinic_settings.find_one({"_id": "default"}, {"_id": 0}) or {}
        merged = {**_DEFAULT_CLINIC_SETTINGS, **cur}
        # Helper: granular flag if explicitly set, else fall back to the
        # legacy umbrella `partner_can_edit_branding` so existing data
        # behaves identically until a primary_owner saves new toggles.
        def gate(fine_key: str) -> bool:
            v = merged.get(fine_key)
            if v is None:
                return bool(merged.get("partner_can_edit_branding"))
            return bool(v)
        gates: Dict[str, List[str]] = {
            "partner_can_edit_main_photo":   ["main_photo_url"],
            "partner_can_edit_cover_photo":  ["cover_photo_url"],
            "partner_can_edit_clinic_info":  ["clinic_name", "clinic_website"],
            "partner_can_edit_socials":      ["social_facebook", "social_instagram",
                                               "social_twitter", "social_linkedin",
                                               "social_youtube", "social_whatsapp"],
            "partner_can_edit_about_doctor": ["doctor_name", "doctor_title",
                                               "doctor_tagline", "doctor_short_bio"],
            "partner_can_edit_blog":         ["external_blog_links"],
        }
        for gate_key, fields in gates.items():
            if any(k in payload for k in fields):
                if not gate(gate_key):
                    raise HTTPException(
                        status_code=403,
                        detail=f"Partners are not permitted to edit this section ({gate_key}). Ask the Primary Owner to enable it.",
                    )
        # Partners can NEVER toggle their own permissions.
        for k in list(payload.keys()):
            if k.startswith("partner_can_"):
                payload.pop(k, None)
    if not payload:
        return {"ok": True, "updated": 0}
    await db.clinic_settings.update_one(
        {"_id": "default"},
        {"$set": {**payload, "_id": "default", "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return {"ok": True, "updated": len(payload)}


# ── Demo accounts (Primary Owner + Patient) ───────────────────────
class CreateDemoBody(BaseModel):
    email: str
    name: Optional[str] = None
    role: Optional[str] = "primary_owner"  # "primary_owner" or "patient"
    seed_sample_data: Optional[bool] = True  # patient only — pre-fill bookings/Rx/IPSS


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


@app.post("/api/admin/demo/create")
async def create_demo_account(body: CreateDemoBody, user=Depends(require_super_owner)):
    """Super-owner-only. Creates a demo account (`is_demo: true`) with
    the requested role. The middleware blocks every write request from
    demo accounts (regardless of role) — they can navigate the entire
    UI but submits short-circuit with a friendly 403.

    role:
      • "primary_owner" (default) → demo for sales / staff onboarding.
      • "patient"                  → demo of the patient experience.
                                     If `seed_sample_data` (default true)
                                     a fake booking / Rx / IPSS row are
                                     inserted so the demo looks rich.
    """
    email_l = (body.email or "").strip().lower()
    if not email_l or "@" not in email_l:
        raise HTTPException(status_code=400, detail="Valid email required")
    role = (body.role or "primary_owner").strip().lower()
    if role not in {"primary_owner", "patient"}:
        raise HTTPException(status_code=400, detail="role must be 'primary_owner' or 'patient'")
    name = (body.name or email_l.split("@")[0].title())
    perms: Dict[str, Any] = {
        "role": role,
        "is_demo": True,
        "name": name,
    }
    if role == "primary_owner":
        perms.update({
            "can_approve_bookings": True,
            "can_approve_broadcasts": True,
            "can_send_personal_messages": True,
        })
    # Upsert team_invites so future sign-ins keep the role + flag.
    await db.team_invites.update_one(
        {"email": email_l}, {"$set": {**perms, "email": email_l}}, upsert=True
    )
    # If a user already exists, mark the live record too AND grab the
    # existing user_id so we can tag seeded rows with it.
    existing = await db.users.find_one({"email": email_l}, {"_id": 0, "user_id": 1})
    user_id: Optional[str] = (existing or {}).get("user_id")
    if existing:
        await db.users.update_one({"email": email_l}, {"$set": perms})
    elif role == "patient":
        # For demo PATIENTS we want a stable user_id immediately so we
        # can seed bookings / Rx / IPSS now (without waiting for the
        # demo user to actually sign in). Insert a placeholder users
        # row that real auth will update on first login.
        user_id = f"u_demo_{uuid.uuid4().hex[:10]}"
        await db.users.insert_one({
            "user_id": user_id,
            "email": email_l,
            "name": name,
            "role": "patient",
            "is_demo": True,
            "phone": "+910000000001",
            "consent_medical": True,
            "consent_terms": True,
            "consent_at": datetime.now(timezone.utc),
            "created_at": datetime.now(timezone.utc),
        })
    seeded = None
    if role == "patient" and body.seed_sample_data and user_id:
        seeded = await _seed_demo_patient_data(user_id, email_l, name)
    try:
        await db.audit_log.insert_one({
            "ts": datetime.now(timezone.utc), "kind": "demo_created",
            "target_email": email_l, "actor_email": (user.get("email") or "").lower(),
            "demo_role": role, "seeded": seeded,
        })
    except Exception:
        pass
    return {"ok": True, "email": email_l, "role": role, "is_demo": True,
            "user_id": user_id, "seeded": seeded}


@app.delete("/api/admin/demo/{user_id}")
async def revoke_demo_primary_owner(user_id: str, user=Depends(require_super_owner)):
    """Revoke a demo account — demote to patient and clear is_demo.
    For patient demos we ALSO sweep up the seeded sample bookings /
    prescriptions / IPSS rows so the user record + their "fake history"
    disappear together.

    Accepts `user_id="pending:<email>"` to revoke a demo invite that
    hasn't signed in yet (no users row exists yet)."""
    # Pending-invite branch — no users doc exists.
    if user_id.startswith("pending:"):
        email_l = user_id.split(":", 1)[1].strip().lower()
        res = await db.team_invites.delete_many({"email": email_l, "is_demo": True})
        return {"ok": True, "revoked_invites": res.deleted_count, "cleanup": {"bookings": 0, "prescriptions": 0, "ipss": 0}}
    target = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if not target.get("is_demo"):
        raise HTTPException(status_code=400, detail="Not a demo account")
    perms = {"role": "patient", "is_demo": False,
             "can_approve_bookings": False, "can_approve_broadcasts": False,
             "can_send_personal_messages": False}
    await db.users.update_one({"user_id": user_id}, {"$set": perms})
    await db.team_invites.update_many({"email": (target.get("email") or "").lower()},
                                      {"$set": perms})
    # Sweep seeded sample data (best-effort).
    cleanup = {"bookings": 0, "prescriptions": 0, "ipss": 0}
    try:
        cleanup["bookings"] = (await db.bookings.delete_many({"user_id": user_id, "is_demo_seed": True})).deleted_count
        cleanup["prescriptions"] = (await db.prescriptions.delete_many({"user_id": user_id, "is_demo_seed": True})).deleted_count
        cleanup["ipss"] = (await db.ipss_submissions.delete_many({"user_id": user_id, "is_demo_seed": True})).deleted_count
    except Exception:
        pass
    return {"ok": True, "cleanup": cleanup}


@app.get("/api/admin/demo")
async def list_demo_accounts(user=Depends(require_super_owner)):
    """Lists every demo account including those that have not signed
    in yet. Previously only `users` with `is_demo:true` were returned
    which hid freshly-created primary_owner demos (they only exist as
    team_invites until the user signs in for the first time)."""
    items: List[Dict[str, Any]] = []
    seen_emails: set = set()
    # 1) Live users
    async for u in db.users.find({"is_demo": True}, {"_id": 0}):
        em = (u.get("email") or "").lower()
        if em in seen_emails:
            continue
        seen_emails.add(em)
        items.append({"user_id": u.get("user_id"), "email": em,
                      "name": u.get("name"), "role": u.get("role"),
                      "picture": u.get("picture"),
                      "signed_in": True})
    # 2) Pending invites (not signed in yet).
    async for iv in db.team_invites.find({"is_demo": True}, {"_id": 0}):
        em = (iv.get("email") or "").lower()
        if em in seen_emails:
            continue
        seen_emails.add(em)
        items.append({"user_id": None, "email": em,
                      "name": iv.get("name"), "role": iv.get("role"),
                      "picture": None,
                      "signed_in": False})
    return {"items": items}


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
@app.get("/api/admin/platform-stats")
async def platform_stats(user=Depends(require_super_owner)):
    """One-shot summary used by the super-owner dashboard."""
    import asyncio
    [primary_count, partner_count, staff_count, patient_count,
     bookings_30d, rx_30d, demo_count] = await asyncio.gather(
        db.users.count_documents({"role": "primary_owner"}),
        db.users.count_documents({"role": "partner"}),
        db.users.count_documents({"role": {"$in": ["doctor", "assistant", "reception", "nursing"]}}),
        db.users.count_documents({"role": "patient"}),
        db.bookings.count_documents({"created_at": {"$gte": (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()}}),
        db.prescriptions.count_documents({"created_at": {"$gte": (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()}}),
        db.users.count_documents({"is_demo": True}),
    )
    return {
        "primary_owners": primary_count,
        "partners": partner_count,
        "staff": staff_count,
        "patients": patient_count,
        "bookings_last_30d": bookings_30d,
        "prescriptions_last_30d": rx_30d,
        "demo_accounts": demo_count,
    }


@app.get("/api/admin/audit-log")
async def get_audit_log(limit: int = 50, user=Depends(require_owner)):
    """Recent role-change / demo / sensitive events. Visible to the
    entire owner-tier so primary_owners and partners can review who
    promoted whom and when."""
    rows: List[Dict[str, Any]] = []
    async for r in db.audit_log.find({}, {"_id": 0}).sort("ts", -1).limit(int(limit)):
        if isinstance(r.get("ts"), datetime):
            r["ts"] = r["ts"].isoformat()
        rows.append(r)
    return {"items": rows}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8001, reload=True)
