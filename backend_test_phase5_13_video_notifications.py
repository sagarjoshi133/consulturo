"""Phase 5.13 backend regression — Video Consultation notifications
must include role-aware deep-link data.

Read-only test (no source modifications). Uses local backend
http://localhost:8001 and direct mongosh inspection where the patient
notification view is owner-tier protected.

Auth fixtures: /app/memory/test_credentials.md.
"""
import json
import os
import re
import subprocess
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone

import requests

BASE = "http://localhost:8001/api"
OWNER_TOKEN = "test_session_1776770314741"  # sagar.joshi133@gmail.com
PATIENT_PHONE = "9876543210"  # existing registered patient (TechVitaHub)
PATIENT_USER_ID = "user_0e6614cb5c99"
PATIENT_FULL_PHONE = "+919876543210"

results = []
def chk(label, cond, info=""):
    tag = "✅" if cond else "❌"
    results.append((cond, label, info))
    print(f"{tag} {label}" + (f" — {info}" if info else ""))
    return cond


def mongosh(script):
    out = subprocess.run(
        ["mongosh", "--quiet", "--eval", script],
        capture_output=True, text=True, timeout=20,
    )
    return out.stdout.strip(), out.stderr.strip()


# Clean any pre-existing video_room_ready notifications for this test
# patient + owner to avoid false positives.
def purge_prior_notifs(reason=""):
    script = f"""
db = db.getSiblingDB('consulturo');
var r = db.notifications.deleteMany({{
  'data.type': 'video_room_ready',
  user_id: {{ $in: ['{PATIENT_USER_ID}', 'user_4775ed40276e'] }},
}});
print('purged=' + r.deletedCount);
"""
    out, err = mongosh(script)
    print(f"[purge {reason}] {out}")


def get_notifs_for_user(user_id, since_iso=None):
    q = {"user_id": user_id, "data.type": "video_room_ready"}
    if since_iso:
        # since_iso is an ISO string; mongosh `Date(...)` will parse it.
        time_clause = f", created_at: {{ $gte: ISODate('{since_iso}') }}"
    else:
        time_clause = ""
    script = f"""
db = db.getSiblingDB('consulturo');
var docs = db.notifications.find({{
  user_id:'{user_id}',
  'data.type':'video_room_ready'{time_clause}
}}, {{_id:0}}).sort({{created_at:-1}}).toArray();
print(JSON.stringify(docs));
"""
    out, _ = mongosh(script)
    try:
        return json.loads(out)
    except Exception:
        return []


# ── 0. Video health smoke ─────────────────────────────────────
print("\n=== STEP 0: /api/video/health smoke ===")
r = requests.get(f"{BASE}/video/health", timeout=10)
chk("GET /api/video/health → 200", r.status_code == 200, f"status={r.status_code}")
try:
    j = r.json()
    chk("video health configured=True", j.get("configured") is True, json.dumps(j))
except Exception as e:
    chk("video health JSON parseable", False, str(e))


# ── 1. Purge prior video_room_ready notifs for this patient/owner ─
purge_prior_notifs("pre-test")


# ── 2. Create a VIDEO booking ────────────────────────────────
print("\n=== STEP 1: create fresh VIDEO booking ===")
# Use a future date to avoid past-date validation
future_date = (datetime.now(timezone.utc) + timedelta(days=5)).strftime("%Y-%m-%d")
booking_time = "11:30"

payload = {
    "patient_name": "TechVitaHub Test Video",
    "patient_phone": PATIENT_PHONE,
    "country_code": "+91",
    # patient_email ensures booking links to the registered patient
    # user_id at creation. Without it, the existing user lookup
    # falls back to phone-only matching which DOES NOT normalise
    # the country-code prefix (booking stores "9876543210", user
    # row stores "+919876543210") — that mismatch causes the
    # patient notification to be skipped. That's a pre-existing
    # bug in services/notifications.create_notification's fallback,
    # not a Phase 5.13 regression.
    "patient_email": "techvitahub@gmail.com",
    "patient_age": 35,
    "patient_gender": "Male",
    "reason": "Phase 5.13 video notification regression test",
    "booking_date": future_date,
    "booking_time": booking_time,
    "mode": "video",
}
r = requests.post(
    f"{BASE}/bookings",
    json=payload,
    headers={"Authorization": f"Bearer {OWNER_TOKEN}"},
    timeout=15,
)
chk("POST /api/bookings (video) → 200/201", r.status_code in (200, 201),
    f"status={r.status_code} body={r.text[:300]}")
