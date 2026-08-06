#!/usr/bin/env python3
"""Phase 5.18 — Delete-resilience + twin-fetch Google Pull smoke test.

Verifies:
1. DELETE fallback (3-level) — id+clinic_id miss → id+default miss → id-only hit.
2. DELETE 404 for truly bogus id.
3. DELETE normal scope (clinic_id=default) — 200.
4. Twin-fetch POST /api/featured-reviews/pull-google — fetched >=5,
   place_name contains 'Sagar Joshi', total_ratings >=30,
   google_api_cap_note string present, idempotency on second call.
5. Public GET /api/featured-reviews — sorted by review_date DESC,
   all items have non-empty text.
"""
import os, sys, json, subprocess
import requests

BASE = "http://localhost:8001"
TOKEN = os.environ.get("OWNER_TOKEN", "test_session_smoke_1780988889522")
H = {"Authorization": f"Bearer {TOKEN}"}

results = []
def rec(name, ok, info=""):
    tag = "✅" if ok else "❌"
    results.append((ok, name, info))
    print(f"{tag} {name}{(' — ' + info) if info else ''}")

def mongo(js):
    """Run a mongosh snippet and return stdout."""
    out = subprocess.run(
        ["mongosh", "--quiet", "--eval", js],
        capture_output=True, text=True, timeout=20,
    )
    return out.stdout.strip(), out.stderr.strip()

# ───────────── 0. Sanity ─────────────
r = requests.get(f"{BASE}/api/auth/me", headers=H, timeout=10)
rec("auth/me 200 with owner token", r.status_code == 200, f"status={r.status_code}")
if r.status_code == 200:
    j = r.json()
    rec("owner role=primary_owner", j.get("role") == "primary_owner", f"role={j.get('role')}")

# ───────────── BEFORE pull-google: capture starting count ─────────────
r = requests.get(f"{BASE}/api/featured-reviews", timeout=10)
start_count = r.json().get("count", 0)
print(f"\nℹ️  Starting public review count: {start_count}\n")

# ───────────── 1. Delete fallback — clinic_id drift ─────────────
print("── TEST 1: Delete fallback (clinic_id=WRONG_CLINIC_XYZ) ──")
mongo("""
db = db.getSiblingDB('consulturo');
db.featured_reviews.deleteOne({id:'test-fallback-row'});
db.featured_reviews.insertOne({
  id: 'test-fallback-row',
  clinic_id: 'WRONG_CLINIC_XYZ',
  reviewer_name: 'Test User Fallback',
  rating: 5,
  text: 'smoke test fallback',
  source: 'manual',
  featured: true,
  review_date: '2026-06-09',
  created_at: new Date(),
  updated_at: new Date(),
});
print('SEEDED');
""")
out, _ = mongo("db = db.getSiblingDB('consulturo'); print(db.featured_reviews.countDocuments({id:'test-fallback-row'}));")
rec("seed inserted (count==1)", out.strip().endswith("1"), f"count={out.strip()}")

r = requests.delete(f"{BASE}/api/featured-reviews/test-fallback-row", headers=H, timeout=10)
rec("DELETE drift-row → 200", r.status_code == 200, f"status={r.status_code} body={r.text[:120]}")
if r.status_code == 200:
    rec("response is {ok:true}", r.json().get("ok") is True, f"body={r.text}")

out, _ = mongo("db = db.getSiblingDB('consulturo'); print(db.featured_reviews.countDocuments({id:'test-fallback-row'}));")
rec("drift-row deleted from MongoDB", out.strip().endswith("0"), f"remaining_count={out.strip()}")

# ───────────── 2. DELETE 404 for bogus id ─────────────
print("\n── TEST 2: DELETE bogus id → 404 ──")
r = requests.delete(f"{BASE}/api/featured-reviews/totally-bogus-id-xyz", headers=H, timeout=10)
rec("DELETE bogus → 404", r.status_code == 404, f"status={r.status_code} body={r.text[:120]}")
if r.status_code == 404:
    try:
        rec("detail=='Review not found'", r.json().get("detail") == "Review not found", f"body={r.text}")
    except Exception:
        rec("detail parseable JSON", False, r.text[:100])

# ───────────── 3. Delete preserves normal scope (clinic_id=default) ─────────────
print("\n── TEST 3: Delete row with clinic_id=default ──")
mongo("""
db = db.getSiblingDB('consulturo');
db.featured_reviews.deleteOne({id:'test-default-row'});
db.featured_reviews.insertOne({
  id: 'test-default-row',
  clinic_id: 'default',
  reviewer_name: 'Default Scope User',
  rating: 5,
  text: 'smoke test default scope',
  source: 'manual',
  featured: true,
  review_date: '2026-06-09',
  created_at: new Date(),
  updated_at: new Date(),
});
print('SEEDED');
""")
out, _ = mongo("db = db.getSiblingDB('consulturo'); print(db.featured_reviews.countDocuments({id:'test-default-row'}));")
rec("default-row seeded", out.strip().endswith("1"), f"count={out.strip()}")

r = requests.delete(f"{BASE}/api/featured-reviews/test-default-row", headers=H, timeout=10)
rec("DELETE default-row → 200", r.status_code == 200, f"status={r.status_code} body={r.text[:120]}")

