"""
Push notification endpoints test suite.

Tests:
- GET /api/push/diagnostics (owner-only)
- POST /api/push/test
- POST/DELETE /api/push/register
- Smoke: /api/doctor, /api/education, /api/blog
"""
import os
import sys
import json
import time
import subprocess
from pathlib import Path

import requests

# Load EXPO_PUBLIC_BACKEND_URL from /app/frontend/.env
FRONTEND_ENV = Path("/app/frontend/.env")
BASE = None
for line in FRONTEND_ENV.read_text().splitlines():
    if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
        BASE = line.split("=", 1)[1].strip() + "/api"
        break
assert BASE, "EXPO_PUBLIC_BACKEND_URL missing"
print(f"BASE = {BASE}")

OWNER_TOKEN = "test_session_1776770314741"
DOCTOR_TOKEN = "test_doc_1776771431524"

PASS = []
FAIL = []


def check(cond, label, detail=""):
    if cond:
        print(f"  ✅ {label}")
        PASS.append(label)
    else:
        print(f"  ❌ {label} -- {detail}")
        FAIL.append(f"{label} :: {detail}")


def auth(token):
    return {"Authorization": f"Bearer {token}"} if token else {}


def mongo_count_push_log():
    out = subprocess.run(
        ["mongosh", "--quiet", "--eval",
         "db = db.getSiblingDB('consulturo'); print(db.push_log.countDocuments({}));"],
        capture_output=True, text=True, timeout=15,
    ).stdout.strip()
    try:
        return int(out.splitlines()[-1].strip())
    except Exception:
        return -1


def mongo_latest_push_log():
    out = subprocess.run(
        ["mongosh", "--quiet", "--eval",
         "db = db.getSiblingDB('consulturo'); printjson(db.push_log.find({}).sort({created_at:-1}).limit(1).toArray());"],
        capture_output=True, text=True, timeout=15,
    ).stdout
    return out


def mongo_cleanup_tokens(user_ids):
    expr = json.dumps({"user_id": {"$in": list(user_ids)}})
    subprocess.run(
        ["mongosh", "--quiet", "--eval",
         f"db = db.getSiblingDB('consulturo'); db.push_tokens.deleteMany({expr});"],
        capture_output=True, text=True, timeout=15,
    )


def mongo_count_tokens_for_user(uid):
    out = subprocess.run(
        ["mongosh", "--quiet", "--eval",
         f"db = db.getSiblingDB('consulturo'); print(db.push_tokens.countDocuments({{user_id:'{uid}'}}));"],
        capture_output=True, text=True, timeout=15,
    ).stdout.strip()
    try:
        return int(out.splitlines()[-1].strip())
    except Exception:
        return -1


# ============================================================
# 1. Ensure clean state for OWNER & DOCTOR push tokens
# ============================================================
print("\n[0] Pre-clean push_tokens for OWNER & DOCTOR test users")
mongo_cleanup_tokens(["user_4775ed40276e", "doc-test-1776771431502"])

# ============================================================
# 2. GET /api/push/diagnostics
# ============================================================
print("\n[1] GET /api/push/diagnostics")

r = requests.get(f"{BASE}/push/diagnostics", timeout=20)
check(r.status_code == 401, "no-auth -> 401",
      f"got {r.status_code}: {r.text[:200]}")

r = requests.get(f"{BASE}/push/diagnostics", headers=auth(DOCTOR_TOKEN), timeout=20)
check(r.status_code == 403, "doctor -> 403",
      f"got {r.status_code}: {r.text[:200]}")

r = requests.get(f"{BASE}/push/diagnostics", headers=auth(OWNER_TOKEN), timeout=20)
check(r.status_code == 200, "owner -> 200",
      f"got {r.status_code}: {r.text[:200]}")
