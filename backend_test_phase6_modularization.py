"""Phase 6 modularization smoke test for ConsultUro backend.

Validates that the services/* extraction (reg_no, email, telegram) preserved
behaviour. Tests run against the LOCAL backend on http://localhost:8001.
Re-binding sanity is also exercised via direct import in this process.
"""

import os
import sys
import time
import json
import requests
from datetime import datetime, timedelta, timezone

BASE = os.environ.get("BACKEND_URL", "http://localhost:8001") + "/api"
OWNER_TOKEN = "test_session_1776770314741"
HEADERS_OWNER = {"Authorization": f"Bearer {OWNER_TOKEN}"}

results = []


def check(name, ok, detail=""):
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {name}{(' — ' + detail) if detail else ''}")
    results.append((name, ok, detail))
    return ok


def get(path, **kw):
    return requests.get(BASE + path, timeout=20, **kw)


def post(path, **kw):
    return requests.post(BASE + path, timeout=30, **kw)


def delete(path, **kw):
    return requests.delete(BASE + path, timeout=20, **kw)


# 1. PUBLIC endpoints
print("\n=== 1. PUBLIC endpoints ===")
for ep in ["/health", "/diseases", "/blog", "/clinic-settings", "/calculators"]:
    r = get(ep)
    check(f"GET {ep} → 200", r.status_code == 200, f"got {r.status_code}")

# 2. AUTH FLOW
print("\n=== 2. AUTH ===")
# OTP request
try:
    r = post("/auth/otp/request", json={"email": "sagar.joshi133@gmail.com"})
    body = {}
    try:
        body = r.json()
    except Exception:
        body = {"_text": r.text[:200]}
    check(
        "POST /auth/otp/request returns 200",
        r.status_code == 200,
        f"status={r.status_code} body={body}",
    )
    # The endpoint historically returns either {ok: True} or {sent: True}
    # so we just verify it didn't 5xx.
    check(
        "OTP request: not 5xx (server-side _send_email did not crash)",
        r.status_code < 500,
        f"status={r.status_code} body={body}",
    )
except Exception as e:
    check("POST /auth/otp/request", False, f"exception: {e}")

# /auth/me with primary_owner token
r = get("/auth/me", headers=HEADERS_OWNER)
me_body = r.json() if r.ok else {}
check(
    "GET /auth/me with primary_owner token → 200",
    r.status_code == 200,
    f"status={r.status_code}",
)
check(
    "/auth/me payload role=primary_owner",
    me_body.get("role") == "primary_owner",
    f"role={me_body.get('role')}",
)

# 3. CLINICAL CRUD
print("\n=== 3. CLINICAL CRUD ===")

# Determine a future booking slot — pick tomorrow at 10:00 (any commonly-allowed slot).
ist_now = datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)
tomorrow = (ist_now + timedelta(days=2)).strftime("%Y-%m-%d")
booking_phone = "9999900001"
booking_payload = {
    "patient_name": "Smoke Patient Phase6",
    "patient_phone": booking_phone,
    "country_code": "+91",
    "reason": "Phase6 modularization smoke test",
    "booking_date": tomorrow,
    "booking_time": "10:00",
    "mode": "in-person",
}
r = post("/bookings", json=booking_payload, headers=HEADERS_OWNER)
booking_id = None
booking_doc = {}
if r.status_code == 200:
    booking_doc = r.json()
    booking_id = booking_doc.get("booking_id") or booking_doc.get("id")
    check("POST /bookings → 200", True)
    reg_no = booking_doc.get("registration_no") or booking_doc.get("reg_no")
    import re

    pattern_ok = bool(reg_no) and bool(re.match(r"^\d{9}$", str(reg_no)))
    check(
        "Booking reg_no is 9-digit SSSDDMMYY format",
        pattern_ok,
        f"reg_no={reg_no!r}",
    )
    if pattern_ok:
        # DDMMYY portion = today (IST) — tolerate ±1 day.
        ddmmyy_today = ist_now.strftime("%d%m%y")
        check(
            "Booking reg_no DDMMYY suffix matches today IST",
            str(reg_no).endswith(ddmmyy_today),
            f"reg_no={reg_no} expected suffix={ddmmyy_today}",
        )
