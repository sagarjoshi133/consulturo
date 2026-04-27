"""Backend tests for the 3 review-request items:

(1) GET /api/notifications/{id} new endpoint
(2) POST /api/bookings soft-block when authed user has no email
(3) GET /api/doctor service_categories with Kidney Transplantation as own section
"""
import os
import time
import uuid
import json
import requests
import subprocess
from datetime import datetime, timedelta, timezone

BASE = "http://localhost:8001/api"
OWNER_TOKEN = "test_session_1776770314741"
OWNER_USER_ID = "user_4775ed40276e"
DOCTOR_USER_ID = "doc-test-1776771431502"

PASS = []
FAIL = []

def check(name, cond, details=""):
    if cond:
        PASS.append(name)
        print(f"PASS  {name}")
    else:
        FAIL.append(f"{name} :: {details}")
        print(f"FAIL  {name} :: {details}")


def mongo(cmd):
    """Run a mongosh command and return stdout."""
    res = subprocess.run(
        ["mongosh", "--quiet", "--eval", f"db = db.getSiblingDB('consulturo'); {cmd}"],
        capture_output=True, text=True, timeout=20,
    )
    return res.stdout.strip()


def auth_h(token):
    return {"Authorization": f"Bearer {token}"}


# Tracking for cleanup
created_notification_ids = []
created_session_tokens = []
created_user_ids = []
created_booking_ids = []


# =============================================================
# (1) GET /api/notifications/{id}
# =============================================================
print("\n=== TEST 1: GET /api/notifications/{id} ===")

# 1c. No-auth -> 401
r = requests.get(f"{BASE}/notifications/anything")
check("1c. GET /api/notifications/{id} no-auth -> 401", r.status_code == 401, f"got {r.status_code}: {r.text[:200]}")

# 1b. Bogus id with auth -> 404
r = requests.get(f"{BASE}/notifications/__bogus__", headers=auth_h(OWNER_TOKEN))
check("1b. bogus id -> 404", r.status_code == 404, f"got {r.status_code}: {r.text[:200]}")
try:
    body = r.json()
    check("1b. detail == 'Not found'", body.get("detail") == "Not found", f"detail: {body.get('detail')}")
except Exception as e:
    check("1b. detail == 'Not found'", False, str(e))

# 1a. Insert a personal notification owned by owner with sender = doctor
notif_id = f"notif_test_{uuid.uuid4().hex[:10]}"
created_notification_ids.append(notif_id)
created_at_iso = datetime.now(timezone.utc).isoformat()
insert_cmd = (
    f"db.notifications.insertOne({{"
    f"id:'{notif_id}',"
    f"user_id:'{OWNER_USER_ID}',"
    f"title:'Personal hello',"
    f"body:'Hi from Dr Test',"
    f"kind:'personal',"
    f"read:false,"
    f"data:{{sender_user_id:'{DOCTOR_USER_ID}', sender_name:'Dr Test Doctor', sender_role:'doctor'}},"
    f"created_at:new Date()"
    f"}});"
)
out = mongo(insert_cmd)
print("insert:", out[:200])

# Now GET as owner
r = requests.get(f"{BASE}/notifications/{notif_id}", headers=auth_h(OWNER_TOKEN))
check("1a. GET personal notification as owner -> 200", r.status_code == 200, f"got {r.status_code}: {r.text[:300]}")
if r.status_code == 200:
    data = r.json()
    check("1a. id matches", data.get("id") == notif_id, f"id={data.get('id')}")
    check("1a. kind == 'personal'", data.get("kind") == "personal", f"kind={data.get('kind')}")
    check("1a. title round-trips", data.get("title") == "Personal hello")
    check("1a. body round-trips", data.get("body") == "Hi from Dr Test")
    check("1a. read == True after access", data.get("read") is True, f"read={data.get('read')}")
    d = data.get("data") or {}
    sender = d.get("sender")
    check("1a. data.sender present", isinstance(sender, dict), f"sender={sender}")
    if isinstance(sender, dict):
        check("1a. sender.user_id == DOCTOR_USER_ID", sender.get("user_id") == DOCTOR_USER_ID, f"sender.user_id={sender.get('user_id')}")
        check("1a. sender.name populated", bool(sender.get("name")), f"sender.name={sender.get('name')}")
        check("1a. sender.email populated", bool(sender.get("email")), f"sender.email={sender.get('email')}")
        check("1a. sender.role populated", bool(sender.get("role")), f"sender.role={sender.get('role')}")
    check("1a. source == 'notification'", data.get("source") == "notification", f"source={data.get('source')}")

