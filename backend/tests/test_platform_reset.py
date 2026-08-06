"""ConsultUro — Platform Reset endpoint tests (super_owner ONLY).

Covers:
- /api/admin/platform-reset/request-otp authorization:
    * 200 (or 502 if email delivery fails) for super_owner; OTP row written
      with purpose='platform_reset'.
    * 403 for primary_owner, partner, doctor, patient.
- /api/admin/platform-reset/execute validation:
    * 400 for wrong confirm_phrase (case-sensitive, no trim).
    * 400 when no OTP requested.
    * 400 + attempts++ on wrong OTP code.
    * 400 on expired OTP.
- Happy path: 2 clinics each seeded with patients/prescriptions/bookings.
  After execute, BOTH clinics' operational rows are wiped; preserved
  collections (users, clinic_settings, clinics) survive in BOTH.
  deleted_total > 0; clinics_preserved >= 2.

Mirrors the structure of test_factory_reset.py. All seeded data is
prefixed with `TEST_` / `clinic_test_platreset_*` and cleaned up.
"""
import os
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get(
    "EXPO_BACKEND_URL",
    "https://urology-pro.preview.emergentagent.com",
).rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "consulturo")

_client = MongoClient(MONGO_URL)
_db = _client[DB_NAME]

MARKER = "platform_reset_suite"

# Two test clinics that will both be wiped by the platform reset.
CLINIC_A = f"clinic_test_platreset_a_{uuid.uuid4().hex[:8]}"
CLINIC_B = f"clinic_test_platreset_b_{uuid.uuid4().hex[:8]}"

# Users + sessions: 1 super_owner + several lower-tier roles for 403 checks.
SO_UID = f"TEST_so_{uuid.uuid4().hex[:8]}"
SO_EMAIL = f"TEST_so_{uuid.uuid4().hex[:6]}@example.com"
SO_TOKEN = f"TEST_platreset_so_{uuid.uuid4().hex[:12]}"

PO_UID = f"TEST_po_{uuid.uuid4().hex[:8]}"
PO_EMAIL = f"TEST_po_{uuid.uuid4().hex[:6]}@example.com"
PO_TOKEN = f"TEST_platreset_po_{uuid.uuid4().hex[:12]}"

PART_UID = f"TEST_part_{uuid.uuid4().hex[:8]}"
PART_EMAIL = f"TEST_part_{uuid.uuid4().hex[:6]}@example.com"
PART_TOKEN = f"TEST_platreset_part_{uuid.uuid4().hex[:12]}"

DOC_UID = f"TEST_doc_{uuid.uuid4().hex[:8]}"
DOC_EMAIL = f"TEST_doc_{uuid.uuid4().hex[:6]}@example.com"
DOC_TOKEN = f"TEST_platreset_doc_{uuid.uuid4().hex[:12]}"

PAT_UID = f"TEST_pat_{uuid.uuid4().hex[:8]}"
PAT_EMAIL = f"TEST_pat_{uuid.uuid4().hex[:6]}@example.com"
PAT_TOKEN = f"TEST_platreset_pat_{uuid.uuid4().hex[:12]}"


def _now():
    return datetime.now(timezone.utc)


def _expiry():
    return datetime.now(timezone.utc) + timedelta(days=1)


def _h(token=None):
    h = {"Content-Type": "application/json"}
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


# Track clinics & operational counts that existed BEFORE the run so we can
# verify (a) clinics_preserved >= 2 and (b) other tenant clinics still
# have their `clinics` / `clinic_settings` rows. We cannot guard
# operational data in OTHER tenants (the endpoint is platform-wide), so
# we only assert against the two TEST clinics we own + the preserved
# collections.

PREEXISTING_CLINIC_IDS = []


