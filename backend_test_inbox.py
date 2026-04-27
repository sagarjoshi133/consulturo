"""Re-test for /api/inbox/all unified inbox endpoint after datetime-slicing fix.

Tests against http://localhost:8001 with the OWNER token from
/app/memory/test_credentials.md.
"""
import json
import sys
import time
from datetime import datetime, timedelta

import requests

BASE = "http://localhost:8001"
OWNER_TOKEN = "test_session_1776770314741"
HEADERS = {"Authorization": f"Bearer {OWNER_TOKEN}", "Content-Type": "application/json"}

PASS = 0
FAIL = 0
FAILURES = []


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ✅ {name}")
    else:
        FAIL += 1
        FAILURES.append(f"{name} :: {detail}")
        print(f"  ❌ {name} :: {detail}")


def section(t):
    print(f"\n=== {t} ===")


# ─── 1. GET /api/inbox/all returns 200 (not 500) ──────────────────────
section("1. GET /api/inbox/all (owner) — basic shape & 200")
r = requests.get(f"{BASE}/api/inbox/all", headers=HEADERS, timeout=15)
print(f"  status={r.status_code}")
check("GET /api/inbox/all returns 200 (not 500)", r.status_code == 200,
      f"got {r.status_code}; body={r.text[:300]}")
if r.status_code != 200:
    print("FATAL — endpoint still failing. Aborting further tests.")
    print(json.dumps(FAILURES, indent=2))
    sys.exit(1)

body = r.json()
check("Top-level has 'items' key", "items" in body, f"keys={list(body.keys())}")
check("Top-level has 'unread' key", "unread" in body, f"keys={list(body.keys())}")
check("'items' is a list", isinstance(body.get("items"), list))
check("'unread' is an int", isinstance(body.get("unread"), int))

items = body.get("items", [])
print(f"  items_count={len(items)} unread={body.get('unread')}")

# Per-item structure validation.
required_keys = {"id", "title", "body", "kind", "source_type", "read", "created_at"}
allowed_source_types = {"user", "broadcast", "push", "other"}

if items:
    sample = items[0]
    missing = required_keys - set(sample.keys())
    check(f"First item has all required keys (missing={missing})",
          len(missing) == 0, f"sample keys={list(sample.keys())}")
    src_invalid = [it.get("source_type") for it in items
                   if it.get("source_type") not in allowed_source_types]
    check(f"All source_type ∈ {allowed_source_types}",
          len(src_invalid) == 0, f"invalid={src_invalid[:5]}")
    bool_read_ok = all(isinstance(it.get("read"), bool) for it in items)
    check("Every item has bool 'read'", bool_read_ok)
else:
    print("  (no items in inbox — will trigger one via POST /api/bookings)")

# Sort order check (newest-first).
def _ts(it):
    v = it.get("created_at")
    if isinstance(v, str):
        try:
            return datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp()
        except Exception:
            return 0
    return 0

if len(items) >= 2:
    ts_list = [_ts(it) for it in items]
    is_desc = all(ts_list[i] >= ts_list[i + 1] for i in range(len(ts_list) - 1))
    check("Items are sorted newest-first", is_desc,
          f"first 3 ts: {ts_list[:3]}")


# ─── 2. Round-trip read via POST /api/bookings → mark-all read ────────
section("2. Round-trip: trigger fresh notification → unread N → mark all → unread 0")

# 2a) note baseline unread.
baseline_unread = body.get("unread", 0)
print(f"  baseline_unread={baseline_unread}")

# 2b) trigger a brand-new notification by creating a booking under owner.
# POST /api/bookings creates an in-app notification for the owner & patient.
# We use a unique phone + future date with a reasonable slot.
ist_today = (datetime.utcnow() + timedelta(hours=5, minutes=30)).date()
future_date = (ist_today + timedelta(days=2)).isoformat()  # +2 days IST
import random
slot_hour = random.randint(11, 16)
slot_min = random.choice(["00", "30"])
booking_time = f"{slot_hour:02d}:{slot_min}"

booking_payload = {
    "patient_name": "Inbox Test Patient",
    "patient_phone": "9123456789",  # fixed phone
    "country_code": "+91",
    "reason": "Inbox round-trip smoke test",
    "booking_date": future_date,
    "booking_time": booking_time,
    "mode": "in-person",
}
print(f"  POST /api/bookings payload date={future_date} time={booking_time}")
br = requests.post(f"{BASE}/api/bookings", headers=HEADERS, json=booking_payload, timeout=15)
print(f"  booking POST status={br.status_code}")
created_booking_id = None
if br.status_code == 200:
    bdoc = br.json()
    created_booking_id = bdoc.get("booking_id")
    print(f"  created booking {created_booking_id}")
    check("POST /api/bookings → 200", True)
