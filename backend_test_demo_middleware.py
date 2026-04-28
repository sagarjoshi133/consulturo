"""
Demo Read-Only middleware tests.
Tests that users with is_demo:true are blocked from write operations
except for whitelisted paths. Tests against http://localhost:8001.
"""
import subprocess
import sys
import json
import requests

BASE = "http://localhost:8001"
OWNER_TOKEN = "test_session_1776770314741"   # sagar.joshi133@gmail.com (primary_owner)
DEMO_USER_ID = "test-demo-1"
DEMO_SESSION_TOKEN = "test_demo_session_001"

H_OWNER = {"Authorization": f"Bearer {OWNER_TOKEN}"}
H_DEMO = {"Authorization": f"Bearer {DEMO_SESSION_TOKEN}"}

results = []


def check(name, cond, detail=""):
    results.append((name, cond, detail))
    status = "  PASS " if cond else "  FAIL "
    msg = status + name + ((" — " + detail) if detail else "")
    print(msg)


def mongo(query):
    out = subprocess.run(
        ["mongosh", "--quiet", "--eval", query],
        capture_output=True, text=True
    )
    return (out.stdout or "").strip()


def seed_demo_user():
    """Insert demo user + session fixture."""
    q = """
    db = db.getSiblingDB('consulturo');
    db.users.deleteOne({user_id:'test-demo-1'});
    db.user_sessions.deleteOne({session_token:'test_demo_session_001'});
    db.users.insertOne({
        user_id: 'test-demo-1',
        email: 'demo@example.com',
        name: 'Demo User',
        role: 'primary_owner',
        is_demo: true,
        created_at: new Date()
    });
    db.user_sessions.insertOne({
        user_id: 'test-demo-1',
        session_token: 'test_demo_session_001',
        expires_at: new Date(Date.now() + 7*24*60*60*1000),
        created_at: new Date()
    });
    print('SEEDED');
    """
    out = mongo(q)
    return "SEEDED" in out


def cleanup_demo_user():
    q = """
    db = db.getSiblingDB('consulturo');
    var u = db.users.deleteOne({user_id:'test-demo-1'}).deletedCount;
    var s = db.user_sessions.deleteOne({session_token:'test_demo_session_001'}).deletedCount;
    print('users_deleted=' + u + ' sessions_deleted=' + s);
    """
    return mongo(q)


def is_demo_block(resp):
    """Return True if response is 403 with demo:true body."""
    if resp.status_code != 403:
        return False
    try:
        j = resp.json()
    except Exception:
        return False
    if j.get("demo") is not True:
        return False
    detail = j.get("detail") or ""
    return "Demo mode" in detail


def mentions_demo_mode(resp):
    """Return True if response body JSON mentions 'Demo mode' + demo:true."""
    try:
        j = resp.json()
    except Exception:
        return False
    if j.get("demo") is True and "Demo mode" in (j.get("detail") or ""):
        return True
    return False


# ── Seed ─────────────────────────────────────────────────────────────
print("=" * 70)
print("SEED — Demo user fixture")
print("=" * 70)
seeded = seed_demo_user()
check("Seeded demo user + session via mongosh", seeded, "")

# Sanity: auth works for demo user via GET
r = requests.get(f"{BASE}/api/auth/me", headers=H_DEMO, timeout=10)
check("GET /api/auth/me for demo 200", r.status_code == 200, f"{r.status_code} {r.text[:200]}")
if r.status_code == 200:
    j = r.json()
    check("auth/me is_demo:true",
          j.get("is_demo") is True,
          f"is_demo={j.get('is_demo')}")

print()
print("=" * 70)
print("TEST 2 — BLOCKED write paths for demo user (403 + demo:true)")
print("=" * 70)

# POST /api/bookings
r = requests.post(
    f"{BASE}/api/bookings",
    headers=H_DEMO,
    json={"patient_name": "Demo Test", "phone": "+919999999999",
          "slot_iso": "2026-12-31T10:00:00Z", "mode": "offline"},
    timeout=10,
)
check("POST /api/bookings blocked (403 + demo:true)",
      is_demo_block(r), f"{r.status_code} {r.text[:200]}")

# POST /api/notes
r = requests.post(
    f"{BASE}/api/notes",
    headers=H_DEMO,
    json={"title": "demo note", "body": "hello"},
    timeout=10,
)
check("POST /api/notes blocked (403 + demo:true)",
      is_demo_block(r), f"{r.status_code} {r.text[:200]}")

# POST /api/referrers
r = requests.post(
    f"{BASE}/api/referrers",
    headers=H_DEMO,
    json={"name": "Demo Referrer"},
    timeout=10,
)
check("POST /api/referrers blocked (403 + demo:true)",
      is_demo_block(r), f"{r.status_code} {r.text[:200]}")

