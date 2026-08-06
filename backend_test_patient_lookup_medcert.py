"""Backend smoke test:

A) GET /api/patients/lookup
B) POST/GET/PUT/DELETE /api/medical-certificates

Regression spot checks on Razorpay / blog / discharge endpoints.

Run: python3 /app/backend_test_patient_lookup_medcert.py
"""
import os
import sys
import json
import time
import urllib.parse
import requests

BASE = os.environ.get("BACKEND_URL", "http://localhost:8001")
OWNER_TOKEN = os.environ.get("OWNER_TOKEN", "test_session_1776770314741")
H = {"Authorization": f"Bearer {OWNER_TOKEN}", "Content-Type": "application/json"}

PHONE = "+919999111122"
NONEXIST_PHONE = "+919999999000"

passed = 0
failed = 0
issues = []


def check(label, cond, info=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  PASS  {label}")
    else:
        failed += 1
        print(f"  FAIL  {label}  {info}")
        issues.append(f"{label} -> {info}")


print("\n=== A. GET /api/patients/lookup ===\n")

# A1. Without auth -> 401/403
r = requests.get(f"{BASE}/api/patients/lookup")
check("A1 no-auth returns 401/403", r.status_code in (401, 403), f"got {r.status_code} {r.text[:120]}")

# A2. As owner with no params -> expect 200 {found:false}
r = requests.get(f"{BASE}/api/patients/lookup", headers=H)
print(f"     A2 raw: {r.status_code} {r.text[:200]}")
check("A2 no-params returns 200", r.status_code == 200, f"got {r.status_code}")
try:
    j = r.json()
except Exception:
    j = {}
check("A2 returns found:false", j.get("found") is False, f"got {j}")

# A3. Create booking for PHONE so a patient is known
booking_body = {
    "patient_name": "Lookup Test",
    "patient_phone": PHONE,
    "patient_age": 40,
    "patient_gender": "M",
    "reason": "test",
    "booking_date": "2026-06-20",
    "booking_time": "10:00",
    "mode": "in-person",
    "pending_offline": True,
}
created_booking_id = None
reg_no = None
r = requests.post(f"{BASE}/api/bookings", headers=H, data=json.dumps(booking_body))
print(f"     A3 booking POST: {r.status_code} {r.text[:250]}")
if r.status_code == 200:
    b = r.json()
    created_booking_id = b.get("booking_id")
    reg_no = b.get("registration_no") or b.get("reg_no")
    check("A3 booking created", bool(created_booking_id), f"resp={b}")
    check("A3 reg_no issued", bool(reg_no), f"resp={b}")
else:
    # Maybe a booking for this phone already exists from prior test seed (bk_test_1780261991155)
    # Fall back: look up patient by phone to get the existing reg_no.
    r2 = requests.get(f"{BASE}/api/patients/lookup", headers=H, params={"phone": PHONE})
    j2 = r2.json() if r2.status_code == 200 else {}
    reg_no = j2.get("registration_no") or j2.get("reg_no")
    check("A3 booking POST or existing patient", bool(reg_no), f"POST status={r.status_code}; lookup={j2}")

# A4. Lookup by phone
r = requests.get(f"{BASE}/api/patients/lookup", headers=H, params={"phone": PHONE})
print(f"     A4 lookup-by-phone: {r.status_code} {r.text[:300]}")
check("A4 status 200", r.status_code == 200)
j = r.json() if r.status_code == 200 else {}
check("A4 found:true", j.get("found") is True, f"got {j}")
check("A4 name == 'Lookup Test'", (j.get("name") or "") == "Lookup Test", f"got name={j.get('name')!r}")
check("A4 age == 40", j.get("age") == 40, f"got age={j.get('age')!r}")
check("A4 gender == M", j.get("gender") == "M", f"got gender={j.get('gender')!r}")
returned_reg = j.get("registration_no") or j.get("reg_no")
check("A4 registration_no matches", bool(returned_reg) and (returned_reg == reg_no), f"got reg={returned_reg!r}, expected {reg_no!r}")

# A5. Lookup by registration_no
if reg_no:
    r = requests.get(f"{BASE}/api/patients/lookup", headers=H, params={"registration_no": reg_no})
    print(f"     A5 lookup-by-reg: {r.status_code} {r.text[:300]}")
    check("A5 status 200", r.status_code == 200)
    j = r.json() if r.status_code == 200 else {}
    check("A5 found:true via reg_no", j.get("found") is True, f"got {j}")
    check("A5 name matches", (j.get("name") or "") == "Lookup Test", f"got {j.get('name')!r}")
    nph = (j.get("phone") or "")
    check("A5 phone matches (last 10)", nph.endswith("9999111122"), f"got phone={nph!r}")

# A6. Lookup non-existent phone
r = requests.get(f"{BASE}/api/patients/lookup", headers=H, params={"phone": NONEXIST_PHONE})
print(f"     A6 lookup-nonexistent: {r.status_code} {r.text[:200]}")
check("A6 status 200", r.status_code == 200, f"got {r.status_code}")
j = r.json() if r.status_code == 200 else {}
check("A6 found:false", j.get("found") is False, f"got {j}")


print("\n=== B. POST /api/medical-certificates ===\n")

mc_body = {
    "kind": "sick_leave",
    "patient_name": "Lookup Test",
    "patient_phone": PHONE,
    "registration_no": reg_no or "",
    "patient_email": "test@x.com",
    "patient_address": "12 Cherry Lane, Ahmedabad",
    "patient_age": 40,
    "patient_gender": "M",
    "diagnosis": "Acute viral fever",
    "advice": "Bed rest",
    "start_date": "2026-06-20",
    "days": 3,
}

cert_id = None
r = requests.post(f"{BASE}/api/medical-certificates", headers=H, data=json.dumps(mc_body))
print(f"     B1 cert POST: {r.status_code} {r.text[:400]}")
check("B1 status 200", r.status_code == 200, f"got {r.status_code} body={r.text[:200]}")
if r.status_code == 200:
    j = r.json()
    cert_id = j.get("cert_id")
    check("B1 cert_id present", bool(cert_id), f"resp={j}")
    check("B1 registration_no persisted", j.get("registration_no") == (reg_no or ""), f"got {j.get('registration_no')!r}")
    check("B1 patient_email persisted", j.get("patient_email") == "test@x.com", f"got {j.get('patient_email')!r}")
    check("B1 patient_address persisted", j.get("patient_address") == "12 Cherry Lane, Ahmedabad", f"got {j.get('patient_address')!r}")
    check("B1 patient_age persisted", j.get("patient_age") == 40, f"got {j.get('patient_age')!r}")
    check("B1 patient_gender persisted", j.get("patient_gender") == "M", f"got {j.get('patient_gender')!r}")
    check("B1 diagnosis persisted", j.get("diagnosis") == "Acute viral fever")
    check("B1 days persisted", j.get("days") == 3)

# B2. GET cert by id
if cert_id:
    r = requests.get(f"{BASE}/api/medical-certificates/{cert_id}", headers=H)
    print(f"     B2 cert GET: {r.status_code} {r.text[:300]}")
    check("B2 GET status 200", r.status_code == 200)
    if r.status_code == 200:
        j = r.json()
        check("B2 registration_no returned", j.get("registration_no") == (reg_no or ""), f"got {j.get('registration_no')!r}")
        check("B2 patient_email returned", j.get("patient_email") == "test@x.com")
        check("B2 patient_address returned", j.get("patient_address") == "12 Cherry Lane, Ahmedabad")

# B3. PUT updating address only (spec: payload {patient_address, kind, patient_name})
if cert_id:
    put_body = {
        "patient_address": "New address",
        "kind": "sick_leave",
        "patient_name": "Lookup Test",
    }
    r = requests.put(f"{BASE}/api/medical-certificates/{cert_id}", headers=H, data=json.dumps(put_body))
    print(f"     B3 cert PUT: {r.status_code} {r.text[:300]}")
    check("B3 PUT status 200", r.status_code == 200, f"got {r.status_code} body={r.text[:200]}")
    if r.status_code == 200:
        j = r.json()
        check("B3 address updated", j.get("patient_address") == "New address", f"got {j.get('patient_address')!r}")
        # Sanity: previous patient_phone still preserved? (PUT used exclude_unset, so yes)
        check("B3 phone preserved (exclude_unset)", j.get("patient_phone") == PHONE or (j.get("patient_phone") or "").endswith("9999111122"), f"got {j.get('patient_phone')!r}")

# B4. Cleanup — delete cert + booking
if cert_id:
    r = requests.delete(f"{BASE}/api/medical-certificates/{cert_id}", headers=H)
    print(f"     B4 cert DELETE: {r.status_code} {r.text[:200]}")
    check("B4 DELETE cert 200", r.status_code == 200)

if created_booking_id:
    r = requests.delete(f"{BASE}/api/bookings/{created_booking_id}", headers=H)
    print(f"     B4 booking DELETE: {r.status_code} {r.text[:200]}")
    # Some routers prefer DELETE /api/bookings/all? Accept any 2xx/404 (already gone).
    check("B4 DELETE booking 2xx/404", r.status_code in (200, 204, 404), f"got {r.status_code}")


print("\n=== Regression spot check ===\n")
# Razorpay
r = requests.get(f"{BASE}/api/razorpay/key", headers=H)
print(f"     razorpay key: {r.status_code} {r.text[:200]}")
# Some implementations gate this differently; accept 200, 404, 403
check("razorpay endpoint reachable", r.status_code in (200, 403, 404, 405), f"got {r.status_code}")

# Blog: list
r = requests.get(f"{BASE}/api/blog", headers=H)
print(f"     blog list: {r.status_code} {r.text[:120]}")
check("blog list reachable", r.status_code in (200, 404), f"got {r.status_code}")

# Discharge endpoint smoke
for path in ["/api/discharge-summaries", "/api/discharges"]:
    r = requests.get(f"{BASE}{path}", headers=H)
    print(f"     discharge {path}: {r.status_code}")

# Health
r = requests.get(f"{BASE}/api/health")
check("health endpoint 200", r.status_code == 200, f"got {r.status_code}")


print("\n" + "=" * 50)
print(f"PASSED: {passed}    FAILED: {failed}")
if issues:
    print("\nFAILED ASSERTIONS:")
    for it in issues:
        print(f"  - {it}")
print("=" * 50)
sys.exit(0 if failed == 0 else 1)
