"""Phase 2 modularization smoke test.

Verifies that after extracting routers/diseases.py, routers/doctor.py,
routers/profile.py, routers/clinic_settings.py — all previously-tested
endpoints still behave identically.

Run: python /app/backend_test_phase2_modularization_smoke.py
"""
import os
import sys
import time
import json
from datetime import datetime, timedelta, timezone
import subprocess

import requests

BASE = "http://localhost:8001/api"
OWNER_TOKEN = "test_session_1776770314741"

PASS = []
FAIL = []


def assert_eq(name, actual, expected):
    ok = actual == expected
    (PASS if ok else FAIL).append((name, f"actual={actual!r} expected={expected!r}"))
    print(("PASS" if ok else "FAIL"), name, "->", actual if ok else f"actual={actual!r} expected={expected!r}")


def assert_true(name, cond, detail=""):
    (PASS if cond else FAIL).append((name, detail))
    print(("PASS" if cond else "FAIL"), name, ("" if cond else f": {detail}"))


def hdr(token=None):
    h = {"Content-Type": "application/json"}
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


def mongosh(js: str) -> str:
    r = subprocess.run(
        ["mongosh", "--quiet", "--eval", js],
        capture_output=True, text=True, timeout=30,
    )
    return r.stdout.strip() + ("\n" + r.stderr.strip() if r.stderr.strip() else "")


