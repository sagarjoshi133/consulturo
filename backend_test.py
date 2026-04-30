"""Backend tests — Missed-flip self-healing, Primary-Owner Hard-Delete,
Analytics status_breakdown extension, and PATCH status="missed".

Targets the public ingress URL; uses the pre-seeded sessions documented
in /app/memory/test_credentials.md.

End-state: all test bookings/notifications are cleaned up.
"""
import os
import sys
import json
import uuid
import time
import subprocess
from datetime import datetime, timedelta, timezone

import requests

BASE = "https://urology-pro.preview.emergentagent.com/api"
OWNER_TOKEN = "test_session_1776770314741"   # sagar.joshi133@gmail.com (primary_owner)
DOCTOR_TOKEN = "test_doc_1776771431524"      # dr.test@example.com (doctor)
CLINIC_ID = "clinic_a97b903f2fb2"

OWNER_HDR = {
    "Authorization": f"Bearer {OWNER_TOKEN}",
    "X-Clinic-Id": CLINIC_ID,
    "Content-Type": "application/json",
}
DOCTOR_HDR = {
    "Authorization": f"Bearer {DOCTOR_TOKEN}",
    "X-Clinic-Id": CLINIC_ID,
    "Content-Type": "application/json",
}

PASS = 0
FAIL = 0
FAILS = []


def check(cond, label):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ✓ {label}")
    else:
        FAIL += 1
        FAILS.append(label)
        print(f"  ✗ {label}")


def section(name):
    print("\n" + "=" * 70)
    print(name)
    print("=" * 70)


def mongo(js: str) -> str:
    full = f'db = db.getSiblingDB("consulturo"); {js}'
    r = subprocess.run(
        ["mongosh", "--quiet", "--eval", full],
        capture_output=True, text=True, timeout=30,
    )
    return (r.stdout or "") + (r.stderr or "")


# ============================================================
# A. MISSED-FLIP SELF-HEALING
# ============================================================
section("A. Missed-flip self-healing")

ist = timezone(timedelta(hours=5, minutes=30))
now_ist = datetime.now(ist)
two_days_ago = (now_ist - timedelta(days=2)).date().isoformat()
today_ist = now_ist.date().isoformat()
yesterday_ist = (now_ist - timedelta(days=1)).date().isoformat()

bk_test_missed = f"bk_testmiss_{uuid.uuid4().hex[:8]}"
bk_test_today = f"bk_testtoday_{uuid.uuid4().hex[:8]}"
bk_test_yest = f"bk_testyest_{uuid.uuid4().hex[:8]}"

# Cleanup any leftover from prior runs first.
mongo("""db.bookings.deleteMany({booking_id: {$regex: "^bk_(testmiss|testtoday|testyest|qatest)_"}});""")
mongo("""db.notifications.deleteMany({kind: "booking_missed", "data.booking_id": {$regex: "^bk_(testmiss|testtoday|testyest|qatest)_"}});""")

mongo(f"""db.bookings.insertOne({{
  booking_id: "{bk_test_missed}",
  user_id: "user_4775ed40276e",
  clinic_id: "{CLINIC_ID}",
  patient_name: "QA Missed Test",
  patient_phone: "9999000001",
  country_code: "+91",
  registration_no: "QA000001",
  reason: "QA self-heal sweep",
  booking_date: "{two_days_ago}",
  booking_time: "10:00",
  original_date: "{two_days_ago}",
  original_time: "10:00",
  mode: "offline",
  status: "confirmed",
  created_at: new Date(Date.now() - 3*24*3600*1000)
}});""")

mongo(f"""db.bookings.insertOne({{
  booking_id: "{bk_test_today}",
  user_id: "user_4775ed40276e",
  clinic_id: "{CLINIC_ID}",
  patient_name: "QA Today Test",
  patient_phone: "9999000002",
  country_code: "+91",
  registration_no: "QA000002",
  reason: "QA today not flip",
  booking_date: "{today_ist}",
  booking_time: "23:30",
  original_date: "{today_ist}",
  original_time: "23:30",
  mode: "offline",
  status: "confirmed",
  created_at: new Date()
}});""")

mongo(f"""db.bookings.insertOne({{
  booking_id: "{bk_test_yest}",
  user_id: "user_4775ed40276e",
  clinic_id: "{CLINIC_ID}",
  patient_name: "QA Yesterday Edge",
  patient_phone: "9999000003",
  country_code: "+91",
  registration_no: "QA000003",
  reason: "QA edge yesterday late",
  booking_date: "{yesterday_ist}",
  booking_time: "23:30",
  original_date: "{yesterday_ist}",
  original_time: "23:30",
  mode: "offline",
  status: "confirmed",
  created_at: new Date(Date.now() - 1*24*3600*1000)
}});""")

