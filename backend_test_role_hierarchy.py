"""
Plan B — 4-tier role hierarchy backend tests.
Tests TEST 1..7 from the review request against http://localhost:8001.
"""
import os
import sys
import time
import subprocess
import json
import requests

BASE = "http://localhost:8001"
OWNER_TOKEN = "test_session_1776770314741"   # sagar.joshi133@gmail.com
DOCTOR_TOKEN = "test_doc_1776771431524"      # dr.test@example.com

H_OWNER = {"Authorization": f"Bearer {OWNER_TOKEN}"}
H_DOC = {"Authorization": f"Bearer {DOCTOR_TOKEN}"}

results = []

def check(name, cond, detail=""):
    results.append((name, cond, detail))
    print(("  PASS " if cond else "  FAIL ") + name + ((" — " + detail) if detail else ""))

def mongo(query):
    out = subprocess.run(
        ["mongosh", "--quiet", "--eval", query],
        capture_output=True, text=True
    )
    return out.stdout.strip()

print("="*70)
print("TEST 1 — Migration verification")
print("="*70)
r = requests.get(f"{BASE}/api/health")
check("GET /api/health 200", r.status_code == 200 and r.json().get("db") == "connected", f"{r.status_code} {r.text}")

legacy = mongo("db = db.getSiblingDB('consulturo'); print(db.users.countDocuments({role:'owner'}))")
check("No users with role='owner' remain", legacy == "0", f"legacy owner count = {legacy}")

sagar = mongo("db = db.getSiblingDB('consulturo'); printjson(db.users.findOne({email:'sagar.joshi133@gmail.com'}, {role:1, _id:0}))")
check("sagar.joshi133 has role='primary_owner'", "'primary_owner'" in sagar or '"primary_owner"' in sagar, sagar)

super_ct = mongo("db = db.getSiblingDB('consulturo'); print(db.users.countDocuments({email:'app.consulturo@gmail.com'}))")
if super_ct == "0":
    check("super_owner email not yet logged in (ok, skipped role check)", True, "user not present — skip")
else:
    sup = mongo("db = db.getSiblingDB('consulturo'); printjson(db.users.findOne({email:'app.consulturo@gmail.com'}, {role:1, _id:0}))")
    check("app.consulturo has role='super_owner'", "super_owner" in sup, sup)

print()
print("="*70)
print("TEST 2 — GET /api/me/tier as primary_owner")
print("="*70)
r = requests.get(f"{BASE}/api/me/tier", headers=H_OWNER)
check("GET /api/me/tier 200 (primary_owner)", r.status_code == 200, f"{r.status_code} {r.text}")
if r.status_code == 200:
    j = r.json()
    check("role == primary_owner", j.get("role") == "primary_owner", str(j.get("role")))
    check("is_super_owner false", j.get("is_super_owner") is False, str(j.get("is_super_owner")))
    check("is_primary_owner true", j.get("is_primary_owner") is True, str(j.get("is_primary_owner")))
    check("is_partner false", j.get("is_partner") is False, str(j.get("is_partner")))
    check("is_owner_tier true", j.get("is_owner_tier") is True, str(j.get("is_owner_tier")))
    check("can_manage_partners true", j.get("can_manage_partners") is True, str(j.get("can_manage_partners")))
    check("can_manage_primary_owners false", j.get("can_manage_primary_owners") is False, str(j.get("can_manage_primary_owners")))

print()
print("="*70)
print("TEST 3 — Partner management endpoints (primary_owner authority)")
print("="*70)

ts = int(time.time())
partner_email = f"test-partner-{ts}@example.com"

# 3.a GET partners list
r = requests.get(f"{BASE}/api/admin/partners", headers=H_OWNER)
check("GET /api/admin/partners 200 (owner)", r.status_code == 200, f"{r.status_code} {r.text}")
initial_items = r.json().get("items", []) if r.status_code == 200 else []
print(f"    initial partners count = {len(initial_items)}")

# Seed a user in db.users for this email so we can test full lifecycle (demote requires user_id lookup)
partner_user_id = f"test-partner-user-{ts}"
seed_cmd = (
    f"db = db.getSiblingDB('consulturo'); "
    f"db.users.insertOne({{user_id:'{partner_user_id}', email:'{partner_email}', "
    f"name:'Test Partner {ts}', role:'doctor', created_at:new Date()}}); "
    f"print('seeded');"
)
seed_out = mongo(seed_cmd)
print(f"    seed user = {seed_out}")

# 3.b POST promote
r = requests.post(
    f"{BASE}/api/admin/partners/promote",
    headers=H_OWNER,
    json={"email": partner_email},
)
check("POST /api/admin/partners/promote 200", r.status_code == 200, f"{r.status_code} {r.text}")
if r.status_code == 200:
    j = r.json()
    check("promote returns ok:true", j.get("ok") is True, str(j))
    check("promote returns role:partner", j.get("role") == "partner", str(j.get("role")))

# 3.c GET partners again
r = requests.get(f"{BASE}/api/admin/partners", headers=H_OWNER)
after_items = r.json().get("items", []) if r.status_code == 200 else []
emails = [p.get("email") for p in after_items]
check("GET /api/admin/partners shows new partner", partner_email in emails, f"emails={emails}")

# 3.d Idempotent upsert — call again
r = requests.post(
    f"{BASE}/api/admin/partners/promote",
    headers=H_OWNER,
    json={"email": partner_email},
)
check("POST /api/admin/partners/promote (2nd call, UPSERT) 200", r.status_code == 200, f"{r.status_code} {r.text}")

