"""
Backend test for Partner Dashboard Permission control.

Endpoints under test:
  - PATCH /api/admin/partners/{user_id}/dashboard-perm
        Auth: require_primary_owner_strict (primary_owner OR legacy "owner";
              super_owner is INTENTIONALLY NOT accepted by this gate.)
  - GET   /api/admin/partners              (must include dashboard_full_access)
  - GET   /api/me/tier                     (partner with dfa=false → false)

Re-runnable. All test fixtures cleaned up at teardown.
"""

import os
import sys
import time
import subprocess
import requests

BASE = os.environ.get("BACKEND_URL", "http://localhost:8001")
API = f"{BASE}/api"
DB_NAME = "consulturo"

OWNER_TOKEN = "test_session_1776770314741"   # primary_owner sagar
DOCTOR_TOKEN = "test_doc_1776771431524"      # doctor

SUPER_OWNER_EMAIL = "app.consulturo@gmail.com"
TS = int(time.time())
SO_USER_ID = f"test-so-pdp-{TS}"
SO_TOKEN = f"test_so_pdp_{TS}"

# Test partner fixture
P_USER_ID = f"test-partner-pdp-{TS}"
P_EMAIL = f"test-partner-pdp-{TS}@example.com"
P_TOKEN = f"test_partner_pdp_{TS}"

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
    out = subprocess.run(
        ["mongosh", DB_NAME, "--quiet", "--eval", js],
        capture_output=True, text=True, check=False, timeout=30,
    )
    if out.returncode != 0:
        print("mongosh error:", out.stderr)
    return (out.stdout or "").strip()


# ────────────────────────────────────────────────────────────────
# Setup / Teardown
# ────────────────────────────────────────────────────────────────

def seed_partner_and_so():
    js = f"""
// Seed super_owner (existing app.consulturo email — only attach a session)
var so = db.users.findOne({{email: "{SUPER_OWNER_EMAIL}"}});
if (so) {{
  db.user_sessions.updateOne(
    {{ session_token: "{SO_TOKEN}" }},
    {{ $set: {{ session_token: "{SO_TOKEN}", user_id: so.user_id,
                expires_at: new Date(Date.now()+7*24*3600*1000),
                created_at: new Date() }} }},
    {{ upsert: true }}
  );
  print("so_uid=" + so.user_id);
}} else {{
  // No SO row exists — synthesize one (only needed if review env is fresh).
  db.users.insertOne({{
    user_id: "{SO_USER_ID}",
    email: "{SUPER_OWNER_EMAIL}",
    name: "SO PDP Test",
    role: "super_owner",
    consent_medical: true, consent_terms: true,
    created_at: new Date(),
  }});
  db.user_sessions.insertOne({{
    session_token: "{SO_TOKEN}",
    user_id: "{SO_USER_ID}",
    expires_at: new Date(Date.now()+7*24*3600*1000),
    created_at: new Date(),
  }});
  print("so_uid={SO_USER_ID}");
}}

// Seed partner user
db.users.insertOne({{
  user_id: "{P_USER_ID}",
  email: "{P_EMAIL}",
  name: "Test Partner PDP",
  role: "partner",
  phone: "+9100000001",
  consent_medical: true, consent_terms: true,
  created_at: new Date(),
}});
db.user_sessions.insertOne({{
  session_token: "{P_TOKEN}",
  user_id: "{P_USER_ID}",
  expires_at: new Date(Date.now()+7*24*3600*1000),
  created_at: new Date(),
}});

print("seed_ok");
"""
    out = mongo(js)
    print("seed output:", out)
    return "seed_ok" in out


def cleanup():
    js = f"""
db.users.deleteOne({{ user_id: "{P_USER_ID}" }});
db.user_sessions.deleteOne({{ session_token: "{P_TOKEN}" }});
db.team_invites.deleteMany({{ email: "{P_EMAIL}" }});

// Cleanup: drop synthesized SO user only if WE created it (uid match), but
// always drop OUR session.
db.users.deleteOne({{ user_id: "{SO_USER_ID}" }});
db.user_sessions.deleteOne({{ session_token: "{SO_TOKEN}" }});

// Drop audit rows for this test
db.audit_log.deleteMany({{
  kind: "partner_dashboard_perm_change",
  target_email: "{P_EMAIL}"
}});
db.audit_log.deleteMany({{
  kind: "role_change",
  target_email: "{P_EMAIL}"
}});

print("cleanup_ok");
"""
    out = mongo(js)
    return "cleanup_ok" in out


# ────────────────────────────────────────────────────────────────
# TESTS
# ────────────────────────────────────────────────────────────────

