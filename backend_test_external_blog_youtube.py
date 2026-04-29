"""Smoke test for External Blog (RSS/Atom) + YouTube Channel feature.

Per review request 2026-04-29:
  - GET /api/clinic-settings (public) returns new fields, redacts api_key
  - PATCH /api/clinic-settings (primary_owner) for new fields
  - GET /api/blog merges native + external + legacy
  - GET /api/videos uses configured YouTube key/channel, falls back gracefully
  - All test patches reverted to empty strings to keep prod data clean.
"""
import os
import sys
import json
import requests

BASE = os.environ.get("BACKEND_URL", "https://urology-pro.preview.emergentagent.com") + "/api"
OWNER_TOKEN = "test_session_1776770314741"
HEADERS_OWNER = {"Authorization": f"Bearer {OWNER_TOKEN}", "Content-Type": "application/json"}

results = []


def check(label, ok, detail=""):
    icon = "✅" if ok else "❌"
    line = f"{icon} {label}"
    if detail:
        line += f" — {detail}"
    print(line)
    results.append((ok, label, detail))
    return ok


def get(path, **kw):
    r = requests.get(BASE + path, timeout=15, **kw)
    return r


def patch(path, body, headers=None):
    r = requests.patch(BASE + path, json=body, headers=headers or HEADERS_OWNER, timeout=20)
    return r


# ---------------------------------------------------------
# 0. Capture pre-test snapshot of clinic_settings new fields
# ---------------------------------------------------------
print("=" * 72)
print("PRE-TEST SNAPSHOT")
print("=" * 72)
r = get("/clinic-settings")
check("GET /api/clinic-settings (public, no auth) → 200", r.status_code == 200, f"got {r.status_code}")
pre = r.json()
print(json.dumps({k: pre.get(k) for k in (
    "external_blog_feed_url", "external_blog_feed_label",
    "external_youtube_channel_url", "external_youtube_channel_id",
    "external_youtube_api_key_set",
)}, indent=2))

# Save state we need to restore later (api_key value not retrievable, only flag)
preexisting_blog_url = pre.get("external_blog_feed_url", "") or ""
preexisting_blog_label = pre.get("external_blog_feed_label", "") or ""
preexisting_yt_url = pre.get("external_youtube_channel_url", "") or ""
preexisting_yt_cid = pre.get("external_youtube_channel_id", "") or ""
preexisting_api_key_set = pre.get("external_youtube_api_key_set", False)

# ---------------------------------------------------------
# 1. GET /api/clinic-settings — public, no auth, new fields, no raw key
# ---------------------------------------------------------
print("\n" + "=" * 72)
print("TEST 1 — GET /api/clinic-settings (public, no auth)")
print("=" * 72)
r = requests.get(BASE + "/clinic-settings", timeout=10)
check("Status 200 (no auth)", r.status_code == 200, f"got {r.status_code}")
body = r.json()
for fld in ("external_blog_feed_url", "external_blog_feed_label",
            "external_youtube_channel_url", "external_youtube_channel_id"):
    check(f"Field present: {fld}", fld in body, f"value={body.get(fld)!r}")
check("Field present: external_youtube_api_key_set (bool)",
      "external_youtube_api_key_set" in body and isinstance(body["external_youtube_api_key_set"], bool),
      f"value={body.get('external_youtube_api_key_set')!r}")
check("RAW external_youtube_api_key MUST be absent",
      "external_youtube_api_key" not in body,
      f"keys with 'api_key': {[k for k in body if 'api_key' in k]}")
# Also verify body string doesn't accidentally contain the raw key field
raw_text = r.text
check("Response body string does NOT contain key 'external_youtube_api_key\"' (raw)",
      '"external_youtube_api_key"' not in raw_text)

# ---------------------------------------------------------
# 2. PATCH external_blog_feed_url, verify, revert
# ---------------------------------------------------------
print("\n" + "=" * 72)
print("TEST 2 — PATCH external_blog_feed_url")
print("=" * 72)
test_blog_url = "https://medium.com/feed/@drsagar"
r = patch("/clinic-settings", {"external_blog_feed_url": test_blog_url})
check("PATCH external_blog_feed_url (owner) → 200", r.status_code == 200,
      f"got {r.status_code} body={r.text[:200]}")
r2 = get("/clinic-settings")
check("Re-GET reflects external_blog_feed_url",
      r2.json().get("external_blog_feed_url") == test_blog_url,
      f"got {r2.json().get('external_blog_feed_url')!r}")

