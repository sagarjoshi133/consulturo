"""
Backend test bundle for the 2026-04-28 4-feature backend update.

Features under test:
  A. Granular partner-branding toggles in PATCH /api/clinic-settings.
  B. Blog editorial gate (require_blog_writer) + PATCH
     /api/admin/primary-owners/{user_id}/blog-perm.
  C. POST /api/admin/demo/create with role='patient' + sample-data seed,
     plus matching DELETE cleanup; demo middleware verification.
  D. Smoke regression — /api/health, demo-middleware retest, role-hierarchy retest.

Re-runnable. All test fixtures cleaned up at teardown.
"""

import os
import sys
import time
import uuid
import json
import subprocess
import requests

BASE = os.environ.get("BACKEND_URL", "http://localhost:8001")
API = f"{BASE}/api"

OWNER_TOKEN = "test_session_1776770314741"        # primary_owner sagar
DOCTOR_TOKEN = "test_doc_1776771431524"           # doctor dr.test

PARTNER_EMAIL = f"partner-test-A-{int(time.time())}@example.com"
SUPER_OWNER_EMAIL = "app.consulturo@gmail.com"
DEMO_PATIENT_EMAIL = f"demo-patient-{int(time.time())}@example.com"

PARTNER_USER_ID = f"u_test_partner_{uuid.uuid4().hex[:8]}"
PARTNER_TOKEN = f"test_partner_session_{uuid.uuid4().hex[:12]}"

SUPER_OWNER_USER_ID = f"u_test_superowner_{uuid.uuid4().hex[:8]}"
SUPER_OWNER_TOKEN = f"test_super_session_{uuid.uuid4().hex[:12]}"

DEMO_PATIENT_TOKEN = f"test_demo_pat_session_{uuid.uuid4().hex[:12]}"

DB_NAME = "consulturo"

PASS = []
FAIL = []


def chk(name, cond, detail=""):
    if cond:
        PASS.append(name)
        print(f"  PASS  {name}")
    else:
        FAIL.append((name, detail))
        print(f"  FAIL  {name}  -- {detail}")


def H(token=None):
    h = {"Content-Type": "application/json"}
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


def mongo(js):
    """Run a JS one-liner against the consulturo db via mongosh, returning trimmed stdout."""
    out = subprocess.run(
        ["mongosh", DB_NAME, "--quiet", "--eval", js],
        capture_output=True, text=True, check=False, timeout=30,
    )
    if out.returncode != 0:
        print("mongosh error:", out.stderr)
    return (out.stdout or "").strip()


# ───────────────────────────────────────────────────────────────────
# Setup: seed partner + super_owner + their session tokens via mongosh
# ───────────────────────────────────────────────────────────────────


def seed_partner():
    js = f"""
db.users.updateOne(
  {{ user_id: "{PARTNER_USER_ID}" }},
  {{ $set: {{
    user_id: "{PARTNER_USER_ID}",
    email: "{PARTNER_EMAIL}",
    name: "Partner Test A",
    role: "partner",
    created_at: new Date(),
  }} }},
  {{ upsert: true }}
);
db.user_sessions.updateOne(
  {{ session_token: "{PARTNER_TOKEN}" }},
  {{ $set: {{
    session_token: "{PARTNER_TOKEN}",
    user_id: "{PARTNER_USER_ID}",
    expires_at: new Date(Date.now() + 7*24*3600*1000),
    created_at: new Date(),
  }} }},
  {{ upsert: true }}
);
print("seed_partner_ok");
"""
    out = mongo(js)
    return "seed_partner_ok" in out


def seed_super_owner():
    js = f"""
db.users.updateOne(
  {{ user_id: "{SUPER_OWNER_USER_ID}" }},
  {{ $set: {{
    user_id: "{SUPER_OWNER_USER_ID}",
    email: "{SUPER_OWNER_EMAIL}",
    name: "Super Owner Test",
    role: "super_owner",
    created_at: new Date(),
  }} }},
  {{ upsert: true }}
);
db.user_sessions.updateOne(
  {{ session_token: "{SUPER_OWNER_TOKEN}" }},
  {{ $set: {{
    session_token: "{SUPER_OWNER_TOKEN}",
    user_id: "{SUPER_OWNER_USER_ID}",
    expires_at: new Date(Date.now() + 7*24*3600*1000),
    created_at: new Date(),
  }} }},
  {{ upsert: true }}
);
print("seed_super_owner_ok");
"""
    out = mongo(js)
    return "seed_super_owner_ok" in out


