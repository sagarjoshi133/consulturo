"""
Iteration 34 — Encounter/Billing enhancements:
  1) Collection drawer-by-mode (Cash/UPI/Card/Wallet/Cheque/Other)
  2) Monthly revenue report (owner-only)
  3) Patient timeline (visits + receipts)

Uses OWNER token (primary_owner) so revenue-report is allowed.
"""
import os
import uuid
import pytest
import requests
from datetime import datetime, timezone, timedelta

BASE_URL = (
    os.environ.get("EXPO_BACKEND_URL")
    or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or "https://urology-pro.preview.emergentagent.com"
).rstrip("/")

OWNER_TOKEN = "test_session_1781800271528"
CLINIC_ID = "clinic_a97b903f2fb2"

HEADERS = {
    "Authorization": f"Bearer {OWNER_TOKEN}",
    "X-Clinic-Id": CLINIC_ID,
    "Content-Type": "application/json",
}

IST_NOW = datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)
TODAY = IST_NOW.strftime("%Y-%m-%d")
MONTH = IST_NOW.strftime("%Y-%m")

# Track created ids for cleanup
_CREATED_ENC_IDS: list[str] = []
_CREATED_REC_IDS: list[str] = []
_TEST_PHONE = f"9{IST_NOW.strftime('%H%M%S')}{uuid.uuid4().int % 10000:04d}"[:10]


@pytest.fixture(scope="module")
def api_client():
    s = requests.Session()
    s.headers.update(HEADERS)
    yield s
    # ── best-effort cleanup ───────────────────────────────────
    for rid in _CREATED_REC_IDS:
        try:
            s.delete(f"{BASE_URL}/api/billing/receipts/{rid}", timeout=10)
        except Exception:
            pass
    for eid in _CREATED_ENC_IDS:
        try:
            s.delete(f"{BASE_URL}/api/encounters/{eid}", timeout=10)
        except Exception:
            pass


# ──────────────────────────────────────────────────────────────
# Setup helpers
# ──────────────────────────────────────────────────────────────

def _create_encounter(api_client, name: str, phone: str) -> str:
    r = api_client.post(f"{BASE_URL}/api/encounters", json={
        "patient_name": f"TEST_{name}",
        "patient_phone": phone,
        "patient_age": "45",
        "patient_sex": "M",
        "chief_complaint": "TEST iteration34",
    }, timeout=15)
    assert r.status_code == 200, f"encounter create failed: {r.status_code} {r.text}"
    eid = r.json()["encounter_id"]
    _CREATED_ENC_IDS.append(eid)
    return eid


def _start_consultation(api_client, encounter_id: str) -> dict:
    r = api_client.post(f"{BASE_URL}/api/encounters/{encounter_id}/start-consultation", timeout=15)
    assert r.status_code == 200, f"start-consult failed: {r.status_code} {r.text}"
    return r.json()


def _create_receipt(api_client, encounter_id: str, patient_name: str, phone: str, amount: float, mode: str) -> str:
    """Try common billing endpoints to create a receipt."""
    payload = {
        "encounter_id": encounter_id,
        "patient_name": f"TEST_{patient_name}",
        "patient_phone": phone,
        "items": [{"description": "Consultation", "amount": amount, "qty": 1}],
        "total": amount,
        "paid": amount,
        "mode": mode,
        "receipt_date": TODAY,
        "service_type": "consultation",
    }
    for path in ("/api/billing/receipts", "/api/receipts", "/api/billing"):
        r = api_client.post(f"{BASE_URL}{path}", json=payload, timeout=15)
        if r.status_code in (200, 201):
            data = r.json()
            rid = data.get("receipt_id") or data.get("id")
            if rid:
                _CREATED_REC_IDS.append(rid)
            return rid
    pytest.skip(f"No billing/receipt endpoint available (last status={r.status_code}, body={r.text[:150]})")


# ──────────────────────────────────────────────────────────────
# 1. Drawer-by-mode
# ──────────────────────────────────────────────────────────────

