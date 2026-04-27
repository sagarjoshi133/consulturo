"""
Backend regression tests — Round 2 for ConsultUro.

Focus areas:
1. GET /api/rx/verify/{id} — public HTML verification page.
2. GET /api/surgeries/export.csv — prescriber/staff CSV export.
3. POST /api/prescriptions — vitals + medicines.timing round-trip + validation.
4. Regression sanity: push registration, broadcasts create/approve/reject, inbox,
   booking push side-effects.

Surgeries seeded count (398) must NOT be modified.
"""
import os
import sys
import json
import uuid
import requests
from typing import Any, Dict, Optional, List, Tuple

BASE = "https://urology-pro.preview.emergentagent.com/api"
OWNER_TOKEN = "test_session_1776770314741"
DOCTOR_TOKEN = "test_doc_1776771431524"

results: List[Tuple[str, bool, str]] = []


def h(token: Optional[str] = None) -> Dict[str, str]:
    hh = {"Content-Type": "application/json"}
    if token:
        hh["Authorization"] = f"Bearer {token}"
    return hh


def record(name: str, ok: bool, msg: str = ""):
    results.append((name, ok, msg))
    prefix = "PASS" if ok else "FAIL"
    print(f"[{prefix}] {name}  {msg}")


def req(method: str, path: str, token: Optional[str] = None,
        json_body: Optional[dict] = None, params: Optional[dict] = None,
        allow_redirects: bool = True) -> requests.Response:
    url = f"{BASE}{path}"
    return requests.request(method, url, headers=h(token), json=json_body,
                            params=params, timeout=30, allow_redirects=allow_redirects)


# =============================================================================
# 1. Prescription creation — vitals + medicine.timing + validation
# =============================================================================

created_rx: Dict[str, str] = {}


def test_rx_create_happy_path():
    payload = {
        "patient_name": "Rahul Singh",
        "patient_age": 54,
        "patient_gender": "male",
        "patient_phone": "+919988776655",
        "visit_date": "2026-04-17",
        "chief_complaints": "Burning micturition and suprapubic pain for 3 days.",
        "vitals": "BP 142/90",
        "diagnosis": "Complicated UTI",
        "medicines": [{
            "name": "X",
            "dosage": "1 tab",
            "frequency": "HS",
            "duration": "5 days",
            "timing": "After food",
        }],
        "advice": "Increase water intake.",
        "follow_up": "7 days",
    }
    r = req("POST", "/prescriptions", token=OWNER_TOKEN, json_body=payload)
    if r.status_code != 200:
        record("rx.create happy path returns 200", False,
               f"status={r.status_code} body={r.text[:200]}")
        return
    j = r.json()
    rx_id = j.get("prescription_id")
    if rx_id:
        created_rx["id"] = rx_id
    vitals_ok = j.get("vitals") == "BP 142/90"
    meds = j.get("medicines") or []
    timing_ok = len(meds) == 1 and meds[0].get("timing") == "After food"
    record("rx.create happy path returns 200 with rx id",
           bool(rx_id), f"rx_id={rx_id}")
    record("rx.create response persists vitals", vitals_ok,
           f"vitals={j.get('vitals')}")
    record("rx.create response persists medicines[].timing", timing_ok,
           f"timing={meds[0].get('timing') if meds else 'no-meds'}")


def test_rx_roundtrip_via_get():
    rx_id = created_rx.get("id")
    if not rx_id:
        record("rx.GET /prescriptions/{id} roundtrip vitals+timing", False, "no rx id")
        return
    r = req("GET", f"/prescriptions/{rx_id}", token=OWNER_TOKEN)
    if r.status_code != 200:
        record("rx.GET /prescriptions/{id} roundtrip vitals+timing", False,
               f"status={r.status_code} body={r.text[:200]}")
        return
    j = r.json()
    vitals_ok = j.get("vitals") == "BP 142/90"
    meds = j.get("medicines") or []
    timing_ok = len(meds) == 1 and meds[0].get("timing") == "After food"
    record("rx.GET /prescriptions/{id} roundtrip vitals", vitals_ok,
           f"vitals={j.get('vitals')}")
    record("rx.GET /prescriptions/{id} roundtrip timing", timing_ok,
           f"timing={meds[0].get('timing') if meds else 'no-meds'}")


def test_rx_missing_patient_name():
    payload = {
        # patient_name omitted
        "visit_date": "2026-04-17",
        "chief_complaints": "Test",
        "medicines": [],
    }
    r = req("POST", "/prescriptions", token=OWNER_TOKEN, json_body=payload)
    record("rx.create missing patient_name → 422", r.status_code == 422,
           f"status={r.status_code}")