def cleanup():
    js = f"""
db.users.deleteOne({{ user_id: "{PARTNER_USER_ID}" }});
db.user_sessions.deleteOne({{ session_token: "{PARTNER_TOKEN}" }});
db.team_invites.deleteMany({{ email: "{PARTNER_EMAIL}" }});
db.audit_log.deleteMany({{ target_email: "{PARTNER_EMAIL}" }});

db.users.deleteOne({{ user_id: "{SUPER_OWNER_USER_ID}" }});
db.user_sessions.deleteOne({{ session_token: "{SUPER_OWNER_TOKEN}" }});
db.team_invites.deleteMany({{ email: "{SUPER_OWNER_EMAIL}" }});

db.user_sessions.deleteMany({{ session_token: "{DEMO_PATIENT_TOKEN}" }});

// Reset granular toggles to default true
db.clinic_settings.updateOne(
  {{ _id: "default" }},
  {{ $set: {{
      partner_can_edit_main_photo: true,
      partner_can_edit_cover_photo: true,
      partner_can_edit_clinic_info: true,
      partner_can_edit_socials: true
  }} }},
  {{ upsert: true }}
);

// Clear can_create_blog flag set on sagar during the test
db.users.updateOne(
  {{ email: "sagar.joshi133@gmail.com" }},
  {{ $unset: {{ can_create_blog: "" }} }}
);
db.team_invites.updateMany(
  {{ email: "sagar.joshi133@gmail.com" }},
  {{ $unset: {{ can_create_blog: "" }} }}
);

// Wipe blog-perm audit rows for this test
db.audit_log.deleteMany({{ kind: "blog_perm_change", target_email: "sagar.joshi133@gmail.com" }});

print("cleanup_ok");
"""
    out = mongo(js)
    return "cleanup_ok" in out


# ───────────────────────────────────────────────────────────────────
# A. Granular partner-branding toggles
# ───────────────────────────────────────────────────────────────────

PARTNER_FIELD_MATRIX = [
    # (toggle_key, payload_key, payload_val_for_test)
    ("partner_can_edit_main_photo",  "main_photo_url",  "data:image/png;base64,iVBORw0K"),
    ("partner_can_edit_cover_photo", "cover_photo_url", "data:image/png;base64,iVBORw0KCOVER"),
    ("partner_can_edit_clinic_info", "clinic_name",     f"Clinic Test {uuid.uuid4().hex[:6]}"),
    ("partner_can_edit_socials",     "social_facebook", f"fb_test_{uuid.uuid4().hex[:6]}"),
]


def test_A_partner_granular_toggles():
    print("\n=== A. Partner-branding granular toggles ===")
    # Sanity: partner token resolves
    r = requests.get(f"{API}/auth/me", headers=H(PARTNER_TOKEN), timeout=15)
    chk("A.0 partner /auth/me returns 200",
        r.status_code == 200,
        f"status={r.status_code} body={r.text[:200]}")
    if r.status_code == 200:
        chk("A.0 partner role == partner",
            r.json().get("role") == "partner",
            f"got role={r.json().get('role')}")

    for i, (toggle, field, val) in enumerate(PARTNER_FIELD_MATRIX, start=1):
        # Step 2: primary_owner OFF
        r1 = requests.patch(f"{API}/clinic-settings",
                            headers=H(OWNER_TOKEN),
                            json={toggle: False},
                            timeout=15)
        chk(f"A.{i}.1 owner sets {toggle}=false → 200",
            r1.status_code == 200,
            f"status={r1.status_code} body={r1.text[:300]}")

        # Step 3: partner write blocked
        r2 = requests.patch(f"{API}/clinic-settings",
                            headers=H(PARTNER_TOKEN),
                            json={field: val},
                            timeout=15)
        chk(f"A.{i}.2 partner PATCH {field} → 403",
            r2.status_code == 403,
            f"status={r2.status_code} body={r2.text[:300]}")
        if r2.status_code == 403:
            chk(f"A.{i}.3 partner 403 detail mentions '{toggle}'",
                toggle in (r2.text or ""),
                f"detail={r2.text[:300]}")

        # Step 4: primary_owner ON again
        r3 = requests.patch(f"{API}/clinic-settings",
                            headers=H(OWNER_TOKEN),
                            json={toggle: True},
                            timeout=15)
        chk(f"A.{i}.4 owner sets {toggle}=true → 200",
            r3.status_code == 200,
            f"status={r3.status_code} body={r3.text[:200]}")

        # Step 5: partner now succeeds
        r4 = requests.patch(f"{API}/clinic-settings",
                            headers=H(PARTNER_TOKEN),
                            json={field: val},
                            timeout=15)
        chk(f"A.{i}.5 partner PATCH {field} after re-enable → 200",
            r4.status_code == 200,
            f"status={r4.status_code} body={r4.text[:300]}")


