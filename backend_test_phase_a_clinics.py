"""
PHASE A MULTI-TENANT BACKEND TESTS
Tests the new clinic endpoints in /app/backend/routers/clinics.py
"""
import os
import sys
import json
import requests
from typing import Any, Dict

BASE = os.environ.get("BACKEND_URL", "http://localhost:8001") + "/api"
OWNER_TOKEN = "test_session_1776770314741"
PRIMARY_OWNER_USER_ID = "user_4775ed40276e"  # sagar.joshi133@gmail.com
DEFAULT_CLINIC_ID = "clinic_a97b903f2fb2"
DEFAULT_SLUG = "dr-joshi-uro"

OWNER_HDR = {"Authorization": f"Bearer {OWNER_TOKEN}"}

passed = 0
failed = 0
fail_msgs = []


def check(cond, label):
    global passed, failed
    if cond:
        passed += 1
        print(f"  PASS - {label}")
    else:
        failed += 1
        fail_msgs.append(label)
        print(f"  FAIL - {label}")


def section(title):
    print(f"\n=== {title} ===")


def jdump(r):
    try:
        return r.json()
    except Exception:
        return r.text


# ── TEST 1: GET /api/clinics ─────────────────────────────────────────
section("TEST 1 — GET /api/clinics (auth)")
r = requests.get(f"{BASE}/clinics", headers=OWNER_HDR)
print(f"  status={r.status_code}")
check(r.status_code == 200, "1.status==200")
data = r.json() if r.ok else {}
print(f"  body={json.dumps(data)[:500]}")
check(isinstance(data.get("clinics"), list), "1.clinics is list")
check(len(data.get("clinics", [])) >= 1, "1.>=1 clinic")
clinics = data.get("clinics", [])
default_clinic = next((c for c in clinics if c.get("clinic_id") == DEFAULT_CLINIC_ID), None)
check(default_clinic is not None, "1.default clinic present")
if default_clinic:
    check(default_clinic.get("role") == "primary_owner", "1.role=='primary_owner'")
    check(default_clinic.get("slug") == DEFAULT_SLUG, "1.slug=='dr-joshi-uro'")
check(data.get("default_clinic_id") == DEFAULT_CLINIC_ID, "1.default_clinic_id matches")


# ── TEST 2: GET /api/clinics/by-slug/<slug> NO AUTH ──────────────────
section("TEST 2 — GET /api/clinics/by-slug/dr-joshi-uro (NO AUTH)")
r = requests.get(f"{BASE}/clinics/by-slug/{DEFAULT_SLUG}")
print(f"  status={r.status_code}")
check(r.status_code == 200, "2.status==200 unauth")
body = r.json() if r.ok else {}
print(f"  body keys={list(body.keys())}")
check(body.get("clinic_id") == DEFAULT_CLINIC_ID, "2.clinic_id correct")
check(body.get("slug") == DEFAULT_SLUG, "2.slug correct")
check("primary_owner_id" not in body, "2.primary_owner_id HIDDEN")
check("created_at" not in body, "2.created_at HIDDEN")
check("updated_at" not in body, "2.updated_at HIDDEN")
check("deleted_at" not in body, "2.deleted_at HIDDEN")
check("branding" in body, "2.branding present")
check("name" in body, "2.name present")


# ── TEST 3: GET /api/clinics/by-slug/nonexistent ─────────────────────
section("TEST 3 — GET by-slug nonexistent → 404")
r = requests.get(f"{BASE}/clinics/by-slug/this-does-not-exist-xyz")
print(f"  status={r.status_code}")
check(r.status_code == 404, "3.status==404")


# ── TEST 4: GET /api/clinics/{id} as member ──────────────────────────
section(f"TEST 4 — GET /api/clinics/{DEFAULT_CLINIC_ID} (auth)")
r = requests.get(f"{BASE}/clinics/{DEFAULT_CLINIC_ID}", headers=OWNER_HDR)
print(f"  status={r.status_code}")
check(r.status_code == 200, "4.status==200")
body = r.json() if r.ok else {}
check(body.get("clinic_id") == DEFAULT_CLINIC_ID, "4.clinic_id correct")
check("primary_owner_id" in body, "4.primary_owner_id PRESENT (auth view)")
check("created_at" in body, "4.created_at PRESENT (auth view)")


