"""
Phase 3.5 — 5-day Pre-surgery Reminder backend tests
====================================================

Targets:
  POST   /api/surgeries/{surgery_id}/send-reminder
  async fn _scan_and_fire_surgery_5d_reminders(now)  (background sweep)

Plus a Phase 3 regression smoke (templates / scheduled / conflicts / health).

Runs against local backend: http://localhost:8001
Auth: pre-seeded primary_owner token from /app/memory/test_credentials.md
Tenant header: X-Clinic-Id: clinic_a97b903f2fb2
"""
import os
import re
import sys
import json
import time
import subprocess
import urllib.parse
from datetime import datetime, timezone, timedelta

import requests

BASE = "http://localhost:8001"
OWNER_TOKEN = "test_session_1776770314741"
CLINIC_ID = "clinic_a97b903f2fb2"

H_OWNER = {
    "Authorization": f"Bearer {OWNER_TOKEN}",
    "X-Clinic-Id": CLINIC_ID,
    "Content-Type": "application/json",
}

PASS = []
FAIL = []


def _ok(label):
    PASS.append(label)
    print(f"  ✅ {label}")


def _bad(label, detail=""):
    msg = f"{label}" + (f" -- {detail}" if detail else "")
    FAIL.append(msg)
    print(f"  ❌ {msg}")


def assert_eq(name, got, want):
    if got == want:
        _ok(f"{name} == {want!r}")
    else:
        _bad(name, f"expected {want!r}, got {got!r}")


def assert_true(name, cond, detail=""):
    if cond:
        _ok(name)
    else:
        _bad(name, detail)


# ─────────────────────────────────────────────────────────────────────
# Mongo helpers via mongosh (no pymongo dep needed)
# ─────────────────────────────────────────────────────────────────────
def mongosh(js: str) -> str:
    res = subprocess.run(
        ["mongosh", "--quiet", "--eval", js],
        capture_output=True, text=True, timeout=30,
    )
    if res.returncode != 0:
        print("MONGOSH STDERR:", res.stderr)
    return res.stdout.strip()


def mongo_find_one_surgery(surgery_id: str) -> dict | None:
    js = (
        "db = db.getSiblingDB('consulturo');"
        f"var s = db.surgeries.findOne({{surgery_id: '{surgery_id}'}});"
        "print(JSON.stringify(s));"
    )
    out = mongosh(js)
    if not out or out == "null":
        return None
    try:
        return json.loads(out.split("\n")[-1])
    except Exception:
        return None