# ───────────────────────────────────────────────────────────────────
# B. Blog editorial gate
# ───────────────────────────────────────────────────────────────────

CREATED_BLOG_POST_IDS = []


def test_B_blog_editorial_gate():
    print("\n=== B. Blog editorial gate ===")

    body = {"title": "Test Blog Post — bundle Apr28",
            "content": "This is sample blog content for the test.",
            "category": "Urology",
            "excerpt": "tiny",
            "cover": "",
            "status": "published"}

    # B.1 doctor → 403
    r = requests.post(f"{API}/admin/blog", headers=H(DOCTOR_TOKEN), json=body, timeout=15)
    chk("B.1 doctor POST /admin/blog → 403",
        r.status_code == 403, f"status={r.status_code} body={r.text[:200]}")
    chk("B.1 doctor 403 detail mentions 'Blog editorial access'",
        "Blog editorial access" in (r.text or ""),
        f"detail={r.text[:300]}")

    # B.2 primary_owner without can_create_blog → 403
    r = requests.post(f"{API}/admin/blog", headers=H(OWNER_TOKEN), json=body, timeout=15)
    chk("B.2 primary_owner WITHOUT can_create_blog → 403",
        r.status_code == 403, f"status={r.status_code} body={r.text[:200]}")

    # B.3 super_owner GET /api/admin/primary-owners → 200, sagar listed with can_create_blog absent/false
    r = requests.get(f"{API}/admin/primary-owners", headers=H(SUPER_OWNER_TOKEN), timeout=15)
    chk("B.3 super_owner GET /admin/primary-owners → 200",
        r.status_code == 200, f"status={r.status_code} body={r.text[:200]}")
    sagar_user_id = None
    if r.status_code == 200:
        items = r.json().get("items", [])
        sagar_row = next((x for x in items if x.get("email") == "sagar.joshi133@gmail.com"), None)
        chk("B.3 sagar's row present in primary-owners list",
            sagar_row is not None,
            f"items={items}")
        if sagar_row:
            sagar_user_id = sagar_row["user_id"]
            chk("B.3 sagar.can_create_blog field present and falsy",
                "can_create_blog" in sagar_row and not sagar_row["can_create_blog"],
                f"row={sagar_row}")

    # B.4 super_owner PATCH /admin/primary-owners/{sagar}/blog-perm {can_create_blog: true} → 200
    if sagar_user_id:
        r = requests.patch(f"{API}/admin/primary-owners/{sagar_user_id}/blog-perm",
                           headers=H(SUPER_OWNER_TOKEN),
                           json={"can_create_blog": True}, timeout=15)
        chk("B.4 super_owner grants can_create_blog → 200",
            r.status_code == 200, f"status={r.status_code} body={r.text[:200]}")
        if r.status_code == 200:
            chk("B.4 response.can_create_blog == True",
                r.json().get("can_create_blog") is True,
                f"resp={r.text}")

    # B.5 sagar /api/me/tier → can_create_blog:true, is_demo:false
    r = requests.get(f"{API}/me/tier", headers=H(OWNER_TOKEN), timeout=15)
    chk("B.5 sagar /me/tier → 200",
        r.status_code == 200, f"status={r.status_code} body={r.text[:200]}")
    if r.status_code == 200:
        d = r.json()
        chk("B.5 sagar can_create_blog == True",
            d.get("can_create_blog") is True, f"tier={d}")
        chk("B.5 sagar is_demo == False",
            d.get("is_demo") is False, f"tier={d}")

    # B.6 sagar POST /admin/blog → 200
    r = requests.post(f"{API}/admin/blog", headers=H(OWNER_TOKEN), json=body, timeout=15)
    chk("B.6 sagar (now blog-writer) POST /admin/blog → 200",
        r.status_code == 200, f"status={r.status_code} body={r.text[:300]}")
    if r.status_code == 200:
        post_id = r.json().get("post_id")
        if post_id:
            CREATED_BLOG_POST_IDS.append(post_id)
        chk("B.6 response includes post_id",
            bool(post_id), f"resp={r.text[:300]}")

    # B.7 primary_owner attempting blog-perm → 403
    if sagar_user_id:
        r = requests.patch(f"{API}/admin/primary-owners/{sagar_user_id}/blog-perm",
                           headers=H(OWNER_TOKEN),
                           json={"can_create_blog": True}, timeout=15)
        chk("B.7 primary_owner cannot PATCH blog-perm (super_owner only) → 403",
            r.status_code == 403, f"status={r.status_code} body={r.text[:200]}")