# ── TEST 5: GET /api/clinics/clinic_does_not_exist ───────────────────
section("TEST 5 — GET nonexistent clinic_id → 404")
r = requests.get(f"{BASE}/clinics/clinic_does_not_exist", headers=OWNER_HDR)
print(f"  status={r.status_code}")
check(r.status_code == 404, "5.status==404")


# ── TEST 6: POST /api/clinics ────────────────────────────────────────
section("TEST 6 — POST /api/clinics (Vadodara Test Clinic)")
r = requests.post(
    f"{BASE}/clinics",
    headers=OWNER_HDR,
    json={"name": "Vadodara Test Clinic", "tagline": "X"},
)
print(f"  status={r.status_code}")
check(r.status_code == 201, "6.status==201")
clinic1 = r.json() if r.ok else {}
print(f"  clinic_id={clinic1.get('clinic_id')} slug={clinic1.get('slug')}")
new_clinic_id_1 = clinic1.get("clinic_id")
check(clinic1.get("slug") == "vadodara-test-clinic", "6.slug=='vadodara-test-clinic'")
check(clinic1.get("name") == "Vadodara Test Clinic", "6.name correct")
check(clinic1.get("tagline") == "X", "6.tagline=='X'")
check(clinic1.get("primary_owner_id") == PRIMARY_OWNER_USER_ID, "6.primary_owner_id is creator")
check(bool(new_clinic_id_1) and new_clinic_id_1.startswith("clinic_"), "6.clinic_id has prefix")


# ── TEST 7: POST same again → -2 suffix ──────────────────────────────
section("TEST 7 — POST /api/clinics same name again")
r = requests.post(
    f"{BASE}/clinics",
    headers=OWNER_HDR,
    json={"name": "Vadodara Test Clinic", "tagline": "Y"},
)
print(f"  status={r.status_code}")
check(r.status_code == 201, "7.status==201")
clinic2 = r.json() if r.ok else {}
new_clinic_id_2 = clinic2.get("clinic_id")
print(f"  clinic_id={new_clinic_id_2} slug={clinic2.get('slug')}")
check(clinic2.get("slug") == "vadodara-test-clinic-2", "7.slug=='vadodara-test-clinic-2'")
check(new_clinic_id_2 != new_clinic_id_1, "7.different clinic_id from #6")


# ── TEST 8: GET /api/clinics/{new_id}/members ─────────────────────────
section(f"TEST 8 — GET /api/clinics/{new_clinic_id_1}/members")
r = requests.get(f"{BASE}/clinics/{new_clinic_id_1}/members", headers=OWNER_HDR)
print(f"  status={r.status_code}")
check(r.status_code == 200, "8.status==200")
body = r.json() if r.ok else {}
members = body.get("members", [])
print(f"  members count={len(members)}")
check(len(members) == 1, "8.exactly 1 member")
if members:
    m = members[0]
    check(m.get("user_id") == PRIMARY_OWNER_USER_ID, "8.creator is the member")
    check(m.get("clinic_role") == "primary_owner", "8.role=='primary_owner'")


# ── TEST 9: PATCH /api/clinics/{new_id} ──────────────────────────────
section(f"TEST 9 — PATCH /api/clinics/{new_clinic_id_1}")
r = requests.patch(
    f"{BASE}/clinics/{new_clinic_id_1}",
    headers=OWNER_HDR,
    json={"tagline": "Updated"},
)
print(f"  status={r.status_code}")
check(r.status_code == 200, "9.status==200")
body = r.json() if r.ok else {}
check(body.get("tagline") == "Updated", "9.tagline updated")
# Verify via GET
r2 = requests.get(f"{BASE}/clinics/{new_clinic_id_1}", headers=OWNER_HDR)
check(r2.json().get("tagline") == "Updated", "9.persisted in GET")


