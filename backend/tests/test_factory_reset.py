"""ConsultUro — Factory Reset endpoint tests.

Covers:
- /api/admin/factory-reset/request-otp authorization (owner allowed,
  doctor/patient/unauth blocked) and OTP row emission.
- /api/admin/factory-reset/execute clinic-name mismatch, missing OTP,
  wrong OTP (attempts increment), happy path with per-clinic scoping
  guard and preserved collections check.

The router is registered from server.py
(`from routers.factory_reset import router as _factory_reset_router`).
All tests seed their own data (prefixed with `TEST_` / `clinic_test_*`)
and clean up afterwards.
"""
import os
import time
import uuid
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "https://urology-pro.preview.emergentagent.com").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "consulturo")

_client = MongoClient(MONGO_URL)
_db = _client[DB_NAME]

# ---- Per-suite seeded data ---------------------------------------------------
# We create:
#   - owner user (primary_owner) bound to clinic A, with a fresh session
#   - doctor user (clinic A), separate session for 403 checks
#   - clinic_settings docs for both clinics (with a `clinic_name`)
#   - a few patient + prescription docs in BOTH clinics so we can prove
#     that wiping clinic A does NOT touch clinic B
CLINIC_A = f"clinic_test_a_{uuid.uuid4().hex[:8]}"
CLINIC_B = f"clinic_test_b_{uuid.uuid4().hex[:8]}"
CLINIC_A_NAME = f"TEST Clinic A {uuid.uuid4().hex[:6]}"
CLINIC_B_NAME = f"TEST Clinic B {uuid.uuid4().hex[:6]}"

OWNER_UID = f"TEST_owner_{uuid.uuid4().hex[:8]}"
OWNER_EMAIL = f"TEST_owner_{uuid.uuid4().hex[:6]}@example.com"
OWNER_TOKEN = f"TEST_factoryreset_owner_{uuid.uuid4().hex[:12]}"

DOCTOR_UID = f"TEST_doc_{uuid.uuid4().hex[:8]}"
DOCTOR_EMAIL = f"TEST_doc_{uuid.uuid4().hex[:6]}@example.com"
DOCTOR_TOKEN = f"TEST_factoryreset_doc_{uuid.uuid4().hex[:12]}"


def _now():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc)


def _expiry():
    from datetime import datetime, timezone, timedelta
    return datetime.now(timezone.utc) + timedelta(days=1)


@pytest.fixture(scope="module", autouse=True)
def _seed_and_teardown():
    # ---- seed --------------------------------------------------------------
    _db.users.insert_one({
        "user_id": OWNER_UID,
        "email": OWNER_EMAIL,
        "name": "TEST Owner",
        "role": "primary_owner",
        "clinic_id": CLINIC_A,
        "created_at": _now(),
    })
    _db.users.insert_one({
        "user_id": DOCTOR_UID,
        "email": DOCTOR_EMAIL,
        "name": "TEST Doctor",
        "role": "doctor",
        "clinic_id": CLINIC_A,
        "created_at": _now(),
    })
    _db.user_sessions.insert_one({
        "user_id": OWNER_UID,
        "session_token": OWNER_TOKEN,
        "expires_at": _expiry(),
        "created_at": _now(),
    })
    _db.user_sessions.insert_one({
        "user_id": DOCTOR_UID,
        "session_token": DOCTOR_TOKEN,
        "expires_at": _expiry(),
        "created_at": _now(),
    })
    _db.clinic_settings.insert_one({
        "clinic_id": CLINIC_A,
        "clinic_name": CLINIC_A_NAME,
        "_test_marker": "factory_reset_suite",
    })
    _db.clinic_settings.insert_one({
        "clinic_id": CLINIC_B,
        "clinic_name": CLINIC_B_NAME,
        "_test_marker": "factory_reset_suite",
    })
    # seed wipeable docs in both clinics
    for cid in (CLINIC_A, CLINIC_B):
        for i in range(3):
            _db.patients.insert_one({
                "clinic_id": cid,
                "name": f"TEST patient {cid} {i}",
                "_test_marker": "factory_reset_suite",
            })
            _db.prescriptions.insert_one({
                "clinic_id": cid,
                "patient_name": f"TEST pres {cid} {i}",
                "_test_marker": "factory_reset_suite",
            })
            _db.bookings.insert_one({
                "clinic_id": cid,
                "slot": f"2026-01-01T10:0{i}:00Z",
                "_test_marker": "factory_reset_suite",
            })
    # preserved-collections: drop a marker doc per clinic; should survive
    _db.availability.insert_one({
        "clinic_id": CLINIC_A,
        "_test_marker": "factory_reset_suite",
        "tag": "AVAIL_A",
    })

    yield

    # ---- teardown ----------------------------------------------------------
    _db.users.delete_many({"user_id": {"$in": [OWNER_UID, DOCTOR_UID]}})
    _db.user_sessions.delete_many({"session_token": {"$in": [OWNER_TOKEN, DOCTOR_TOKEN]}})
    _db.clinic_settings.delete_many({"clinic_id": {"$in": [CLINIC_A, CLINIC_B]}})
    _db.auth_otp_codes.delete_many({"email": OWNER_EMAIL})
    for coll in (
        "patients", "prescriptions", "bookings", "availability",
        "audit_log",
    ):
        try:
            _db[coll].delete_many({"_test_marker": "factory_reset_suite"})
        except Exception:
            pass
        try:
            _db[coll].delete_many({"clinic_id": {"$in": [CLINIC_A, CLINIC_B]}})
        except Exception:
            pass


