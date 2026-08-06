"""Phase 5.20 — Auto-WhatsApp post-PDF prompt — backend settings smoke test.

Verifies the two new clinic-settings keys:
  • whatsapp_auto_prompt_enabled (bool, default True)
  • country_code               (string, default "+91")

Plus ensures:
  • google_places_api_key is NEVER returned (only google_places_api_key_set).
  • No 5xx during any of the test calls.
"""
import json
import sys
import requests

BASE = "http://localhost:8001"
OWNER = "test_session_p5_20_1780992732246"  # Primary Owner (24h, freshly seeded)
CLINIC_ID = "clinic_a97b903f2fb2"  # Dr Joshi's Uro Clinic — owner's default clinic
TENANT_HDRS = {"X-Clinic-Id": CLINIC_ID}

results = []
def rec(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'} :: {name}  {detail}")


def get_settings(token=None, tenant=False):
    h = {}
    if token:
        h["Authorization"] = f"Bearer {token}"
    if tenant:
        h.update(TENANT_HDRS)
    return requests.get(f"{BASE}/api/clinic-settings", headers=h, timeout=15)


def patch_settings(payload, token=OWNER, tenant=True):
    h = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    if tenant:
        h.update(TENANT_HDRS)
    return requests.patch(
        f"{BASE}/api/clinic-settings",
        headers=h,
        data=json.dumps(payload),
        timeout=15,
    )


# ── 1. Fresh GET (no auth header) ─────────────────────────────────
r = get_settings()
rec("GET /api/clinic-settings (no auth) → 200", r.status_code == 200, f"status={r.status_code}")
body = r.json() if r.headers.get("content-type","").startswith("application/json") else {}
print("   keys snapshot:",
      "whatsapp_auto_prompt_enabled=", body.get("whatsapp_auto_prompt_enabled"),
      " country_code=", body.get("country_code"),
      " google_places_api_key_set=", body.get("google_places_api_key_set"))
# Defaults expectation
orig_wa = body.get("whatsapp_auto_prompt_enabled")
orig_cc = body.get("country_code")
rec("default whatsapp_auto_prompt_enabled == True",
    orig_wa is True,
    f"actual={orig_wa!r}")
rec("default country_code == '+91'",
    orig_cc == "+91",
    f"actual={orig_cc!r}")
rec("google_places_api_key NOT in response",
    "google_places_api_key" not in body,
    "leaked!" if "google_places_api_key" in body else "ok")
rec("google_places_api_key_set IS in response",
    "google_places_api_key_set" in body,
    f"value={body.get('google_places_api_key_set')}")

# ── 2. PATCH disable ───────────────────────────────────────────────
r = patch_settings({"whatsapp_auto_prompt_enabled": False})
rec("PATCH whatsapp_auto_prompt_enabled=false → 200",
    r.status_code == 200, f"status={r.status_code}  body={r.text[:200]}")
g = get_settings(tenant=True).json()
rec("GET reflects whatsapp_auto_prompt_enabled == False",
    g.get("whatsapp_auto_prompt_enabled") is False,
    f"actual={g.get('whatsapp_auto_prompt_enabled')!r}")
rec("country_code untouched after wa patch",
    g.get("country_code") == orig_cc,
    f"actual={g.get('country_code')!r}")

# ── 3. PATCH country code +1 then restore ─────────────────────────
r = patch_settings({"country_code": "+1"})
rec("PATCH country_code=+1 → 200",
    r.status_code == 200, f"status={r.status_code}  body={r.text[:200]}")
g = get_settings(tenant=True).json()
rec("GET reflects country_code == '+1'",
    g.get("country_code") == "+1",
    f"actual={g.get('country_code')!r}")
rec("whatsapp_auto_prompt_enabled untouched (still false)",
    g.get("whatsapp_auto_prompt_enabled") is False,
    f"actual={g.get('whatsapp_auto_prompt_enabled')!r}")
# restore
r = patch_settings({"country_code": "+91"})
rec("PATCH country_code=+91 (restore) → 200",
    r.status_code == 200, f"status={r.status_code}")
g = get_settings(tenant=True).json()
rec("country_code restored to '+91'",
    g.get("country_code") == "+91", f"actual={g.get('country_code')!r}")

# ── 4. Restore wa default ─────────────────────────────────────────
r = patch_settings({"whatsapp_auto_prompt_enabled": True})
rec("PATCH whatsapp_auto_prompt_enabled=true (restore) → 200",
    r.status_code == 200, f"status={r.status_code}")
g = get_settings(tenant=True).json()
rec("whatsapp_auto_prompt_enabled restored to True",
    g.get("whatsapp_auto_prompt_enabled") is True,
    f"actual={g.get('whatsapp_auto_prompt_enabled')!r}")

# ── 5. Invalid values — no 5xx ────────────────────────────────────
r = patch_settings({"whatsapp_auto_prompt_enabled": "yes"})
ok = r.status_code in (200, 422) and r.status_code < 500
rec("PATCH whatsapp_auto_prompt_enabled='yes' → not 5xx",
    ok, f"status={r.status_code}  body={r.text[:160]}")
r2 = patch_settings({"country_code": 12345})
ok2 = r2.status_code in (200, 422) and r2.status_code < 500
rec("PATCH country_code=12345 (int) → not 5xx",
    ok2, f"status={r2.status_code}  body={r2.text[:160]}")

# After invalid values — confirm state of the two fields and that
# nothing got 5xx-corrupted.
g = get_settings().json()
# If Pydantic coerced "yes" → True, that's still acceptable.
wa_final = g.get("whatsapp_auto_prompt_enabled")
cc_final = g.get("country_code")
rec("post-invalid GET still 200 with sane wa value",
    wa_final in (True, False),
    f"actual={wa_final!r}")
rec("post-invalid GET still 200 with sane cc value (string)",
    isinstance(cc_final, str),
    f"actual={cc_final!r} ({type(cc_final).__name__})")

# Restore desired final state (defaults).
patch_settings({"whatsapp_auto_prompt_enabled": True, "country_code": "+91"})

# ── 6. No leak final check ────────────────────────────────────────
g = get_settings().json()
rec("FINAL: google_places_api_key NOT in response",
    "google_places_api_key" not in g, "leaked!" if "google_places_api_key" in g else "ok")
rec("FINAL: google_places_api_key_set IS in response",
    "google_places_api_key_set" in g,
    f"value={g.get('google_places_api_key_set')}")
rec("FINAL: whatsapp_auto_prompt_enabled is plain bool",
    isinstance(g.get("whatsapp_auto_prompt_enabled"), bool),
    f"value={g.get('whatsapp_auto_prompt_enabled')!r}  type={type(g.get('whatsapp_auto_prompt_enabled')).__name__}")
rec("FINAL: country_code is plain string '+91'",
    g.get("country_code") == "+91",
    f"value={g.get('country_code')!r}")

# Summary
print()
total = len(results)
passed = sum(1 for _, ok, _ in results if ok)
print(f"=== {passed}/{total} PASS ===")
sys.exit(0 if passed == total else 1)
