"""Backend smoke test — Phase 5.21 AI Weekly Clinic Summary.

Run: python /app/backend_test_weekly_summary.py
"""
import json
import os
import sys
import requests

BASE = "http://localhost:8001"
OWNER_TOKEN = "test_session_ws_1780993544771"
DOCTOR_TOKEN = "test_doc_ws_1780993544776"

PASS_COUNT = 0
FAIL_COUNT = 0
FAIL_LINES = []


def check(name, cond, extra=""):
    global PASS_COUNT, FAIL_COUNT
    if cond:
        PASS_COUNT += 1
        print(f"  PASS  {name}")
    else:
        FAIL_COUNT += 1
        msg = f"  FAIL  {name}  {extra}"
        FAIL_LINES.append(msg)
        print(msg)


def hdr(t):
    print(f"\n=== {t} ===")


owner_hdrs = {"Authorization": f"Bearer {OWNER_TOKEN}"}
doctor_hdrs = {"Authorization": f"Bearer {DOCTOR_TOKEN}"}


# ─────────────────────────────────────────────────────────────────
# TEST 1 — Default GET (week_offset=0, no email)
# ─────────────────────────────────────────────────────────────────
hdr("TEST 1 — GET /api/admin/weekly-summary (default)")
r = requests.get(f"{BASE}/api/admin/weekly-summary", headers=owner_hdrs, timeout=120)
check("HTTP 200", r.status_code == 200, f"got {r.status_code} body={r.text[:200]}")

if r.status_code == 200:
    body = r.json()

    # window
    win = body.get("window") or {}
    check("window.label is string", isinstance(win.get("label"), str) and len(win["label"]) > 0,
          f"label={win.get('label')!r}")
    check("window.label looks like 'This week ...' for offset=0",
          isinstance(win.get("label"), str) and ("This week" in win["label"]),
          f"label={win.get('label')!r}")
    check("window.start present", bool(win.get("start")))
    check("window.end present", bool(win.get("end")))

    # clinic_name
    cn = body.get("clinic_name")
    check("clinic_name is str", isinstance(cn, str) and len(cn) > 0, f"clinic_name={cn!r}")

    # stats — every required key present
    stats = body.get("stats") or {}
    required = [
        "bookings_total", "bookings_inperson", "bookings_video",
        "bookings_completed", "bookings_cancelled", "patients_new",
        "surgeries_done", "ipd_admits", "ipd_discharged", "rx_finalised",
        "revenue_inr", "revenue_pending_inr", "receipts_count",
        "reviews_new", "reviews_avg_rating", "google_rating",
        "google_total_ratings",
    ]
    missing = [k for k in required if k not in stats]
    check("stats has all 17 required KPI keys", not missing, f"missing={missing}")
    check("stats has ≥17 keys", len(stats) >= 17, f"keys={list(stats.keys())}")

    # top_* are lists of [name,count] pairs
    for tk in ["top_complaints", "top_diagnoses", "top_medicines"]:
        v = stats.get(tk)
        check(f"stats.{tk} is list", isinstance(v, list), f"{tk}={v!r}")
        if isinstance(v, list) and v:
            first = v[0]
            check(f"stats.{tk}[0] looks like [name,count]",
                  (isinstance(first, (list, tuple)) and len(first) == 2),
                  f"first={first!r}")

    # narrative
    narrative = body.get("narrative") or ""
    check("narrative non-empty", isinstance(narrative, str) and len(narrative) > 0,
          f"narrative_len={len(narrative)}")
    check("narrative ≥100 chars", len(narrative) >= 100, f"len={len(narrative)}")
    using_fallback = "AI summary unavailable this week" in narrative
    print(f"  INFO  narrative_len={len(narrative)} using_fallback={using_fallback}")
    print(f"  INFO  narrative_preview={narrative[:200]!r}")

    # html
    html = body.get("html") or ""
    check("html non-empty", isinstance(html, str) and len(html) > 0)
    check("html contains <html", "<html" in html.lower(), f"html_head={html[:80]!r}")

    # email fields null on no-email mode
    check("email_sent is None (no email)", body.get("email_sent") is None,
          f"email_sent={body.get('email_sent')!r}")
    check("email_to is None (no email)", body.get("email_to") is None,
          f"email_to={body.get('email_to')!r}")


# ─────────────────────────────────────────────────────────────────
# TEST 2 — week_offset variations
# ─────────────────────────────────────────────────────────────────
hdr("TEST 2 — week_offset variations")
labels = {}
for off in [0, 1, 2, 12]:
    r = requests.get(f"{BASE}/api/admin/weekly-summary?week_offset={off}",
                     headers=owner_hdrs, timeout=120)
    check(f"week_offset={off} returns 200", r.status_code == 200,
          f"got {r.status_code} body={r.text[:200]}")
    if r.status_code == 200:
        labels[off] = r.json().get("window", {}).get("label")
        print(f"  INFO  offset={off}  label={labels[off]!r}")

# All labels distinct
distinct = len(set(labels.values()))
check("labels differ across offsets", distinct == len(labels),
      f"labels={labels}")

# week_offset=13 must be rejected by Query(le=12)
r = requests.get(f"{BASE}/api/admin/weekly-summary?week_offset=13",
                 headers=owner_hdrs, timeout=30)
check("week_offset=13 rejected (422)", r.status_code == 422,
      f"got {r.status_code} body={r.text[:200]}")


# ─────────────────────────────────────────────────────────────────
# TEST 3 — Auth gate (no token)
# ─────────────────────────────────────────────────────────────────
hdr("TEST 3 — Auth gate (no token)")
r = requests.get(f"{BASE}/api/admin/weekly-summary", timeout=30)
check("No auth → 401/403 (not 200)", r.status_code in (401, 403),
      f"got {r.status_code}")