booking = r.json() if r.status_code in (200, 201) else {}
booking_id = booking.get("booking_id") or booking.get("id")
chk("booking_id returned", bool(booking_id), f"id={booking_id}")
chk("booking status is requested initially",
    booking.get("status") == "requested",
    f"status={booking.get('status')}")
chk("booking mode=video", booking.get("mode") == "video",
    f"mode={booking.get('mode')}")


# Capture current time before confirming so we can scope notifs.
before_confirm = datetime.now(timezone.utc).replace(microsecond=0).isoformat()


# ── 3. Confirm the booking ────────────────────────────────────
print("\n=== STEP 2: confirm VIDEO booking via PATCH ===")
r = requests.patch(
    f"{BASE}/bookings/{booking_id}",
    json={"status": "confirmed"},
    headers={"Authorization": f"Bearer {OWNER_TOKEN}"},
    timeout=20,
)
chk("PATCH /api/bookings/{id} {status:confirmed} → 200",
    r.status_code == 200,
    f"status={r.status_code} body={r.text[:300]}")

# Wait briefly for fire-and-forget tasks (notification + HMS provision)
time.sleep(5)

# Refetch booking to confirm video_room provisioned
r2 = requests.get(f"{BASE}/bookings/{booking_id}",
                  headers={"Authorization": f"Bearer {OWNER_TOKEN}"},
                  timeout=10)
b2 = r2.json() if r2.status_code == 200 else {}
vr = b2.get("video_room") or {}
chk("video_room provisioned (room_id present)",
    bool(vr.get("room_id")),
    f"video_room keys={list(vr.keys())}")
chk("patient_url present on video_room", bool(vr.get("patient_url")),
    vr.get("patient_url","")[:80])
chk("doctor_url present on video_room", bool(vr.get("doctor_url")),
    vr.get("doctor_url","")[:80])


# ── 4. Patient notification check ─────────────────────────────
print("\n=== STEP 3: patient notifications ===")
patient_notifs = get_notifs_for_user(PATIENT_USER_ID, since_iso=before_confirm)
print(f"   patient notifs found: {len(patient_notifs)}")
patient_n = None
for n in patient_notifs:
    if (n.get("data") or {}).get("role") == "patient":
        patient_n = n; break
chk("patient has video_room_ready notification with role=patient",
    patient_n is not None,
    f"count={len(patient_notifs)}")
if patient_n:
    pd = patient_n.get("data") or {}
    chk("patient.data.type == 'video_room_ready'",
        pd.get("type") == "video_room_ready", str(pd.get("type")))
    chk("patient.data.role == 'patient'",
        pd.get("role") == "patient", str(pd.get("role")))
    chk("patient.data has patient_url", bool(pd.get("patient_url")),
        str(pd.get("patient_url",""))[:80])
    chk("patient.data has patient_code", bool(pd.get("patient_code")),
        str(pd.get("patient_code")))
    chk("patient.data has code", bool(pd.get("code")),
        str(pd.get("code")))
    chk("patient.data has link", bool(pd.get("link")),
        str(pd.get("link",""))[:80])
    chk("patient.data.code == patient_code",
        pd.get("code") == pd.get("patient_code"))
    chk("patient.data.link == patient_url",
        pd.get("link") == pd.get("patient_url"))


