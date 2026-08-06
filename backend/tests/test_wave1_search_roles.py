"""Wave 1 patch — role-aware /api/search tests.

Validates:
  · STAFF token → scope=staff with clinical result types (patient/booking/prescription/surgery/ipd)
  · PATIENT token → scope=patient with content types + own my_booking/my_prescription
  · Patient search MUST NOT leak other patients' records (security check)
  · Auth gating (401 when unauth)
"""
import os
import pytest
import requests

BASE_URL = "http://localhost:8001"

OWNER_TOKEN = os.environ.get("OWNER_TOKEN", "test_session_1781792149794")
PATIENT_TOKEN = os.environ.get("PATIENT_TOKEN", "test_pat_w2_1781793521021")

# Seed values (must match seed inserted via mongosh)
OWN_PATIENT_NAME = "Wave2 Patient"
OWN_PATIENT_PHONE_LAST10 = "8888888888"
OTHER_PATIENT_NAME = "OtherSecret PatientZZZ"
OTHER_PATIENT_PHONE_LAST10 = "7777777777"
OTHER_PATIENT_PHONE_DIGITS_PARTIAL = "7777777"

PATIENT_RESULT_TYPES = {
    "disease", "education", "guide", "blog", "calculator",
    "my_booking", "my_prescription",
}
STAFF_RESULT_TYPES = {
    "patient", "booking", "prescription", "surgery", "ipd",
}


def _live(token: str) -> bool:
    try:
        r = requests.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {token}"},
            timeout=3,
        )
        return r.status_code == 200
    except Exception:
        return False


@pytest.fixture(scope="module")
def staff():
    if not _live(OWNER_TOKEN):
        pytest.skip("OWNER_TOKEN stale — reseed and rerun")
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {OWNER_TOKEN}",
    })
    return s


@pytest.fixture(scope="module")
def patient():
    if not _live(PATIENT_TOKEN):
        pytest.skip("PATIENT_TOKEN stale — reseed and rerun")
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {PATIENT_TOKEN}",
    })
    return s


# ── Auth gating ──────────────────────────────────────────────────


class TestSearchAuth:
    def test_search_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/search?q=bph")
        assert r.status_code == 401


# ── Staff scope ──────────────────────────────────────────────────


class TestStaffSearch:
    def test_staff_scope_label(self, staff):
        r = staff.get(f"{BASE_URL}/api/search?q=bph")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("scope") == "staff"
        assert "results" in data and isinstance(data["results"], list)

    def test_staff_can_search_patients_by_name(self, staff):
        # OtherSecret PatientZZZ was seeded
        r = staff.get(f"{BASE_URL}/api/search?q=OtherSecret")
        assert r.status_code == 200
        data = r.json()
        assert data["scope"] == "staff"
        # Must include at least one patient-typed result for the seeded record
        types = {item["type"] for item in data["results"]}
        # The seed inserted a patient row + a booking + a prescription with this name
        assert "patient" in types or "booking" in types, (
            f"expected staff search to find seeded record: {data['results']}"
        )
        # Only clinical types allowed in staff scope (calculator/disease etc must NOT appear)
        assert types.issubset(STAFF_RESULT_TYPES), f"unexpected types in staff scope: {types}"

    def test_staff_can_search_by_phone_digits(self, staff):
        r = staff.get(f"{BASE_URL}/api/search?q={OTHER_PATIENT_PHONE_LAST10}")
        assert r.status_code == 200
        data = r.json()
        assert data["scope"] == "staff"
        # At least one booking/patient/prescription should come back tied to this phone
        assert data["results"], "staff phone-digits search returned nothing"

    def test_staff_short_query_empty(self, staff):
        r = staff.get(f"{BASE_URL}/api/search?q=a")
        assert r.status_code == 200
        assert r.json()["results"] == []


# ── Patient scope ────────────────────────────────────────────────


