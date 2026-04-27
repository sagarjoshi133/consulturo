"""Backend tests for new POST /api/bookings country_code field and
PATCH /api/bookings/{id} doctor_note field.

Runs against http://localhost:8001 with the OWNER token from
/app/memory/test_credentials.md.
"""
import json
import sys
from datetime import datetime, timedelta, timezone
import requests

BASE = "http://localhost:8001/api"
OWNER_TOKEN = "test_session_1776770314741"
HDR_OWNER = {"Authorization": f"Bearer {OWNER_TOKEN}"}

IST = timezone(timedelta(hours=5, minutes=30))
tomorrow = (datetime.now(IST) + timedelta(days=1)).strftime("%Y-%m-%d")


PASS = []
FAIL = []


def check(cond, label, extra=""):
    if cond:
        PASS.append(label)
        print(f"  ✅ {label}")
    else:
        FAIL.append(f"{label} — {extra}")
        print(f"  ❌ {label} — {extra}")


def pick_unique_slot(base_time="10:30"):
    """Find a time slot on tomorrow that has no existing booking to avoid 409."""
    # We'll use minutes offsets on tomorrow's date
    import random
    h = random.randint(6, 20)
    m = random.choice([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55])
    return f"{h:02d}:{m:02d}"


created_booking_ids = []


def create_booking(body):
    r = requests.post(f"{BASE}/bookings", json=body, headers=HDR_OWNER, timeout=15)
    return r


print("\n=== TEST 1: POST /api/bookings accepts country_code ===")

# Retry until we find a free slot (avoid 409 clashes)
booking_id_1 = None
resp_body_1 = None
for attempt in range(10):
    slot = pick_unique_slot()
    body1 = {
        "patient_name": "Priya Sharma",
        "patient_phone": f"98765{datetime.now().microsecond % 100000:05d}",
        "country_code": "+44",
        "patient_age": 30,
        "patient_gender": "Female",
        "reason": "Testing country code persistence",
        "booking_date": tomorrow,
        "booking_time": slot,
        "mode": "in-person",
    }
    r = create_booking(body1)
    if r.status_code == 200:
        resp_body_1 = r.json()
        booking_id_1 = resp_body_1.get("booking_id")
        break
    elif r.status_code == 409:
        continue
    else:
        break

print(f"\nPOST /bookings with country_code=+44 → status {r.status_code}")
print(f"Body: {json.dumps(resp_body_1, indent=2, default=str)[:600] if resp_body_1 else r.text[:400]}")

check(r.status_code == 200, "T1.1 POST returns 200", f"got {r.status_code}: {r.text[:200]}")
if resp_body_1:
    check(resp_body_1.get("country_code") == "+44", "T1.2 response.country_code == '+44'", f"got {resp_body_1.get('country_code')!r}")
    check(resp_body_1.get("status") == "requested", "T1.3 status == 'requested'", f"got {resp_body_1.get('status')}")
    check(resp_body_1.get("patient_name") == "Priya Sharma", "T1.4 patient_name persisted")
    check(resp_body_1.get("booking_id", "").startswith("bk_"), "T1.5 booking_id format")

# GET back
if booking_id_1:
    r = requests.get(f"{BASE}/bookings/{booking_id_1}", headers=HDR_OWNER, timeout=10)
    print(f"\nGET /bookings/{booking_id_1} → {r.status_code}")
    g = r.json() if r.status_code == 200 else None
    check(r.status_code == 200, "T1.6 GET returns 200")
    if g:
        check(g.get("country_code") == "+44", "T1.7 GET country_code == '+44'", f"got {g.get('country_code')!r}")
    created_booking_ids.append(booking_id_1)


# Now POST without country_code → should default to +91
print("\n--- POST without country_code (should default to +91) ---")
booking_id_2 = None
resp_body_2 = None
for attempt in range(10):
    slot = pick_unique_slot()
    body2 = {
        "patient_name": "Rahul Verma",
        "patient_phone": f"91234{datetime.now().microsecond % 100000:05d}",
        "patient_age": 45,
        "patient_gender": "Male",
        "reason": "Backward compatibility test — no country_code",
        "booking_date": tomorrow,
        "booking_time": slot,
        "mode": "in-person",
    }
    r = create_booking(body2)
    if r.status_code == 200:
        resp_body_2 = r.json()
        booking_id_2 = resp_body_2.get("booking_id")
        break
    elif r.status_code == 409:
        continue
    else:
        break

print(f"POST → {r.status_code}")
print(f"Body: {json.dumps(resp_body_2, indent=2, default=str)[:500] if resp_body_2 else r.text[:300]}")
check(r.status_code == 200, "T1.8 POST without country_code → 200")
if resp_body_2:
    check(resp_body_2.get("country_code") == "+91", "T1.9 default country_code == '+91'", f"got {resp_body_2.get('country_code')!r}")
    created_booking_ids.append(booking_id_2)


print("\n\n=== TEST 2: PATCH /api/bookings/{id} accepts doctor_note ===")

if not booking_id_1:
    print("  ⚠️ No booking from T1 — skipping T2")