# Doctor (non-owner) — require_owner is owner-tier only
r = requests.get(f"{BASE}/api/admin/weekly-summary", headers=doctor_hdrs, timeout=30)
check("Doctor token rejected (403)", r.status_code == 403,
      f"got {r.status_code} body={r.text[:200]}")


# ─────────────────────────────────────────────────────────────────
# TEST 4 — AI narrative quality (already partly covered)
# ─────────────────────────────────────────────────────────────────
hdr("TEST 4 — AI narrative quality")
r = requests.get(f"{BASE}/api/admin/weekly-summary?week_offset=1",
                 headers=owner_hdrs, timeout=120)
check("offset=1 → 200", r.status_code == 200)
if r.status_code == 200:
    body = r.json()
    narrative = body.get("narrative") or ""
    stats = body.get("stats") or {}
    check("narrative ≥100 chars (offset=1)", len(narrative) >= 100,
          f"len={len(narrative)}")
    using_fallback = "AI summary unavailable this week" in narrative
    print(f"  INFO  offset=1 using_fallback={using_fallback}")
    if using_fallback:
        # If fallback, ensure stat numbers appear in narrative
        # (booking total or surgeries number should appear textually)
        bk = str(stats.get("bookings_total", 0))
        sx = str(stats.get("surgeries_done", 0))
        check("fallback narrative mentions numbers (bookings or surgeries)",
              (bk in narrative or sx in narrative or "₹" in narrative),
              f"bk={bk}, sx={sx}")
    print(f"  INFO  narrative_preview={narrative[:300]!r}")


# ─────────────────────────────────────────────────────────────────
# TEST 5 — Email path
# ─────────────────────────────────────────────────────────────────
hdr("TEST 5 — GET ?week_offset=1&email=true")
r = requests.get(f"{BASE}/api/admin/weekly-summary?week_offset=1&email=true",
                 headers=owner_hdrs, timeout=120)
check("email=true → 200 (not 500)", r.status_code == 200,
      f"got {r.status_code} body={r.text[:300]}")
if r.status_code == 200:
    body = r.json()
    email_sent = body.get("email_sent")
    email_to = body.get("email_to")
    check("email_sent is boolean", isinstance(email_sent, bool),
          f"email_sent={email_sent!r}")
    check("email_to is string", isinstance(email_to, str) and len(email_to) > 0,
          f"email_to={email_to!r}")
    check("email_to == owner email or OWNER_EMAIL env",
          email_to in ("sagar.joshi133@gmail.com", os.environ.get("OWNER_EMAIL", "")),
          f"email_to={email_to!r}")
    print(f"  INFO  email_sent={email_sent}  email_to={email_to}")


# ─────────────────────────────────────────────────────────────────
# TEST 6 — POST /api/admin/weekly-summary/email-now
# ─────────────────────────────────────────────────────────────────
hdr("TEST 6 — POST /api/admin/weekly-summary/email-now")
r = requests.post(f"{BASE}/api/admin/weekly-summary/email-now",
                  headers=owner_hdrs, timeout=120)
check("email-now → 200", r.status_code == 200,
      f"got {r.status_code} body={r.text[:300]}")
if r.status_code == 200:
    body = r.json()
    check("payload has window/stats/narrative/html",
          all(k in body for k in ("window", "stats", "narrative", "html")),
          f"keys={list(body.keys())}")
    check("email-now: email_sent is boolean",
          isinstance(body.get("email_sent"), bool),
          f"email_sent={body.get('email_sent')!r}")
    check("email-now: email_to is non-empty string",
          isinstance(body.get("email_to"), str) and len(body.get("email_to") or "") > 0,
          f"email_to={body.get('email_to')!r}")
    print(f"  INFO  POST email_sent={body.get('email_sent')} email_to={body.get('email_to')}")

# email-now auth gate: no token
r = requests.post(f"{BASE}/api/admin/weekly-summary/email-now", timeout=30)
check("email-now no-auth → 401/403", r.status_code in (401, 403),
      f"got {r.status_code}")

r = requests.post(f"{BASE}/api/admin/weekly-summary/email-now",
                  headers=doctor_hdrs, timeout=30)
check("email-now doctor → 403", r.status_code == 403, f"got {r.status_code}")


# ─────────────────────────────────────────────────────────────────
# TEST 7 — Graceful handling of missing collections
# Verified implicitly by 200s on multiple offsets. Sanity check.
# ─────────────────────────────────────────────────────────────────
hdr("TEST 7 — graceful aggregation (no 5xx on possibly-empty collections)")
# Try offset=10 (likely all collections empty for that period)
r = requests.get(f"{BASE}/api/admin/weekly-summary?week_offset=10",
                 headers=owner_hdrs, timeout=120)
check("offset=10 (empty period) → 200 (no 5xx)", r.status_code == 200,
      f"got {r.status_code} body={r.text[:200]}")
if r.status_code == 200:
    stats = r.json().get("stats") or {}
    check("stats present even for empty period", len(stats) >= 17,
          f"keys={list(stats.keys())}")


# ─────────────────────────────────────────────────────────────────
# SUMMARY
# ─────────────────────────────────────────────────────────────────
print(f"\n========================================")
print(f"RESULT: {PASS_COUNT} PASS / {FAIL_COUNT} FAIL  (total {PASS_COUNT+FAIL_COUNT})")
if FAIL_LINES:
    print("FAILURES:")
    for ln in FAIL_LINES:
        print(ln)
sys.exit(0 if FAIL_COUNT == 0 else 1)
