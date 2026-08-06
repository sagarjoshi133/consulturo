"""Re-test for /api/patients/lookup after fix (canonical resolver in routers/patients.py)."""
import requests
import os
import sys

BASE = "http://localhost:8001"
OWNER_TOKEN = "test_session_1776770314741"
H = {"Authorization": f"Bearer {OWNER_TOKEN}"}

results = []

def check(desc, cond, extra=""):
    status = "PASS" if cond else "FAIL"
    results.append((status, desc, extra))
    print(f"[{status}] {desc} {extra}")

# 1. lookup with no params as owner
r = requests.get(f"{BASE}/api/patients/lookup", headers=H)
check("GET /api/patients/lookup (no params) returns 200", r.status_code == 200, f"status={r.status_code}")
try:
    j = r.json()
except Exception:
    j = {}
check("GET /api/patients/lookup (no params) returns {found:false}", j.get("found") is False, f"body={j}")

# 2. Create booking
booking_body = {
    "patient_name": "Lookup Test",
    "patient_phone": "+919999111122",
    "patient_age": 40,
    "patient_gender": "M",
    "reason": "test",
    "booking_date": "2026-06-20",
    "booking_time": "10:00",
    "mode": "in-person",
    "pending_offline": True,
}
r = requests.post(f"{BASE}/api/bookings", headers={**H, "Content-Type": "application/json"}, json=booking_body)
check("POST /api/bookings returns 200", r.status_code == 200, f"status={r.status_code} body={r.text[:300]}")
try:
    booking = r.json()
except Exception:
    booking = {}
reg_no = booking.get("registration_no")
booking_id = booking.get("booking_id")
check("POST /api/bookings allocates registration_no", bool(reg_no), f"reg_no={reg_no}")
check("POST /api/bookings returns booking_id", bool(booking_id), f"booking_id={booking_id}")

# 3. lookup by phone
r = requests.get(f"{BASE}/api/patients/lookup", headers=H, params={"phone": "+919999111122"})
check("GET /api/patients/lookup?phone=+919999111122 returns 200", r.status_code == 200, f"status={r.status_code}")
try:
    j = r.json()
except Exception:
    j = {}
check("lookup by phone: found=true", j.get("found") is True, f"body={j}")
check("lookup by phone: name=Lookup Test", j.get("name") == "Lookup Test", f"name={j.get('name')}")
check("lookup by phone: age=40", j.get("age") == 40, f"age={j.get('age')}")
check("lookup by phone: gender=M", j.get("gender") == "M", f"gender={j.get('gender')}")
check("lookup by phone: registration_no matches", j.get("registration_no") == reg_no, f"got={j.get('registration_no')} expected={reg_no}")

# 4. lookup by registration_no
if reg_no:
    r = requests.get(f"{BASE}/api/patients/lookup", headers=H, params={"registration_no": reg_no})
    check(f"GET /api/patients/lookup?registration_no={reg_no} returns 200", r.status_code == 200, f"status={r.status_code}")
    try:
        j = r.json()
    except Exception:
        j = {}
    check("lookup by reg_no: found=true", j.get("found") is True, f"body={j}")
    check("lookup by reg_no: name=Lookup Test", j.get("name") == "Lookup Test", f"name={j.get('name')}")
    phone_val = (j.get("phone") or "")
    check("lookup by reg_no: phone contains 9999111122",
          "9999111122" in phone_val, f"phone={phone_val}")

# 5. lookup non-existent phone
r = requests.get(f"{BASE}/api/patients/lookup", headers=H, params={"phone": "+919999999000"})
check("GET /api/patients/lookup?phone=+919999999000 returns 200", r.status_code == 200, f"status={r.status_code}")
try:
    j = r.json()
except Exception:
    j = {}
check("lookup non-existent: found=false", j.get("found") is False, f"body={j}")

# 6. Auth gate
r = requests.get(f"{BASE}/api/patients/lookup", params={"phone": "+919999111122"})
check("GET /api/patients/lookup without token returns 401/403", r.status_code in (401, 403), f"status={r.status_code}")

# Cleanup booking
if booking_id:
    r = requests.delete(f"{BASE}/api/bookings/{booking_id}", headers=H)
    print(f"[CLEANUP] DELETE /api/bookings/{booking_id} -> {r.status_code}")

# Summary
total = len(results)
passed = sum(1 for s, *_ in results if s == "PASS")
print(f"\n=== {passed}/{total} PASS ===")
sys.exit(0 if passed == total else 1)
