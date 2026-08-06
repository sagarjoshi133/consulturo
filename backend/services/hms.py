"""
ConsultUro — 100ms (HMS) integration service.

Encapsulates the two interactions ConsultUro needs with 100ms:

  1. Sign a short-lived MANAGEMENT JWT (HS256) using HMS_APP_ACCESS_KEY
     + HMS_APP_SECRET. This is the auth header for every call to
     api.100ms.live.

  2. Wrap the two REST endpoints we need:
       POST /v2/rooms                                 → create a room
       POST /v2/room-codes/room/{room_id}             → mint role-scoped
                                                        "room codes" so
                                                        doctor + patient
                                                        each get a
                                                        joinable URL.

We deliberately AVOID the React-Native 100ms SDK because it needs a
custom Expo dev-build (not Expo Go). Instead we hand each role a
"room code" URL pointing at 100ms Prebuilt
    https://prebuilt.100ms.live/meeting/<code>
which renders the full meeting UI (mute / camera / chat / screen-share
/ recording) in any browser or WebView with zero native code.

Room records are stored in MongoDB so the same booking always reopens
the same room (resumable calls, audit trail).
"""
from __future__ import annotations

import os
import time
import uuid
from typing import Dict, List, Optional, Tuple

import httpx
import jwt
from dotenv import load_dotenv

load_dotenv()

HMS_API_BASE = "https://api.100ms.live/v2"
# Custom ConsultUro subdomain (configured by Dr Joshi in the 100ms
# dashboard). Falls back to the shared prebuilt domain if missing.
HMS_PREBUILT_DOMAIN = os.environ.get(
    "HMS_PREBUILT_DOMAIN",
    "consulturo.app.100ms.live",
).strip().rstrip("/")
PREBUILT_BASE = f"https://{HMS_PREBUILT_DOMAIN}/meeting"

HMS_APP_ACCESS_KEY = os.environ.get("HMS_APP_ACCESS_KEY", "").strip()
HMS_APP_SECRET = os.environ.get("HMS_APP_SECRET", "").strip()
HMS_TEMPLATE_ID = os.environ.get("HMS_TEMPLATE_ID", "").strip()
HMS_REGION = os.environ.get("HMS_REGION", "in").strip() or "in"


class HmsNotConfigured(RuntimeError):
    """Raised when the env vars haven't been provided yet."""


def _ensure_configured() -> None:
    if not (HMS_APP_ACCESS_KEY and HMS_APP_SECRET and HMS_TEMPLATE_ID):
        raise HmsNotConfigured(
            "100ms credentials missing — set HMS_APP_ACCESS_KEY, "
            "HMS_APP_SECRET, HMS_TEMPLATE_ID in backend/.env"
        )


def is_configured() -> bool:
    return bool(HMS_APP_ACCESS_KEY and HMS_APP_SECRET and HMS_TEMPLATE_ID)


# ── 1. Management JWT ───────────────────────────────────────────
# Spec: https://www.100ms.live/docs/server-side/v2/foundation/security-and-tokens
# Algorithm HS256, claims:
#   access_key, type=management, version=2, jti=uuid, iat, nbf, exp.
def management_token(ttl_seconds: int = 60 * 60 * 24) -> str:
    """Sign a management JWT (default 24h) — used as the Bearer token
    for every server-to-server call to api.100ms.live."""
    _ensure_configured()
    now = int(time.time())
    payload = {
        "access_key": HMS_APP_ACCESS_KEY,
        "type": "management",
        "version": 2,
        "jti": uuid.uuid4().hex,
        "iat": now,
        "nbf": now,
        "exp": now + ttl_seconds,
    }
    return jwt.encode(payload, HMS_APP_SECRET, algorithm="HS256")


def _hms_headers() -> Dict[str, str]:
    return {
        "Authorization": f"Bearer {management_token()}",
        "Content-Type": "application/json",
    }


# ── 2. Room creation ────────────────────────────────────────────
async def create_room(
    name: str,
    description: str = "",
    *,
    template_id: Optional[str] = None,
) -> Dict:
    """Create a 100ms room bound to ConsultUro's template (with the
    doctor + patient roles configured in the 100ms dashboard).

    `name` must be unique per booking and matches `[a-z0-9-]+`. The
    100ms dashboard auto-normalises but we still defensively coerce.
    """
    _ensure_configured()
    safe_name = "".join(c if c.isalnum() or c == "-" else "-" for c in name.lower())[:64] or "room"
    body = {
        "name": safe_name,
        "description": description[:200],
        "template_id": template_id or HMS_TEMPLATE_ID,
        "region": HMS_REGION,
    }
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.post(f"{HMS_API_BASE}/rooms", json=body, headers=_hms_headers())
    if resp.status_code >= 400:
        raise RuntimeError(f"100ms create_room failed: {resp.status_code} {resp.text}")
    return resp.json()