def test_rx_missing_visit_date():
    payload = {
        "patient_name": "Foo Bar",
        "chief_complaints": "Test",
        "medicines": [],
    }
    r = req("POST", "/prescriptions", token=OWNER_TOKEN, json_body=payload)
    record("rx.create missing visit_date → 422", r.status_code == 422,
           f"status={r.status_code}")


def test_rx_missing_chief_complaints():
    payload = {
        "patient_name": "Foo Bar",
        "visit_date": "2026-04-17",
        "medicines": [],
    }
    r = req("POST", "/prescriptions", token=OWNER_TOKEN, json_body=payload)
    record("rx.create missing chief_complaints → 422", r.status_code == 422,
           f"status={r.status_code}")


def test_rx_create_requires_prescriber():
    payload = {
        "patient_name": "Anon",
        "visit_date": "2026-04-17",
        "chief_complaints": "x",
        "medicines": [],
    }
    r = req("POST", "/prescriptions", json_body=payload)
    record("rx.create requires auth → 401/403", r.status_code in (401, 403),
           f"status={r.status_code}")


# =============================================================================
# 2. Public /api/rx/verify/{id}
# =============================================================================

def test_verify_unknown_id():
    rid = f"rx_does_not_exist_{uuid.uuid4().hex[:6]}"
    # Intentionally NO auth header.
    r = requests.get(f"{BASE}/rx/verify/{rid}", timeout=15)
    if r.status_code != 404:
        record("verify unknown id → 404", False,
               f"status={r.status_code} body={r.text[:200]}")
        return
    html = r.text
    ct = r.headers.get("Content-Type", "")
    ok = ("No record found" in html) and (rid in html) and ct.startswith("text/html")
    record("verify unknown id → 404 HTML with 'No record found' and ID",
           ok,
           f"ct={ct} has_msg={'No record found' in html} has_id={rid in html}")


def test_verify_known_id():
    rx_id = created_rx.get("id")
    if not rx_id:
        record("verify known id → 200 HTML authentic + initials only", False, "no rx id")
        return
    # Send with NO auth header to prove public accessibility.
    r = requests.get(f"{BASE}/rx/verify/{rx_id}", timeout=15)
    if r.status_code != 200:
        record("verify known id returns 200", False,
               f"status={r.status_code} body={r.text[:200]}")
        return
    html = r.text
    ct = r.headers.get("Content-Type", "")

    has_authentic = "Authentic prescription" in html
    has_id = rx_id in html
    has_ct = ct.startswith("text/html")
    leaks_full_name = "Rahul Singh" in html
    # Diagnosis set in the POST above was "Complicated UTI"
    leaks_diagnosis = "Complicated UTI" in html
    # Expected initials: "R.S"
    has_initials = "R.S" in html

    record("verify known id → 200 HTML Content-Type", has_ct,
           f"ct={ct}")
    record("verify known id contains 'Authentic prescription'", has_authentic, "")
    record("verify known id contains prescription_id", has_id, f"rx_id={rx_id}")
    record("verify known id does NOT leak full patient name",
           not leaks_full_name, f"leak={leaks_full_name}")
    record("verify known id does NOT leak diagnosis",
           not leaks_diagnosis, f"leak={leaks_diagnosis}")
    record("verify known id shows patient initials (e.g. 'R.S')",
           has_initials, "")


def test_verify_is_public_no_auth_needed():
    rx_id = created_rx.get("id")
    if not rx_id:
        record("verify is publicly accessible", False, "no rx id")
        return
    r = requests.get(f"{BASE}/rx/verify/{rx_id}", timeout=15)
    record("verify endpoint is public (200 without auth)",
           r.status_code == 200, f"status={r.status_code}")


# =============================================================================
# 3. GET /api/surgeries/export.csv
# =============================================================================

EXPECTED_HEADER = ("Date of Surgery,Name,Mobile,Age,Sex,IP No.,Address,Category,"
                   "Consultation Date,Referred By,Clinical Examination,Diagnosis,"
                   "Imaging,Department,Date of Admission,Name of Surgery,Hospital,"
                   "Operative Findings,Post-op Investigations,Date of Discharge,"
                   "Follow up,Notes,Ref ID")


def test_surgeries_export_requires_auth():
    r = requests.get(f"{BASE}/surgeries/export.csv", timeout=30)
    record("surgeries.export.csv requires auth → 401/403",
           r.status_code in (401, 403), f"status={r.status_code}")


