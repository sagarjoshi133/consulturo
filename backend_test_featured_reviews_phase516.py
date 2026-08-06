"""Phase 5.16 — Featured Reviews smoke test.

Verifies the /api/featured-reviews public + owner endpoints per the
spec: text-only filter, Google rating sync, owner-override preservation,
auto-pull cooldown and no API-key leakage.
"""
import json
import os
import subprocess
import time
from typing import Any, Dict

import requests

BASE = "http://localhost:8001"
OWNER_TOKEN = "test_session_1776770314741"
PASS, FAIL = [], []


def _check(label: str, ok: bool, detail: str = ""):
    (PASS if ok else FAIL).append(f"{'PASS' if ok else 'FAIL'}: {label}" + (f" — {detail}" if detail else ""))
    marker = "✅" if ok else "❌"
    print(f"  {marker} {label}" + (f" — {detail}" if detail else ""))


def _h(owner=False):
    return {"Authorization": f"Bearer {OWNER_TOKEN}"} if owner else {}


def _mongo(js: str) -> str:
    """Run a mongosh eval and return stdout."""
    cmd = ["mongosh", "--quiet", "--eval", js]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    return r.stdout.strip()


# ──────────────────────────────────────────────────────────────────
print("\n=== TEST 1 — GET /api/featured-reviews (public)")
r = requests.get(f"{BASE}/api/featured-reviews", timeout=30)
_check("HTTP 200", r.status_code == 200, f"got {r.status_code}")
body = r.json()
items = body.get("items", [])
count = body.get("count")
_check("count >= 5", isinstance(count, int) and count >= 5, f"count={count}")
_check("count matches items length", count == len(items), f"count={count} items={len(items)}")
# Every text non-empty
all_text = all(isinstance(it.get("text"), str) and it["text"].strip() for it in items)
_check("every item has non-empty text", all_text)
# Every rating is int 1..5
ratings_ok = all(isinstance(it.get("rating"), int) and 1 <= it["rating"] <= 5 for it in items)
_check("every rating int in [1,5]", ratings_ok,
       f"ratings={[it.get('rating') for it in items]}")
# Sorted by review_date DESC
dates = [it.get("review_date") for it in items if it.get("review_date")]
sorted_desc = dates == sorted(dates, reverse=True)
_check("sorted by review_date DESC", sorted_desc,
       f"first 5 = {dates[:5]}")
# Spot check at least one 5★ that comes from Google source
five_star_google = [it for it in items if it.get("rating") == 5 and it.get("source") == "google"]
_check("at least one rating==5 from Google source", len(five_star_google) >= 1,
       f"count={len(five_star_google)}")
if five_star_google:
    sample = five_star_google[0]
    print(f"     sample 5★: reviewer={sample.get('reviewer_name')!r}, "
          f"date={sample.get('review_date')}, "
          f"text[:60]={(sample.get('text') or '')[:60]!r}")

# ──────────────────────────────────────────────────────────────────
print("\n=== TEST 2 — GET /api/featured-reviews/cta (public)")
r = requests.get(f"{BASE}/api/featured-reviews/cta", timeout=10)
_check("HTTP 200", r.status_code == 200, f"got {r.status_code}")
cta = r.json()
print(f"     keys: {list(cta.keys())}")
print(f"     google_rating={cta.get('google_rating')}, "
      f"google_total_ratings={cta.get('google_total_ratings')}, "
      f"google_place_name={cta.get('google_place_name')}")
_check("google_rating is float close to ~4.8",
       isinstance(cta.get("google_rating"), (int, float))
       and 4.0 <= float(cta["google_rating"]) <= 5.0,
       f"value={cta.get('google_rating')}")
_check("google_total_ratings is int > 0",
       isinstance(cta.get("google_total_ratings"), int) and cta["google_total_ratings"] > 0,
       f"value={cta.get('google_total_ratings')}")
_check("google_place_name includes 'Sagar Joshi'",
       "Sagar Joshi" in (cta.get("google_place_name") or ""),
       f"value={cta.get('google_place_name')!r}")
_check("enabled present (bool)", isinstance(cta.get("enabled"), bool), f"value={cta.get('enabled')}")
_check("review_url non-empty", bool((cta.get("review_url") or "").strip()),
       f"value={cta.get('review_url')[:60] if cta.get('review_url') else 'EMPTY'}")
