"""
Smoke test for ConsultUro backend after the frontend-only "Letterhead UI"
iteration. Verifies:
  1) GET /api/clinic-settings (public) exposes the new fields with
     empty/default values.
  2) PATCH /api/clinic-settings (Primary Owner) can update the new fields,
     and persistence is verified via subsequent GET.
  3) GET /api/auth/me (Primary Owner) returns role + permission flags.
  4) GET /api/admin/primary-owner-analytics (Super Owner) returns 200.
"""
import os
import sys
import json
import requests

BASE = "https://urology-pro.preview.emergentagent.com/api"
OWNER_TOKEN = "test_session_1776770314741"          # primary_owner — sagar.joshi133@gmail.com
SO_TOKEN    = "test_so_session_smoke_1777447524636"  # super_owner   — app.consulturo@gmail.com

OWNER_HEADERS = {"Authorization": f"Bearer {OWNER_TOKEN}"}
SO_HEADERS    = {"Authorization": f"Bearer {SO_TOKEN}"}

PASS = 0
FAIL = 0
ERRORS = []


def check(label, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ✅ {label}")
    else:
        FAIL += 1
        ERRORS.append((label, detail))
        print(f"  ❌ {label}\n     -> {detail}")


# ───── Snapshot original clinic settings so we can restore exactly ─────
print("\n=== SNAPSHOT — original clinic-settings ===")
r0 = requests.get(f"{BASE}/clinic-settings", timeout=15)
check("GET /clinic-settings (snapshot) → 200", r0.status_code == 200,
      f"status={r0.status_code} body={r0.text[:200]}")
orig = r0.json() if r0.status_code == 200 else {}
orig_letterhead = orig.get("letterhead_image_b64", "")
orig_use_lh     = orig.get("use_letterhead", False)
orig_pe_html    = orig.get("patient_education_html", "")
orig_help_html  = orig.get("need_help_html", "")
print(f"   original use_letterhead={orig_use_lh!r} "
      f"letterhead_len={len(orig_letterhead) if isinstance(orig_letterhead,str) else 'N/A'} "
      f"pe_html_len={len(orig_pe_html) if isinstance(orig_pe_html,str) else 'N/A'} "
      f"help_html_len={len(orig_help_html) if isinstance(orig_help_html,str) else 'N/A'}")


# ───── 1) GET /clinic-settings (public, no auth) exposes new fields ─────
print("\n=== TEST 1 — GET /clinic-settings (public) exposes new Letterhead fields ===")
r = requests.get(f"{BASE}/clinic-settings", timeout=15)
check("GET /clinic-settings (no auth) → 200", r.status_code == 200,
      f"status={r.status_code}")
data = r.json() if r.status_code == 200 else {}
for fld in ("letterhead_image_b64", "use_letterhead",
            "patient_education_html", "need_help_html"):
    check(f"   field '{fld}' present in payload", fld in data,
          f"keys={sorted(list(data.keys()))[:25]}…")
check("letterhead_image_b64 is a string",
      isinstance(data.get("letterhead_image_b64"), str),
      f"got type={type(data.get('letterhead_image_b64')).__name__}")
check("use_letterhead is a bool",
      isinstance(data.get("use_letterhead"), bool),
      f"got value={data.get('use_letterhead')!r}")
check("patient_education_html is a string",
      isinstance(data.get("patient_education_html"), str),
      f"got type={type(data.get('patient_education_html')).__name__}")
check("need_help_html is a string",
      isinstance(data.get("need_help_html"), str),
      f"got type={type(data.get('need_help_html')).__name__}")


# ───── 2) PATCH /clinic-settings (Primary Owner) updates new fields ─────
print("\n=== TEST 2 — PATCH /clinic-settings (Primary Owner) updates Letterhead fields ===")
TINY_JPEG = ("data:image/jpeg;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAA"
             "C0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=")
patch_body = {
    "letterhead_image_b64":   TINY_JPEG,
    "use_letterhead":         True,
    "patient_education_html": "<ul><li>Test</li></ul>",
    "need_help_html":         "📞 +91 9000000000",
}
r = requests.patch(f"{BASE}/clinic-settings", json=patch_body,
                   headers=OWNER_HEADERS, timeout=15)
check("PATCH (owner) → 200", r.status_code == 200,
      f"status={r.status_code} body={r.text[:200]}")
patch_resp = r.json() if r.status_code == 200 else {}
check("PATCH response has ok:true",
      patch_resp.get("ok") is True,
      f"resp={patch_resp}")
check("PATCH response updated count == 4",
      patch_resp.get("updated") == 4,
      f"resp={patch_resp}")

# Confirm persistence via GET
r = requests.get(f"{BASE}/clinic-settings", timeout=15)
check("GET after PATCH → 200", r.status_code == 200, f"status={r.status_code}")
after = r.json() if r.status_code == 200 else {}
check("letterhead_image_b64 persisted",
      after.get("letterhead_image_b64") == TINY_JPEG,
      f"got first 60 chars: {str(after.get('letterhead_image_b64'))[:60]}")
check("use_letterhead == True",
      after.get("use_letterhead") is True,
      f"got={after.get('use_letterhead')!r}")
check("patient_education_html persisted",
      after.get("patient_education_html") == "<ul><li>Test</li></ul>",
      f"got={after.get('patient_education_html')!r}")
check("need_help_html persisted",
      after.get("need_help_html") == "📞 +91 9000000000",
      f"got={after.get('need_help_html')!r}")


# ───── 3) GET /auth/me (Primary Owner) returns role + flags ─────
print("\n=== TEST 3 — GET /auth/me (Primary Owner) ===")
r = requests.get(f"{BASE}/auth/me", headers=OWNER_HEADERS, timeout=15)
check("GET /auth/me (owner) → 200", r.status_code == 200,
      f"status={r.status_code} body={r.text[:200]}")
me = r.json() if r.status_code == 200 else {}
check("role == 'primary_owner'", me.get("role") == "primary_owner",
      f"got role={me.get('role')!r}")
for fld in ("can_prescribe", "can_manage_surgeries", "can_manage_availability"):
    check(f"flag '{fld}' present in /auth/me response", fld in me,
          f"keys={sorted(list(me.keys()))[:30]}…")
print(f"   OBSERVED FLAGS — can_prescribe={me.get('can_prescribe')!r} "
      f"can_manage_surgeries={me.get('can_manage_surgeries')!r} "
      f"can_manage_availability={me.get('can_manage_availability')!r}")
print(f"   role={me.get('role')!r}  effective_owner={me.get('effective_owner')!r}  "
      f"dashboard_full_access={me.get('dashboard_full_access')!r}")


# ───── 4) GET /admin/primary-owner-analytics (Super Owner) ─────
print("\n=== TEST 4 — GET /admin/primary-owner-analytics (Super Owner) ===")
r = requests.get(f"{BASE}/admin/primary-owner-analytics",
                 headers=SO_HEADERS, timeout=30)
check("GET /admin/primary-owner-analytics (super_owner) → 200",
      r.status_code == 200,
      f"status={r.status_code} body={r.text[:300]}")
if r.status_code == 200:
    body = r.json()
    # Endpoint may return either a list, or {items: [...]} — accept both.
    rows = body if isinstance(body, list) else body.get("items") or body.get("rows") or []
    check("response is well-formed (list or items[])",
          isinstance(rows, list),
          f"type={type(body).__name__}")
    check("at least one primary_owner row returned",
          len(rows) >= 1,
          f"row_count={len(rows)} body_keys={list(body.keys()) if isinstance(body, dict) else 'list'}")


# ───── RESET — restore the four Letterhead fields to clean defaults ─────
print("\n=== CLEANUP — reset Letterhead fields to empty/false ===")
reset_body = {
    "letterhead_image_b64":   "",
    "use_letterhead":         False,
    "patient_education_html": "",
    "need_help_html":         "",
}
r = requests.patch(f"{BASE}/clinic-settings", json=reset_body,
                   headers=OWNER_HEADERS, timeout=15)
check("PATCH reset → 200", r.status_code == 200,
      f"status={r.status_code} body={r.text[:200]}")
r = requests.get(f"{BASE}/clinic-settings", timeout=15)
fin = r.json() if r.status_code == 200 else {}
check("letterhead_image_b64 reset to ''",
      fin.get("letterhead_image_b64") == "",
      f"got len={len(str(fin.get('letterhead_image_b64')))}")
check("use_letterhead reset to False",
      fin.get("use_letterhead") is False,
      f"got={fin.get('use_letterhead')!r}")
check("patient_education_html reset to ''",
      fin.get("patient_education_html") == "",
      f"got={fin.get('patient_education_html')!r}")
check("need_help_html reset to ''",
      fin.get("need_help_html") == "",
      f"got={fin.get('need_help_html')!r}")


print(f"\n{'═'*60}")
print(f"RESULT: PASS={PASS}  FAIL={FAIL}")
if ERRORS:
    print("FAILED ASSERTIONS:")
    for label, det in ERRORS:
        print(f"  ❌ {label} -> {det}")
print(f"{'═'*60}")

sys.exit(0 if FAIL == 0 else 1)
