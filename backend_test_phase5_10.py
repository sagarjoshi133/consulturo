"""ConsultUro Phase 5.10 — Billing & Receipts hardening + Razorpay smoke tests.

Read-only against /app/memory/test_credentials.md OWNER token.
Base URL: http://localhost:8001/api
"""
from __future__ import annotations
import os
import json
import time
import uuid
import requests

BASE = os.environ.get("BACKEND_BASE", "http://localhost:8001/api")
OWNER_TOKEN = "test_session_1776770314741"  # primary_owner sagar.joshi133

HDR = {"Authorization": f"Bearer {OWNER_TOKEN}", "Content-Type": "application/json"}

results = []

def rec(name: str, ok: bool, detail: str = ""):
    results.append((ok, name, detail))
    flag = "PASS" if ok else "FAIL"
    print(f"[{flag}] {name} {('— ' + detail) if detail else ''}")

# ─── 1. Razorpay config ───────────────────────────────────────────
print("\n=== 1. GET /api/payments/razorpay/config ===")
r = requests.get(f"{BASE}/payments/razorpay/config", timeout=15)
rec("config status 200", r.status_code == 200, f"got {r.status_code}")
try:
    cfg = r.json()
except Exception:
    cfg = {}
rec("config.enabled == True", cfg.get("enabled") is True, str(cfg))
rec("config.key_id == rzp_test_SwKJbGYwyHwIVQ",
    cfg.get("key_id") == "rzp_test_SwKJbGYwyHwIVQ", str(cfg.get("key_id")))
rec("config.mode == 'test'", cfg.get("mode") == "test", str(cfg.get("mode")))

# ─── 2. Pending payments listing ──────────────────────────────────
print("\n=== 2. GET /api/bookings/pending-payments ===")
r = requests.get(f"{BASE}/bookings/pending-payments", timeout=15)
rec("no-auth → 401", r.status_code == 401, f"got {r.status_code} body={r.text[:120]}")

r = requests.get(f"{BASE}/bookings/pending-payments", headers=HDR, timeout=20)
rec("owner → 200", r.status_code == 200, f"got {r.status_code}")
try:
    rows = r.json()
except Exception:
    rows = None
rec("response is a list", isinstance(rows, list), str(type(rows)))
if isinstance(rows, list):
    bad_amt = [r2 for r2 in rows if not r2.get("amount_inr") or float(r2.get("amount_inr") or 0) <= 0]
    rec("every row has amount_inr > 0 (default fallback)",
        len(bad_amt) == 0,
        f"{len(bad_amt)}/{len(rows)} rows had non-positive amount_inr")
    bad_struct = [r2 for r2 in rows if not r2.get("booking_id") or not r2.get("patient_name")]
    rec("every row has booking_id + patient_name",
        len(bad_struct) == 0,
        f"{len(bad_struct)}/{len(rows)} rows missing booking_id/patient_name")
    bad_status = [r2 for r2 in rows if r2.get("status") != "confirmed"]
    rec("every row has status=confirmed",
        len(bad_status) == 0,
        f"{len(bad_status)}/{len(rows)} rows had status != confirmed")
    bad_pay = [r2 for r2 in rows if (r2.get("payment_status") or "") not in ("pending_offline", "", None)]
    rec("every row has payment_status in {pending_offline, '', None}",
        len(bad_pay) == 0,
        f"{len(bad_pay)}/{len(rows)} rows had wrong payment_status: " +
        json.dumps([{"id": r2.get("booking_id"), "ps": r2.get("payment_status")} for r2 in bad_pay[:3]]))

# ─── 2b. Create a confirmed booking with pending_offline → verify it appears, mark paid → disappears
print("\n=== 2b. Create confirmed booking, mark-paid-offline cycle ===")
# Use a unique phone and explicit reg/patient name
unique_phone = "98760" + str(int(time.time()) % 100000)
create_payload = {
    "patient_name": "Phase510 PendingPay",
    "patient_phone": unique_phone,
    "country_code": "+91",
    "reason": "pending payment smoke",
    "booking_date": "2026-12-31",
    "booking_time": "10:00",
    "mode": "in-person",
}
r = requests.post(f"{BASE}/bookings", headers=HDR, json=create_payload, timeout=20)
created_bk = None
if r.status_code == 200:
    created_bk = r.json()
    rec("create booking → 200", True, f"id={created_bk.get('booking_id')}")
else:
    rec("create booking → 200", False, f"got {r.status_code} body={r.text[:200]}")