def _h(token=None):
    h = {"Content-Type": "application/json"}
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


# ============================================================================
# request-otp authorization
# ============================================================================

class TestRequestOtpAuth:
    """request-otp gate: only owner-tier roles may issue an OTP."""

    def test_unauthenticated_blocked(self):
        r = requests.post(f"{BASE_URL}/api/admin/factory-reset/request-otp",
                          headers=_h(), timeout=10)
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}: {r.text}"

    def test_doctor_blocked_403(self):
        r = requests.post(f"{BASE_URL}/api/admin/factory-reset/request-otp",
                          headers=_h(DOCTOR_TOKEN), timeout=10)
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"

    def test_owner_can_request_otp(self):
        # clear any previous OTPs so we can assert on the new row
        _db.auth_otp_codes.delete_many({"email": OWNER_EMAIL, "purpose": "factory_reset"})

        r = requests.post(f"{BASE_URL}/api/admin/factory-reset/request-otp",
                          headers=_h(OWNER_TOKEN), timeout=20)
        if r.status_code == 502:
            # Email delivery failed (no Resend key / unverified domain in
            # this preview env). Per the agent context note, this is an
            # acceptable outcome — but the OTP row must STILL have been
            # written before _send_email was attempted, so we can use it
            # for the execute flow.
            print("[request-otp] returned 502 (email not delivered) — expected in preview env")
        else:
            assert r.status_code == 200, f"expected 200/502, got {r.status_code}: {r.text}"
            body = r.json()
            assert body.get("ok") is True
            assert body.get("sent_to") == OWNER_EMAIL.lower()

        # Either way, the OTP row must exist (router writes the row BEFORE
        # calling _send_email).
        rec = _db.auth_otp_codes.find_one(
            {"email": OWNER_EMAIL.lower(), "purpose": "factory_reset"}
        )
        assert rec is not None, "auth_otp_codes row should be created with purpose=factory_reset"
        assert isinstance(rec.get("code"), str) and len(rec["code"]) == 6
        assert rec.get("attempts") == 0


# ============================================================================
# execute: clinic-name / OTP / happy path
# ============================================================================

class TestExecuteValidation:
    def test_doctor_blocked_403(self):
        r = requests.post(
            f"{BASE_URL}/api/admin/factory-reset/execute",
            headers=_h(DOCTOR_TOKEN),
            json={"clinic_name": CLINIC_A_NAME, "otp_code": "000000"},
            timeout=10,
        )
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"

    def test_no_pending_otp_returns_400(self):
        # nuke all OTPs for this owner first
        _db.auth_otp_codes.delete_many({"email": OWNER_EMAIL.lower()})
        r = requests.post(
            f"{BASE_URL}/api/admin/factory-reset/execute",
            headers=_h(OWNER_TOKEN),
            json={"clinic_name": CLINIC_A_NAME, "otp_code": "000000"},
            timeout=10,
        )
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"
        assert "No pending confirmation code" in r.text or "no pending" in r.text.lower()

    def test_wrong_clinic_name_returns_400(self):
        # Seed an OTP row directly so the only reason to fail is clinic-name
        _db.auth_otp_codes.delete_many({"email": OWNER_EMAIL.lower()})
        from datetime import timedelta
        _db.auth_otp_codes.insert_one({
            "email": OWNER_EMAIL.lower(),
            "purpose": "factory_reset",
            "code": "123456",
            "expires_at": _now() + timedelta(minutes=10),
            "attempts": 0,
            "created_at": _now(),
        })

        r = requests.post(
            f"{BASE_URL}/api/admin/factory-reset/execute",
            headers=_h(OWNER_TOKEN),
            json={"clinic_name": "Totally Wrong Name", "otp_code": "123456"},
            timeout=10,
        )
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"
        assert "clinic name" in r.text.lower()

    def test_wrong_otp_increments_attempts(self):
        # Re-seed a fresh OTP with attempts=0
        _db.auth_otp_codes.delete_many({"email": OWNER_EMAIL.lower()})
        from datetime import timedelta
        _db.auth_otp_codes.insert_one({
            "email": OWNER_EMAIL.lower(),
            "purpose": "factory_reset",
            "code": "123456",
            "expires_at": _now() + timedelta(minutes=10),
            "attempts": 0,
            "created_at": _now(),
        })

        r = requests.post(
            f"{BASE_URL}/api/admin/factory-reset/execute",
            headers=_h(OWNER_TOKEN),
            json={"clinic_name": CLINIC_A_NAME, "otp_code": "999999"},
            timeout=10,
        )
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"

        rec = _db.auth_otp_codes.find_one(
            {"email": OWNER_EMAIL.lower(), "purpose": "factory_reset"}
        )
        assert rec is not None, "OTP row should still exist after a wrong attempt"
        assert rec.get("attempts", 0) >= 1, f"attempts should be incremented, got {rec.get('attempts')}"


