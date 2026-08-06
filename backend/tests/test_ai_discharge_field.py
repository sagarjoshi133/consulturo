"""Backend tests for AI per-field discharge summary generation.

POST /api/ai/ipd/{admission_id}/discharge-field
"""
from __future__ import annotations

import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL") or os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL", "https://urology-pro.preview.emergentagent.com"
).rstrip("/")
TOKEN = "test_session_1781009714553"  # Dr. Sagar Joshi (primary_owner)
ADMISSION_ID = "c972c9c9-8771-495b-a76c-faed56be80f1"  # IPD260609001 (Sagar P)

HEADERS = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {TOKEN}",
}
ENDPOINT = f"{BASE_URL}/api/ai/ipd/{ADMISSION_ID}/discharge-field"
LLM_TIMEOUT = 120  # Claude can take ~30s on long contexts


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update(HEADERS)
    return s


# ── Per-field happy-path tests ───────────────────────────────────

def _post(session, field, extra_hint=None, admission_id=None):
    url = (
        f"{BASE_URL}/api/ai/ipd/{admission_id}/discharge-field"
        if admission_id
        else ENDPOINT
    )
    payload = {"field": field}
    if extra_hint is not None:
        payload["extra_hint"] = extra_hint
    return session.post(url, json=payload, timeout=LLM_TIMEOUT)


def _check_ok(resp, expected_field):
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text[:500]}"
    data = resp.json()
    assert data.get("field") == expected_field, f"field mismatch: {data}"
    assert data.get("model") == "claude-sonnet-4-5", f"model mismatch: {data.get('model')}"
    text = (data.get("text") or "").strip()
    assert text, f"Empty text returned: {data}"
    return data, text


class TestDischargeFieldGeneration:

    def test_1_course_in_hospital(self, session):
        resp = _post(session, "course_in_hospital")
        data, text = _check_ok(resp, "course_in_hospital")
        # Expect 4-8 sentences (rough sentence count via period+space)
        sentence_like = text.count(". ") + text.count(".\n") + text.count("!\n") + text.count("?\n")
        print(f"\n[course_in_hospital] len={len(text)} sentences~={sentence_like}\nTEXT:\n{text[:1200]}")
        assert len(text) > 80, f"Narrative too short: {text}"

    def test_2_operative_notes(self, session):
        resp = _post(session, "operative_notes")
        data, text = _check_ok(resp, "operative_notes")
        upper = text.upper()
        print(f"\n[operative_notes] len={len(text)}\nTEXT:\n{text[:1500]}")
        # Verify required section labels appear
        required = ["DATE:", "SURGEON:", "ANAESTHESIA:", "POSITION:",
                    "PROCEDURE:", "CLOSURE:", "POST-OP ORDERS:"]
        missing = [k for k in required if k not in upper]
        assert not missing, f"Missing operative-note sections: {missing}\nText:\n{text}"

    def test_3_discharge_meds(self, session):
        resp = _post(session, "discharge_meds")
        data, text = _check_ok(resp, "discharge_meds")
        print(f"\n[discharge_meds] len={len(text)}\nTEXT:\n{text[:1500]}")
        # Expect at least 2 lines (drugs one per line)
        lines = [l for l in text.splitlines() if l.strip()]
        assert len(lines) >= 2, f"Expected multiple drug lines, got: {lines}"

    def test_4_condition_at_discharge(self, session):
        resp = _post(session, "condition_at_discharge")
        data, text = _check_ok(resp, "condition_at_discharge")
        print(f"\n[condition_at_discharge] len={len(text)}\nTEXT:\n{text}")
        # 1-2 sentences expected; should be short but non-empty
        assert 20 < len(text) < 800, f"Length out of expected range: {len(text)}"

    def test_5_diet_advice(self, session):
        resp = _post(session, "diet_advice")
        data, text = _check_ok(resp, "diet_advice")
        print(f"\n[diet_advice] len={len(text)}\nTEXT:\n{text}")
        assert 30 < len(text) < 1500

    def test_6_follow_up_plan(self, session):
        resp = _post(session, "follow_up_plan")
        data, text = _check_ok(resp, "follow_up_plan")
        print(f"\n[follow_up_plan] len={len(text)}\nTEXT:\n{text}")
        lines = [l for l in text.splitlines() if l.strip()]
        assert len(lines) >= 3, f"Expected 3-5 lines, got: {lines}"


# ── Negative-path tests ──────────────────────────────────────────

class TestDischargeFieldErrors:

    def test_7_invalid_field_name(self, session):
        resp = _post(session, "nonsense_field")
        print(f"\n[invalid_field] status={resp.status_code} body={resp.text[:400]}")
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"
        detail = (resp.json().get("detail") or "").lower()
        assert "unknown field" in detail, f"Expected 'Unknown field' detail, got: {detail}"

    def test_8_non_existent_admission(self, session):
        resp = _post(
            session, "course_in_hospital",
            admission_id="admission_that_does_not_exist",
        )
        print(f"\n[bad_admission] status={resp.status_code} body={resp.text[:400]}")
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}: {resp.text}"

    def test_9_unauthorized_no_token(self):
        """POST without an Authorization header must be rejected with 401."""
        resp = requests.post(
            ENDPOINT,
            json={"field": "course_in_hospital"},
            headers={"Content-Type": "application/json"},
            timeout=10,
        )
        print(f"\n[unauth_no_token] status={resp.status_code} body={resp.text[:400]}")
        assert resp.status_code == 401, (
            f"Expected 401, got {resp.status_code}: {resp.text}"
        )

    def test_10_unauthorized_bad_token(self):
        """POST with a bogus bearer token must be rejected with 401."""
        resp = requests.post(
            ENDPOINT,
            json={"field": "course_in_hospital"},
            headers={
                "Content-Type": "application/json",
                "Authorization": "Bearer not_a_real_session_token_xxx",
            },
            timeout=10,
        )
        print(f"\n[unauth_bad_token] status={resp.status_code} body={resp.text[:400]}")
        assert resp.status_code == 401, (
            f"Expected 401, got {resp.status_code}: {resp.text}"
        )


# ── Extra-hint pass-through ──────────────────────────────────────

class TestDischargeFieldHint:

    def test_9_extra_hint_reflected(self, session):
        hint = "Patient also has diabetes, please tailor diet for sugar control."
        resp = _post(session, "diet_advice", extra_hint=hint)
        data, text = _check_ok(resp, "diet_advice")
        print(f"\n[diet_advice+hint] len={len(text)}\nTEXT:\n{text}")
        lc = text.lower()
        keywords = ("diabet", "sugar", "carb", "glyc", "glucose")
        assert any(k in lc for k in keywords), (
            f"Diet text didn't reflect diabetes hint. Keywords {keywords} not found.\nText:\n{text}"
        )
