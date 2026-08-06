"""Backend tests for Session 5.15:
   A. Mirror wizard endpoints (owner-only)
   B. Blog policy default-True
   C. Razorpay config endpoint sanity
   D. Pay endpoint auth gate

Run against the public EXPO_PUBLIC_BACKEND_URL.
"""
import os
import json
import sys
import subprocess
import requests

BASE = os.environ.get("BASE_URL") or "https://urology-pro.preview.emergentagent.com/api"

# Pre-seeded tokens (test_credentials.md)
OWNER_TOKEN = "test_session_1776770314741"     # primary_owner sagar.joshi133@gmail.com (user_4775ed40276e)
DOCTOR_TOKEN = "test_doc_1776771431524"        # role=doctor, dr.test@example.com
PATIENT_TOKEN = "test_patient_1780260633308"   # role=patient
SO_TOKEN = os.environ.get("SO_TOKEN") or "test_so_session_1780289545596"

PRIMARY_OWNER_USER_ID = "user_4775ed40276e"

passes, failures = [], []
def expect(name, cond, detail=""):
    if cond:
        passes.append(name)
        print(f"  PASS — {name}")
    else:
        failures.append((name, detail))
        print(f"  FAIL — {name}: {detail}")


def H(tok):
    return {"Authorization": f"Bearer {tok}"} if tok else {}


def section(t):
    print(f"\n=== {t} ===")


# ════════════════════ A. Mirror wizard ════════════════════
section("A. Mirror wizard — GET /info as primary owner")
r = requests.get(f"{BASE}/admin/backup/mirror/info", headers=H(OWNER_TOKEN), timeout=20)
expect("A1 GET /info status=200", r.status_code == 200, f"status={r.status_code} body={r.text[:200]}")
info_before = {}
if r.status_code == 200:
    info_before = r.json()
    expect("A1 has rclone_installed bool", isinstance(info_before.get("rclone_installed"), bool))
    expect("A1 rclone_installed == True", info_before.get("rclone_installed") is True, f"got {info_before.get('rclone_installed')}")
    expect("A1 has has_gdrive_remote bool", isinstance(info_before.get("has_gdrive_remote"), bool))
    expect("A1 has current_mode str", isinstance(info_before.get("current_mode"), str))
    expect("A1 has configured bool", isinstance(info_before.get("configured"), bool))
    auth_url = info_before.get("authorize_url") or ""
    expect("A1 authorize_url starts with https://rclone.org/authorize/",
           auth_url.startswith("https://rclone.org/authorize/"), f"got {auth_url}")

section("A2 POST /connect with INVALID body (token='not-a-json')")
r = requests.post(f"{BASE}/admin/backup/mirror/connect", headers=H(OWNER_TOKEN),
                  json={"token": "not-a-json"}, timeout=30)
expect("A2 status=400", r.status_code == 400, f"status={r.status_code} body={r.text[:200]}")
if r.status_code == 400:
    detail = (r.json().get("detail") or "").lower()
    expect("A2 detail mentions authorization token or JSON",
           "authorization token" in detail or "json" in detail,
           f"detail={detail!r}")

section("A3 POST /connect with valid JSON missing access_token")
r = requests.post(f"{BASE}/admin/backup/mirror/connect", headers=H(OWNER_TOKEN),
                  json={"token": '{"hello":"world"}'}, timeout=30)
expect("A3 status=400 (regex mismatch)", r.status_code == 400, f"status={r.status_code} body={r.text[:200]}")

section("A4 POST /connect with FAKE structurally-correct token → 502/504")
fake_tok = '{"access_token":"fake","refresh_token":"x","token_type":"Bearer","expiry":"2030-01-01T00:00:00Z"}'
r = requests.post(f"{BASE}/admin/backup/mirror/connect", headers=H(OWNER_TOKEN),
                  json={"token": fake_tok}, timeout=120)
expect("A4 status in (502, 504)", r.status_code in (502, 504),
       f"status={r.status_code} body={r.text[:300]}")
expect("A4 is NOT 200 (would mean fake token accepted)", r.status_code != 200,
       f"got 200 body={r.text[:300]}")

section("A5 GET /info again — configured should still be False")
r = requests.get(f"{BASE}/admin/backup/mirror/info", headers=H(OWNER_TOKEN), timeout=20)
expect("A5 status=200", r.status_code == 200)
if r.status_code == 200:
    after = r.json()
    expect("A5 configured == False (env vars NOT persisted on failed connect)",
           after.get("configured") is False, f"info={after}")
    expect("A5 current_mode != 'rclone'",
           (after.get("current_mode") or "").lower() != "rclone",
           f"current_mode={after.get('current_mode')}")
    # Optional: has_gdrive_remote may be True since wizard wrote the [gdrive] block before validation failed
    print(f"    (info post-connect: has_gdrive_remote={after.get('has_gdrive_remote')}, current_mode={after.get('current_mode')!r}, configured={after.get('configured')})")

section("A6 Non-owner 403 on all 4 mirror endpoints")
for tok, role in [(PATIENT_TOKEN, "patient"), (DOCTOR_TOKEN, "doctor")]:
    rr = requests.get(f"{BASE}/admin/backup/mirror/info", headers=H(tok), timeout=15)
    expect(f"A6 GET /info as {role} == 403", rr.status_code == 403, f"status={rr.status_code} body={rr.text[:200]}")
    rr = requests.post(f"{BASE}/admin/backup/mirror/connect", headers=H(tok), json={"token": fake_tok}, timeout=15)
    expect(f"A6 POST /connect as {role} == 403", rr.status_code == 403, f"status={rr.status_code} body={rr.text[:200]}")
    rr = requests.post(f"{BASE}/admin/backup/mirror/test", headers=H(tok), timeout=15)
    expect(f"A6 POST /test as {role} == 403", rr.status_code == 403, f"status={rr.status_code} body={rr.text[:200]}")
    rr = requests.post(f"{BASE}/admin/backup/mirror/disconnect", headers=H(tok), timeout=15)
    expect(f"A6 POST /disconnect as {role} == 403", rr.status_code == 403, f"status={rr.status_code} body={rr.text[:200]}")