bk_id_pending = None
if created_bk and created_bk.get("booking_id"):
    bk_id_pending = created_bk["booking_id"]
    # Confirm + set pending_offline directly via mongosh-equivalent: use status-update endpoints.
    # Try via PATCH /api/bookings/{id}/status route -- check what exists.
    # We'll use known endpoint: PATCH /api/bookings/{id} or /confirm if it exists.
    # Use direct PATCH if exists.
    r = requests.post(f"{BASE}/bookings/{bk_id_pending}/confirm",
                      headers=HDR, json={}, timeout=15)
    if r.status_code != 200:
        # Try /status
        r = requests.patch(f"{BASE}/bookings/{bk_id_pending}",
                           headers=HDR, json={"status": "confirmed", "payment_status": "pending_offline"},
                           timeout=15)
    rec("set booking confirmed", r.status_code == 200, f"got {r.status_code} body={r.text[:200]}")
    # Need to also force payment_status=pending_offline. Try the bookings PATCH first; else mongosh.
    if r.status_code == 200:
        # check current state
        # Many bookings APIs don't accept payment_status via /confirm. Try a follow-up patch.
        rp = requests.patch(f"{BASE}/bookings/{bk_id_pending}",
                            headers=HDR, json={"payment_status": "pending_offline"},
                            timeout=15)
        # don't strictly assert here
        # check via GET
    # Verify it appears in pending-payments
    r = requests.get(f"{BASE}/bookings/pending-payments", headers=HDR, timeout=20)
    rows2 = r.json() if r.status_code == 200 else []
    found = any(row.get("booking_id") == bk_id_pending for row in rows2)
    if not found:
        # Could be that status setting didn't take. Inspect booking
        rb = requests.get(f"{BASE}/bookings/all", headers=HDR, timeout=15)
        bks = rb.json() if rb.status_code == 200 else []
        cur = next((b for b in bks if b.get("booking_id") == bk_id_pending), None)
        detail = f"booking_state={ {k: (cur or {}).get(k) for k in ('status','payment_status','paid_offline')} }"
    else:
        detail = ""
    rec("created confirmed pending booking shows up in /pending-payments", found, detail)

    # Mark paid offline → should disappear
    r = requests.post(f"{BASE}/bookings/{bk_id_pending}/mark-paid-offline",
                      headers=HDR, json={"amount_inr": 500, "mode": "Cash", "notes": "smoke"},
                      timeout=15)
    rec("mark-paid-offline Cash → 200", r.status_code == 200, f"got {r.status_code} body={r.text[:200]}")
    r2 = requests.get(f"{BASE}/bookings/pending-payments", headers=HDR, timeout=15)
    rows3 = r2.json() if r2.status_code == 200 else []
    gone = not any(row.get("booking_id") == bk_id_pending for row in rows3)
    rec("after mark-paid-offline → disappears from /pending-payments", gone, "")

# ─── 3. mark-paid-offline mode variants ───────────────────────────
print("\n=== 3. mark-paid-offline mode variants ===")
mode_cases = [
    ("UPI (Direct)", "upi"),
    ("UPI (Razorpay)", "upi"),
    ("Card (Razorpay)", "card"),
    ("Wallet (Razorpay)", "card"),
    ("Cash", "cash"),
]
for input_mode, expected_canonical in mode_cases:
    # Create a brand-new booking each time
    phone = "98770" + str(int(time.time() * 100) % 100000)[-5:]
    payload = {
        "patient_name": f"P510 {input_mode[:6]}",
        "patient_phone": phone,
        "country_code": "+91",
        "reason": "mode test",
        "booking_date": "2026-12-31",
        "booking_time": "11:00",
        "mode": "in-person",
    }
    rr = requests.post(f"{BASE}/bookings", headers=HDR, json=payload, timeout=15)
    if rr.status_code != 200:
        rec(f"mark-paid-offline mode '{input_mode}'", False, f"booking create failed {rr.status_code}: {rr.text[:200]}")
        continue
    bk = rr.json()
    bid = bk.get("booking_id")
    r3 = requests.post(f"{BASE}/bookings/{bid}/mark-paid-offline",
                       headers=HDR, json={"amount_inr": 500, "mode": input_mode},
                       timeout=15)
    if r3.status_code != 200:
        rec(f"mark-paid-offline mode '{input_mode}' → 200", False, f"got {r3.status_code}: {r3.text[:200]}")
        continue
    doc = r3.json()
    actual_mode = doc.get("payment_mode")
    actual_ps = doc.get("payment_status")
    rec(f"mark-paid-offline '{input_mode}' → canonical mode '{expected_canonical}', payment_status=paid",
        actual_mode == expected_canonical and actual_ps == "paid",
        f"got payment_mode={actual_mode} payment_status={actual_ps}")
    time.sleep(0.05)

# ─── 4. POST /api/receipts mode variants ──────────────────────────
print("\n=== 4. POST /api/receipts mode acceptance ===")
ok_modes = [
    "Cash", "UPI (Direct)", "UPI (Razorpay)",
    "Card (Razorpay)", "Wallet (Razorpay)",
    "Cheque", "Other", "Pending Razorpay",
]
created_receipt_ids = []
for m in ok_modes:
    body = {
        "patient_name": "Receipt Mode Test",
        "patient_phone": "9888880000",
        "items": [{"description": f"Test {m}", "amount": 100, "qty": 1, "service_type": "Consultation"}],
        "mode": m,
    }
    rr = requests.post(f"{BASE}/receipts", headers=HDR, json=body, timeout=15)
    ok = rr.status_code == 200
    doc = rr.json() if ok else {}
    preserved = doc.get("mode") == m if ok else False
    if doc.get("receipt_id"):
        created_receipt_ids.append(doc["receipt_id"])
    rec(f"POST /receipts mode='{m}' → 200 & preserved",
        ok and preserved,
        f"status={rr.status_code} got_mode={doc.get('mode')!r} body_excerpt={rr.text[:150]}")

