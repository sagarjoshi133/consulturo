"""Smoke test — Discharge Summary endpoints (review request).

Tests:
1. GET /api/discharge-summaries without auth → 401/403
2. GET /api/discharge-summaries as primary owner → 200, items list
3. Create admission via POST /api/ipd/admissions
   then POST /api/ipd/admissions/{id}/discharge
   then verify GET /api/discharge-summaries contains it
4. GET ?q=<phone> filter
5. GET ?from_date=&to_date= filter
6. PUT /api/ipd/admissions/{id}/discharge-summary as owner → 200,
   verify edited_at + edited_by_id present
7. PUT as non-owner non-discharger (doctor) → 403
8. PUT on a non-discharged admission → 409
9. Spot-check medical-certificate and pending-payment endpoints
10. Cleanup
"""
from __future__ import annotations

import json
import sys
import time
import uuid

import requests

BASE = "https://urology-pro.preview.emergentagent.com/api"
OWNER_TOKEN = "test_session_1776770314741"     # primary_owner
DOCTOR_TOKEN = "test_doc_1776771431524"        # doctor (non-owner)
CLINIC_ID = "clinic_a97b903f2fb2"

H_OWNER = {
    "Authorization": f"Bearer {OWNER_TOKEN}",
    "X-Clinic-Id": CLINIC_ID,
    "Content-Type": "application/json",
}
H_DOCTOR = {
    "Authorization": f"Bearer {DOCTOR_TOKEN}",
    "X-Clinic-Id": CLINIC_ID,
    "Content-Type": "application/json",
}

PASS = 0
FAIL = 0
LOG = []


def check(label: str, cond: bool, detail: str = ""):
    global PASS, FAIL
    if cond:
        PASS += 1
        LOG.append(f"PASS  {label}")
    else:
        FAIL += 1
        LOG.append(f"FAIL  {label}  | {detail}")
        print(f"FAIL: {label}\n     {detail}")


def pretty(o):
    try:
        return json.dumps(o, indent=2, default=str)[:1200]
    except Exception:
        return str(o)[:1200]


