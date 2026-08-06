"""Phase 5.17 — Google Places: manual Place ID + duplicate-listing safety net.

Tests POST /api/featured-reviews/resolve-place + persistence on accept.
"""
from __future__ import annotations

import json
import os
import sys
import time

import requests

BASE = "http://localhost:8001"
OWNER = "test_session_phase517_1780986401676"
HEADERS = {"Authorization": f"Bearer {OWNER}", "Content-Type": "application/json"}

passed = 0
failed = 0


def check(label: str, cond: bool, detail: str = "") -> None:
    global passed, failed
    if cond:
        passed += 1
        print(f"  ✅ {label}")
    else:
        failed += 1
        print(f"  ❌ {label} :: {detail}")


def post(path: str, body: dict) -> tuple[int, dict | str]:
    r = requests.post(f"{BASE}{path}", headers=HEADERS, json=body, timeout=30)
    try:
        return r.status_code, r.json()
    except Exception:
        return r.status_code, r.text


def get(path: str) -> tuple[int, dict | str]:
    r = requests.get(f"{BASE}{path}", headers=HEADERS, timeout=30)
    try:
        return r.status_code, r.json()
    except Exception:
        return r.status_code, r.text


def patch(path: str, body: dict) -> tuple[int, dict | str]:
    r = requests.patch(f"{BASE}{path}", headers=HEADERS, json=body, timeout=30)
    try:
        return r.status_code, r.json()
    except Exception:
        return r.status_code, r.text


# ── Snapshot the current Place ID so we can verify idempotency. ─────
status_pre, payload_pre = get("/api/clinic-settings")
print(f"\nPRE-STATE: clinic-settings → {status_pre}")
prev_place_id = (payload_pre or {}).get("google_places_place_id") if isinstance(payload_pre, dict) else None
print(f"  prev place_id: {prev_place_id}")


# ───────────────────────────────────────────────────────────────
# TEST 1 — Manual Place ID path (correct ChIJ id)
# ───────────────────────────────────────────────────────────────
print("\nTEST 1 — Manual Place ID (ChIJ8x5PeMfHXzkRTRJ-5w0zHyU)")
s1, p1 = post("/api/featured-reviews/resolve-place", {"place_id": "ChIJ8x5PeMfHXzkRTRJ-5w0zHyU"})
print(f"  status: {s1}")
print(f"  body: {json.dumps(p1, indent=2)[:600] if isinstance(p1, dict) else p1}")
check("HTTP 200", s1 == 200, f"got {s1}")
if isinstance(p1, dict):
    check("place_id == ChIJ8x5PeMfHXzkRTRJ-5w0zHyU", p1.get("place_id") == "ChIJ8x5PeMfHXzkRTRJ-5w0zHyU",
          f"got {p1.get('place_id')}")
    pname = p1.get("place_name") or ""
    check("place_name contains 'Sagar Joshi'", "Sagar Joshi" in pname, f"got '{pname}'")
    rating = p1.get("rating")
    check("rating ≈ 4.8", isinstance(rating, (int, float)) and 4.5 <= float(rating) <= 5.0,
          f"got {rating}")
    tot = p1.get("total_ratings")
    check("total_ratings >= 30", isinstance(tot, int) and tot >= 30, f"got {tot}")
    alts = p1.get("alternatives")
    check("alternatives is []", alts == [], f"got {alts}")


# ───────────────────────────────────────────────────────────────
# TEST 2 — Invalid manual Place ID
# ───────────────────────────────────────────────────────────────
print("\nTEST 2 — Invalid manual Place ID")
s2, p2 = post("/api/featured-reviews/resolve-place", {"place_id": "INVALID-PID-XYZ"})
print(f"  status: {s2}")
print(f"  body: {p2}")
check("Graceful failure (4xx or 502, not 5xx unhandled)",
      s2 in (400, 404, 502), f"got {s2}")
check("Response is JSON dict (no traceback leaked)",
      isinstance(p2, dict) and "detail" in p2, f"got {type(p2).__name__}")


# ───────────────────────────────────────────────────────────────
# TEST 3 — Duplicate-listing safety net
# ───────────────────────────────────────────────────────────────
print("\nTEST 3 — Duplicate-listing safety net")
s3, p3 = post(
    "/api/featured-reviews/resolve-place",
    {
        "maps_url": "https://maps.app.goo.gl/6V1htTccQGwdJf6C8",
        "query": "Dr Sagar Joshi Urologist Vadodara",
    },
)
print(f"  status: {s3}")
if isinstance(p3, dict):
    print(f"  place_id: {p3.get('place_id')}")
    print(f"  place_name: {p3.get('place_name')}")
    print(f"  total_ratings: {p3.get('total_ratings')}")
    print(f"  rating: {p3.get('rating')}")
    print(f"  alternatives count: {len(p3.get('alternatives') or [])}")
    for i, alt in enumerate((p3.get("alternatives") or [])[:5]):
        print(f"    alt[{i}]: pid={alt.get('place_id')} "
              f"total={alt.get('total_ratings')} name={alt.get('place_name')}")
