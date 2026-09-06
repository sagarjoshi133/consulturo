"""Iteration 39 — verify:
  · item 15: /api/auth/me can_send_personal_messages semantics + gate.
  · item  7: GET /api/bookings/{id} last-10-digit phone ownership.

Run: pytest backend/tests/test_iteration39_messaging_and_booking_ownership.py -v
"""
import os
import re
import time
import uuid
import requests
import pytest

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://urology-pro.preview.emergentagent.com").rstrip("/")

OWNER_TOKEN = "test_session_1781800271528"
# patient with phone '9876543210', no explicit flag → default TRUE
PATIENT_TOKEN_DEFAULT = "pat_session_1781803137372"
PATIENT_UID_DEFAULT = "test-patient-1776494002311"
# patient with can_send_personal_messages=False → revoked
PATIENT_TOKEN_REVOKED = "sagar_p_session_1781806225518"


def _hdr(tok: str):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ── item 15: /auth/me flag + capability ─────────────────────────
class TestAuthMeMessagingFlag:
    def test_owner_can_send_true(self):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=_hdr(OWNER_TOKEN), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("role") in ("primary_owner", "owner", "super_owner", "partner")
        assert body.get("can_send_personal_messages") is True

    def test_patient_default_true(self):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=_hdr(PATIENT_TOKEN_DEFAULT), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("role") == "patient"
        # No explicit flag stored → default true.
        assert body.get("can_send_personal_messages") is True, body

    def test_patient_revoked_false(self):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=_hdr(PATIENT_TOKEN_REVOKED), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("role") == "patient"
        assert body.get("can_send_personal_messages") is False, body


# ── item 15: capability gate — via /api/messages/recipients ─────
# NOTE: The legacy POST /api/messages/send returns 410 (Comm-V2 cutover
# removed it BEFORE the capability gate runs). We instead exercise
# `_can_send_personal_messages(user)` through /api/messages/recipients,
# which is the surviving legacy endpoint that shares the exact same gate.
class TestMessagingSendGate:
    def _recipients(self, token):
        return requests.get(
            f"{BASE_URL}/api/messages/recipients?scope=team", headers=_hdr(token), timeout=15
        )

    def test_owner_not_gated(self):
        r = self._recipients(OWNER_TOKEN)
        assert r.status_code == 200, r.text

    def test_default_patient_not_gated(self):
        r = self._recipients(PATIENT_TOKEN_DEFAULT)
        assert r.status_code == 200, r.text
        # Default-true patient should get a list (may be empty but not gated).
        assert "items" in r.json()

    def test_revoked_patient_is_gated(self):
        r = self._recipients(PATIENT_TOKEN_REVOKED)
        assert r.status_code == 403, r.text
        detail = (r.json() or {}).get("detail", "")
        assert "personal messages" in detail.lower(), detail

    def test_legacy_send_is_retired(self):
        """Sanity check — legacy send endpoint returns 410 for everyone."""
        payload = {"recipient_user_id": "user_4775ed40276e",
                   "title": "x", "body": "y"}
        r = requests.post(f"{BASE_URL}/api/messages/send",
                          headers=_hdr(PATIENT_TOKEN_DEFAULT),
                          json=payload, timeout=15)
        assert r.status_code == 410, r.text


# ── item 7: /api/bookings/{id} last-10 phone ownership ──────────
@pytest.fixture(scope="module")
def booking_with_prefixed_phone():
    """Create a booking with patient_phone '+919876543210'. The default
    patient (phone stored as '9876543210') should be able to fetch it
    only if the last-10-digit compare works."""
    tomorrow = time.strftime("%Y-%m-%d", time.gmtime(time.time() + 3 * 86400))
    payload = {
        "patient_name": f"TEST_LastTen_{uuid.uuid4().hex[:6]}",
        "patient_phone": "+919876543210",
        "country_code": "+91",
        "patient_age": 40,
        "patient_gender": "male",
        "reason": "TEST_last10_ownership",
        "booking_date": tomorrow,
        "booking_time": "10:30",
        "mode": "in_person",
        "patient_email": "patient.test@consulturo.app",
    }
    r = requests.post(f"{BASE_URL}/api/bookings", json=payload, timeout=20)
    assert r.status_code == 200, r.text
    bid = r.json()["booking_id"]
    yield bid
    # teardown — owner deletes it.
    try:
        requests.delete(f"{BASE_URL}/api/bookings/{bid}", headers=_hdr(OWNER_TOKEN), timeout=10)
    except Exception:
        pass


class TestBookingLast10Ownership:
    def test_patient_can_fetch_own_by_last10(self, booking_with_prefixed_phone):
        bid = booking_with_prefixed_phone
        r = requests.get(f"{BASE_URL}/api/bookings/{bid}", headers=_hdr(PATIENT_TOKEN_DEFAULT), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["booking_id"] == bid
        # confirm the mismatch that used to fail: stored phone vs booking phone.
        assert body.get("patient_phone", "").endswith("9876543210")

    def test_other_patient_still_blocked(self, booking_with_prefixed_phone):
        bid = booking_with_prefixed_phone
        r = requests.get(f"{BASE_URL}/api/bookings/{bid}", headers=_hdr(PATIENT_TOKEN_REVOKED), timeout=15)
        # Sagar-P phone (9099985459) does NOT match 9876543210 → 403.
        assert r.status_code == 403, r.text

    def test_staff_can_fetch_any(self, booking_with_prefixed_phone):
        bid = booking_with_prefixed_phone
        r = requests.get(f"{BASE_URL}/api/bookings/{bid}", headers=_hdr(OWNER_TOKEN), timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["booking_id"] == bid

    def test_anonymous_phone_query_still_works(self, booking_with_prefixed_phone):
        bid = booking_with_prefixed_phone
        r = requests.get(f"{BASE_URL}/api/bookings/{bid}", params={"phone": "9876543210"}, timeout=15)
        assert r.status_code == 200, r.text

    def test_anonymous_wrong_phone_403(self, booking_with_prefixed_phone):
        bid = booking_with_prefixed_phone
        r = requests.get(f"{BASE_URL}/api/bookings/{bid}", params={"phone": "1111111111"}, timeout=15)
        assert r.status_code == 403, r.text