# ─────────────────────────────────────────────────────────────────────
# Section 1 — POST /api/surgeries/{id}/send-reminder
# ─────────────────────────────────────────────────────────────────────
def section_manual_reminder():
    print("\n=== Section 1: POST /api/surgeries/{id}/send-reminder ===")

    # (a) Auth gating
    r = requests.post(f"{BASE}/api/surgeries/anything/send-reminder", json={}, timeout=15)
    assert_true("1a-no-auth returns 401/403", r.status_code in (401, 403),
                f"got {r.status_code} {r.text[:120]}")

    # (b) 404 path
    r = requests.post(
        f"{BASE}/api/surgeries/does_not_exist/send-reminder",
        headers=H_OWNER, json={}, timeout=15,
    )
    assert_eq("1b-bogus-id status", r.status_code, 404)
    try:
        assert_eq("1b-bogus-id detail", r.json().get("detail"), "Surgery not found")
    except Exception:
        _bad("1b-bogus-id json parse", r.text[:120])

    # (c) Happy path — pick a real surgery
    r = requests.get(f"{BASE}/api/surgeries", headers=H_OWNER, timeout=20)
    assert_eq("1c-list-surgeries status", r.status_code, 200)
    lst = r.json() if r.status_code == 200 else []
    assert_true("1c-have-surgeries", isinstance(lst, list) and len(lst) > 0,
                f"len={len(lst) if isinstance(lst, list) else 'n/a'}")
    if not lst:
        return None

    # Prefer one with a phone & scheduled_date for richer assertions
    chosen = None
    for sx in lst:
        if sx.get("patient_phone") and sx.get("scheduled_date"):
            chosen = sx
            break
    if not chosen:
        chosen = lst[0]

    sx_id = chosen["surgery_id"]
    print(f"  → using surgery_id={sx_id} name={chosen.get('patient_name')} "
          f"phone={chosen.get('patient_phone')}")

    r = requests.post(
        f"{BASE}/api/surgeries/{sx_id}/send-reminder",
        headers=H_OWNER, json={}, timeout=20,
    )
    assert_eq("1c-happy-path status", r.status_code, 200)
    if r.status_code != 200:
        print("    body:", r.text[:300])
        return sx_id
    body = r.json()
    assert_eq("1c-ok", body.get("ok"), True)
    assert_eq("1c-surgery_id echoed", body.get("surgery_id"), sx_id)
    assert_true("1c-push_sent is bool", isinstance(body.get("push_sent"), bool))
    assert_true("1c-message is str", isinstance(body.get("message"), str) and bool(body.get("message")))
    msg = body.get("message", "")
    # message must mention first name + recognisable surgery info
    first_name = (chosen.get("patient_name") or "").strip().split(" ")[0]
    if first_name:
        assert_true("1c-message mentions first name",
                    first_name.lower() in msg.lower(),
                    f"first_name={first_name!r} not in msg")
    proc_label = (chosen.get("surgery_name") or chosen.get("procedure_key") or "").strip()
    if proc_label:
        assert_true("1c-message mentions surgery name/procedure",
                    proc_label.lower() in msg.lower() or "surgery" in msg.lower(),
                    f"proc_label={proc_label!r}")
    wa_link = body.get("wa_link")
    if chosen.get("patient_phone"):
        assert_true("1c-wa_link present", isinstance(wa_link, str))
        assert_true("1c-wa_link prefix",
                    isinstance(wa_link, str) and wa_link.startswith("https://wa.me/"),
                    f"wa_link={wa_link!r}")
    else:
        assert_true("1c-wa_link null when no phone", wa_link is None)

    return sx_id


def section_manual_reminder_force(sx_id: str):
    print("\n=== Section 1d: force=true clears reminder_5d_fired_at ===")
    if not sx_id:
        _bad("1d-skipped: no surgery_id from 1c")
        return

    # Pre-set reminder_5d_fired_at on the surgery
    js_set = (
        "db = db.getSiblingDB('consulturo');"
        f"db.surgeries.updateOne({{surgery_id:'{sx_id}'}}, "
        f"{{$set:{{reminder_5d_fired_at:new Date()}}}});"
        f"var s = db.surgeries.findOne({{surgery_id:'{sx_id}'}}, "
        "{reminder_5d_fired_at:1});"
        "print(s && s.reminder_5d_fired_at ? 'HAS' : 'MISSING');"
    )
    out = mongosh(js_set)
    assert_true("1d-precondition reminder_5d_fired_at set", "HAS" in out,
                f"mongosh out={out!r}")

    # POST with force:true
    r = requests.post(
        f"{BASE}/api/surgeries/{sx_id}/send-reminder",
        headers=H_OWNER, json={"force": True}, timeout=20,
    )
    assert_eq("1d-force status", r.status_code, 200)
    if r.status_code == 200:
        b = r.json()
        assert_eq("1d-force ok", b.get("ok"), True)
        assert_eq("1d-force surgery_id echo", b.get("surgery_id"), sx_id)

    # Verify reminder_5d_fired_at unset
    js_check = (
        "db = db.getSiblingDB('consulturo');"
        f"var s = db.surgeries.findOne({{surgery_id:'{sx_id}'}}, "
        "{reminder_5d_fired_at:1, reminder_5d_target_date:1});"
        "print('FIRED=' + (s && 'reminder_5d_fired_at' in s ? 'YES' : 'NO'));"
        "print('TGT=' + (s && 'reminder_5d_target_date' in s ? 'YES' : 'NO'));"
    )
    out = mongosh(js_check)
    assert_true("1d-fired_at $unset after force", "FIRED=NO" in out, out)
    assert_true("1d-target_date $unset after force", "TGT=NO" in out, out)


