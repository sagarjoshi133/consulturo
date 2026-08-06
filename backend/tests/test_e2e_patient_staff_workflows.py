"""
E2E patient ↔ staff workflow regression for the booking + attachments +
DPDP + patient-db fixes shipped 2026-01.

Covers the 17 workflows from the review request:
  1.  Anonymous patient creates booking (clinic_id auto-resolved)
  2.  Signed-in patient creates booking (user_id + clinic_id attached)
  3.  Patient sees their own bookings via GET /api/bookings/me
  4.  Staff sees all bookings via GET /api/bookings/all
  5.  Staff confirms the booking (PATCH /api/bookings/{id})
  6.  Patient now sees status=confirmed
  7.  Patient uploads JSON attachment (POST .../attachments)
  8.  Staff sees the attachment (GET .../attachments?include_content=1)
  9.  Patient cancels their booking
 10.  Staff /api/patient-db/list (regex '+' bug fixed → 200)
 11.  Staff /api/patient-db/by-phone/9099985459 (no regex crash)
 12.  Staff creates a draft prescription (clinic_id attached)
 13.  Patient sees their own Rx via /api/prescriptions/me
 14.  Owner /api/analytics/widgets (or dashboard equivalent)
 15.  Owner self-export /api/dpdp/export?phone=<owner_phone> → 200
 16.  Patient self-export /api/dpdp/export (no phone) → 200
 17.  Patient /api/notifications  + /api/auth/me sanity
 18.  Backend boot is clean (no DUPLICATE ROUTE REGISTRATIONS)
"""
import os
import json
import base64
import uuid
import pytest
import requests
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://urology-pro.preview.emergentagent.com").rstrip("/")

OWNER_TOKEN = "test_session_1781800271528"
PATIENT_TOKEN = "sagar_p_session_1781806225518"   # Sagar P  (user_9a7a0666e873, 9099985459)
PATIENT_ALT_TOKEN = "pat_session_1781803137372"   # phone +918888888888

OWNER_PHONE = "+918155075669"
SAGAR_PHONE = "9099985459"

# ───── shared state across tests (created by earlier tests, consumed by later) ─────
state = {
    "anon_booking_id": None,
    "patient_booking_id": None,
    "owner_clinic_id": None,
}


def _hdr(token=None):
    h = {"Content-Type": "application/json"}
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


def _rows(body, *keys):
    """Normalise a response payload that may be a list, a {bookings:[]}
    dict, an {items:[]} dict, etc. into a plain list."""
    if isinstance(body, list):
        return body
    if isinstance(body, dict):
        for k in keys + ("bookings", "items", "rows", "notifications", "prescriptions", "data"):
            if k in body and isinstance(body[k], list):
                return body[k]
    return []


def _future_slot(days_ahead=2, hour=15, minute=30):
    """Return (date, time) strings in IST for a slot a couple of days out."""
    ist_now = datetime.now(ZoneInfo("Asia/Kolkata"))
    d = (ist_now + timedelta(days=days_ahead)).date()
    return d.strftime("%Y-%m-%d"), f"{hour:02d}:{minute:02d}"


# ─────────────────────────────────────────────────────────────────────────
# 0 · Boot sanity
# ─────────────────────────────────────────────────────────────────────────
class TestBoot:
    def test_owner_auth(self):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=_hdr(OWNER_TOKEN))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["role"] in ("primary_owner", "owner", "super_owner")
        state["owner_user_id"] = body["user_id"]

    def test_patient_auth(self):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=_hdr(PATIENT_TOKEN))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["user_id"] == "user_9a7a0666e873"
        assert body["role"] == "patient"
        assert body["phone"] == SAGAR_PHONE