diag = None
if r.status_code == 200:
    diag = r.json()
    for k in ["total_tokens", "sends_last_24h", "successes_last_24h",
              "failures_last_24h", "users", "recent"]:
        check(k in diag, f"diag has key `{k}`",
              f"keys={list(diag.keys())}")
    check(isinstance(diag.get("total_tokens"), int), "total_tokens is int")
    check(isinstance(diag.get("sends_last_24h"), int), "sends_last_24h is int")
    check(isinstance(diag.get("successes_last_24h"), int), "successes_last_24h is int")
    check(isinstance(diag.get("failures_last_24h"), int), "failures_last_24h is int")
    check(isinstance(diag.get("users"), list), "users is list")
    check(isinstance(diag.get("recent"), list), "recent is list")
    check(len(diag.get("recent", [])) <= 20, "recent <=20 items")
    # users shape (may be empty list if no staff found, but owner must be there)
    if diag.get("users"):
        u0 = diag["users"][0]
        for k in ["user_id", "email", "name", "role", "token_count", "tokens"]:
            check(k in u0, f"user[0] has key `{k}`", f"keys={list(u0.keys())}")
        check(isinstance(u0.get("token_count"), int), "user[0].token_count is int")
        check(isinstance(u0.get("tokens"), list), "user[0].tokens is list")

# ============================================================
# 3. POST /api/push/test
# ============================================================
print("\n[2] POST /api/push/test")

r = requests.post(f"{BASE}/push/test", timeout=20)
check(r.status_code == 401, "no-auth -> 401",
      f"got {r.status_code}: {r.text[:200]}")

# With no tokens registered
before_count = mongo_count_push_log()
r = requests.post(f"{BASE}/push/test", headers=auth(OWNER_TOKEN), timeout=20)
check(r.status_code == 200, "owner no-tokens -> 200",
      f"got {r.status_code}: {r.text[:200]}")
if r.status_code == 200:
    body = r.json()
    check(body.get("ok") is False, "response.ok == False",
          f"body={body}")
    check(body.get("reason") == "no_tokens", "response.reason == 'no_tokens'",
          f"body={body}")
    check(body.get("tokens_found") == 0, "response.tokens_found == 0",
          f"body={body}")
after_count = mongo_count_push_log()
print(f"    push_log count: before={before_count}, after={after_count} (delta={after_count-before_count})")
# Spec says: "it's OK if the 'no_tokens' branch skips logging". Just report behaviour.

# ============================================================
# 4. POST /api/push/register with valid token
# ============================================================
print("\n[3] POST /api/push/register (owner)")

fake_token = "ExponentPushToken[pushtest-owner-test123]"
r = requests.post(
    f"{BASE}/push/register",
    headers=auth(OWNER_TOKEN),
    json={"token": fake_token, "platform": "ios", "device_name": "pytest-device"},
    timeout=20,
)
check(r.status_code == 200, "register valid token -> 200",
      f"got {r.status_code}: {r.text[:200]}")
if r.status_code == 200:
    check(r.json().get("ok") is True, "register returns ok:True")

# Invalid token
r = requests.post(
    f"{BASE}/push/register",
    headers=auth(OWNER_TOKEN),
    json={"token": "not-a-real-token", "platform": "ios"},
    timeout=20,
)
check(r.status_code == 400, "register invalid token -> 400",
      f"got {r.status_code}: {r.text[:200]}")

# Verify stored in DB
owner_token_count = mongo_count_tokens_for_user("user_4775ed40276e")
check(owner_token_count >= 1, "push_tokens has owner row",
      f"count={owner_token_count}")

# Now /push/test should find it (and attempt to call Expo, which will fail
# for the fake token but the LOG ENTRY will still be created and response
# should reflect tokens_found > 0).
print("\n[3b] POST /api/push/test WITH owner token registered")
before_count2 = mongo_count_push_log()
r = requests.post(f"{BASE}/push/test", headers=auth(OWNER_TOKEN), timeout=30)
check(r.status_code == 200, "owner w/ token -> 200",
      f"got {r.status_code}: {r.text[:200]}")
if r.status_code == 200:
    body = r.json()
    check(body.get("tokens_found", 0) >= 1, "tokens_found >= 1",
          f"body={body}")
after_count2 = mongo_count_push_log()
print(f"    push_log count: before={before_count2}, after={after_count2} (delta={after_count2-before_count2})")
check(after_count2 > before_count2, "push_log entry appended after send",
      f"delta={after_count2-before_count2}")