# ── TEST 10: SKIPPED (no second user token) ──────────────────────────
section("TEST 10 — SKIPPED (no separate non-owner user token available)")


# ── TEST 11: POST /api/clinics/{new_id}/members ──────────────────────
section(f"TEST 11 — POST member by email")
# Look up the existing test_doctor_1776494002376 user — first we need to know its email
# The user spec mentions test-doctor-1776494002376 will be deleted in test 12.
# Try to use an existing real user. Let's check what users exist first.
import subprocess
res = subprocess.run(
    ["mongosh", "consulturo", "--quiet", "--eval",
     "db.users.findOne({user_id:'test-doctor-1776494002376'},{_id:0,user_id:1,email:1,role:1})"],
    capture_output=True, text=True
)
print(f"  test-doctor user lookup: {res.stdout.strip()}")

# The review request says: POST body {email:"doctor.test@consulturo.app", role:"doctor"} → 200
# but we need a USER with that email to exist. Check:
res = subprocess.run(
    ["mongosh", "consulturo", "--quiet", "--eval",
     "db.users.findOne({email:'doctor.test@consulturo.app'},{_id:0,user_id:1,email:1,role:1})"],
    capture_output=True, text=True
)
print(f"  doctor.test user lookup: {res.stdout.strip()}")
doctor_user_exists = "user_id" in res.stdout

if not doctor_user_exists:
    # Seed the user via mongosh
    print("  seeding doctor.test@consulturo.app user")
    seed_cmd = (
        "db.users.insertOne({user_id:'test-doctor-1776494002376',"
        "email:'doctor.test@consulturo.app',"
        "name:'Test Doctor',role:'doctor',created_at:new Date()})"
    )
    subprocess.run(["mongosh", "consulturo", "--quiet", "--eval", seed_cmd],
                   capture_output=True, text=True)

r = requests.post(
    f"{BASE}/clinics/{new_clinic_id_1}/members",
    headers=OWNER_HDR,
    json={"email": "doctor.test@consulturo.app", "role": "doctor"},
)
print(f"  status={r.status_code} body={jdump(r)}")
check(r.status_code == 200, "11.status==200")
body = r.json() if r.ok else {}
check(body.get("ok") is True, "11.ok==true")
membership = body.get("membership") or {}
added_user_id = membership.get("user_id")
check(membership.get("role") == "doctor", "11.role=='doctor'")
check(membership.get("clinic_id") == new_clinic_id_1, "11.clinic_id correct")
check(membership.get("is_active") is True, "11.is_active=true")


# ── TEST 12: DELETE member ───────────────────────────────────────────
section(f"TEST 12 — DELETE /api/clinics/{new_clinic_id_1}/members/test-doctor-1776494002376")
r = requests.delete(
    f"{BASE}/clinics/{new_clinic_id_1}/members/test-doctor-1776494002376",
    headers=OWNER_HDR,
)
print(f"  status={r.status_code} body={jdump(r)}")
check(r.status_code == 200, "12.status==200")
check(r.json().get("ok") is True if r.ok else False, "12.ok==true")
# Verify membership now inactive
res = subprocess.run(
    ["mongosh", "consulturo", "--quiet", "--eval",
     f"db.clinic_memberships.findOne({{user_id:'test-doctor-1776494002376',clinic_id:'{new_clinic_id_1}'}},{{_id:0,is_active:1}})"],
    capture_output=True, text=True,
)
print(f"  post-delete membership: {res.stdout.strip()}")
check("is_active: false" in res.stdout, "12.membership now inactive")


# ── TEST 13: DELETE primary_owner → 400 ──────────────────────────────
section(f"TEST 13 — DELETE primary_owner from members (should 400)")
r = requests.delete(
    f"{BASE}/clinics/{new_clinic_id_1}/members/{PRIMARY_OWNER_USER_ID}",
    headers=OWNER_HDR,
)
print(f"  status={r.status_code} body={jdump(r)}")
check(r.status_code == 400, "13.status==400")


