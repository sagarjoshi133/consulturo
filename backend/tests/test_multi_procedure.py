"""
Phase 6.2 — Multi-procedure consents & surgeries backend tests.

Verifies:
  - POST /api/surgical-consents with procedure_keys[] (multi)
  - POST /api/surgical-consents legacy single procedure_key
  - POST /api/surgical-consents invalid key → 400
  - POST /api/surgeries with procedure_keys[] (multi)
  - POST /api/surgeries legacy single procedure_key (default keys = [key])
  - GET  /api/surgical-consents/{cid} returns multi-procedure data
"""
import os
import pytest
import requests

BASE_URL = "https://urology-pro.preview.emergentagent.com"
TOKEN = "test_session_1781009714553"
HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "Content-Type": "application/json",
}


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update(HEADERS)
    return s


# Module-level state used to chain tests (Test 1 → Test 6)
_state = {}


class TestMultiProcedureConsents:
    """Phase 6.2 — Surgical consent multi-procedure support."""

    def test_1_multi_procedure_consent_save(self, api):
        payload = {
            "procedure_key": "rirs",  # required field
            "procedure_keys": ["rirs", "urs_dj"],
            "language": "en",
            "patient_name": "TEST_Multi Procedure Patient",
            "patient_phone": "+919998887777",
        }
        r = api.post(f"{BASE_URL}/api/surgical-consents", json=payload)
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        data = r.json()
        assert data.get("procedure_key") == "rirs"
        assert data.get("procedure_keys") == ["rirs", "urs_dj"]
        snaps = data.get("procedure_snapshots")
        assert isinstance(snaps, list) and len(snaps) == 2, f"Expected 2 snapshots, got {snaps}"
        # Each snapshot must contain the documented template fields.
        for snap in snaps:
            assert isinstance(snap.get("name"), dict) and "en" in snap["name"]
            assert isinstance(snap.get("procedure"), dict) and "en" in snap["procedure"]
            assert "specific_risks" in snap
            assert "alternatives" in snap
        # Back-compat: procedure_snapshot == first snapshot
        assert data.get("procedure_snapshot") == snaps[0]
        # Capture for Test 6
        _state["multi_consent_id"] = data["consent_id"]

    def test_2_legacy_single_procedure_consent(self, api):
        payload = {
            "procedure_key": "turp",
            "language": "en",
            "patient_name": "TEST_Legacy Single Patient",
            "patient_phone": "+919998886666",
        }
        r = api.post(f"{BASE_URL}/api/surgical-consents", json=payload)
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        data = r.json()
        assert data.get("procedure_key") == "turp"
        assert data.get("procedure_keys") == ["turp"], f"Expected ['turp'], got {data.get('procedure_keys')}"
        snaps = data.get("procedure_snapshots")
        assert isinstance(snaps, list) and len(snaps) == 1, f"Expected 1 snapshot, got {snaps}"
        assert data.get("procedure_snapshot") == snaps[0]

    def test_3_invalid_procedure_key_in_array(self, api):
        payload = {
            "procedure_key": "rirs",
            "procedure_keys": ["rirs", "totally_fake_key"],
            "language": "en",
            "patient_name": "TEST_Invalid Key Patient",
            "patient_phone": "+919998885555",
        }
        r = api.post(f"{BASE_URL}/api/surgical-consents", json=payload)
        assert r.status_code == 400, f"Expected 400, got {r.status_code}: {r.text}"
        err = r.json().get("detail", "")
        assert "Unknown procedure key" in err, f"Unexpected error: {err}"

    def test_6_get_consent_returns_multi_data(self, api):
        cid = _state.get("multi_consent_id")
        assert cid, "Multi-consent id missing — Test 1 may have failed"
        r = api.get(f"{BASE_URL}/api/surgical-consents/{cid}")
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        data = r.json()
        assert data.get("procedure_keys") == ["rirs", "urs_dj"]
        snaps = data.get("procedure_snapshots")
        assert isinstance(snaps, list) and len(snaps) == 2


class TestMultiProcedureSurgeries:
    """Phase 6.2 — Surgery multi-procedure support."""

    def test_4_multi_procedure_surgery_save(self, api):
        payload = {
            "patient_phone": "+919998884444",
            "patient_name": "TEST_Multi Surgery Patient",
            "surgery_name": "RIRS + URS+DJ",
            "date": "2026-06-15",
            "scheduled_date": "2026-06-15",
            "scheduled_time": "10:00",
            "ot_room": "OT-1",
            "estimated_duration_min": 135,
            "surgery_status": "scheduled",
            "procedure_key": "rirs",
            "procedure_keys": ["rirs", "urs_dj"],
        }
        r = api.post(f"{BASE_URL}/api/surgeries", json=payload)
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        data = r.json()
        assert data.get("procedure_keys") == ["rirs", "urs_dj"], (
            f"Expected ['rirs','urs_dj'], got {data.get('procedure_keys')}"
        )
        assert data.get("procedure_key") == "rirs"
        assert data.get("surgery_name") == "RIRS + URS+DJ"
        assert data.get("estimated_duration_min") == 135
        # Cleanup
        sid = data.get("surgery_id")
        if sid:
            api.delete(f"{BASE_URL}/api/surgeries/{sid}")

    def test_5_legacy_single_procedure_surgery(self, api):
        payload = {
            "patient_phone": "+919998883333",
            "patient_name": "TEST_Legacy Surgery Patient",
            "surgery_name": "TURP",
            "date": "2026-06-16",
            "scheduled_date": "2026-06-16",
            "scheduled_time": "09:00",
            "ot_room": "OT-1",
            "estimated_duration_min": 60,
            "surgery_status": "scheduled",
            "procedure_key": "turp",
            # NOTE: no procedure_keys
        }
        r = api.post(f"{BASE_URL}/api/surgeries", json=payload)
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        data = r.json()
        assert data.get("procedure_keys") == ["turp"], (
            f"Backend should default procedure_keys to ['turp'], got {data.get('procedure_keys')}"
        )
        assert data.get("procedure_key") == "turp"
        # Cleanup
        sid = data.get("surgery_id")
        if sid:
            api.delete(f"{BASE_URL}/api/surgeries/{sid}")