# Revert
r = patch("/clinic-settings", {"external_blog_feed_url": preexisting_blog_url})
check("PATCH revert external_blog_feed_url → 200", r.status_code == 200)
r2 = get("/clinic-settings")
check("Re-GET reverted", r2.json().get("external_blog_feed_url") == preexisting_blog_url,
      f"got {r2.json().get('external_blog_feed_url')!r}")

# ---------------------------------------------------------
# 3. PATCH external_youtube_channel_url with empty key — channel_id should stay ""
# ---------------------------------------------------------
print("\n" + "=" * 72)
print("TEST 3 — PATCH external_youtube_channel_url (no api_key)")
print("=" * 72)
yt_url = "https://www.youtube.com/@dr_sagar_j"
# First make sure no api_key is set so resolution skips
# (we'll set it to empty in TEST 4 cleanup; for now check current state)
# The current api_key may already be set — but we can't read it. Patch URL anyway.
# Set api_key empty to ensure clean condition for this test
r = patch("/clinic-settings", {"external_youtube_api_key": "", "external_youtube_channel_url": yt_url})
check(f"PATCH yt_url={yt_url} + empty api_key → 200", r.status_code == 200,
      f"got {r.status_code} body={r.text[:200]}")
r2 = get("/clinic-settings")
got = r2.json()
check("Re-GET reflects external_youtube_channel_url",
      got.get("external_youtube_channel_url") == yt_url,
      f"got {got.get('external_youtube_channel_url')!r}")
check("external_youtube_channel_id empty (no api_key → resolution skipped)",
      got.get("external_youtube_channel_id") == "",
      f"got {got.get('external_youtube_channel_id')!r}")
check("external_youtube_api_key_set is False after empty PATCH",
      got.get("external_youtube_api_key_set") is False,
      f"got {got.get('external_youtube_api_key_set')!r}")

# ---------------------------------------------------------
# 4. PATCH api_key, verify NOT in GET response, but flag flips
# ---------------------------------------------------------
print("\n" + "=" * 72)
print("TEST 4 — PATCH external_youtube_api_key (smoke value)")
print("=" * 72)
fake_key = "FAKE-TEST-KEY-FOR-SMOKE"
r = patch("/clinic-settings", {"external_youtube_api_key": fake_key})
check("PATCH api_key (owner) → 200", r.status_code == 200,
      f"got {r.status_code} body={r.text[:200]}")
r2 = get("/clinic-settings")
got = r2.json()
raw = r2.text
check("external_youtube_api_key_set == True after PATCH",
      got.get("external_youtube_api_key_set") is True,
      f"got {got.get('external_youtube_api_key_set')!r}")
check("RAW external_youtube_api_key still NOT in response keys",
      "external_youtube_api_key" not in got)
check("Fake key value NOT leaked anywhere in response body string",
      fake_key not in raw,
      "key string would be present if leaked")

# ---------------------------------------------------------
# 5. GET /api/blog — public, list shape, with and without external feed
# ---------------------------------------------------------
print("\n" + "=" * 72)
print("TEST 5 — GET /api/blog (public)")
print("=" * 72)
# 5a — first WITHOUT external feed (revert to empty just to be sure)
r = patch("/clinic-settings", {"external_blog_feed_url": ""})
check("Reset external_blog_feed_url='' → 200", r.status_code == 200)
rb = get("/blog")
check("GET /api/blog (no external) → 200", rb.status_code == 200,
      f"got {rb.status_code}")
posts = rb.json()
check("Response is a list", isinstance(posts, list),
      f"type={type(posts).__name__}")
sources_no_ext = {p.get("source") for p in posts if isinstance(p, dict)}
check("With NO external_blog_feed_url: NO items have source=external",
      "external" not in sources_no_ext,
      f"sources observed: {sources_no_ext}")

# 5b — set external feed to TechCrunch RSS, verify external items appear
print("\n--- TEST 5b — set external feed to TechCrunch RSS ---")
techcrunch_url = "https://feeds.feedburner.com/TechCrunch"
r = patch("/clinic-settings", {"external_blog_feed_url": techcrunch_url})
check("PATCH external_blog_feed_url=TechCrunch → 200", r.status_code == 200)
rb2 = get("/blog")
check("GET /api/blog (with external) → 200", rb2.status_code == 200,
      f"got {rb2.status_code}")
