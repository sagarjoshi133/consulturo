"""Phase 5.15 — Google Places Reviews integration end-to-end smoke.

Verifies:
  - POST /api/featured-reviews/resolve-place (NEW)
  - POST /api/featured-reviews/pull-google (was 501 stub, now implemented)
  - GET /api/clinic-settings: leak check on google_places_api_key
  - Idempotence on repeated pull-google
  - Error paths (no API key, invalid maps_url)

Owner token: test_session_1776770314741 (sagar.joshi133@gmail.com, primary_owner).
Pre-seeded clinic_settings._id=clinic_a97b903f2fb2 has both the API key
(AIzaSyB66bs...N2R4) and place_id (ChIJ8x5PeMfHXzkRTRJ-5w0zHyU).
"""
from __future__ import annotations

import json
import sys
import time
from typing import Any, Dict, List

import requests
from pymongo import MongoClient

BASE = "http://localhost:8001"
OWNER_TOKEN = "test_session_1776770314741"
OWNER_CLINIC_ID = "clinic_a97b903f2fb2"
EXPECTED_PLACE_ID_PREFIX = "ChIJ"
EXPECTED_PLACE_ID = "ChIJ8x5PeMfHXzkRTRJ-5w0zHyU"
MAPS_URL = "https://share.google/ZxRetMcgXgbSQ35qS"
TEXT_QUERY = "Dr Sagar Joshi Urologist Vadodara"
INVALID_MAPS = "https://share.google/totally-invalid-xyz"

H_OWNER: Dict[str, str] = {
    "Authorization": f"Bearer {OWNER_TOKEN}",
    "Content-Type": "application/json",
    "X-Clinic-Id": OWNER_CLINIC_ID,
}

PASSES: List[str] = []
FAILS: List[str] = []


def ok(label: str, cond: bool, detail: str = "") -> bool:
    line = f"{'✅' if cond else '❌'} {label}"
    if detail:
        line += f" — {detail}"
    print(line)
    (PASSES if cond else FAILS).append(label)
    return cond


def get_mongo():
    return MongoClient("mongodb://localhost:27017").get_database("consulturo")


# ─────────────────────────────────────────────────────────────────
print("\n── TEST 1: GET /api/clinic-settings (security / key leak) ──")
r = requests.get(f"{BASE}/api/clinic-settings", headers={"X-Clinic-Id": OWNER_CLINIC_ID}, timeout=20)
ok("GET /api/clinic-settings → 200", r.status_code == 200, f"status={r.status_code}")
cs = r.json() if r.status_code == 200 else {}
ok("response is dict", isinstance(cs, dict))
ok("google_places_api_key_set == true",
   cs.get("google_places_api_key_set") is True,
   f"actual={cs.get('google_places_api_key_set')!r}")
ok("google_places_api_key NOT leaked in response",
   "google_places_api_key" not in cs,
   f"keys-leaking={[k for k in cs if 'api_key' in k.lower() and not k.endswith('_set')]}")
ok("google_places_place_id present in response",
   cs.get("google_places_place_id") == EXPECTED_PLACE_ID,
   f"actual={cs.get('google_places_place_id')!r}")

# ─────────────────────────────────────────────────────────────────
print("\n── TEST 2: POST /api/featured-reviews/resolve-place (maps_url) ──")
r = requests.post(
    f"{BASE}/api/featured-reviews/resolve-place",
    headers=H_OWNER,
    data=json.dumps({"maps_url": MAPS_URL}),
    timeout=30,
)
ok("maps_url → 200", r.status_code == 200, f"status={r.status_code} body={r.text[:300]}")
body = {}
try:
    body = r.json()
except Exception:
    pass
pid = body.get("place_id") or ""
ok("place_id starts with ChIJ", pid.startswith(EXPECTED_PLACE_ID_PREFIX), f"place_id={pid!r}")
ok("place_name contains 'Sagar Joshi'",
   "sagar joshi" in (body.get("place_name") or "").lower(),
   f"place_name={body.get('place_name')!r}")
