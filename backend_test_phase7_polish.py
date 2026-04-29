"""Phase 7 polish smoke test for ConsultUro backend.

Covers:
  - PUBLIC endpoints (health, blog, diseases, clinic-settings)
  - AUTH FLOW: /api/auth/otp/request
  - CLINICAL CRUD: bookings + prescriptions (incl. partner DELETE)
  - AUTH GATING regression
  - ROLE-CHANGE flow (notify_role_change → pretty_role → create_notification → push_to_user)
  - UNTOUCHED endpoints sanity (team / admin/partners / notifications / broadcasts)
  - SERVICES IMPORT REGRESSION (server.X is services.Y.X)

Cleanup is performed for ALL fixtures created by this test.
"""
from __future__ import annotations
import json, os, sys, uuid, time, subprocess
from datetime import date, datetime, timedelta, timezone
import requests

BASE = "http://localhost:8001/api"
OWNER = "test_session_1776770314741"

PASS = 0
FAIL = 0
FAIL_DETAILS: list[str] = []

def check(label: str, cond: bool, extra: str = ""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ✅ {label}")
    else:
        FAIL += 1
        msg = f"  ❌ {label}" + (f"  ({extra})" if extra else "")
        FAIL_DETAILS.append(msg)
        print(msg)

def H(token: str | None = None, json_body=None) -> dict:
    h = {}
    if token:
        h["Authorization"] = f"Bearer {token}"
    if json_body is not None:
        h["Content-Type"] = "application/json"
    return h

def section(name: str):
    print(f"\n=== {name} ===")

# ─────────────────────────────────────────────────────────────────────
# 0. Pre-flight: seed a PARTNER user + session for the DELETE-as-partner test
# ─────────────────────────────────────────────────────────────────────
section("0. Seed partner fixture (mongosh)")
PARTNER_EMAIL = f"phase7-partner-{int(time.time())}@example.com"
PARTNER_TOKEN = f"phase7_partner_session_{int(time.time())}"
PARTNER_UID = f"phase7-partner-{uuid.uuid4().hex[:8]}"

seed_js = f"""
db = db.getSiblingDB('consulturo');
db.users.insertOne({{
  user_id: '{PARTNER_UID}',
  email: '{PARTNER_EMAIL}',
  name: 'Phase7 Partner',
  role: 'partner',
  created_at: new Date()
}});
db.user_sessions.insertOne({{
  user_id: '{PARTNER_UID}',
  session_token: '{PARTNER_TOKEN}',
  expires_at: new Date(Date.now() + 7*24*60*60*1000),
  created_at: new Date()
}});
print('SEED_OK');
"""
out = subprocess.run(["mongosh", "--quiet", "--eval", seed_js],
                     capture_output=True, text=True, timeout=15)
print(out.stdout.strip())
check("partner seed inserted", "SEED_OK" in out.stdout)

# Verify partner /auth/me works
r = requests.get(f"{BASE}/auth/me", headers=H(PARTNER_TOKEN), timeout=10)
check("/auth/me as partner → 200", r.status_code == 200, f"got {r.status_code}")
if r.status_code == 200:
    check("partner role echoed", r.json().get("role") == "partner",
          f"role={r.json().get('role')}")

# ─────────────────────────────────────────────────────────────────────
# 1. PUBLIC endpoints (services.blog_helpers re-bind smoke + others)
# ─────────────────────────────────────────────────────────────────────
section("1. PUBLIC endpoints")
for path in ("/health", "/blog", "/diseases", "/clinic-settings"):
    r = requests.get(BASE + path, timeout=10)
    check(f"GET {path} → 200", r.status_code == 200, f"got {r.status_code}")

r = requests.get(BASE + "/blog", timeout=10)
if r.status_code == 200:
    body = r.json()
    check("/api/blog returns a list", isinstance(body, list))

# ─────────────────────────────────────────────────────────────────────
# 2. AUTH FLOW: OTP request
# ─────────────────────────────────────────────────────────────────────
section("2. AUTH FLOW")
r = requests.post(BASE + "/auth/otp/request",
                  json={"email": "sagar.joshi133@gmail.com"},
                  timeout=15)
check("/auth/otp/request → 200", r.status_code == 200,
      f"got {r.status_code} body={r.text[:200]}")

# ─────────────────────────────────────────────────────────────────────
# 3. CLINICAL CRUD (uses notifications + booking_helpers)
# ─────────────────────────────────────────────────────────────────────
section("3. CLINICAL CRUD")

# Find a slot
booking_date = (date.today() + timedelta(days=10)).isoformat()
r = requests.get(f"{BASE}/availability/slots?date={booking_date}&mode=in-person", timeout=10)
slots_data = r.json() if r.status_code == 200 else {}
slots = slots_data.get("slots") or []
booked = set(slots_data.get("full_slots") or [])
slot_pick = next((s for s in slots if s not in booked), None)
if slot_pick is None:
    booking_date = (date.today() + timedelta(days=11)).isoformat()
    r = requests.get(f"{BASE}/availability/slots?date={booking_date}&mode=in-person", timeout=10)
    slots_data = r.json() if r.status_code == 200 else {}
    slots = slots_data.get("slots") or []
    slot_pick = slots[0] if slots else "10:00"

print(f"  • Using booking slot: {booking_date} {slot_pick}")

booking_payload = {
    "patient_name": "Smoke 7",
    "patient_phone": "9999900003",
    "country_code": "+91",
    "patient_age": 45,
    "patient_gender": "male",
    "reason": "Phase 7 smoke booking",
    "booking_date": booking_date,
    "booking_time": slot_pick,
    "mode": "in-person",
}
r = requests.post(BASE + "/bookings", json=booking_payload, headers=H(OWNER), timeout=15)
check("POST /bookings (primary_owner) → 200", r.status_code == 200,
      f"got {r.status_code} body={r.text[:200]}")
booking_id = None
booking_reg_no = None
if r.status_code == 200:
    j = r.json()
    booking_id = j.get("booking_id")
    booking_reg_no = j.get("registration_no")
    check("booking has booking_id", bool(booking_id))
    check("booking has registration_no allocated",
          isinstance(booking_reg_no, str) and len(booking_reg_no) >= 6,
          f"reg_no={booking_reg_no}")

# PATCH status=completed (fires push_to_owner via the booking flow)
if booking_id:
    r = requests.patch(BASE + f"/bookings/{booking_id}",
                       json={"status": "completed"},
                       headers=H(OWNER), timeout=15)
    check("PATCH /bookings/{id} status=completed → 200",
          r.status_code == 200, f"got {r.status_code} body={r.text[:200]}")

# POST /api/prescriptions (owner)
rx_payload = {
    "patient_name": "Smoke7 RxPatient",
    "patient_phone": "9999900004",
    "country_code": "+91",
    "patient_age": 50,
    "patient_gender": "male",
    "visit_date": date.today().isoformat(),
    "chief_complaints": "Phase 7 smoke complaints",
    "diagnosis": "BPH",
    "medicines": [
        {"name": "Tamsulosin", "dosage": "0.4mg", "frequency": "HS", "duration": "30 days"}
    ],
}
r = requests.post(BASE + "/prescriptions", json=rx_payload, headers=H(OWNER), timeout=15)
check("POST /prescriptions (primary_owner) → 200", r.status_code == 200,
      f"got {r.status_code} body={r.text[:200]}")
rx_id_owner = None
if r.status_code == 200:
    j = r.json()
    rx_id_owner = j.get("prescription_id")
    check("prescription has registration_no allocated",
          isinstance(j.get("registration_no"), str) and len(j["registration_no"]) >= 6,
          f"reg_no={j.get('registration_no')}")

# DELETE /api/prescriptions/{id} as primary_owner (validates the gating fix)
if rx_id_owner:
    r = requests.delete(BASE + f"/prescriptions/{rx_id_owner}", headers=H(OWNER), timeout=15)
    check("DELETE /prescriptions/{id} as primary_owner → 200 (was 403 pre-fix)",
          r.status_code == 200, f"got {r.status_code} body={r.text[:200]}")
    # Re-DELETE → 404
    r2 = requests.delete(BASE + f"/prescriptions/{rx_id_owner}", headers=H(OWNER), timeout=15)
    check("re-DELETE same id → 404", r2.status_code == 404, f"got {r2.status_code}")

# Create a 2nd Rx and DELETE as partner
r = requests.post(BASE + "/prescriptions",
                  json={**rx_payload, "patient_phone": "9999900005",
                        "patient_name": "Smoke7 PartnerDel"},
                  headers=H(OWNER), timeout=15)
check("POST /prescriptions #2 (for partner-delete) → 200",
      r.status_code == 200, f"got {r.status_code}")
rx_id_partner = r.json().get("prescription_id") if r.status_code == 200 else None
if rx_id_partner:
    rd = requests.delete(BASE + f"/prescriptions/{rx_id_partner}",
                         headers=H(PARTNER_TOKEN), timeout=15)
    check("DELETE /prescriptions/{id} as partner → 200 (OWNER_TIER_ROLES)",
          rd.status_code == 200, f"got {rd.status_code} body={rd.text[:200]}")

# ─────────────────────────────────────────────────────────────────────
# 4. AUTH GATING regression sample
# ─────────────────────────────────────────────────────────────────────
section("4. AUTH GATING regression")
r = requests.get(BASE + "/bookings/all", timeout=10)
check("GET /bookings/all without token → 401", r.status_code == 401,
      f"got {r.status_code}")

# ─────────────────────────────────────────────────────────────────────
# 5. ROLE-CHANGE flow (uses notify_role_change → pretty_role → create_notification → push_to_user)
# ─────────────────────────────────────────────────────────────────────
section("5. ROLE-CHANGE flow")
TEAM_EMAIL = "phase7-test@example.com"
# Pre-seed the user row so notify_role_change actually fires (the helper only
# fires when an existing_user row is found and prev_role differs).
team_uid = f"phase7-team-{uuid.uuid4().hex[:8]}"
seed_team = f"""
db = db.getSiblingDB('consulturo');
db.users.deleteMany({{email: '{TEAM_EMAIL}'}});
db.team_invites.deleteMany({{email: '{TEAM_EMAIL}'}});
db.users.insertOne({{
  user_id: '{team_uid}',
  email: '{TEAM_EMAIL}',
  name: 'Phase7 Test Team',
  role: 'doctor',
  created_at: new Date()
}});
print('TEAM_SEED_OK');
"""
subprocess.run(["mongosh", "--quiet", "--eval", seed_team],
               capture_output=True, text=True, timeout=10)

r = requests.post(BASE + "/team/invites",
                  json={"email": TEAM_EMAIL, "name": "Phase7 Test Team", "role": "doctor"},
                  headers=H(OWNER), timeout=15)
check("POST /team/invites doctor → 200", r.status_code == 200,
      f"got {r.status_code} body={r.text[:200]}")

r = requests.patch(BASE + f"/team/{TEAM_EMAIL}",
                   json={"role": "nursing"},
                   headers=H(OWNER), timeout=15)
check("PATCH /team/{email} role=nursing → 200",
      r.status_code == 200, f"got {r.status_code} body={r.text[:200]}")

r = requests.delete(BASE + f"/team/{TEAM_EMAIL}",
                    headers=H(OWNER), timeout=15)
check("DELETE /team/{email} → 200", r.status_code == 200,
      f"got {r.status_code} body={r.text[:200]}")

# Check that a notification was actually created for the team user (validates
# notify_role_change → create_notification chain end-to-end).
res = subprocess.run(["mongosh", "--quiet", "--eval",
    f"db = db.getSiblingDB('consulturo'); print(db.notifications.countDocuments({{user_id:'{team_uid}', kind:'role_change'}}));"],
    capture_output=True, text=True, timeout=10)
try:
    notif_count = int(res.stdout.strip().splitlines()[-1])
except Exception:
    notif_count = 0
check("role_change notification(s) created for the team user (≥1)",
      notif_count >= 1, f"count={notif_count}")

# ─────────────────────────────────────────────────────────────────────
# 6. UNTOUCHED sanity (primary_owner)
# ─────────────────────────────────────────────────────────────────────
section("6. UNTOUCHED endpoints")
for path in ("/team", "/admin/partners", "/notifications", "/broadcasts"):
    r = requests.get(BASE + path, headers=H(OWNER), timeout=10)
    check(f"GET {path} (primary_owner) → 200",
          r.status_code == 200, f"got {r.status_code} body={r.text[:160]}")

# ─────────────────────────────────────────────────────────────────────
# 7. SERVICES IMPORT REGRESSION (in-process check — has to run from the
#    backend Python so that `import server` is the live process module)
# ─────────────────────────────────────────────────────────────────────
section("7. SERVICES IMPORT REGRESSION")
probe = """
import sys
sys.path.insert(0, '/app/backend')
import server
import services.notifications as svc_n
import services.blog_helpers as svc_b
import services.booking_helpers as svc_bh
print('push_to_user_same:', server.push_to_user is svc_n.push_to_user)
print('admin_to_html_same:', server._admin_to_html is svc_b._admin_to_html)
print('time_12h_same:', server._time_12h is svc_bh._time_12h)
"""
r2 = subprocess.run(["python", "-c", probe], capture_output=True, text=True,
                    cwd="/app/backend", timeout=20)
print(r2.stdout)
if r2.returncode != 0:
    print("STDERR:", r2.stderr[:500])

def line_has(label):
    for ln in r2.stdout.splitlines():
        if ln.startswith(label):
            return ln.strip().endswith("True")
    return False

check("server.push_to_user is services.notifications.push_to_user",
      line_has("push_to_user_same:"))
check("server._admin_to_html is services.blog_helpers._admin_to_html",
      line_has("admin_to_html_same:"))
check("server._time_12h is services.booking_helpers._time_12h",
      line_has("time_12h_same:"))

# ─────────────────────────────────────────────────────────────────────
# CLEANUP
# ─────────────────────────────────────────────────────────────────────
section("CLEANUP")
cleanup_js = f"""
db = db.getSiblingDB('consulturo');
var u = db.users.deleteMany({{ user_id: {{ $in: ['{PARTNER_UID}', '{team_uid}'] }} }});
var s = db.user_sessions.deleteMany({{ session_token: '{PARTNER_TOKEN}' }});
var i = db.team_invites.deleteMany({{ email: {{ $in: ['{TEAM_EMAIL}', '{PARTNER_EMAIL}'] }} }});
var au = db.users.deleteMany({{ email: {{ $in: ['{TEAM_EMAIL}', '{PARTNER_EMAIL}'] }} }});
var n = db.notifications.deleteMany({{ user_id: '{team_uid}' }});
var b = db.bookings.deleteMany({{ booking_id: '{booking_id}' }});
print('CLEANUP users=' + (u.deletedCount+au.deletedCount) +
      ' sessions=' + s.deletedCount +
      ' invites=' + i.deletedCount +
      ' notifs=' + n.deletedCount +
      ' bookings=' + b.deletedCount);
"""
out = subprocess.run(["mongosh", "--quiet", "--eval", cleanup_js],
                     capture_output=True, text=True, timeout=15)
print(out.stdout.strip())

# ─────────────────────────────────────────────────────────────────────
print(f"\n══════════════════════════════════════════════════════════")
print(f"  RESULT: {PASS} PASS / {FAIL} FAIL")
print(f"══════════════════════════════════════════════════════════")
if FAIL:
    print("\nFAILED:")
    for d in FAIL_DETAILS:
        print(d)
sys.exit(0 if FAIL == 0 else 1)
