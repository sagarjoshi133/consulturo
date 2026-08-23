"""Direct Firebase Cloud Messaging HTTP v1 sender.

Comm V2 spec (Jun 2026) explicitly overrides the standard "use Emergent
managed relay" playbook. Per user's written architecture:

    "Use direct ConsultUro-owned Firebase Cloud Messaging HTTP v1 as
     the primary Android provider. Add firebase-admin ... on the backend.
     Read service-account credentials only from a protected backend
     environment variable such as FIREBASE_SERVICE_ACCOUNT_JSON.
     Keep the Emergent relay only behind an explicit temporary
     rollback flag."

We use `firebase_admin` (installed as v7.4.0) rather than raw HTTP v1
so token acquisition + retry + concurrency safety are handled for us.
Credentials are read from FIREBASE_SERVICE_ACCOUNT_JSON_B64 (a
base64-encoded single-line copy of the service-account JSON) to keep
newlines out of .env parsing.
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import threading
from typing import Any, Dict, List, Optional, Tuple

# ── Lazy Firebase Admin initialisation ─────────────────────────
_lock = threading.Lock()
_app = None
_init_error: Optional[str] = None


def _load_credentials() -> Tuple[Optional[dict], Optional[str]]:
    b64 = (os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON_B64") or "").strip()
    raw = (os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON") or "").strip()
    if b64:
        try:
            j = base64.b64decode(b64).decode("utf-8")
            return json.loads(j), None
        except Exception as e:
            return None, f"FIREBASE_SERVICE_ACCOUNT_JSON_B64 decode failed: {e}"
    if raw:
        try:
            return json.loads(raw), None
        except Exception as e:
            return None, f"FIREBASE_SERVICE_ACCOUNT_JSON parse failed: {e}"
    return None, "no service-account env var set"


def is_configured() -> bool:
    if _init_error is not None and _app is None:
        # Attempted init previously and failed — don't retry every call.
        return False
    return _get_app() is not None


def _get_app():
    """Initialise firebase_admin once. Returns the app object or None
    (with the error stored in _init_error)."""
    global _app, _init_error
    if _app is not None:
        return _app
    with _lock:
        if _app is not None:
            return _app
        try:
            import firebase_admin
            from firebase_admin import credentials as _creds
            info, err = _load_credentials()
            if err:
                _init_error = err
                return None
            cred = _creds.Certificate(info)
            # Named app so we never clash with another init in the same process.
            try:
                _app = firebase_admin.get_app("consulturo-fcm-v2")
            except ValueError:
                _app = firebase_admin.initialize_app(cred, name="consulturo-fcm-v2")
            return _app
        except Exception as e:
            _init_error = f"firebase_admin init failed: {type(e).__name__}: {e}"
            return None


def last_init_error() -> Optional[str]:
    return _init_error


def project_id() -> Optional[str]:
    info, _ = _load_credentials()
    if not info:
        return None
    return info.get("project_id")


# ── FCM error classification ───────────────────────────────────
# Per FCM v1 API docs, these error codes MUST invalidate the token
# (permanent — never retry with the same token):
_PERMANENT_TOKEN_ERRORS = {
    "UNREGISTERED",           # token revoked by the OS / uninstalled
    "INVALID_ARGUMENT",       # malformed token / expired auth
    "NOT_FOUND",              # token doesn't exist
    "SENDER_ID_MISMATCH",     # wrong project — token issued by another project
    "REGISTRATION_TOKEN_NOT_REGISTERED",  # legacy alias
}
_TRANSIENT_ERRORS = {
    "UNAVAILABLE",            # FCM overloaded — retry with backoff
    "INTERNAL",               # FCM internal — retry with backoff
    "QUOTA_EXCEEDED",         # per-project throttle — retry with longer backoff
    "DEADLINE_EXCEEDED",
}


def classify_send_error(exc: Exception) -> Tuple[str, str]:
    """Classify an exception raised by firebase_admin.messaging.send().

    Returns (category, code_str) where category ∈ {"invalidate", "transient",
    "config", "unknown"} — the outbox uses this to decide whether to
    invalidate the token vs retry.
    """
    try:
        # firebase_admin exceptions expose .code (e.g. "unregistered") and
        # ._http_response for the underlying detail.
        code = getattr(exc, "code", "") or ""
        # Normalise ('UNREGISTERED', 'unregistered', ...) → upper.
        code_u = str(code).upper().replace(" ", "_")
    except Exception:
        code_u = ""
    text = str(exc)
    text_u = text.upper()
    # Prefer explicit .code, then fall back to message match.
    for k in _PERMANENT_TOKEN_ERRORS:
        if code_u == k or k in text_u:
            return ("invalidate", k)
    for k in _TRANSIENT_ERRORS:
        if code_u == k or k in text_u:
            return ("transient", k)
    if "UNAUTHENTICATED" in text_u or "INVALID_CREDENTIAL" in text_u:
        return ("config", "unauthenticated")
    if "PERMISSION_DENIED" in text_u:
        return ("config", "permission_denied")
    return ("unknown", code_u or "unknown")


# ── Send one message to one token ──────────────────────────────

# Android channel IDs (frontend creates these with private lock-screen).
CHANNEL_APPOINTMENTS = "consulturo_appointments_v2"
CHANNEL_MESSAGES = "consulturo_messages_v2"
CHANNEL_REMINDERS = "consulturo_reminders_v2"
CHANNEL_ANNOUNCEMENTS = "consulturo_announcements_v2"
CHANNEL_SYSTEM = "consulturo_system_v2"

_CATEGORY_TO_CHANNEL = {
    "appointments": CHANNEL_APPOINTMENTS,
    "messages": CHANNEL_MESSAGES,
    "care_updates": CHANNEL_APPOINTMENTS,  # care updates ride the appointments channel by default
    "reminders": CHANNEL_REMINDERS,
    "announcements": CHANNEL_ANNOUNCEMENTS,
    "system": CHANNEL_SYSTEM,
    "security": CHANNEL_SYSTEM,
    "marketing": CHANNEL_ANNOUNCEMENTS,
}


def _build_message(
    *,
    token: str,
    category: str,
    title: str,
    body: str,
    data: Dict[str, str],
    collapse_key: Optional[str] = None,
) -> Any:
    """Build a firebase_admin.messaging.Message using v1 conventions.

    IMPORTANT lock-screen privacy: all clinical channels are created on
    the client with `visibility = private/secret`. The push body we send
    here is the GENERIC copy (never diagnosis / procedure / medicine).
    The real content is fetched inside the authenticated app via the
    inbox_item_id / conversation_id / broadcast_id in `data`.
    """
    from firebase_admin import messaging as _m

    channel_id = _CATEGORY_TO_CHANNEL.get((category or "system").lower(),
                                          CHANNEL_SYSTEM)

    # Data payload must be str-only per FCM spec.
    safe_data: Dict[str, str] = {k: str(v) for k, v in (data or {}).items()
                                 if v is not None}
    safe_data.setdefault("category", category or "system")

    android_config = _m.AndroidConfig(
        priority="high",
        collapse_key=collapse_key or None,
        notification=_m.AndroidNotification(
            title=title,
            body=body,
            channel_id=channel_id,
            # visibility=private → Android renders "New notification" on lock
            # screen instead of the body. Channel `setLockscreenVisibility`
            # on the device is the authoritative setting, but this is our
            # per-message belt-and-braces.
            visibility="private",
            default_sound=True,
        ),
        data=safe_data,
    )
    apns_config = _m.APNSConfig(
        headers={"apns-priority": "10"},
        payload=_m.APNSPayload(
            aps=_m.Aps(
                alert=_m.ApsAlert(title=title, body=body),
                sound="default",
                mutable_content=True,
                category=category or None,
            ),
            **{"custom_data": safe_data},
        ),
    )
    return _m.Message(
        token=token,
        # We intentionally do NOT set the top-level `notification=` field
        # for Android — the AndroidConfig.notification block is authoritative
        # and lets us pin the channel_id. For iOS the APNS payload is the
        # authoritative block.
        android=android_config,
        apns=apns_config,
        data=safe_data,
    )


async def send_to_token(
    *,
    token: str,
    category: str,
    title: str,
    body: str,
    data: Optional[Dict[str, Any]] = None,
    collapse_key: Optional[str] = None,
) -> Dict[str, Any]:
    """Send one push to one native token.

    Returns:
        {"ok": True,  "message_id": "projects/.../messages/..."}
        {"ok": False, "category": "invalidate"|"transient"|"config"|"unknown",
         "code": str, "detail": str}
    """
    app = _get_app()
    if app is None:
        return {"ok": False, "category": "config", "code": "not_configured",
                "detail": _init_error or "firebase_admin not initialised"}

    def _sync_send() -> str:
        from firebase_admin import messaging as _m
        msg = _build_message(token=token, category=category, title=title,
                              body=body, data=data or {},
                              collapse_key=collapse_key)
        return _m.send(msg, app=app, dry_run=False)

    try:
        # firebase_admin.messaging.send is blocking (google-auth token
        # exchange + HTTP). Run in a worker so we don't stall the event loop.
        message_id = await asyncio.to_thread(_sync_send)
        return {"ok": True, "message_id": message_id}
    except Exception as e:
        cat, code = classify_send_error(e)
        return {"ok": False, "category": cat, "code": code, "detail": str(e)[:500]}


async def send_dry_run(*, token: str, category: str = "system") -> Dict[str, Any]:
    """Validate a token without actually delivering. Used by the
    diagnostics endpoint. Returns the same shape as send_to_token."""
    app = _get_app()
    if app is None:
        return {"ok": False, "category": "config", "code": "not_configured",
                "detail": _init_error or "firebase_admin not initialised"}

    def _sync():
        from firebase_admin import messaging as _m
        msg = _build_message(token=token, category=category,
                              title="dry-run", body="dry-run", data={})
        return _m.send(msg, app=app, dry_run=True)

    try:
        mid = await asyncio.to_thread(_sync)
        return {"ok": True, "message_id": mid, "dry_run": True}
    except Exception as e:
        cat, code = classify_send_error(e)
        return {"ok": False, "category": cat, "code": code, "detail": str(e)[:500]}