else:
    # Fallback — if slot conflict, try a later slot.
    for offset in range(1, 12):
        bp = booking_payload.copy()
        bp["booking_time"] = f"{(slot_hour + offset) % 18 + 9:02d}:00"
        br2 = requests.post(f"{BASE}/api/bookings", headers=HEADERS, json=bp, timeout=15)
        if br2.status_code == 200:
            created_booking_id = br2.json().get("booking_id")
            print(f"  retry success with time={bp['booking_time']} → {created_booking_id}")
            break
    check("POST /api/bookings → 200 (after retry)", created_booking_id is not None,
          f"final status={br.status_code} body={br.text[:200]}")

# Give async notification creation a moment.
time.sleep(1.0)

# 2c) GET inbox again — unread should be > baseline (N>0 fresh).
r2 = requests.get(f"{BASE}/api/inbox/all", headers=HEADERS, timeout=15)
check("GET /api/inbox/all (after booking) → 200", r2.status_code == 200,
      f"got {r2.status_code}")
body2 = r2.json() if r2.status_code == 200 else {}
unread_after = body2.get("unread", 0)
items_after = body2.get("items", [])
print(f"  unread_after={unread_after} items_count={len(items_after)}")
check("Unread count after booking creation is > 0", unread_after > 0,
      f"got {unread_after}")

# 2d) POST /api/inbox/all/read — mark all read.
mr = requests.post(f"{BASE}/api/inbox/all/read", headers=HEADERS, timeout=15)
print(f"  POST /api/inbox/all/read status={mr.status_code} body={mr.text[:200]}")
check("POST /api/inbox/all/read → 200", mr.status_code == 200)
mr_body = mr.json() if mr.status_code == 200 else {}
check("Mark-all response has ok=true", mr_body.get("ok") is True,
      f"body={mr_body}")
marked = mr_body.get("marked", -1)
check("Mark-all response has 'marked' int", isinstance(marked, int))
check(f"marked ({marked}) >= unread_after ({unread_after})",
      marked >= unread_after)

# 2e) GET again → unread must be 0.
r3 = requests.get(f"{BASE}/api/inbox/all", headers=HEADERS, timeout=15)
check("GET /api/inbox/all (after mark) → 200", r3.status_code == 200)
body3 = r3.json() if r3.status_code == 200 else {}
final_unread = body3.get("unread", -1)
print(f"  final unread={final_unread}")
check("Final unread is 0", final_unread == 0, f"got {final_unread}")

# Cleanup: cancel the booking we created.
if created_booking_id:
    cleanup = requests.patch(f"{BASE}/api/bookings/{created_booking_id}",
                             headers=HEADERS,
                             json={"status": "cancelled", "reason": "test cleanup"},
                             timeout=15)
    print(f"  cleanup PATCH cancel: {cleanup.status_code}")


# ─── 3. Regression smoke ──────────────────────────────────────────────
section("3. Regression smoke — legacy endpoints still working")

rn = requests.get(f"{BASE}/api/notifications", headers=HEADERS, timeout=15)
check("GET /api/notifications → 200", rn.status_code == 200,
      f"got {rn.status_code}")
if rn.status_code == 200:
    nb = rn.json()
    # Legacy shape: {items: [...], unread: N}
    check("Notifications has legacy 'items' key", "items" in nb)
    check("Notifications has legacy 'unread' key", "unread" in nb)

rb = requests.get(f"{BASE}/api/broadcasts/inbox", headers=HEADERS, timeout=15)
check("GET /api/broadcasts/inbox → 200", rb.status_code == 200,
      f"got {rb.status_code}")
if rb.status_code == 200:
    bb = rb.json()
    # Legacy: list of broadcast_inbox docs.
    check("Broadcasts inbox returns a list", isinstance(bb, list),
          f"type={type(bb).__name__}")

rme = requests.get(f"{BASE}/api/auth/me", headers=HEADERS, timeout=15)
check("GET /api/auth/me → 200", rme.status_code == 200)
if rme.status_code == 200:
    me = rme.json()
    check("auth/me has 'phone' key", "phone" in me, f"keys={list(me.keys())[:20]}")


# ─── Summary ──────────────────────────────────────────────────────────
print("\n" + "=" * 60)
print(f"PASS: {PASS}")
print(f"FAIL: {FAIL}")
if FAIL:
    print("\nFailures:")
    for f in FAILURES:
        print(f"  - {f}")
sys.exit(0 if FAIL == 0 else 1)