else:
    check(
        "POST /bookings → 200",
        False,
        f"status={r.status_code} body={r.text[:300]}",
    )

# Prescription create
rx_phone = "9999900002"
rx_payload = {
    "patient_name": "Smoke Rx Phase6",
    "patient_phone": rx_phone,
    "visit_date": tomorrow,
    "chief_complaints": "smoke check",
    "investigations_advised": "PSA",
    "medicines": [
        {"name": "Tamsulosin", "dosage": "0.4mg", "frequency": "HS", "duration": "30 days"}
    ],
}
r = post("/prescriptions", json=rx_payload, headers=HEADERS_OWNER)
rx_id = None
rx_reg_no = None
if r.status_code == 200:
    rx_doc = r.json()
    rx_id = rx_doc.get("prescription_id") or rx_doc.get("id")
    rx_reg_no = rx_doc.get("registration_no") or rx_doc.get("reg_no")
    check("POST /prescriptions → 200", True)
    import re

    check(
        "Prescription reg_no present and 9-digit",
        bool(rx_reg_no) and bool(re.match(r"^\d{9}$", str(rx_reg_no))),
        f"reg_no={rx_reg_no!r}",
    )
else:
    check(
        "POST /prescriptions → 200",
        False,
        f"status={r.status_code} body={r.text[:300]}",
    )

# 4. AUTH GATING regression
print("\n=== 4. AUTH GATING ===")
r = get("/bookings/all")
check(
    "GET /bookings/all without token → 401",
    r.status_code == 401,
    f"status={r.status_code}",
)
r = get("/bookings/all", headers=HEADERS_OWNER)
check(
    "GET /bookings/all with primary_owner → 200",
    r.status_code == 200,
    f"status={r.status_code}",
)

# 5. UNTOUCHED endpoints sanity (primary_owner)
print("\n=== 5. UNTOUCHED endpoints sanity ===")
for ep in ["/team", "/admin/partners", "/notifications", "/broadcasts", "/blog"]:
    r = get(ep, headers=HEADERS_OWNER)
    check(f"GET {ep} (owner) → 200", r.status_code == 200, f"status={r.status_code}")

# 6. SERVICES IMPORT REGRESSION (in-process)
print("\n=== 6. SERVICES IMPORT REGRESSION ===")
sys.path.insert(0, "/app/backend")
try:
    import importlib

    server_mod = importlib.import_module("server")
    from services.email import _send_email as svc_send_email
    from services.reg_no import (
        allocate_reg_no as svc_allocate_reg_no,
        get_or_set_reg_no as svc_get_or_set_reg_no,
        _normalize_phone as svc_normalize_phone,
    )
    from services.telegram import notify_telegram as svc_notify_telegram

    check(
        "server._send_email IS services.email._send_email",
        getattr(server_mod, "_send_email") is svc_send_email,
    )
    check(
        "server.allocate_reg_no IS services.reg_no.allocate_reg_no",
        getattr(server_mod, "allocate_reg_no") is svc_allocate_reg_no,
    )
    check(
        "server.get_or_set_reg_no IS services.reg_no.get_or_set_reg_no",
        getattr(server_mod, "get_or_set_reg_no") is svc_get_or_set_reg_no,
    )
    check(
        "server.notify_telegram IS services.telegram.notify_telegram",
        getattr(server_mod, "notify_telegram") is svc_notify_telegram,
    )
except Exception as e:
    check("services.* re-import same object check", False, f"exception: {e}")

# Cleanup: delete booking + rx that were just created
print("\n=== 7. Cleanup ===")
if booking_id:
    r = delete(f"/bookings/{booking_id}", headers=HEADERS_OWNER)
    print(f"  delete booking {booking_id} → {r.status_code}")
if rx_id:
    r = delete(f"/prescriptions/{rx_id}", headers=HEADERS_OWNER)
    print(f"  delete prescription {rx_id} → {r.status_code}")

# Summary
print("\n=== SUMMARY ===")
passed = sum(1 for _, ok, _ in results if ok)
failed = [n for n, ok, _ in results if not ok]
print(f"{passed}/{len(results)} assertions PASS")
if failed:
    print("FAILED:")
    for n in failed:
        print(f"  - {n}")
sys.exit(0 if not failed else 1)