def test_surgeries_export_success():
    r = requests.get(f"{BASE}/surgeries/export.csv",
                     headers={"Authorization": f"Bearer {OWNER_TOKEN}"},
                     timeout=60)
    if r.status_code != 200:
        record("surgeries.export.csv as owner → 200", False,
               f"status={r.status_code} body={r.text[:200]}")
        return
    ct = r.headers.get("Content-Type", "")
    cd = r.headers.get("Content-Disposition", "")
    record("surgeries.export.csv Content-Type starts with text/csv",
           ct.startswith("text/csv"), f"ct={ct}")
    fname_ok = ("attachment" in cd) and ("consulturo-surgeries-" in cd)
    record("surgeries.export.csv Content-Disposition attachment + prefix",
           fname_ok, f"cd={cd}")

    body = r.text
    lines = body.splitlines()
    if not lines:
        record("surgeries.export.csv first line is expected header", False, "empty body")
        return
    first_line = lines[0]
    record("surgeries.export.csv first line is expected header",
           first_line == EXPECTED_HEADER,
           f"got={first_line[:120]!r}")
    # Data line count (subtract header line).
    # Note: a surgery row may contain newlines in quoted fields; csv module parse is
    # safer for counting real rows.
    import csv as _csv
    from io import StringIO
    reader = _csv.reader(StringIO(body))
    rows = list(reader)
    data_rows = max(0, len(rows) - 1)
    record("surgeries.export.csv has >100 data lines",
           data_rows > 100, f"data_rows={data_rows}")
    # Check for DD-MM-YYYY date like 17-04-2026 or at least DD-MM-YYYY patterns.
    import re as _re
    has_dd_mm_yyyy = bool(_re.search(r"\b\d{2}-\d{2}-\d{4}\b", body))
    record("surgeries.export.csv contains DD-MM-YYYY formatted dates",
           has_dd_mm_yyyy, "")


# =============================================================================
# 4. Regression sanity — push, broadcasts, inbox, booking push side-effects
# =============================================================================

created_ids: Dict[str, str] = {}


def test_push_register_invalid():
    r = req("POST", "/push/register", token=DOCTOR_TOKEN, json_body={"token": "bad"})
    record("REG push.register invalid rejected (400)", r.status_code == 400,
           f"status={r.status_code}")


def test_push_register_valid_and_cleanup():
    tok = f"ExponentPushToken[reg2-{uuid.uuid4().hex[:8]}]"
    r = req("POST", "/push/register", token=DOCTOR_TOKEN,
            json_body={"token": tok, "platform": "ios", "device_name": "iPhone"})
    ok = r.status_code == 200 and r.json().get("ok") is True
    record("REG push.register valid Expo token ok", ok, f"status={r.status_code}")
    if ok:
        requests.delete(f"{BASE}/push/register",
                        headers=h(DOCTOR_TOKEN), params={"token": tok}, timeout=10)


def test_broadcast_create_doctor_pending():
    r = req("POST", "/broadcasts", token=DOCTOR_TOKEN, json_body={
        "title": "Regression pending broadcast",
        "body": "This is a regression test broadcast — pending approval.",
        "target": "all",
    })
    ok = r.status_code == 200 and r.json().get("status") == "pending_approval"
    if ok:
        created_ids["doctor_pending"] = r.json()["broadcast_id"]
    record("REG broadcasts.create doctor → pending_approval", ok,
           f"status={r.status_code}")


def test_broadcast_create_doctor_for_reject():
    r = req("POST", "/broadcasts", token=DOCTOR_TOKEN, json_body={
        "title": "Regression rejectable broadcast",
        "body": "To be rejected by owner.",
    })
    if r.status_code == 200:
        created_ids["doctor_reject_target"] = r.json()["broadcast_id"]
    record("REG broadcasts.create extra for reject", r.status_code == 200,
           f"status={r.status_code}")


def test_broadcast_approve_owner():
    bid = created_ids.get("doctor_pending")
    if not bid:
        record("REG broadcasts.approve as owner → sent", False, "no broadcast")
        return
    r = req("PATCH", f"/broadcasts/{bid}", token=OWNER_TOKEN,
            json_body={"action": "approve"})
    if r.status_code != 200:
        record("REG broadcasts.approve as owner → sent", False,
               f"status={r.status_code} body={r.text[:200]}")
        return
    j = r.json()
    ok = j.get("status") == "sent" and j.get("approved_by")
    record("REG broadcasts.approve → status=sent", ok,
           f"status={j.get('status')} sent_count={j.get('sent_count')}")


def test_broadcast_reject_owner():
    bid = created_ids.get("doctor_reject_target")
    if not bid:
        record("REG broadcasts.reject → rejected", False, "no broadcast")
        return
    r = req("PATCH", f"/broadcasts/{bid}", token=OWNER_TOKEN,
            json_body={"action": "reject", "reject_reason": "Not relevant"})
    ok = r.status_code == 200 and r.json().get("status") == "rejected"
    record("REG broadcasts.reject → rejected", ok, f"status={r.status_code}")


def test_broadcast_inbox_owner():
    r = req("GET", "/broadcasts/inbox", token=OWNER_TOKEN)
    if r.status_code != 200:
        record("REG broadcasts.inbox returns items+unread", False,
               f"status={r.status_code}")
        return
    j = r.json()
    ok = isinstance(j.get("items"), list) and "unread" in j
    record("REG broadcasts.inbox returns items+unread", ok,
           f"items={len(j.get('items') or [])} unread={j.get('unread')}")