def main():
    # 1. GET /api/diseases (public)
    r = requests.get(f"{BASE}/diseases")
    assert_eq("1.1 GET /api/diseases status", r.status_code, 200)
    data = r.json()
    assert_true("1.2 /api/diseases is list", isinstance(data, list) and len(data) > 0, f"len={len(data) if isinstance(data, list) else 'NA'}")
    if isinstance(data, list) and data:
        keys = set(data[0].keys())
        for k in ("id", "name", "icon", "tagline", "image_url"):
            assert_true(f"1.3 disease has {k}", k in keys, f"keys={keys}")

    # 2. GET /api/diseases/kidney-stones (public)
    r = requests.get(f"{BASE}/diseases/kidney-stones")
    assert_eq("2.1 GET /diseases/kidney-stones status", r.status_code, 200)
    if r.status_code == 200:
        d = r.json()
        assert_true("2.2 has image_url", isinstance(d.get("image_url"), str) and len(d["image_url"]) > 0)
        assert_true("2.3 has symptoms", "symptoms" in d, f"keys={list(d.keys())}")
        assert_true("2.4 has treatments", "treatments" in d, f"keys={list(d.keys())}")

    # 3. GET /api/diseases/does-not-exist → 404
    r = requests.get(f"{BASE}/diseases/does-not-exist")
    assert_eq("3.1 GET /diseases/does-not-exist", r.status_code, 404)

    # 4. GET /api/doctor (public)
    r = requests.get(f"{BASE}/doctor")
    assert_eq("4.1 GET /api/doctor status", r.status_code, 200)
    if r.status_code == 200:
        d = r.json()
        for k in ("name", "qualifications", "services", "clinics", "socials"):
            assert_true(f"4.2 /api/doctor has {k}", k in d, f"keys={list(d.keys())}")

    # 5. GET /api/clinic-settings (public)
    r = requests.get(f"{BASE}/clinic-settings")
    assert_eq("5.1 GET /api/clinic-settings status", r.status_code, 200)
    cs_initial = r.json() if r.status_code == 200 else {}
    for k in ("letterhead_image_b64", "use_letterhead", "patient_education_html", "need_help_html"):
        assert_true(f"5.2 clinic-settings has {k}", k in cs_initial, f"keys={list(cs_initial.keys())}")

    # 6. GET /api/profile/quick-stats (auth gate)
    r = requests.get(f"{BASE}/profile/quick-stats")
    assert_true("6.1 quick-stats no token → 401", r.status_code == 401, f"got {r.status_code}")
    r = requests.get(f"{BASE}/profile/quick-stats", headers=hdr(OWNER_TOKEN))
    assert_eq("6.2 quick-stats owner token", r.status_code, 200)
    if r.status_code == 200:
        body = r.json()
        assert_true("6.3 quick-stats has tiles", "tiles" in body and isinstance(body["tiles"], list))

    # 7. PATCH /api/clinic-settings as primary_owner
    original_clinic = cs_initial.get("clinic_name", "")
    r = requests.patch(f"{BASE}/clinic-settings", headers=hdr(OWNER_TOKEN),
                       json={"clinic_name": "Test"})
    assert_eq("7.1 PATCH clinic_name=Test owner", r.status_code, 200)
    r = requests.get(f"{BASE}/clinic-settings")
    assert_eq("7.2 GET clinic_name reflects", r.json().get("clinic_name"), "Test")
    # revert
    r = requests.patch(f"{BASE}/clinic-settings", headers=hdr(OWNER_TOKEN),
                       json={"clinic_name": original_clinic})
    assert_eq("7.3 PATCH revert clinic_name", r.status_code, 200)
    r = requests.get(f"{BASE}/clinic-settings")
    assert_eq("7.4 GET clinic_name reverted", r.json().get("clinic_name"), original_clinic)

    # 8. Partner gating
    ts = int(time.time() * 1000)
    p_uid = f"test-partner-phase2-{ts}"
    p_email = f"test-partner-phase2-{ts}@example.com"
    p_token = f"test_partner_phase2_{ts}"
    expires = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
    js = f"""
db = db.getSiblingDB('consulturo');
db.users.insertOne({{user_id:'{p_uid}', email:'{p_email}', name:'PartnerPhase2', role:'partner', created_at:new Date()}});
db.user_sessions.insertOne({{user_id:'{p_uid}', session_token:'{p_token}', expires_at:new Date('{expires}'), created_at:new Date()}});
print('SEEDED');
"""
    out = mongosh(js)
    assert_true("8.0 partner seed", "SEEDED" in out, out)

    # Sanity: partner /auth/me
    r = requests.get(f"{BASE}/auth/me", headers=hdr(p_token))
    assert_eq("8.0a partner auth/me", r.status_code, 200)
    assert_eq("8.0b partner role", r.json().get("role"), "partner")

    # Disable partner_can_edit_branding AND the granular gate that
    # actually applies to clinic_name (partner_can_edit_clinic_info).
    # Note: _DEFAULT_CLINIC_SETTINGS defaults granular gates to True so
    # the legacy umbrella fallback only fires when the merged dict has
    # explicit False values — so we set them explicitly to False here.
    js2 = """
db = db.getSiblingDB('consulturo');
db.clinic_settings.updateOne({_id:'default'}, {$set:{partner_can_edit_branding:false, partner_can_edit_clinic_info:false}}, {upsert:true});
print('GATES_UNSET');
"""
    out = mongosh(js2)
    assert_true("8.1a unset granular gates", "GATES_UNSET" in out, out)

    # Partner attempts PATCH clinic_name (covered by partner_can_edit_clinic_info gate)
    r = requests.patch(f"{BASE}/clinic-settings", headers=hdr(p_token),
                       json={"clinic_name": "PartnerForbiddenTry"})
    assert_eq("8.1 partner PATCH (no gates) status", r.status_code, 403)
    detail = (r.json() or {}).get("detail", "")
    assert_true("8.2 partner 403 detail mentions 'Partners are not permitted'",
                "Partners are not permitted" in detail, f"detail={detail!r}")

    # Verify clinic_name was NOT changed
    r = requests.get(f"{BASE}/clinic-settings")
    assert_eq("8.3 clinic_name unchanged after 403", r.json().get("clinic_name"), original_clinic)

    # Now primary_owner enables both legacy umbrella + clinic_info gate
    r = requests.patch(f"{BASE}/clinic-settings", headers=hdr(OWNER_TOKEN),
                       json={"partner_can_edit_branding": True, "partner_can_edit_clinic_info": True})
    assert_eq("8.4 owner enables partner_can_edit_branding", r.status_code, 200)

    # Partner retries
    r = requests.patch(f"{BASE}/clinic-settings", headers=hdr(p_token),
                       json={"clinic_name": "PartnerAllowedTry"})
    assert_eq("8.5 partner PATCH after enable", r.status_code, 200)

    r = requests.get(f"{BASE}/clinic-settings")
    assert_eq("8.6 clinic_name reflects partner edit", r.json().get("clinic_name"), "PartnerAllowedTry")

    # Tear down: revert clinic_name + branding flag
    r = requests.patch(f"{BASE}/clinic-settings", headers=hdr(OWNER_TOKEN),
                       json={"clinic_name": original_clinic})
    assert_eq("8.7 owner revert clinic_name", r.status_code, 200)

    # Cleanup partner_can_edit_branding back to True (default), remove partner row & session
    js3 = f"""
db = db.getSiblingDB('consulturo');
db.clinic_settings.updateOne({{_id:'default'}}, {{$set:{{partner_can_edit_branding:true}}}});
var ud = db.users.deleteMany({{user_id:'{p_uid}'}});
var sd = db.user_sessions.deleteMany({{user_id:'{p_uid}'}});
print('CLEANED users=' + ud.deletedCount + ' sessions=' + sd.deletedCount);
"""
    out = mongosh(js3)
    assert_true("8.8 partner cleanup", "CLEANED" in out, out)

    # 9. Sanity smoke
    r = requests.get(f"{BASE}/auth/me", headers=hdr(OWNER_TOKEN))
    assert_eq("9.1 /auth/me owner", r.status_code, 200)

    r = requests.get(f"{BASE}/admin/partners", headers=hdr(OWNER_TOKEN))
    assert_eq("9.2 /admin/partners owner", r.status_code, 200)

    r = requests.get(f"{BASE}/team", headers=hdr(OWNER_TOKEN))
    assert_eq("9.3 /team owner", r.status_code, 200)

    # Health smoke
    r = requests.get(f"{BASE}/health")
    assert_eq("9.4 /health", r.status_code, 200)

    print("\n=========================")
    print(f"PASS: {len(PASS)}  FAIL: {len(FAIL)}")
    if FAIL:
        print("\nFAIL DETAILS:")
        for n, d in FAIL:
            print(" -", n, "::", d)
    return 0 if not FAIL else 1


if __name__ == "__main__":
    sys.exit(main())