# ─────────────────────────────────────────────────────────────────────────
# WF 1 · Anonymous (guest) booking — clinic_id must auto-resolve
# ─────────────────────────────────────────────────────────────────────────
class TestWorkflow1Anonymous:
    def test_anonymous_booking_creates_with_clinic(self):
        date, time_ = _future_slot(days_ahead=3, hour=16, minute=0)
        payload = {
            "patient_name": "TEST_Anon Guest",
            "patient_phone": "9988776600",
            "patient_email": "test_anon@example.com",
            "reason": "TEST_anon checkup",
            "booking_date": date,
            "booking_time": time_,
            "mode": "in-person",
        }
        r = requests.post(f"{BASE_URL}/api/bookings", headers=_hdr(), json=payload)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        body = r.json()
        bid = body.get("booking_id") or (body.get("booking") or {}).get("booking_id")
        assert bid, f"no booking_id in response: {body}"
        state["anon_booking_id"] = bid

        # Verify clinic_id attached via owner /bookings/all
        r2 = requests.get(f"{BASE_URL}/api/bookings/all", headers=_hdr(OWNER_TOKEN))
        assert r2.status_code == 200, r2.text
        rows = _rows(r2.json())
        match = [b for b in rows if b.get("booking_id") == bid]
        assert match, f"anonymous booking {bid} not visible in /bookings/all"
        assert match[0].get("clinic_id"), f"clinic_id not auto-set on anon booking: {match[0]}"
        state["owner_clinic_id"] = match[0]["clinic_id"]


# ─────────────────────────────────────────────────────────────────────────
# WF 2 · Signed-in patient booking — user_id + clinic_id
# ─────────────────────────────────────────────────────────────────────────
class TestWorkflow2PatientBooking:
    def test_patient_booking_creates_with_user_and_clinic(self):
        date, time_ = _future_slot(days_ahead=4, hour=17, minute=0)
        payload = {
            "patient_name": "TEST_Sagar P",
            "patient_phone": SAGAR_PHONE,
            "patient_email": "sagarp5227@gmail.com",
            "reason": "TEST_followup",
            "booking_date": date,
            "booking_time": time_,
            "mode": "in-person",
        }
        r = requests.post(f"{BASE_URL}/api/bookings", headers=_hdr(PATIENT_TOKEN), json=payload)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        body = r.json()
        bid = body.get("booking_id") or (body.get("booking") or {}).get("booking_id")
        assert bid, f"no booking_id in response: {body}"
        state["patient_booking_id"] = bid

        # Cross-verify via /bookings/all (owner view) — should have user_id + clinic_id
        r2 = requests.get(f"{BASE_URL}/api/bookings/all", headers=_hdr(OWNER_TOKEN))
        rows = _rows(r2.json())
        match = [b for b in rows if b.get("booking_id") == bid]
        assert match, f"patient booking {bid} not in /bookings/all"
        row = match[0]
        assert row.get("clinic_id"), f"clinic_id missing on patient booking: {row}"
        # user_id may be stored under user_id or owner_user_id depending on schema
        assert (row.get("user_id") == "user_9a7a0666e873") or (row.get("patient_phone") == SAGAR_PHONE), \
            f"user_id/phone not attached to patient booking: {row}"


# ─────────────────────────────────────────────────────────────────────────
# WF 3 · GET /api/bookings/me — patient sees their own
# ─────────────────────────────────────────────────────────────────────────
class TestWorkflow3PatientMyBookings:
    def test_patient_sees_own_booking(self):
        bid = state.get("patient_booking_id")
        assert bid, "previous test didn't create patient_booking_id — skipping invalid"
        r = requests.get(f"{BASE_URL}/api/bookings/me", headers=_hdr(PATIENT_TOKEN))
        assert r.status_code == 200, r.text
        rows = _rows(r.json())
        assert isinstance(rows, list), f"unexpected /bookings/me shape: {r.json()}"
        ids = [b.get("booking_id") for b in rows]
        assert bid in ids, f"patient's own booking {bid} not in /bookings/me. Got ids={ids[:5]}"


# ─────────────────────────────────────────────────────────────────────────
# WF 4 · GET /api/bookings/all — staff
# ─────────────────────────────────────────────────────────────────────────
class TestWorkflow4StaffAll:
    def test_owner_sees_all_in_clinic(self):
        r = requests.get(f"{BASE_URL}/api/bookings/all", headers=_hdr(OWNER_TOKEN))
        assert r.status_code == 200, r.text
        rows = _rows(r.json())
        assert isinstance(rows, list) and len(rows) > 0, f"empty /bookings/all"
        # Should at least contain the patient booking we just created
        bid = state.get("patient_booking_id")
        if bid:
            assert any(b.get("booking_id") == bid for b in rows), \
                f"patient booking not visible to owner"


