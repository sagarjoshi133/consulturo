#!/usr/bin/env python3
"""Smoke test for new Google Drive OAuth wizard endpoints."""
import os
import sys
import subprocess
import json
import urllib.parse
import requests

BASE = os.environ.get("TEST_BASE", "http://localhost:8001")
OWNER = "test_session_1776770314741"   # primary_owner sagar.joshi133@gmail.com
SO = os.environ.get("SO_TOKEN", "test_so_session_1780295720376")

results = []
def assert_eq(name, got, expected):
    ok = got == expected
    results.append((ok, name, f"got={got!r} expected={expected!r}"))
    return ok

def check(name, ok, detail=""):
    results.append((ok, name, detail))
    return ok

print(f"BASE={BASE}")

# 1. No auth → 401/403
r = requests.get(f"{BASE}/api/admin/backup/mirror/oauth/client")
check("1. GET /oauth/client no-auth status in {401,403}", r.status_code in (401, 403), f"got {r.status_code}")

# 2. As OWNER → 200 with expected keys
r = requests.get(f"{BASE}/api/admin/backup/mirror/oauth/client", headers={"Authorization": f"Bearer {OWNER}"})
check("2a. GET /oauth/client owner 200", r.status_code == 200, str(r.status_code))
body = r.json() if r.status_code == 200 else {}
check("2b. configured is bool", isinstance(body.get("configured"), bool), str(body))
check("2c. configured currently False (no client saved)", body.get("configured") is False, str(body.get("configured")))
ru = body.get("redirect_uri", "")
check("2d. redirect_uri ends with /api/admin/backup/mirror/oauth/callback",
      isinstance(ru, str) and ru.endswith("/api/admin/backup/mirror/oauth/callback"), ru)
pbu = body.get("public_backend_url", "")
check("2e. public_backend_url starts with https", isinstance(pbu, str) and pbu.startswith("https"), pbu)

# 3. POST invalid → 400
r = requests.post(f"{BASE}/api/admin/backup/mirror/oauth/client",
                  headers={"Authorization": f"Bearer {OWNER}", "Content-Type":"application/json"},
                  json={"client_id":"abc","client_secret":"xyz"})
check("3a. POST invalid → 400", r.status_code == 400, str(r.status_code) + " " + r.text[:200])
detail = ""
try:
    detail = r.json().get("detail","")
except Exception:
    pass
check("3b. 400 detail mentions apps.googleusercontent.com",
      "apps.googleusercontent.com" in detail, detail)

# 4. POST valid format → 200
r = requests.post(f"{BASE}/api/admin/backup/mirror/oauth/client",
                  headers={"Authorization": f"Bearer {OWNER}", "Content-Type":"application/json"},
                  json={"client_id":"fake-12345.apps.googleusercontent.com",
                        "client_secret":"GOCSPX-fake"})
check("4a. POST valid → 200", r.status_code == 200, str(r.status_code) + " " + r.text[:200])
b4 = r.json() if r.status_code == 200 else {}
check("4b. has redirect_uri field", "redirect_uri" in b4, str(b4))

# Re-call GET → configured should be true
r = requests.get(f"{BASE}/api/admin/backup/mirror/oauth/client", headers={"Authorization": f"Bearer {OWNER}"})
b4g = r.json()
check("4c. configured now True", b4g.get("configured") is True, str(b4g))

# 5. GET /oauth/url?folder=test-folder
r = requests.get(f"{BASE}/api/admin/backup/mirror/oauth/url",
                 params={"folder":"test-folder"},
                 headers={"Authorization": f"Bearer {OWNER}"})
check("5a. GET /oauth/url owner 200", r.status_code == 200, str(r.status_code) + " " + r.text[:300])
b5 = r.json() if r.status_code == 200 else {}
au = b5.get("authorize_url","")
check("5b. authorize_url starts with https://accounts.google.com/o/oauth2/v2/auth?",
      au.startswith("https://accounts.google.com/o/oauth2/v2/auth?"), au[:80])