else:
    bid = booking_id_1
    note_text = "Carry past USG; re-check culture"

    # PATCH doctor_note
    r = requests.patch(
        f"{BASE}/bookings/{bid}",
        json={"doctor_note": note_text},
        headers=HDR_OWNER,
        timeout=10,
    )
    print(f"\nPATCH doctor_note → {r.status_code}")
    print(f"Body: {r.text[:700]}")
    check(r.status_code == 200, "T2.1 PATCH returns 200", f"got {r.status_code}: {r.text[:200]}")
    pdoc = r.json() if r.status_code == 200 else {}
    check(pdoc.get("doctor_note") == note_text, "T2.2 response.doctor_note matches", f"got {pdoc.get('doctor_note')!r}")
    check(pdoc.get("doctor_note_at") is not None, "T2.3 doctor_note_at present")
    check(pdoc.get("doctor_note_by") is not None, "T2.4 doctor_note_by present")
    check(pdoc.get("doctor_note_by_name") is not None, "T2.5 doctor_note_by_name present")

    # GET back
    r = requests.get(f"{BASE}/bookings/{bid}", headers=HDR_OWNER, timeout=10)
    g = r.json() if r.status_code == 200 else {}
    print(f"\nGET after PATCH → doctor_note={g.get('doctor_note')!r}, approver_note={g.get('approver_note')!r}, last_note={g.get('last_note')!r}")
    check(g.get("doctor_note") == note_text, "T2.6 GET doctor_note persists", f"got {g.get('doctor_note')!r}")
    check(g.get("approver_note") in (None, ""), "T2.7 approver_note NOT touched", f"got {g.get('approver_note')!r}")

    # PATCH with approver_note (via `note` field → stored as last_note/approver_note on confirm)
    # To test separation, patch note (general) and confirm they don't overwrite doctor_note
    r = requests.patch(
        f"{BASE}/bookings/{bid}",
        json={"note": "General update note"},
        headers=HDR_OWNER,
        timeout=10,
    )
    after2 = r.json() if r.status_code == 200 else {}
    check(after2.get("doctor_note") == note_text, "T2.8 doctor_note NOT altered by note-only PATCH", f"got {after2.get('doctor_note')!r}")
    check(after2.get("last_note") == "General update note", "T2.9 last_note stored separately")

    # PATCH doctor_note = "" → should clear
    r = requests.patch(
        f"{BASE}/bookings/{bid}",
        json={"doctor_note": ""},
        headers=HDR_OWNER,
        timeout=10,
    )
    cleared = r.json() if r.status_code == 200 else {}
    check(r.status_code == 200, "T2.10 PATCH doctor_note='' returns 200")
    check(cleared.get("doctor_note") == "", "T2.11 doctor_note cleared to empty string", f"got {cleared.get('doctor_note')!r}")

    # Verify approver_note still untouched
    check(cleared.get("last_note") == "General update note", "T2.12 last_note untouched when clearing doctor_note")

    # PATCH unauthenticated → 401/403
    r = requests.patch(
        f"{BASE}/bookings/{bid}",
        json={"doctor_note": "hack attempt"},
        timeout=10,
    )
    print(f"\nPATCH (no auth) → {r.status_code}")
    check(r.status_code in (401, 403), "T2.13 unauthenticated PATCH rejected", f"got {r.status_code}")


print("\n\n=== TEST 3: Regression ===")

r = requests.get(f"{BASE}/bookings/all", headers=HDR_OWNER, timeout=15)
print(f"GET /bookings/all → {r.status_code}, items={len(r.json()) if r.status_code == 200 else 'n/a'}")
check(r.status_code == 200, "T3.1 /bookings/all → 200")
if r.status_code == 200:
    check(isinstance(r.json(), list), "T3.2 /bookings/all returns list")
    # Check that our just-created bookings exist and have country_code
    arr = r.json()
    b1 = next((b for b in arr if b.get("booking_id") == booking_id_1), None)
    b2 = next((b for b in arr if b.get("booking_id") == booking_id_2), None)
    if b1:
        check(b1.get("country_code") == "+44", "T3.3 booking1 country_code persisted in /all", f"got {b1.get('country_code')!r}")
    if b2:
        check(b2.get("country_code") == "+91", "T3.4 booking2 default country_code persisted in /all", f"got {b2.get('country_code')!r}")

r = requests.get(f"{BASE}/bookings/me", headers=HDR_OWNER, timeout=10)
print(f"GET /bookings/me → {r.status_code}")
check(r.status_code == 200, "T3.5 /bookings/me → 200 for authed user")


# Cleanup: delete test bookings we created
print("\n\n=== Cleanup ===")
from pymongo import MongoClient
import os
try:
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    mc = MongoClient(mongo_url)
    mdb = mc["consulturo"]
    for bid in created_booking_ids:
        if bid:
            res = mdb.bookings.delete_one({"booking_id": bid})
            print(f"  deleted {bid}: {res.deleted_count}")
            # Delete related notifications
            mdb.notifications.delete_many({"data.booking_id": bid})
except Exception as e:
    print(f"  cleanup warn: {e}")


print("\n\n====================")
print(f"PASS: {len(PASS)} / FAIL: {len(FAIL)}")
if FAIL:
    print("\nFailed:")
    for f in FAIL:
        print(f"  - {f}")
    sys.exit(1)
print("ALL TESTS PASSED")
