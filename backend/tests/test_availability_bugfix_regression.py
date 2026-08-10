"""Regression tests for availability slot bug fix.

Reported bug: Slots selected in availability are not reflected correctly
when a new booking is being done. Time slots out of availability timings
are shown.

RCA / Fix: `_find_availability_doc` helper in
`/app/backend/routers/availability.py` now does 3-tier fallback:
  1. per-clinic doc matching X-Clinic-Id
  2. global doc (clinic_id null / missing)
  3. any doc saved by that doctor
Returns None only when doctor has no availability doc at all, in which
case caller falls through to `_default_availability()` (10-13 / 17-20).

These tests seed doctors directly into Mongo, set session tokens, then
exercise the public /api/availability/slots + /api/availability/doctors
endpoints via HTTP.

Run with:
    pytest /app/backend/tests/test_availability_bugfix_regression.py -v \
        --junitxml=/app/test_reports/pytest/availability_bugfix_regression.xml
"""
import os
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from pymongo import MongoClient


BASE_URL = os.environ.get(
    "EXPO_BACKEND_URL",
    "https://urology-pro.preview.emergentagent.com",
).rstrip("/")

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "consulturo")

# Slot minute helpers.
DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


def _next_weekday(target_weekday: int) -> str:
    """Pick a date >= day-after-tomorrow that lands on target_weekday.

    We add a comfortable buffer so the IST 'past slot' cutoff (which
    strips today's earlier slots and can trim the beginning of a
    schedule) never interferes with the assertions.
    """
    today = datetime.utcnow().date() + timedelta(days=2)
    days_ahead = (target_weekday - today.weekday()) % 7
    if days_ahead == 0:
        days_ahead = 7  # ensure it's at least one week out
    return (today + timedelta(days=days_ahead)).isoformat()


@pytest.fixture(scope="module")
def mongo():
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]
    yield db
    client.close()


@pytest.fixture(scope="module")
def http():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _seed_doctor(mongo, tag: str, role: str = "owner"):
    """Create a fresh doctor user + 7-day session token. Returns dict
    with user_id + token."""
    uid = f"test_avail_{tag}_{int(time.time()*1000)}_{uuid.uuid4().hex[:6]}"
    token = f"test_avail_tok_{tag}_{int(time.time()*1000)}"
    mongo.users.insert_one({
        "user_id": uid,
        "email": f"TEST_{tag}_{uid}@example.com",
        "name": f"TEST Dr {tag}",
        "role": role,
        "can_prescribe": True,
        "created_at": datetime.now(timezone.utc),
    })
    mongo.user_sessions.insert_one({
        "user_id": uid,
        "session_token": token,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "created_at": datetime.now(timezone.utc),
    })
    return {"user_id": uid, "token": token}


def _cleanup(mongo, user_ids):
    for uid in user_ids:
        mongo.users.delete_many({"user_id": uid})
        mongo.user_sessions.delete_many({"user_id": uid})
        mongo.availability.delete_many({"user_id": uid})
        mongo.unavailabilities.delete_many({"created_by": uid})
        mongo.bookings.delete_many({"user_id": uid})


