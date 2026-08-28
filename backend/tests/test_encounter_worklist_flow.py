"""Backend tests for Encounter → Consultation → Billing worklist flow.

Covers:
  · GET /api/encounters/worklist (merged items + counts, to_start booking present)
  · POST /api/encounters — intake IPSS + investigations persist
  · POST /api/encounters/{id}/start-consultation — stage/fee update
  · POST /api/receipts (with encounter_id) — auto payment_status='paid'
  · POST /api/encounters/{id}/waive — payment_status='waived'
  · GET  /api/encounters/{id}/billing — summary shape
  · Full chain: enc -> start -> Rx(final, encounter_id) -> stage=completed
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "https://urology-pro.preview.emergentagent.com").rstrip("/")
TOKEN = "test_session_1781800271528"
CLINIC_ID = "clinic_a97b903f2fb2"
HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "X-Clinic-Id": CLINIC_ID,
    "Content-Type": "application/json",
}


@pytest.fixture(scope="module")
def sess():
    s = requests.Session()
    s.headers.update(HEADERS)
    return s


# ── Worklist ──────────────────────────────────────────────────────────
def test_worklist_shape_and_seeded_booking(sess):
    r = sess.get(f"{BASE_URL}/api/encounters/worklist", timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "items" in data and "counts" in data
    counts = data["counts"]
    for k in ("to_start", "open", "in_consultation", "completed"):
        assert k in counts, f"missing counts.{k}"
    # Seeded booking bk_wltest_* should exist as a to_start row.
    to_starts = [i for i in data["items"] if i.get("stage") == "to_start"]
    assert any(
        (i.get("booking_id") or "").startswith("bk_wltest_")
        or "Worklist ToStart" in (i.get("patient_name") or "")
        for i in to_starts
    ), f"seeded to_start booking not found in worklist ({len(to_starts)} to_start rows)"


# ── Create encounter with new intake fields ───────────────────────────
@pytest.fixture(scope="module")
def created_encounter(sess):
    payload = {
        "patient_name": f"TEST_WL Patient {uuid.uuid4().hex[:6]}",
        "patient_phone": "9812345670",
        "patient_age": "62",
        "patient_sex": "Male",
        "chief_complaint": "LUTS, poor stream",
        "ipss": "18/35 severe",
        "inv_blood": "Hb 13.2",
        "inv_psa": "3.4",
        "inv_usg": "Prostate 55g, PVR 90ml",
        "inv_uroflowmetry": "Qmax 8 ml/s",
        "inv_ct": "",
        "inv_mri": "",
        "investigation_findings": "Consistent with BPH",
    }
    r = sess.post(f"{BASE_URL}/api/encounters", json=payload, timeout=30)
    assert r.status_code == 200, r.text
    enc = r.json()
    assert enc["stage"] == "open"
    assert enc["payment_status"] == "pending"
    assert enc["ipss"] == "18/35 severe"
    assert enc["inv_psa"] == "3.4"
    return enc


def test_encounter_get_persists_intake(sess, created_encounter):
    enc_id = created_encounter["encounter_id"]
    r = sess.get(f"{BASE_URL}/api/encounters/{enc_id}", timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["ipss"] == "18/35 severe"
    assert d["inv_blood"] == "Hb 13.2"
    assert d["inv_usg"] == "Prostate 55g, PVR 90ml"
    assert d["investigation_findings"] == "Consistent with BPH"


# ── Start consultation stamps fee=500 ────────────────────────────────
def test_start_consultation_sets_stage_and_fee(sess, created_encounter):
    enc_id = created_encounter["encounter_id"]
    r = sess.post(f"{BASE_URL}/api/encounters/{enc_id}/start-consultation", timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["stage"] == "in_consultation"
    assert float(d["fee_amount"]) == 500.0


# ── Receipt auto-flips payment_status to paid ────────────────────────
def test_receipt_flips_payment_to_paid(sess, created_encounter):
    enc_id = created_encounter["encounter_id"]
    payload = {
        "patient_name": "TEST_WL Patient",
        "patient_phone": "9812345670",
        "items": [{"description": "Consultation", "service_type": "consultation",
                   "qty": 1, "amount": 500}],
        "mode": "Cash",
        "encounter_id": enc_id,
    }
    r = sess.post(f"{BASE_URL}/api/receipts", json=payload, timeout=30)
    assert r.status_code == 200, r.text
    rc = r.json()
    assert rc.get("encounter_id") == enc_id
    # verify GET
    e = sess.get(f"{BASE_URL}/api/encounters/{enc_id}", timeout=30).json()
    assert e["payment_status"] == "paid", e


# ── Waive endpoint (owner allowed) ───────────────────────────────────
def test_waive_sets_payment_waived(sess):
    # fresh encounter so we don't overwrite the 'paid' one above.
    payload = {"patient_name": "TEST_WL Waive", "patient_phone": "9812345671",
               "ipss": "5/35 mild"}
    r = sess.post(f"{BASE_URL}/api/encounters", json=payload, timeout=30)
    assert r.status_code == 200
    enc_id = r.json()["encounter_id"]
    sess.post(f"{BASE_URL}/api/encounters/{enc_id}/start-consultation", timeout=30)
    w = sess.post(f"{BASE_URL}/api/encounters/{enc_id}/waive", timeout=30)
    assert w.status_code == 200, w.text
    assert w.json()["payment_status"] == "waived"
    e = sess.get(f"{BASE_URL}/api/encounters/{enc_id}", timeout=30).json()
    assert e["payment_status"] == "waived"


# ── Billing summary ──────────────────────────────────────────────────
def test_billing_summary_shape(sess, created_encounter):
    enc_id = created_encounter["encounter_id"]
    r = sess.get(f"{BASE_URL}/api/encounters/{enc_id}/billing", timeout=30)
    assert r.status_code == 200, r.text
    b = r.json()
    for key in ("fee_amount", "payment_status", "linked_receipts", "patient_history"):
        assert key in b
    assert float(b["fee_amount"]) == 500.0
    assert isinstance(b["linked_receipts"], list)
    assert isinstance(b["patient_history"], list)
    assert len(b["linked_receipts"]) >= 1


# ── Full chain: Rx(final, encounter_id) → stage completed ────────────
def test_finalize_rx_completes_encounter(sess):
    ep = {"patient_name": "TEST_WL Complete", "patient_phone": "9812345672",
          "ipss": "22/35 severe"}
    r = sess.post(f"{BASE_URL}/api/encounters", json=ep, timeout=30)
    assert r.status_code == 200
    enc_id = r.json()["encounter_id"]
    sess.post(f"{BASE_URL}/api/encounters/{enc_id}/start-consultation", timeout=30)

    from datetime import date as _date
    rx_payload = {
        "patient_name": "TEST_WL Complete",
        "patient_phone": "9812345672",
        "visit_date": _date.today().isoformat(),
        "diagnosis": "BPH",
        "medications": [{"name": "Tamsulosin", "dose": "0.4 mg", "freq": "OD", "duration": "30d"}],
        "status": "final",
        "encounter_id": enc_id,
    }
    rx = sess.post(f"{BASE_URL}/api/prescriptions", json=rx_payload, timeout=30)
    assert rx.status_code == 200, rx.text
    rx_id = rx.json()["prescription_id"]

    e = sess.get(f"{BASE_URL}/api/encounters/{enc_id}", timeout=30).json()
    assert e["stage"] == "completed", e
    assert e["prescription_id"] == rx_id
