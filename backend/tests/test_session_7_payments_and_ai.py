"""Session 7 backend verification tests.

Covers the 3 areas requested in the review:
  1. AI discharge-field endpoint (Claude Sonnet 4.5) for every valid field.
  2. Razorpay config / order / verify endpoints.
  3. Backend stability: /api/health, /api/ipd/admissions, /api/auth/me.

Run against the public preview URL (EXPO_PUBLIC_BACKEND_URL) using the
seeded owner session token from /app/memory/test_credentials.md.
"""
from __future__ import annotations

import os
import pytest
import requests

BASE_URL = (
    os.environ.get("EXPO_BACKEND_URL")
    or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or "https://urology-pro.preview.emergentagent.com"
).rstrip("/")
OWNER_TOKEN = "test_session_1781009714553"  # Dr. Sagar Joshi (primary_owner)
ADMISSION_ID = "c972c9c9-8771-495b-a76c-faed56be80f1"  # IPD260609001 (Sagar P)

LLM_TIMEOUT = 120  # Claude can take ~30-60s on large IPD contexts.

VALID_FIELDS = [
    "course_in_hospital",
    "condition_at_discharge",
    "discharge_meds",
    "diet_advice",
    "follow_up_plan",
    "operative_notes",
]


# ── Fixtures ─────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def auth_session():
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {OWNER_TOKEN}",
    })
    return s


@pytest.fixture(scope="module")
def anon_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ── 1. Stability / regression ────────────────────────────────────


class TestBackendStability:

    def test_health(self, anon_session):
        r = anon_session.get(f"{BASE_URL}/api/health", timeout=10)
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        assert body.get("ok") is True
        assert body.get("db") == "connected"

    def test_auth_me_with_owner_token(self, auth_session):
        r = auth_session.get(f"{BASE_URL}/api/auth/me", timeout=10)
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        assert body.get("email") == "sagar.joshi133@gmail.com"
        assert body.get("role") in {"primary_owner", "owner", "super_owner"}

    def test_ipd_admissions_list(self, auth_session):
        r = auth_session.get(f"{BASE_URL}/api/ipd/admissions?limit=5", timeout=15)
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        items = body.get("items") if isinstance(body, dict) else body
        assert isinstance(items, list), f"unexpected payload shape: {body}"
        # Seeded admission should still be reachable
        ids = [x.get("id") for x in items]
        assert ADMISSION_ID in ids, f"seeded admission missing; got ids={ids}"


# ── 2. Razorpay payment endpoints ────────────────────────────────


class TestRazorpay:

    def test_config_enabled_in_test_mode(self, anon_session):
        r = anon_session.get(f"{BASE_URL}/api/payments/razorpay/config", timeout=10)
        assert r.status_code == 200, r.text[:300]
        cfg = r.json()
        assert cfg.get("enabled") is True, f"Razorpay should be enabled: {cfg}"
        assert cfg.get("mode") == "test", f"expected test mode: {cfg}"
        key_id = cfg.get("key_id") or ""
        assert key_id.startswith("rzp_test_"), f"unexpected key_id: {key_id}"
        assert cfg.get("currency") == "INR"
        assert "upi" in (cfg.get("supports") or [])

    def test_order_create_returns_valid_order(self, auth_session):
        payload = {
            "amount_inr": 1.00,
            "target_kind": "other",
            "description": "TEST_session7 razorpay order",
        }
        r = auth_session.post(
            f"{BASE_URL}/api/payments/razorpay/order",
            json=payload,
            timeout=20,
        )
        assert r.status_code == 200, f"order create failed: {r.status_code} {r.text[:400]}"
        body = r.json()
        assert body.get("ok") is True
        assert body.get("order_id", "").startswith("order_"), body
        assert body.get("local_id", "").startswith("pay_"), body
        assert body.get("amount") == 100  # paise
        assert body.get("amount_inr") == 1.0
        assert body.get("currency") == "INR"
        assert (body.get("key_id") or "").startswith("rzp_test_")
        assert body.get("mode") == "test"
        # Prefill should echo owner info
        prefill = body.get("prefill") or {}
        assert prefill.get("email") == "sagar.joshi133@gmail.com"

    def test_order_create_requires_auth(self, anon_session):
        r = anon_session.post(
            f"{BASE_URL}/api/payments/razorpay/order",
            json={"amount_inr": 1.0, "target_kind": "other"},
            timeout=10,
        )
        assert r.status_code in (401, 403), f"unauth should be 401/403, got {r.status_code}"

    def test_order_create_rejects_tiny_amount(self, auth_session):
        r = auth_session.post(
            f"{BASE_URL}/api/payments/razorpay/order",
            json={"amount_inr": 0.001, "target_kind": "other"},
            timeout=10,
        )
        # Either Pydantic 422 (gt=0 + below ₹1) or 400 from our explicit guard.
        assert r.status_code in (400, 422), r.text[:300]

    def test_verify_rejects_bad_signature(self, auth_session):
        """The signature-validation path must return 400 for a forged sig."""
        bogus = {
            "razorpay_order_id": "order_FAKE_doesnotexist",
            "razorpay_payment_id": "pay_FAKE_doesnotexist",
            "razorpay_signature": "deadbeef" * 8,
        }
        r = auth_session.post(
            f"{BASE_URL}/api/payments/razorpay/verify",
            json=bogus,
            timeout=15,
        )
        assert r.status_code == 400, f"expected 400 invalid signature, got {r.status_code}: {r.text[:300]}"
        assert "signature" in (r.json().get("detail") or "").lower()


# ── 3. AI discharge-field generation (all 6 fields) ──────────────


def _post_field(session, field, admission_id=ADMISSION_ID, extra_hint=None):
    url = f"{BASE_URL}/api/ai/ipd/{admission_id}/discharge-field"
    payload = {"field": field}
    if extra_hint is not None:
        payload["extra_hint"] = extra_hint
    return session.post(url, json=payload, timeout=LLM_TIMEOUT)


class TestAIDischargeField:

    @pytest.mark.parametrize("field", VALID_FIELDS)
    def test_each_valid_field_returns_text(self, auth_session, field):
        r = _post_field(auth_session, field)
        # Sanity check: never an HTML body (Cloudflare 5xx / proxy error pages).
        ctype = r.headers.get("content-type", "")
        assert "application/json" in ctype, (
            f"[{field}] expected JSON response but got content-type={ctype!r} "
            f"status={r.status_code} body[:300]={r.text[:300]}"
        )
        assert r.status_code == 200, f"[{field}] {r.status_code}: {r.text[:400]}"
        data = r.json()
        assert data.get("field") == field
        assert data.get("model") == "claude-sonnet-4-5"
        text = (data.get("text") or "").strip()
        assert text, f"[{field}] empty AI text"
        assert len(text) >= 30, f"[{field}] suspiciously short text: {text!r}"

    def test_invalid_field_returns_400(self, auth_session):
        r = _post_field(auth_session, "garbage_field_xyz")
        assert r.status_code == 400, r.text[:300]
        assert "unknown field" in (r.json().get("detail") or "").lower()

    def test_unknown_admission_returns_404(self, auth_session):
        r = _post_field(
            auth_session, "course_in_hospital",
            admission_id="admission-does-not-exist-zzz",
        )
        assert r.status_code == 404, r.text[:300]

    def test_requires_auth(self, anon_session):
        r = anon_session.post(
            f"{BASE_URL}/api/ai/ipd/{ADMISSION_ID}/discharge-field",
            json={"field": "course_in_hospital"},
            timeout=15,
        )
        assert r.status_code in (401, 403), r.text[:300]