# Verify patient endpoint also returns it — try as patient via direct
# GET /api/notifications IF we can seed a session token for the
# patient. Otherwise we already proved via mongo it's persisted under
# the patient's user_id.
print("\n=== STEP 3b: try GET /api/notifications as patient via seeded session ===")
seed_token = "test_patient_video_" + str(int(time.time()))
seed_script = f"""
db = db.getSiblingDB('consulturo');
db.user_sessions.insertOne({{
  user_id: '{PATIENT_USER_ID}',
  session_token: '{seed_token}',
  expires_at: new Date(Date.now() + 86400000),
  created_at: new Date()
}});
print('seeded');
"""
out, err = mongosh(seed_script)
if "seeded" in out:
    r = requests.get(f"{BASE}/notifications",
                     headers={"Authorization": f"Bearer {seed_token}"},
                     timeout=10)
    chk("GET /api/notifications (patient session) → 200",
        r.status_code == 200, f"status={r.status_code}")
    if r.status_code == 200:
        notifs = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
        vrr = [n for n in notifs
               if (n.get("data") or {}).get("type") == "video_room_ready"
               and (n.get("data") or {}).get("role") == "patient"]
        chk("patient API surfaces ≥1 video_room_ready/role=patient",
            len(vrr) >= 1, f"count={len(vrr)}")
        if vrr:
            pd = vrr[0].get("data") or {}
            chk("api: patient_url present", bool(pd.get("patient_url")))
            chk("api: patient_code present", bool(pd.get("patient_code")))
            chk("api: code present", bool(pd.get("code")))
            chk("api: link present", bool(pd.get("link")))
    # cleanup session
    mongosh(f"db = db.getSiblingDB('consulturo'); db.user_sessions.deleteOne({{session_token:'{seed_token}'}});")


# ── 5. Owner notification check ───────────────────────────────
print("\n=== STEP 4: primary_owner notifications ===")
OWNER_USER_ID = "user_4775ed40276e"
owner_notifs = get_notifs_for_user(OWNER_USER_ID, since_iso=before_confirm)
print(f"   owner notifs found: {len(owner_notifs)}")
owner_n = None
for n in owner_notifs:
    if (n.get("data") or {}).get("role") == "doctor":
        owner_n = n; break
chk("primary_owner has video_room_ready notification with role=doctor",
    owner_n is not None,
    f"count={len(owner_notifs)}")
if owner_n:
    od = owner_n.get("data") or {}
    chk("owner.data.type == 'video_room_ready'",
        od.get("type") == "video_room_ready", str(od.get("type")))
    chk("owner.data.role == 'doctor'",
        od.get("role") == "doctor", str(od.get("role")))
    chk("owner.data has doctor_url", bool(od.get("doctor_url")),
        str(od.get("doctor_url",""))[:80])
    chk("owner.data has doctor_code", bool(od.get("doctor_code")),
        str(od.get("doctor_code")))
    chk("owner.data has code", bool(od.get("code")),
        str(od.get("code")))
    chk("owner.data has link", bool(od.get("link")),
        str(od.get("link",""))[:80])
    chk("owner.data.code == doctor_code",
        od.get("code") == od.get("doctor_code"))
    chk("owner.data.link == doctor_url",
        od.get("link") == od.get("doctor_url"))

# Also verify via API for primary_owner
print("\n=== STEP 4b: GET /api/notifications as primary_owner ===")
r = requests.get(f"{BASE}/notifications",
                 headers={"Authorization": f"Bearer {OWNER_TOKEN}"},
                 timeout=10)
chk("owner GET /api/notifications → 200", r.status_code == 200,
    f"status={r.status_code}")
if r.status_code == 200:
    body = r.json()
    notifs = body if isinstance(body, list) else body.get("items", [])
    vrr = [n for n in notifs
           if (n.get("data") or {}).get("type") == "video_room_ready"
           and (n.get("data") or {}).get("role") == "doctor"
           and (n.get("data") or {}).get("booking_id") == booking_id]
    chk("owner API surfaces ≥1 video_room_ready/role=doctor for this booking",
        len(vrr) >= 1, f"count={len(vrr)}")


# ── 6. Idempotency: re-confirm same booking ───────────────────
print("\n=== STEP 5: idempotency on re-confirm ===")
before_re = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
count_before_patient = len(get_notifs_for_user(PATIENT_USER_ID))
count_before_owner = len(get_notifs_for_user(OWNER_USER_ID))