class TestPatientSearch:
    def test_patient_scope_label(self, patient):
        r = patient.get(f"{BASE_URL}/api/search?q=bph")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("scope") == "patient"
        assert "results" in data and isinstance(data["results"], list)

    def test_patient_result_types_are_allowed_subset(self, patient):
        # 'bph' should match diseases / education / guides content
        r = patient.get(f"{BASE_URL}/api/search?q=bph")
        assert r.status_code == 200
        data = r.json()
        types = {item["type"] for item in data["results"]}
        assert types, "expected at least some content matches for 'bph'"
        assert types.issubset(PATIENT_RESULT_TYPES), (
            f"patient scope returned forbidden types: {types - PATIENT_RESULT_TYPES}"
        )
        # 'patient' type must never appear for patient scope
        assert "patient" not in types
        assert "booking" not in types
        assert "prescription" not in types

    def test_patient_sees_own_booking(self, patient):
        # Own booking has reason="BPH followup" — should appear as my_booking
        r = patient.get(f"{BASE_URL}/api/search?q=followup")
        assert r.status_code == 200
        data = r.json()
        types = [item["type"] for item in data["results"]]
        my_b = [i for i in data["results"] if i["type"] == "my_booking"]
        assert my_b, f"patient should see own booking; got types={types}"

    def test_patient_sees_own_prescription(self, patient):
        # Own Rx has diagnosis="BPH"
        r = patient.get(f"{BASE_URL}/api/search?q=BPH")
        assert r.status_code == 200
        data = r.json()
        my_rx = [i for i in data["results"] if i["type"] == "my_prescription"]
        assert my_rx, "patient should see own prescription matched by diagnosis"

    def test_patient_calculator_searchable(self, patient):
        r = patient.get(f"{BASE_URL}/api/search?q=IPSS")
        assert r.status_code == 200
        data = r.json()
        types = {item["type"] for item in data["results"]}
        assert "calculator" in types, f"expected calculator result for IPSS; got {types}"
        # Re-confirm: no clinical leak
        assert types.issubset(PATIENT_RESULT_TYPES)


# ── Security — Patient search MUST NOT leak others ──────────────


class TestPatientNoLeak:
    """Critical security checks: patient must NEVER see other patients' data."""

    def test_no_leak_when_searching_other_patient_name(self, patient):
        r = patient.get(f"{BASE_URL}/api/search?q=OtherSecret")
        assert r.status_code == 200
        data = r.json()
        assert data["scope"] == "patient"
        for item in data["results"]:
            # No 'patient' type result period
            assert item["type"] != "patient", f"LEAK: patient row returned: {item}"
            # No clinical booking/prescription types either
            assert item["type"] not in ("booking", "prescription", "surgery", "ipd"), (
                f"LEAK: staff-type result returned to patient: {item}"
            )
            # No my_booking/my_prescription matching the other patient
            if item["type"] in ("my_booking", "my_prescription"):
                title = (item.get("title") or "").lower()
                subtitle = (item.get("subtitle") or "").lower()
                assert OTHER_PATIENT_NAME.lower() not in title + subtitle, (
                    f"LEAK: other patient name surfaced in own record: {item}"
                )

    def test_no_leak_when_searching_other_patient_phone(self, patient):
        # Search for other patient's phone digits
        r = patient.get(f"{BASE_URL}/api/search?q={OTHER_PATIENT_PHONE_LAST10}")
        assert r.status_code == 200
        data = r.json()
        assert data["scope"] == "patient"
        for item in data["results"]:
            assert item["type"] != "patient", f"LEAK: patient row by phone: {item}"
            assert item["type"] not in ("booking", "prescription", "surgery", "ipd"), (
                f"LEAK: clinical record by phone: {item}"
            )
            # my_booking/my_prescription only ever for the logged-in patient's phone
            # so they must NOT mention the other phone
            blob = f"{item.get('title','')} {item.get('subtitle','')} {item.get('link','')}".lower()
            assert OTHER_PATIENT_PHONE_LAST10 not in blob, (
                f"LEAK: other patient phone surfaced: {item}"
            )

    def test_no_leak_partial_phone(self, patient):
        r = patient.get(f"{BASE_URL}/api/search?q={OTHER_PATIENT_PHONE_DIGITS_PARTIAL}")
        assert r.status_code == 200
        data = r.json()
        for item in data["results"]:
            assert item["type"] != "patient"
            assert item["type"] not in ("booking", "prescription", "surgery", "ipd")