# ════════════════════ B. Blog policy default-True ════════════════════
section("B1 GET /me/tier as primary owner — can_create_blog should default True")
# First clean the user's can_create_blog field to test "no field set" behavior
subprocess.run([
    "mongosh", "--quiet", "--eval",
    f"db=db.getSiblingDB('consulturo'); db.users.updateOne({{user_id:'{PRIMARY_OWNER_USER_ID}'}}, {{\$unset:{{can_create_blog:''}}}});"
], capture_output=True)

r = requests.get(f"{BASE}/me/tier", headers=H(OWNER_TOKEN), timeout=15)
expect("B1 status=200", r.status_code == 200, f"status={r.status_code}")
if r.status_code == 200:
    body = r.json()
    expect("B1 can_create_blog == True (default-True when field absent)",
           body.get("can_create_blog") is True,
           f"got {body.get('can_create_blog')!r}; body={body}")

section("B2 PATCH /admin/primary-owners/{id}/blog-perm with false as super_owner")
r = requests.patch(f"{BASE}/admin/primary-owners/{PRIMARY_OWNER_USER_ID}/blog-perm",
                   headers=H(SO_TOKEN), json={"can_create_blog": False}, timeout=15)
expect("B2 status=200 from super_owner", r.status_code == 200, f"status={r.status_code} body={r.text[:300]}")
if r.status_code == 200:
    body = r.json()
    expect("B2 returns can_create_blog False", body.get("can_create_blog") is False,
           f"body={body}")

section("B3 GET /me/tier again — can_create_blog should be False now")
r = requests.get(f"{BASE}/me/tier", headers=H(OWNER_TOKEN), timeout=15)
expect("B3 status=200", r.status_code == 200)
if r.status_code == 200:
    expect("B3 can_create_blog == False after revoke",
           r.json().get("can_create_blog") is False, f"body={r.json()}")

section("B4 PATCH back to true; verify /me/tier flips again")
r = requests.patch(f"{BASE}/admin/primary-owners/{PRIMARY_OWNER_USER_ID}/blog-perm",
                   headers=H(SO_TOKEN), json={"can_create_blog": True}, timeout=15)
expect("B4 PATCH true status=200", r.status_code == 200, f"status={r.status_code} body={r.text[:200]}")
r = requests.get(f"{BASE}/me/tier", headers=H(OWNER_TOKEN), timeout=15)
expect("B4 /me/tier can_create_blog == True after re-grant",
       r.status_code == 200 and r.json().get("can_create_blog") is True,
       f"status={r.status_code} body={r.text[:200]}")

section("B5 POST /admin/blog as primary owner (default state)")
# Make sure flag is in default-true state (unset)
subprocess.run([
    "mongosh", "--quiet", "--eval",
    f"db=db.getSiblingDB('consulturo'); db.users.updateOne({{user_id:'{PRIMARY_OWNER_USER_ID}'}}, {{\$unset:{{can_create_blog:''}}}});"
], capture_output=True)
post_body = {"title": "Backend Test — Session 5.15 Blog Default Permission",
             "content": "x",
             "category": "Urology"}
r = requests.post(f"{BASE}/admin/blog", headers=H(OWNER_TOKEN), json=post_body, timeout=20)
expect("B5 POST /admin/blog status=200", r.status_code == 200, f"status={r.status_code} body={r.text[:300]}")
created_post_id = None
if r.status_code == 200:
    body = r.json()
    created_post_id = body.get("post_id") or body.get("id") or (body.get("post") or {}).get("post_id")
    print(f"    created blog post body keys: {list(body.keys())}, post_id={created_post_id}")

# Cleanup created blog post if any
if created_post_id:
    cr = requests.delete(f"{BASE}/admin/blog/{created_post_id}", headers=H(OWNER_TOKEN), timeout=15)
    print(f"    cleanup DELETE /admin/blog/{created_post_id} -> {cr.status_code}")


# ════════════════════ C. Razorpay config endpoint ════════════════════
section("C1 GET /payments/razorpay/config — public, enabled=False")
r = requests.get(f"{BASE}/payments/razorpay/config", timeout=15)
expect("C1 status=200", r.status_code == 200, f"status={r.status_code} body={r.text[:200]}")
if r.status_code == 200:
    body = r.json()
    expect("C1 enabled == False (RAZORPAY_KEY_ID not set)",
           body.get("enabled") is False, f"body={body}")


# ════════════════════ D. Pay endpoint auth gate ════════════════════
section("D1 POST /payments/razorpay/order without auth → 401/403")
r = requests.post(f"{BASE}/payments/razorpay/order",
                  json={"amount_inr": 100.0, "target_kind": "other"}, timeout=15)
expect("D1 status in (401, 403)", r.status_code in (401, 403),
       f"status={r.status_code} body={r.text[:200]}")


# ════════════════════ SUMMARY ════════════════════
print("\n" + "=" * 60)
print(f"PASS = {len(passes)}    FAIL = {len(failures)}")
if failures:
    print("\nFAILED ASSERTIONS:")
    for name, detail in failures:
        print(f"  - {name}\n      {detail}")
sys.exit(0 if not failures else 1)
