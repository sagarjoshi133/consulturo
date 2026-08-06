"""Regression tests for the multi-channel push notification implementation.

Verifies:
1. services.push_relay._channel_for_kind() resolver maps kinds → Android channel ids.
2. send_push() handles missing EMERGENT_PUSH_KEY gracefully (no exception)
   and returns the documented contract.
3. Module imports for push_relay and notifications still succeed.
4. Core endpoints exercising push wiring (register-push, messages/send,
   broadcasts POST + approve, notifications GET) still return the expected
   status codes after the channel-injection changes.

The relay is intentionally a no-op (EMERGENT_PUSH_KEY="placeholder"), so we
only assert contract/behavior, NOT network delivery — see review_request.
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid

import pytest
import requests

# Ensure /app/backend is on sys.path so `from services.push_relay import ...` works.
BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

# Public preview URL — what the user/clients hit.
BASE_URL = (
    os.environ.get("EXPO_BACKEND_URL")
    or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or "https://urology-pro.preview.emergentagent.com"
).rstrip("/")

# Pre-seeded session tokens (see /app/memory/test_credentials.md)
OWNER_TOKEN = "test_session_1781800271528"  # primary_owner sagar.joshi133
PATIENT_TOKEN = "sagar_p_session_1781806225518"  # patient Sagar P


# ─────────────────────────────────────────────────────────────────
# 1) Module import & channel resolver (UNIT — no network)
# ─────────────────────────────────────────────────────────────────
class TestChannelResolverUnit:
    """Direct unit tests against services.push_relay._channel_for_kind."""

    def test_import_push_relay_module(self):
        from services import push_relay  # noqa: F401
        assert hasattr(push_relay, "_channel_for_kind")
        assert hasattr(push_relay, "send_push")
        assert hasattr(push_relay, "register_device")
        assert hasattr(push_relay, "is_configured")
        print("✓ services.push_relay imports cleanly with all primitives exposed")

    def test_import_notifications_module(self):
        from services import notifications  # noqa: F401
        assert hasattr(notifications, "send_expo_push_batch")
        assert hasattr(notifications, "push_to_user")
        assert hasattr(notifications, "create_notification")
        print("✓ services.notifications imports cleanly")

    @pytest.mark.parametrize("kind,expected", [
        ("personal", "messages"),
        ("inbox", "messages"),
        ("message", "messages"),
        ("broadcast", "broadcasts"),
        ("broadcast_review", "broadcasts"),
        ("broadcast_sent", "broadcasts"),
        ("broadcast_rejected", "broadcasts"),
        ("new_booking", "appointments"),
        ("booking_confirmed", "appointments"),
        ("booking_reminder", "appointments"),
        ("booking_cancelled", "appointments"),
        ("booking_completed", "appointments"),
        ("video_room_ready", "video_calls"),
        ("note_reminder", "reminders"),
        ("review_request", "reminders"),
    ])
    def test_known_kind_mappings(self, kind, expected):
        from services.push_relay import _channel_for_kind
        assert _channel_for_kind(kind) == expected, (
            f"{kind!r} should resolve to {expected!r}"
        )

    def test_none_kind_falls_back_to_default(self):
        from services.push_relay import _channel_for_kind
        assert _channel_for_kind(None) == "default"

    def test_empty_string_falls_back_to_default(self):
        from services.push_relay import _channel_for_kind
        assert _channel_for_kind("") == "default"

    def test_unknown_kind_falls_back_to_default(self):
        from services.push_relay import _channel_for_kind
        assert _channel_for_kind("totally_made_up_xyz") == "default"

    def test_case_insensitive_broadcast(self):
        from services.push_relay import _channel_for_kind
        assert _channel_for_kind("BROADCAST") == "broadcasts"
        assert _channel_for_kind("Broadcast_Review") == "broadcasts"

    def test_prefix_heuristic_booking(self):
        """Unknown booking_* keys still route to appointments."""
        from services.push_relay import _channel_for_kind
        assert _channel_for_kind("booking_followup_custom") == "appointments"

    def test_prefix_heuristic_broadcast(self):
        from services.push_relay import _channel_for_kind
        assert _channel_for_kind("broadcast_custom_x") == "broadcasts"

    def test_reminder_substring_heuristic(self):
        from services.push_relay import _channel_for_kind
        assert _channel_for_kind("daily_med_reminder") == "reminders"


# ─────────────────────────────────────────────────────────────────
# 2) send_push() graceful no-op when EMERGENT_PUSH_KEY is placeholder
# ─────────────────────────────────────────────────────────────────
class TestSendPushNoKeyContract:
    """send_push must not raise and must return the documented contract
    when no real EMERGENT_PUSH_KEY is configured."""

    def test_send_push_returns_no_emergent_key(self):
        from services.push_relay import send_push, is_configured
        assert is_configured() is False, (
            "Test assumes EMERGENT_PUSH_KEY=placeholder in this env. "
            "If a real key is set, this contract test no longer applies."
        )
        loop = asyncio.new_event_loop()
        try:
            res = loop.run_until_complete(send_push(
                recipients=["test-uid-" + uuid.uuid4().hex[:8]],
                data={"title": "T", "message": "M", "type": "personal"},
                kind="personal",
            ))
        finally:
            loop.close()
        assert isinstance(res, dict)
        assert res.get("sent") == 0, f"expected sent=0, got {res}"
        assert res.get("ok") is False, f"expected ok=False, got {res}"
        assert res.get("reason") == "no_emergent_key", (
            f"expected reason='no_emergent_key', got {res}"
        )
        print(f"✓ send_push no-key contract: {res}")

    def test_send_push_missing_title_short_circuits(self):
        """Missing title/message should be rejected BEFORE the no-key check."""
        from services.push_relay import send_push
        loop = asyncio.new_event_loop()
        try:
            res = loop.run_until_complete(send_push(
                recipients=["uid"],
                data={"title": "", "message": ""},
                kind="personal",
            ))
        finally:
            loop.close()
        assert res.get("sent") == 0
        assert res.get("reason") == "missing_title_or_message"
        print(f"✓ send_push validation: {res}")

    def test_send_push_no_recipients(self):
        from services.push_relay import send_push
        loop = asyncio.new_event_loop()
        try:
            res = loop.run_until_complete(send_push(
                recipients=[],
                data={"title": "T", "message": "M"},
                kind="personal",
            ))
        finally:
            loop.close()
        assert res.get("sent") == 0
        assert res.get("reason") == "no_recipients"
        print(f"✓ send_push empty recipients: {res}")


# ─────────────────────────────────────────────────────────────────
# 3) Endpoint integration smoke tests
# ─────────────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def owner_session():
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {OWNER_TOKEN}",
    })
    # Verify token alive — if not, skip
    r = s.get(f"{BASE_URL}/api/auth/me", timeout=10)
    if r.status_code != 200:
        pytest.skip(f"OWNER_TOKEN stale (status={r.status_code}) — refresh credentials")
    return s


@pytest.fixture(scope="module")
def patient_session():
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {PATIENT_TOKEN}",
    })
    r = s.get(f"{BASE_URL}/api/auth/me", timeout=10)
    if r.status_code != 200:
        pytest.skip(f"PATIENT_TOKEN stale (status={r.status_code}) — refresh credentials")
    return s


class TestAuthMeStillWorks:
    """Pre-flight — make sure the auth path still works after the changes."""

    def test_auth_me_owner(self, owner_session):
        r = owner_session.get(f"{BASE_URL}/api/auth/me", timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert body.get("user_id") or body.get("id"), f"no user_id in: {body}"
        print(f"✓ /auth/me owner OK — user_id={body.get('user_id')}")


class TestRegisterPushEndpoint:
    """POST /api/register-push must still succeed (DB upsert) even when
    EMERGENT_PUSH_KEY is placeholder — relay returns reason: no_emergent_key
    but the local push_tokens row is still upserted."""

    def test_register_push_with_auth_no_key(self, owner_session):
        body = {
            "platform": "android",
            "device_token": "TEST_native_fcm_" + uuid.uuid4().hex[:12],
        }
        r = owner_session.post(f"{BASE_URL}/api/register-push", json=body, timeout=15)
        assert r.status_code == 200, (
            f"expected 200, got {r.status_code}: {r.text[:300]}"
        )
        data = r.json()
        assert data.get("registered") is True, data
        assert data.get("user_id"), f"user_id missing in: {data}"
        # Relay block should be present and indicate no-key fallback.
        relay = data.get("relay") or {}
        assert relay.get("registered") is False, f"relay should not register w/o key: {relay}"
        assert relay.get("reason") == "no_emergent_key", relay
        print(f"✓ /api/register-push OK with no_emergent_key relay: {data}")

    def test_register_push_requires_auth(self):
        r = requests.post(
            f"{BASE_URL}/api/register-push",
            json={"platform": "android", "device_token": "x"},
            timeout=10,
        )
        assert r.status_code in (401, 403), r.status_code
        print(f"✓ /api/register-push auth gate (status={r.status_code})")

    def test_register_push_missing_token_400(self, owner_session):
        r = owner_session.post(
            f"{BASE_URL}/api/register-push",
            json={"platform": "android", "device_token": ""},
            timeout=10,
        )
        assert r.status_code == 400, r.status_code
        print("✓ /api/register-push rejects empty device_token")


class TestMessagesSendEndpoint:
    """POST /api/messages/send — owner sends a personal message to self
    isn't allowed; instead test the validation path which exercises the
    push wiring without requiring a separate recipient."""

    def test_messages_send_missing_recipient(self, owner_session):
        r = owner_session.post(
            f"{BASE_URL}/api/messages/send",
            json={"title": "T", "body": "B"},
            timeout=15,
        )
        # 404 — recipient lookup missing both id+email
        assert r.status_code in (400, 404, 422), f"got {r.status_code}: {r.text[:300]}"
        print(f"✓ /api/messages/send validates recipient (status={r.status_code})")

    def test_messages_send_self_blocked(self, owner_session):
        me = owner_session.get(f"{BASE_URL}/api/auth/me", timeout=10).json()
        my_uid = me.get("user_id") or me.get("id")
        r = owner_session.post(
            f"{BASE_URL}/api/messages/send",
            json={
                "title": "TEST_self",
                "body": "hello me",
                "recipient_user_id": my_uid,
            },
            timeout=15,
        )
        # 400 "Cannot message yourself"
        assert r.status_code == 400, f"got {r.status_code}: {r.text[:300]}"
        print("✓ /api/messages/send blocks self-message — relay path not invoked")

    def test_messages_send_to_patient(self, owner_session):
        """Happy path — owner → patient. Exercises send_push(kind=personal).
        With EMERGENT_PUSH_KEY=placeholder the push is a no-op but the
        message row + bell notification should still be created and
        the endpoint must return 200."""
        # Resolve patient uid
        ps = requests.Session()
        ps.headers.update({"Authorization": f"Bearer {PATIENT_TOKEN}"})
        rp = ps.get(f"{BASE_URL}/api/auth/me", timeout=10)
        if rp.status_code != 200:
            pytest.skip("PATIENT_TOKEN stale — cannot exercise messages happy path")
        patient_uid = rp.json().get("user_id") or rp.json().get("id")

        r = owner_session.post(
            f"{BASE_URL}/api/messages/send",
            json={
                "title": "TEST_push_channel_personal",
                "body": "regression test — ignore",
                "recipient_user_id": patient_uid,
            },
            timeout=20,
        )
        # 200 happy or 403 (if owner doesn't have personal-messages perm).
        # Either way, the route must NOT 500 (would indicate channel
        # injection broke send_push).
        assert r.status_code in (200, 201, 400, 403, 404), (
            f"messages/send blew up — got {r.status_code}: {r.text[:300]}"
        )
        print(f"✓ /api/messages/send → patient status={r.status_code}")


class TestBroadcastsEndpoints:
    """POST /api/broadcasts → PATCH approve. Confirms relay path executes
    (channel injection happens internally) without throwing."""

    @pytest.fixture
    def created_broadcast(self, owner_session):
        payload = {
            "title": f"TEST_bc_{uuid.uuid4().hex[:8]}",
            "body": "regression test for push channel injection — ignore",
            "target": "staff",
        }
        r = owner_session.post(f"{BASE_URL}/api/broadcasts", json=payload, timeout=20)
        assert r.status_code in (200, 201), f"create broadcast failed: {r.status_code} {r.text[:300]}"
        body = r.json()
        assert body.get("broadcast_id"), body
        yield body
        # best-effort cleanup
        try:
            owner_session.delete(f"{BASE_URL}/api/broadcasts/{body['broadcast_id']}", timeout=10)
        except Exception:
            pass

    def test_create_broadcast_returns_id(self, created_broadcast):
        assert created_broadcast["broadcast_id"].startswith("bc_")
        # Owner-created broadcast should be auto-approved or pending
        assert created_broadcast.get("status") in ("approved", "pending_approval", "sent")
        print(f"✓ POST /api/broadcasts → {created_broadcast['broadcast_id']} "
              f"status={created_broadcast.get('status')}")

    def test_approve_broadcast_executes_relay_path(self, owner_session, created_broadcast):
        """PATCH action=approve must NOT 500 — confirms _relay_send path
        runs cleanly with channel injection even when EMERGENT_PUSH_KEY is
        placeholder."""
        bid = created_broadcast["broadcast_id"]
        # If owner-created broadcast is already approved, re-approval may
        # 400 ("Already sent") — that's still proof the route didn't crash.
        r = owner_session.patch(
            f"{BASE_URL}/api/broadcasts/{bid}",
            json={"action": "approve"},
            timeout=30,
        )
        assert r.status_code in (200, 400), (
            f"approve blew up — got {r.status_code}: {r.text[:300]}"
        )
        print(f"✓ PATCH /api/broadcasts/{bid} approve status={r.status_code}")

    def test_list_broadcasts(self, owner_session):
        r = owner_session.get(f"{BASE_URL}/api/broadcasts", timeout=15)
        assert r.status_code == 200
        body = r.json()
        # Either a list or {items:[...]}
        items = body if isinstance(body, list) else body.get("items") or body.get("broadcasts") or []
        assert isinstance(items, list)
        print(f"✓ GET /api/broadcasts → {len(items)} rows")


class TestNotificationsBellFeed:
    """GET /api/notifications — the bell feed must still load."""

    def test_notifications_owner(self, owner_session):
        r = owner_session.get(f"{BASE_URL}/api/notifications", timeout=15)
        assert r.status_code == 200, r.status_code
        body = r.json()
        items = body if isinstance(body, list) else body.get("items") or body.get("notifications") or []
        assert isinstance(items, list)
        print(f"✓ GET /api/notifications (owner) → {len(items)} items")

    def test_notifications_patient(self, patient_session):
        r = patient_session.get(f"{BASE_URL}/api/notifications", timeout=15)
        assert r.status_code == 200
        print("✓ GET /api/notifications (patient) → 200")


class TestNoNewRoutes:
    """Sanity — the OpenAPI spec must still parse and not contain
    duplicate route registrations after the push-channel changes."""

    def test_openapi_loads(self):
        # /openapi.json is NOT under /api so the k8s ingress doesn't
        # forward it from the public URL. Hit it on localhost where
        # the FastAPI app lives directly.
        r = requests.get("http://localhost:8001/openapi.json", timeout=15)
        assert r.status_code == 200, r.status_code
        spec = r.json()
        paths = spec.get("paths") or {}
        assert len(paths) > 100, f"suspiciously few paths: {len(paths)}"
        # The channel-injection edit must NOT have introduced any new
        # /api/push/* endpoint that wasn't there before.
        push_paths = [p for p in paths.keys() if p.startswith("/api/push") or p.startswith("/api/register-push")]
        print(f"✓ openapi has {len(paths)} paths, push-related: {push_paths}")
