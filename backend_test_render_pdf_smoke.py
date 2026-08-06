"""Smoke test for POST /api/render/pdf (WeasyPrint).

Per review_request:
  1. Auth gate — no auth → 401
  2. Auth + tiny html ("<html>x</html>") → 400 (too short)
  3. Auth + valid html (>= 50 chars) → 200, content-type application/pdf,
     body > 1 KB
  4. Auth + sample Medical Certificate HTML with filename
     "MedicalCertificate-Test" → Content-Disposition inline; filename="…pdf"
  5. WeasyPrint engine present — no 503

Uses the public EXPO_PUBLIC_BACKEND_URL and the pre-seeded primary owner
session token from /app/memory/test_credentials.md.
"""
from __future__ import annotations

import os
import sys
import json
from typing import Optional

import requests

BASE = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or "https://urology-pro.preview.emergentagent.com"
).rstrip("/")
API = f"{BASE}/api"
OWNER_TOKEN = "test_session_1776770314741"

passed = 0
failed = 0
failures: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    global passed, failed
    if cond:
        passed += 1
        print(f"  PASS · {name}")
    else:
        failed += 1
        failures.append(f"{name} :: {detail}")
        print(f"  FAIL · {name} :: {detail}")


def section(title: str) -> None:
    print(f"\n=== {title} ===")


# ------------------------------------------------------------------ #
# 1. Auth gate                                                        #
# ------------------------------------------------------------------ #
section("1. Auth gate — no auth → 401")
r = requests.post(
    f"{API}/render/pdf",
    json={"html": "<html><body>" + "x" * 100 + "</body></html>"},
    timeout=30,
)
check("POST /api/render/pdf without auth returns 401", r.status_code == 401,
      f"got {r.status_code} body={r.text[:200]}")

# ------------------------------------------------------------------ #
# 2. Tiny html → 400                                                  #
# ------------------------------------------------------------------ #
section("2. With auth + tiny html → 400 (too short)")
r = requests.post(
    f"{API}/render/pdf",
    headers={"Authorization": f"Bearer {OWNER_TOKEN}"},
    json={"html": "<html>x</html>"},
    timeout=30,
)
check("tiny html returns 400", r.status_code == 400,
      f"got {r.status_code} body={r.text[:200]}")
try:
    body = r.json()
    check("tiny html error mentions 'too short'", "too short" in (body.get("detail") or "").lower(),
          f"detail={body.get('detail')}")
except Exception:
    check("tiny html response parseable as JSON", False, r.text[:200])

# ------------------------------------------------------------------ #
# 3. Valid html >=50 chars → 200, application/pdf, > 1 KB             #
# ------------------------------------------------------------------ #
section("3. With auth + valid html (>=50 chars) → 200 application/pdf > 1KB")
LOREM = (
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do "
    "eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut "
    "enim ad minim veniam, quis nostrud exercitation ullamco laboris "
    "nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor "
    "in reprehenderit in voluptate velit esse cillum dolore eu fugiat "
    "nulla pariatur. Excepteur sint occaecat cupidatat non proident, "
    "sunt in culpa qui officia deserunt mollit anim id est laborum. "
)
# build ~1KB of lorem
body_text = (LOREM * 5)  # > 1KB
valid_html = (
    "<html><head><title>x</title></head>"
    f"<body><h1>Hello</h1><p>{body_text}</p></body></html>"
)
assert len(valid_html) >= 50

r = requests.post(
    f"{API}/render/pdf",
    headers={"Authorization": f"Bearer {OWNER_TOKEN}"},
    json={"html": valid_html},
    timeout=60,
)
check("valid html returns 200", r.status_code == 200,
      f"got {r.status_code} body={r.text[:200]}")
if r.status_code == 200:
    ct = r.headers.get("content-type", "")
    check("Content-Type contains application/pdf", "application/pdf" in ct.lower(), f"got {ct}")
    body_bytes = r.content
    check("body > 1 KB", len(body_bytes) > 1024, f"len={len(body_bytes)}")
    check("body starts with %PDF-", body_bytes.startswith(b"%PDF-"),
          f"first8={body_bytes[:8]!r}")
    # Engine present — no 503
    check("WeasyPrint engine present (no 503)", r.status_code != 503, f"got {r.status_code}")
else:
    # If the engine is missing we'd see 503
    if r.status_code == 503:
        failures.append(f"WeasyPrint engine reported unavailable: {r.text[:300]}")

# ------------------------------------------------------------------ #
# 4. Medical Certificate HTML with explicit filename                  #
# ------------------------------------------------------------------ #
section("4. Medical Certificate HTML + filename → Content-Disposition inline")
mc_html = (
    "<html><head><title>x</title></head><body>"
    + ("Lorem ipsum dolor sit amet, " * 40)  # > 1 KB body
    + "</body></html>"
)
assert len(mc_html) >= 50

r = requests.post(
    f"{API}/render/pdf",
    headers={"Authorization": f"Bearer {OWNER_TOKEN}"},
    json={"html": mc_html, "filename": "MedicalCertificate-Test.pdf"},
    timeout=60,
)
check("Medical Cert render returns 200", r.status_code == 200,
      f"got {r.status_code} body={r.text[:200]}")
if r.status_code == 200:
    cd = r.headers.get("content-disposition", "") or r.headers.get("Content-Disposition", "")
    expected = 'inline; filename="MedicalCertificate-Test.pdf"'
    check(
        f"Content-Disposition exactly contains {expected!r}",
        expected in cd,
        f"got {cd!r}",
    )
    check("Content-Type application/pdf", "application/pdf" in r.headers.get("content-type", "").lower(),
          f"got {r.headers.get('content-type')}")
    check("Body > 1 KB", len(r.content) > 1024, f"len={len(r.content)}")
    check("Body starts %PDF-", r.content.startswith(b"%PDF-"), f"first8={r.content[:8]!r}")

# Also test Discharge Summary HTML same way (per shared sharePdfFromHtml helper note)
section("4b. Discharge Summary HTML + filename")
ds_html = (
    "<html><head><title>x</title></head><body>"
    + ("Discharge summary lorem ipsum content. " * 40)
    + "</body></html>"
)
r = requests.post(
    f"{API}/render/pdf",
    headers={"Authorization": f"Bearer {OWNER_TOKEN}"},
    json={"html": ds_html, "filename": "DischargeSummary-Test"},  # no .pdf — server should append
    timeout=60,
)
check("Discharge render returns 200", r.status_code == 200,
      f"got {r.status_code} body={r.text[:200]}")
if r.status_code == 200:
    cd = r.headers.get("content-disposition", "") or r.headers.get("Content-Disposition", "")
    expected = 'inline; filename="DischargeSummary-Test.pdf"'
    check(
        f"Content-Disposition appends .pdf: contains {expected!r}",
        expected in cd,
        f"got {cd!r}",
    )

# ------------------------------------------------------------------ #
# Summary                                                              #
# ------------------------------------------------------------------ #
print()
print("=" * 60)
print(f"PASS: {passed}")
print(f"FAIL: {failed}")
if failures:
    print("\nFailure details:")
    for f in failures:
        print(f"  - {f}")
print("=" * 60)
sys.exit(0 if failed == 0 else 1)
