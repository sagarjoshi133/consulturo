"""Iteration 33 — Collection/PendingDues + Encounter billing lifecycle.

Verifies the new Daily-Collection endpoints and lifecycle transitions:
  · GET  /api/encounters/collection-summary?date=...
  · GET  /api/encounters/pending-dues?days=...
  · POST /api/encounters/{id}/start-consultation stamps fee (500 default)
  · POST /api/receipts creates a receipt → encounter flips to paid
  · POST /api/encounters/{id}/waive marks waived; waived is in waived_total
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

import pytest
import requests

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://urology-pro.preview.emergentagent.com").rstrip("/")
TOKEN = "test_session_1781800271528"
CLINIC = "clinic_a97b903f2fb2"

HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "X-Clinic-Id": CLINIC,
    "Content-Type": "application/json",
}


def _ist_today() -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)).strftime("%Y-%m-%d")


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update(HEADERS)
    return s


@pytest.fixture(scope="module")
def created_ids() -> List[str]:
    return []


# ── Sanity ───────────────────────────────────────────────────────────

def test_auth_me(api):
    r = api.get(f"{BASE}/api/auth/me")
    assert r.status_code == 200, r.text
    j = r.json()
    assert j.get("email") == "sagar.joshi133@gmail.com"


# ── Collection-summary basic shape ──────────────────────────────────

def test_collection_summary_shape(api):
    day = _ist_today()
    r = api.get(f"{BASE}/api/encounters/collection-summary", params={"date": day})
    assert r.status_code == 200, r.text
    j = r.json()
    for k in ("date", "collected", "pending_due", "waived_total", "counts", "pending_list"):
        assert k in j, f"missing key {k} in {j}"
    for k in ("paid", "pending", "waived", "total"):
        assert k in j["counts"], f"missing counts.{k}"
    assert j["date"] == day
    assert isinstance(j["pending_list"], list)


# ── Pending-dues basic shape ────────────────────────────────────────

def test_pending_dues_shape(api):
    r = api.get(f"{BASE}/api/encounters/pending-dues", params={"days": 7})
    assert r.status_code == 200, r.text
    j = r.json()
    assert "items" in j and "count" in j and "total_due" in j
    for it in j["items"]:
        assert float(it.get("fee_amount") or 0) > 0, "pending-dues must have fee>0"
    # count matches items length
    assert j["count"] == len(j["items"])


# ── E2E: create encounter → start-consult → verify pending → pay → verify collected ──

def test_pending_flow_e2e(api, created_ids):
    day = _ist_today()

    # baseline
    base_summary = api.get(f"{BASE}/api/encounters/collection-summary", params={"date": day}).json()
    base_pending_due = float(base_summary["pending_due"])
    base_collected = float(base_summary["collected"])
    base_pending_count = base_summary["counts"]["pending"]

    # 1. Create encounter
    payload = {"patient_name": "TEST_CollectFlow One", "patient_phone": "+919000000101"}
    r = api.post(f"{BASE}/api/encounters", json=payload)
    assert r.status_code == 200, r.text
    enc = r.json()
    eid = enc["encounter_id"]
    created_ids.append(eid)

    # 2. Start consultation (stamps fee 500)
    r = api.post(f"{BASE}/api/encounters/{eid}/start-consultation")
    assert r.status_code == 200, r.text
    enc2 = r.json()
    assert enc2["stage"] == "in_consultation"
    assert float(enc2["fee_amount"]) == 500.0
    assert enc2["payment_status"] == "pending"

    # 3. Summary should now show +500 pending, encounter in list
    summ = api.get(f"{BASE}/api/encounters/collection-summary", params={"date": day}).json()
    assert float(summ["pending_due"]) == pytest.approx(base_pending_due + 500.0, abs=0.01), summ
    ids_in_list = [d["encounter_id"] for d in summ["pending_list"]]
    assert eid in ids_in_list, f"{eid} missing from pending_list"
    assert summ["counts"]["pending"] >= base_pending_count + 1

    # 4. Also present in /pending-dues
    pd = api.get(f"{BASE}/api/encounters/pending-dues", params={"days": 7}).json()
    pd_ids = [it["encounter_id"] for it in pd["items"]]
    assert eid in pd_ids

    # 5. Post a receipt clearing the fee
    receipt_payload = {
        "patient_name": "TEST_CollectFlow One",
        "patient_phone": "+919000000101",
        "encounter_id": eid,
        "items": [{"description": "Consultation", "amount": 500, "service_type": "consultation"}],
        "paid": 500,
        "payment_method": "cash",
    }
    r = api.post(f"{BASE}/api/receipts", json=receipt_payload)
    assert r.status_code in (200, 201), r.text

    # 6. Verify encounter now paid + collected increased + not in pending_list
    enc_after = api.get(f"{BASE}/api/encounters/{eid}").json()
    assert enc_after["payment_status"] == "paid", enc_after

    summ2 = api.get(f"{BASE}/api/encounters/collection-summary", params={"date": day}).json()
    assert float(summ2["collected"]) >= base_collected + 500.0 - 0.01, summ2
    remaining = [d["encounter_id"] for d in summ2["pending_list"]]
    assert eid not in remaining, "encounter should leave pending_list after payment"


# ── Waive flow: waived counted in waived_total, NOT in pending_due ──

def test_waive_flow(api, created_ids):
    day = _ist_today()
    base = api.get(f"{BASE}/api/encounters/collection-summary", params={"date": day}).json()
    base_waived = float(base["waived_total"])
    base_pending_due = float(base["pending_due"])

    # Create + start-consult
    r = api.post(f"{BASE}/api/encounters", json={"patient_name": "TEST_CollectFlow Waive", "patient_phone": "+919000000102"})
    assert r.status_code == 200
    eid = r.json()["encounter_id"]
    created_ids.append(eid)
    api.post(f"{BASE}/api/encounters/{eid}/start-consultation")

    # Waive
    r = api.post(f"{BASE}/api/encounters/{eid}/waive")
    assert r.status_code == 200, r.text
    assert r.json()["payment_status"] == "waived"

    # Verify: appears in waived total, NOT in pending list
    summ = api.get(f"{BASE}/api/encounters/collection-summary", params={"date": day}).json()
    assert float(summ["waived_total"]) >= base_waived + 500.0 - 0.01, summ
    # pending_due should NOT have increased for this encounter
    assert float(summ["pending_due"]) <= base_pending_due + 0.01, "pending_due should not grow for waived"
    pending_ids = [d["encounter_id"] for d in summ["pending_list"]]
    assert eid not in pending_ids, "waived encounter must NOT appear in pending_list"


# ── Route ordering — collection-summary must NOT collide with /{id} ──

def test_route_ordering(api):
    """Make sure the string 'collection-summary' is not treated as encounter_id."""
    r = api.get(f"{BASE}/api/encounters/collection-summary")
    assert r.status_code == 200
    r = api.get(f"{BASE}/api/encounters/pending-dues")
    assert r.status_code == 200


# ── Cleanup ─────────────────────────────────────────────────────────

def test_zzz_cleanup(api, created_ids):
    for eid in created_ids:
        try:
            api.delete(f"{BASE}/api/encounters/{eid}")
        except Exception:
            pass