def test_1_partners_list_includes_field():
    print("\n=== Test 1: GET /api/admin/partners includes dashboard_full_access ===")
    r = requests.get(f"{API}/admin/partners", headers=H(OWNER_TOKEN), timeout=15)
    chk("1.1 list returns 200", r.status_code == 200, f"st={r.status_code} body={r.text[:300]}")
    items = (r.json() or {}).get("items", []) if r.status_code == 200 else []
    chk("1.1 list contains seeded partner",
        any(it.get("user_id") == P_USER_ID for it in items),
        f"items={items}")
    chk("1.1 every row has dashboard_full_access key",
        all("dashboard_full_access" in it for it in items),
        f"sample={items[:2]}")
    p_row = next((it for it in items if it.get("user_id") == P_USER_ID), None)
    if p_row:
        chk("1.1 seeded partner default dashboard_full_access=true",
            p_row.get("dashboard_full_access") is True,
            f"row={p_row}")


def test_2_unauth_no_token():
    print("\n=== Test 2: PATCH dashboard-perm — no auth → 401 ===")
    r = requests.patch(
        f"{API}/admin/partners/{P_USER_ID}/dashboard-perm",
        headers={"Content-Type": "application/json"},
        json={"dashboard_full_access": False}, timeout=15,
    )
    chk("2.1 no token → 401",
        r.status_code == 401, f"st={r.status_code} body={r.text[:300]}")


def test_3_partner_forbidden():
    print("\n=== Test 3: PATCH dashboard-perm — partner caller → 403 ===")
    # A partner should not be able to call this on a partner (or anyone).
    r = requests.patch(
        f"{API}/admin/partners/{P_USER_ID}/dashboard-perm",
        headers=H(P_TOKEN),
        json={"dashboard_full_access": False}, timeout=15,
    )
    chk("3.1 partner caller → 403",
        r.status_code == 403, f"st={r.status_code} body={r.text[:300]}")
    # Doctor caller → 403
    r = requests.patch(
        f"{API}/admin/partners/{P_USER_ID}/dashboard-perm",
        headers=H(DOCTOR_TOKEN),
        json={"dashboard_full_access": False}, timeout=15,
    )
    chk("3.2 doctor caller → 403",
        r.status_code == 403, f"st={r.status_code} body={r.text[:300]}")


def test_4_primary_owner_flip():
    print("\n=== Test 4: PATCH dashboard-perm — primary_owner → 200 (flip+persist) ===")
    # 4.1 flip OFF
    r = requests.patch(
        f"{API}/admin/partners/{P_USER_ID}/dashboard-perm",
        headers=H(OWNER_TOKEN),
        json={"dashboard_full_access": False}, timeout=15,
    )
    chk("4.1 PATCH false → 200",
        r.status_code == 200, f"st={r.status_code} body={r.text[:300]}")
    body = r.json() if r.status_code == 200 else {}
    chk("4.1 response.ok=true and dfa=false",
        body.get("ok") is True and body.get("dashboard_full_access") is False,
        f"body={body}")

    # 4.2 GET /admin/partners reflects false
    r = requests.get(f"{API}/admin/partners", headers=H(OWNER_TOKEN), timeout=15)
    items = (r.json() or {}).get("items", []) if r.status_code == 200 else []
    p_row = next((it for it in items if it.get("user_id") == P_USER_ID), None)
    chk("4.2 partner row dashboard_full_access=false",
        p_row is not None and p_row.get("dashboard_full_access") is False,
        f"row={p_row}")

    # 4.3 partner /api/me/tier reflects explicit-false (KEY check from spec)
    r = requests.get(f"{API}/me/tier", headers=H(P_TOKEN), timeout=15)
    chk("4.3 partner /me/tier 200", r.status_code == 200, f"st={r.status_code}")
    tbody = r.json() if r.status_code == 200 else {}
    chk("4.3 partner role=partner", tbody.get("role") == "partner", f"body={tbody}")
    chk("4.3 partner is_owner_tier=true (still partner-tier)",
        tbody.get("is_owner_tier") is True, f"body={tbody}")
    chk("4.3 partner dashboard_full_access=false (explicit-false respected)",
        tbody.get("dashboard_full_access") is False,
        f"got={tbody.get('dashboard_full_access')!r} body={tbody}")

    # 4.4 flip ON
    r = requests.patch(
        f"{API}/admin/partners/{P_USER_ID}/dashboard-perm",
        headers=H(OWNER_TOKEN),
        json={"dashboard_full_access": True}, timeout=15,
    )
    chk("4.4 PATCH true → 200",
        r.status_code == 200, f"st={r.status_code} body={r.text[:300]}")
    body = r.json() if r.status_code == 200 else {}
    chk("4.4 response.dfa=true",
        body.get("dashboard_full_access") is True, f"body={body}")

    # 4.5 partner /me/tier reflects true again
    r = requests.get(f"{API}/me/tier", headers=H(P_TOKEN), timeout=15)
    tbody = r.json() if r.status_code == 200 else {}
    chk("4.5 partner /me/tier dfa=true",
        tbody.get("dashboard_full_access") is True, f"body={tbody}")