# ───────────────────────────────────────────────────────────────────
# C. Demo Patient with sample-data seed
# ───────────────────────────────────────────────────────────────────

DEMO_USER_ID = None


def test_C_demo_patient_seed():
    global DEMO_USER_ID
    print("\n=== C. Demo Patient + sample-data seed ===")

    # C.1 super_owner POST /admin/demo/create role=patient
    r = requests.post(f"{API}/admin/demo/create",
                      headers=H(SUPER_OWNER_TOKEN),
                      json={"email": DEMO_PATIENT_EMAIL, "name": "Demo Pat",
                            "role": "patient", "seed_sample_data": True},
                      timeout=20)
    chk("C.1 super_owner POST /admin/demo/create role=patient → 200",
        r.status_code == 200, f"status={r.status_code} body={r.text[:400]}")
    if r.status_code != 200:
        return
    d = r.json()
    DEMO_USER_ID = d.get("user_id")
    chk("C.1 response has user_id", bool(DEMO_USER_ID), f"resp={d}")
    chk("C.1 is_demo == true", d.get("is_demo") is True, f"resp={d}")
    chk("C.1 role == patient", d.get("role") == "patient", f"resp={d}")
    seeded = d.get("seeded") or {}
    chk("C.1 seeded.bookings == 1", seeded.get("bookings") == 1, f"seeded={seeded}")
    chk("C.1 seeded.prescriptions == 1", seeded.get("prescriptions") == 1, f"seeded={seeded}")
    chk("C.1 seeded.ipss == 1", seeded.get("ipss") == 1, f"seeded={seeded}")
    chk("C.1 seeded.registration_no is str",
        isinstance(seeded.get("registration_no"), str) and seeded.get("registration_no"),
        f"seeded={seeded}")

    # C.2 mongosh verifications
    if DEMO_USER_ID:
        js = f"""
const u = db.users.findOne({{email: "{DEMO_PATIENT_EMAIL}"}});
const bk = db.bookings.countDocuments({{user_id: "{DEMO_USER_ID}", is_demo_seed: true}});
const rx = db.prescriptions.countDocuments({{user_id: "{DEMO_USER_ID}", is_demo_seed: true}});
const ip = db.ipss_submissions.countDocuments({{user_id: "{DEMO_USER_ID}", is_demo_seed: true}});
print(JSON.stringify({{role: u && u.role, is_demo: u && u.is_demo, user_id: u && u.user_id, bk, rx, ip}}));
"""
        out = mongo(js)
        try:
            data = json.loads(out.splitlines()[-1])
        except Exception:
            data = {}
        chk("C.2 mongosh users.role == patient", data.get("role") == "patient", f"out={out}")
        chk("C.2 mongosh users.is_demo == true", data.get("is_demo") is True, f"out={out}")
        chk("C.2 mongosh users.user_id matches", data.get("user_id") == DEMO_USER_ID, f"out={out}")
        chk("C.2 bookings is_demo_seed count == 1", data.get("bk") == 1, f"out={out}")
        chk("C.2 prescriptions is_demo_seed count == 1", data.get("rx") == 1, f"out={out}")
        chk("C.2 ipss_submissions is_demo_seed count == 1", data.get("ip") == 1, f"out={out}")

    # C.3 Insert session token, GET /auth/me
    js = f"""
db.user_sessions.updateOne(
  {{ session_token: "{DEMO_PATIENT_TOKEN}" }},
  {{ $set: {{
      session_token: "{DEMO_PATIENT_TOKEN}",
      user_id: "{DEMO_USER_ID}",
      expires_at: new Date(Date.now() + 7*24*3600*1000),
      created_at: new Date()
  }} }},
  {{ upsert: true }}
);
print("session_seeded");
"""
    mongo(js)
    r = requests.get(f"{API}/auth/me", headers=H(DEMO_PATIENT_TOKEN), timeout=15)
    chk("C.3 demo patient /auth/me → 200",
        r.status_code == 200, f"status={r.status_code} body={r.text[:300]}")
    if r.status_code == 200:
        d = r.json()
        chk("C.3 /auth/me is_demo == true", d.get("is_demo") is True, f"me={d}")
        chk("C.3 /auth/me role == patient", d.get("role") == "patient", f"me={d}")

    # C.4 demo patient POST /api/bookings → 403 from middleware
    booking = {"patient_name": "Demo Pat", "patient_phone": "+910000000001",
               "reason": "demo write attempt", "booking_date": "2026-05-15",
               "booking_time": "10:00", "mode": "in-person"}
    r = requests.post(f"{API}/bookings", headers=H(DEMO_PATIENT_TOKEN),
                      json=booking, timeout=15)
    chk("C.4 demo patient POST /bookings → 403",
        r.status_code == 403, f"status={r.status_code} body={r.text[:300]}")
    if r.status_code == 403:
        try:
            jd = r.json()
        except Exception:
            jd = {}
        chk("C.4 response demo:true",
            jd.get("demo") is True, f"resp={jd}")

    # C.5 demo patient GET /auth/me → 200 (already verified above)
    r = requests.get(f"{API}/bookings/me", headers=H(DEMO_PATIENT_TOKEN), timeout=15)
    chk("C.5 demo patient GET /bookings/me → 200 (reads OK)",
        r.status_code == 200, f"status={r.status_code} body={r.text[:200]}")

    # C.6 super_owner DELETE /admin/demo/{user_id}
    if DEMO_USER_ID:
        r = requests.delete(f"{API}/admin/demo/{DEMO_USER_ID}",
                            headers=H(SUPER_OWNER_TOKEN), timeout=15)
        chk("C.6 super_owner DELETE /admin/demo/{uid} → 200",
            r.status_code == 200, f"status={r.status_code} body={r.text[:300]}")
        if r.status_code == 200:
            cleanup_counts = (r.json() or {}).get("cleanup", {})
            chk("C.6 cleanup.bookings == 1",
                cleanup_counts.get("bookings") == 1, f"cleanup={cleanup_counts}")
            chk("C.6 cleanup.prescriptions == 1",
                cleanup_counts.get("prescriptions") == 1, f"cleanup={cleanup_counts}")
            chk("C.6 cleanup.ipss == 1",
                cleanup_counts.get("ipss") == 1, f"cleanup={cleanup_counts}")

    # C.7 verify mongosh counts post-cleanup
    if DEMO_USER_ID:
        js = f"""
const bk = db.bookings.countDocuments({{user_id: "{DEMO_USER_ID}", is_demo_seed: true}});
const rx = db.prescriptions.countDocuments({{user_id: "{DEMO_USER_ID}", is_demo_seed: true}});
const ip = db.ipss_submissions.countDocuments({{user_id: "{DEMO_USER_ID}", is_demo_seed: true}});
const u = db.users.findOne({{user_id: "{DEMO_USER_ID}"}});
print(JSON.stringify({{bk, rx, ip, role: u && u.role, is_demo: u && u.is_demo}}));
"""
        out = mongo(js)
        try:
            data = json.loads(out.splitlines()[-1])
        except Exception:
            data = {}
        chk("C.7 bookings post-cleanup == 0", data.get("bk") == 0, f"out={out}")
        chk("C.7 prescriptions post-cleanup == 0", data.get("rx") == 0, f"out={out}")
        chk("C.7 ipss post-cleanup == 0", data.get("ip") == 0, f"out={out}")
        chk("C.8 user role still patient post-cleanup",
            data.get("role") == "patient", f"out={out}")
        chk("C.8 user is_demo == false post-cleanup",
            data.get("is_demo") is False, f"out={out}")