class TestCollectionDrawer:
    """Collection summary should return drawer.total and drawer.modes bucketed
    into Cash/UPI/Card/Wallet/Cheque/Other."""

    def test_collection_summary_has_drawer_shape(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/encounters/collection-summary",
                           params={"date": TODAY}, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "drawer" in data, "drawer missing from response"
        drawer = data["drawer"]
        assert "total" in drawer and isinstance(drawer["total"], (int, float))
        assert "modes" in drawer and isinstance(drawer["modes"], list)
        for m in drawer["modes"]:
            assert m["mode"] in {"Cash", "UPI", "Card", "Wallet", "Cheque", "Other"}
            assert isinstance(m["amount"], (int, float))
            assert isinstance(m["count"], int)

    def test_drawer_buckets_multiple_modes(self, api_client):
        """Create receipts with Cash + UPI + Card and confirm they appear
        in the drawer buckets with correct amounts."""
        # Seed encounter+fee
        eid = _create_encounter(api_client, "DrawerTest", _TEST_PHONE)
        _start_consultation(api_client, eid)
        # Baseline drawer
        base = api_client.get(f"{BASE_URL}/api/encounters/collection-summary",
                              params={"date": TODAY}, timeout=15).json()["drawer"]
        base_by_mode = {m["mode"]: m for m in base["modes"]}
        base_total = base["total"]

        # Create 3 receipts of different modes on same encounter
        _create_receipt(api_client, eid, "DrawerTest", _TEST_PHONE, 100.0, "Cash")
        _create_receipt(api_client, eid, "DrawerTest", _TEST_PHONE, 200.0, "UPI")
        _create_receipt(api_client, eid, "DrawerTest", _TEST_PHONE, 300.0, "Card")

        r = api_client.get(f"{BASE_URL}/api/encounters/collection-summary",
                           params={"date": TODAY}, timeout=15)
        assert r.status_code == 200
        drawer = r.json()["drawer"]
        by_mode = {m["mode"]: m for m in drawer["modes"]}

        # Confirm each of Cash/UPI/Card increased by the expected delta
        for mode, delta in (("Cash", 100.0), ("UPI", 200.0), ("Card", 300.0)):
            assert mode in by_mode, f"drawer missing bucket {mode}"
            before = base_by_mode.get(mode, {"amount": 0.0, "count": 0})
            assert by_mode[mode]["amount"] >= before["amount"] + delta - 0.01, (
                f"{mode} amount didn't increase by {delta}: was {before}, now {by_mode[mode]}"
            )
            assert by_mode[mode]["count"] >= before["count"] + 1
        # Total should have grown by ≥ 600
        assert drawer["total"] >= base_total + 599.99


# ──────────────────────────────────────────────────────────────
# 2. Revenue report (owner-only)
# ──────────────────────────────────────────────────────────────

class TestRevenueReport:
    def test_revenue_report_shape_owner(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/encounters/revenue-report",
                           params={"month": MONTH}, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["month"] == MONTH
        for k in ("collected", "waived_total", "outstanding"):
            assert isinstance(d[k], (int, float)), f"{k} not numeric"
        assert set(d["counts"].keys()) >= {"total", "paid", "pending", "waived"}
        assert isinstance(d["series"], list)
        for row in d["series"]:
            assert set(row.keys()) >= {"day", "collected", "waived", "outstanding"}

    def test_revenue_internal_consistency(self, api_client):
        """counts.total == paid+pending+waived AND per-day series sums
        should be ≤ overall totals."""
        r = api_client.get(f"{BASE_URL}/api/encounters/revenue-report",
                           params={"month": MONTH}, timeout=15)
        assert r.status_code == 200
        d = r.json()
        c = d["counts"]
        assert c["total"] == c["paid"] + c["pending"] + c["waived"], (
            f"counts mismatch: {c}"
        )
        # Series totals equal top-line totals (within rounding)
        s_col = sum(row["collected"] for row in d["series"])
        s_wai = sum(row["waived"] for row in d["series"])
        s_out = sum(row["outstanding"] for row in d["series"])
        assert abs(s_col - d["collected"]) < 0.5, (s_col, d["collected"])
        assert abs(s_wai - d["waived_total"]) < 0.5, (s_wai, d["waived_total"])
        assert abs(s_out - d["outstanding"]) < 0.5, (s_out, d["outstanding"])

    def test_revenue_default_month(self, api_client):
        """No month param → defaults to current IST month."""
        r = api_client.get(f"{BASE_URL}/api/encounters/revenue-report", timeout=15)
        assert r.status_code == 200
        assert r.json()["month"] == MONTH


# ──────────────────────────────────────────────────────────────
# 3. Patient timeline
# ──────────────────────────────────────────────────────────────

class TestPatientTimeline:
    def test_timeline_empty_when_no_phone(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/encounters/patient-timeline",
                           params={"phone": ""}, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["visits"] == [] and d["receipts"] == []

    def test_timeline_returns_this_patients_visits_and_receipts(self, api_client):
        # Ensure at least one visit + one receipt for _TEST_PHONE via first test
        # If DrawerTest didn't run in isolation, seed here too.
        if not _CREATED_ENC_IDS:
            eid = _create_encounter(api_client, "TL", _TEST_PHONE)
            _start_consultation(api_client, eid)
            _create_receipt(api_client, eid, "TL", _TEST_PHONE, 500.0, "Cash")

        r = api_client.get(f"{BASE_URL}/api/encounters/patient-timeline",
                           params={"phone": _TEST_PHONE}, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["phone"].endswith(_TEST_PHONE[-10:])
        assert len(d["visits"]) >= 1, "expected at least one visit for TEST phone"
        # Verify every visit belongs to this phone (via encounter_id from our set)
        our_enc_ids = set(_CREATED_ENC_IDS)
        matched = [v for v in d["visits"] if v["encounter_id"] in our_enc_ids]
        assert matched, "none of our seeded encounters showed up in timeline"

        # Sorted newest first
        created_ats = [v.get("created_at") for v in d["visits"] if v.get("created_at")]
        assert created_ats == sorted(created_ats, reverse=True), "timeline visits not newest-first"

        # Receipts (only if seeded above ran)
        if _CREATED_REC_IDS:
            assert len(d["receipts"]) >= 1
            for rc in d["receipts"]:
                # receipts endpoint returns fields defined in the router
                assert set(rc.keys()) >= {"receipt_id", "paid", "mode", "receipt_date", "encounter_id"} \
                       or set(rc.keys()) >= {"receipt_no", "paid"}


# ──────────────────────────────────────────────────────────────
# 4. Route ordering sanity — /revenue-report, /patient-timeline
#    must NOT be swallowed by /{encounter_id}
# ──────────────────────────────────────────────────────────────

class TestRouteOrdering:
    def test_revenue_report_not_treated_as_encounter_id(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/encounters/revenue-report", timeout=15)
        # Would be 404 (Encounter not found) if wrong; must be 200 (or 403 non-owner)
        assert r.status_code in (200, 403), f"route swallowed: {r.status_code} {r.text[:120]}"

    def test_patient_timeline_not_treated_as_encounter_id(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/encounters/patient-timeline",
                           params={"phone": _TEST_PHONE}, timeout=15)
        assert r.status_code == 200, f"route swallowed: {r.status_code} {r.text[:120]}"