def test_broadcast_inbox_read():
    r = req("POST", "/broadcasts/inbox/read", token=OWNER_TOKEN)
    if r.status_code != 200:
        record("REG broadcasts.inbox/read", False, f"status={r.status_code}")
        return
    r2 = req("GET", "/broadcasts/inbox", token=OWNER_TOKEN)
    j = r2.json() if r2.status_code == 200 else {}
    record("REG broadcasts.inbox unread=0 after read",
           j.get("unread") == 0, f"unread={j.get('unread')}")


# Booking side-effect: push_to_owner / push_to_user should be invoked without 5xx.
created_booking: Dict[str, str] = {}


def test_booking_create_push_side_effect():
    payload = {
        "patient_name": "Priya Desai",
        "patient_phone": "+919812345670",
        "patient_age": 38,
        "patient_gender": "female",
        "reason": "Recurrent UTI — second opinion",
        "booking_date": "2026-06-14",
        "booking_time": "11:15 AM",
        "mode": "in-person",
    }
    r = req("POST", "/bookings", json_body=payload)
    ok = r.status_code == 200 and r.json().get("booking_id")
    if ok:
        created_booking["id"] = r.json()["booking_id"]
    record("REG bookings.create with push side-effect (no 5xx)",
           ok, f"status={r.status_code} body={r.text[:200]}")


def test_booking_patch_confirmed_push_side_effect():
    bid = created_booking.get("id")
    if not bid:
        record("REG bookings.patch confirmed push side-effect", False, "no id")
        return
    r = req("PATCH", f"/bookings/{bid}", token=OWNER_TOKEN,
            json_body={"status": "confirmed"})
    record("REG bookings.patch→confirmed no 5xx",
           r.status_code == 200, f"status={r.status_code}")


def test_booking_patch_cancelled_push_side_effect():
    bid = created_booking.get("id")
    if not bid:
        record("REG bookings.patch cancelled push side-effect", False, "no id")
        return
    r = req("PATCH", f"/bookings/{bid}", token=OWNER_TOKEN,
            json_body={"status": "cancelled"})
    record("REG bookings.patch→cancelled no 5xx",
           r.status_code == 200, f"status={r.status_code}")


# =============================================================================
# 5. Data integrity — 398 surgeries must remain
# =============================================================================

def test_surgeries_count_preserved():
    r = requests.get(f"{BASE}/surgeries",
                     headers={"Authorization": f"Bearer {OWNER_TOKEN}"},
                     timeout=30)
    if r.status_code != 200:
        record("DATA surgeries count preserved (>=398)", False,
               f"status={r.status_code}")
        return
    n = len(r.json())
    record("DATA surgeries count preserved (>=398)", n >= 398,
           f"count={n}")


# =============================================================================

def cleanup():
    # Remove the owner's broadcast (owner_approved) if any
    for key in ("doctor_reject_target",):
        bid = created_ids.get(key)
        if bid:
            try:
                requests.delete(f"{BASE}/broadcasts/{bid}",
                                headers=h(OWNER_TOKEN), timeout=10)
            except Exception:
                pass


def main():
    tests = [
        # Rx creation first (need rx_id for verify)
        test_rx_create_happy_path,
        test_rx_roundtrip_via_get,
        test_rx_missing_patient_name,
        test_rx_missing_visit_date,
        test_rx_missing_chief_complaints,
        test_rx_create_requires_prescriber,
        # Verify
        test_verify_unknown_id,
        test_verify_known_id,
        test_verify_is_public_no_auth_needed,
        # CSV export
        test_surgeries_export_requires_auth,
        test_surgeries_export_success,
        # Regression
        test_push_register_invalid,
        test_push_register_valid_and_cleanup,
        test_broadcast_create_doctor_pending,
        test_broadcast_create_doctor_for_reject,
        test_broadcast_approve_owner,
        test_broadcast_reject_owner,
        test_broadcast_inbox_owner,
        test_broadcast_inbox_read,
        test_booking_create_push_side_effect,
        test_booking_patch_confirmed_push_side_effect,
        test_booking_patch_cancelled_push_side_effect,
        # Data integrity
        test_surgeries_count_preserved,
    ]
    for t in tests:
        try:
            t()
        except Exception as e:
            record(t.__name__, False, f"EXC {type(e).__name__}: {e}")
    cleanup()

    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print()
    print("=" * 60)
    print(f"PASSED {passed}/{total}")
    print("=" * 60)
    failed = [(n, m) for n, ok, m in results if not ok]
    if failed:
        print("Failed:")
        for n, m in failed:
            print(f"  - {n}  {m}")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