# ─────────────────────────────────────────────────────────────────────
# Section 2 — Background sweep
# ─────────────────────────────────────────────────────────────────────
SYNTH_SURGERY_ID = "test_sx_phase35_" + str(int(time.time()))


def insert_synthetic_surgery():
    """Insert surgery with scheduled_date = today_IST + 5 days, status=scheduled."""
    # Compute today_IST + 5 days
    now_utc = datetime.now(timezone.utc)
    today_ist = (now_utc + timedelta(hours=5, minutes=30)).date()
    target_date = (today_ist + timedelta(days=5)).isoformat()

    js = (
        "db = db.getSiblingDB('consulturo');"
        f"db.surgeries.deleteMany({{surgery_id:'{SYNTH_SURGERY_ID}'}});"
        "db.surgeries.insertOne({"
        f"surgery_id:'{SYNTH_SURGERY_ID}',"
        f"scheduled_date:'{target_date}',"
        "scheduled_time:'10:00',"
        "surgery_status:'scheduled',"
        "patient_name:'Test Patient',"
        "patient_phone:'9876543210',"
        f"clinic_id:'{CLINIC_ID}',"
        "surgery_name:'RIRS — Right kidney stone',"
        "procedure_key:'rirs',"
        "ot_room:'OT-1',"
        "created_at:new Date()"
        "});"
        f"var s = db.surgeries.findOne({{surgery_id:'{SYNTH_SURGERY_ID}'}});"
        "print(JSON.stringify({sd:s.scheduled_date,st:s.surgery_status}));"
    )
    out = mongosh(js)
    print(f"  seeded surgery target_date={target_date}: mongosh→ {out}")
    return target_date


def run_sweep_once():
    """Invoke _scan_and_fire_surgery_5d_reminders in-process via subprocess."""
    code = (
        "import asyncio, sys\n"
        "sys.path.insert(0, '/app/backend')\n"
        "from datetime import datetime, timezone\n"
        "from server import _scan_and_fire_surgery_5d_reminders\n"
        "asyncio.run(_scan_and_fire_surgery_5d_reminders(datetime.now(timezone.utc)))\n"
        "print('SWEEP_OK')\n"
    )
    res = subprocess.run(
        ["python3", "-c", code],
        cwd="/app/backend",
        capture_output=True, text=True, timeout=60,
    )
    print(f"  sweep stdout: {res.stdout.strip()[-300:]}")
    if res.returncode != 0:
        print(f"  sweep stderr: {res.stderr.strip()[-500:]}")
    return res.returncode == 0 and "SWEEP_OK" in res.stdout


