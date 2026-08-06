"""Backend tests for the new 'All Receipts' view.

Covers what the /billing → All Receipts tab consumes:

  1. GET /api/receipts (no params) — default limit 100, sorted by
     (receipt_date DESC, created_at DESC).
  2. GET /api/receipts?limit=500 — honours the bumped cap and keeps
     the same descending order.
  3. GET /api/receipts respects tenant_filter — passing a clinic_id
     the owner is NOT a member of must 403 (cross-clinic leak guard).
  4. GET /api/receipts/{receipt_id} — single-doc fetch used by the
     row-tap deep link to /billing/{receipt_id}.

We run against the public preview URL (what users actually hit) using
the pre-seeded owner session token from memory/test_credentials.md.
"""
from __future__ import annotations

import os
import pytest
import requests

BASE_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or "https://urology-pro.preview.emergentagent.com"
).rstrip("/")

OWNER_TOKEN = "test_session_1781009714553"
OWNER_HEADERS = {
    "Authorization": f"Bearer {OWNER_TOKEN}",
    "Content-Type": "application/json",
}

# Known good clinic the owner is a member of (from test_credentials.md).
OWNER_CLINIC_ID = "clinic_a97b903f2fb2"
# A bogus clinic_id the owner is NOT a member of — used for the cross-
# tenant denial test.
FOREIGN_CLINIC_ID = "clinic_does_not_exist_zzz"


@pytest.fixture(scope="module")
def owner_token_live() -> bool:
    try:
        r = requests.get(
            f"{BASE_URL}/api/auth/me", headers=OWNER_HEADERS, timeout=10
        )
        return r.status_code == 200
    except Exception:
        return False


@pytest.fixture(autouse=True)
def _skip_if_token_stale(owner_token_live):
    if not owner_token_live:
        pytest.skip(
            "OWNER_TOKEN is stale — refresh test_session_* in "
            "/app/memory/test_credentials.md."
        )


# ──────────────────────────────────────────────────────────────────────
# 1. List + default limit + sort order
# ──────────────────────────────────────────────────────────────────────
class TestListDefaults:
    def test_list_no_params_returns_200_and_array(self):
        r = requests.get(
            f"{BASE_URL}/api/receipts", headers=OWNER_HEADERS, timeout=15
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)

    def test_default_limit_capped_at_100(self):
        r = requests.get(
            f"{BASE_URL}/api/receipts", headers=OWNER_HEADERS, timeout=15
        )
        assert r.status_code == 200
        data = r.json()
        assert len(data) <= 100, f"Expected ≤100 items by default, got {len(data)}"

    def test_sort_order_receipt_date_then_created_at_desc(self):
        r = requests.get(
            f"{BASE_URL}/api/receipts?limit=500",
            headers=OWNER_HEADERS,
            timeout=20,
        )
        assert r.status_code == 200
        data = r.json()
        if len(data) < 2:
            pytest.skip("Need at least 2 receipts to verify sort order")

        for prev, cur in zip(data, data[1:]):
            # Primary key: receipt_date DESC
            pd = prev.get("receipt_date") or ""
            cd = cur.get("receipt_date") or ""
            assert pd >= cd, (
                f"receipt_date out of order: prev={pd} cur={cd}"
            )
            # Secondary: created_at DESC when dates equal
            if pd == cd:
                pc = prev.get("created_at") or ""
                cc = cur.get("created_at") or ""
                assert pc >= cc, (
                    f"created_at tie-breaker out of order: {pc} < {cc}"
                )

    def test_required_fields_present_in_each_row(self):
        r = requests.get(
            f"{BASE_URL}/api/receipts?limit=5",
            headers=OWNER_HEADERS,
            timeout=15,
        )
        assert r.status_code == 200
        data = r.json()
        if not data:
            pytest.skip("No receipts seeded — cannot validate shape")
        sample = data[0]
        for k in (
            "receipt_id",
            "receipt_no",
            "clinic_id",
            "total",
            "paid",
            "balance",
            "mode",
            "receipt_date",
            "created_at",
            "items",
        ):
            assert k in sample, f"Missing field '{k}' in receipt row"
        # _id must never leak to the wire
        assert "_id" not in sample


