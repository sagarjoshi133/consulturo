"""Wave 1 router tests — Search, Timeline, Rx Templates, Allergies, Lab Results.

Covers:
  · A — GET /api/search?q=...
  · B — GET /api/patients/timeline?phone=...
  · C — GET/POST/PATCH/DELETE /api/rx-templates
  · D — GET/PATCH /api/patients/allergies
  · E — GET/POST/DELETE /api/lab-results + GET /api/lab-results/presets
"""
import os
import time
import pytest
import requests

BASE_URL = "http://localhost:8001"

# Owner (primary_owner) — passes require_staff & require_prescriber.
# Seeded fresh in this iteration via mongosh.
OWNER_TOKEN = os.environ.get("OWNER_TOKEN", "test_session_1781792149794")

TEST_PHONE = "+919000000123"  # E.164 form
TEST_PHONE_DIGITS = "9000000123"


def _owner_live() -> bool:
    try:
        r = requests.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {OWNER_TOKEN}"},
            timeout=3,
        )
        return r.status_code == 200
    except Exception:
        return False


@pytest.fixture(scope="module")
def owner():
    if not _owner_live():
        pytest.skip("OWNER_TOKEN stale — reseed and rerun")
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {OWNER_TOKEN}",
    })
    return s


# ── Auth gating (always run — no creds needed) ─────────────────────


class TestAuthGating:
    """All Wave 1 endpoints except presets must return 401 unauth."""

    def test_search_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/search?q=test")
        assert r.status_code == 401

    def test_timeline_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/patients/timeline?phone={TEST_PHONE_DIGITS}")
        assert r.status_code == 401

    def test_allergies_get_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/patients/allergies?phone={TEST_PHONE_DIGITS}")
        assert r.status_code == 401

    def test_allergies_patch_requires_auth(self):
        r = requests.patch(
            f"{BASE_URL}/api/patients/allergies",
            json={"phone": TEST_PHONE_DIGITS, "allergies": ["x"]},
        )
        assert r.status_code == 401

    def test_rx_templates_list_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/rx-templates")
        assert r.status_code == 401

    def test_rx_templates_post_requires_auth(self):
        r = requests.post(f"{BASE_URL}/api/rx-templates", json={"name": "x"})
        assert r.status_code == 401

    def test_lab_results_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/lab-results?phone={TEST_PHONE_DIGITS}")
        assert r.status_code == 401

    def test_lab_presets_public(self):
        r = requests.get(f"{BASE_URL}/api/lab-results/presets")
        assert r.status_code == 200
        data = r.json()
        assert "presets" in data
        assert isinstance(data["presets"], list)
        assert len(data["presets"]) >= 10
        sample = data["presets"][0]
        for f in ("key", "label", "unit", "group"):
            assert f in sample
        keys = {p["key"] for p in data["presets"]}
        assert {"psa", "creat", "hb"}.issubset(keys)


# ── A — Global Search ──────────────────────────────────────────────


class TestSearch:
    def test_search_short_query_returns_empty(self, owner):
        r = owner.get(f"{BASE_URL}/api/search?q=a")
        assert r.status_code == 200
        data = r.json()
        assert data["results"] == []

    def test_search_returns_well_formed_shape(self, owner):
        r = owner.get(f"{BASE_URL}/api/search?q=test")
        assert r.status_code == 200
        data = r.json()
        assert "q" in data and data["q"] == "test"
        assert "results" in data
        assert isinstance(data["results"], list)
        # If results present validate item shape
        for item in data["results"][:5]:
            assert "type" in item
            assert "title" in item

    def test_search_with_phone_digits(self, owner):
        r = owner.get(f"{BASE_URL}/api/search?q=9999999999")
        assert r.status_code == 200
        assert "results" in r.json()


# ── B — Patient Timeline ──────────────────────────────────────────


class TestTimeline:
    def test_timeline_requires_phone(self, owner):
        r = owner.get(f"{BASE_URL}/api/patients/timeline?phone=")
        assert r.status_code == 400

    def test_timeline_well_formed_shape(self, owner):
        r = owner.get(f"{BASE_URL}/api/patients/timeline?phone={TEST_PHONE_DIGITS}")
        assert r.status_code == 200
        data = r.json()
        for key in ("phone", "count", "events"):
            assert key in data
        assert isinstance(data["events"], list)
        assert data["count"] == len(data["events"])
        for ev in data["events"][:5]:
            for f in ("type", "ts", "title"):
                assert f in ev


# ── C — Rx Templates CRUD ─────────────────────────────────────────


