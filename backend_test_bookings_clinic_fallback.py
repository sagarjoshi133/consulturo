"""
Regression test — 2026-05-29 clinic_id fallback fix for POST /api/bookings
+ Phase 3.1 surgery endpoints smoke.
"""
import os
import sys
import requests

BASE = os.environ.get(
    "BACKEND_URL", "https://urology-pro.preview.emergentagent.com"
).rstrip("/") + "/api"
OWNER = "test_session_1776770314741"
EXPECTED_CLINIC = "clinic_a97b903f2fb2"

passed, failed = [], []


def chk(name, cond, extra=""):
    (passed if cond else failed).append(f"{'PASS' if cond else 'FAIL'} :: {name} {extra}")
    print(("✅ " if cond else "❌ ") + name + (" — " + extra if extra else ""))


def post_booking(payload, headers=None):
    return requests.post(f"{BASE}/bookings", json=payload, headers=headers or {}, timeout=30)


# ── 1) Anonymous POST (no auth, no header) — in-person ─────────────────
p1 = {
    "patient_name": "Reg Test InPerson",
    "patient_phone": "9991122001",
    "country_code": "+91",
    "patient_age": 40,
    "patient_gender": "Male",
    "booking_date": "2026-07-10",
    "booking_time": "10:00",
    "reason": "regression test in-person",
    "mode": "in-person",
}
r1 = post_booking(p1)
chk("Anon POST in-person → 200", r1.status_code == 200, f"got {r1.status_code} body={r1.text[:200]}")
b1 = r1.json() if r1.status_code == 200 else {}
chk(
    "Anon POST in-person → clinic_id == clinic_a97b903f2fb2",
    b1.get("clinic_id") == EXPECTED_CLINIC,
    f"got clinic_id={b1.get('clinic_id')!r}",
)
bid1 = b1.get("booking_id")

# Anon POST — online
p2 = {**p1, "patient_phone": "9991122002", "patient_name": "Reg Test Online", "mode": "online"}
r2 = post_booking(p2)
chk("Anon POST online → 200", r2.status_code == 200, f"got {r2.status_code} body={r2.text[:200]}")
b2 = r2.json() if r2.status_code == 200 else {}
chk(
    "Anon POST online → clinic_id == clinic_a97b903f2fb2",
    b2.get("clinic_id") == EXPECTED_CLINIC,
    f"got clinic_id={b2.get('clinic_id')!r}",
)
bid2 = b2.get("booking_id")

# ── 2) GET /api/bookings/all as owner → both visible ───────────────────
gh = {"Authorization": f"Bearer {OWNER}"}
rall = requests.get(f"{BASE}/bookings/all", headers=gh, timeout=30)
chk("GET /bookings/all (owner) → 200", rall.status_code == 200, f"got {rall.status_code}")
all_data = rall.json() if rall.status_code == 200 else []
# Sometimes wrapped
items = all_data if isinstance(all_data, list) else all_data.get("items") or all_data.get("bookings") or []
names = {it.get("patient_name") for it in items}
chk("Visibility: 'Reg Test InPerson' in /bookings/all", "Reg Test InPerson" in names)
chk("Visibility: 'Reg Test Online' in /bookings/all", "Reg Test Online" in names)
# Cross-check clinic_id on the fetched records
match1 = next((it for it in items if it.get("patient_name") == "Reg Test InPerson"), None)
match2 = next((it for it in items if it.get("patient_name") == "Reg Test Online"), None)
chk(
    "Stored clinic_id matches for in-person record",
    bool(match1) and match1.get("clinic_id") == EXPECTED_CLINIC,
    f"got {match1.get('clinic_id') if match1 else None!r}",
)
chk(
    "Stored clinic_id matches for online record",
    bool(match2) and match2.get("clinic_id") == EXPECTED_CLINIC,
    f"got {match2.get('clinic_id') if match2 else None!r}",
)

