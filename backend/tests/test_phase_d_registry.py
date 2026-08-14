"""Phase D — Canonical patient registry regression tests.

Covers:
  1. Migration bookkeeping — every patients row carries patient_id.
  2. GET  /api/registry/patients search — capability-gated.
  3. POST /api/registry/patients — get-or-create idempotency + reg_no.
  4. GET  /api/registry/patients/{id} — unified profile + history.
  5. Rx creation stamps patient_id (activity-stamping regression).
  6. Merge flow — activity repointed, duplicate flagged + hidden.
  7. patient-db endpoints still work and expose patient_id.
"""
import os
import random
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/app/backend/.env")

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "https://urology-pro.preview.emergentagent.com").rstrip("/")

_client = MongoClient(os.environ["MONGO_URL"])
_db = _client[os.environ.get("DB_NAME", "consulturo")]

_created_tokens = []


def _phone() -> str:
    return "0009" + "".join(random.choices("0123456789", k=6))


def _mint_session(user_filter: dict):
    user = _db.users.find_one(user_filter, {"_id": 0, "user_id": 1})
    if not user:
        return None, None
    token = f"test_session_phase_d_{uuid.uuid4().hex[:12]}"
    _db.user_sessions.insert_one({
        "session_token": token,
        "user_id": user["user_id"],
        "created_at": datetime.now(timezone.utc),
        "expires_at": datetime.now(timezone.utc) + timedelta(hours=2),
    })
    _created_tokens.append(token)
    return token, user["user_id"]


@pytest.fixture(scope="module")
def owner():
    token, uid = _mint_session({"role": "primary_owner", "email": "sagar.joshi133@gmail.com"})
    assert token
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    yield s, uid
    _cleanup()


@pytest.fixture(scope="module")
def patient_session():
    token, uid = _mint_session({"role": "patient"})
    if not token:
        pytest.skip("no patient user")
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    return s, uid


def _cleanup():
    _db.user_sessions.delete_many({"session_token": {"$in": _created_tokens}})
    _db.patients.delete_many({"phone_digits": {"$regex": "^0009"}})
    _db.prescriptions.delete_many({"patient_name": {"$regex": "^TEST_phaseD_"}})
    _db.bookings.delete_many({"patient_name": {"$regex": "^TEST_phaseD_"}})
    _db.notifications.delete_many({"title": {"$regex": "TEST_phaseD_"}})
    _db.notification_inbox.delete_many({"title": {"$regex": "TEST_phaseD_"}})


# ── 1: migration ─────────────────────────────────────────────────────

class TestMigration:
    def test_recorded_once(self):
        rows = list(_db.schema_migrations.find({"name": "003_patient_registry"}))
        assert len(rows) == 1

    def test_all_patients_have_patient_id(self):
        missing = _db.patients.count_documents({"patient_id": {"$exists": False}})
        assert missing == 0, f"{missing} patients rows missing patient_id"

    def test_patient_ids_unique(self):
        pipeline = [
            {"$match": {"patient_id": {"$exists": True}}},
            {"$group": {"_id": "$patient_id", "n": {"$sum": 1}}},
            {"$match": {"n": {"$gt": 1}}},
        ]
        dups = list(_db.patients.aggregate(pipeline))
        assert not dups, f"duplicate patient_ids: {dups}"


# ── 2 + 3: registry search + upsert ─────────────────────────────────

class TestRegistryCrud:
    PHONE = _phone()
    pid = None

    def test_upsert_creates_with_reg_no(self, owner):
        s, _ = owner
        r = s.post(f"{BASE_URL}/api/registry/patients", json={
            "phone": self.PHONE, "name": "TEST_phaseD_ Alpha",
            "gender": "Male", "age": "44",
        }, timeout=20)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
        p = r.json().get("patient") or {}
        assert p.get("patient_id") and p.get("reg_no"), p
        assert p.get("phone_digits") == self.PHONE
        TestRegistryCrud.pid = p["patient_id"]

    def test_upsert_idempotent_same_patient_id(self, owner):
        s, _ = owner
        r = s.post(f"{BASE_URL}/api/registry/patients", json={
            "phone": f"+91{self.PHONE}",  # different format, same identity
            "name": "TEST_phaseD_ Alpha again",
        }, timeout=20)
        assert r.status_code == 200
        assert r.json()["patient"]["patient_id"] == TestRegistryCrud.pid

    def test_search_finds_by_phone(self, owner):
        s, _ = owner
        r = s.get(f"{BASE_URL}/api/registry/patients", params={"q": self.PHONE}, timeout=15)
        assert r.status_code == 200
        ids = [i.get("patient_id") for i in r.json().get("items") or []]
        assert TestRegistryCrud.pid in ids

    def test_registry_capability_gated(self, patient_session):
        s, _ = patient_session
        r = s.get(f"{BASE_URL}/api/registry/patients", timeout=10)
        assert r.status_code == 403
        r2 = requests.get(f"{BASE_URL}/api/registry/patients", timeout=10)
        assert r2.status_code in (401, 403)