class TestRxTemplates:
    template_id = None

    def test_list_templates(self, owner):
        r = owner.get(f"{BASE_URL}/api/rx-templates")
        assert r.status_code == 200
        data = r.json()
        assert "templates" in data
        assert isinstance(data["templates"], list)

    def test_create_template_blank_name_rejected(self, owner):
        r = owner.post(f"{BASE_URL}/api/rx-templates", json={"name": "  "})
        assert r.status_code == 400

    def test_create_template_success(self, owner):
        body = {
            "name": "TEST_BPH_Template",
            "diagnosis": "BPH",
            "medicines": [
                {"name": "Tamsulosin", "dose": "0.4mg", "frequency": "HS", "duration": "30d"}
            ],
            "investigations": "PSA, UFR",
            "advice": "Avoid evening fluids",
            "follow_up": "4 weeks",
        }
        r = owner.post(f"{BASE_URL}/api/rx-templates", json=body)
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc["name"] == "TEST_BPH_Template"
        assert doc["diagnosis"] == "BPH"
        assert len(doc["medicines"]) == 1
        assert doc["medicines"][0]["name"] == "Tamsulosin"
        assert doc.get("template_id", "").startswith("rxt_")
        TestRxTemplates.template_id = doc["template_id"]

        # Persistence: GET list should contain it
        r2 = owner.get(f"{BASE_URL}/api/rx-templates")
        names = [t["name"] for t in r2.json()["templates"]]
        assert "TEST_BPH_Template" in names

    def test_update_template(self, owner):
        tid = TestRxTemplates.template_id
        assert tid, "create must run first"
        body = {
            "name": "TEST_BPH_Template_v2",
            "diagnosis": "BPH severe",
            "medicines": [],
            "investigations": "",
            "advice": "",
            "follow_up": "",
        }
        r = owner.patch(f"{BASE_URL}/api/rx-templates/{tid}", json=body)
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_BPH_Template_v2"
        assert r.json()["diagnosis"] == "BPH severe"

    def test_update_template_missing_returns_404(self, owner):
        r = owner.patch(
            f"{BASE_URL}/api/rx-templates/rxt_doesnotexist",
            json={"name": "x", "medicines": []},
        )
        assert r.status_code == 404

    def test_delete_template(self, owner):
        tid = TestRxTemplates.template_id
        assert tid
        r = owner.delete(f"{BASE_URL}/api/rx-templates/{tid}")
        assert r.status_code == 200
        assert r.json().get("ok") is True

        # Re-delete returns 404
        r2 = owner.delete(f"{BASE_URL}/api/rx-templates/{tid}")
        assert r2.status_code == 404


# ── D — Patient Allergies ─────────────────────────────────────────


class TestAllergies:
    def test_get_requires_phone(self, owner):
        r = owner.get(f"{BASE_URL}/api/patients/allergies?phone=")
        assert r.status_code == 400

    def test_patch_requires_phone(self, owner):
        r = owner.patch(
            f"{BASE_URL}/api/patients/allergies",
            json={"phone": "", "allergies": ["pcm"]},
        )
        assert r.status_code == 400

    def test_set_and_get_allergies(self, owner):
        body = {
            "phone": TEST_PHONE_DIGITS,
            "allergies": ["Penicillin", "penicillin", "  ", "Sulfa"],
            "notes": "Confirmed by patient",
        }
        r = owner.patch(f"{BASE_URL}/api/patients/allergies", json=body)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["ok"] is True
        # Dedupe (case-insensitive) + strip blanks
        assert len(data["allergies"]) == 2
        assert "Penicillin" in data["allergies"] and "Sulfa" in data["allergies"]

        # GET back
        r2 = owner.get(f"{BASE_URL}/api/patients/allergies?phone={TEST_PHONE_DIGITS}")
        assert r2.status_code == 200
        got = r2.json()
        assert set(got["allergies"]) == {"Penicillin", "Sulfa"}
        assert got["notes"] == "Confirmed by patient"
        assert got.get("updated_at")


# ── E — Lab Results ───────────────────────────────────────────────


class TestLabResults:
    result_id = None

    def test_post_requires_phone(self, owner):
        r = owner.post(
            f"{BASE_URL}/api/lab-results",
            json={"phone": "", "test_name": "psa", "value": 1.0},
        )
        assert r.status_code == 400

    def test_post_requires_test_name(self, owner):
        r = owner.post(
            f"{BASE_URL}/api/lab-results",
            json={"phone": TEST_PHONE_DIGITS, "test_name": "  ", "value": 1.0},
        )
        assert r.status_code == 400

    def test_create_lab_result(self, owner):
        body = {
            "phone": TEST_PHONE_DIGITS,
            "test_name": "PSA",
            "value": 4.2,
            "unit": "ng/mL",
            "date": "2026-01-10",
            "notes": "TEST_lab",
        }
        r = owner.post(f"{BASE_URL}/api/lab-results", json=body)
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc["phone"].endswith("9000000123")
        assert doc["test_name"] == "PSA"
        assert doc["test_key"] == "psa"
        assert doc["value"] == 4.2
        assert doc["date"] == "2026-01-10"
        assert doc.get("result_id", "").startswith("lab_")
        TestLabResults.result_id = doc["result_id"]

    def test_list_lab_results_for_phone(self, owner):
        r = owner.get(f"{BASE_URL}/api/lab-results?phone={TEST_PHONE_DIGITS}")
        assert r.status_code == 200
        data = r.json()
        assert "results" in data
        assert any(x.get("test_name") == "PSA" for x in data["results"])

    def test_list_lab_results_filtered_by_test_name(self, owner):
        r = owner.get(
            f"{BASE_URL}/api/lab-results?phone={TEST_PHONE_DIGITS}&test_name=psa"
        )
        assert r.status_code == 200
        rows = r.json()["results"]
        assert rows, "expected at least 1 PSA row"
        for row in rows:
            assert row["test_key"] == "psa"

    def test_lab_result_appears_in_timeline(self, owner):
        r = owner.get(
            f"{BASE_URL}/api/patients/timeline?phone={TEST_PHONE_DIGITS}"
        )
        assert r.status_code == 200
        events = r.json()["events"]
        lab_events = [e for e in events if e.get("type") == "lab"]
        assert lab_events, "lab event must show up in timeline"
        assert any("PSA" in (e.get("title") or "") for e in lab_events)

    def test_delete_lab_result(self, owner):
        rid = TestLabResults.result_id
        assert rid
        r = owner.delete(f"{BASE_URL}/api/lab-results/{rid}")
        assert r.status_code == 200
        # Re-delete -> 404
        r2 = owner.delete(f"{BASE_URL}/api/lab-results/{rid}")
        assert r2.status_code == 404