def cleanup_demo_user():
    if DEMO_USER_ID:
        js = f"""
db.users.deleteOne({{ user_id: "{DEMO_USER_ID}" }});
db.team_invites.deleteMany({{ email: "{DEMO_PATIENT_EMAIL}" }});
db.audit_log.deleteMany({{ target_email: "{DEMO_PATIENT_EMAIL}" }});
db.bookings.deleteMany({{ user_id: "{DEMO_USER_ID}" }});
db.prescriptions.deleteMany({{ user_id: "{DEMO_USER_ID}" }});
db.ipss_submissions.deleteMany({{ user_id: "{DEMO_USER_ID}" }});
print("demo_cleanup_ok");
"""
        mongo(js)


def cleanup_blog_posts():
    for pid in CREATED_BLOG_POST_IDS:
        js = f'db.blog_posts.deleteOne({{post_id: "{pid}"}}); print("blog_deleted_" + "{pid}");'
        mongo(js)


# ───────────────────────────────────────────────────────────────────
# D. Smoke regression
# ───────────────────────────────────────────────────────────────────


def test_D_smoke():
    print("\n=== D. Smoke regression ===")
    r = requests.get(f"{API}/health", timeout=10)
    chk("D.1 GET /api/health → 200",
        r.status_code == 200, f"status={r.status_code}")
    if r.status_code == 200:
        d = r.json()
        chk("D.1 health.ok == true and db == connected",
            d.get("ok") is True and d.get("db") == "connected",
            f"health={d}")


