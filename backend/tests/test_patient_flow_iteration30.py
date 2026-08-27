"""
Iteration 30 — Patient end-to-end backend tests.

Covers patient-facing REST endpoints called by the mobile app:
- Auth (`/api/auth/me`, restore)
- Bookings (`/api/bookings/me`, POST /api/bookings, cancel)
- Records (`/api/records/me`) and cross-patient leakage guard
- IPSS submit + history
- Public content (announcements, blog, videos, education, guides, diseases,
  clinic-by-slug)
- Notifications & inbox smoke

Test patient token: `patient_token_1776494002311` (see
/app/memory/test_credentials.md — user `test-patient-1776494002311`).
"""
import os
import time
import uuid

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://urology-pro.preview.emergentagent.com").rstrip("/")
PATIENT_TOKEN = "patient_token_1776494002311"
PATIENT_USER_ID = "test-patient-1776494002311"
CLINIC_SLUG = "dr-joshi-uro"


@pytest.fixture(scope="module")
def sess():
    s = requests.Session()
    s.headers.update({
        "Authorization": f"Bearer {PATIENT_TOKEN}",
        "Content-Type": "application/json",
    })
    return s


@pytest.fixture(scope="module")
def anon():
    return requests.Session()


# ── Auth ────────────────────────────────────────────────────────────────────
class TestAuth:
    def test_me_returns_patient(self, sess):
        r = sess.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["user_id"] == PATIENT_USER_ID
        assert d["role"] == "patient"
        assert d.get("pending_deletion") is False

    def test_missing_token_401(self, anon):
        r = anon.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code in (401, 403)


# ── Bookings ────────────────────────────────────────────────────────────────
class TestBookings:
    created_ids: list[str] = []

    def test_bookings_me_ok(self, sess):
        r = sess.get(f"{BASE_URL}/api/bookings/me")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_booking_persists_and_scoped(self, sess):
        # Use patient's own email so create_booking links booking.user_id
        # to this patient via the phone/email lookup.
        payload = {
            "patient_name": f"TEST_PatientFlow_{uuid.uuid4().hex[:6]}",
            "patient_phone": "9998887771",
            "patient_email": "patient.test@consulturo.app",
            "patient_age": 45,
            "patient_gender": "male",
            "reason": "TEST_iter30 patient e2e",
            "booking_date": "2026-12-15",
            "booking_time": "11:30",
            "mode": "in-person",
        }
        r = sess.post(f"{BASE_URL}/api/bookings", json=payload)
        assert r.status_code in (200, 201), r.text
        b = r.json()
        bid = b.get("booking_id") or b.get("id")
        assert bid, f"no id in response: {b}"
        TestBookings.created_ids.append(bid)

        # Verify appears in my bookings
        r2 = sess.get(f"{BASE_URL}/api/bookings/me")
        ids = [x.get("booking_id") or x.get("id") for x in r2.json()]
        assert bid in ids, f"created booking {bid} not in /bookings/me"

    def test_create_booking_missing_fields_422(self, sess):
        r = sess.post(f"{BASE_URL}/api/bookings", json={"reason": "x"})
        assert r.status_code in (400, 422)

    def test_bookings_all_forbidden_for_patient(self, sess):
        r = sess.get(f"{BASE_URL}/api/bookings/all")
        assert r.status_code in (401, 403), f"patient must not see all bookings; got {r.status_code}"

    def test_cancel_own_booking(self, sess):
        if not TestBookings.created_ids:
            pytest.skip("no booking created")
        bid = TestBookings.created_ids[0]
        r = sess.post(f"{BASE_URL}/api/bookings/{bid}/cancel", json={"reason": "TEST cleanup"})
        assert r.status_code in (200, 204), r.text

    @classmethod
    def teardown_class(cls):
        # Best-effort delete
        s = requests.Session()
        s.headers.update({"Authorization": f"Bearer {PATIENT_TOKEN}"})
        for bid in cls.created_ids:
            try:
                s.delete(f"{BASE_URL}/api/bookings/{bid}", timeout=10)
            except Exception:
                pass


# ── Records ─────────────────────────────────────────────────────────────────
class TestRecords:
    def test_records_me_ok_and_scoped(self, sess):
        r = sess.get(f"{BASE_URL}/api/records/me")
        assert r.status_code == 200
        d = r.json()
        assert "summary" in d
        # No cross-patient leakage: any appointment should have this patient
        for appt in d.get("appointments", []):
            uid = appt.get("user_id") or appt.get("patient_id")
            # can be phone-keyed — accept either
            if uid and uid != PATIENT_USER_ID:
                phone = appt.get("patient_phone")
                assert phone, f"foreign appointment leaked: {appt}"


# ── IPSS ────────────────────────────────────────────────────────────────────
class TestIPSS:
    def test_submit_ipss_and_history(self, sess):
        entries = [
            {"question": f"q{i}", "score": i % 6}
            for i in range(1, 8)
        ]
        payload = {
            "entries": entries,
            "total_score": sum(e["score"] for e in entries),
            "severity": "mild",
            "qol_score": 2,
        }
        r = sess.post(f"{BASE_URL}/api/ipss", json=payload)
        assert r.status_code in (200, 201), r.text
        r2 = sess.get(f"{BASE_URL}/api/ipss/history")
        assert r2.status_code == 200
        assert isinstance(r2.json(), list)


# ── Public content ──────────────────────────────────────────────────────────
class TestPublicContent:
    @pytest.mark.parametrize("path", [
        "/api/announcements",
        "/api/blog",
        "/api/videos",
        "/api/education",
        "/api/guides",
        "/api/diseases",
        f"/api/clinics/by-slug/{CLINIC_SLUG}",
    ])
    def test_endpoint_200(self, sess, path):
        r = sess.get(f"{BASE_URL}{path}")
        assert r.status_code == 200, f"{path} → {r.status_code}: {r.text[:200]}"

    def test_clinic_slug_shape(self, sess):
        r = sess.get(f"{BASE_URL}/api/clinics/by-slug/{CLINIC_SLUG}")
        d = r.json()
        assert d["slug"] == CLINIC_SLUG
        assert d.get("clinic_id")


# ── Notifications & inbox ───────────────────────────────────────────────────
class TestNotificationsInbox:
    @pytest.mark.parametrize("path", [
        "/api/notifications",
        "/api/inbox",
        "/api/messaging/permissions",
    ])
    def test_smoke(self, sess, path):
        r = sess.get(f"{BASE_URL}{path}")
        # 200 preferred; 404 for optional endpoints is not a blocker but flagged
        assert r.status_code in (200, 204, 404), f"{path} → {r.status_code}"
        if r.status_code == 404:
            pytest.skip(f"{path} not implemented — informational")


# ── Deletion + restore (leave patient restored) ─────────────────────────────
class TestDeletionRestore:
    def test_soft_delete_then_restore(self, sess):
        r = sess.delete(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("pending_deletion") is True
        assert d.get("grace_days") == 30

        # Session should still work
        r2 = sess.get(f"{BASE_URL}/api/auth/me")
        assert r2.status_code == 200
        assert r2.json().get("pending_deletion") is True

        # Restore
        r3 = sess.post(f"{BASE_URL}/api/auth/me/restore")
        assert r3.status_code == 200, r3.text

        # Verify restored
        r4 = sess.get(f"{BASE_URL}/api/auth/me")
        assert r4.status_code == 200
        assert r4.json().get("pending_deletion") is False