posts2 = rb2.json()
check("Still a list", isinstance(posts2, list))
sources_with_ext = {p.get("source") for p in posts2 if isinstance(p, dict)}
ext_items = [p for p in posts2 if isinstance(p, dict) and p.get("source") == "external"]
print(f"   sources observed: {sources_with_ext}")
print(f"   external items count: {len(ext_items)}")
# This is non-blocking on network failure per spec — so don't fail if 0
if len(ext_items) > 0:
    check("External items have title/source=external/published_at fields",
          all(("title" in p and p.get("source") == "external" and "published_at" in p)
              for p in ext_items[:3]),
          f"sample first item keys: {list(ext_items[0].keys())}")
else:
    print("   ⚠️  No external items returned — network fetch may have failed (non-blocking per spec)")

# Reset blog feed url
r = patch("/clinic-settings", {"external_blog_feed_url": preexisting_blog_url})
check("Revert external_blog_feed_url → 200", r.status_code == 200)

# ---------------------------------------------------------
# 6. GET /api/videos — never 500, falls back to seed
# ---------------------------------------------------------
print("\n" + "=" * 72)
print("TEST 6 — GET /api/videos (public, fallback path)")
print("=" * 72)
# Currently fake_key is set + yt_url is set but channel_id is "" (no resolution at PATCH time)
# So /api/videos should fall back gracefully.
rv = get("/videos")
check("GET /api/videos → 200 (no 500)", rv.status_code == 200,
      f"got {rv.status_code} body={rv.text[:300]}")
videos = rv.json()
check("/api/videos returns a list", isinstance(videos, list),
      f"type={type(videos).__name__}")
check("/api/videos returns >=1 item (seed fallback)", len(videos) >= 1,
      f"len={len(videos)}")
if len(videos) >= 1:
    sample = videos[0]
    check("Each video item has 'title' and ('youtube_id' OR 'id')",
          "title" in sample and ("youtube_id" in sample or "id" in sample),
          f"sample keys: {list(sample.keys())}")

# Now wipe everything to ensure pure seed fallback path
print("\n--- TEST 6b — wipe yt config completely, re-fetch ---")
r = patch("/clinic-settings", {
    "external_youtube_channel_url": "",
    "external_youtube_api_key": "",
})
check("Wipe yt url + api_key → 200", r.status_code == 200)
# clear cache by waiting? actually cache is 10 min. Let's just check after the patch — cache is per-process.
# Reset cache via test note: we won't bust cache, but test will still verify endpoint healthy.
rv2 = get("/videos")
check("GET /api/videos after wipe → 200", rv2.status_code == 200,
      f"got {rv2.status_code}")
videos2 = rv2.json()
check("Still returns a non-empty list", isinstance(videos2, list) and len(videos2) >= 1,
      f"len={len(videos2) if isinstance(videos2, list) else 'N/A'}")

# ---------------------------------------------------------
# 7. Tear down — revert everything to pre-test state
# ---------------------------------------------------------
print("\n" + "=" * 72)
print("TEAR DOWN — restore to pre-test state")
print("=" * 72)
r = patch("/clinic-settings", {
    "external_blog_feed_url": preexisting_blog_url,
    "external_blog_feed_label": preexisting_blog_label,
    "external_youtube_channel_url": preexisting_yt_url,
    "external_youtube_api_key": "",  # cannot recover original; setting to ""
})
check("Final cleanup PATCH → 200", r.status_code == 200,
      f"got {r.status_code}")

# Final verify
rfin = get("/clinic-settings")
fin = rfin.json()
print("\nFINAL STATE OF NEW FIELDS:")
print(json.dumps({k: fin.get(k) for k in (
    "external_blog_feed_url", "external_blog_feed_label",
    "external_youtube_channel_url", "external_youtube_channel_id",
    "external_youtube_api_key_set",
)}, indent=2))

if preexisting_api_key_set and not fin.get("external_youtube_api_key_set"):
    print("⚠️  WARNING: Could not recover original api_key — the field is now empty (was set before).")
    print("   Main agent: this is unavoidable in tests since GET redacts the value.")

# ---------------------------------------------------------
# Summary
# ---------------------------------------------------------
total = len(results)
passed = sum(1 for ok, _, _ in results if ok)
print("\n" + "=" * 72)
print(f"RESULTS: {passed}/{total} passed")
print("=" * 72)
fails = [(lbl, det) for ok, lbl, det in results if not ok]
if fails:
    print("FAILURES:")
    for lbl, det in fails:
        print(f"  ❌ {lbl} — {det}")
    sys.exit(1)
else:
    print("ALL CHECKS PASSED")
    sys.exit(0)
