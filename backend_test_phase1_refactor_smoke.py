"""Phase 1 modularization smoke test.

Verifies post-refactor (server.py → models.py / db.py / auth_deps.py
extraction) that user-facing endpoints behave identically.

Run:  python /app/backend_test_phase1_refactor_smoke.py
"""
import os
import sys
import json
import time
import requests

BASE = "http://localhost:8001/api"
OWNER_TOKEN = "test_session_1776770314741"
DOCTOR_TOKEN = "test_doc_1776771431524"

OWNER_HEADERS = {"Authorization": f"Bearer {OWNER_TOKEN}"}

passed = 0
failed = 0
fails = []


def check(label, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ✅ {label}")
    else:
        failed += 1
        msg = f"  ❌ {label}  {detail}"
        print(msg)
        fails.append(msg)


def section(title):
    print(f"\n=== {title} ===")


# 1) GET /api/clinic-settings (public, no auth)
section("1. GET /api/clinic-settings (public)")
r = requests.get(f"{BASE}/clinic-settings", timeout=10)
check("status 200", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")
clinic_payload = r.json() if r.status_code == 200 else {}
# Required keys after Letterhead iteration:
for k in [
    "letterhead_image_b64",
    "use_letterhead",
    "patient_education_html",
    "need_help_html",
    "clinic_name",
]:
    check(f"key '{k}' present", k in clinic_payload, f"keys={list(clinic_payload.keys())[:30]}")
# Type sanity
check(
    "letterhead_image_b64 is str",
    isinstance(clinic_payload.get("letterhead_image_b64", None), str),
)
check(
    "use_letterhead is bool",
    isinstance(clinic_payload.get("use_letterhead", None), bool),
)
check(
    "patient_education_html is str",
    isinstance(clinic_payload.get("patient_education_html", None), str),
)
check(
    "need_help_html is str",
    isinstance(clinic_payload.get("need_help_html", None), str),
)

orig_clinic_name = clinic_payload.get("clinic_name", "")

# 2) GET /api/diseases
section("2. GET /api/diseases (public)")
r = requests.get(f"{BASE}/diseases", timeout=10)
check("status 200", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")
if r.status_code == 200:
    diseases = r.json()
    if isinstance(diseases, dict) and "items" in diseases:
        diseases_list = diseases["items"]
    else:
        diseases_list = diseases
    check(
        "diseases is non-empty list",
        isinstance(diseases_list, list) and len(diseases_list) > 0,
        f"got type={type(diseases_list).__name__} len={len(diseases_list) if hasattr(diseases_list,'__len__') else 'n/a'}",
    )
    if isinstance(diseases_list, list) and diseases_list:
        first = diseases_list[0]
        check(
            "first disease has id/name fields",
            isinstance(first, dict) and ("id" in first or "name" in first or "title" in first),
            f"first={str(first)[:200]}",
        )

# 3) GET /api/doctor
section("3. GET /api/doctor (public)")
r = requests.get(f"{BASE}/doctor", timeout=10)
check("status 200", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")
if r.status_code == 200:
    doc = r.json()
    check("returns dict", isinstance(doc, dict), f"got {type(doc).__name__}")

# 4) Auth flow
section("4. /api/auth/me — auth gating")
r = requests.get(f"{BASE}/auth/me", timeout=10)
check(
    "no token → 401",
    r.status_code == 401,
    f"got {r.status_code}: {r.text[:200]}",
)

r = requests.get(f"{BASE}/auth/me", headers=OWNER_HEADERS, timeout=10)
check("primary_owner token → 200", r.status_code == 200, f"got {r.status_code}")
me = r.json() if r.status_code == 200 else {}
check(
    "role == primary_owner",
    me.get("role") == "primary_owner",
    f"role={me.get('role')}",
)
check("user_id present", bool(me.get("user_id")))
check("email present", bool(me.get("email")))

# 5) PATCH /api/clinic-settings as primary_owner
section("5. PATCH /api/clinic-settings (primary_owner)")
r = requests.patch(
    f"{BASE}/clinic-settings",
    headers=OWNER_HEADERS,
    json={"clinic_name": "Phase1 Smoke Test"},
    timeout=10,
)
check("PATCH status 200", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")

# verify persistence
r2 = requests.get(f"{BASE}/clinic-settings", timeout=10)
check(
    "GET after PATCH returns updated clinic_name",
    r2.status_code == 200 and r2.json().get("clinic_name") == "Phase1 Smoke Test",
    f"got name={r2.json().get('clinic_name') if r2.status_code==200 else r2.status_code}",
)

# revert
revert_value = orig_clinic_name if orig_clinic_name is not None else ""
r3 = requests.patch(
    f"{BASE}/clinic-settings",
    headers=OWNER_HEADERS,
    json={"clinic_name": revert_value},
    timeout=10,
)
check("revert PATCH status 200", r3.status_code == 200, f"got {r3.status_code}")
r4 = requests.get(f"{BASE}/clinic-settings", timeout=10)
final_name = r4.json().get("clinic_name") if r4.status_code == 200 else None
check(
    "GET after revert restored to original (or default)",
    final_name == orig_clinic_name or (orig_clinic_name == "" and isinstance(final_name, str)),
    f"got '{final_name}' vs orig '{orig_clinic_name}'",
)

# 6) PATCH /api/admin/partners/{user_id}/dashboard-perm — must seed a partner first
section("6. PATCH /api/admin/partners/{user_id}/dashboard-perm")
import subprocess

ts = int(time.time() * 1000)
partner_uid = f"smoke-partner-{ts}"
partner_email = f"smoke-partner-{ts}@example.com"

seed_cmd = [
    "mongosh", "--quiet", "--eval",
    f"""
    db = db.getSiblingDB('consulturo');
    db.users.insertOne({{
        user_id: '{partner_uid}',
        email: '{partner_email}',
        name: 'Smoke Partner',
        role: 'partner',
        created_at: new Date()
    }});
    print('SEED_OK');
    """,
]
seed_out = subprocess.run(seed_cmd, capture_output=True, text=True, timeout=10)
seed_ok = "SEED_OK" in seed_out.stdout
check("seed partner row inserted", seed_ok, f"stdout={seed_out.stdout[:200]} stderr={seed_out.stderr[:200]}")

if seed_ok:
    # PATCH false
    r = requests.patch(
        f"{BASE}/admin/partners/{partner_uid}/dashboard-perm",
        headers=OWNER_HEADERS,
        json={"dashboard_full_access": False},
        timeout=10,
    )
    check(
        "PATCH dashboard-perm=false → 200",
        r.status_code == 200,
        f"got {r.status_code}: {r.text[:200]}",
    )
    if r.status_code == 200:
        body = r.json()
        check(
            "response dashboard_full_access == false",
            body.get("dashboard_full_access") is False,
            f"body={body}",
        )

    # PATCH true (flip back)
    r = requests.patch(
        f"{BASE}/admin/partners/{partner_uid}/dashboard-perm",
        headers=OWNER_HEADERS,
        json={"dashboard_full_access": True},
        timeout=10,
    )
    check(
        "PATCH dashboard-perm=true → 200",
        r.status_code == 200,
        f"got {r.status_code}: {r.text[:200]}",
    )
    if r.status_code == 200:
        body = r.json()
        check(
            "response dashboard_full_access == true",
            body.get("dashboard_full_access") is True,
            f"body={body}",
        )

    # cleanup partner
    cleanup_cmd = [
        "mongosh", "--quiet", "--eval",
        f"""
        db = db.getSiblingDB('consulturo');
        var u = db.users.deleteOne({{user_id: '{partner_uid}'}});
        var a = db.audit_log.deleteMany({{target_email: '{partner_email}'}});
        print('CLEANUP users=' + u.deletedCount + ' audit=' + a.deletedCount);
        """,
    ]
    subprocess.run(cleanup_cmd, capture_output=True, text=True, timeout=10)

# 7) POST /api/team/invites
section("7. POST /api/team/invites (primary_owner)")
invite_email = f"smoke-invite-{ts}@example.com"
r = requests.post(
    f"{BASE}/team/invites",
    headers=OWNER_HEADERS,
    json={
        "email": invite_email,
        "name": "Smoke Invite",
        "role": "doctor",
    },
    timeout=10,
)
check("POST team/invites → 200", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")
if r.status_code == 200:
    body = r.json()
    check("response ok=true", body.get("ok") is True, f"body={body}")
    check(
        "response email matches",
        body.get("email") == invite_email,
        f"body={body}",
    )
    check(
        "response role=doctor",
        body.get("role") == "doctor",
        f"body={body}",
    )

# cleanup invite
cleanup_invite = [
    "mongosh", "--quiet", "--eval",
    f"""
    db = db.getSiblingDB('consulturo');
    var ti = db.team_invites.deleteMany({{email: '{invite_email}'}});
    print('CLEANUP invites=' + ti.deletedCount);
    """,
]
subprocess.run(cleanup_invite, capture_output=True, text=True, timeout=10)

# Bonus: verify no-token to admin endpoints still 401/403
section("8. Bonus auth gating regression")
r = requests.patch(
    f"{BASE}/admin/partners/whatever/dashboard-perm",
    json={"dashboard_full_access": False},
    timeout=10,
)
check(
    "PATCH dashboard-perm no token → 401",
    r.status_code == 401,
    f"got {r.status_code}: {r.text[:200]}",
)

r = requests.post(
    f"{BASE}/team/invites",
    json={"email": "x@x.com", "role": "doctor"},
    timeout=10,
)
check(
    "POST team/invites no token → 401",
    r.status_code == 401,
    f"got {r.status_code}: {r.text[:200]}",
)

print("\n" + "=" * 60)
print(f"PASSED: {passed}  FAILED: {failed}")
if fails:
    print("\nFailed assertions:")
    for f in fails:
        print(f)
sys.exit(0 if failed == 0 else 1)
