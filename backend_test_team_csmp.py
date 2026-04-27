"""
Quick regression: GET /api/team must surface can_send_personal_messages
per row after the one-line fix in list_team (server.py ~3500-3534).

Test plan (from review request):
- As owner, PATCH /api/team/dr.test@example.com {can_send_personal_messages: true}
- GET /api/team and confirm that row contains can_send_personal_messages: true
- Toggle back to false, GET /api/team again, confirm it now shows false
- Owner row should always show can_send_personal_messages: true (default for owner)
"""
import os
import sys
import requests

BASE_URL = os.environ.get("BACKEND_URL", "https://urology-pro.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

OWNER_TOKEN = "test_session_1776770314741"
OWNER_EMAIL = "sagar.joshi133@gmail.com"
DOCTOR_TOKEN = "test_doc_1776771431524"
DOCTOR_EMAIL = "dr.test@example.com"

passes = 0
fails = []


def assert_eq(label, got, want):
    global passes
    if got == want:
        print(f"  PASS: {label} == {want!r}")
        passes += 1
    else:
        msg = f"  FAIL: {label}: got {got!r}, want {want!r}"
        print(msg)
        fails.append(msg)


def H(token):
    return {"Authorization": f"Bearer {token}"}


def fetch_team():
    r = requests.get(f"{API}/team", headers=H(OWNER_TOKEN), timeout=15)
    assert r.status_code == 200, f"GET /api/team failed: {r.status_code} {r.text}"
    return r.json()


def find_row(team, email):
    for row in team:
        if row.get("email") == email:
            return row
    return None


def patch_flag(email, value):
    r = requests.patch(
        f"{API}/team/{email}",
        json={"can_send_personal_messages": value},
        headers=H(OWNER_TOKEN),
        timeout=15,
    )
    assert r.status_code == 200, f"PATCH /api/team/{email} failed: {r.status_code} {r.text}"
    return r.json()


def main():
    print(f"Backend: {API}")
    print(f"Owner token: {OWNER_TOKEN[:20]}...")

    # Sanity: list team and locate doctor row
    print("\n[Step 0] GET /api/team baseline")
    team = fetch_team()
    print(f"  team rows: {len(team)}")
    sample_keys = sorted(team[0].keys()) if team else []
    print(f"  row keys (sample): {sample_keys}")

    doc_row = find_row(team, DOCTOR_EMAIL)
    if not doc_row:
        print(f"  FAIL: doctor row {DOCTOR_EMAIL} not present in team list")
        fails.append("doctor row missing")
        return
    print(f"  doctor row baseline: {doc_row}")

    # Schema sanity: every row should now have can_send_personal_messages key
    print("\n[Step 1] Verify can_send_personal_messages key present on every row")
    missing = [r.get("email") for r in team if "can_send_personal_messages" not in r]
    if missing:
        msg = f"  FAIL: rows missing can_send_personal_messages: {missing}"
        print(msg)
        fails.append(msg)
    else:
        print(f"  PASS: all {len(team)} rows have can_send_personal_messages key")
        passes_local = 1
        global passes
        passes += passes_local

    # Owner row default check (role==owner -> True)
    print("\n[Step 2] Owner row always shows can_send_personal_messages: true (role default)")
    owner_row = find_row(team, OWNER_EMAIL)
    if owner_row is None:
        print(f"  FAIL: owner row {OWNER_EMAIL} not in team list")
        fails.append("owner row missing")
    else:
        assert_eq(
            "owner_row.can_send_personal_messages",
            owner_row.get("can_send_personal_messages"),
            True,
        )

    # PATCH the doctor to True
    print(f"\n[Step 3] PATCH {DOCTOR_EMAIL} can_send_personal_messages=true")
    resp = patch_flag(DOCTOR_EMAIL, True)
    print(f"  PATCH response: {resp}")

    print("\n[Step 4] GET /api/team and verify doctor row now shows true")
    team = fetch_team()
    doc_row = find_row(team, DOCTOR_EMAIL)
    print(f"  doctor row after PATCH(True): {doc_row}")
    assert_eq(
        "doctor_row.can_send_personal_messages (after PATCH true)",
        doc_row.get("can_send_personal_messages"),
        True,
    )

    # Toggle back to False
    print(f"\n[Step 5] PATCH {DOCTOR_EMAIL} can_send_personal_messages=false")
    resp = patch_flag(DOCTOR_EMAIL, False)
    print(f"  PATCH response: {resp}")

    print("\n[Step 6] GET /api/team and verify doctor row now shows false")
    team = fetch_team()
    doc_row = find_row(team, DOCTOR_EMAIL)
    print(f"  doctor row after PATCH(False): {doc_row}")
    assert_eq(
        "doctor_row.can_send_personal_messages (after PATCH false)",
        doc_row.get("can_send_personal_messages"),
        False,
    )

    # Re-check owner row still True
    print("\n[Step 7] Owner row still shows true after doctor toggles")
    owner_row = find_row(team, OWNER_EMAIL)
    assert_eq(
        "owner_row.can_send_personal_messages (post-toggles)",
        owner_row.get("can_send_personal_messages"),
        True,
    )

    print("\n=========================================")
    print(f"PASSED: {passes}")
    print(f"FAILED: {len(fails)}")
    if fails:
        print("\nFailures:")
        for f in fails:
            print(f"  - {f}")
        sys.exit(1)
    else:
        print("ALL CHECKS PASS ✅")


if __name__ == "__main__":
    main()