def test_5_target_not_partner():
    print("\n=== Test 5: PATCH dashboard-perm — target is not a partner → 400 ===")
    # Use the doctor user_id (which is role=doctor, not partner)
    out = mongo(
        f"var s=db.user_sessions.findOne({{session_token:'{DOCTOR_TOKEN}'}});"
        "print(s && s.user_id ? s.user_id : '');"
    )
    doctor_uid = out.strip().splitlines()[-1] if out else ""
    if not doctor_uid:
        chk("5.1 (skipped) doctor uid not resolvable", False, "doctor uid empty")
        return
    r = requests.patch(
        f"{API}/admin/partners/{doctor_uid}/dashboard-perm",
        headers=H(OWNER_TOKEN),
        json={"dashboard_full_access": False}, timeout=15,
    )
    chk("5.1 non-partner target → 400",
        r.status_code == 400, f"st={r.status_code} body={r.text[:300]}")
    if r.status_code == 400:
        detail = (r.json() or {}).get("detail", "")
        chk("5.1 detail mentions partner",
            "partner" in detail.lower(),
            f"detail={detail!r}")

    # Also verify via primary_owner sagar (owner-tier role) → 400 too
    out = mongo(
        "var u=db.users.findOne({email:'sagar.joshi133@gmail.com'});"
        "print(u && u.user_id ? u.user_id : '');"
    )
    sagar_uid = out.strip().splitlines()[-1] if out else ""
    if sagar_uid:
        r = requests.patch(
            f"{API}/admin/partners/{sagar_uid}/dashboard-perm",
            headers=H(OWNER_TOKEN),
            json={"dashboard_full_access": False}, timeout=15,
        )
        chk("5.2 primary_owner target → 400",
            r.status_code == 400, f"st={r.status_code} body={r.text[:300]}")


def test_6_unknown_user():
    print("\n=== Test 6: PATCH dashboard-perm — unknown user_id → 404 ===")
    r = requests.patch(
        f"{API}/admin/partners/does_not_exist_user_xyz/dashboard-perm",
        headers=H(OWNER_TOKEN),
        json={"dashboard_full_access": False}, timeout=15,
    )
    chk("6.1 unknown user_id → 404",
        r.status_code == 404, f"st={r.status_code} body={r.text[:300]}")


def test_7_smoke():
    print("\n=== Test 7: Smoke ===")
    r = requests.get(f"{API}/health", timeout=15)
    chk("7.1 /api/health 200", r.status_code == 200, f"st={r.status_code}")
    body = r.json() if r.status_code == 200 else {}
    chk("7.1 /api/health ok=true", body.get("ok") is True, f"body={body}")


# ────────────────────────────────────────────────────────────────
# Main
# ────────────────────────────────────────────────────────────────


def main():
    print(f"Testing against {API}")
    if not seed_partner_and_so():
        print("FATAL: could not seed fixtures via mongosh")
        sys.exit(2)
    try:
        # Sanity: partner token works
        r = requests.get(f"{API}/auth/me", headers=H(P_TOKEN), timeout=15)
        print(f"sanity /auth/me partner: {r.status_code} {r.text[:200]}")
        chk("0.1 partner token /auth/me 200",
            r.status_code == 200, f"st={r.status_code} body={r.text[:300]}")

        test_1_partners_list_includes_field()
        test_2_unauth_no_token()
        test_3_partner_forbidden()
        test_4_primary_owner_flip()
        test_5_target_not_partner()
        test_6_unknown_user()
        test_7_smoke()
    finally:
        print("\n--- cleanup ---")
        cleanup()
        out = mongo(
            f"print('p_users='+db.users.countDocuments({{user_id:'{P_USER_ID}'}}));"
            f"print('p_sess='+db.user_sessions.countDocuments({{session_token:'{P_TOKEN}'}}));"
            f"print('audit_left='+db.audit_log.countDocuments({{"
            f"kind:'partner_dashboard_perm_change',target_email:'{P_EMAIL}'}}));"
        )
        print(out)

    print(f"\n==== RESULTS: {len(PASS)} PASS, {len(FAIL)} FAIL ====")
    if FAIL:
        for n, d in FAIL:
            print(f"  FAIL  {n}\n        {d}")
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