# Trigger sweep via GET /api/bookings/all
r = requests.get(f"{BASE}/bookings/all", headers=OWNER_HDR, timeout=30)
check(r.status_code == 200, f"GET /api/bookings/all 200 (got {r.status_code})")
bookings = r.json() if r.status_code == 200 else []
check(isinstance(bookings, list), "GET /api/bookings/all returns list")

bk_map = {b.get("booking_id"): b for b in bookings}

b1 = bk_map.get(bk_test_missed)
check(b1 is not None, f"{bk_test_missed} appears in /bookings/all")
if b1:
    check(b1.get("status") == "missed", f"{bk_test_missed} status flipped to 'missed' (got {b1.get('status')})")
    check(b1.get("missed_auto") is True, f"{bk_test_missed} missed_auto=true")
    check(b1.get("missed_at") is not None, f"{bk_test_missed} has missed_at timestamp")

b2 = bk_map.get(bk_test_today)
check(b2 is not None, f"{bk_test_today} appears in /bookings/all")
if b2:
    check(b2.get("status") == "confirmed", f"{bk_test_today} (today) NOT flipped (status={b2.get('status')})")

b3 = bk_map.get(bk_test_yest)
check(b3 is not None, f"{bk_test_yest} appears in /bookings/all (no crash)")
if b3:
    print(f"     [edge] {bk_test_yest} status={b3.get('status')}, missed_auto={b3.get('missed_auto')}")

notif_check = mongo(f"""print(db.notifications.countDocuments({{kind: "booking_missed", "data.booking_id": "{bk_test_missed}"}}));""")
try:
    notif_count = int(notif_check.strip().split("\n")[-1])
except Exception:
    notif_count = 0
check(notif_count >= 1, f"notification kind=booking_missed written for {bk_test_missed} (count={notif_count})")

r2 = requests.get(f"{BASE}/bookings/all", headers=OWNER_HDR, timeout=30)
check(r2.status_code == 200, "Idempotent re-sweep 200")
notif_check2 = mongo(f"""print(db.notifications.countDocuments({{kind: "booking_missed", "data.booking_id": "{bk_test_missed}"}}));""")
try:
    notif_count2 = int(notif_check2.strip().split("\n")[-1])
except Exception:
    notif_count2 = 0
check(notif_count2 == notif_count, f"No duplicate notification on re-sweep ({notif_count2} == {notif_count})")


# ============================================================
# B. PRIMARY-OWNER HARD-DELETE
# ============================================================
section("B. Primary-Owner Hard-Delete")

future_date = (now_ist + timedelta(days=7)).date().isoformat()
payload = {
    "patient_name": "QA Delete Test Patient",
    "patient_phone": "9999000099",
    "country_code": "+91",
    "patient_age": 55,
    "patient_gender": "Male",
    "reason": "QA delete-test booking",
    "booking_date": future_date,
    "booking_time": "11:00",
    "mode": "offline",
}
r = requests.post(f"{BASE}/bookings", headers=OWNER_HDR, json=payload, timeout=30)
check(r.status_code == 200, f"POST /api/bookings 200 (got {r.status_code}: {r.text[:200]})")
created = r.json() if r.status_code == 200 else {}
new_bid = created.get("booking_id")
check(bool(new_bid), f"new booking has booking_id ({new_bid})")

if new_bid:
    r = requests.delete(f"{BASE}/bookings/{new_bid}", headers=DOCTOR_HDR, timeout=20)
    check(r.status_code == 403, f"DELETE as doctor → 403 (got {r.status_code})")

if new_bid:
    r = requests.delete(f"{BASE}/bookings/{new_bid}", headers=OWNER_HDR, timeout=20)
    check(r.status_code == 200, f"DELETE as owner → 200 (got {r.status_code}: {r.text[:200]})")
    body = r.json() if r.status_code == 200 else {}
    check(body.get("ok") is True, f"DELETE response has ok:true (body={body})")

    r2 = requests.get(f"{BASE}/bookings/{new_bid}", headers=OWNER_HDR, timeout=20)
    check(r2.status_code == 404, f"GET deleted booking → 404 (got {r2.status_code})")

r = requests.delete(f"{BASE}/bookings/bk_doesnotexist_xyz", headers=OWNER_HDR, timeout=20)
check(r.status_code == 404, f"DELETE non-existent id → 404 (got {r.status_code})")


# ============================================================
# C. ANALYTICS status_breakdown extended
# ============================================================
section("C. Analytics status_breakdown shape")

r = requests.get(f"{BASE}/analytics/dashboard", headers=OWNER_HDR, timeout=30)
check(r.status_code == 200, f"GET /api/analytics/dashboard 200 (got {r.status_code})")
data = r.json() if r.status_code == 200 else {}
sb = data.get("status_breakdown") or {}