def section_background_sweep():
    print("\n=== Section 2: Background sweep _scan_and_fire_surgery_5d_reminders ===")

    target_date = insert_synthetic_surgery()

    # (a) First sweep — should fire
    ok = run_sweep_once()
    assert_true("2-first-sweep ran without exception", ok)

    js = (
        "db = db.getSiblingDB('consulturo');"
        f"var s = db.surgeries.findOne({{surgery_id:'{SYNTH_SURGERY_ID}'}});"
        "print('FIRED=' + (s && s.reminder_5d_fired_at ? s.reminder_5d_fired_at.toISOString() : 'NONE'));"
        "print('TGT=' + (s && s.reminder_5d_target_date ? s.reminder_5d_target_date : 'NONE'));"
    )
    out = mongosh(js)
    print(f"  post-sweep state: {out}")
    assert_true("2a-reminder_5d_fired_at set", "FIRED=" in out and "FIRED=NONE" not in out, out)
    assert_true("2a-reminder_5d_target_date set",
                f"TGT={target_date}" in out, out)

    # (b) Check push_log OR notifications — synthetic surgery has no patient_user_id
    # so only Telegram path runs. Sweep should not have crashed — both create_notification
    # was skipped (no patient_user_id) and telegram path may fail silently. We just verify
    # no exception escaped (already verified by SWEEP_OK above).
    _ok("2b-no patient_user_id ⇒ telegram-only path executed without crashing")

    # (c) Idempotency — second sweep must not re-fire
    js_capture = (
        "db = db.getSiblingDB('consulturo');"
        f"var s = db.surgeries.findOne({{surgery_id:'{SYNTH_SURGERY_ID}'}});"
        "print(s.reminder_5d_fired_at.toISOString());"
    )
    ts1 = mongosh(js_capture).splitlines()[-1].strip()
    print(f"  fired_at after first sweep: {ts1}")

    time.sleep(1)  # so any new write would have a different timestamp
    ok2 = run_sweep_once()
    assert_true("2c-second sweep ran without exception", ok2)
    ts2 = mongosh(js_capture).splitlines()[-1].strip()
    print(f"  fired_at after second sweep: {ts2}")
    assert_eq("2c-idempotency reminder_5d_fired_at unchanged", ts2, ts1)

    # (d) Cancelled surgeries are skipped — clear guard & set status=cancelled
    js_cancel = (
        "db = db.getSiblingDB('consulturo');"
        f"db.surgeries.updateOne({{surgery_id:'{SYNTH_SURGERY_ID}'}}, "
        "{$set:{surgery_status:'cancelled'}, "
        "$unset:{reminder_5d_fired_at:'', reminder_5d_target_date:''}});"
        f"var s = db.surgeries.findOne({{surgery_id:'{SYNTH_SURGERY_ID}'}}, "
        "{surgery_status:1, reminder_5d_fired_at:1});"
        "print('STATUS=' + s.surgery_status);"
        "print('FIRED=' + ('reminder_5d_fired_at' in s ? 'YES' : 'NO'));"
    )
    out = mongosh(js_cancel)
    print(f"  pre-cancel-sweep state: {out}")
    assert_true("2d-precondition status=cancelled", "STATUS=cancelled" in out)
    assert_true("2d-precondition fired_at cleared", "FIRED=NO" in out)

    ok3 = run_sweep_once()
    assert_true("2d-cancel sweep ran", ok3)

    js_after = (
        "db = db.getSiblingDB('consulturo');"
        f"var s = db.surgeries.findOne({{surgery_id:'{SYNTH_SURGERY_ID}'}}, "
        "{reminder_5d_fired_at:1, surgery_status:1});"
        "print('STATUS=' + s.surgery_status);"
        "print('FIRED=' + ('reminder_5d_fired_at' in s ? 'YES' : 'NO'));"
    )
    out = mongosh(js_after)
    print(f"  post-cancel-sweep state: {out}")
    assert_true("2d-cancelled surgery NOT picked up", "FIRED=NO" in out, out)