# ── 4 + 5: unified profile + activity stamping ──────────────────────

class TestProfileAndStamping:
    def test_rx_create_stamps_patient_id(self, owner):
        s, _ = owner
        r = s.post(f"{BASE_URL}/api/prescriptions", json={
            "patient_name": "TEST_phaseD_ Alpha",
            "patient_phone": TestRegistryCrud.PHONE,
            "patient_age": "44",
            "patient_gender": "Male",
            "visit_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "status": "draft",
            "medicines": [],
        }, timeout=25)
        assert r.status_code in (200, 201), f"{r.status_code}: {r.text[:300]}"
        rx = _db.prescriptions.find_one({"patient_phone": TestRegistryCrud.PHONE})
        assert rx and rx.get("patient_id") == TestRegistryCrud.pid, rx

    def test_profile_history_by_patient_id(self, owner):
        s, _ = owner
        r = s.get(f"{BASE_URL}/api/registry/patients/{TestRegistryCrud.pid}", timeout=20)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
        d = r.json()
        assert d["profile"]["patient_id"] == TestRegistryCrud.pid
        for key in ("bookings", "prescriptions", "surgeries", "receipts", "counts"):
            assert key in d
        assert d["counts"]["prescriptions"] >= 1, "Rx from previous test must appear"

    def test_profile_404(self, owner):
        s, _ = owner
        r = s.get(f"{BASE_URL}/api/registry/patients/nope_{uuid.uuid4().hex[:6]}", timeout=10)
        assert r.status_code == 404


# ── 6: merge ─────────────────────────────────────────────────────────

class TestMerge:
    def test_merge_repoints_and_hides_duplicate(self, owner):
        s, _ = owner
        dup_phone = _phone()
        r = s.post(f"{BASE_URL}/api/registry/patients", json={
            "phone": dup_phone, "name": "TEST_phaseD_ Dup",
        }, timeout=20)
        dup_id = r.json()["patient"]["patient_id"]
        # Fake booking pointing at the duplicate
        _db.bookings.insert_one({
            "booking_id": f"bk_test_{uuid.uuid4().hex[:8]}",
            "patient_name": "TEST_phaseD_ Dup",
            "patient_phone": dup_phone,
            "patient_id": dup_id,
            "status": "requested",
            "created_at": datetime.now(timezone.utc),
        })
        rm = s.post(
            f"{BASE_URL}/api/registry/patients/{TestRegistryCrud.pid}/merge",
            json={"duplicate_patient_id": dup_id}, timeout=20,
        )
        assert rm.status_code == 200, f"{rm.status_code}: {rm.text[:300]}"
        assert rm.json()["repointed"]["bookings"] >= 1
        b = _db.bookings.find_one({"patient_phone": dup_phone})
        assert b["patient_id"] == TestRegistryCrud.pid, "booking not repointed"
        dup_row = _db.patients.find_one({"patient_id": dup_id})
        assert dup_row.get("merged_into") == TestRegistryCrud.pid
        # Hidden from search
        rs = s.get(f"{BASE_URL}/api/registry/patients", params={"q": dup_phone}, timeout=15)
        ids = [i.get("patient_id") for i in rs.json().get("items") or []]
        assert dup_id not in ids

    def test_merge_self_400(self, owner):
        s, _ = owner
        r = s.post(
            f"{BASE_URL}/api/registry/patients/{TestRegistryCrud.pid}/merge",
            json={"duplicate_patient_id": TestRegistryCrud.pid}, timeout=10,
        )
        assert r.status_code == 400


# ── 7: patient-db regression ─────────────────────────────────────────

class TestPatientDbRegression:
    def test_list_still_works(self, owner):
        s, _ = owner
        r = s.get(f"{BASE_URL}/api/patient-db/list", params={"limit": 5}, timeout=20)
        assert r.status_code == 200
        assert isinstance(r.json().get("items"), list)

    def test_by_phone_detail_has_patient_id(self, owner):
        s, _ = owner
        r = s.get(f"{BASE_URL}/api/patient-db/by-phone/{TestRegistryCrud.PHONE}", timeout=20)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:200]}"
        d = r.json()
        assert d["profile"].get("patient_id") == TestRegistryCrud.pid
        assert d["counts"]["prescriptions"] >= 1