check("5c. authorize_url has client_id=fake-12345.apps.googleusercontent.com",
      "client_id=fake-12345.apps.googleusercontent.com" in au, au)
# scope URL-encoded
check("5d. authorize_url has scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive",
      "scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive" in au, au)
state = b5.get("state","")
check("5e. authorize_url has state=<token>",
      ("state=" + urllib.parse.quote(state, safe="-_~")) in au or f"state={state}" in au, f"state={state}")
check("5f. state is non-empty str", isinstance(state, str) and len(state) > 10, state)

# Verify state row in db
chk = subprocess.run(["mongosh","--quiet","--eval",
    f"db = db.getSiblingDB('consulturo'); print(db.gdrive_oauth_states.countDocuments({{state:'{state}'}}));"],
    capture_output=True, text=True)
count_str = (chk.stdout or "").strip().splitlines()[-1] if chk.stdout else ""
check("5g. state row exists in db.gdrive_oauth_states", count_str == "1", f"out={chk.stdout!r} err={chk.stderr!r}")

# 6. Callback with error=access_denied (no auth)
r = requests.get(f"{BASE}/api/admin/backup/mirror/oauth/callback",
                 params={"error":"access_denied","state":"anystate"}, allow_redirects=False)
check("6a. callback error access_denied → 400", r.status_code == 400, str(r.status_code))
check("6b. body contains 'Authorization cancelled'",
      "Authorization cancelled" in r.text, r.text[:200])

# 7. Callback code=fake state=unknown-state
r = requests.get(f"{BASE}/api/admin/backup/mirror/oauth/callback",
                 params={"code":"fake","state":"unknown-state-no-such-row"}, allow_redirects=False)
check("7a. callback unknown state → 400", r.status_code == 400, str(r.status_code))
check("7b. body contains 'Unknown request'",
      "Unknown request" in r.text, r.text[:200])

# 8a. DELETE as SUPER OWNER → 200
r = requests.delete(f"{BASE}/api/admin/backup/mirror/oauth/client",
                    headers={"Authorization": f"Bearer {SO}"})
check("8a. DELETE /oauth/client SO → 200", r.status_code == 200, str(r.status_code) + " " + r.text[:200])

# 8b. GET /oauth/client now configured False
r = requests.get(f"{BASE}/api/admin/backup/mirror/oauth/client",
                 headers={"Authorization": f"Bearer {OWNER}"})
check("8b. configured back to False after delete",
      r.json().get("configured") is False, str(r.json()))

# 8c. Delete the test state row
sub = subprocess.run(["mongosh","--quiet","--eval",
    f"db = db.getSiblingDB('consulturo'); print(db.gdrive_oauth_states.deleteMany({{state:'{state}'}}).deletedCount);"],
    capture_output=True, text=True)
deleted = (sub.stdout or "").strip().splitlines()[-1] if sub.stdout else ""
check("8c. test state row deleted", deleted == "1", f"out={sub.stdout!r}")

# Regression checks
r = requests.get(f"{BASE}/api/payments/razorpay/config")
check("REG1. razorpay/config 200", r.status_code == 200, str(r.status_code))
rp = r.json() if r.status_code == 200 else {}
check("REG1b. razorpay enabled true, mode=test", rp.get("enabled") is True and rp.get("mode") == "test", str(rp))

r = requests.get(f"{BASE}/api/me/tier", headers={"Authorization": f"Bearer {OWNER}"})
check("REG2. /me/tier owner 200", r.status_code == 200, str(r.status_code))
rt = r.json() if r.status_code == 200 else {}
check("REG2b. can_create_blog True", rt.get("can_create_blog") is True, str(rt))

# Summary
print("\n=== RESULTS ===")
fails = []
for ok, name, det in results:
    print(("PASS " if ok else "FAIL ") + name + ("  | " + det if not ok else ""))
    if not ok:
        fails.append(name)

print(f"\n{len(results)-len(fails)}/{len(results)} passed; FAILED={len(fails)}")
sys.exit(0 if not fails else 1)