class TestExecuteHappyPath:
    """Full request-otp → execute happy path, with cross-clinic isolation."""

    def test_happy_path_wipes_only_owner_clinic(self):
        # Seed a fresh OTP directly (we know the code) so this test is
        # independent of the email-delivery path. Equivalent to having
        # called request-otp + retrieved code via inbox/db.
        from datetime import timedelta
        _db.auth_otp_codes.delete_many({"email": OWNER_EMAIL.lower()})
        _db.auth_otp_codes.insert_one({
            "email": OWNER_EMAIL.lower(),
            "purpose": "factory_reset",
            "code": "424242",
            "expires_at": _now() + timedelta(minutes=10),
            "attempts": 0,
            "created_at": _now(),
        })

        # Sanity precondition: clinic A & B both have docs
        assert _db.patients.count_documents({"clinic_id": CLINIC_A}) > 0
        assert _db.patients.count_documents({"clinic_id": CLINIC_B}) > 0
        assert _db.prescriptions.count_documents({"clinic_id": CLINIC_A}) > 0
        assert _db.prescriptions.count_documents({"clinic_id": CLINIC_B}) > 0
        clinic_b_patients_before = _db.patients.count_documents({"clinic_id": CLINIC_B})
        clinic_b_rx_before = _db.prescriptions.count_documents({"clinic_id": CLINIC_B})
        clinic_b_book_before = _db.bookings.count_documents({"clinic_id": CLINIC_B})

        r = requests.post(
            f"{BASE_URL}/api/admin/factory-reset/execute",
            headers=_h(OWNER_TOKEN),
            json={"clinic_name": CLINIC_A_NAME, "otp_code": "424242"},
            timeout=30,
        )
        assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text}"
        body = r.json()
        assert body.get("ok") is True
        assert body.get("clinic_id") == CLINIC_A
        assert isinstance(body.get("deleted"), dict)
        assert isinstance(body.get("deleted_total"), int)
        # we seeded 3 patients + 3 prescriptions + 3 bookings = 9 in clinic A
        assert body["deleted_total"] >= 9, body
        assert body["deleted"].get("patients", 0) == 3
        assert body["deleted"].get("prescriptions", 0) == 3
        assert body["deleted"].get("bookings", 0) == 3

        # 1) Clinic A is empty in wipeable collections
        assert _db.patients.count_documents({"clinic_id": CLINIC_A}) == 0
        assert _db.prescriptions.count_documents({"clinic_id": CLINIC_A}) == 0
        assert _db.bookings.count_documents({"clinic_id": CLINIC_A}) == 0

        # 2) Clinic B is UNTOUCHED
        assert _db.patients.count_documents({"clinic_id": CLINIC_B}) == clinic_b_patients_before
        assert _db.prescriptions.count_documents({"clinic_id": CLINIC_B}) == clinic_b_rx_before
        assert _db.bookings.count_documents({"clinic_id": CLINIC_B}) == clinic_b_book_before

        # 3) Preserved collections survive for clinic A
        assert _db.users.find_one({"user_id": OWNER_UID}) is not None, "owner user must survive"
        assert _db.user_sessions.find_one({"session_token": OWNER_TOKEN}) is not None, \
            "owner session must survive (stay logged in)"
        assert _db.clinic_settings.find_one({"clinic_id": CLINIC_A}) is not None
        assert _db.availability.find_one({"clinic_id": CLINIC_A, "tag": "AVAIL_A"}) is not None

        # 4) The OTP row used to authorize this run is consumed
        assert _db.auth_otp_codes.find_one(
            {"email": OWNER_EMAIL.lower(), "purpose": "factory_reset", "code": "424242"}
        ) is None, "OTP row must be burned after a successful execute"

        # 5) preserved_collections list returned to UI
        assert "preserved_collections" in body
        assert "users" in body["preserved_collections"]
        assert "clinic_settings" in body["preserved_collections"]
