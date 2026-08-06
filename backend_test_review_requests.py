"""Phase 5.1 — Google Review Auto-Nudge backend test.

Targets the public Kubernetes ingress (EXPO_PUBLIC_BACKEND_URL/api).

Owner bearer  : test_session_1776770314741 (sagar.joshi133@gmail.com, primary_owner)
Tenant header : X-Clinic-Id: clinic_a97b903f2fb2

Sub-checks roughly follow the review request plan A..H, plus mandatory
cleanup (I) — touches only test phones 9000000123/222/333/444/555 and the
clinic_settings doc which we restore at the end.
"""
from __future__ import annotations

import datetime as _dt
import os
import sys
import time
import uuid
from typing import Any, Dict, List, Optional

import requests
from pymongo import MongoClient

BACKEND = "https://urology-pro.preview.emergentagent.com/api"
OWNER_TOKEN = "test_session_1776770314741"
CLINIC_ID = "clinic_a97b903f2fb2"

OH = {
    "Authorization": f"Bearer {OWNER_TOKEN}",
    "X-Clinic-Id": CLINIC_ID,
    "Content-Type": "application/json",
}

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
mc = MongoClient(MONGO_URL)
mdb = mc.get_database("consulturo")

TEST_PHONES = ["9000000123", "9000000222", "9000000333", "9000000444", "9000000555"]
PASS = 0
FAIL = 0
FAILS: List[str] = []
TEST_START = _dt.datetime.now(_dt.timezone.utc)

# IDs to cleanup
created_ids: List[str] = []  # review_requests rows
created_booking_ids: List[str] = []
created_rx_ids: List[str] = []
created_patient_session: Optional[Dict[str, Any]] = None  # {user_id, token}