ok("rating is numeric",
   isinstance(body.get("rating"), (int, float)),
   f"rating={body.get('rating')!r}")
ok("total_ratings is integer",
   isinstance(body.get("total_ratings"), int),
   f"total_ratings={body.get('total_ratings')!r}")
ok("formatted_address present (non-empty string)",
   isinstance(body.get("formatted_address"), str) and len(body.get("formatted_address") or "") > 5,
   f"formatted_address={body.get('formatted_address')!r}")

print("\n── TEST 2b: POST /api/featured-reviews/resolve-place (query fallback) ──")
r = requests.post(
    f"{BASE}/api/featured-reviews/resolve-place",
    headers=H_OWNER,
    data=json.dumps({"query": TEXT_QUERY}),
    timeout=30,
)
ok("query → 200", r.status_code == 200, f"status={r.status_code} body={r.text[:300]}")
body2 = r.json() if r.status_code == 200 else {}
pid2 = body2.get("place_id") or ""
ok("query place_id starts with ChIJ", pid2.startswith(EXPECTED_PLACE_ID_PREFIX), f"place_id={pid2!r}")
ok("query resolves to SAME place_id as maps_url",
   pid2 == pid,
   f"maps_url_pid={pid!r} query_pid={pid2!r}")

# ─────────────────────────────────────────────────────────────────
print("\n── TEST 3: POST /api/featured-reviews/pull-google (first run) ──")
# Snapshot existing google reviews for this clinic so we can identify
# the freshly-inserted set without false positives.
mdb = get_mongo()
pre_existing_gids = {
    d.get("google_review_id")
    for d in mdb["featured_reviews"].find(
        {"clinic_id": OWNER_CLINIC_ID, "source": "google"},
        {"google_review_id": 1, "_id": 0},
    )
}

r = requests.post(
    f"{BASE}/api/featured-reviews/pull-google",
    headers=H_OWNER,
    data=json.dumps({}),
    timeout=45,
)
ok("pull-google #1 → 200", r.status_code == 200, f"status={r.status_code} body={r.text[:400]}")
pull1 = r.json() if r.status_code == 200 else {}
fetched1 = pull1.get("fetched", 0)
inserted1 = pull1.get("inserted", 0)
updated1 = pull1.get("updated", 0)
ok("fetched >= 1", fetched1 >= 1, f"fetched={fetched1}")
ok("inserted + updated >= 1", (inserted1 + updated1) >= 1,
   f"inserted={inserted1} updated={updated1}")
ok("place_name contains 'Sagar Joshi'",
   "sagar joshi" in (pull1.get("place_name") or "").lower(),
   f"place_name={pull1.get('place_name')!r}")
ok("rating returned (numeric)",
   isinstance(pull1.get("rating"), (int, float)),
   f"rating={pull1.get('rating')!r}")
ok("total_ratings returned (int)",
   isinstance(pull1.get("total_ratings"), int),
   f"total_ratings={pull1.get('total_ratings')!r}")

# Now confirm in GET /api/featured-reviews/all
r = requests.get(f"{BASE}/api/featured-reviews/all", headers=H_OWNER, timeout=20)
ok("GET /api/featured-reviews/all → 200", r.status_code == 200)
all_body = r.json() if r.status_code == 200 else {}
items = all_body.get("items") or []
google_items = [x for x in items if x.get("source") == "google"]
ok("featured-reviews/all has >= 1 google source item",
   len(google_items) >= 1, f"count={len(google_items)}")
new_google_items = [x for x in google_items if x.get("google_review_id") not in pre_existing_gids]
relevant_items = new_google_items if new_google_items else google_items
all_unfeatured = all(x.get("featured") is False for x in relevant_items)
ok("all google reviews have featured=False (curate explicitly)",
   all_unfeatured, f"featured-values={[x.get('featured') for x in relevant_items]}")
all_with_gid = all(bool(x.get("google_review_id")) for x in relevant_items)
ok("all google reviews have google_review_id populated", all_with_gid)

