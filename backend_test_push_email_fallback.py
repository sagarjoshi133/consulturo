"""Backend test for push-token email-fallback fix.

Tests POST /api/push/register and POST /api/push/test, including:
- Happy path
- Email fallback / self-heal path (tokens stored under stale user_id)
- True empty path (no tokens)

Note: the fake Expo token returned by /push/test is purged by Expo as
DeviceNotRegistered/InvalidCredentials — so we re-register it between
test phases.

Run: python /app/backend_test_push_email_fallback.py
"""
import os
import sys
import asyncio
import time
import requests
from motor.motor_asyncio import AsyncIOMotorClient

BASE = "http://localhost:8001"
OWNER_TOKEN = "test_session_1776770314741"
OWNER_EMAIL = "sagar.joshi133@gmail.com"
HEADERS = {"Authorization": f"Bearer {OWNER_TOKEN}", "Content-Type": "application/json"}
TEST_TOKEN = f"ExponentPushToken[abc123testtoken_{int(time.time())}]"
STALE_USER_ID = "stale_user_id_xyz"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "consulturo")

results = []
def record(name, ok, detail=""):
    status = "PASS" if ok else "FAIL"
    results.append((name, ok, detail))
    print(f"[{status}] {name} :: {detail}")

async def get_db():
    return AsyncIOMotorClient(MONGO_URL)[DB_NAME]


async def cleanup_token(db):
    await db.push_tokens.delete_many({"token": TEST_TOKEN})
    await db.push_tokens.delete_many({"email": OWNER_EMAIL})


def http_register():
    body = {"token": TEST_TOKEN, "platform": "android", "device_name": "TestDevice"}
    return requests.post(f"{BASE}/api/push/register", headers=HEADERS, json=body)


