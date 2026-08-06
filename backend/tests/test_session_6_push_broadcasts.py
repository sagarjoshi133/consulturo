"""Session 6 bug-fix regression tests.

Covers:
  - POST /api/push/test   — no_tokens / expo_direct_fallback transport
  - GET  /api/push/diagnostics — users array + transport/token_preview
  - POST /api/broadcasts  — must not 500 (relay-with-fallback refactor)
  - GET  /api/broadcasts  — returns the just-created broadcast
  - Quick regression:
      GET /api/diseases    (public, 200 array)
      GET /api/auth/me
      GET /api/bookings/all
      GET /api/records/me
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "https://urology-pro.preview.emergentagent.com").rstrip("/")
OWNER_TOKEN = "test_session_1781009714553"
HEADERS = {"Authorization": f"Bearer {OWNER_TOKEN}", "Content-Type": "application/json"}


# ─────────────────── push: /api/push/test ───────────────────
class TestPushTest:
    def test_push_test_owner_no_tokens_fallback(self):
        r = requests.post(f"{BASE_URL}/api/push/test", headers=HEADERS, timeout=60)
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text[:300]}"
        data = r.json()
        # In preview env: EMERGENT_PUSH_KEY is placeholder → fallback path.
        # If owner has no native device tokens registered → reason=no_tokens
        assert data.get("ok") is False, f"ok should be False, got {data}"
        assert data.get("transport") == "expo_direct_fallback", f"transport mismatch: {data}"
        assert data.get("reason") == "no_tokens", f"reason mismatch: {data}"
        msg = (data.get("message") or "").lower()
        assert ("preview" in msg) or ("emergent_push_key" in msg) or ("deployed" in msg), \
            f"message must mention preview/EMERGENT_PUSH_KEY/deployed: {data.get('message')}"


# ─────────────────── push: /api/push/diagnostics ───────────────────
class TestPushDiagnostics:
    def test_push_diagnostics_owner_returns_users_array(self):
        r = requests.get(f"{BASE_URL}/api/push/diagnostics", headers=HEADERS, timeout=30)
        assert r.status_code == 200, f"got {r.status_code}: {r.text[:300]}"
        data = r.json()
        assert "users" in data, f"missing users key: {list(data.keys())}"
        assert isinstance(data["users"], list)
        # Token entries — if any exist — MUST expose transport + token_preview
        for u in data["users"]:
            assert "tokens" in u
            for t in u.get("tokens") or []:
                assert "transport" in t, f"token row missing transport: {t}"
                assert "token_preview" in t, f"token row missing token_preview: {t}"
                # transport should be populated string
                assert isinstance(t["transport"], str) and t["transport"], \
                    f"transport empty for token: {t}"
                # token_preview populated (at minimum the ellipsis suffix)
                assert isinstance(t["token_preview"], str) and len(t["token_preview"]) >= 1


# ─────────────────── broadcasts: /api/broadcasts ───────────────────
class TestBroadcasts:
    created_id = None

    def test_create_broadcast_does_not_500(self):
        payload = {"title": "TEST_ Session6 broadcast", "body": "hello", "target": "staff"}
        r = requests.post(f"{BASE_URL}/api/broadcasts", headers=HEADERS, json=payload, timeout=30)
        assert r.status_code < 500, f"5xx server error: {r.status_code} {r.text[:400]}"
        assert r.status_code in (200, 201), f"unexpected status {r.status_code}: {r.text[:400]}"
        data = r.json()
        # store id for follow-up GET
        bid = data.get("broadcast_id") or data.get("id") or (data.get("broadcast") or {}).get("id")
        TestBroadcasts.created_id = bid
        assert bid, f"broadcast id missing from response: {data}"

    def test_list_broadcasts_contains_new_one(self):
        # small delay to let any async hooks complete
        time.sleep(1)
        r = requests.get(f"{BASE_URL}/api/broadcasts", headers=HEADERS, timeout=30)
        assert r.status_code == 200, f"got {r.status_code}: {r.text[:300]}"
        data = r.json()
        # accept list-of-broadcasts or {items:[...]}
        items = data if isinstance(data, list) else (data.get("items") or data.get("broadcasts") or [])
        assert isinstance(items, list), f"unexpected shape: {data}"
        if TestBroadcasts.created_id:
            ids = [b.get("broadcast_id") or b.get("id") for b in items]
            assert TestBroadcasts.created_id in ids, \
                f"created broadcast {TestBroadcasts.created_id} not in list (ids: {ids[:10]})"


# ─────────────────── Quick regression ───────────────────
class TestQuickRegression:
    def test_public_diseases(self):
        r = requests.get(f"{BASE_URL}/api/diseases", timeout=30)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:200]}"
        data = r.json()
        # accept list or {diseases:[...]}
        items = data if isinstance(data, list) else (data.get("diseases") or data.get("items") or [])
        assert isinstance(items, list) and len(items) > 0, f"diseases empty/wrong shape: {data}"

    def test_auth_me(self):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=HEADERS, timeout=30)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:200]}"
        data = r.json()
        assert data.get("email"), f"no email on /auth/me: {data}"

    def test_bookings_all(self):
        r = requests.get(f"{BASE_URL}/api/bookings/all", headers=HEADERS, timeout=30)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:200]}"

    def test_records_me(self):
        r = requests.get(f"{BASE_URL}/api/records/me", headers=HEADERS, timeout=30)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:200]}"