def run_regression_scripts():
    print("\n=== Re-running prior backend test scripts ===")
    for path in [
        "/app/backend_test_demo_middleware.py",
        "/app/backend_test_role_hierarchy.py",
    ]:
        if not os.path.exists(path):
            chk(f"REGR script exists: {path}", False, "missing on disk")
            continue
        out = subprocess.run([sys.executable, path],
                             capture_output=True, text=True, timeout=180, check=False)
        ok = out.returncode == 0
        last = (out.stdout or "")[-500:]
        chk(f"REGR {os.path.basename(path)} exit==0",
            ok, f"rc={out.returncode} tail={last!r}")


# ───────────────────────────────────────────────────────────────────
# Main
# ───────────────────────────────────────────────────────────────────


def main():
    print(f"BASE = {BASE}")

    # Pre-clean any leftovers from a prior aborted run
    cleanup()

    if not seed_partner():
        print("FATAL: could not seed partner via mongosh"); sys.exit(2)
    if not seed_super_owner():
        print("FATAL: could not seed super_owner via mongosh"); sys.exit(2)

    try:
        test_A_partner_granular_toggles()
        test_B_blog_editorial_gate()
        test_C_demo_patient_seed()
        test_D_smoke()
        run_regression_scripts()
    finally:
        cleanup_blog_posts()
        cleanup_demo_user()
        cleanup()

    total = len(PASS) + len(FAIL)
    print(f"\nTOTAL: {len(PASS)}/{total} PASS, {len(FAIL)} FAIL")
    if FAIL:
        print("\nFAILURES:")
        for n, d in FAIL:
            print(f"  {n}\n      {d[:400]}")
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