# ── 3. Role-scoped room codes ───────────────────────────────────
async def create_room_codes(room_id: str) -> Dict[str, str]:
    """Mint one short joinable code per role configured on the room's
    template. Returns a dict {role: code} e.g. {"doctor": "abc-defg-hij",
    "patient": "xyz-1234-uvw"}.

    100ms response shape:
      {"data": [{"code": "...", "role": "doctor", ...}, ...]}
    """
    _ensure_configured()
    url = f"{HMS_API_BASE}/room-codes/room/{room_id}"
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.post(url, headers=_hms_headers())
    if resp.status_code >= 400:
        raise RuntimeError(f"100ms create_room_codes failed: {resp.status_code} {resp.text}")
    out: Dict[str, str] = {}
    for c in resp.json().get("data", []):
        if c.get("role") and c.get("code"):
            out[c["role"]] = c["code"]
    return out


def prebuilt_url(code: str) -> str:
    """Direct join URL using 100ms hosted Prebuilt UI. Works in any
    browser, no app install required for patients."""
    return f"{PREBUILT_BASE}/{code}"


# ── 4. End-to-end helper ───────────────────────────────────────
async def create_consultation_room(
    *, booking_id: str, patient_name: str = "", doctor_name: str = ""
) -> Dict[str, str]:
    """One-shot: create the room AND mint role-codes AND build join
    URLs. The caller stores the returned dict on the booking record."""
    desc = f"ConsultUro consult · {doctor_name or 'Doctor'} ↔ {patient_name or 'Patient'}"
    room = await create_room(name=f"consult-{booking_id}", description=desc)
    room_id = room.get("id") or room.get("room_id") or ""
    if not room_id:
        raise RuntimeError(f"100ms create_room returned no id: {room}")
    codes = await create_room_codes(room_id)
    doctor_code = codes.get("doctor", "")
    patient_code = codes.get("patient", "")
    return {
        "room_id": room_id,
        "doctor_code": doctor_code,
        "patient_code": patient_code,
        "doctor_url": prebuilt_url(doctor_code) if doctor_code else "",
        "patient_url": prebuilt_url(patient_code) if patient_code else "",
        "created_at_unix": int(time.time()),
    }



# ── 5. Recording (beam) ─────────────────────────────────────────
async def start_recording(room_id: str, *, meeting_url: str = "") -> Dict:
    """Start beam-recording for a 100ms room. The room must be active
    (i.e. at least one peer connected) for this to succeed — the API
    returns 400 otherwise.

    Returns the API's raw response dict; caller usually only needs
    .get('id') to later stop the same recording.
    """
    _ensure_configured()
    body: Dict[str, object] = {"meeting_url": meeting_url} if meeting_url else {}
    url = f"{HMS_API_BASE}/recordings/room/{room_id}/start"
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.post(url, json=body, headers=_hms_headers())
    if resp.status_code >= 400:
        raise RuntimeError(f"100ms start_recording failed: {resp.status_code} {resp.text}")
    return resp.json()


async def stop_recording(room_id: str) -> Dict:
    """Stop beam-recording for a 100ms room. Idempotent — if nothing
    is recording, 100ms returns 400 which we surface as RuntimeError.
    """
    _ensure_configured()
    url = f"{HMS_API_BASE}/recordings/room/{room_id}/stop"
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.post(url, headers=_hms_headers())
    if resp.status_code >= 400:
        raise RuntimeError(f"100ms stop_recording failed: {resp.status_code} {resp.text}")
    return resp.json()


async def list_recording_assets(room_id: str) -> List[Dict]:
    """List recording assets for a room. Each asset has a `path`
    (signed CDN URL) we can hand back to the doctor."""
    _ensure_configured()
    url = f"{HMS_API_BASE}/recording-assets?room_id={room_id}&limit=20"
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.get(url, headers=_hms_headers())
    if resp.status_code >= 400:
        return []
    return resp.json().get("data") or []
