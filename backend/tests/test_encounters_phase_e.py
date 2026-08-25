"""ConsultUro Phase E — Clinical Core tests
Covers: encounters CRUD/pagination/search, diagnosis registry,
prescription linkage, AI dictation validation, and pagination
regression on /bookings/all, /surgeries, /prescriptions."""
import io
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://urology-pro.preview.emergentagent.com").rstrip("/")
OWNER = "test_session_1781009714553"
DOCTOR = "doctor_token_1776494002376"
PATIENT = "patient_token_1776494002311"


def _auth(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def created_ids():
    return {"encounters": [], "prescriptions": []}


# ── Encounters CRUD ────────────────────────────────────────────
class TestEncountersCRUD:
    def test_create_encounter_full_body(self, created_ids):
        body = {
            "patient_name": f"TEST_Patient_{uuid.uuid4().hex[:6]}",
            "patient_phone": "9998887771",
            "patient_age": "55",
            "patient_sex": "Male",
            "chief_complaint": "Burning micturition",
            "subjective": "3 days duration",
            "objective": "Afebrile, abdomen soft",
            "assessment": "UTI",
            "plan": "Nitrofurantoin, review 5d",
            "vitals": {"bp": "120/80", "pulse": "78", "temp": "98.6", "spo2": "99", "weight": "70"},
            "diagnoses": ["BPH", "Renal calculus"],
        }
        r = requests.post(f"{BASE_URL}/api/encounters", json=body, headers=_auth(OWNER))
        assert r.status_code in (200, 201), r.text
        d = r.json()
        assert d.get("encounter_id", "").startswith("enc_")
        assert d["patient_name"] == body["patient_name"]
        assert set(d["diagnoses"]) == {"BPH", "Renal calculus"}
        assert d["vitals"]["bp"] == "120/80"
        assert d["prescription_id"] is None
        created_ids["encounters"].append(d["encounter_id"])
        created_ids["_first_body"] = body

    def test_unauth_401(self):
        r = requests.post(f"{BASE_URL}/api/encounters", json={"patient_name": "X"})
        assert r.status_code == 401

    def test_list_encounters_paginated(self):
        r = requests.get(f"{BASE_URL}/api/encounters?limit=2&skip=0", headers=_auth(OWNER))
        assert r.status_code == 200
        d = r.json()
        assert "items" in d and "total" in d and "has_more" in d
        assert isinstance(d["items"], list)
        assert len(d["items"]) <= 2
        assert isinstance(d["total"], int)

    def test_list_encounters_search_q(self, created_ids):
        body = created_ids.get("_first_body")
        name_frag = body["patient_name"][5:15]  # substring
        r = requests.get(f"{BASE_URL}/api/encounters", params={"q": name_frag}, headers=_auth(OWNER))
        assert r.status_code == 200
        items = r.json()["items"]
        assert any(name_frag in i["patient_name"] for i in items)

    def test_get_encounter_detail(self, created_ids):
        eid = created_ids["encounters"][0]
        r = requests.get(f"{BASE_URL}/api/encounters/{eid}", headers=_auth(OWNER))
        assert r.status_code == 200
        d = r.json()
        assert d["encounter_id"] == eid
        assert d["chief_complaint"] == "Burning micturition"
        assert d["vitals"]["bp"] == "120/80"

    def test_patch_encounter(self, created_ids):
        eid = created_ids["encounters"][0]
        r = requests.patch(f"{BASE_URL}/api/encounters/{eid}",
                           json={"assessment": "UTI + prostatism", "diagnoses": ["BPH", "UTI"]},
                           headers=_auth(OWNER))
        assert r.status_code == 200
        d = r.json()
        assert d["assessment"] == "UTI + prostatism"
        assert set(d["diagnoses"]) == {"BPH", "UTI"}

    def test_delete_by_non_author_non_owner_403(self, created_ids):
        # Create encounter as OWNER, try delete as DOCTOR (staff, non-owner, not author)
        body = {"patient_name": f"TEST_DelPerm_{uuid.uuid4().hex[:6]}"}
        r = requests.post(f"{BASE_URL}/api/encounters", json=body, headers=_auth(OWNER))
        assert r.status_code in (200, 201)
        eid = r.json()["encounter_id"]
        created_ids["encounters"].append(eid)
        r2 = requests.delete(f"{BASE_URL}/api/encounters/{eid}", headers=_auth(DOCTOR))
        # Owner-tier check: DOCTOR is non-owner staff, non-author → expect 403
        assert r2.status_code == 403, r2.text

    def test_delete_by_owner_ok(self, created_ids):
        body = {"patient_name": f"TEST_DelOK_{uuid.uuid4().hex[:6]}"}
        r = requests.post(f"{BASE_URL}/api/encounters", json=body, headers=_auth(OWNER))
        eid = r.json()["encounter_id"]
        r2 = requests.delete(f"{BASE_URL}/api/encounters/{eid}", headers=_auth(OWNER))
        assert r2.status_code == 200
        # verify gone
        r3 = requests.get(f"{BASE_URL}/api/encounters/{eid}", headers=_auth(OWNER))
        assert r3.status_code == 404


# ── Diagnosis Registry ─────────────────────────────────────────
class TestDiagnosisRegistry:
    def test_list_diagnoses(self):
        r = requests.get(f"{BASE_URL}/api/diagnoses", headers=_auth(OWNER))
        assert r.status_code == 200
        items = r.json()["items"]
        assert isinstance(items, list)
        labels = {i["label"] for i in items}
        # After encounters above, BPH should be present
        assert "BPH" in labels
        # sorted by usage_count desc
        counts = [i.get("usage_count", 0) for i in items]
        assert counts == sorted(counts, reverse=True)

    def test_filter_q(self):
        r = requests.get(f"{BASE_URL}/api/diagnoses?q=bp", headers=_auth(OWNER))
        assert r.status_code == 200
        items = r.json()["items"]
        for i in items:
            assert "bp" in i["label"].lower()


# ── Rx Linkage ─────────────────────────────────────────────────
class TestRxLinkage:
    def test_link_rx_to_encounter(self, created_ids):
        # Create prescription (staff = doctor works)
        rx_body = {
            "patient_name": "TEST_RxLink",
            "patient_phone": "9998887771",
            "diagnosis": "BPH",
            "visit_date": "2026-01-15",
            "medications": [{"name": "Tamsulosin", "dose": "0.4 mg", "frequency": "OD", "duration": "30 days"}],
        }
        r = requests.post(f"{BASE_URL}/api/prescriptions", json=rx_body, headers=_auth(OWNER))
        assert r.status_code in (200, 201), r.text
        rx_id = r.json().get("prescription_id") or r.json().get("id")
        assert rx_id
        created_ids["prescriptions"].append(rx_id)

        eid = created_ids["encounters"][0]
        r2 = requests.post(f"{BASE_URL}/api/encounters/{eid}/link-rx",
                           json={"prescription_id": rx_id}, headers=_auth(OWNER))
        assert r2.status_code == 200
        # Verify persistence
        enc = requests.get(f"{BASE_URL}/api/encounters/{eid}", headers=_auth(OWNER)).json()
        assert enc["prescription_id"] == rx_id
        rx = requests.get(f"{BASE_URL}/api/prescriptions/{rx_id}", headers=_auth(OWNER))
        if rx.status_code == 200:
            assert rx.json().get("encounter_id") == eid

    def test_link_bad_rx_404(self, created_ids):
        eid = created_ids["encounters"][0]
        r = requests.post(f"{BASE_URL}/api/encounters/{eid}/link-rx",
                          json={"prescription_id": "rx_doesnotexist"}, headers=_auth(OWNER))
        assert r.status_code == 404


# ── AI Dictation validation ────────────────────────────────────
class TestAIDictation:
    def test_empty_audio_400(self):
        files = {"audio": ("empty.m4a", b"", "audio/m4a")}
        r = requests.post(f"{BASE_URL}/api/ai/encounter-dictation",
                          files=files,
                          headers={"Authorization": f"Bearer {OWNER}"})
        assert r.status_code == 400, r.text

    def test_unauth_401(self):
        files = {"audio": ("x.m4a", b"abc", "audio/m4a")}
        r = requests.post(f"{BASE_URL}/api/ai/encounter-dictation", files=files)
        assert r.status_code == 401


# ── Pagination regression ──────────────────────────────────────
class TestPaginationRegression:
    def test_bookings_all_default_is_array(self):
        r = requests.get(f"{BASE_URL}/api/bookings/all", headers=_auth(OWNER))
        assert r.status_code == 200
        assert isinstance(r.json(), list), "default must remain plain array (backward compat)"

    def test_bookings_all_limit_skip(self):
        r = requests.get(f"{BASE_URL}/api/bookings/all?limit=2&skip=0", headers=_auth(OWNER))
        assert r.status_code == 200
        d = r.json()
        assert isinstance(d, list) and len(d) <= 2

    def test_bookings_status_filter(self):
        r = requests.get(f"{BASE_URL}/api/bookings/all?status=requested&limit=10", headers=_auth(OWNER))
        assert r.status_code == 200
        for row in r.json():
            assert row.get("status") == "requested"

    def test_surgeries_default_is_array(self):
        r = requests.get(f"{BASE_URL}/api/surgeries", headers=_auth(OWNER))
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_surgeries_limit(self):
        r = requests.get(f"{BASE_URL}/api/surgeries?limit=1", headers=_auth(OWNER))
        assert r.status_code == 200
        assert isinstance(r.json(), list) and len(r.json()) <= 1

    def test_surgeries_search_q(self):
        # Just verify the endpoint accepts q param
        r = requests.get(f"{BASE_URL}/api/surgeries?q=test&limit=5", headers=_auth(OWNER))
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_prescriptions_default_is_array(self):
        r = requests.get(f"{BASE_URL}/api/prescriptions", headers=_auth(OWNER))
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_prescriptions_limit_skip(self):
        r = requests.get(f"{BASE_URL}/api/prescriptions?limit=2&skip=1", headers=_auth(OWNER))
        assert r.status_code == 200
        assert isinstance(r.json(), list) and len(r.json()) <= 2