# ─────────────────────────────────────────────────────────────────
print("\n── TEST 4: POST /api/featured-reviews/pull-google (second run = idempotence) ──")
time.sleep(0.4)
r = requests.post(
    f"{BASE}/api/featured-reviews/pull-google",
    headers=H_OWNER,
    data=json.dumps({}),
    timeout=45,
)
ok("pull-google #2 → 200", r.status_code == 200, f"status={r.status_code}")
pull2 = r.json() if r.status_code == 200 else {}
inserted2 = pull2.get("inserted", -1)
updated2 = pull2.get("updated", -1)
print(f"  pull #2: fetched={pull2.get('fetched')} inserted={inserted2} updated={updated2}")
ok("second run inserted == 0 (idempotent)", inserted2 == 0, f"inserted={inserted2}")
ok("second run updated > 0", updated2 > 0, f"updated={updated2}")

# ─────────────────────────────────────────────────────────────────
print("\n── TEST 5: Error paths ──")
# 5a — invalid maps_url
r = requests.post(
    f"{BASE}/api/featured-reviews/resolve-place",
    headers=H_OWNER,
    data=json.dumps({"maps_url": INVALID_MAPS}),
    timeout=30,
)
print(f"  invalid maps_url → status={r.status_code} body={r.text[:300]}")
graceful = (
    r.status_code == 404
    or (r.status_code == 200 and not (r.json() or {}).get("place_id"))
)
ok("invalid maps_url → 404 OR 200 with empty place_id (graceful)",
   graceful, f"status={r.status_code}")

# 5b — pull-google without API key.
# Temporarily clear google_places_api_key on the owner's clinic doc.
print("  clearing google_places_api_key on clinic_settings (temp)…")
orig_doc = mdb["clinic_settings"].find_one({"_id": OWNER_CLINIC_ID})
orig_key = (orig_doc or {}).get("google_places_api_key", "")
mdb["clinic_settings"].update_one(
    {"_id": OWNER_CLINIC_ID},
    {"$set": {"google_places_api_key": ""}},
)
# Also clear on _id=default since _settings() falls back to default
# when the clinic doc lacks the field.
orig_default_doc = mdb["clinic_settings"].find_one({"_id": "default"})
orig_default_key = (orig_default_doc or {}).get("google_places_api_key", "")
mdb["clinic_settings"].update_one(
    {"_id": "default"},
    {"$set": {"google_places_api_key": ""}},
)

try:
    r = requests.post(
        f"{BASE}/api/featured-reviews/pull-google",
        headers=H_OWNER,
        data=json.dumps({}),
        timeout=30,
    )
    print(f"  no-key → status={r.status_code} body={r.text[:200]}")
    ok("pull-google without API key → 400", r.status_code == 400, f"status={r.status_code}")
    detail = ""
    try:
        detail = (r.json() or {}).get("detail", "")
    except Exception:
        pass
    ok("detail mentions 'API key'", "api key" in (detail or "").lower(),
       f"detail={detail!r}")
finally:
    # Restore
    print("  restoring google_places_api_key…")
    mdb["clinic_settings"].update_one(
        {"_id": OWNER_CLINIC_ID},
        {"$set": {"google_places_api_key": orig_key}},
    )
    mdb["clinic_settings"].update_one(
        {"_id": "default"},
        {"$set": {"google_places_api_key": orig_default_key}},
    )

# Verify restore took.
r = requests.get(f"{BASE}/api/clinic-settings",
                 headers={"X-Clinic-Id": OWNER_CLINIC_ID}, timeout=15)
cs2 = r.json() if r.status_code == 200 else {}
ok("after restore: google_places_api_key_set == true again",
   cs2.get("google_places_api_key_set") is True,
   f"actual={cs2.get('google_places_api_key_set')!r}")

# ─────────────────────────────────────────────────────────────────
print("\n══════ RESULTS ══════")
print(f"PASS: {len(PASSES)}")
print(f"FAIL: {len(FAILS)}")
if FAILS:
    print("FAILURES:")
    for f in FAILS:
        print(f"  - {f}")
    sys.exit(1)
print("ALL PASS ✅")