def check(name: str, cond: bool, detail: str = ""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ✅ {name}")
    else:
        FAIL += 1
        FAILS.append(f"{name} — {detail}")
        print(f"  ❌ {name} — {detail}")


def section(title: str):
    print(f"\n==== {title} ====")


# ────────────────────────── A. SETUP ──────────────────────────
def test_A():
    section("A. SETUP")
    # A1
    r = requests.patch(
        f"{BACKEND}/clinic-settings",
        json={
            "google_review_url": "https://g.page/r/UROTEST/review",
            "google_review_request_enabled": True,
            "google_review_delay_hours": 0,
            "google_review_triggers": ["booking_completed", "rx_final", "discharge"],
        },
        headers=OH,
        timeout=20,
    )
    body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    check("A1 PATCH /clinic-settings → 200", r.status_code == 200, f"{r.status_code} {r.text[:200]}")
    check("A1 updated >=4", body.get("updated", 0) >= 4, str(body))
    # A2
    r = requests.get(f"{BACKEND}/clinic-settings", headers={"X-Clinic-Id": CLINIC_ID}, timeout=20)
    cs = r.json()
    check("A2 GET clinic-settings 200", r.status_code == 200, r.text[:200])
    check("A2 google_review_request_enabled is True", cs.get("google_review_request_enabled") is True, str(cs.get("google_review_request_enabled")))
    check("A2 google_review_url matches", cs.get("google_review_url") == "https://g.page/r/UROTEST/review", str(cs.get("google_review_url")))
    check("A2 delay_hours=0", cs.get("google_review_delay_hours") == 0, str(cs.get("google_review_delay_hours")))
    check("A2 triggers has 3 items", set(cs.get("google_review_triggers") or []) == {"booking_completed", "rx_final", "discharge"}, str(cs.get("google_review_triggers")))


# ────────────────────────── B. MANUAL ──────────────────────────
def test_B():
    section("B. MANUAL FIRE")
    r = requests.post(
        f"{BACKEND}/review-requests/manual",
        json={"patient_name": "Review Test 1", "phone": "9000000123", "send_now": True},
        headers=OH,
        timeout=30,
    )
    check("B1 manual POST → 200", r.status_code == 200, f"{r.status_code} {r.text[:200]}")
    body = r.json() if r.status_code == 200 else {}
    if r.status_code == 200:
        created_ids.append(body.get("id"))
        check("B1 status=sent", body.get("status") == "sent", str(body.get("status")))
        check("B1 wa_link present", bool(body.get("wa_link")), str(body.get("wa_link"))[:80])
        check("B1 message mentions 'Review'", "Review" in (body.get("message") or ""), str(body.get("message", ""))[:120])

    # B2
    r = requests.get(f"{BACKEND}/review-requests?limit=10", headers=OH, timeout=20)
    check("B2 list 200", r.status_code == 200, r.text[:200])
    items = r.json().get("items", []) if r.status_code == 200 else []
    triggers = [i.get("trigger") for i in items]
    check("B2 contains trigger='manual'", "manual" in triggers, str(triggers))

    # B3 summary
    r = requests.get(f"{BACKEND}/review-requests/summary", headers=OH, timeout=20)
    check("B3 summary 200", r.status_code == 200, r.text[:200])
    s = r.json() if r.status_code == 200 else {}
    by_trig = s.get("by_trigger", {})
    by_stat = s.get("by_status", {})
    check("B3 by_trigger.manual >= 1", by_trig.get("manual", 0) >= 1, str(by_trig))
    check("B3 by_status.sent >= 1", by_stat.get("sent", 0) >= 1, str(by_stat))


# ────────────────────────── C. BOOKING HOOK ──────────────────────────
def _create_booking(phone: str, name: str) -> Optional[str]:
    """Create a booking. Use a future date well clear of unavailability rules."""
    future = (_dt.date.today() + _dt.timedelta(days=20)).isoformat()
    r = requests.post(
        f"{BACKEND}/bookings",
        json={
            "patient_name": name,
            "patient_phone": phone,
            "country_code": "+91",
            "reason": "follow-up",
            "booking_date": future,
            "booking_time": "10:00",
            "mode": "in-person",
        },
        headers=OH,
        timeout=30,
    )
    if r.status_code != 200:
        print(f"   booking-create-failed: {r.status_code} {r.text[:200]}")
        return None
    bid = r.json().get("booking_id")
    if bid:
        created_booking_ids.append(bid)
    return bid


def _complete_booking(booking_id: str) -> requests.Response:
    return requests.patch(
        f"{BACKEND}/bookings/{booking_id}",
        json={"status": "completed"},
        headers=OH,
        timeout=20,
    )


def test_C():
    section("C. BOOKING-COMPLETED HOOK")
    bid = _create_booking("9000000222", "Booking Test")
    check("C1 booking created", bool(bid), str(bid))
    if not bid:
        return
    r = _complete_booking(bid)
    check("C2 PATCH status=completed → 200", r.status_code == 200, f"{r.status_code} {r.text[:200]}")

    # C3 list review-requests by phone
    time.sleep(1.0)  # tiny grace for the hook
    r = requests.get(f"{BACKEND}/review-requests?phone=9000000222", headers=OH, timeout=20)
    items = r.json().get("items", []) if r.status_code == 200 else []
    rows = [i for i in items if i.get("trigger") == "booking_completed"]
    check("C3 ≥1 booking_completed row for phone", len(rows) >= 1, f"len={len(rows)} items={items}")
    rid = rows[0]["id"] if rows else None
    if rid:
        created_ids.append(rid)
        check("C3 status is pending or sent", rows[0].get("status") in ("pending", "sent"), str(rows[0].get("status")))

    # C4 send-now
    if rid:
        r = requests.post(f"{BACKEND}/review-requests/{rid}/send-now", headers=OH, timeout=20)
        check("C4 send-now 200", r.status_code == 200, f"{r.status_code} {r.text[:200]}")
        body = r.json() if r.status_code == 200 else {}
        # 'fired' may be 0 if it was already sent on insert path. Accept >=0 + later status check.
        # Verify status=sent
        r2 = requests.get(f"{BACKEND}/review-requests?phone=9000000222", headers=OH, timeout=20)
        post_items = r2.json().get("items", [])
        for it in post_items:
            if it.get("id") == rid:
                check("C4 row status=sent after send-now", it.get("status") == "sent", str(it.get("status")))
                break


# ────────────────────────── D. Rx FINAL HOOK ──────────────────────────
def _create_rx(phone: str, name: str) -> Optional[str]:
    today = _dt.date.today().isoformat()
    r = requests.post(
        f"{BACKEND}/prescriptions",
        json={
            "patient_name": name,
            "patient_phone": phone,
            "status": "final",
            "visit_date": today,
            "chief_complaints": "review-test",
            "medicines": [],
        },
        headers=OH,
        timeout=30,
    )
    if r.status_code != 200:
        print(f"   rx-create-failed: {r.status_code} {r.text[:200]}")
        return None
    rxid = r.json().get("prescription_id")
    if rxid:
        created_rx_ids.append(rxid)
    return rxid


def test_D():
    section("D. RX FINAL HOOK")
    rxid = _create_rx("9000000333", "Rx Test")
    check("D1 Rx created (status=final)", bool(rxid), str(rxid))
    if not rxid:
        return
    time.sleep(1.0)
    r = requests.get(f"{BACKEND}/review-requests?phone=9000000333", headers=OH, timeout=20)
    items = r.json().get("items", []) if r.status_code == 200 else []
    rows = [i for i in items if i.get("trigger") == "rx_final"]
    check("D2 ≥1 rx_final row for phone", len(rows) >= 1, f"len={len(rows)} items={items}")
    if rows:
        rid = rows[0]["id"]
        created_ids.append(rid)
        # force send-now
        r = requests.post(f"{BACKEND}/review-requests/{rid}/send-now", headers=OH, timeout=20)
        check("D2 send-now 200", r.status_code == 200, r.text[:200])
        r2 = requests.get(f"{BACKEND}/review-requests?phone=9000000333", headers=OH, timeout=20)
        for it in r2.json().get("items", []):
            if it.get("id") == rid:
                check("D2 status=sent after send-now", it.get("status") == "sent", str(it.get("status")))
                break


# ────────────────────────── E. DEDUP ──────────────────────────
def test_E():
    section("E. DEDUP (same phone, second booking → no new row)")
    # snapshot count
    r = requests.get(f"{BACKEND}/review-requests?phone=9000000222", headers=OH, timeout=20)
    items_before = r.json().get("items", []) if r.status_code == 200 else []
    bc_before = len([i for i in items_before if i.get("trigger") == "booking_completed"])

    bid = _create_booking("9000000222", "Booking Test 2")
    check("E1 2nd booking created", bool(bid), str(bid))
    if not bid:
        return
    r = _complete_booking(bid)
    check("E1 2nd PATCH completed → 200", r.status_code == 200, f"{r.status_code} {r.text[:200]}")
    time.sleep(1.0)
    r = requests.get(f"{BACKEND}/review-requests?phone=9000000222", headers=OH, timeout=20)
    items_after = r.json().get("items", []) if r.status_code == 200 else []
    bc_after = len([i for i in items_after if i.get("trigger") == "booking_completed"])
    check("E1 dedup: booking_completed count unchanged", bc_after == bc_before, f"before={bc_before} after={bc_after}")


# ────────────────────────── F. DISABLE + URL gates ──────────────────────────
def test_F():
    section("F. DISABLE + URL gates")
    # F1 disable
    r = requests.patch(
        f"{BACKEND}/clinic-settings",
        json={"google_review_request_enabled": False},
        headers=OH,
        timeout=20,
    )
    check("F1 disable PATCH 200", r.status_code == 200, r.text[:200])

    # F2 new booking — should NOT schedule
    bid = _create_booking("9000000444", "Disabled Phone")
    if bid:
        _complete_booking(bid)
    time.sleep(1.0)
    r = requests.get(f"{BACKEND}/review-requests?phone=9000000444", headers=OH, timeout=20)
    items = r.json().get("items", []) if r.status_code == 200 else []
    check("F2 disabled → 0 rows for 9000000444", len(items) == 0, f"items={items}")

    # F3 re-enable, blank URL
    r = requests.patch(
        f"{BACKEND}/clinic-settings",
        json={"google_review_request_enabled": True, "google_review_url": ""},
        headers=OH,
        timeout=20,
    )
    check("F3 re-enable empty URL PATCH 200", r.status_code == 200, r.text[:200])

    bid = _create_booking("9000000555", "No URL Phone")
    if bid:
        _complete_booking(bid)
    time.sleep(1.0)
    r = requests.get(f"{BACKEND}/review-requests?phone=9000000555", headers=OH, timeout=20)
    items = r.json().get("items", []) if r.status_code == 200 else []
    check("F4 empty URL → 0 rows for 9000000555", len(items) == 0, f"items={items}")


# ────────────────────────── G. me/pending + ack ──────────────────────────
def _ensure_patient_session() -> Optional[Dict[str, str]]:
    """Find existing patient user; create a 7d session token for them."""
    user = mdb.users.find_one({"role": "patient"})
    if not user:
        # try by absence-of-role
        user = mdb.users.find_one({"role": {"$nin": ["primary_owner", "super_owner", "partner", "doctor", "assistant", "reception", "nursing"]}})
    if not user:
        return None
    uid = user["user_id"]
    token = f"test_patient_session_{int(time.time())}"
    mdb.user_sessions.insert_one({
        "user_id": uid,
        "session_token": token,
        "expires_at": _dt.datetime.utcnow() + _dt.timedelta(days=7),
        "created_at": _dt.datetime.utcnow(),
    })
    return {"user_id": uid, "token": token, "seeded": True}


def test_G():
    global created_patient_session
    section("G. /me/pending + /ack flow")
    sess = _ensure_patient_session()
    if not sess:
        check("G1 patient user available", False, "no patient row in db.users")
        return
    created_patient_session = sess
    print(f"   patient user_id={sess['user_id']} token={sess['token'][:24]}...")

    # G2 re-enable and set URL
    r = requests.patch(
        f"{BACKEND}/clinic-settings",
        json={"google_review_request_enabled": True, "google_review_url": "https://g.page/r/UROTEST/review"},
        headers=OH,
        timeout=20,
    )
    check("G2 re-enable + URL PATCH 200", r.status_code == 200, r.text[:200])

    # G3 manual create for this patient user_id (no send)
    r = requests.post(
        f"{BACKEND}/review-requests/manual",
        json={"user_id": sess["user_id"], "patient_name": "Test", "send_now": False},
        headers=OH,
        timeout=30,
    )
    check("G3 manual no-send 200", r.status_code == 200, f"{r.status_code} {r.text[:200]}")
    rid: Optional[str] = None
    if r.status_code == 200:
        rid = r.json().get("id")
        if rid:
            created_ids.append(rid)
            check("G3 has request id", True)
        else:
            check("G3 has request id", False, str(r.json()))

    # G4 patient bearer → me/pending
    ph = {"Authorization": f"Bearer {sess['token']}", "X-Clinic-Id": CLINIC_ID}
    r = requests.get(f"{BACKEND}/review-requests/me/pending", headers=ph, timeout=20)
    check("G4 me/pending 200 as patient", r.status_code == 200, f"{r.status_code} {r.text[:200]}")
    body = r.json() if r.status_code == 200 else {}
    check("G4 pending=True", body.get("pending") is True, str(body))
    check("G4 request_id present", bool(body.get("request_id")), str(body))
    check("G4 review_url present", bool(body.get("review_url")), str(body))

    # G5 ack
    if rid:
        r = requests.post(f"{BACKEND}/review-requests/{rid}/ack", headers=ph, timeout=20)
        check("G5 ack 200", r.status_code == 200, f"{r.status_code} {r.text[:200]}")

    # G6 pending=False
    r = requests.get(f"{BACKEND}/review-requests/me/pending", headers=ph, timeout=20)
    body = r.json() if r.status_code == 200 else {}
    check("G6 pending=False after ack", body.get("pending") is False, str(body))


# ────────────────────────── H. AUTH gates ──────────────────────────
def test_H():
    section("H. AUTH gates")
    r = requests.get(f"{BACKEND}/review-requests", headers={"X-Clinic-Id": CLINIC_ID}, timeout=20)
    check("H1 no-auth list → 401/403", r.status_code in (401, 403), f"{r.status_code} {r.text[:120]}")

    if created_patient_session:
        ph = {
            "Authorization": f"Bearer {created_patient_session['token']}",
            "X-Clinic-Id": CLINIC_ID,
            "Content-Type": "application/json",
        }
        r = requests.post(
            f"{BACKEND}/review-requests/manual",
            json={"patient_name": "Auth Probe", "phone": "9000099999", "send_now": False},
            headers=ph,
            timeout=20,
        )
        check("H2 patient cannot POST manual → 403", r.status_code == 403, f"{r.status_code} {r.text[:120]}")


# ────────────────────────── I. CLEANUP ──────────────────────────
def cleanup():
    section("I. CLEANUP")
    # I1 review_requests by phone
    res = mdb.review_requests.delete_many({"phone": {"$in": TEST_PHONES}})
    print(f"   review_requests by phone deleted: {res.deleted_count}")
    # also any captured ids (covers user_id-only manual ones)
    if created_ids:
        res2 = mdb.review_requests.delete_many({"id": {"$in": [i for i in created_ids if i]}})
        print(f"   review_requests by id deleted: {res2.deleted_count}")

    # I2 bookings — by our created ids (safest)
    if created_booking_ids:
        res = mdb.bookings.delete_many({"booking_id": {"$in": created_booking_ids}})
        print(f"   bookings deleted by booking_id: {res.deleted_count}")
    # belt-and-braces: any test-phone booking with our test names
    test_names = {"Booking Test", "Booking Test 2", "Disabled Phone", "No URL Phone"}
    res = mdb.bookings.delete_many({"patient_phone": {"$in": TEST_PHONES}, "patient_name": {"$in": list(test_names)}})
    print(f"   bookings deleted by phone+name: {res.deleted_count}")

    # I3 prescriptions
    if created_rx_ids:
        res = mdb.prescriptions.delete_many({"prescription_id": {"$in": created_rx_ids}})
        print(f"   prescriptions deleted by id: {res.deleted_count}")
    res = mdb.prescriptions.delete_many({"patient_phone": "9000000333", "patient_name": "Rx Test"})
    print(f"   prescriptions deleted by phone+name: {res.deleted_count}")

    # I4 notifications with ⭐ title created during the test
    res = mdb.notifications.delete_many({
        "title": {"$regex": "^⭐"},
        "created_at": {"$gte": TEST_START},
    })
    print(f"   notifications (⭐) deleted: {res.deleted_count}")

    # I5 patient session
    if created_patient_session and created_patient_session.get("seeded"):
        res = mdb.user_sessions.delete_many({"session_token": created_patient_session["token"]})
        print(f"   user_sessions deleted: {res.deleted_count}")

    # I6 restore clinic-settings
    r = requests.patch(
        f"{BACKEND}/clinic-settings",
        json={
            "google_review_request_enabled": False,
            "google_review_url": "",
            "google_review_delay_hours": 24,
        },
        headers=OH,
        timeout=20,
    )
    print(f"   clinic-settings restore: {r.status_code} {r.text[:120]}")
    check("I6 settings restored", r.status_code == 200, r.text[:120])


def main():
    try:
        test_A()
        test_B()
        test_C()
        test_D()
        test_E()
        test_F()
        test_G()
        test_H()
    finally:
        cleanup()
    print(f"\n========== RESULT: {PASS} PASS / {FAIL} FAIL ==========")
    if FAILS:
        print("Failures:")
        for f in FAILS:
            print(f"  - {f}")
    sys.exit(0 if FAIL == 0 else 1)


if __name__ == "__main__":
    main()