async def main():
    db = await get_db()

    # Pre-cleanup
    await cleanup_token(db)

    # === 5. Backend health check ===
    r = requests.get(f"{BASE}/api/")
    record("GET /api/ → 200", r.status_code == 200,
           f"status={r.status_code} body={r.text[:120]}")

    me = requests.get(f"{BASE}/api/auth/me", headers=HEADERS).json()
    real_user_id = me["user_id"]
    record("auth/me returns owner",
           me.get("email") == OWNER_EMAIL,
           f"user_id={real_user_id} role={me.get('role')}")

    # === 1. POST /api/push/register ===
    r = http_register()
    record("POST /api/push/register → 200", r.status_code == 200,
           f"status={r.status_code} body={r.text[:200]}")

    # Verify in DB
    row = await db.push_tokens.find_one({"token": TEST_TOKEN})
    record("push_tokens row inserted with correct user_id+email",
           row is not None
           and row.get("user_id") == real_user_id
           and row.get("email") == OWNER_EMAIL,
           f"row={ {k: row.get(k) for k in ('user_id','email','platform','device_name')} if row else None }")

    # === 2. POST /api/push/test — happy path ===
    r = requests.post(f"{BASE}/api/push/test", headers=HEADERS)
    j = r.json() if r.status_code == 200 else {}
    record("POST /api/push/test (happy path) → 200",
           r.status_code == 200, f"status={r.status_code}")
    tokens_found = j.get("tokens_found", 0)
    reason = j.get("reason")
    record("happy path tokens_found >= 1 and reason != no_tokens",
           tokens_found >= 1 and reason != "no_tokens",
           f"tokens_found={tokens_found} reason={reason} ok={j.get('ok')}")
    record("happy path: receipts/errors structure present (not no_tokens)",
           reason != "no_tokens"
           and ("receipts" in j or "errors" in j or "ticket_ids" in j),
           f"keys={list(j.keys())} purged={j.get('purged')}")
    # The fake token may have been purged here as DeviceNotRegistered.
    purged_after_happy = j.get("purged") or 0
    print(f"   (note: happy path 'purged' = {purged_after_happy} — fake token "
          f"may have been purged by Expo)")

    # === 3. EMAIL FALLBACK (THE NEW FIX) ===
    # Re-register the test token first (in case happy path purged it)
    r = http_register()
    record("Re-register test token before corruption test",
           r.status_code == 200, f"status={r.status_code}")

    # Corrupt the user_id to a stale value
    upd = await db.push_tokens.update_one(
        {"token": TEST_TOKEN, "user_id": real_user_id},
        {"$set": {"user_id": STALE_USER_ID}},
    )
    record("Corrupted push_tokens row to stale user_id",
           upd.modified_count == 1, f"modified={upd.modified_count}")
    corrupted = await db.push_tokens.find_one({"token": TEST_TOKEN})
    record("Confirmed corrupted user_id stored",
           corrupted is not None and corrupted.get("user_id") == STALE_USER_ID,
           f"user_id={corrupted.get('user_id') if corrupted else None}")
    # Sanity: confirm email is still on the row (fallback relies on it)
    record("Corrupted row still has email field for fallback",
           corrupted is not None and corrupted.get("email") == OWNER_EMAIL,
           f"email={corrupted.get('email') if corrupted else None}")

    # Now call /api/push/test as the same authenticated owner
    r = requests.post(f"{BASE}/api/push/test", headers=HEADERS)
    j = r.json() if r.status_code == 200 else {}
    record("POST /api/push/test (after corruption) → 200",
           r.status_code == 200, f"status={r.status_code}")
    tokens_found = j.get("tokens_found", 0)
    reason = j.get("reason")
    record("EMAIL FALLBACK: token found via email, reason != no_tokens",
           tokens_found >= 1 and reason != "no_tokens",
           f"tokens_found={tokens_found} reason={reason} ok={j.get('ok')} "
           f"purged={j.get('purged')}")

    # Verify SELF-HEAL: user_id should now be the real_user_id again.
    # NOTE: After collect_user_tokens self-heals, send_expo_push_batch may
    # then purge the token because Expo rejects the fake token. So the row
    # may be GONE. We need to inspect BEFORE the purge could happen — so
    # check db state right after a separate call that doesn't trigger send.
    # To check self-heal cleanly, re-corrupt and call collect_user_tokens
    # behaviour by directly calling the python helper.
    # Easier alternative: call collect_user_tokens via the fast path
    # (push/diagnostics doesn't trigger purge), or just observe the
    # response: if tokens_found >= 1 AND no_tokens reason absent, the
    # email fallback worked. The self-heal db-state is best validated
    # via a fresh corrupt + a non-sending fetch.
    healed = await db.push_tokens.find_one({"token": TEST_TOKEN})
    if healed is not None:
        record("SELF-HEAL: token user_id re-stamped to real user_id",
               healed.get("user_id") == real_user_id,
               f"user_id_after={healed.get('user_id')} expected={real_user_id}")
    else:
        # Token was purged by Expo after self-heal — re-do the test with
        # a fresh corruption + use collect_user_tokens via a direct
        # python import to validate self-heal without triggering send.
        print("   (token purged after send — validating self-heal via direct "
              "service call with re-registration)")
        r = http_register()
        await db.push_tokens.update_one(
            {"token": TEST_TOKEN, "user_id": real_user_id},
            {"$set": {"user_id": STALE_USER_ID}},
        )
        # Import the service helper directly and call it.
        sys.path.insert(0, "/app/backend")
        try:
            from services.notifications import collect_user_tokens
        except Exception as e:
            record("Imported collect_user_tokens for self-heal validation",
                   False, f"import error: {e}")
            collect_user_tokens = None
        if collect_user_tokens is not None:
            toks = await collect_user_tokens([real_user_id])
            record("collect_user_tokens fallback returned token via email",
                   len(toks) == 1 and toks[0] == TEST_TOKEN,
                   f"toks={toks}")
            healed = await db.push_tokens.find_one({"token": TEST_TOKEN})
            record("SELF-HEAL: token user_id re-stamped to real user_id",
                   healed is not None and healed.get("user_id") == real_user_id,
                   f"user_id_after={healed.get('user_id') if healed else None} "
                   f"expected={real_user_id}")

    # === 4. TRUE EMPTY PATH ===
    delres = await db.push_tokens.delete_many({"email": OWNER_EMAIL})
    delres2 = await db.push_tokens.delete_many({"user_id": real_user_id})
    total_deleted = delres.deleted_count + delres2.deleted_count
    record("Deleted all push_tokens for owner email & user_id",
           total_deleted >= 0,
           f"deleted_by_email={delres.deleted_count} "
           f"deleted_by_user_id={delres2.deleted_count}")
    # Sanity: confirm none remain
    remaining = await db.push_tokens.count_documents(
        {"$or": [{"email": OWNER_EMAIL}, {"user_id": real_user_id}]}
    )
    record("Confirmed zero owner tokens remain",
           remaining == 0, f"remaining={remaining}")

    r = requests.post(f"{BASE}/api/push/test", headers=HEADERS)
    j = r.json() if r.status_code == 200 else {}
    record("POST /api/push/test (empty) → 200",
           r.status_code == 200, f"status={r.status_code}")
    record("EMPTY PATH: ok=false reason=no_tokens tokens_found=0",
           j.get("ok") is False
           and j.get("reason") == "no_tokens"
           and j.get("tokens_found") == 0,
           f"ok={j.get('ok')} reason={j.get('reason')} "
           f"tokens_found={j.get('tokens_found')} message={j.get('message','')[:80]}")

    # Final cleanup
    await cleanup_token(db)

    # === Summary ===
    print("\n" + "=" * 60)
    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print(f"RESULT: {passed}/{total} assertions passed")
    failed = [r for r in results if not r[1]]
    if failed:
        print("\nFAILED:")
        for name, _, detail in failed:
            print(f"  - {name} :: {detail}")
        sys.exit(1)
    print("ALL CHECKS PASS ✅")
    sys.exit(0)


if __name__ == "__main__":
    asyncio.run(main())
