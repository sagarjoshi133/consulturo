"""Phase 3.1 OT Scheduling backend tests.

Tests the new OT scheduling endpoints in /app/backend/routers/surgeries.py.
"""

import json
import sys
from typing import Any, Dict, List, Optional

import httpx

BASE = "http://localhost:8001"
OWNER_TOKEN = "test_session_1776770314741"
EXPECTED_CLINIC = "clinic_a97b903f2fb2"

H_OWNER = {"Authorization": f"Bearer {OWNER_TOKEN}", "Content-Type": "application/json"}
H_NO_AUTH = {"Content-Type": "application/json"}

results: List[tuple] = []
created_surgery_ids: List[str] = []


def chk(name: str, cond: bool, detail: str = "") -> None:
    tag = "PASS" if cond else "FAIL"
    results.append((tag, name, detail))
    print(f"[{tag}] {name}" + (f" — {detail}" if detail else ""))


def cleanup() -> None:
    for sid in created_surgery_ids:
        try:
            httpx.delete(f"{BASE}/api/surgeries/{sid}", headers=H_OWNER, timeout=10)
        except Exception:
            pass


def main() -> int:
    client = httpx.Client(timeout=20)

    # ───────────────── 1. GET /api/surgeries/procedures ─────────────────
    r = client.get(f"{BASE}/api/surgeries/procedures", headers=H_OWNER)
    chk("procedures: 200", r.status_code == 200, f"status={r.status_code}")
    j = r.json() if r.status_code == 200 else {}
    chk("procedures: total == 50", j.get("total") == 50, f"total={j.get('total')}")
    chk("procedures: default_duration_min == 60", j.get("default_duration_min") == 60)
    procs = j.get("procedures") or []
    chk("procedures: list non-empty", len(procs) >= 50, f"len={len(procs)}")
    if procs:
        p0 = procs[0]
        chk(
            "procedures: entry has key/category/name/anesthesia/duration_min",
            all(k in p0 for k in ("key", "category", "name", "anesthesia", "duration_min"))
            and isinstance(p0["name"], dict)
            and all(lk in p0["name"] for lk in ("en", "hi", "gu")),
            f"sample={list(p0.keys())}",
        )
    by_key = {p["key"]: p for p in procs}
    chk("procedures: turp → 60", by_key.get("turp", {}).get("duration_min") == 60,
        f"turp={by_key.get('turp', {}).get('duration_min')}")
    chk("procedures: pcnl → 120", by_key.get("pcnl", {}).get("duration_min") == 120,
        f"pcnl={by_key.get('pcnl', {}).get('duration_min')}")
    chk("procedures: rirs → 90", by_key.get("rirs", {}).get("duration_min") == 90,
        f"rirs={by_key.get('rirs', {}).get('duration_min')}")

    # ───────────────── 2. GET /api/surgeries/ot-rooms ─────────────────
    r = client.get(f"{BASE}/api/surgeries/ot-rooms", headers=H_OWNER)
    chk("ot-rooms: 200", r.status_code == 200)
    rooms_j = r.json() if r.status_code == 200 else {}
    rooms = rooms_j.get("rooms") or []
    chk("ot-rooms: contains OT-1", "OT-1" in rooms, f"rooms={rooms}")

    # ───────────────── 3. POST /api/surgeries — new scheduling fields ─────
    sched_body = {
        "patient_phone": "9876500111",
        "patient_name": "Rajesh Khanna",
        "surgery_name": "TURP",
        "date": "",
        "procedure_key": "turp",
        "scheduled_date": "2026-07-15",
        "scheduled_time": "10:00",
        "ot_room": "OT-1",
        "surgery_status": "scheduled",
    }
    r = client.post(f"{BASE}/api/surgeries", json=sched_body, headers=H_OWNER)
    chk("POST surgery (scheduled): 200", r.status_code == 200,
        f"status={r.status_code} body={r.text[:200]}")
    if r.status_code == 200:
        d = r.json()
        sched_sid = d.get("surgery_id")
        if sched_sid:
            created_surgery_ids.append(sched_sid)
        chk("POST scheduled: surgery_status=scheduled", d.get("surgery_status") == "scheduled",
            f"got={d.get('surgery_status')}")
        chk("POST scheduled: estimated_duration_min=60 (turp default)",
            d.get("estimated_duration_min") == 60,
            f"got={d.get('estimated_duration_min')}")
        chk("POST scheduled: ot_room=OT-1", d.get("ot_room") == "OT-1",
            f"got={d.get('ot_room')}")
        chk("POST scheduled: clinic_id matches",
            d.get("clinic_id") == EXPECTED_CLINIC,
            f"got={d.get('clinic_id')}")
        chk("POST scheduled: procedure_key=turp", d.get("procedure_key") == "turp")
        chk("POST scheduled: scheduled_date=2026-07-15", d.get("scheduled_date") == "2026-07-15")
        chk("POST scheduled: scheduled_time=10:00", d.get("scheduled_time") == "10:00")
    else:
        sched_sid = None

    # Legacy POST — no new fields
    legacy_body = {
        "patient_phone": "9876500222",
        "patient_name": "Lata Mangeshkar",
        "surgery_name": "Cystoscopy",
        "date": "2026-05-20",
    }
    r = client.post(f"{BASE}/api/surgeries", json=legacy_body, headers=H_OWNER)
    chk("POST legacy surgery: 200", r.status_code == 200,
        f"status={r.status_code} body={r.text[:200]}")
    if r.status_code == 200:
        d = r.json()
        legacy_sid = d.get("surgery_id")
        if legacy_sid:
            created_surgery_ids.append(legacy_sid)
        chk("POST legacy: surgery_status=completed (default)",
            d.get("surgery_status") == "completed",
            f"got={d.get('surgery_status')}")
        chk("POST legacy: ot_room=OT-1 (default)", d.get("ot_room") == "OT-1",
            f"got={d.get('ot_room')}")
        chk("POST legacy: estimated_duration_min=60 (default)",
            d.get("estimated_duration_min") == 60,
            f"got={d.get('estimated_duration_min')}")

    # ───────────────── 4. GET /api/surgeries/conflicts ─────────────────
    if sched_sid:
        # Overlapping slot in same room → ≥1 conflict
        r = client.get(
            f"{BASE}/api/surgeries/conflicts",
            params={"scheduled_date": "2026-07-15", "scheduled_time": "10:30",
                    "duration_min": 45, "ot_room": "OT-1"},
            headers=H_OWNER,
        )
        chk("conflicts overlap: 200", r.status_code == 200, f"status={r.status_code}")
        j = r.json() if r.status_code == 200 else {}
        chk("conflicts overlap: ≥1 conflict", len(j.get("conflicts") or []) >= 1,
            f"got={len(j.get('conflicts') or [])}")
        # Find our scheduled surgery in the conflict list
        ids = [c.get("surgery_id") for c in j.get("conflicts") or []]
        chk("conflicts overlap: includes scheduled sid", sched_sid in ids,
            f"ids={ids}")

        # Non-overlapping slot → 0 conflicts
        r = client.get(
            f"{BASE}/api/surgeries/conflicts",
            params={"scheduled_date": "2026-07-15", "scheduled_time": "12:00",
                    "duration_min": 45, "ot_room": "OT-1"},
            headers=H_OWNER,
        )
        chk("conflicts 12:00: 200", r.status_code == 200)
        j = r.json() if r.status_code == 200 else {}
        chk("conflicts 12:00: 0 conflicts", len(j.get("conflicts") or []) == 0,
            f"got={j.get('conflicts')}")

        # Different room → 0 conflicts
        r = client.get(
            f"{BASE}/api/surgeries/conflicts",
            params={"scheduled_date": "2026-07-15", "scheduled_time": "10:30",
                    "duration_min": 45, "ot_room": "OT-2"},
            headers=H_OWNER,
        )
        chk("conflicts OT-2: 200", r.status_code == 200)
        j = r.json() if r.status_code == 200 else {}
        chk("conflicts OT-2: 0 conflicts", len(j.get("conflicts") or []) == 0,
            f"got={j.get('conflicts')}")

        # Exclude self → 0 conflicts
        r = client.get(
            f"{BASE}/api/surgeries/conflicts",
            params={"scheduled_date": "2026-07-15", "scheduled_time": "10:30",
                    "duration_min": 45, "ot_room": "OT-1",
                    "exclude_surgery_id": sched_sid},
            headers=H_OWNER,
        )
        chk("conflicts exclude-self: 200", r.status_code == 200)
        j = r.json() if r.status_code == 200 else {}
        chk("conflicts exclude-self: 0 conflicts", len(j.get("conflicts") or []) == 0,
            f"got={j.get('conflicts')}")

    # Validation: invalid time format → 400
    r = client.get(
        f"{BASE}/api/surgeries/conflicts",
        params={"scheduled_date": "2026-07-15", "scheduled_time": "bogus",
                "duration_min": 45, "ot_room": "OT-1"},
        headers=H_OWNER,
    )
    chk("conflicts invalid time → 400", r.status_code == 400, f"status={r.status_code}")

    # Validation: duration 0 → 400
    r = client.get(
        f"{BASE}/api/surgeries/conflicts",
        params={"scheduled_date": "2026-07-15", "scheduled_time": "10:00",
                "duration_min": 0, "ot_room": "OT-1"},
        headers=H_OWNER,
    )
    chk("conflicts duration=0 → 400", r.status_code == 400, f"status={r.status_code}")

    # Validation: duration negative → 400
    r = client.get(
        f"{BASE}/api/surgeries/conflicts",
        params={"scheduled_date": "2026-07-15", "scheduled_time": "10:00",
                "duration_min": -10, "ot_room": "OT-1"},
        headers=H_OWNER,
    )
    chk("conflicts duration=-10 → 400", r.status_code == 400, f"status={r.status_code}")

    # ───────────────── 5. GET /api/surgeries/scheduled ─────────────────
    if sched_sid:
        r = client.get(
            f"{BASE}/api/surgeries/scheduled",
            params={"from_date": "2026-07-01", "to_date": "2026-07-31"},
            headers=H_OWNER,
        )
        chk("scheduled July range: 200", r.status_code == 200)
        rows = r.json() if r.status_code == 200 else []
        ids = [s.get("surgery_id") for s in rows]
        chk("scheduled July range: contains our sid", sched_sid in ids,
            f"got_ids={ids[:5]}")

        # Future-empty range
        r = client.get(
            f"{BASE}/api/surgeries/scheduled",
            params={"from_date": "2027-01-01"},
            headers=H_OWNER,
        )
        chk("scheduled 2027+: 200", r.status_code == 200)
        rows = r.json() if r.status_code == 200 else []
        chk("scheduled 2027+: empty", len(rows) == 0, f"got_len={len(rows)}")

        # status=scheduled
        r = client.get(
            f"{BASE}/api/surgeries/scheduled",
            params={"status": "scheduled"},
            headers=H_OWNER,
        )
        chk("scheduled status=scheduled: 200", r.status_code == 200)
        rows = r.json() if r.status_code == 200 else []
        ids = [s.get("surgery_id") for s in rows]
        chk("scheduled status=scheduled: contains our sid", sched_sid in ids,
            f"got_count={len(ids)}")

        # status=completed should NOT include our scheduled sid
        r = client.get(
            f"{BASE}/api/surgeries/scheduled",
            params={"status": "completed"},
            headers=H_OWNER,
        )
        chk("scheduled status=completed: 200", r.status_code == 200)
        rows = r.json() if r.status_code == 200 else []
        ids = [s.get("surgery_id") for s in rows]
        chk("scheduled status=completed: does NOT contain our sid",
            sched_sid not in ids, f"got_count={len(ids)}")

    # ───────────────── 6. PATCH /api/surgeries/{id}/status ─────────────────
    if sched_sid:
        # in_progress
        r = client.patch(
            f"{BASE}/api/surgeries/{sched_sid}/status",
            json={"status": "in_progress"},
            headers=H_OWNER,
        )
        chk("PATCH status in_progress: 200", r.status_code == 200,
            f"status={r.status_code} body={r.text[:200]}")
        if r.status_code == 200:
            d = r.json()
            chk("PATCH status in_progress: status flipped",
                d.get("surgery_status") == "in_progress",
                f"got={d.get('surgery_status')}")
            chk("PATCH status in_progress: status_updated_at set",
                bool(d.get("status_updated_at")), f"got={d.get('status_updated_at')}")
            chk("PATCH status in_progress: status_updated_by set",
                bool(d.get("status_updated_by")), f"got={d.get('status_updated_by')}")

        # completed with op-note fields
        r = client.patch(
            f"{BASE}/api/surgeries/{sched_sid}/status",
            json={
                "status": "completed",
                "date": "2026-07-15",
                "operative_findings": "BPH resected uneventfully; haemostasis achieved.",
            },
            headers=H_OWNER,
        )
        chk("PATCH status completed: 200", r.status_code == 200,
            f"status={r.status_code} body={r.text[:200]}")
        if r.status_code == 200:
            d = r.json()
            chk("PATCH status completed: status flipped",
                d.get("surgery_status") == "completed",
                f"got={d.get('surgery_status')}")
            chk("PATCH status completed: date persisted",
                d.get("date") == "2026-07-15",
                f"got={d.get('date')}")
            chk("PATCH status completed: operative_findings persisted",
                "BPH resected" in (d.get("operative_findings") or ""),
                f"got={d.get('operative_findings')}")

        # Invalid status → 400
        r = client.patch(
            f"{BASE}/api/surgeries/{sched_sid}/status",
            json={"status": "banana"},
            headers=H_OWNER,
        )
        chk("PATCH status banana: 400", r.status_code == 400, f"status={r.status_code}")

    # Unknown surgery_id → 404
    r = client.patch(
        f"{BASE}/api/surgeries/sx_does_not_exist/status",
        json={"status": "in_progress"},
        headers=H_OWNER,
    )
    chk("PATCH status unknown sid: 404", r.status_code == 404, f"status={r.status_code}")

    # ───────────────── 7. Tenancy / auth ─────────────────
    r = client.get(f"{BASE}/api/surgeries/procedures", headers=H_NO_AUTH)
    chk("procedures no-auth: 401/403", r.status_code in (401, 403), f"status={r.status_code}")

    r = client.get(f"{BASE}/api/surgeries/ot-rooms", headers=H_NO_AUTH)
    chk("ot-rooms no-auth: 401/403", r.status_code in (401, 403), f"status={r.status_code}")

    r = client.get(
        f"{BASE}/api/surgeries/conflicts",
        params={"scheduled_date": "2026-07-15", "scheduled_time": "10:30",
                "duration_min": 45, "ot_room": "OT-1"},
        headers=H_NO_AUTH,
    )
    chk("conflicts no-auth: 401/403", r.status_code in (401, 403), f"status={r.status_code}")

    r = client.get(f"{BASE}/api/surgeries/scheduled", headers=H_NO_AUTH)
    chk("scheduled no-auth: 401/403", r.status_code in (401, 403), f"status={r.status_code}")

    r = client.post(
        f"{BASE}/api/surgeries",
        json={"patient_phone": "x", "patient_name": "x", "surgery_name": "x", "date": ""},
        headers=H_NO_AUTH,
    )
    chk("POST surgery no-auth: 401/403", r.status_code in (401, 403), f"status={r.status_code}")

    r = client.patch(
        f"{BASE}/api/surgeries/anything/status",
        json={"status": "completed"},
        headers=H_NO_AUTH,
    )
    chk("PATCH status no-auth: 401/403", r.status_code in (401, 403), f"status={r.status_code}")

    # ───────────────── Cleanup ─────────────────
    cleanup()
    # Verify cleanup
    if created_surgery_ids:
        for sid in created_surgery_ids:
            r = client.get(f"{BASE}/api/surgeries", headers=H_OWNER)
            if r.status_code == 200:
                live = [s.get("surgery_id") for s in r.json()]
                chk(f"cleanup: {sid} purged", sid not in live)
                break

    # ───────────────── Summary ─────────────────
    total = len(results)
    passed = sum(1 for r in results if r[0] == "PASS")
    failed = total - passed
    print(f"\n{'='*60}")
    print(f"TOTAL: {total}  PASS: {passed}  FAIL: {failed}")
    print('='*60)
    if failed:
        print("\nFAILURES:")
        for tag, name, detail in results:
            if tag == "FAIL":
                print(f"  - {name}: {detail}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    try:
        rc = main()
    finally:
        cleanup()
    sys.exit(rc)
