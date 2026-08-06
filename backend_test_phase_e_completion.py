"""Phase E completion smoke — multi-tenant scoping for analytics + referrers.

Tests against the public EXPO_PUBLIC_BACKEND_URL.
"""
import json
import os
import sys
import requests

BASE = os.environ.get("BASE_URL", "https://urology-pro.preview.emergentagent.com/api")

OWNER_TOKEN = "test_session_1776770314741"   # primary_owner sagar.joshi133@gmail.com
SO_TOKEN = "test_so_session_phaseE_1777478140409"  # super_owner app.consulturo@gmail.com
DEFAULT_CLINIC_ID = "clinic_a97b903f2fb2"

PASS, FAIL = 0, 0
FAILURES = []


def chk(label, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ✅ {label}")
    else:
        FAIL += 1
        FAILURES.append((label, detail))
        print(f"  ❌ {label} :: {detail}")


def hdr(token, clinic_id=None):
    h = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    if clinic_id is not None:
        h["X-Clinic-Id"] = clinic_id
    return h


def show_excerpt(r, n=240):
    try:
        return r.text[:n]
    except Exception:
        return ""


# ───────────────────────────────────────────────────────────────────────
print("\n=== TEST 1 — Analytics dashboard tenant scoping ===\n")

# 1a. primary_owner WITHOUT X-Clinic-Id
print("1a. primary_owner — no X-Clinic-Id header")
r = requests.get(f"{BASE}/analytics/dashboard", headers=hdr(OWNER_TOKEN), timeout=30)
chk("HTTP 200 (primary_owner, no header)", r.status_code == 200, f"{r.status_code} {show_excerpt(r)}")
owner_no_hdr = r.json() if r.status_code == 200 else {}
chk("clinic_id == default clinic", owner_no_hdr.get("clinic_id") == DEFAULT_CLINIC_ID,
    f"got {owner_no_hdr.get('clinic_id')!r}")
# Response shape
required_keys = {"totals", "monthly_bookings", "monthly_surgeries", "monthly_prescriptions",
                 "daily_bookings", "mode_breakdown", "status_breakdown",
                 "top_diagnoses", "top_surgeries", "top_referrers", "generated_at", "clinic_id"}
missing = required_keys - set(owner_no_hdr.keys())
chk("All response keys present", not missing, f"missing={missing}")
totals = owner_no_hdr.get("totals", {})
required_totals = {"bookings", "confirmed_bookings", "pending_bookings",
                   "cancelled_bookings", "surgeries", "prescriptions", "patients"}
missing_t = required_totals - set(totals.keys())
chk("totals has all 7 keys", not missing_t, f"missing={missing_t}")
chk("totals.bookings > 0 (default clinic populated)", totals.get("bookings", 0) > 0,
    f"bookings={totals.get('bookings')}")
chk("totals.surgeries > 0 (default clinic populated)", totals.get("surgeries", 0) > 0,
    f"surgeries={totals.get('surgeries')}")
chk("monthly_bookings is list of 12", isinstance(owner_no_hdr.get("monthly_bookings"), list)
    and len(owner_no_hdr["monthly_bookings"]) == 12,
    f"len={len(owner_no_hdr.get('monthly_bookings') or [])}")
chk("daily_bookings is list of 14", isinstance(owner_no_hdr.get("daily_bookings"), list)
    and len(owner_no_hdr["daily_bookings"]) == 14,
    f"len={len(owner_no_hdr.get('daily_bookings') or [])}")
chk("status_breakdown matches totals (confirmed)",
    owner_no_hdr.get("status_breakdown", {}).get("confirmed") == totals.get("confirmed_bookings"))
chk("status_breakdown matches totals (cancelled)",
    owner_no_hdr.get("status_breakdown", {}).get("cancelled") == totals.get("cancelled_bookings"))

# 1b. primary_owner WITH X-Clinic-Id == own clinic
print("\n1b. primary_owner — X-Clinic-Id: <own clinic>")
r2 = requests.get(f"{BASE}/analytics/dashboard", headers=hdr(OWNER_TOKEN, DEFAULT_CLINIC_ID), timeout=30)
chk("HTTP 200 (primary_owner, header=own)", r2.status_code == 200, f"{r2.status_code}")
owner_with_hdr = r2.json() if r2.status_code == 200 else {}
chk("clinic_id same as own", owner_with_hdr.get("clinic_id") == DEFAULT_CLINIC_ID)
chk("totals match no-header response (same scope)",
    owner_with_hdr.get("totals") == owner_no_hdr.get("totals"),
    f"with={owner_with_hdr.get('totals')} vs no-hdr={owner_no_hdr.get('totals')}")

# 1c. super_owner without X-Clinic-Id → unscoped (clinic_id=None)
print("\n1c. super_owner — no X-Clinic-Id header (cross-clinic)")
r3 = requests.get(f"{BASE}/analytics/dashboard", headers=hdr(SO_TOKEN), timeout=30)
chk("HTTP 200 (super_owner, no header)", r3.status_code == 200, f"{r3.status_code} {show_excerpt(r3)}")
so_no_hdr = r3.json() if r3.status_code == 200 else {}
chk("clinic_id is None (super_owner unscoped)", so_no_hdr.get("clinic_id") is None,
    f"got {so_no_hdr.get('clinic_id')!r}")
# unscoped totals should be >= scoped totals
chk("super_owner totals.bookings >= owner totals.bookings",
    so_no_hdr.get("totals", {}).get("bookings", 0) >= totals.get("bookings", 0))
chk("super_owner totals.surgeries >= owner totals.surgeries",
    so_no_hdr.get("totals", {}).get("surgeries", 0) >= totals.get("surgeries", 0))

# 1d. primary_owner with non-member clinic_id → 403
print("\n1d. primary_owner — X-Clinic-Id of unknown clinic → 403")
r4 = requests.get(f"{BASE}/analytics/dashboard",
                  headers=hdr(OWNER_TOKEN, "clinic_does_not_exist"), timeout=30)
chk("HTTP 403 (non-member clinic)", r4.status_code == 403, f"{r4.status_code} {show_excerpt(r4)}")

# ───────────────────────────────────────────────────────────────────────
print("\n=== TEST 2 — Referrers CRUD tenant scoping ===\n")

# Snapshot existing referrer ids to ensure we delete only what we create
r_pre = requests.get(f"{BASE}/referrers", headers=hdr(OWNER_TOKEN), timeout=30)
pre_ids = set()
if r_pre.status_code == 200:
    pre_ids = {it.get("referrer_id") for it in r_pre.json()}

# 2a. POST as primary_owner
import time
unique_name = f"Dr Phase E Test {int(time.time())}"
payload = {
    "name": unique_name,
    "phone": "+919999911111",
    "whatsapp": "+919999911111",
    "email": "phaseE@example.com",
    "clinic": "Phase E Clinic",
    "speciality": "Urology",
    "city": "Vadodara",
    "notes": "Phase E scoping test",
}
print("2a. POST /api/referrers as primary_owner")
r5 = requests.post(f"{BASE}/referrers", headers=hdr(OWNER_TOKEN),
                   data=json.dumps(payload), timeout=30)
chk("HTTP 200 (POST referrer)", r5.status_code == 200, f"{r5.status_code} {show_excerpt(r5)}")
created = r5.json() if r5.status_code == 200 else {}
ref_id = created.get("referrer_id")
chk("referrer_id matches ref_*", isinstance(ref_id, str) and ref_id.startswith("ref_"),
    f"got {ref_id!r}")
chk("clinic_id == default clinic on created doc",
    created.get("clinic_id") == DEFAULT_CLINIC_ID,
    f"got {created.get('clinic_id')!r}")
chk("name persisted", created.get("name") == unique_name)
chk("phone persisted", created.get("phone") == "+919999911111")

# 2b. GET list as primary_owner — should be scoped, all clinic_id == default
print("\n2b. GET /api/referrers as primary_owner")
r6 = requests.get(f"{BASE}/referrers", headers=hdr(OWNER_TOKEN), timeout=30)
chk("HTTP 200 (list)", r6.status_code == 200, f"{r6.status_code}")
items = r6.json() if r6.status_code == 200 else []
chk("List is non-empty", isinstance(items, list) and len(items) >= 1)
all_scoped = all(it.get("clinic_id") == DEFAULT_CLINIC_ID for it in items)
chk("ALL items carry clinic_id == default clinic", all_scoped,
    f"items with other clinic_id={[it.get('clinic_id') for it in items if it.get('clinic_id') != DEFAULT_CLINIC_ID]}")
all_have_count = all("surgery_count" in it for it in items)
chk("All items have surgery_count", all_have_count)
created_in_list = any(it.get("referrer_id") == ref_id for it in items)
chk("Newly-created referrer present in list", created_in_list)

# 2c. PATCH as primary_owner
print("\n2c. PATCH /api/referrers/{id} as primary_owner")
patch_body = {**payload, "clinic": "Updated Phase E Clinic", "speciality": "General Surgery"}
r7 = requests.patch(f"{BASE}/referrers/{ref_id}", headers=hdr(OWNER_TOKEN),
                    data=json.dumps(patch_body), timeout=30)
chk("HTTP 200 (PATCH within own clinic)", r7.status_code == 200, f"{r7.status_code} {show_excerpt(r7)}")
patched = r7.json() if r7.status_code == 200 else {}
chk("clinic field updated", patched.get("clinic") == "Updated Phase E Clinic")
chk("speciality updated", patched.get("speciality") == "General Surgery")

# 2d. PATCH non-existent / cross-tenant → 404
print("\n2d. PATCH /api/referrers/{bogus} → 404")
r8 = requests.patch(f"{BASE}/referrers/ref_does_not_exist_xyz",
                    headers=hdr(OWNER_TOKEN),
                    data=json.dumps({"name": "x"}), timeout=30)
chk("HTTP 404 (bogus referrer)", r8.status_code == 404, f"{r8.status_code} {show_excerpt(r8)}")

# 2e. DELETE referrer
print("\n2e. DELETE /api/referrers/{id} as primary_owner")
r9 = requests.delete(f"{BASE}/referrers/{ref_id}", headers=hdr(OWNER_TOKEN), timeout=30)
chk("HTTP 200 (DELETE)", r9.status_code == 200, f"{r9.status_code} {show_excerpt(r9)}")
chk("DELETE response ok=true", r9.json().get("ok") is True if r9.status_code == 200 else False)

# Idempotent re-delete → 404
r10 = requests.delete(f"{BASE}/referrers/{ref_id}", headers=hdr(OWNER_TOKEN), timeout=30)
chk("HTTP 404 (re-DELETE)", r10.status_code == 404, f"{r10.status_code}")

# 2f. super_owner GET without X-Clinic-Id sees all clinics' referrers
print("\n2f. GET /api/referrers as super_owner (no header) — should be unscoped")
r11 = requests.get(f"{BASE}/referrers", headers=hdr(SO_TOKEN), timeout=30)
chk("HTTP 200 (super_owner list, no header)", r11.status_code == 200, f"{r11.status_code}")

# ───────────────────────────────────────────────────────────────────────
print("\n=== TEST 3 — Regression smoke (primary_owner) ===\n")

smoke_endpoints = [
    "/auth/me",
    "/clinics",
    "/bookings/all",
    "/prescriptions",
    "/clinic-settings",
]
for ep in smoke_endpoints:
    rr = requests.get(f"{BASE}{ep}", headers=hdr(OWNER_TOKEN), timeout=30)
    chk(f"GET {ep} → 200", rr.status_code == 200, f"{rr.status_code} {show_excerpt(rr,160)}")

# ───────────────────────────────────────────────────────────────────────
print("\n=== CLEANUP — verify no test referrers left ===\n")

r_post = requests.get(f"{BASE}/referrers", headers=hdr(OWNER_TOKEN), timeout=30)
post_ids = set()
if r_post.status_code == 200:
    post_ids = {it.get("referrer_id") for it in r_post.json()}
leaked = (post_ids - pre_ids)
chk("No test referrers remain (post == pre)", not leaked, f"leaked={leaked}")

# ───────────────────────────────────────────────────────────────────────
print(f"\n=== RESULT: {PASS} PASS / {FAIL} FAIL ===")
if FAILURES:
    print("\nFAILURES:")
    for label, det in FAILURES:
        print(f"  • {label} :: {det}")
sys.exit(0 if FAIL == 0 else 1)