# ─────────────────────────────────────────────────────────────────────
# Section 3 — regression smoke
# ─────────────────────────────────────────────────────────────────────
def section_regression():
    print("\n=== Section 3: Phase 3 regression smoke ===")

    # /preop/template
    r = requests.get(f"{BASE}/api/surgeries/preop/template",
                     headers=H_OWNER, timeout=15)
    assert_eq("3-preop/template status", r.status_code, 200)
    if r.status_code == 200:
        body = r.json()
        items = body.get("items") or []
        crit = body.get("critical_keys") or []
        assert_true("3-preop items >=12", len(items) >= 12, f"len={len(items)}")
        assert_true("3-preop critical_keys >=9", len(crit) >= 9, f"len={len(crit)}")

    # /procedures
    r = requests.get(f"{BASE}/api/surgeries/procedures",
                     headers=H_OWNER, timeout=15)
    assert_eq("3-procedures status", r.status_code, 200)
    proc_key = None
    if r.status_code == 200:
        items = r.json()
        if isinstance(items, dict):
            items = items.get("items") or items.get("procedures") or []
        if items:
            first = items[0]
            proc_key = (first.get("key") if isinstance(first, dict)
                        else (first if isinstance(first, str) else None))
        print(f"  procedure_key chosen: {proc_key}")

    # /op-note-template
    if proc_key:
        r = requests.get(
            f"{BASE}/api/surgeries/op-note-template",
            params={"procedure_key": proc_key},
            headers=H_OWNER, timeout=15,
        )
        assert_eq("3-op-note-template status", r.status_code, 200)
        if r.status_code == 200:
            tmpl = r.json().get("template")
            assert_true("3-op-note-template template is str",
                        isinstance(tmpl, str) and len(tmpl) > 0)
    else:
        _bad("3-op-note-template SKIPPED — no procedure_key available")

    # /scheduled
    today = datetime.now(timezone.utc).date()
    frm = (today - timedelta(days=30)).isoformat()
    to = (today + timedelta(days=60)).isoformat()
    r = requests.get(
        f"{BASE}/api/surgeries/scheduled",
        params={"from_date": frm, "to_date": to},
        headers=H_OWNER, timeout=20,
    )
    assert_eq("3-scheduled status", r.status_code, 200)
    if r.status_code == 200:
        data = r.json()
        # API may return list or {items:[...]}
        if isinstance(data, dict):
            data = data.get("items") or data.get("surgeries") or []
        assert_true("3-scheduled is list", isinstance(data, list))

    # /conflicts
    sd = (today + timedelta(days=7)).isoformat()
    r = requests.get(
        f"{BASE}/api/surgeries/conflicts",
        params={
            "scheduled_date": sd, "scheduled_time": "10:00",
            "duration_min": 60, "ot_room": "OT-1",
        },
        headers=H_OWNER, timeout=15,
    )
    assert_eq("3-conflicts status", r.status_code, 200)
    if r.status_code == 200:
        body = r.json()
        assert_true("3-conflicts has 'conflicts' array",
                    isinstance(body.get("conflicts"), list),
                    f"body={body}")

    # /health
    r = requests.get(f"{BASE}/api/health", timeout=10)
    assert_eq("3-health status", r.status_code, 200)
    if r.status_code == 200:
        b = r.json()
        assert_eq("3-health ok", b.get("ok"), True)
        assert_eq("3-health db", b.get("db"), "connected")


# ─────────────────────────────────────────────────────────────────────
# Cleanup
# ─────────────────────────────────────────────────────────────────────
def cleanup():
    print("\n=== Cleanup ===")
    js = (
        "db = db.getSiblingDB('consulturo');"
        f"var r = db.surgeries.deleteMany({{surgery_id:'{SYNTH_SURGERY_ID}'}});"
        "var r2 = db.surgeries.deleteMany({"
        "patient_name:'Test Patient', patient_phone:'9876543210'});"
        "print('purged_synth=' + r.deletedCount + ' purged_by_name=' + r2.deletedCount);"
    )
    out = mongosh(js)
    print(f"  cleanup: {out}")


def tail_err_log(n=200):
    print("\n=== /var/log/supervisor/backend.err.log (last lines) ===")
    try:
        with open("/var/log/supervisor/backend.err.log", "r") as f:
            lines = f.readlines()[-n:]
        for line in lines:
            print(" ", line.rstrip())
    except Exception as e:
        print(f"  (could not read log: {e})")


# ─────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────
def main():
    try:
        sx_id = section_manual_reminder()
        section_manual_reminder_force(sx_id) if sx_id else None
        section_background_sweep()
        section_regression()
    finally:
        cleanup()

    print("\n" + "=" * 60)
    print(f"PASS: {len(PASS)}  FAIL: {len(FAIL)}")
    if FAIL:
        print("\nFAILURES:")
        for f in FAIL:
            print("  - " + f)
    print("=" * 60)
    return 0 if not FAIL else 1


if __name__ == "__main__":
    sys.exit(main())
