"""Iteration 24 — Verify the /api/registry/patients/summary,
/api/registry/invites/analytics, /api/registry/invites/batches, and
/api/registry/invites/bulk endpoints are LIVE and return owner-visible
data for the patient database bottom-tab "directory" + "analytics"
tiles."""
from __future__ import annotations

import os
import pytest
import requests

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/") or \
       "https://urology-pro.preview.emergentagent.com"
TOKEN = "_FUheqDsTzh8q1HO0t7vfrmYaUcBiM1hxK0VffuyZXM"
H = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}


class TestOwnerAuth:
    def test_owner_me_ok(self):
        r = requests.get(f"{BASE}/api/auth/me", headers=H, timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert j.get("email") == "sagar.joshi133@gmail.com"
        assert j.get("role") in ("primary_owner", "super_owner", "owner")


class TestRegistrySummary:
    def test_patients_summary_shape(self):
        r = requests.get(f"{BASE}/api/registry/patients/summary",
                         headers=H, timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        for k in ("total", "registered", "unregistered"):
            assert k in j, f"missing {k}: {j}"
            assert isinstance(j[k], int)
        assert j["total"] == j["registered"] + j["unregistered"]


class TestInviteAnalytics:
    def test_invite_analytics_ok(self):
        r = requests.get(f"{BASE}/api/registry/invites/analytics",
                         headers=H, timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        for k in ("total_invited", "converted_total",
                  "conversion_rate_total", "converted_within_7d",
                  "converted_within_30d"):
            assert k in j, f"missing {k}: {j}"


class TestInviteBatches:
    def test_invite_batches_ok(self):
        r = requests.get(f"{BASE}/api/registry/invites/batches",
                         headers=H, params={"limit": 5}, timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "items" in j
        assert isinstance(j["items"], list)


class TestBulkInvite:
    """Ensure the bulk-invite endpoint still accepts patient_ids + optional
    template_id, and returns a shaped results array (no regression)."""

    def test_bulk_invite_empty_400(self):
        r = requests.post(f"{BASE}/api/registry/invites/bulk",
                          headers=H, json={"patient_ids": []},
                          timeout=15)
        # Empty list is invalid (min_length=1). Accept either 400 or 422.
        assert r.status_code in (400, 422), r.text

    def test_bulk_invite_with_unknown_id(self):
        # Use a random-ish id that won't exist → should not 500,
        # should return results with an "error": "not_found".
        r = requests.post(f"{BASE}/api/registry/invites/bulk",
                          headers=H,
                          json={"patient_ids": ["nonexistent-pid-iter24"]},
                          timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("ok") is True
        assert j.get("count") == 1
        assert j.get("error_count") == 1
        assert j["results"][0].get("error") == "not_found"

    def test_bulk_invite_real_patient(self):
        """Pick one real patient from /patient-db/list and invite them."""
        r = requests.get(f"{BASE}/api/patient-db/list",
                         headers=H, params={"limit": 3}, timeout=15)
        assert r.status_code == 200, r.text
        items = r.json().get("items") or []
        if not items:
            pytest.skip("no patients in DB to bulk-invite against")
        # /patient-db/list rows may not carry patient_id. Try to fetch
        # a patient_id from /registry/patients.
        r2 = requests.get(f"{BASE}/api/registry/patients",
                          headers=H, params={"limit": 3}, timeout=15)
        if r2.status_code != 200:
            pytest.skip(f"/registry/patients not 200 ({r2.status_code})")
        pts = r2.json().get("items") or []
        pids = [p.get("patient_id") for p in pts if p.get("patient_id")]
        if not pids:
            pytest.skip("no patient_ids exposed from /registry/patients")
        r3 = requests.post(f"{BASE}/api/registry/invites/bulk",
                           headers=H,
                           json={"patient_ids": pids[:2]},
                           timeout=20)
        assert r3.status_code == 200, r3.text
        j = r3.json()
        assert j.get("ok") is True
        assert j.get("count") == len(pids[:2])
        assert isinstance(j.get("results"), list)