# Verify read=True persisted in DB
out = mongo(f"print(JSON.stringify(db.notifications.findOne({{id:'{notif_id}'}}, {{read:1, read_at:1, _id:0}})));")
print("post-read DB row:", out)
try:
    row = json.loads(out)
    check("1a. DB row read==True", row.get("read") is True, f"row={row}")
except Exception:
    pass


# =============================================================
# (2) POST /api/bookings soft-block on no email
# =============================================================
print("\n=== TEST 2: POST /api/bookings email soft-block ===")

# Get a future slot — iterate forward until we find a day with >=3 slots
ist_offset = timedelta(hours=5, minutes=30)
ist_now = datetime.now(timezone.utc) + ist_offset
booking_date = None
slot_pool = []
for delta in range(2, 30):
    d = (ist_now + timedelta(days=delta)).date().strftime("%Y-%m-%d")
    r_slots = requests.get(f"{BASE}/availability/slots", params={"date": d, "mode": "in-person"})
    if r_slots.status_code != 200:
        continue
    sd = r_slots.json()
    pool = [s for s in (sd.get("slots") or []) if s not in (sd.get("booked_slots") or [])]
    if len(pool) >= 3:
        booking_date = d
        slot_pool = pool
        break
print(f"available slots {booking_date}: {slot_pool[:6]}")

def pick_slot():
    if not slot_pool:
        raise RuntimeError("no slots available for testing")
    return slot_pool.pop(0)


# 2a. Create phone-only user (no email) + session
phone_only_uid = f"test-phoneonly-{uuid.uuid4().hex[:10]}"
phone_only_token = f"test_phoneonly_session_{uuid.uuid4().hex[:10]}"
created_user_ids.append(phone_only_uid)
created_session_tokens.append(phone_only_token)
expires = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
mongo(
    f"db.users.insertOne({{user_id:'{phone_only_uid}', email:null, phone:'+919999900001', name:'Phone Only Test', role:'patient', created_at:new Date()}});"
)
mongo(
    f"db.user_sessions.insertOne({{user_id:'{phone_only_uid}', session_token:'{phone_only_token}', expires_at:new Date(Date.now()+2*24*60*60*1000), created_at:new Date()}});"
)

booking_payload = {
    "patient_name": "Phone Only Test",
    "patient_phone": "9999900001",
    "country_code": "+91",
    "patient_age": 35,
    "patient_gender": "Male",
    "reason": "Routine consult",
    "booking_date": booking_date,
    "booking_time": pick_slot(),
    "mode": "in-person",
}
r = requests.post(f"{BASE}/bookings", json=booking_payload, headers=auth_h(phone_only_token))
check("2a. phone-only user booking -> 403", r.status_code == 403, f"got {r.status_code}: {r.text[:300]}")
if r.status_code == 403:
    body = r.json()
    detail = body.get("detail")
    if isinstance(detail, dict):
        check("2a. detail.code == 'EMAIL_REQUIRED_FOR_BOOKING'",
              detail.get("code") == "EMAIL_REQUIRED_FOR_BOOKING",
              f"detail={detail}")
        check("2a. detail.message present", bool(detail.get("message")), f"message={detail.get('message')}")
    else:
        check("2a. detail is dict", False, f"detail={detail}")


# 2b. Owner with email
booking_payload_owner = {
    "patient_name": "Owner Email Test",
    "patient_phone": "9999900002",
    "country_code": "+91",
    "patient_age": 40,
    "patient_gender": "Male",
    "reason": "Owner regression",
    "booking_date": booking_date,
    "booking_time": pick_slot(),
    "mode": "in-person",
}
r = requests.post(f"{BASE}/bookings", json=booking_payload_owner, headers=auth_h(OWNER_TOKEN))
check("2b. owner booking succeeds -> 200", r.status_code == 200, f"got {r.status_code}: {r.text[:300]}")
if r.status_code == 200:
    bid = r.json().get("booking_id")
    check("2b. booking_id returned", bool(bid), f"resp={r.json()}")
    if bid:
        created_booking_ids.append(bid)