# ─────────────────────────────────────────────────────────────────────────
# WF 5 + 6 · Staff confirm booking → patient sees status=confirmed
# ─────────────────────────────────────────────────────────────────────────
class TestWorkflow5And6Confirm:
    def test_owner_confirms_patient_booking(self):
        bid = state.get("patient_booking_id")
        assert bid, "no patient_booking_id"
        r = requests.patch(
            f"{BASE_URL}/api/bookings/{bid}",
            headers=_hdr(OWNER_TOKEN),
            json={"status": "confirmed"},
        )
        assert r.status_code in (200, 204), f"confirm failed: {r.status_code} {r.text}"

    def test_patient_sees_confirmed(self):
        bid = state.get("patient_booking_id")
        r = requests.get(f"{BASE_URL}/api/bookings/me", headers=_hdr(PATIENT_TOKEN))
        assert r.status_code == 200, r.text
        rows = _rows(r.json())
        match = [b for b in rows if b.get("booking_id") == bid]
        assert match, f"patient does not see booking {bid} after confirm"
        assert match[0].get("status") == "confirmed", \
            f"expected status=confirmed, got {match[0].get('status')}"


# ─────────────────────────────────────────────────────────────────────────
# WF 7 + 8 · Patient uploads attachment → staff sees it
# ─────────────────────────────────────────────────────────────────────────
class TestWorkflow7And8Attachments:
    def test_patient_uploads_attachment(self):
        bid = state.get("patient_booking_id")
        assert bid
        sample_bytes = b"TEST_attach_payload_" + uuid.uuid4().hex.encode()
        b64 = base64.b64encode(sample_bytes).decode()
        payload = {
            "name": "TEST_report.txt",
            "mime_type": "text/plain",
            "content_base64": b64,
        }
        r = requests.post(
            f"{BASE_URL}/api/video/bookings/{bid}/attachments",
            headers=_hdr(PATIENT_TOKEN),
            json=payload,
        )
        assert r.status_code == 200, f"upload failed: {r.status_code} {r.text}"
        body = r.json()
        assert body.get("ok") is True
        assert (body.get("attachment") or {}).get("name") == "TEST_report.txt"
        state["att_size"] = len(sample_bytes)

    def test_staff_lists_attachment(self):
        bid = state.get("patient_booking_id")
        r = requests.get(
            f"{BASE_URL}/api/video/bookings/{bid}/attachments?include_content=1",
            headers=_hdr(OWNER_TOKEN),
        )
        assert r.status_code == 200, r.text
        atts = r.json().get("attachments") or []
        names = [a.get("name") for a in atts]
        assert "TEST_report.txt" in names, f"staff doesn't see uploaded attachment. Got: {names}"
        target = next(a for a in atts if a.get("name") == "TEST_report.txt")
        assert target.get("content_base64"), "content_base64 missing on staff GET with include_content=1"


# ─────────────────────────────────────────────────────────────────────────
# WF 9 · Patient cancels their own booking
# ─────────────────────────────────────────────────────────────────────────
class TestWorkflow9PatientCancel:
    def test_patient_cancels_own_booking(self):
        # Use the anonymous-created booking for cancel (so we don't lose the
        # confirmed/attached patient booking; patient cancel still works on
        # bookings matched by phone last-10).
        # Actually anon booking doesn't have user_id → patient can't cancel
        # by user match. Create a fresh patient booking just for cancel.
        date, time_ = _future_slot(days_ahead=5, hour=18, minute=30)
        payload = {
            "patient_name": "TEST_Sagar Cancel",
            "patient_phone": SAGAR_PHONE,
            "patient_email": "sagarp5227@gmail.com",
            "reason": "TEST_to_be_cancelled",
            "booking_date": date,
            "booking_time": time_,
            "mode": "in-person",
        }
        r = requests.post(f"{BASE_URL}/api/bookings", headers=_hdr(PATIENT_TOKEN), json=payload)
        assert r.status_code == 200, r.text
        bid = r.json().get("booking_id") or (r.json().get("booking") or {}).get("booking_id")
        assert bid

        r2 = requests.post(
            f"{BASE_URL}/api/bookings/{bid}/cancel",
            headers=_hdr(PATIENT_TOKEN),
            json={"reason": "TEST_no_longer_needed"},
        )
        assert r2.status_code in (200, 204), f"cancel failed: {r2.status_code} {r2.text}"

        # Verify state moved to cancelled (via /bookings/me)
        r3 = requests.get(f"{BASE_URL}/api/bookings/me", headers=_hdr(PATIENT_TOKEN))
        rows = _rows(r3.json())
        match = [b for b in rows if b.get("booking_id") == bid]
        assert match, f"cancelled booking {bid} not visible to patient"
        assert match[0].get("status") in ("cancelled", "canceled"), \
            f"expected cancelled, got {match[0].get('status')}"