_check("maps_url non-empty", bool((cta.get("maps_url") or "").strip()))
_check("qr_svg_b64 non-empty",
       isinstance(cta.get("qr_svg_b64"), str) and len(cta["qr_svg_b64"]) > 100,
       f"len={len(cta.get('qr_svg_b64') or '')}")
_check("tagline non-empty",
       isinstance(cta.get("tagline"), str) and bool(cta["tagline"].strip()))
# CRITICAL — google_places_api_key should NOT be leaked.
_check("google_places_api_key NOT leaked in /cta",
       "google_places_api_key" not in cta)

# ──────────────────────────────────────────────────────────────────
print("\n=== TEST 3 — GET /api/featured-reviews?featured_only=1 (public)")
r = requests.get(f"{BASE}/api/featured-reviews?featured_only=1", timeout=20)
_check("HTTP 200", r.status_code == 200, f"got {r.status_code}")
body_fo = r.json()
items_fo = body_fo.get("items", [])
_check("featured_only returns 10 reviews",
       len(items_fo) == 10, f"got {len(items_fo)}")
_check("every featured_only item has text",
       all(isinstance(it.get("text"), str) and it["text"].strip() for it in items_fo))

# ──────────────────────────────────────────────────────────────────
print("\n=== TEST 4 — POST /api/featured-reviews/pull-google (owner) + clinic-settings cache")
r = requests.post(f"{BASE}/api/featured-reviews/pull-google", json={}, headers=_h(True), timeout=30)
_check("pull-google HTTP 200", r.status_code == 200, f"got {r.status_code}, body={r.text[:200]}")
if r.status_code == 200:
    pull = r.json()
    print(f"     pull response keys: {list(pull.keys())}")
    print(f"     fetched={pull.get('fetched')}, inserted={pull.get('inserted')}, "
          f"updated={pull.get('updated')}, skipped={pull.get('skipped')}, "
          f"place_name={pull.get('place_name')}")
    _check("inserted >= 0", isinstance(pull.get("inserted"), int) and pull["inserted"] >= 0)
    _check("updated >= 0", isinstance(pull.get("updated"), int) and pull["updated"] >= 0)
    _check("place_name contains 'Sagar Joshi'",
           "Sagar Joshi" in (pull.get("place_name") or ""),
           f"value={pull.get('place_name')!r}")

# Now GET /api/clinic-settings and verify cache fields + no API-key leakage.
r = requests.get(f"{BASE}/api/clinic-settings", timeout=10)
_check("/api/clinic-settings HTTP 200", r.status_code == 200, f"got {r.status_code}")
cs = r.json()
_check("clinic_settings.google_rating present",
       cs.get("google_rating") is not None, f"value={cs.get('google_rating')}")
_check("clinic_settings.google_total_ratings present",
       cs.get("google_total_ratings") is not None,
       f"value={cs.get('google_total_ratings')}")
_check("clinic_settings.google_place_name present",
       bool((cs.get("google_place_name") or "").strip()),
       f"value={cs.get('google_place_name')!r}")
_check("clinic_settings.google_reviews_last_pulled_at present",
       bool((cs.get("google_reviews_last_pulled_at") or "").strip()),
       f"value={cs.get('google_reviews_last_pulled_at')!r}")
_check("google_places_api_key NOT leaked in /clinic-settings",
       "google_places_api_key" not in cs,
       f"present_keys_matching=api_key={'google_places_api_key' in cs}")
_check("google_places_api_key_set flag present (boolean)",
       isinstance(cs.get("google_places_api_key_set"), bool),
       f"value={cs.get('google_places_api_key_set')}")

# ──────────────────────────────────────────────────────────────────
print("\n=== TEST 5 — Auto-feature + text filter (insert/update/delete synthetic row)")
_mongo("""
db = db.getSiblingDB('consulturo');
db.featured_reviews.deleteOne({id:'test-empty'});
db.featured_reviews.insertOne({
  id:'test-empty', clinic_id:'default', source:'manual', rating:5,
  text:'', featured:true, review_date:'2026-06-04'
});
""")
r = requests.get(f"{BASE}/api/featured-reviews", timeout=20)
items_no_empty = r.json().get("items", [])
empty_present = any(it.get("id") == "test-empty" for it in items_no_empty)
_check("empty-text row NOT in /featured-reviews", not empty_present)