# ──────────────────────────────────────────────────────────────────────
# 2. limit=500 honoured
# ──────────────────────────────────────────────────────────────────────
class TestLimit500:
    def test_limit_500_returns_200(self):
        r = requests.get(
            f"{BASE_URL}/api/receipts?limit=500",
            headers=OWNER_HEADERS,
            timeout=20,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        assert len(data) <= 500

    def test_limit_over_500_rejected(self):
        # Pydantic Query(le=500) → 422 on overflow
        r = requests.get(
            f"{BASE_URL}/api/receipts?limit=501",
            headers=OWNER_HEADERS,
            timeout=10,
        )
        assert r.status_code == 422

    def test_limit_500_returns_more_than_default_when_data_allows(self):
        a = requests.get(
            f"{BASE_URL}/api/receipts",
            headers=OWNER_HEADERS,
            timeout=15,
        ).json()
        b = requests.get(
            f"{BASE_URL}/api/receipts?limit=500",
            headers=OWNER_HEADERS,
            timeout=20,
        ).json()
        # b should be a strict superset/prefix in size: |b| >= |a|.
        assert len(b) >= len(a), (
            f"limit=500 returned fewer rows ({len(b)}) than default ({len(a)})"
        )
        # If the default capped at 100, limit=500 should reveal more
        # only when ≥101 receipts exist. Otherwise they'll be equal —
        # both cases are acceptable.


# ──────────────────────────────────────────────────────────────────────
# 3. Tenant scoping
# ──────────────────────────────────────────────────────────────────────
class TestTenantScoping:
    def test_all_results_belong_to_owners_clinic(self):
        r = requests.get(
            f"{BASE_URL}/api/receipts?limit=500",
            headers=OWNER_HEADERS,
            timeout=20,
        )
        assert r.status_code == 200
        data = r.json()
        if not data:
            pytest.skip("No receipts seeded for owner's clinic")
        # Owner's default clinic is OWNER_CLINIC_ID — every row must
        # carry that clinic_id.
        offenders = [
            d.get("clinic_id") for d in data if d.get("clinic_id") != OWNER_CLINIC_ID
        ]
        assert not offenders, (
            f"Cross-tenant leak: {len(offenders)} rows with non-owner clinic_id: "
            f"{set(offenders)}"
        )

    def test_passing_foreign_clinic_header_returns_403(self):
        """resolve_clinic_id must reject a clinic_id the owner is not a
        member of — that's the guard preventing owner-of-A from seeing
        clinic B's receipts via the X-Clinic-Id header."""
        headers = {**OWNER_HEADERS, "X-Clinic-Id": FOREIGN_CLINIC_ID}
        r = requests.get(
            f"{BASE_URL}/api/receipts", headers=headers, timeout=10
        )
        assert r.status_code == 403, (
            f"Expected 403 for foreign clinic, got {r.status_code}: {r.text}"
        )

    def test_unauthenticated_returns_401(self):
        r = requests.get(f"{BASE_URL}/api/receipts", timeout=10)
        assert r.status_code in (401, 403), r.text


# ──────────────────────────────────────────────────────────────────────
# 4. Deep-link single receipt fetch
# ──────────────────────────────────────────────────────────────────────
class TestSingleReceipt:
    def test_get_single_receipt_by_id(self):
        list_resp = requests.get(
            f"{BASE_URL}/api/receipts?limit=1",
            headers=OWNER_HEADERS,
            timeout=15,
        )
        assert list_resp.status_code == 200
        rows = list_resp.json()
        if not rows:
            pytest.skip("No receipts to deep-link to")
        target = rows[0]
        rid = target["receipt_id"]

        r = requests.get(
            f"{BASE_URL}/api/receipts/{rid}",
            headers=OWNER_HEADERS,
            timeout=10,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["receipt_id"] == rid
        assert body["receipt_no"] == target["receipt_no"]
        assert body["total"] == target["total"]
        assert "_id" not in body

    def test_get_missing_receipt_returns_404(self):
        r = requests.get(
            f"{BASE_URL}/api/receipts/rc_does_not_exist_xxxx",
            headers=OWNER_HEADERS,
            timeout=10,
        )
        assert r.status_code == 404

    def test_get_single_receipt_unauthenticated_401(self):
        list_resp = requests.get(
            f"{BASE_URL}/api/receipts?limit=1",
            headers=OWNER_HEADERS,
            timeout=15,
        )
        rows = list_resp.json()
        if not rows:
            pytest.skip("No receipts to deep-link to")
        rid = rows[0]["receipt_id"]
        r = requests.get(f"{BASE_URL}/api/receipts/{rid}", timeout=10)
        assert r.status_code in (401, 403)