@pytest.fixture(scope="module", autouse=True)
def _seed_and_teardown():
    # Capture pre-existing clinic ids so teardown does not touch them.
    global PREEXISTING_CLINIC_IDS
    PREEXISTING_CLINIC_IDS = [c.get("clinic_id") for c in _db.clinics.find({}, {"clinic_id": 1})]

    # ---- users + sessions ------------------------------------------------
    _db.users.insert_many([
        {"user_id": SO_UID, "email": SO_EMAIL, "name": "TEST SuperOwner",
         "role": "super_owner", "created_at": _now()},
        {"user_id": PO_UID, "email": PO_EMAIL, "name": "TEST PrimaryOwner",
         "role": "primary_owner", "clinic_id": CLINIC_A, "created_at": _now()},
        {"user_id": PART_UID, "email": PART_EMAIL, "name": "TEST Partner",
         "role": "partner", "clinic_id": CLINIC_A, "created_at": _now()},
        {"user_id": DOC_UID, "email": DOC_EMAIL, "name": "TEST Doctor",
         "role": "doctor", "clinic_id": CLINIC_A, "created_at": _now()},
        {"user_id": PAT_UID, "email": PAT_EMAIL, "name": "TEST Patient",
         "role": "patient", "created_at": _now()},
    ])
    _db.user_sessions.insert_many([
        {"user_id": SO_UID, "session_token": SO_TOKEN, "expires_at": _expiry(), "created_at": _now()},
        {"user_id": PO_UID, "session_token": PO_TOKEN, "expires_at": _expiry(), "created_at": _now()},
        {"user_id": PART_UID, "session_token": PART_TOKEN, "expires_at": _expiry(), "created_at": _now()},
        {"user_id": DOC_UID, "session_token": DOC_TOKEN, "expires_at": _expiry(), "created_at": _now()},
        {"user_id": PAT_UID, "session_token": PAT_TOKEN, "expires_at": _expiry(), "created_at": _now()},
    ])

    # ---- 2 test clinics + clinic_settings -------------------------------
    _db.clinics.insert_many([
        {"clinic_id": CLINIC_A, "name": "TEST Clinic A",
         "slug": f"test-clinic-a-{uuid.uuid4().hex[:8]}", "_test_marker": MARKER},
        {"clinic_id": CLINIC_B, "name": "TEST Clinic B",
         "slug": f"test-clinic-b-{uuid.uuid4().hex[:8]}", "_test_marker": MARKER},
    ])
    _db.clinic_settings.insert_many([
        {"clinic_id": CLINIC_A, "clinic_name": "TEST Clinic A", "_test_marker": MARKER},
        {"clinic_id": CLINIC_B, "clinic_name": "TEST Clinic B", "_test_marker": MARKER},
    ])

    # ---- operational data in both clinics -------------------------------
    for cid in (CLINIC_A, CLINIC_B):
        for i in range(3):
            _db.patients.insert_one({
                "clinic_id": cid,
                "name": f"TEST patient {cid} {i}",
                "_test_marker": MARKER,
            })
            _db.prescriptions.insert_one({
                "clinic_id": cid,
                "patient_name": f"TEST pres {cid} {i}",
                "_test_marker": MARKER,
            })
            _db.bookings.insert_one({
                "clinic_id": cid,
                "slot": f"2026-02-01T10:0{i}:00Z",
                "_test_marker": MARKER,
            })

    yield

    # ---- teardown -------------------------------------------------------
    all_test_emails = [SO_EMAIL.lower(), PO_EMAIL.lower(), PART_EMAIL.lower(),
                       DOC_EMAIL.lower(), PAT_EMAIL.lower()]
    _db.users.delete_many({"user_id": {"$in": [SO_UID, PO_UID, PART_UID, DOC_UID, PAT_UID]}})
    _db.user_sessions.delete_many({"session_token": {"$in": [
        SO_TOKEN, PO_TOKEN, PART_TOKEN, DOC_TOKEN, PAT_TOKEN]}})
    _db.clinics.delete_many({"clinic_id": {"$in": [CLINIC_A, CLINIC_B]}})
    _db.clinic_settings.delete_many({"clinic_id": {"$in": [CLINIC_A, CLINIC_B]}})
    _db.auth_otp_codes.delete_many({"email": {"$in": all_test_emails}})
    for coll in ("patients", "prescriptions", "bookings", "audit_log"):
        try:
            _db[coll].delete_many({"_test_marker": MARKER})
        except Exception:
            pass
        try:
            _db[coll].delete_many({"clinic_id": {"$in": [CLINIC_A, CLINIC_B]}})
        except Exception:
            pass


# ============================================================================
# request-otp authorization
# ============================================================================

class TestRequestOtpAuth:
    """Only super_owner may request a platform-reset OTP."""

    def test_unauthenticated_blocked(self):
        r = requests.post(
            f"{BASE_URL}/api/admin/platform-reset/request-otp",
            headers=_h(), timeout=10,
        )
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}: {r.text}"

    @pytest.mark.parametrize("token,label", [
        (PO_TOKEN, "primary_owner"),
        (PART_TOKEN, "partner"),
        (DOC_TOKEN, "doctor"),
        (PAT_TOKEN, "patient"),
    ])
    def test_non_super_owner_blocked_403(self, token, label):
        r = requests.post(
            f"{BASE_URL}/api/admin/platform-reset/request-otp",
            headers=_h(token), timeout=10,
        )
        assert r.status_code == 403, f"{label}: expected 403, got {r.status_code}: {r.text}"
        assert "super owner" in r.text.lower() or "super_owner" in r.text.lower()

    def test_super_owner_can_request_otp(self):
        # Clear any prior OTPs so we can assert on the new row.
        _db.auth_otp_codes.delete_many({"email": SO_EMAIL.lower(), "purpose": "platform_reset"})

        r = requests.post(
            f"{BASE_URL}/api/admin/platform-reset/request-otp",
            headers=_h(SO_TOKEN), timeout=20,
        )
        # In preview env email delivery may fail -> 502 is acceptable.
        if r.status_code == 502:
            print("[platform-reset request-otp] returned 502 (email not delivered) — acceptable in preview env")
        else:
            assert r.status_code == 200, f"expected 200/502, got {r.status_code}: {r.text}"
            body = r.json()
            assert body.get("ok") is True
            assert body.get("sent_to") == SO_EMAIL.lower()

        # The OTP row must exist either way (router writes BEFORE _send_email).
        rec = _db.auth_otp_codes.find_one(
            {"email": SO_EMAIL.lower(), "purpose": "platform_reset"}
        )
        assert rec is not None, "auth_otp_codes row should be created with purpose=platform_reset"
        assert isinstance(rec.get("code"), str) and len(rec["code"]) == 6
        assert rec.get("attempts") == 0