# Now update text and re-check.
_mongo("""
db = db.getSiblingDB('consulturo');
db.featured_reviews.updateOne({id:'test-empty'}, {$set:{text:'Great clinic!'}});
""")
r = requests.get(f"{BASE}/api/featured-reviews", timeout=20)
items_with_text = r.json().get("items", [])
filled_present = any(it.get("id") == "test-empty" for it in items_with_text)
_check("filled-text row now appears in /featured-reviews", filled_present)

# Cleanup.
_mongo("""
db = db.getSiblingDB('consulturo');
db.featured_reviews.deleteOne({id:'test-empty'});
""")
r = requests.get(f"{BASE}/api/featured-reviews", timeout=20)
items_post_cleanup = r.json().get("items", [])
_check("test-empty cleaned up",
       not any(it.get("id") == "test-empty" for it in items_post_cleanup))

# ──────────────────────────────────────────────────────────────────
print("\n=== TEST 6 — Owner override preservation across re-pull")
# Get current Google reviews.
r = requests.get(f"{BASE}/api/featured-reviews/all", headers=_h(True), timeout=15)
_check("GET /featured-reviews/all (owner) 200", r.status_code == 200)
all_rows = r.json().get("items", [])
google_rows = [it for it in all_rows if it.get("source") == "google"]
_check("found at least 1 google review for override test", len(google_rows) >= 1)
target = google_rows[0] if google_rows else None
target_id = target["id"] if target else None
target_name = target.get("reviewer_name") if target else "?"
print(f"     target review id={target_id}, reviewer={target_name}")

if target_id:
    # PATCH featured:false
    r = requests.patch(
        f"{BASE}/api/featured-reviews/{target_id}",
        json={"featured": False},
        headers=_h(True),
        timeout=10,
    )
    _check("PATCH featured:false HTTP 200", r.status_code == 200, f"got {r.status_code}")
    after = r.json()
    _check("after PATCH, featured == false", after.get("featured") is False,
           f"value={after.get('featured')}")
    # Re-run pull-google
    r = requests.post(f"{BASE}/api/featured-reviews/pull-google", json={}, headers=_h(True), timeout=30)
    _check("re-run pull-google HTTP 200", r.status_code == 200, f"got {r.status_code}")
    # Fetch the row again.
    r = requests.get(f"{BASE}/api/featured-reviews/all", headers=_h(True), timeout=15)
    after_rows = r.json().get("items", [])
    after_row = next((it for it in after_rows if it.get("id") == target_id), None)
    _check("override-target row still present after re-pull", after_row is not None)
    if after_row:
        _check("featured:false override preserved across re-pull",
               after_row.get("featured") is False,
               f"value={after_row.get('featured')}")
    # Restore.
    r = requests.patch(
        f"{BASE}/api/featured-reviews/{target_id}",
        json={"featured": True},
        headers=_h(True),
        timeout=10,
    )
    _check("restore featured:true HTTP 200", r.status_code == 200)

# ──────────────────────────────────────────────────────────────────
print("\n=== TEST 7 — Cooldown check (2 rapid GETs)")
# First call (may pull google)
t0 = time.perf_counter()
r1 = requests.get(f"{BASE}/api/featured-reviews", timeout=30)
t1 = time.perf_counter() - t0
_check("call #1 HTTP 200", r1.status_code == 200)
# Second call should hit the cooldown path (no Google round-trip).
t0 = time.perf_counter()
r2 = requests.get(f"{BASE}/api/featured-reviews", timeout=30)
t2 = time.perf_counter() - t0
_check("call #2 HTTP 200", r2.status_code == 200)
print(f"     call #1 took {t1*1000:.1f}ms, call #2 took {t2*1000:.1f}ms")
_check("call #2 < 200ms (cooldown saved Google round-trip)",
       t2 < 0.200, f"actual={t2*1000:.1f}ms")
_check("neither call 5xx",
       r1.status_code < 500 and r2.status_code < 500)

# ──────────────────────────────────────────────────────────────────
print("\n=========================================================")
print(f"  PASS={len(PASS)}  FAIL={len(FAIL)}")
print("=========================================================")
if FAIL:
    print("\nFAILURES:")
    for f in FAIL:
        print(" ", f)