out, _ = mongo("db = db.getSiblingDB('consulturo'); print(db.featured_reviews.countDocuments({id:'test-default-row'}));")
rec("default-row removed", out.strip().endswith("0"), f"remaining_count={out.strip()}")

# ───────────── 4. Twin-fetch pull-google ─────────────
print("\n── TEST 4: POST /api/featured-reviews/pull-google (twin-fetch) ──")
r = requests.post(f"{BASE}/api/featured-reviews/pull-google", json={}, headers=H, timeout=30)
rec("pull-google → 200", r.status_code == 200, f"status={r.status_code} body={r.text[:300]}")
if r.status_code == 200:
    j = r.json()
    print(f"   Response keys: {list(j.keys())}")
    print(f"   fetched={j.get('fetched')}, inserted={j.get('inserted')}, updated={j.get('updated')}, skipped={j.get('skipped')}")
    print(f"   place_name={j.get('place_name')}, rating={j.get('rating')}, total_ratings={j.get('total_ratings')}")
    rec(
        f"fetched >= 5 (got {j.get('fetched')})",
        isinstance(j.get("fetched"), int) and j["fetched"] >= 5,
        f"fetched={j.get('fetched')}",
    )
    rec(
        "fetched > 5 (twin-fetch widened set)",
        isinstance(j.get("fetched"), int) and j["fetched"] > 5,
        f"fetched={j.get('fetched')} (typical twin-fetch returns 6-10)",
    )
    pn = (j.get("place_name") or "")
    rec(
        "place_name contains 'Sagar Joshi'",
        "Sagar Joshi" in pn,
        f"place_name='{pn}'",
    )
    rec(
        "total_ratings >= 30",
        isinstance(j.get("total_ratings"), int) and j["total_ratings"] >= 30,
        f"total_ratings={j.get('total_ratings')}",
    )
    note = j.get("google_api_cap_note")
    rec(
        "google_api_cap_note present",
        isinstance(note, str) and len(note) > 0,
        f"note='{(note or '')[:80]}{'...' if note and len(note)>80 else ''}'",
    )
    rec(
        "google_api_cap_note explains ~10-per-pull cap",
        isinstance(note, str) and ("10" in note or "5 newest" in note or "5 most-relevant" in note),
        f"note='{(note or '')[:120]}'",
    )
    fetched = j.get("fetched") or 0
    inserted = j.get("inserted") or 0
    updated = j.get("updated") or 0
    skipped = j.get("skipped") or 0
    rec(
        "inserted + updated >= fetched - skipped",
        (inserted + updated) >= (fetched - skipped),
        f"i={inserted} + u={updated} >= f={fetched} - s={skipped}",
    )

# ───────────── 4b. Idempotency (call again — no duplicates) ─────────────
print("\n── TEST 4b: pull-google idempotency (second call) ──")
r2 = requests.post(f"{BASE}/api/featured-reviews/pull-google", json={}, headers=H, timeout=30)
rec("2nd pull-google → 200", r2.status_code == 200, f"status={r2.status_code}")
if r2.status_code == 200:
    j2 = r2.json()
    print(f"   2nd: fetched={j2.get('fetched')}, inserted={j2.get('inserted')}, updated={j2.get('updated')}, skipped={j2.get('skipped')}")
    rec(
        "2nd call: inserted == 0 (no duplicates)",
        j2.get("inserted") == 0,
        f"inserted={j2.get('inserted')}",
    )
    rec(
        "2nd call: updated >= 1",
        isinstance(j2.get("updated"), int) and j2["updated"] >= 1,
        f"updated={j2.get('updated')}",
    )

# ───────────── 5. Public sanity ─────────────
print("\n── TEST 5: Public GET /api/featured-reviews ──")
r = requests.get(f"{BASE}/api/featured-reviews", timeout=10)
rec("GET (public, no auth) → 200", r.status_code == 200, f"status={r.status_code}")
if r.status_code == 200:
    j = r.json()
    items = j.get("items") or []
    print(f"   public count: {j.get('count')} (was {start_count} before)")
    rec(
        "all items have non-empty text",
        all(isinstance(it.get("text"), str) and it["text"].strip() for it in items),
        f"items={len(items)}",
    )
    # Sorted by review_date DESC
    dates = [it.get("review_date") or "" for it in items]
    sorted_desc = all(dates[i] >= dates[i+1] for i in range(len(dates)-1))
    rec(
        "items sorted by review_date DESC",
        sorted_desc,
        f"first 3 dates={dates[:3]}",
    )
    rec(
        "public count >= prior count (no regression)",
        (j.get("count") or 0) >= start_count,
        f"now={j.get('count')} prior={start_count}",
    )

# ───────────── Cleanup any test rows still around ─────────────
mongo("""
db = db.getSiblingDB('consulturo');
var d1 = db.featured_reviews.deleteMany({id:{$in:['test-fallback-row','test-default-row']}}).deletedCount;
print('cleanup_deleted=' + d1);
""")

# ───────────── Summary ─────────────
passed = sum(1 for r in results if r[0])
total = len(results)
print(f"\n══════════════════════════════════════════")
print(f"  RESULT: {passed}/{total} assertions PASS")
print(f"══════════════════════════════════════════")
if passed != total:
    print("\nFAILED ASSERTIONS:")
    for ok, name, info in results:
        if not ok:
            print(f"  ❌ {name} — {info}")
    sys.exit(1)
sys.exit(0)