# ============================================================================
# execute: confirm_phrase / OTP validation
# ============================================================================

class TestExecuteValidation:
    """Authorization + confirm_phrase + OTP validation gates."""

    @pytest.mark.parametrize("token,label", [
        (PO_TOKEN, "primary_owner"),
        (PART_TOKEN, "partner"),
        (DOC_TOKEN, "doctor"),
        (PAT_TOKEN, "patient"),
    ])
    def test_non_super_owner_execute_403(self, token, label):
        r = requests.post(
            f"{BASE_URL}/api/admin/platform-reset/execute",
            headers=_h(token),
            json={"confirm_phrase": "RESET ENTIRE PLATFORM", "otp_code": "000000"},
            timeout=10,
        )
        assert r.status_code == 403, f"{label}: expected 403, got {r.status_code}: {r.text}"

    @pytest.mark.parametrize("phrase", [
        "reset entire platform",       # wrong case
        "RESET ENTIRE PLATFORM ",      # trailing space
        " RESET ENTIRE PLATFORM",      # leading space
        "Reset Entire Platform",       # title-case
        "RESET PLATFORM",              # truncated
        "",                            # would fail pydantic min_length — fine
    ])
    def test_wrong_confirm_phrase_returns_400(self, phrase):
        # Seed a fresh, valid OTP so phrase is the only failing axis.
        _db.auth_otp_codes.delete_many({"email": SO_EMAIL.lower()})
        _db.auth_otp_codes.insert_one({
            "email": SO_EMAIL.lower(),
            "purpose": "platform_reset",
            "code": "111111",
            "expires_at": _now() + timedelta(minutes=10),
            "attempts": 0,
            "created_at": _now(),
        })
        r = requests.post(
            f"{BASE_URL}/api/admin/platform-reset/execute",
            headers=_h(SO_TOKEN),
            json={"confirm_phrase": phrase, "otp_code": "111111"},
            timeout=10,
        )
        # Empty string fails pydantic validation (422); everything else
        # falls through to our explicit 400.
        assert r.status_code in (400, 422), \
            f"phrase={phrase!r}: expected 400/422, got {r.status_code}: {r.text}"

    def test_no_pending_otp_returns_400(self):
        _db.auth_otp_codes.delete_many({"email": SO_EMAIL.lower()})
        r = requests.post(
            f"{BASE_URL}/api/admin/platform-reset/execute",
            headers=_h(SO_TOKEN),
            json={"confirm_phrase": "RESET ENTIRE PLATFORM", "otp_code": "000000"},
            timeout=10,
        )
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"
        assert "no pending" in r.text.lower()

    def test_wrong_otp_increments_attempts(self):
        _db.auth_otp_codes.delete_many({"email": SO_EMAIL.lower()})
        _db.auth_otp_codes.insert_one({
            "email": SO_EMAIL.lower(),
            "purpose": "platform_reset",
            "code": "654321",
            "expires_at": _now() + timedelta(minutes=10),
            "attempts": 0,
            "created_at": _now(),
        })
        r = requests.post(
            f"{BASE_URL}/api/admin/platform-reset/execute",
            headers=_h(SO_TOKEN),
            json={"confirm_phrase": "RESET ENTIRE PLATFORM", "otp_code": "999999"},
            timeout=10,
        )
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"
        rec = _db.auth_otp_codes.find_one(
            {"email": SO_EMAIL.lower(), "purpose": "platform_reset"}
        )
        assert rec is not None, "OTP row must survive a wrong attempt"
        assert rec.get("attempts", 0) >= 1, \
            f"attempts should be incremented, got {rec.get('attempts')}"

    def test_expired_otp_returns_400(self):
        _db.auth_otp_codes.delete_many({"email": SO_EMAIL.lower()})
        _db.auth_otp_codes.insert_one({
            "email": SO_EMAIL.lower(),
            "purpose": "platform_reset",
            "code": "424242",
            # already expired
            "expires_at": _now() - timedelta(minutes=1),
            "attempts": 0,
            "created_at": _now() - timedelta(minutes=15),
        })
        r = requests.post(
            f"{BASE_URL}/api/admin/platform-reset/execute",
            headers=_h(SO_TOKEN),
            json={"confirm_phrase": "RESET ENTIRE PLATFORM", "otp_code": "424242"},
            timeout=10,
        )
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"
        assert "expired" in r.text.lower()