# ── TEST 14: Idempotent migration ────────────────────────────────────
section("TEST 14 — Idempotent migration re-run")
# Capture pre-state
pre_clinics = subprocess.run(
    ["mongosh", "consulturo", "--quiet", "--eval", "db.clinics.countDocuments({})"],
    capture_output=True, text=True
).stdout.strip()
pre_memberships = subprocess.run(
    ["mongosh", "consulturo", "--quiet", "--eval", "db.clinic_memberships.countDocuments({is_active:true})"],
    capture_output=True, text=True
).stdout.strip()
print(f"  pre: clinics={pre_clinics}, active memberships={pre_memberships}")

mig = subprocess.run(
    ["python", "-m", "migrations.001_multi_tenant"],
    capture_output=True, text=True, cwd="/app/backend",
)
print(f"  migration exit={mig.returncode}")
print(f"  stdout last 500: {mig.stdout[-500:]}")
if mig.stderr:
    print(f"  stderr: {mig.stderr[-500:]}")
check(mig.returncode == 0, "14.migration exit 0")

post_clinics = subprocess.run(
    ["mongosh", "consulturo", "--quiet", "--eval", "db.clinics.countDocuments({})"],
    capture_output=True, text=True
).stdout.strip()
post_memberships = subprocess.run(
    ["mongosh", "consulturo", "--quiet", "--eval", "db.clinic_memberships.countDocuments({is_active:true})"],
    capture_output=True, text=True
).stdout.strip()
print(f"  post: clinics={post_clinics}, active memberships={post_memberships}")
check(post_clinics == pre_clinics, "14.no duplicate clinics")
check(post_memberships == pre_memberships, "14.no duplicate memberships")


# ── TEST 15: Regression smoke ────────────────────────────────────────
section("TEST 15 — Regression smoke")
endpoints = [
    "/auth/me",
    "/prescriptions",
    "/bookings/all",
    "/surgeries",
    "/clinic-settings",
    "/notifications?limit=10",
]
for ep in endpoints:
    r = requests.get(f"{BASE}{ep}", headers=OWNER_HDR)
    print(f"  GET {ep} → {r.status_code}")
    check(r.status_code == 200, f"15.{ep} → 200")


# ── TEST 16: Cleanup ─────────────────────────────────────────────────
section("TEST 16 — Cleanup test clinics")
cleanup_cmd = (
    "var clinicsToRemove = db.clinics.find({slug: /^vadodara-test-clinic/}).toArray().map(c=>c.clinic_id); "
    "print('clinics to remove: ' + JSON.stringify(clinicsToRemove)); "
    "var c = db.clinics.deleteMany({slug: /^vadodara-test-clinic/}); "
    "print('clinics_deleted: ' + c.deletedCount); "
    "var m = db.clinic_memberships.deleteMany({clinic_id: {$in: clinicsToRemove}}); "
    "print('memberships_deleted: ' + m.deletedCount); "
    "var u = db.users.deleteMany({user_id:'test-doctor-1776494002376'}); "
    "print('users_deleted: ' + u.deletedCount);"
)
res = subprocess.run(
    ["mongosh", "consulturo", "--quiet", "--eval", cleanup_cmd],
    capture_output=True, text=True,
)
print(f"  cleanup output: {res.stdout.strip()}")

final_clinics = subprocess.run(
    ["mongosh", "consulturo", "--quiet", "--eval", "db.clinics.countDocuments({})"],
    capture_output=True, text=True,
).stdout.strip()
final_memberships = subprocess.run(
    ["mongosh", "consulturo", "--quiet", "--eval", "db.clinic_memberships.countDocuments({is_active:true})"],
    capture_output=True, text=True,
).stdout.strip()
print(f"  final: clinics={final_clinics} memberships(active)={final_memberships}")
check(final_clinics == "1", "16.exactly 1 clinic remaining")
check(final_memberships == "4", "16.4 active memberships remaining")


# ── SUMMARY ──────────────────────────────────────────────────────────
print(f"\n{'='*60}")
print(f"PASSED: {passed}  FAILED: {failed}")
if fail_msgs:
    print("FAILURES:")
    for m in fail_msgs:
        print(f"  ✗ {m}")
sys.exit(0 if failed == 0 else 1)