else:
    print(f"  body: {p3}")

check("HTTP 200", s3 == 200, f"got {s3}")
if isinstance(p3, dict) and s3 == 200:
    pid_resolved = p3.get("place_id") or ""
    total_here = p3.get("total_ratings")
    check("resolved place_id starts with 'ChIJ'", pid_resolved.startswith("ChIJ"),
          f"got {pid_resolved}")
    check("resolved listing has 0 reviews (the duplicate)", total_here == 0,
          f"got total_ratings={total_here}")
    alts = p3.get("alternatives") or []
    check("alternatives non-empty (>=1)", len(alts) >= 1, f"got {len(alts)}")
    if alts:
        # Must include the canonical ChIJ8x5PeMfHXzkRTRJ-5w0zHyU
        ids = [a.get("place_id") for a in alts]
        check("alternatives include canonical ChIJ8x5PeMfHXzkRTRJ-5w0zHyU",
              "ChIJ8x5PeMfHXzkRTRJ-5w0zHyU" in ids, f"got {ids}")
        # Sorted DESC by total_ratings
        totals = [int(a.get("total_ratings") or 0) for a in alts]
        check("alternatives sorted DESC by total_ratings",
              totals == sorted(totals, reverse=True), f"got {totals}")
        check("first alt has total_ratings >= 30 (canonical 36-review listing)",
              totals[0] >= 30, f"got {totals[0]}")


# ───────────────────────────────────────────────────────────────
# TEST 4 — Idempotency / no-side-effects
# ───────────────────────────────────────────────────────────────
print("\nTEST 4 — Idempotency / no-side-effects after resolve-place calls")
s4, p4 = get("/api/clinic-settings")
print(f"  status: {s4}")
if isinstance(p4, dict):
    now_pid = p4.get("google_places_place_id")
    print(f"  current place_id: {now_pid}")
    check("clinic_settings.google_places_place_id UNCHANGED",
          now_pid == prev_place_id, f"prev={prev_place_id} now={now_pid}")


# ───────────────────────────────────────────────────────────────
# TEST 5 — Persistence on accept + pull-google
# ───────────────────────────────────────────────────────────────
print("\nTEST 5 — PATCH /api/clinic-settings + POST /api/featured-reviews/pull-google")
target_pid = "ChIJ8x5PeMfHXzkRTRJ-5w0zHyU"
s5a, p5a = patch("/api/clinic-settings", {"google_places_place_id": target_pid})
print(f"  PATCH status: {s5a}")
check("PATCH 200", s5a == 200, f"got {s5a}")

s5b, p5b = get("/api/clinic-settings")
if isinstance(p5b, dict):
    print(f"  GET after PATCH place_id: {p5b.get('google_places_place_id')}")
    check("GET reflects new place_id",
          p5b.get("google_places_place_id") == target_pid,
          f"got {p5b.get('google_places_place_id')}")

s5c, p5c = post("/api/featured-reviews/pull-google", {})
print(f"  pull-google status: {s5c}")
if isinstance(p5c, dict):
    print(f"  fetched={p5c.get('fetched')} inserted={p5c.get('inserted')} "
          f"updated={p5c.get('updated')} skipped={p5c.get('skipped')}")
    print(f"  place_name={p5c.get('place_name')} rating={p5c.get('rating')} "
          f"total_ratings={p5c.get('total_ratings')}")

check("pull-google HTTP 200", s5c == 200, f"got {s5c}")
if isinstance(p5c, dict) and s5c == 200:
    fetched = int(p5c.get("fetched") or 0)
    inserted = int(p5c.get("inserted") or 0)
    updated = int(p5c.get("updated") or 0)
    check("fetched >= 1", fetched >= 1, f"got {fetched}")
    check("inserted + updated >= 1", (inserted + updated) >= 1,
          f"got inserted={inserted} updated={updated}")
    pname = p5c.get("place_name") or ""
    check("place_name contains 'Sagar Joshi'", "Sagar Joshi" in pname, f"got '{pname}'")
    rating = p5c.get("rating")
    check("rating >= 4", isinstance(rating, (int, float)) and float(rating) >= 4,
          f"got {rating}")
    tot = p5c.get("total_ratings")
    check("total_ratings >= 30", isinstance(tot, int) and tot >= 30, f"got {tot}")


# ───────────────────────────────────────────────────────────────
# Backend error log check
# ───────────────────────────────────────────────────────────────
print("\nBACKEND ERROR LOG SCAN (since test start)")
import subprocess
err = subprocess.run(
    ["tail", "-n", "200", "/var/log/supervisor/backend.err.log"],
    capture_output=True, text=True
)
log_tail = err.stdout
# Look for 5xx tracebacks specifically related to resolve-place
tb_lines = [l for l in log_tail.splitlines() if "Traceback" in l or "ERROR" in l]
print(f"  Last 200 lines scanned; Traceback/ERROR lines: {len(tb_lines)}")
for l in tb_lines[-10:]:
    print(f"    {l}")

print(f"\n=== RESULT: {passed} passed, {failed} failed ===")
sys.exit(0 if failed == 0 else 1)