# ============================================================================
# Happy path: cross-tenant wipe
# ============================================================================

class TestExecuteHappyPath:
    """request-otp -> execute end-to-end, asserting both test clinics are
    wiped and preserved tenant-skeleton survives."""

    def test_happy_path_wipes_all_clinics(self):
        # 1. Trigger the real request-otp flow so we exercise the email path
        #    (502 acceptable). Then pull the OTP straight from the DB.
        _db.auth_otp_codes.delete_many({"email": SO_EMAIL.lower()})
        r0 = requests.post(
            f"{BASE_URL}/api/admin/platform-reset/request-otp",
            headers=_h(SO_TOKEN), timeout=20,
        )
        assert r0.status_code in (200, 502), \
            f"request-otp should be 200 or 502 (email fail), got {r0.status_code}: {r0.text}"

        rec = _db.auth_otp_codes.find_one(
            {"email": SO_EMAIL.lower(), "purpose": "platform_reset"}
        )
        assert rec is not None, "OTP row should be present even if email delivery failed"
        otp_code = rec["code"]
        assert len(otp_code) == 6

        # 2. Sanity preconditions: both test clinics have operational rows
        assert _db.patients.count_documents({"clinic_id": CLINIC_A}) > 0
        assert _db.patients.count_documents({"clinic_id": CLINIC_B}) > 0
        assert _db.prescriptions.count_documents({"clinic_id": CLINIC_A}) > 0
        assert _db.prescriptions.count_documents({"clinic_id": CLINIC_B}) > 0
        assert _db.bookings.count_documents({"clinic_id": CLINIC_A}) > 0
        assert _db.bookings.count_documents({"clinic_id": CLINIC_B}) > 0

        # 3. Execute the platform reset.
        r = requests.post(
            f"{BASE_URL}/api/admin/platform-reset/execute",
            headers=_h(SO_TOKEN),
            json={"confirm_phrase": "RESET ENTIRE PLATFORM", "otp_code": otp_code},
            timeout=60,
        )
        assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text}"
        body = r.json()
        assert body.get("ok") is True
        assert isinstance(body.get("deleted"), dict)
        assert isinstance(body.get("deleted_total"), int)
        # At minimum: 3 patients + 3 prescriptions + 3 bookings per clinic × 2 = 18.
        assert body["deleted_total"] >= 18, \
            f"deleted_total should reflect both clinics, got {body['deleted_total']}: {body['deleted']}"

        # 4. BOTH test clinics now have zero operational rows.
        for cid in (CLINIC_A, CLINIC_B):
            assert _db.patients.count_documents({"clinic_id": cid}) == 0, \
                f"patients in {cid} should be wiped"
            assert _db.prescriptions.count_documents({"clinic_id": cid}) == 0, \
                f"prescriptions in {cid} should be wiped"
            assert _db.bookings.count_documents({"clinic_id": cid}) == 0, \
                f"bookings in {cid} should be wiped"

        # 5. Preserved tenant skeleton survives in BOTH clinics:
        for cid in (CLINIC_A, CLINIC_B):
            assert _db.clinics.find_one({"clinic_id": cid}) is not None, \
                f"clinics row for {cid} must survive"
            assert _db.clinic_settings.find_one({"clinic_id": cid}) is not None, \
                f"clinic_settings row for {cid} must survive"

        # Super_owner user + session must survive (still logged in).
        assert _db.users.find_one({"user_id": SO_UID}) is not None
        assert _db.user_sessions.find_one({"session_token": SO_TOKEN}) is not None
        # Other-tier users also survive.
        assert _db.users.find_one({"user_id": PO_UID}) is not None
        assert _db.users.find_one({"user_id": DOC_UID}) is not None

        # 6. clinics_preserved >= 2 (we seeded 2 test clinics, plus any
        # pre-existing tenants on this DB).
        assert body.get("clinics_preserved", 0) >= 2, \
            f"clinics_preserved should be >= 2, got {body.get('clinics_preserved')}"

        # 7. OTP row is consumed after a successful execute.
        assert _db.auth_otp_codes.find_one(
            {"email": SO_EMAIL.lower(), "purpose": "platform_reset", "code": otp_code}
        ) is None, "OTP row must be burned after a successful execute"