# 3.e DELETE by user_id
r = requests.delete(f"{BASE}/api/admin/partners/{partner_user_id}", headers=H_OWNER)
check("DELETE /api/admin/partners/{user_id} 200", r.status_code == 200, f"{r.status_code} {r.text}")
if r.status_code == 200:
    j = r.json()
    check("DELETE returns role:doctor", j.get("role") == "doctor", str(j.get("role")))

# 3.f GET partners → removed
r = requests.get(f"{BASE}/api/admin/partners", headers=H_OWNER)
final_items = r.json().get("items", []) if r.status_code == 200 else []
final_emails = [p.get("email") for p in final_items]
check("Partner removed from list", partner_email not in final_emails, f"emails={final_emails}")

# 3.2 As doctor (non-owner-tier) — should 403
r = requests.post(
    f"{BASE}/api/admin/partners/promote",
    headers=H_DOC,
    json={"email": f"another-{ts}@example.com"},
)
check("POST partners/promote as DOCTOR → 403", r.status_code == 403, f"{r.status_code} {r.text[:200]}")
if r.status_code == 403:
    check("403 detail mentions 'Primary owner access required'",
          "Primary owner access required" in r.text, r.text[:200])

print()
print("="*70)
print("TEST 4 — Primary-owner management endpoints (super_owner authority)")
print("="*70)

# 4.a As primary_owner — promote → 403
r = requests.post(
    f"{BASE}/api/admin/primary-owners/promote",
    headers=H_OWNER,
    json={"email": "test@example.com"},
)
check("POST /api/admin/primary-owners/promote as primary_owner → 403",
      r.status_code == 403, f"{r.status_code} {r.text[:200]}")
if r.status_code == 403:
    check("403 detail mentions 'Super owner access required'",
          "Super owner access required" in r.text, r.text[:200])

# 4.b As primary_owner — GET list → 200
r = requests.get(f"{BASE}/api/admin/primary-owners", headers=H_OWNER)
check("GET /api/admin/primary-owners as primary_owner → 200",
      r.status_code == 200, f"{r.status_code} {r.text[:200]}")
if r.status_code == 200:
    items = r.json().get("items", [])
    print(f"    primary_owners list count = {len(items)}")

# 4.c As primary_owner — DELETE → 403
r = requests.delete(f"{BASE}/api/admin/primary-owners/anything", headers=H_OWNER)
check("DELETE /api/admin/primary-owners/{id} as primary_owner → 403",
      r.status_code == 403, f"{r.status_code} {r.text[:200]}")

print()
print("="*70)
print("TEST 5 — Backward compatibility")
print("="*70)

# require_owner now accepts primary_owner
r = requests.get(f"{BASE}/api/admin/messaging-permissions", headers=H_OWNER)
check("GET /api/admin/messaging-permissions as primary_owner → 200",
      r.status_code == 200, f"{r.status_code} {r.text[:200]}")

# Also verify legacy 'owner' users still pass (migration may have removed them — check count)
owner_ct = mongo("db = db.getSiblingDB('consulturo'); print(db.users.countDocuments({role:'owner'}))")
if owner_ct == "0":
    check("No legacy 'owner' users remain (migration complete, compat path not exercisable)",
          True, "0 legacy owner rows — auto-migrated")
else:
    check("Legacy owner compat path relevant",
          False, f"{owner_ct} legacy owner rows still present — migration incomplete")

print()
print("="*70)
print("TEST 6 — Audit log")
print("="*70)

q = (
    "db = db.getSiblingDB('consulturo'); "
    f"var row = db.audit_log.findOne({{kind:'role_change', new_role:'partner', "
    f"target_email:'{partner_email}', actor_email:'sagar.joshi133@gmail.com'}}); "
    "printjson(row);"
)
audit = mongo(q)
check("audit_log has role_change entry for promoted partner",
      "role_change" in audit and "sagar.joshi133@gmail.com" in audit,
      audit[:300])

print()
print("="*70)
print("TEST 7 — Smoke tests (primary_owner)")
print("="*70)

for path in ["/api/health", "/api/notifications", "/api/inbox/all", "/api/admin/messaging-permissions"]:
    r = requests.get(f"{BASE}{path}", headers=H_OWNER)
    check(f"GET {path} → 200", r.status_code == 200, f"{r.status_code}")

# ---- Cleanup: delete seed user, audit_log rows, team_invites entry for test partner
print()
print("Cleanup...")
cleanup = (
    "db = db.getSiblingDB('consulturo'); "
    f"var u = db.users.deleteMany({{email:'{partner_email}'}}); "
    f"var t = db.team_invites.deleteMany({{email:'{partner_email}'}}); "
    f"var a = db.audit_log.deleteMany({{target_email:'{partner_email}'}}); "
    "print('users_deleted=' + u.deletedCount + ' team_invites_deleted=' + t.deletedCount + "
    "' audit_deleted=' + a.deletedCount);"
)
print("   ", mongo(cleanup))

print()
print("="*70)
passed = sum(1 for _, c, _ in results if c)
total = len(results)
print(f"RESULT: {passed}/{total} assertions passed")
if passed < total:
    print("\nFailures:")
    for name, c, detail in results:
        if not c:
            print(f"  - {name}: {detail}")
    sys.exit(1)
sys.exit(0)