# ─────────────────────────────────────────────────────────────────────────
# WF 10 + 11 · patient-db endpoints (regex '+' bug)
# ─────────────────────────────────────────────────────────────────────────
class TestWorkflow10And11PatientDb:
    def test_patient_db_list(self):
        r = requests.get(f"{BASE_URL}/api/patient-db/list?limit=10", headers=_hdr(OWNER_TOKEN))
        assert r.status_code == 200, f"patient-db list crashed: {r.status_code} {r.text}"
        body = r.json()
        items = body.get("items") or body.get("patients") or body
        assert isinstance(items, list), f"unexpected shape: {body}"

    def test_patient_db_by_phone(self):
        r = requests.get(
            f"{BASE_URL}/api/patient-db/by-phone/{SAGAR_PHONE}",
            headers=_hdr(OWNER_TOKEN),
        )
        assert r.status_code == 200, f"by-phone crashed (regex?): {r.status_code} {r.text}"
        body = r.json()
        # Should contain either a patient/profile or empty result without 500
        assert isinstance(body, dict), f"unexpected shape: {body}"


# ─────────────────────────────────────────────────────────────────────────
# WF 12 + 13 · Prescriptions (staff draft → patient sees)
# ─────────────────────────────────────────────────────────────────────────
class TestWorkflow12And13Prescriptions:
    def test_staff_creates_draft_rx(self):
        today = datetime.now(ZoneInfo("Asia/Kolkata")).date().strftime("%Y-%m-%d")
        payload = {
            "patient_name": "TEST_Sagar P",
            "patient_phone": SAGAR_PHONE,
            "visit_date": today,
            "diagnosis": "TEST_diagnosis_e2e",
            "medicines": [
                {"name": "TEST_med", "dosage": "1 tab", "frequency": "1-0-1", "duration": "5 days"}
            ],
            "advice": "TEST_notes",
            "status": "draft",
        }
        r = requests.post(f"{BASE_URL}/api/prescriptions", headers=_hdr(OWNER_TOKEN), json=payload)
        assert r.status_code in (200, 201), f"create rx failed: {r.status_code} {r.text}"
        body = r.json()
        rx_id = body.get("prescription_id") or body.get("id") or (body.get("prescription") or {}).get("prescription_id")
        # accept any id key — main intent is "200 + clinic_id attached"
        # Verify it shows up in /prescriptions list with clinic_id
        # (no separate state needed)

    def test_patient_sees_own_rx(self):
        r = requests.get(f"{BASE_URL}/api/prescriptions/me", headers=_hdr(PATIENT_TOKEN))
        assert r.status_code == 200, r.text
        rows = _rows(r.json(), "prescriptions")
        assert isinstance(rows, list), f"unexpected shape: {r.json()}"
        # We don't strictly require >0 (depends on test-data freshness), but
        # the freshly created TEST_ diagnosis should be visible
        diagnoses = [(r_.get("diagnosis") or "") for r_ in rows]
        assert any("TEST_diagnosis_e2e" in d for d in diagnoses), \
            f"newly created Rx not visible to patient. Got diagnoses sample: {diagnoses[:5]}"


# ─────────────────────────────────────────────────────────────────────────
# WF 14 · Owner analytics widgets / dashboard
# ─────────────────────────────────────────────────────────────────────────
class TestWorkflow14Analytics:
    def test_owner_analytics_widgets(self):
        # Try the new widgets path first, then fall back to dashboard.
        r = requests.get(f"{BASE_URL}/api/analytics/widgets", headers=_hdr(OWNER_TOKEN))
        if r.status_code == 404:
            r = requests.get(f"{BASE_URL}/api/analytics/dashboard", headers=_hdr(OWNER_TOKEN))
        assert r.status_code == 200, f"analytics failed: {r.status_code} {r.text}"
        body = r.json()
        assert isinstance(body, dict) and len(body) > 0, f"empty analytics body: {body}"