required_keys = {"requested", "confirmed", "rescheduled", "completed", "cancelled", "rejected", "missed"}
present = set(sb.keys())
missing = required_keys - present
check(not missing, f"status_breakdown contains all 7 keys (missing={missing})")
for k in required_keys:
    check(isinstance(sb.get(k), int), f"status_breakdown.{k} is int (got {type(sb.get(k)).__name__}={sb.get(k)})")

missed_before = sb.get("missed", 0)
print(f"     [snapshot] status_breakdown = {sb}")

future_date2 = (now_ist + timedelta(days=8)).date().isoformat()
payload2 = {
    "patient_name": "QA Missed PATCH Patient",
    "patient_phone": "9999000088",
    "country_code": "+91",
    "reason": "QA PATCH missed",
    "booking_date": future_date2,
    "booking_time": "12:00",
    "mode": "offline",
}
r = requests.post(f"{BASE}/bookings", headers=OWNER_HDR, json=payload2, timeout=30)
check(r.status_code == 200, f"POST /api/bookings (for PATCH test) 200 (got {r.status_code})")
patch_bid = (r.json() or {}).get("booking_id")
check(bool(patch_bid), f"PATCH-target booking_id ({patch_bid})")

if patch_bid:
    r = requests.patch(f"{BASE}/bookings/{patch_bid}", headers=OWNER_HDR,
                       json={"status": "confirmed"}, timeout=20)
    check(r.status_code == 200, f"PATCH status→confirmed 200 (got {r.status_code})")

    r = requests.patch(f"{BASE}/bookings/{patch_bid}", headers=OWNER_HDR,
                       json={"status": "missed"}, timeout=20)
    check(r.status_code == 200, f"PATCH status→missed 200 (got {r.status_code}: {r.text[:200]})")

    r = requests.get(f"{BASE}/analytics/dashboard", headers=OWNER_HDR, timeout=30)
    sb2 = (r.json() or {}).get("status_breakdown") or {}
    missed_after = sb2.get("missed", 0)
    check(missed_after >= missed_before + 1,
          f"analytics missed count increased ({missed_before} → {missed_after})")

    r = requests.delete(f"{BASE}/bookings/{patch_bid}", headers=OWNER_HDR, timeout=20)
    check(r.status_code == 200, f"cleanup DELETE PATCH-target → 200 (got {r.status_code})")


# ============================================================
# D. SMOKE — other PATCH status values still accepted
# ============================================================
section("D. PATCH status regression smoke")

future_date3 = (now_ist + timedelta(days=9)).date().isoformat()
smoke_bookings = []

for idx, status in enumerate(["confirmed", "completed", "cancelled", "rejected"]):
    p = {
        "patient_name": f"QA Smoke {status}",
        "patient_phone": f"99990001{idx:02d}",
        "country_code": "+91",
        "reason": f"QA status={status}",
        "booking_date": future_date3,
        "booking_time": f"{14 + idx:02d}:00",
        "mode": "offline",
    }
    r = requests.post(f"{BASE}/bookings", headers=OWNER_HDR, json=p, timeout=30)
    check(r.status_code == 200, f"POST smoke booking ({status}) 200 (got {r.status_code}: {r.text[:160]})")
    bid = (r.json() or {}).get("booking_id")
    if not bid:
        continue
    smoke_bookings.append(bid)

    r = requests.patch(f"{BASE}/bookings/{bid}", headers=OWNER_HDR,
                       json={"status": status}, timeout=20)
    check(r.status_code == 200, f"PATCH status→{status} 200 (got {r.status_code}: {r.text[:160]})")

for bid in smoke_bookings:
    requests.delete(f"{BASE}/bookings/{bid}", headers=OWNER_HDR, timeout=20)


# ============================================================
# CLEANUP
# ============================================================
section("Cleanup")
for bid in (bk_test_missed, bk_test_today, bk_test_yest):
    out = mongo(f"""print(db.bookings.deleteMany({{booking_id: "{bid}"}}).deletedCount);""")
    last = out.strip().splitlines()[-1] if out.strip() else "?"
    print(f"  deleted booking {bid}: {last}")

mongo("""db.notifications.deleteMany({kind: "booking_missed", "data.booking_id": {$regex: "^bk_(testmiss|testtoday|testyest|qatest)_"}});""")
print("  cleaned notifications kind=booking_missed for QA test bookings")


print("\n" + "=" * 70)
print(f"RESULT: {PASS} PASS / {FAIL} FAIL")
if FAILS:
    print("\nFailures:")
    for f in FAILS:
        print(f"  - {f}")
print("=" * 70)
sys.exit(0 if FAIL == 0 else 1)