# POST /api/prescriptions
r = requests.post(
    f"{BASE}/api/prescriptions",
    headers=H_DEMO,
    json={"patient_name": "Demo", "chief_complaints": "x", "medicines": []},
    timeout=10,
)
check("POST /api/prescriptions blocked (403 + demo:true)",
      is_demo_block(r), f"{r.status_code} {r.text[:200]}")

# PATCH /api/clinic-settings
r = requests.patch(
    f"{BASE}/api/clinic-settings",
    headers=H_DEMO,
    json={"clinic_name": "Demo Clinic"},
    timeout=10,
)
check("PATCH /api/clinic-settings blocked (403 + demo:true)",
      is_demo_block(r), f"{r.status_code} {r.text[:200]}")

# DELETE /api/notes/nonexistent-id
r = requests.delete(
    f"{BASE}/api/notes/nonexistent-id",
    headers=H_DEMO,
    timeout=10,
)
check("DELETE /api/notes/nonexistent-id blocked (403 + demo:true)",
      is_demo_block(r), f"{r.status_code} {r.text[:200]}")

print()
print("=" * 70)
print("TEST 3 — ALLOWED paths for demo user (must NOT be demo-blocked)")
print("=" * 70)

# POST /api/auth/logout — whitelisted prefix
r = requests.post(f"{BASE}/api/auth/logout", headers=H_DEMO, timeout=10)
not_demo_blocked = not mentions_demo_mode(r)
check("POST /api/auth/logout NOT demo-blocked",
      not_demo_blocked,
      f"{r.status_code} {r.text[:200]}")

# Re-seed (since logout may have invalidated the session)
seed_demo_user()

# POST /api/push/register — whitelisted exact
r = requests.post(
    f"{BASE}/api/push/register",
    headers=H_DEMO,
    json={"expo_push_token": "ExponentPushToken[demo-test]"},
    timeout=10,
)
check("POST /api/push/register NOT demo-blocked",
      not mentions_demo_mode(r),
      f"{r.status_code} {r.text[:200]}")

# GET /api/auth/me — reads never blocked
r = requests.get(f"{BASE}/api/auth/me", headers=H_DEMO, timeout=10)
check("GET /api/auth/me NOT demo-blocked (200)",
      r.status_code == 200 and not mentions_demo_mode(r),
      f"{r.status_code} {r.text[:200]}")

# GET /api/me/tier — read
r = requests.get(f"{BASE}/api/me/tier", headers=H_DEMO, timeout=10)
check("GET /api/me/tier NOT demo-blocked",
      r.status_code in (200, 204) and not mentions_demo_mode(r),
      f"{r.status_code} {r.text[:200]}")

# GET /api/notifications — read
r = requests.get(f"{BASE}/api/notifications", headers=H_DEMO, timeout=10)
check("GET /api/notifications NOT demo-blocked",
      r.status_code in (200, 204) and not mentions_demo_mode(r),
      f"{r.status_code} {r.text[:200]}")

print()
print("=" * 70)
print("TEST 4 — NON-demo primary_owner UNAFFECTED")
print("=" * 70)

# POST /api/notes as OWNER (non-demo)
r = requests.post(
    f"{BASE}/api/notes",
    headers=H_OWNER,
    json={"title": "owner note demo-mw-test", "body": "hi"},
    timeout=10,
)
check("OWNER POST /api/notes NOT demo-blocked",
      not mentions_demo_mode(r),
      f"{r.status_code} {r.text[:200]}")

# Cleanup note if created
created_note_id = None
if r.status_code in (200, 201):
    try:
        created_note_id = r.json().get("note_id") or r.json().get("id")
    except Exception:
        pass

if created_note_id:
    requests.delete(f"{BASE}/api/notes/{created_note_id}",
                    headers=H_OWNER, timeout=10)

# GET /api/health → 200
r = requests.get(f"{BASE}/api/health", timeout=10)
check("GET /api/health 200",
      r.status_code == 200 and r.json().get("ok") is True,
      f"{r.status_code} {r.text[:200]}")

# GET /api/me/tier for owner → 200 with role=primary_owner
r = requests.get(f"{BASE}/api/me/tier", headers=H_OWNER, timeout=10)
ok = r.status_code == 200 and r.json().get("role") == "primary_owner"
check("OWNER GET /api/me/tier 200 role=primary_owner",
      ok,
      f"{r.status_code} {r.text[:200]}")

print()
print("=" * 70)
print("CLEANUP — Delete demo user fixture")
print("=" * 70)
cleanup_out = cleanup_demo_user()
print(cleanup_out)
check("Cleanup removed demo user + session",
      "users_deleted=1" in cleanup_out and "sessions_deleted=1" in cleanup_out,
      cleanup_out)

print()
print("=" * 70)
total = len(results)
passed = sum(1 for _, c, _ in results if c)
failed = total - passed
print(f"SUMMARY: {passed}/{total} passed, {failed} failed")
print("=" * 70)

if failed:
    print("\nFailed:")
    for name, cond, detail in results:
        if not cond:
            print(f"  - {name}: {detail}")
    sys.exit(1)
sys.exit(0)