def main():
    created_ids = []
    test_phone = f"99{int(time.time()) % 100000000:08d}"   # 10-digit unique
    patient_name = f"Smoke DC {uuid.uuid4().hex[:6]}"

    # 1. UNAUTH
    r = requests.get(f"{BASE}/discharge-summaries", timeout=15)
    check(
        "1. GET /discharge-summaries WITHOUT auth -> 401/403",
        r.status_code in (401, 403),
        f"got {r.status_code} body={r.text[:200]}",
    )

    # 2. OWNER
    r = requests.get(f"{BASE}/discharge-summaries", headers=H_OWNER, timeout=15)
    check(
        "2. GET /discharge-summaries as owner -> 200 with items list",
        r.status_code == 200 and isinstance(r.json().get("items"), list),
        f"got {r.status_code} body={r.text[:300]}",
    )
    initial_count = len(r.json().get("items", [])) if r.status_code == 200 else 0
    LOG.append(f"   initial discharge-summaries count = {initial_count}")

    # 3a. Create admission
    admit_body = {
        "patient_name": patient_name,
        "patient_phone": f"+91{test_phone}",
        "patient_age": 42,
        "patient_sex": "M",
        "ward": "General",
        "diagnosis": "Acute UTI (smoke test)",
        "consulting_doctor": "Dr. Sagar Joshi",
        "presenting_complaints": "Burning micturition, fever",
        "planned_procedure": "Conservative - IV antibiotics",
    }
    r = requests.post(
        f"{BASE}/ipd/admissions", headers=H_OWNER,
        json=admit_body, timeout=20,
    )
    check(
        "3a. POST /ipd/admissions -> 200",
        r.status_code == 200,
        f"got {r.status_code} body={r.text[:400]}",
    )
    if r.status_code != 200:
        return summarize()
    admission = r.json()
    adm_id = admission.get("id")
    ipd_no = admission.get("ipd_no")
    created_ids.append(adm_id)
    LOG.append(f"   created admission id={adm_id} ipd_no={ipd_no}")

    # 3b. Discharge
    disc_body = {
        "final_diagnosis": "Acute UTI",
        "procedures_done": "None",
        "course_in_hospital": "Improved with IV antibiotics",
        "condition_at_discharge": "Stable",
        "follow_up_plan": "Review after 1 week",
        "follow_up_date": "2026-06-15",
        "advice": "Hydration",
    }
    r = requests.post(
        f"{BASE}/ipd/admissions/{adm_id}/discharge",
        headers=H_OWNER, json=disc_body, timeout=20,
    )
    check(
        "3b. POST /ipd/admissions/{id}/discharge -> 200, status=discharged",
        r.status_code == 200 and (r.json().get("status") == "discharged"),
        f"got {r.status_code} body={r.text[:400]}",
    )
    summary_after_discharge = (r.json() or {}).get("discharge_summary") or {}
    check(
        "3b.i  embedded discharge_summary has final_diagnosis='Acute UTI'",
        summary_after_discharge.get("final_diagnosis") == "Acute UTI",
        f"got {pretty(summary_after_discharge)}",
    )

    # 3c. Verify list contains new row
    r = requests.get(f"{BASE}/discharge-summaries", headers=H_OWNER, timeout=15)
    items = r.json().get("items", []) if r.status_code == 200 else []
    my_row = next((it for it in items if it.get("id") == adm_id), None)
    check(
        "3c. GET /discharge-summaries now contains the new admission",
        my_row is not None,
        f"new row missing. count={len(items)}",
    )
    if my_row:
        check(
            "3c.i  row has patient_name",
            my_row.get("patient_name") == patient_name,
            f"got {my_row.get('patient_name')}",
        )
        check(
            "3c.ii row has ipd_no",
            my_row.get("ipd_no") == ipd_no,
            f"got {my_row.get('ipd_no')}",
        )
        check(
            "3c.iii row has final_diagnosis='Acute UTI'",
            my_row.get("final_diagnosis") == "Acute UTI",
            f"got {my_row.get('final_diagnosis')}",
        )
        check(
            "3c.iv row has discharged_at (non-null)",
            bool(my_row.get("discharged_at")),
            f"got {my_row.get('discharged_at')}",
        )

    # 4. Filter by phone (last-10 digits as stored)
    r = requests.get(
        f"{BASE}/discharge-summaries", headers=H_OWNER,
        params={"q": test_phone}, timeout=15,
    )
    items4 = r.json().get("items", []) if r.status_code == 200 else []
    hit4 = any(it.get("id") == adm_id for it in items4)
    check(
        "4. GET ?q=<phone> narrows correctly (contains our row)",
        r.status_code == 200 and hit4,
        f"got {r.status_code} count={len(items4)}",
    )

    # 5. Filter by date range
    r = requests.get(
        f"{BASE}/discharge-summaries", headers=H_OWNER,
        params={"from_date": "2026-01-01", "to_date": "2026-12-31"},
        timeout=15,
    )
    items5 = r.json().get("items", []) if r.status_code == 200 else []
    hit5 = any(it.get("id") == adm_id for it in items5)
    check(
        "5. GET ?from_date=2026-01-01&to_date=2026-12-31 returns our row",
        r.status_code == 200 and hit5,
        f"got {r.status_code} count={len(items5)}",
    )

    # 6. PUT as primary owner -> 200, edited_at + edited_by_id present
    edit_body = {
        "final_diagnosis": "Acute UTI with sepsis",
        "advice": "Hydration + repeat USG",
    }
    r = requests.put(
        f"{BASE}/ipd/admissions/{adm_id}/discharge-summary",
        headers=H_OWNER, json=edit_body, timeout=15,
    )
    check(
        "6. PUT /ipd/admissions/{id}/discharge-summary (owner) -> 200",
        r.status_code == 200,
        f"got {r.status_code} body={r.text[:400]}",
    )
    if r.status_code == 200:
        ds_after_edit = (r.json() or {}).get("discharge_summary") or {}
        check(
            "6.i  final_diagnosis updated",
            ds_after_edit.get("final_diagnosis") == "Acute UTI with sepsis",
            f"got {ds_after_edit.get('final_diagnosis')}",
        )
        check(
            "6.ii advice updated",
            ds_after_edit.get("advice") == "Hydration + repeat USG",
            f"got {ds_after_edit.get('advice')}",
        )
        check(
            "6.iii edited_at present (non-null)",
            bool(ds_after_edit.get("edited_at")),
            f"keys={list(ds_after_edit.keys())}",
        )
        check(
            "6.iv edited_by_id present (non-null)",
            bool(ds_after_edit.get("edited_by_id")),
            f"keys={list(ds_after_edit.keys())}",
        )

    # 7. PUT as non-owner non-discharging clinician (doctor) -> 403
    r = requests.put(
        f"{BASE}/ipd/admissions/{adm_id}/discharge-summary",
        headers=H_DOCTOR, json={"advice": "Should not save"}, timeout=15,
    )
    check(
        "7. PUT as doctor (non-owner non-discharger) -> 403",
        r.status_code == 403,
        f"got {r.status_code} body={r.text[:300]}",
    )

    # 8. PUT on a non-discharged admission -> 409
    admit_body2 = {
        "patient_name": f"Smoke DC2 {uuid.uuid4().hex[:6]}",
        "patient_phone": f"+918{int(time.time()) % 100000000:08d}",
        "patient_age": 30,
        "ward": "General",
        "diagnosis": "Smoke test undischarged",
    }
    r = requests.post(
        f"{BASE}/ipd/admissions", headers=H_OWNER, json=admit_body2, timeout=20,
    )
    check(
        "8a. POST /ipd/admissions (second, undischarged) -> 200",
        r.status_code == 200,
        f"got {r.status_code} body={r.text[:300]}",
    )
    adm2_id = (r.json() or {}).get("id") if r.status_code == 200 else None
    if adm2_id:
        created_ids.append(adm2_id)
        r = requests.put(
            f"{BASE}/ipd/admissions/{adm2_id}/discharge-summary",
            headers=H_OWNER, json={"advice": "early edit"}, timeout=15,
        )
        check(
            "8b. PUT on non-discharged admission -> 409",
            r.status_code == 409,
            f"got {r.status_code} body={r.text[:300]}",
        )

    # 9. Spot-check Medical Certificates + Pending Payment endpoints
    r = requests.get(f"{BASE}/medical-certificates", headers=H_OWNER, timeout=15)
    check(
        "9a. GET /medical-certificates (owner) -> 200",
        r.status_code == 200,
        f"got {r.status_code} body={r.text[:300]}",
    )

    # Pending payment: create a booking with pending_offline=true, then mark paid.
    bk_body = {
        "patient_name": f"PP Smoke {uuid.uuid4().hex[:5]}",
        "patient_phone": f"99{int(time.time()) % 100000000:08d}",
        "country_code": "+91",
        "reason": "Smoke",
        "booking_date": "2026-08-15",
        "booking_time": "11:00",
        "mode": "in-person",
        "pending_offline": True,
    }
    r = requests.post(f"{BASE}/bookings", headers=H_OWNER, json=bk_body, timeout=20)
    check(
        "9b. POST /bookings with pending_offline=true -> 200",
        r.status_code == 200,
        f"got {r.status_code} body={r.text[:400]}",
    )
    bk = r.json() if r.status_code == 200 else {}
    bk_id = bk.get("booking_id") or bk.get("id")
    check(
        "9b.i  booking payment_status == 'pending_offline'",
        bk.get("payment_status") == "pending_offline",
        f"got payment_status={bk.get('payment_status')}",
    )

    if bk_id:
        r = requests.post(
            f"{BASE}/bookings/{bk_id}/mark-paid-offline",
            headers=H_OWNER, json={"mode": "cash", "notes": "smoke"}, timeout=15,
        )
        check(
            "9c. POST /bookings/{id}/mark-paid-offline -> 200",
            r.status_code == 200,
            f"got {r.status_code} body={r.text[:300]}",
        )
        r2 = requests.post(
            f"{BASE}/bookings/{bk_id}/mark-paid-offline",
            headers=H_OWNER, json={"mode": "cash"}, timeout=15,
        )
        check(
            "9c.i 2nd mark-paid-offline (idempotent) -> 200",
            r2.status_code == 200,
            f"got {r2.status_code} body={r2.text[:300]}",
        )
        r3 = requests.post(
            f"{BASE}/bookings/{bk_id}/mark-payment-pending",
            headers=H_OWNER, timeout=15,
        )
        check(
            "9d. POST /bookings/{id}/mark-payment-pending -> 200",
            r3.status_code == 200,
            f"got {r3.status_code} body={r3.text[:300]}",
        )
        # Cleanup booking
        cr = requests.delete(f"{BASE}/bookings/{bk_id}", headers=H_OWNER, timeout=15)
        LOG.append(f"   cleanup booking {bk_id} -> {cr.status_code}")

    # 10. Cleanup admissions
    for aid in created_ids:
        try:
            cr = requests.delete(
                f"{BASE}/ipd/admissions/{aid}", headers=H_OWNER, timeout=15,
            )
            LOG.append(f"   cleanup admission {aid} -> {cr.status_code}")
        except Exception as e:
            LOG.append(f"   cleanup admission {aid} EXC {e}")

    return summarize()


def summarize():
    print("\n---- LOG ----")
    for line in LOG:
        print(line)
    print(f"\n---- RESULT: {PASS} PASS / {FAIL} FAIL ----")
    sys.exit(0 if FAIL == 0 else 1)


if __name__ == "__main__":
    main()