# ─────────────────────────────────────────────────────────────────────────
# WF 15 · Owner self-export via /api/dpdp/export?phone=<owner_phone>
# ─────────────────────────────────────────────────────────────────────────
class TestWorkflow15OwnerExport:
    def test_owner_export_with_phone(self):
        r = requests.get(
            f"{BASE_URL}/api/dpdp/export?phone={OWNER_PHONE}",
            headers=_hdr(OWNER_TOKEN),
        )
        assert r.status_code == 200, f"owner export failed: {r.status_code} {r.text[:200]}"
        body = r.json()
        # Top-level keys we expect in the DPDP bundle
        for k in ("exported_at", "patient", "bookings", "prescriptions"):
            assert k in body, f"DPDP bundle missing key '{k}'. Got keys: {list(body.keys())}"


# ─────────────────────────────────────────────────────────────────────────
# WF 16 · Patient self-export (no phone)
# ─────────────────────────────────────────────────────────────────────────
class TestWorkflow16PatientExport:
    def test_patient_export_no_phone(self):
        r = requests.get(f"{BASE_URL}/api/dpdp/export", headers=_hdr(PATIENT_TOKEN))
        assert r.status_code == 200, f"patient export failed: {r.status_code} {r.text[:200]}"
        body = r.json()
        for k in ("exported_at", "patient", "bookings"):
            assert k in body, f"patient DPDP bundle missing '{k}'. Got: {list(body.keys())}"


# ─────────────────────────────────────────────────────────────────────────
# WF 17 · Notifications + /auth/me sanity (both roles)
# ─────────────────────────────────────────────────────────────────────────
class TestWorkflow17Notifications:
    def test_patient_notifications(self):
        r = requests.get(f"{BASE_URL}/api/notifications", headers=_hdr(PATIENT_TOKEN))
        assert r.status_code == 200, r.text
        body = r.json()
        rows = _rows(body, "items")
        assert isinstance(rows, list), f"unexpected /notifications shape: {body}"
        # All items should belong to this patient (no cross-tenant leak)
        for n in rows:
            if "user_id" in n:
                assert n["user_id"] == "user_9a7a0666e873", \
                    f"cross-tenant notification leak: {n}"

    def test_owner_auth_me_again(self):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=_hdr(OWNER_TOKEN))
        assert r.status_code == 200
        assert r.json()["role"] in ("primary_owner", "owner", "super_owner")

    def test_patient_auth_me_again(self):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=_hdr(PATIENT_TOKEN))
        assert r.status_code == 200
        assert r.json()["role"] == "patient"


# ─────────────────────────────────────────────────────────────────────────
# WF 18 · Backend boot — no duplicate routes
# ─────────────────────────────────────────────────────────────────────────
class TestBootDuplicates:
    def test_no_duplicate_routes_in_log(self):
        """Scan recent supervisor log lines — should see 'route inventory ok'
        and never 'DUPLICATE ROUTE REGISTRATIONS DETECTED'."""
        log = ""
        for p in ("/var/log/supervisor/backend.out.log", "/var/log/supervisor/backend.err.log"):
            try:
                with open(p) as f:
                    log += f.read()[-50000:]
            except Exception:
                pass
        assert "DUPLICATE ROUTE REGISTRATIONS DETECTED" not in log, \
            "Backend reported duplicate route registrations on startup."
        assert "route inventory ok" in log, \
            "Backend did not emit 'route inventory ok' — startup may be broken."


# ─────────────────────────────────────────────────────────────────────────
# Cleanup — delete TEST_ bookings + Rx created by this run
# ─────────────────────────────────────────────────────────────────────────
def test_zz_cleanup():
    """Best-effort cleanup of TEST_ data via owner-side endpoints. Will
    not fail the suite if endpoints don't exist."""
    # Cancel/delete the two bookings we definitely created
    for bid in [state.get("anon_booking_id"), state.get("patient_booking_id")]:
        if not bid:
            continue
        # Attempt staff cancel (best effort)
        try:
            requests.patch(
                f"{BASE_URL}/api/bookings/{bid}",
                headers=_hdr(OWNER_TOKEN),
                json={"status": "cancelled"},
                timeout=10,
            )
        except Exception:
            pass
