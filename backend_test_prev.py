"""
ConsultUro backend regression test - covers:
1. Prescription source_booking_id traceability (new field + booking auto-complete)
2. GET /api/availability/slots new logic (doctors with saved avail only)
3. Push diagnostics + test endpoints
4. Regressions on doctor, education, blog, bookings, notifications, broadcasts
"""
import os
import sys
import time
import json
import httpx
from datetime import datetime, timezone, timedelta

BASE = os.environ.get("BASE_URL", "https://urology-pro.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"

OWNER_TOKEN = "test_session_1776770314741"
DOCTOR_TOKEN = "test_doc_1776771431524"

H_OWNER = {"Authorization": f"Bearer {OWNER_TOKEN}"}
H_DOCTOR = {"Authorization": f"Bearer {DOCTOR_TOKEN}"}

results = []
created_ids = {"bookings": [], "rx": []}


def log(ok, label, detail=""):
    results.append((ok, label, detail))
    mark = "PASS" if ok else "FAIL"
    print(f"[{mark}] {label}  {('· ' + detail) if detail else ''}")


def req(method, path, headers=None, **kw):
    url = path if path.startswith("http") else f"{API}{path}"
    with httpx.Client(timeout=30.0) as c:
        return c.request(method, url, headers=headers or {}, **kw)


def today_iso():
    return datetime.now(timezone.utc).date().isoformat()


# =============================================================
# 0. Sanity / auth check
# =============================================================
print("\n--- 0. Sanity ---")
r = req("GET", "/auth/me", H_OWNER)
log(r.status_code == 200 and r.json().get("role") == "owner",
    "OWNER token works", f"status={r.status_code}")

r = req("GET", "/auth/me", H_DOCTOR)
log(r.status_code == 200 and r.json().get("role") == "doctor",
    "DOCTOR token works", f"status={r.status_code}")


# =============================================================
# 1. Prescription source_booking_id
# =============================================================
print("\n--- 1. Prescription source_booking_id ---")

phone_a = f"99{int(time.time())%100000000:08d}"
rx_body_a = {
    "patient_name": "Regression Patient A",
    "patient_phone": phone_a,
    "visit_date": today_iso(),
    "chief_complaints": "LUTS for 3 months",
    "diagnosis": "BPH (mild)",
    "medicines": [
        {"name": "Tamsulosin 0.4 mg", "dosage": "1 cap", "frequency": "HS",
         "duration": "30 days", "instructions": "After dinner", "timing": "Night"}
    ],
    "advice": "Hydrate well",
    "follow_up": "2 weeks",
}
r = req("POST", "/prescriptions", H_OWNER, json=rx_body_a)
rx_a = r.json() if r.status_code == 200 else {}
if rx_a.get("prescription_id"):
    created_ids["rx"].append(rx_a["prescription_id"])
log(r.status_code == 200 and rx_a.get("prescription_id", "").startswith("rx_"),
    "POST /prescriptions (no source_booking_id) works",
    f"status={r.status_code} rx={rx_a.get('prescription_id')}")


# 1b. Create a booking to be the source
phone_b = f"88{int(time.time())%100000000:08d}"
future = (datetime.now(timezone.utc) + timedelta(days=15)).date().isoformat()
booking_body = {
    "patient_name": "Regression Patient B",
    "patient_phone": phone_b,
    "patient_age": 60,
    "patient_gender": "male",
    "reason": "Follow-up consultation",
    "booking_date": future,
    "booking_time": "11:00",
    "mode": "in-person",
}
r = req("POST", "/bookings", H_OWNER, json=booking_body)
booking = r.json() if r.status_code == 200 else {}
booking_id = booking.get("booking_id")
if booking_id:
    created_ids["bookings"].append(booking_id)
log(r.status_code == 200 and booking_id and booking.get("registration_no"),
    "POST /bookings creation (source for test)",
    f"status={r.status_code} bid={booking_id} reg={booking.get('registration_no')}")

# 1c. Rx WITH source_booking_id → should close the booking
rx_body_b = {
    **rx_body_a,
    "patient_name": "Regression Patient B",
    "patient_phone": phone_b,
    "source_booking_id": booking_id,
}
r = req("POST", "/prescriptions", H_OWNER, json=rx_body_b)
rx_b = r.json() if r.status_code == 200 else {}
if rx_b.get("prescription_id"):
    created_ids["rx"].append(rx_b["prescription_id"])
log(r.status_code == 200 and rx_b.get("prescription_id", "").startswith("rx_"),
    "POST /prescriptions WITH source_booking_id returns 200",
    f"status={r.status_code} rx={rx_b.get('prescription_id')}")

if booking_id and rx_b.get("prescription_id"):
    r = req("GET", f"/bookings/{booking_id}", H_OWNER)
    b = r.json() if r.status_code == 200 else {}
    ok = (
        r.status_code == 200
        and b.get("status") == "completed"
        and b.get("consultation_rx_id") == rx_b.get("prescription_id")
        and bool(b.get("consultation_completed_at"))
    )
    detail = (
        f"status={b.get('status')} rx_id={b.get('consultation_rx_id')} "
        f"completed_at={b.get('consultation_completed_at')}"
    )
    log(ok, "Source booking auto-closed (status=completed + rx linked + timestamp)", detail)

# 1d. Rx WITH bogus source_booking_id → graceful
rx_body_bogus = {
    **rx_body_a,
    "patient_name": "Regression Patient C",
    "patient_phone": f"77{int(time.time())%100000000:08d}",
    "source_booking_id": "bk_does_not_exist_xyz",
}
r = req("POST", "/prescriptions", H_OWNER, json=rx_body_bogus)
rx_c = r.json() if r.status_code == 200 else {}
if rx_c.get("prescription_id"):
    created_ids["rx"].append(rx_c["prescription_id"])
log(r.status_code == 200 and rx_c.get("prescription_id", "").startswith("rx_"),
    "Bogus source_booking_id does NOT fail Rx creation (graceful)",
    f"status={r.status_code} rx={rx_c.get('prescription_id')}")


# =============================================================
# 2. GET /api/availability/slots
# =============================================================
print("\n--- 2. Availability slots ---")

# 2a. Basic call returns slots array
r = req("GET", "/availability/slots?date=2026-04-28&mode=in-person")
body = r.json() if r.status_code == 200 else {}
slots = body.get("slots")
log(
    r.status_code == 200 and isinstance(slots, list),
    "GET /availability/slots?date=2026-04-28&mode=in-person → 200 with slots[]",
    f"status={r.status_code} len(slots)={len(slots) if isinstance(slots, list) else 'N/A'} sample={slots[:6] if slots else []}",
)

# 2b. Verify slots come ONLY from the owner's saved availability. Owner's
#     saved Tue in-person windows are 08:00-13:00 and 16:00-20:00. Default
#     (test accounts) would only give 10:00-13:00. So has_08 + has_16
#     presence confirms saved doc is the source — AND confirms merging is
#     not happening with the 5 test-own-* default hours.
if isinstance(slots, list):
    has_08 = "08:00" in slots
    has_16 = "16:00" in slots
    has_19_30 = "19:30" in slots
    log(has_08, "Slots include 08:00 (from owner's saved 08-13 window)",
        f"slot list slice={[s for s in slots if s < '10:00']}")
    log(has_16 and has_19_30,
        "Slots include afternoon (16:00..19:30) from owner's saved 16-20 window",
        f"pm slots={[s for s in slots if s >= '16:00']}")

    # Negative: nothing past 20:00 should appear
    has_leak = any(s >= "20:00" for s in slots)
    log(not has_leak, "Slots do NOT leak times >= 20:00", f"overflow={[s for s in slots if s >= '20:00']}")

# 2c. Sunday request (owner's saved doc has no sun_in → empty list)
r = req("GET", "/availability/slots?date=2026-05-03&mode=in-person")
body2 = r.json() if r.status_code == 200 else {}
log(r.status_code == 200 and isinstance(body2.get("slots"), list),
    "Sunday in-person slots request returns 200 with list",
    f"status={r.status_code} slots_len={len(body2.get('slots', []))}")


# =============================================================
# 3. Push diagnostics / test
# =============================================================
print("\n--- 3. Push diagnostics / test ---")

# 3a. /api/push/diagnostics - owner only
r = req("GET", "/push/diagnostics", H_OWNER)
diag = r.json() if r.status_code == 200 else {}
ok = (
    r.status_code == 200
    and "total_tokens" in diag
    and "sends_last_24h" in diag
    and isinstance(diag.get("users"), list)
    and isinstance(diag.get("recent"), list)
)
log(ok, "GET /push/diagnostics (owner) → 200 with expected shape",
    f"status={r.status_code} users={len(diag.get('users', []))} total_tokens={diag.get('total_tokens')}")

# 3b. doctor (non-owner) → 403
r = req("GET", "/push/diagnostics", H_DOCTOR)
log(r.status_code == 403, "GET /push/diagnostics (doctor) → 403", f"status={r.status_code}")

# 3c. no-auth → 401
r = req("GET", "/push/diagnostics")
log(r.status_code == 401, "GET /push/diagnostics (no auth) → 401", f"status={r.status_code}")

# 3d. POST /api/push/test (owner)
r = req("POST", "/push/test", H_OWNER)
body = r.json() if r.status_code == 200 else {}
ok = r.status_code == 200 and "ok" in body and "tokens_found" in body
log(ok, "POST /push/test (owner) → 200",
    f"status={r.status_code} ok={body.get('ok')} tokens={body.get('tokens_found')} reason={body.get('reason')}")

# 3e. POST /api/push/test (doctor)
r = req("POST", "/push/test", H_DOCTOR)
body = r.json() if r.status_code == 200 else {}
log(r.status_code == 200 and "ok" in body,
    "POST /push/test (doctor/any authed) → 200",
    f"status={r.status_code} ok={body.get('ok')} tokens={body.get('tokens_found')}")

# 3f. POST /api/push/test (no auth) → 401
r = req("POST", "/push/test")
log(r.status_code == 401, "POST /push/test (no auth) → 401", f"status={r.status_code}")


# =============================================================
# 4. Regression checks
# =============================================================
print("\n--- 4. Regressions ---")

r = req("GET", "/doctor")
body = r.json() if r.status_code == 200 else {}
log(r.status_code == 200 and body.get("name") == "Dr. Sagar Joshi",
    "GET /doctor → 200", f"status={r.status_code}")

r = req("GET", "/education")
body = r.json() if r.status_code == 200 else []
log(r.status_code == 200 and isinstance(body, list) and len(body) >= 20,
    "GET /education → 200 list",
    f"status={r.status_code} len={len(body) if isinstance(body, list) else 'N/A'}")

r = req("GET", "/blog")
body_ok = False
try:
    bj = r.json() if r.status_code == 200 else None
    body_ok = bj is not None
except Exception:
    body_ok = False
log(r.status_code == 200, "GET /blog → 200", f"status={r.status_code}")

# /api/bookings/all (owner listing)
r = req("GET", "/bookings/all", H_OWNER)
body = r.json() if r.status_code == 200 else []
log(r.status_code == 200 and isinstance(body, list),
    "GET /bookings/all (owner) → 200 list",
    f"status={r.status_code} count={len(body) if isinstance(body, list) else 'N/A'}")

# /api/bookings/me (authed)
r = req("GET", "/bookings/me", H_OWNER)
body = r.json() if r.status_code == 200 else []
log(r.status_code == 200 and isinstance(body, list),
    "GET /bookings/me (owner) → 200 list",
    f"status={r.status_code} count={len(body) if isinstance(body, list) else 'N/A'}")

# POST /api/bookings get_or_set_reg_no regression
if booking_id:
    r = req("GET", f"/bookings/{booking_id}", H_OWNER)
    b = r.json() if r.status_code == 200 else {}
    reg = b.get("registration_no") or ""
    log(len(reg) == 9 and reg.isdigit(),
        "POST /bookings still uses get_or_set_reg_no (9-digit reg_no)",
        f"reg_no={reg}")

# /api/notifications
r = req("GET", "/notifications?limit=10", H_OWNER)
body = r.json() if r.status_code == 200 else []
log(r.status_code == 200 and isinstance(body, list),
    "GET /notifications (owner) → 200 list",
    f"status={r.status_code}")

# Broadcasts: POST + PATCH approve
bc_body = {"title": f"Regression check {int(time.time())}", "body": "Regression body", "target": "all"}
r = req("POST", "/broadcasts", H_OWNER, json=bc_body)
bc = r.json() if r.status_code == 200 else {}
bc_id = bc.get("broadcast_id")
log(r.status_code == 200 and bc_id and bc_id.startswith("bc_"),
    "POST /broadcasts (owner) → 200",
    f"status={r.status_code} id={bc_id} status_field={bc.get('status')}")

if bc_id:
    r = req("PATCH", f"/broadcasts/{bc_id}", H_OWNER, json={"action": "approve"})
    try:
        body = r.json()
    except Exception:
        body = {}
    log(r.status_code == 200,
        f"PATCH /broadcasts/{bc_id} (approve) → 200",
        f"status={r.status_code} body={json.dumps(body)[:200]}")


# =============================================================
# CLEANUP
# =============================================================
print("\n--- Cleanup ---")
for rx in created_ids["rx"]:
    try:
        r = req("DELETE", f"/prescriptions/{rx}", H_OWNER)
        print(f"  delete rx {rx}: {r.status_code}")
    except Exception as e:
        print(f"  delete rx {rx}: ERROR {e}")


# =============================================================
# SUMMARY
# =============================================================
print("\n\n==================== SUMMARY ====================")
passed = sum(1 for ok, *_ in results if ok)
failed = sum(1 for ok, *_ in results if not ok)
print(f"PASSED: {passed} / {len(results)}")
print(f"FAILED: {failed}")
if failed:
    print("\nFailures:")
    for ok, label, detail in results:
        if not ok:
            print(f"  FAIL · {label} · {detail}")

sys.exit(0 if failed == 0 else 1)