# ── Scenario 1: Global doc without X-Clinic-Id, custom schedule 14-18
class TestScenario1_GlobalDocNonDefaultSchedule:
    """The reported symptom: PUT availability without X-Clinic-Id, then
    GET slots — the doctor's custom 14-18 schedule must be honoured, not
    the hardcoded 10-13 default."""

    doctor_ids: list = []

    def test_regression_global_doc_used_no_clinic_header(self, mongo, http):
        doc = _seed_doctor(mongo, "s1")
        self.__class__.doctor_ids.append(doc["user_id"])
        auth = {"Authorization": f"Bearer {doc['token']}"}

        # Save availability WITHOUT X-Clinic-Id, non-default schedule.
        body = {
            "mon_in": [{"start": "14:00", "end": "18:00"}],
            "tue_in": [], "wed_in": [], "thu_in": [], "fri_in": [],
            "sat_in": [], "sun_in": [],
            "mon_on": [], "tue_on": [], "wed_on": [], "thu_on": [],
            "fri_on": [], "sat_on": [], "sun_on": [],
            "off_days": ["sun"],
            "note": "regression bugfix test",
        }
        r = http.put(f"{BASE_URL}/api/availability/me", json=body, headers=auth)
        assert r.status_code == 200, r.text
        saved = r.json()
        assert saved["mon_in"] == [{"start": "14:00", "end": "18:00"}]
        # Global doc means clinic_id is None.
        assert saved.get("clinic_id") is None

        # GET slots for a Monday WITHOUT X-Clinic-Id — target this doctor.
        date = _next_weekday(0)  # Monday
        r = http.get(
            f"{BASE_URL}/api/availability/slots",
            params={"date": date, "mode": "in-person", "user_id": doc["user_id"]},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        # Expected 30-min ticks from 14:00 to 17:30 inclusive.
        expected = ["14:00", "14:30", "15:00", "15:30",
                    "16:00", "16:30", "17:00", "17:30"]
        assert data["slots"] == expected, (
            f"Global-doc schedule not honoured. Got {data['slots']}"
        )
        # Must NOT contain any default-schedule slots.
        for bad in ["10:00", "10:30", "11:00", "12:30"]:
            assert bad not in data["slots"], (
                f"Default slot {bad} leaked in — fallback still broken."
            )

    def test_regression_wrong_clinic_id_still_finds_global(self, mongo, http):
        """When X-Clinic-Id is set to a clinic the doctor is NOT a
        member of, the endpoint's clinic-membership filter would exclude
        this doctor from the results. That's separate from the fallback.

        Here we call WITHOUT ?user_id to observe the membership gate.
        The doctor is not a member of `bogus_clinic_xyz`, so we expect
        an empty result (not the hardcoded defaults). This is CORRECT
        multi-tenant behaviour and confirms the fix does not leak slots
        across tenants."""
        # Uses the same doctor from previous test.
        assert self.__class__.doctor_ids, "prev test must run first"
        uid = self.__class__.doctor_ids[0]

        date = _next_weekday(0)
        r = http.get(
            f"{BASE_URL}/api/availability/slots",
            params={"date": date, "mode": "in-person"},
            headers={"X-Clinic-Id": "bogus_clinic_does_not_exist"},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        # No members in this bogus clinic → empty slots.
        assert data["slots"] == [], (
            f"Bogus clinic should return empty (membership gate); got {data['slots']}"
        )

    def test_regression_targeted_user_id_no_clinic_returns_global(self, mongo, http):
        """When ?user_id targets our doctor AND no clinic header is
        given, the fallback (tier 2) must pick up the global doc."""
        assert self.__class__.doctor_ids, "prev test must run first"
        uid = self.__class__.doctor_ids[0]

        date = _next_weekday(0)
        r = http.get(
            f"{BASE_URL}/api/availability/slots",
            params={"date": date, "mode": "in-person", "user_id": uid},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "14:00" in data["slots"]
        assert "10:00" not in data["slots"]

    @classmethod
    def teardown_class(cls):
        client = MongoClient(MONGO_URL)
        _cleanup(client[DB_NAME], cls.doctor_ids)
        client.close()


# ── Scenario 2: Per-clinic override wins over global.
class TestScenario2_PerClinicOverride:
    doctor_ids: list = []
    clinic_id = "TEST_clinic_scen2_" + uuid.uuid4().hex[:8]

    def test_per_clinic_and_global_both_saved(self, mongo, http):
        doc = _seed_doctor(mongo, "s2")
        self.__class__.doctor_ids.append(doc["user_id"])
        auth = {"Authorization": f"Bearer {doc['token']}"}

        # Register doctor as member of the clinic so /slots picks him up
        # when X-Clinic-Id is set. Collection name is `clinic_memberships`.
        mongo.clinic_memberships.insert_one({
            "user_id": doc["user_id"],
            "clinic_id": self.clinic_id,
            "role": "owner",
            "is_active": True,
            "created_at": datetime.now(timezone.utc),
        })

        # Save global doc FIRST: mon_in 14-18.
        # NOTE on write-path ordering: `PUT /api/availability/me`
        # without X-Clinic-Id filters by `{user_id}` only, so if a
        # per-clinic doc already exists it would be *overwritten*
        # rather than a new global doc being added. Writing global
        # first, then per-clinic, sidesteps this and lets us set up
        # the "both docs present" state the fix's tier-1 logic needs.
        body_b = {
            "mon_in": [{"start": "14:00", "end": "18:00"}],
            "tue_in": [], "wed_in": [], "thu_in": [], "fri_in": [],
            "sat_in": [], "sun_in": [],
            "mon_on": [], "tue_on": [], "wed_on": [], "thu_on": [],
            "fri_on": [], "sat_on": [], "sun_on": [],
            "off_days": ["sun"], "note": "global",
        }
        r = http.put(f"{BASE_URL}/api/availability/me", json=body_b, headers=auth)
        assert r.status_code == 200, r.text

        # Now save per-clinic doc: mon_in 09-11.
        body_a = {**body_b, "mon_in": [{"start": "09:00", "end": "11:00"}],
                  "note": "clinicA"}
        r = http.put(
            f"{BASE_URL}/api/availability/me",
            json=body_a,
            headers={**auth, "X-Clinic-Id": self.clinic_id},
        )
        assert r.status_code == 200, r.text

        # Sanity: two docs exist in Mongo.
        docs = list(mongo.availability.find({"user_id": doc["user_id"]}))
        assert len(docs) == 2, f"Expected 2 docs, got {len(docs)}: {docs}"

    def test_get_slots_with_clinic_returns_per_clinic_schedule(self, mongo, http):
        assert self.__class__.doctor_ids
        uid = self.__class__.doctor_ids[0]
        date = _next_weekday(0)
        r = http.get(
            f"{BASE_URL}/api/availability/slots",
            params={"date": date, "mode": "in-person", "user_id": uid},
            headers={"X-Clinic-Id": self.clinic_id},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        expected = ["09:00", "09:30", "10:00", "10:30"]
        assert data["slots"] == expected, (
            f"Per-clinic override lost. Expected {expected}, got {data['slots']}"
        )

    def test_get_slots_without_clinic_returns_global_schedule(self, mongo, http):
        assert self.__class__.doctor_ids
        uid = self.__class__.doctor_ids[0]
        date = _next_weekday(0)
        r = http.get(
            f"{BASE_URL}/api/availability/slots",
            params={"date": date, "mode": "in-person", "user_id": uid},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        expected = ["14:00", "14:30", "15:00", "15:30",
                    "16:00", "16:30", "17:00", "17:30"]
        assert data["slots"] == expected, (
            f"Global schedule lost. Expected {expected}, got {data['slots']}"
        )

    @classmethod
    def teardown_class(cls):
        client = MongoClient(MONGO_URL)
        client[DB_NAME].clinic_memberships.delete_many({"clinic_id": cls.clinic_id})
        _cleanup(client[DB_NAME], cls.doctor_ids)
        client.close()


# ── Scenario 3: Any-doc fallback (tier 3).
class TestScenario3_TierThreeAnyDoc:
    """Doctor has ONLY a doc under clinicA. A request without X-Clinic-Id
    (or with a different clinic where no doc exists) should still pick
    up clinicA's schedule rather than fall through to hardcoded defaults."""
    doctor_ids: list = []
    clinic_a = "TEST_clinic_scen3_A_" + uuid.uuid4().hex[:8]

    def test_only_per_clinic_doc_saved(self, mongo, http):
        doc = _seed_doctor(mongo, "s3")
        self.__class__.doctor_ids.append(doc["user_id"])
        auth = {"Authorization": f"Bearer {doc['token']}"}

        # Register doctor as member of clinicA (else the PUT with
        # X-Clinic-Id returns 403 "not a member").
        mongo.clinic_memberships.insert_one({
            "user_id": doc["user_id"],
            "clinic_id": self.clinic_a,
            "role": "owner",
            "is_active": True,
            "created_at": datetime.now(timezone.utc),
        })

        # Save ONLY per-clinic (clinicA) doc.
        body = {
            "mon_in": [{"start": "08:00", "end": "09:30"}],
            "tue_in": [], "wed_in": [], "thu_in": [], "fri_in": [],
            "sat_in": [], "sun_in": [],
            "mon_on": [], "tue_on": [], "wed_on": [], "thu_on": [],
            "fri_on": [], "sat_on": [], "sun_on": [],
            "off_days": ["sun"], "note": "only clinicA",
        }
        r = http.put(
            f"{BASE_URL}/api/availability/me", json=body,
            headers={**auth, "X-Clinic-Id": self.clinic_a},
        )
        assert r.status_code == 200
        # Confirm exactly one doc exists.
        docs = list(mongo.availability.find({"user_id": doc["user_id"]}))
        assert len(docs) == 1
        assert docs[0]["clinic_id"] == self.clinic_a

    def test_no_clinic_header_uses_tier3_fallback(self, mongo, http):
        assert self.__class__.doctor_ids
        uid = self.__class__.doctor_ids[0]
        date = _next_weekday(0)
        # No X-Clinic-Id → tier 1 & 2 miss; tier 3 must find clinicA doc.
        r = http.get(
            f"{BASE_URL}/api/availability/slots",
            params={"date": date, "mode": "in-person", "user_id": uid},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        expected = ["08:00", "08:30", "09:00"]
        assert data["slots"] == expected, (
            f"Tier-3 fallback broken. Expected {expected}, got {data['slots']}. "
            "This means the endpoint likely fell through to hardcoded defaults."
        )
        # And definitely no default-schedule leakage.
        for bad in ["10:00", "10:30", "11:00", "12:30"]:
            assert bad not in data["slots"]

    @classmethod
    def teardown_class(cls):
        client = MongoClient(MONGO_URL)
        client[DB_NAME].clinic_memberships.delete_many({"clinic_id": cls.clinic_a})
        _cleanup(client[DB_NAME], cls.doctor_ids)
        client.close()


# ── Scenario 4: Brand-new doctor with NO availability doc → hardcoded default.
class TestScenario4_TrueAbsenceUsesHardcodedDefault:
    doctor_ids: list = []

    def test_no_availability_falls_through_to_default(self, mongo, http):
        doc = _seed_doctor(mongo, "s4")
        self.__class__.doctor_ids.append(doc["user_id"])
        # Do NOT save any availability doc.

        date = _next_weekday(0)  # Monday
        r = http.get(
            f"{BASE_URL}/api/availability/slots",
            params={"date": date, "mode": "in-person", "user_id": doc["user_id"]},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        # Default is mon_in 10:00-13:00 → 10:00, 10:30, 11:00, 11:30, 12:00, 12:30.
        expected = ["10:00", "10:30", "11:00", "11:30", "12:00", "12:30"]
        assert data["slots"] == expected, (
            f"Hardcoded default not applied to zero-avail doctor. Got {data['slots']}"
        )

    def test_no_availability_online_mode_default(self, mongo, http):
        assert self.__class__.doctor_ids
        uid = self.__class__.doctor_ids[0]
        date = _next_weekday(0)
        r = http.get(
            f"{BASE_URL}/api/availability/slots",
            params={"date": date, "mode": "online", "user_id": uid},
        )
        assert r.status_code == 200
        data = r.json()
        expected = ["17:00", "17:30", "18:00", "18:30", "19:00", "19:30"]
        assert data["slots"] == expected

    @classmethod
    def teardown_class(cls):
        client = MongoClient(MONGO_URL)
        _cleanup(client[DB_NAME], cls.doctor_ids)
        client.close()


# ── Scenario 5: /api/availability/doctors also honours 3-tier fallback.
class TestScenario5_DoctorsListEndpoint:
    doctor_ids: list = []

    def test_doctors_endpoint_returns_actual_schedule(self, mongo, http):
        doc = _seed_doctor(mongo, "s5")
        self.__class__.doctor_ids.append(doc["user_id"])
        auth = {"Authorization": f"Bearer {doc['token']}"}
        body = {
            "mon_in": [{"start": "15:00", "end": "16:30"}],
            "tue_in": [], "wed_in": [], "thu_in": [], "fri_in": [],
            "sat_in": [], "sun_in": [],
            "mon_on": [], "tue_on": [], "wed_on": [], "thu_on": [],
            "fri_on": [], "sat_on": [], "sun_on": [],
            "off_days": ["sun"], "note": "s5 global",
        }
        r = http.put(f"{BASE_URL}/api/availability/me", json=body, headers=auth)
        assert r.status_code == 200

        r = http.get(f"{BASE_URL}/api/availability/doctors")
        assert r.status_code == 200
        me = next((d for d in r.json() if d["user_id"] == doc["user_id"]), None)
        assert me is not None, "Freshly seeded doctor not returned by /doctors"
        assert me["availability"]["mon_in"] == [{"start": "15:00", "end": "16:30"}], (
            f"Doctors endpoint did NOT honour saved schedule. Got {me['availability']['mon_in']}"
        )

    @classmethod
    def teardown_class(cls):
        client = MongoClient(MONGO_URL)
        _cleanup(client[DB_NAME], cls.doctor_ids)
        client.close()


# ── Scenario 6: No regression — unavailability, off_days, timezone cutoff.
class TestScenario6_NoRegressionOnAncillaryFeatures:
    doctor_ids: list = []
    unav_ids: list = []

    def test_off_days_still_excludes_slots(self, mongo, http):
        doc = _seed_doctor(mongo, "s6a")
        self.__class__.doctor_ids.append(doc["user_id"])
        auth = {"Authorization": f"Bearer {doc['token']}"}
        body = {
            "mon_in": [{"start": "10:00", "end": "11:00"}],
            "tue_in": [{"start": "10:00", "end": "11:00"}],
            "wed_in": [], "thu_in": [], "fri_in": [],
            "sat_in": [], "sun_in": [],
            "mon_on": [], "tue_on": [], "wed_on": [], "thu_on": [],
            "fri_on": [], "sat_on": [], "sun_on": [],
            "off_days": ["mon"],
            "note": "off-days test",
        }
        r = http.put(f"{BASE_URL}/api/availability/me", json=body, headers=auth)
        assert r.status_code == 200

        # Monday → off day → slots empty.
        date = _next_weekday(0)
        r = http.get(
            f"{BASE_URL}/api/availability/slots",
            params={"date": date, "mode": "in-person", "user_id": doc["user_id"]},
        )
        assert r.status_code == 200
        assert r.json()["slots"] == []

        # Tuesday → normal 10-11 → 2 slots.
        date = _next_weekday(1)
        r = http.get(
            f"{BASE_URL}/api/availability/slots",
            params={"date": date, "mode": "in-person", "user_id": doc["user_id"]},
        )
        assert r.status_code == 200
        assert r.json()["slots"] == ["10:00", "10:30"]

    def test_unavailability_rule_blocks_slots(self, mongo, http):
        doc = _seed_doctor(mongo, "s6b")
        self.__class__.doctor_ids.append(doc["user_id"])
        auth = {"Authorization": f"Bearer {doc['token']}"}
        # Non-default mon schedule 10:00-12:00 → 4 slots.
        body = {
            "mon_in": [{"start": "10:00", "end": "12:00"}],
            "tue_in": [], "wed_in": [], "thu_in": [], "fri_in": [],
            "sat_in": [], "sun_in": [],
            "mon_on": [], "tue_on": [], "wed_on": [], "thu_on": [],
            "fri_on": [], "sat_on": [], "sun_on": [],
            "off_days": ["sun"], "note": "unav test",
        }
        r = http.put(f"{BASE_URL}/api/availability/me", json=body, headers=auth)
        assert r.status_code == 200

        # Block 10:30-11:30 as a one-off on next Monday.
        date = _next_weekday(0)
        r = http.post(
            f"{BASE_URL}/api/unavailabilities",
            json={
                "date": date,
                "all_day": False,
                "start_time": "10:30",
                "end_time": "11:30",
                "reason": "TEST regression block",
                "recurring_weekly": False,
            },
            headers=auth,
        )
        assert r.status_code == 200, r.text
        rule = r.json()
        self.__class__.unav_ids.append(rule["id"])

        r = http.get(
            f"{BASE_URL}/api/availability/slots",
            params={"date": date, "mode": "in-person", "user_id": doc["user_id"]},
        )
        assert r.status_code == 200
        data = r.json()
        # 10:00 remains; 10:30 & 11:00 blocked; 11:30 remains.
        assert "10:00" in data["slots"]
        assert "10:30" not in data["slots"]
        assert "11:00" not in data["slots"]
        assert "11:30" in data["slots"]

    def test_response_shape_has_expected_fields(self, mongo, http):
        """No regression on booked_counts / full_slots / past_slots
        response schema."""
        doc = _seed_doctor(mongo, "s6c")
        self.__class__.doctor_ids.append(doc["user_id"])
        auth = {"Authorization": f"Bearer {doc['token']}"}
        body = {
            "mon_in": [{"start": "10:00", "end": "11:00"}],
            "tue_in": [], "wed_in": [], "thu_in": [], "fri_in": [],
            "sat_in": [], "sun_in": [],
            "mon_on": [], "tue_on": [], "wed_on": [], "thu_on": [],
            "fri_on": [], "sat_on": [], "sun_on": [],
            "off_days": ["sun"], "note": "shape",
        }
        http.put(f"{BASE_URL}/api/availability/me", json=body, headers=auth)
        date = _next_weekday(0)
        r = http.get(
            f"{BASE_URL}/api/availability/slots",
            params={"date": date, "mode": "in-person", "user_id": doc["user_id"]},
        )
        assert r.status_code == 200
        data = r.json()
        for key in ("date", "mode", "day", "slots", "booked_counts",
                    "max_per_slot", "full_slots", "booked_slots",
                    "past_slots", "unavailable_reason"):
            assert key in data, f"Missing response field: {key}"
        assert data["day"] == "mon"
        assert isinstance(data["booked_counts"], dict)
        assert isinstance(data["slots"], list)
        assert isinstance(data["full_slots"], list)
        assert isinstance(data["past_slots"], list)

    @classmethod
    def teardown_class(cls):
        client = MongoClient(MONGO_URL)
        db = client[DB_NAME]
        for rid in cls.unav_ids:
            db.unavailabilities.delete_many({"id": rid})
        _cleanup(db, cls.doctor_ids)
        client.close()