# 2c. Anonymous (no auth header) booking
booking_payload_anon = {
    "patient_name": "Guest Anon Test",
    "patient_phone": "9999900003",
    "country_code": "+91",
    "patient_age": 30,
    "patient_gender": "Female",
    "reason": "Guest booking",
    "booking_date": booking_date,
    "booking_time": pick_slot(),
    "mode": "in-person",
}
r = requests.post(f"{BASE}/bookings", json=booking_payload_anon)
check("2c. anonymous (no auth) booking succeeds -> 200", r.status_code == 200, f"got {r.status_code}: {r.text[:300]}")
if r.status_code == 200:
    bid = r.json().get("booking_id")
    check("2c. anon booking_id returned", bool(bid), f"resp={r.json()}")
    if bid:
        created_booking_ids.append(bid)


# =============================================================
# (3) GET /api/doctor service_categories
# =============================================================
print("\n=== TEST 3: GET /api/doctor service_categories ===")
r = requests.get(f"{BASE}/doctor")
check("3. GET /api/doctor -> 200", r.status_code == 200, f"got {r.status_code}")
if r.status_code == 200:
    data = r.json()
    cats = data.get("service_categories") or []
    titles = [c.get("title") for c in cats]
    print("titles:", titles)
    check("3. 'Kidney Transplantation' in service_categories",
          "Kidney Transplantation" in titles,
          f"titles={titles}")
    check("3. 'Kidney & Stone' in service_categories",
          "Kidney & Stone" in titles,
          f"titles={titles}")

    # Validate Kidney Transplantation items
    kt = next((c for c in cats if c.get("title") == "Kidney Transplantation"), None)
    if kt:
        items = kt.get("items") or []
        expected = [
            "Living-donor Kidney Transplant",
            "Deceased-donor (Cadaveric) Transplant",
            "ABO-incompatible Transplant",
            "Pre-transplant Evaluation",
            "Post-transplant Follow-up & Care",
            "Vascular Access for Haemodialysis",
        ]
        for exp in expected:
            check(f"3. Kidney Transplantation has '{exp}'", exp in items, f"items={items}")

    # Validate Kidney & Stone does NOT contain "Kidney Transplantation"
    ks = next((c for c in cats if c.get("title") == "Kidney & Stone"), None)
    if ks:
        ks_items = ks.get("items") or []
        check("3. 'Kidney & Stone' does NOT have 'Kidney Transplantation' as child item",
              "Kidney Transplantation" not in ks_items,
              f"ks_items={ks_items}")


# =============================================================
# CLEANUP
# =============================================================
print("\n=== CLEANUP ===")

# Delete created notifications
for nid in created_notification_ids:
    out = mongo(f"print(db.notifications.deleteOne({{id:'{nid}'}}).deletedCount);")
    print(f"deleted notification {nid}: {out}")

# Cancel + delete created bookings
for bid in created_booking_ids:
    requests.patch(f"{BASE}/bookings/{bid}", json={"status": "cancelled"}, headers=auth_h(OWNER_TOKEN))
    out = mongo(f"print(db.bookings.deleteOne({{booking_id:'{bid}'}}).deletedCount);")
    print(f"deleted booking {bid}: {out}")

# Delete created sessions and users
for tok in created_session_tokens:
    out = mongo(f"print(db.user_sessions.deleteOne({{session_token:'{tok}'}}).deletedCount);")
    print(f"deleted session {tok}: {out}")

for uid in created_user_ids:
    out = mongo(f"print(db.users.deleteOne({{user_id:'{uid}'}}).deletedCount);")
    print(f"deleted user {uid}: {out}")

# Also clean up any bookings for the test phones, just in case
for ph in ["9999900001", "9999900002", "9999900003"]:
    out = mongo(f"print(db.bookings.deleteMany({{patient_phone:'{ph}'}}).deletedCount);")
    out2 = mongo(f"print(db.patients.deleteMany({{phone_e164:{{$regex:'{ph}'}}}}).deletedCount);")
    print(f"residual bookings for {ph}: {out}, patients: {out2}")


# =============================================================
print("\n=== SUMMARY ===")
print(f"PASS: {len(PASS)}")
print(f"FAIL: {len(FAIL)}")
for f in FAIL:
    print(f"  - {f}")