# Unknown mode → falls back to Other
body_bitcoin = {
    "patient_name": "Bitcoin Test",
    "items": [{"description": "weird mode", "amount": 50, "qty": 1}],
    "mode": "Bitcoin",
}
rr = requests.post(f"{BASE}/receipts", headers=HDR, json=body_bitcoin, timeout=15)
doc_bc = rr.json() if rr.status_code == 200 else {}
if doc_bc.get("receipt_id"):
    created_receipt_ids.append(doc_bc["receipt_id"])
rec("POST /receipts mode='Bitcoin' falls back to 'Other'",
    rr.status_code == 200 and doc_bc.get("mode") == "Other",
    f"status={rr.status_code} got_mode={doc_bc.get('mode')!r}")

# Cleanup the test receipts we created (owner-only delete)
print(f"\n(cleanup: deleting {len(created_receipt_ids)} test receipts)")
for rid in created_receipt_ids:
    try:
        requests.delete(f"{BASE}/receipts/{rid}", headers=HDR, timeout=10)
    except Exception:
        pass

# ─── 5. POST /api/payments/razorpay/order ────────────────────────
print("\n=== 5. POST /api/payments/razorpay/order ===")
order_body = {
    "amount_inr": 100,
    "target_kind": "other",
    "description": "phase 5.10 smoke",
    "patient_name": "Smoke Test",
    "patient_phone": "9876500000",
}
r = requests.post(f"{BASE}/payments/razorpay/order", headers=HDR, json=order_body, timeout=20)
ok = r.status_code == 200
body = {}
try:
    body = r.json()
except Exception:
    pass
rec("create order → 200", ok, f"status={r.status_code} body={r.text[:300]}")
rec("order response has order_id", bool(body.get("order_id")), str(body.get("order_id")))
rec("order response has key_id == rzp_test_SwKJbGYwyHwIVQ",
    body.get("key_id") == "rzp_test_SwKJbGYwyHwIVQ", str(body.get("key_id")))

# ─── 6. PATCH /api/clinic-settings fee_catalog + consultation_fee ─
print("\n=== 6. clinic-settings fee_catalog + consultation_fee_inr ===")
# First snapshot current settings
snap = requests.get(f"{BASE}/clinic-settings", headers=HDR, timeout=15)
snapshot = snap.json() if snap.status_code == 200 else {}
old_fc = snapshot.get("fee_catalog") or []
old_fee = snapshot.get("consultation_fee_inr") or 500

new_fee_catalog = [
    {"id": "fee-test-a", "category": "consultation", "name": "Phase 5.10 Test Item A",
     "amount_inr": 250, "gst_pct": 0, "description": "smoke A"},
    {"id": "fee-test-b", "category": "investigation", "name": "Phase 5.10 Test Item B",
     "amount_inr": 1500, "gst_pct": 18, "description": "smoke B"},
]
patch_body = {"fee_catalog": new_fee_catalog, "consultation_fee_inr": 800}
r = requests.patch(f"{BASE}/clinic-settings", headers=HDR, json=patch_body, timeout=20)
rec("PATCH /clinic-settings → 200", r.status_code == 200, f"status={r.status_code} body={r.text[:200]}")

r2 = requests.get(f"{BASE}/clinic-settings", headers=HDR, timeout=15)
re_fetched = r2.json() if r2.status_code == 200 else {}
rec("re-fetched consultation_fee_inr == 800",
    re_fetched.get("consultation_fee_inr") == 800,
    f"got {re_fetched.get('consultation_fee_inr')!r}")
fc_after = re_fetched.get("fee_catalog") or []
rec("re-fetched fee_catalog has >= 2 items",
    isinstance(fc_after, list) and len(fc_after) >= 2,
    f"len={len(fc_after)}")
have_a = any((it.get("id") == "fee-test-a" and float(it.get("amount_inr") or 0) == 250) for it in fc_after)
have_b = any((it.get("id") == "fee-test-b" and float(it.get("amount_inr") or 0) == 1500) for it in fc_after)
rec("fee_catalog persisted test items A & B",
    have_a and have_b,
    f"have_a={have_a} have_b={have_b} ids={[it.get('id') for it in fc_after]}")

# Restore
print("\n(cleanup: restoring previous clinic-settings)")
try:
    requests.patch(f"{BASE}/clinic-settings", headers=HDR,
                   json={"fee_catalog": old_fc, "consultation_fee_inr": old_fee}, timeout=20)
except Exception:
    pass

# ─── Summary ──────────────────────────────────────────────────────
total = len(results)
passed = sum(1 for r in results if r[0])
failed = total - passed
print("\n=============================================")
print(f"PASS: {passed}/{total}  FAIL: {failed}")
print("=============================================")
if failed:
    print("\nFAILED CHECKS:")
    for ok, name, detail in results:
        if not ok:
            print(f"  - {name} :: {detail}")
