"""Brand Theme feature + public exposure verification.

Tests per review request for `brand_theme` on /api/clinic-settings
and public exposure via /api/clinics/by-slug/dr-joshi-uro.
"""
import os
import sys
import json
import requests

BASE = os.environ.get("BASE_URL", "https://urology-pro.preview.emergentagent.com")
API = BASE.rstrip("/") + "/api"
OWNER_TOKEN = "test_session_1776770314741"
CLINIC_ID = "clinic_a97b903f2fb2"
SLUG = "dr-joshi-uro"

passed = 0
failed = 0
failures = []


def check(cond, msg, ctx=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ✅ {msg}")
    else:
        failed += 1
        failures.append(f"{msg} :: {ctx}")
        print(f"  ❌ {msg}   ctx={ctx}")


def owner_headers():
    return {
        "Authorization": f"Bearer {OWNER_TOKEN}",
        "X-Clinic-Id": CLINIC_ID,
        "Content-Type": "application/json",
    }


def test_1_default_exposure():
    print("\n== TEST 1: Public anonymous GET /api/clinics/by-slug/dr-joshi-uro ==")
    r = requests.get(f"{API}/clinics/by-slug/{SLUG}", timeout=15)
    check(r.status_code == 200, "GET /api/clinics/by-slug returns 200", f"status={r.status_code}")
    if r.status_code != 200:
        print(f"   body: {r.text[:300]}")
        return None
    body = r.json()
    print(f"   body excerpt: slug={body.get('slug')}, name={body.get('name')}, brand_theme={body.get('brand_theme')}")
    check("brand_theme" in body, "response contains brand_theme key")
    bt = body.get("brand_theme")
    check(isinstance(bt, dict), "brand_theme is a dict", f"type={type(bt).__name__}")
    # Since we know saved state shows preset teal, but allow for other
    check(bt and ("preset" in bt or "primary" in bt), "brand_theme has preset or primary key",
          f"brand_theme={bt}")
    return bt


def test_2_patch_preset():
    print("\n== TEST 2: PATCH brand_theme preset=royal_blue ==")
    r = requests.patch(
        f"{API}/clinic-settings",
        headers=owner_headers(),
        json={"brand_theme": {"preset": "royal_blue"}},
        timeout=15,
    )
    check(r.status_code == 200, "PATCH preset → 200", f"status={r.status_code} body={r.text[:200]}")
    if r.status_code == 200:
        body = r.json()
        print(f"   body: {body}")
        check(body.get("ok") is True, "response ok=true")
        check(body.get("updated") == 1, f"response updated=1", f"updated={body.get('updated')}")


def test_3_get_reflects_patch():
    print("\n== TEST 3a: GET /api/clinic-settings (authenticated w/ X-Clinic-Id) reflects royal_blue ==")
    r = requests.get(f"{API}/clinic-settings", headers={"X-Clinic-Id": CLINIC_ID}, timeout=15)
    check(r.status_code == 200, "GET /api/clinic-settings → 200", f"status={r.status_code}")
    if r.status_code == 200:
        body = r.json()
        bt = body.get("brand_theme")
        print(f"   brand_theme: {bt}")
        check(bt == {"preset": "royal_blue"}, "brand_theme == {preset: royal_blue}", f"got {bt}")

    print("\n== TEST 3b: anonymous GET /api/clinics/by-slug reflects royal_blue ==")
    r = requests.get(f"{API}/clinics/by-slug/{SLUG}", timeout=15)
    check(r.status_code == 200, "GET by-slug anonymous → 200")
    if r.status_code == 200:
        bt = r.json().get("brand_theme")
        print(f"   brand_theme: {bt}")
        check(bt == {"preset": "royal_blue"}, "public brand_theme == {preset: royal_blue}", f"got {bt}")


def test_4_patch_custom_triplet():
    print("\n== TEST 4: PATCH custom triplet ==")
    triplet = {"primary": "#1E3A8A", "primaryLight": "#3B82F6", "primaryDark": "#172554"}
    r = requests.patch(
        f"{API}/clinic-settings",
        headers=owner_headers(),
        json={"brand_theme": triplet},
        timeout=15,
    )
    check(r.status_code == 200, "PATCH custom triplet → 200", f"status={r.status_code}")
    if r.status_code == 200:
        print(f"   body: {r.json()}")

    print("  -- GET authenticated --")
    r = requests.get(f"{API}/clinic-settings", headers={"X-Clinic-Id": CLINIC_ID}, timeout=15)
    if r.status_code == 200:
        bt = r.json().get("brand_theme")
        print(f"   brand_theme: {bt}")
        check(bt == triplet, "authed brand_theme == triplet", f"got {bt}")

    print("  -- GET public by-slug --")
    r = requests.get(f"{API}/clinics/by-slug/{SLUG}", timeout=15)
    if r.status_code == 200:
        bt = r.json().get("brand_theme")
        print(f"   brand_theme: {bt}")
        check(bt == triplet, "public brand_theme == triplet", f"got {bt}")


def test_5_restore_default():
    print("\n== TEST 5: Restore default teal ==")
    r = requests.patch(
        f"{API}/clinic-settings",
        headers=owner_headers(),
        json={"brand_theme": {"preset": "teal"}},
        timeout=15,
    )
    check(r.status_code == 200, "PATCH restore teal → 200", f"status={r.status_code}")

    r = requests.get(f"{API}/clinics/by-slug/{SLUG}", timeout=15)
    if r.status_code == 200:
        bt = r.json().get("brand_theme")
        print(f"   public brand_theme post-restore: {bt}")
        check(bt == {"preset": "teal"}, "post-restore public brand_theme == {preset:teal}", f"got {bt}")


def test_6_regression_smoke():
    print("\n== TEST 6: Regression — existing PATCH fields still work ==")
    # Capture original clinic_name
    r0 = requests.get(f"{API}/clinic-settings", headers={"X-Clinic-Id": CLINIC_ID}, timeout=15)
    original_name = r0.json().get("clinic_name") if r0.status_code == 200 else None
    print(f"   original clinic_name: {original_name!r}")

    new_name = "BrandThemeSmokeTest"
    r = requests.patch(
        f"{API}/clinic-settings",
        headers=owner_headers(),
        json={"clinic_name": new_name},
        timeout=15,
    )
    check(r.status_code == 200, "PATCH clinic_name → 200", f"status={r.status_code}")
    if r.status_code == 200:
        check(r.json().get("updated") == 1, "updated=1")

    r = requests.get(f"{API}/clinic-settings", headers={"X-Clinic-Id": CLINIC_ID}, timeout=15)
    if r.status_code == 200:
        body = r.json()
        check(body.get("clinic_name") == new_name, "clinic_name roundtrip", f"got {body.get('clinic_name')}")
        bt = body.get("brand_theme")
        check(bt == {"preset": "teal"}, "brand_theme preserved after clinic_name PATCH", f"got {bt}")

    # Revert name
    if original_name is not None:
        r = requests.patch(
            f"{API}/clinic-settings",
            headers=owner_headers(),
            json={"clinic_name": original_name},
            timeout=15,
        )
        check(r.status_code == 200, "revert clinic_name → 200")


def main():
    print(f"Testing against: {API}")
    print(f"Clinic: {SLUG} ({CLINIC_ID})")

    test_1_default_exposure()
    test_2_patch_preset()
    test_3_get_reflects_patch()
    test_4_patch_custom_triplet()
    test_5_restore_default()
    test_6_regression_smoke()

    print("\n" + "=" * 60)
    print(f"RESULT: {passed} passed, {failed} failed")
    if failures:
        print("\nFAILURES:")
        for f in failures:
            print(f"  - {f}")
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