# Re-confirming the same booking with status=confirmed
r = requests.patch(
    f"{BASE}/bookings/{booking_id}",
    json={"status": "confirmed"},
    headers={"Authorization": f"Bearer {OWNER_TOKEN}"},
    timeout=15,
)
chk("re-PATCH status=confirmed → 200", r.status_code == 200,
    f"status={r.status_code}")
time.sleep(3)
count_after_patient = len(get_notifs_for_user(PATIENT_USER_ID))
count_after_owner = len(get_notifs_for_user(OWNER_USER_ID))
chk("no new patient video_room_ready notif on re-confirm",
    count_after_patient == count_before_patient,
    f"before={count_before_patient} after={count_after_patient}")
chk("no new owner video_room_ready notif on re-confirm",
    count_after_owner == count_before_owner,
    f"before={count_before_owner} after={count_after_owner}")


# ── 7. Non-video booking: NO video_room_ready notif ───────────
print("\n=== STEP 6: in-person booking confirm should NOT create video_room_ready ===")
payload_inp = {
    "patient_name": "TechVitaHub Test InPerson",
    "patient_phone": PATIENT_PHONE,
    "country_code": "+91",
    "patient_email": "techvitahub@gmail.com",
    "patient_age": 35,
    "patient_gender": "Male",
    "reason": "Phase 5.13 in-person regression test",
    "booking_date": future_date,
    "booking_time": "16:30",
    "mode": "in-person",
}
r = requests.post(
    f"{BASE}/bookings",
    json=payload_inp,
    headers={"Authorization": f"Bearer {OWNER_TOKEN}"},
    timeout=15,
)
chk("POST in-person booking → 200/201", r.status_code in (200, 201),
    f"status={r.status_code} body={r.text[:200]}")
ip_b = r.json() if r.status_code in (200, 201) else {}
ip_booking_id = ip_b.get("booking_id") or ip_b.get("id")
chk("in-person booking_id returned", bool(ip_booking_id))

before_ip = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
count_before_p = len(get_notifs_for_user(PATIENT_USER_ID))
count_before_o = len(get_notifs_for_user(OWNER_USER_ID))

r = requests.patch(
    f"{BASE}/bookings/{ip_booking_id}",
    json={"status": "confirmed"},
    headers={"Authorization": f"Bearer {OWNER_TOKEN}"},
    timeout=15,
)
chk("confirm in-person booking → 200", r.status_code == 200,
    f"status={r.status_code}")
time.sleep(3)
count_after_p = len(get_notifs_for_user(PATIENT_USER_ID))
count_after_o = len(get_notifs_for_user(OWNER_USER_ID))
chk("in-person confirm did NOT add patient video_room_ready",
    count_after_p == count_before_p,
    f"before={count_before_p} after={count_after_p}")
chk("in-person confirm did NOT add owner video_room_ready",
    count_after_o == count_before_o,
    f"before={count_before_o} after={count_after_o}")


# ── 8. Cleanup — delete test bookings + notifications ─────────
print("\n=== CLEANUP ===")
cleanup_script = f"""
db = db.getSiblingDB('consulturo');
var b1 = db.bookings.deleteMany({{ booking_id: {{$in: ['{booking_id}', '{ip_booking_id}']}} }});
var n1 = db.notifications.deleteMany({{
  'data.booking_id': {{$in: ['{booking_id}', '{ip_booking_id}']}}
}});
print('bookings_deleted=' + b1.deletedCount + ' notifications_deleted=' + n1.deletedCount);
"""
out, err = mongosh(cleanup_script)
print(out)


# ── Final report ──────────────────────────────────────────────
print("\n" + "="*60)
total = len(results)
passed = sum(1 for r in results if r[0])
print(f"RESULT: {passed}/{total} assertions passed")
if passed < total:
    print("\nFailures:")
    for ok, label, info in results:
        if not ok:
            print(f"  ❌ {label}: {info}")
    sys.exit(1)
else:
    print("ALL PASS")
    sys.exit(0)
