"""Quick re-check of /api/patients/lookup enrichment fix.

Steps:
 1. POST /api/bookings with full patient details (incl. age/gender/email) — owner token.
 2. GET /api/patients/lookup?phone=... — owner — must contain age/gender/email + name + reg_no.
 3. GET /api/patients/lookup?registration_no=... — owner — same enrichment.
 4. Clean up the booking.
"""
import os
import sys
import requests

BASE = "https://urology-pro.preview.emergentagent.com/api"
OWNER = "test_session_1776770314741"
HEADERS = {"Authorization": f"Bearer {OWNER}", "Content-Type": "application/json"}

PHONE = "+919999111133"
BODY = {
    "patient_name": "Enrich Test",
    "patient_phone": PHONE,
    "patient_age": 45,
    "patient_gender": "F",
    "patient_email": "enrich@x.com",
    "reason": "test",
    "booking_date": "2026-06-21",
    "booking_time": "10:00",
    "mode": "in-person",
    "pending_offline": True,
}

fails = []
passes = []


def check(label, cond, info=""):
    if cond:
        passes.append(f"PASS {label}")
        print(f"PASS  {label}")
    else:
        fails.append(f"FAIL {label} {info}")
        print(f"FAIL  {label} {info}")


def main():
    # Step 1: create booking
    r = requests.post(f"{BASE}/bookings", json=BODY, headers=HEADERS, timeout=30)
    check("step1 POST /bookings 200", r.status_code == 200, f"status={r.status_code} body={r.text[:300]}")
    if r.status_code != 200:
        return
    j = r.json()
    booking_id = j.get("booking_id") or j.get("id")
    reg_no = j.get("registration_no")
    check("step1 registration_no present", bool(reg_no), f"j={j}")
    print(f"  -> booking_id={booking_id} reg_no={reg_no}")

    # Step 2: lookup by phone
    r2 = requests.get(f"{BASE}/patients/lookup", params={"phone": PHONE}, headers=HEADERS, timeout=30)
    check("step2 GET lookup?phone 200", r2.status_code == 200, f"status={r2.status_code} body={r2.text[:300]}")
    if r2.status_code == 200:
        j2 = r2.json()
        print(f"  -> lookup-by-phone: {j2}")
        check("step2 found=true", j2.get("found") is True)
        check("step2 name=Enrich Test", j2.get("name") == "Enrich Test", f"got={j2.get('name')}")
        check("step2 registration_no matches", j2.get("registration_no") == reg_no, f"got={j2.get('registration_no')}")
        check("step2 age=45", j2.get("age") == 45, f"got={j2.get('age')}")
        check("step2 gender=F", j2.get("gender") == "F", f"got={j2.get('gender')}")
        check("step2 email=enrich@x.com", j2.get("email") == "enrich@x.com", f"got={j2.get('email')}")

    # Step 3: lookup by registration_no
    r3 = requests.get(f"{BASE}/patients/lookup", params={"registration_no": reg_no}, headers=HEADERS, timeout=30)
    check("step3 GET lookup?registration_no 200", r3.status_code == 200, f"status={r3.status_code} body={r3.text[:300]}")
    if r3.status_code == 200:
        j3 = r3.json()
        print(f"  -> lookup-by-regno: {j3}")
        check("step3 found=true", j3.get("found") is True)
        check("step3 name=Enrich Test", j3.get("name") == "Enrich Test", f"got={j3.get('name')}")
        check("step3 registration_no matches", j3.get("registration_no") == reg_no, f"got={j3.get('registration_no')}")
        check("step3 age=45", j3.get("age") == 45, f"got={j3.get('age')}")
        check("step3 gender=F", j3.get("gender") == "F", f"got={j3.get('gender')}")
        check("step3 email=enrich@x.com", j3.get("email") == "enrich@x.com", f"got={j3.get('email')}")

    # Step 4: cleanup booking
    if booking_id:
        rd = requests.delete(f"{BASE}/bookings/{booking_id}", headers=HEADERS, timeout=30)
        # Some routes use DELETE on a different endpoint shape; report either way
        print(f"  -> cleanup DELETE /bookings/{booking_id}: {rd.status_code} {rd.text[:200]}")
        check("step4 cleanup 2xx", rd.status_code in (200, 204), f"status={rd.status_code} body={rd.text[:200]}")

    print(f"\nTotal pass={len(passes)} fail={len(fails)}")
    if fails:
        for f in fails:
            print(f)
        sys.exit(1)


if __name__ == "__main__":
    main()