# Inspect newest entry
if after_count2 > before_count2:
    time.sleep(0.3)
    out = subprocess.run(
        ["mongosh", "--quiet", "--eval",
         "db = db.getSiblingDB('consulturo'); "
         "var r=db.push_log.find({}).sort({created_at:-1}).limit(1).toArray()[0]; "
         "print(JSON.stringify({has_title:!!r.title, has_body:!!r.body, "
         "has_total:(typeof r.total==='number'), has_sent:(typeof r.sent==='number'), "
         "has_errors:Array.isArray(r.errors), has_created_at:!!r.created_at, "
         "total:r.total, sent:r.sent, title:r.title, errors_len:(r.errors||[]).length}));"],
        capture_output=True, text=True, timeout=15,
    ).stdout
    try:
        last_line = out.strip().splitlines()[-1]
        info = json.loads(last_line)
        print(f"    last push_log: {info}")
        for k in ["has_title", "has_body", "has_total", "has_sent",
                  "has_errors", "has_created_at"]:
            check(info.get(k), f"push_log entry has `{k.replace('has_','')}`",
                  f"info={info}")
    except Exception as e:
        check(False, "parse last push_log", str(e))

# ============================================================
# 5. DELETE /api/push/register
# ============================================================
print("\n[4] DELETE /api/push/register")
r = requests.delete(
    f"{BASE}/push/register",
    params={"token": fake_token},
    headers=auth(OWNER_TOKEN),
    timeout=20,
)
check(r.status_code == 200, "delete valid token -> 200",
      f"got {r.status_code}: {r.text[:200]}")
owner_token_count_after = mongo_count_tokens_for_user("user_4775ed40276e")
check(owner_token_count_after == 0, "push_tokens cleared",
      f"count={owner_token_count_after}")

# DELETE with missing token
r = requests.delete(
    f"{BASE}/push/register",
    params={"token": ""},
    headers=auth(OWNER_TOKEN),
    timeout=20,
)
check(r.status_code == 400, "delete empty token -> 400",
      f"got {r.status_code}: {r.text[:200]}")

# ============================================================
# 6. Post-diagnostics after activity: verify recent array has grown
# ============================================================
print("\n[5] GET /api/push/diagnostics AFTER a send")
r = requests.get(f"{BASE}/push/diagnostics", headers=auth(OWNER_TOKEN), timeout=20)
check(r.status_code == 200, "diag (post) -> 200",
      f"got {r.status_code}: {r.text[:200]}")
if r.status_code == 200:
    diag2 = r.json()
    check(diag2.get("sends_last_24h", 0) >= 1, "sends_last_24h >= 1",
          f"val={diag2.get('sends_last_24h')}")
    check(len(diag2.get("recent", [])) >= 1, "recent has >=1 entry",
          f"len={len(diag2.get('recent', []))}")
    # check a recent entry shape
    if diag2.get("recent"):
        e0 = diag2["recent"][0]
        for k in ["title", "body", "total", "sent", "errors", "created_at"]:
            check(k in e0, f"recent[0] has `{k}`", f"keys={list(e0.keys())}")

# ============================================================
# 7. Smoke: existing endpoints
# ============================================================
print("\n[6] Smoke: existing endpoints")
r = requests.get(f"{BASE}/doctor", timeout=20)
check(r.status_code == 200, "GET /doctor -> 200",
      f"got {r.status_code}: {r.text[:200]}")

r = requests.get(f"{BASE}/education", timeout=20)
check(r.status_code == 200, "GET /education -> 200",
      f"got {r.status_code}: {r.text[:200]}")
if r.status_code == 200:
    check(isinstance(r.json(), list), "education returns list")

r = requests.get(f"{BASE}/blog", timeout=30)
check(r.status_code == 200, "GET /blog -> 200",
      f"got {r.status_code}: {r.text[:200]}")

# ============================================================
# 8. Final cleanup
# ============================================================
print("\n[7] Cleanup: remove any lingering test push tokens")
mongo_cleanup_tokens(["user_4775ed40276e", "doc-test-1776771431502"])

# ============================================================
# SUMMARY
# ============================================================
print("\n" + "=" * 70)
print(f"PASS: {len(PASS)}   FAIL: {len(FAIL)}")
if FAIL:
    print("\nFailures:")
    for f in FAIL:
        print(f"  - {f}")
    sys.exit(1)
print("\nALL CHECKS PASS")
sys.exit(0)