# ── 3) POST with explicit X-Clinic-Id header (valid clinic) ─────────────
p3 = {
    **p1,
    "patient_name": "Reg Test ExplicitHdr",
    "patient_phone": "9991122003",
    "booking_date": "2026-07-11",
}
r3 = post_booking(p3, headers={"X-Clinic-Id": EXPECTED_CLINIC})
chk("POST with explicit X-Clinic-Id (valid) → 200", r3.status_code == 200, f"got {r3.status_code}")
b3 = r3.json() if r3.status_code == 200 else {}
chk(
    "Explicit-header booking respects header clinic_id",
    b3.get("clinic_id") == EXPECTED_CLINIC,
    f"got {b3.get('clinic_id')!r}",
)
bid3 = b3.get("booking_id")

# ── 4) POST with invalid X-Clinic-Id (authenticated non-super-owner) → 403
p4 = {
    **p1,
    "patient_name": "Reg Test BadClinic",
    "patient_phone": "9991122004",
    "booking_date": "2026-07-12",
}
r4 = post_booking(p4, headers={**gh, "X-Clinic-Id": "nonexistent-clinic"})
chk(
    "Authenticated non-super-owner + bad clinic header → 403",
    r4.status_code == 403,
    f"got {r4.status_code} body={r4.text[:200]}",
)

# ── 5) Cleanup — delete the 2 test bookings via DELETE /api/bookings/{id}
for bid in [bid1, bid2, bid3]:
    if not bid:
        continue
    rd = requests.delete(f"{BASE}/bookings/{bid}", headers=gh, timeout=30)
    chk(f"DELETE /bookings/{bid} (owner) → 200", rd.status_code == 200, f"got {rd.status_code}")

# ── 6) Phase 3.1 surgery endpoints smoke ────────────────────────────────
rp = requests.get(f"{BASE}/surgeries/procedures", headers=gh, timeout=30)
chk("GET /surgeries/procedures → 200", rp.status_code == 200, f"got {rp.status_code}")
procs_data = rp.json() if rp.status_code == 200 else {}
# Could be wrapped or list
proc_list = procs_data if isinstance(procs_data, list) else procs_data.get("procedures") or procs_data.get("items") or []
chk("procedures list length == 50", len(proc_list) == 50, f"got {len(proc_list)}")
turp = next((p for p in proc_list if p.get("key") == "turp"), None)
pcnl = next((p for p in proc_list if p.get("key") == "pcnl"), None)
turp_min = (turp or {}).get("duration_min")
pcnl_min = (pcnl or {}).get("duration_min")
chk("TURP duration == 60", turp_min == 60, f"got {turp_min} (turp record: {turp})")
chk("PCNL duration == 120", pcnl_min == 120, f"got {pcnl_min} (pcnl record: {pcnl})")

rs = requests.get(f"{BASE}/surgeries/scheduled", headers=gh, timeout=30)
chk("GET /surgeries/scheduled → 200", rs.status_code == 200, f"got {rs.status_code}")
sched_data = rs.json() if rs.status_code == 200 else None
sched_list = sched_data if isinstance(sched_data, list) else (sched_data.get("items") if isinstance(sched_data, dict) else None)
chk("scheduled returns array-like", isinstance(sched_list, list), f"got type={type(sched_data).__name__}")

ro = requests.get(f"{BASE}/surgeries/ot-rooms", headers=gh, timeout=30)
chk("GET /surgeries/ot-rooms → 200", ro.status_code == 200, f"got {ro.status_code}")
rooms_data = ro.json() if ro.status_code == 200 else {}
rooms = rooms_data.get("rooms") if isinstance(rooms_data, dict) else None
chk("ot-rooms has 'rooms' list with >=1 OT-1", isinstance(rooms, list) and (
    "OT-1" in rooms or any(
        isinstance(r, dict) and (r.get("id") == "OT-1" or r.get("name") == "OT-1" or r.get("room_id") == "OT-1")
        for r in rooms
    )
), f"rooms={rooms}")

print("\n=== SUMMARY ===")
print(f"PASSED: {len(passed)}    FAILED: {len(failed)}")
for f in failed:
    print(f)
sys.exit(0 if not failed else 1)
