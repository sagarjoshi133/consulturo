"""Backend test for same-day booking + past-slot filtering behavior."""
import os
import sys
import requests
from datetime import datetime, timedelta, timezone
try:
    from zoneinfo import ZoneInfo
    IST = ZoneInfo("Asia/Kolkata")
except Exception:
    IST = timezone(timedelta(hours=5, minutes=30))

BASE = os.environ.get("BACKEND_URL", "http://localhost:8001") + "/api"
OWNER_TOKEN = "test_session_1776770314741"
H_OWNER = {"Authorization": f"Bearer {OWNER_TOKEN}", "Content-Type": "application/json"}

results = []


def log(name, passed, detail=""):
    icon = "PASS" if passed else "FAIL"
    print(f"[{icon}] {name}: {detail}")
    results.append((name, passed, detail))


def today_ist_str():
    return datetime.now(IST).date().isoformat()


def date_offset(days):
    return (datetime.now(IST).date() + timedelta(days=days)).isoformat()


def parse_hhmm(s):
    h, m = s.split(":")
    return int(h) * 60 + int(m)


def test_availability_today():
    today = today_ist_str()
    r = requests.get(f"{BASE}/availability/slots", params={"date": today, "mode": "in-person"})
    log("T1.1 GET /availability/slots today 200", r.status_code == 200,
        f"status={r.status_code} body={r.text[:200]}")
    if r.status_code != 200:
        return None, today
    data = r.json()
    log("T1.2 has slots key", "slots" in data, f"keys={list(data.keys())}")
    log("T1.3 has booked_slots key", "booked_slots" in data)
    log("T1.4 has past_slots key (NEW)", "past_slots" in data,
        f"past_slots={data.get('past_slots')}")
    log("T1.5 past_slots is array", isinstance(data.get("past_slots"), list))
    slots = data.get("slots", [])
    past = data.get("past_slots", [])
    overlap = set(past) & set(slots)
    log("T1.6 past_slots disjoint from slots", len(overlap) == 0, f"overlap={overlap}")
    now_ist = datetime.now(IST)
    cutoff = now_ist.hour * 60 + now_ist.minute + 15
    bad = [p for p in past if parse_hhmm(p) > cutoff]
    log("T1.7 every past_slots <= ist_now_min+15",
        len(bad) == 0,
        f"cutoff={cutoff} ist_now={now_ist.strftime('%H:%M')} past={past} bad={bad}")
    return data, today


def test_availability_future_5d():
    d = date_offset(5)
    r = requests.get(f"{BASE}/availability/slots", params={"date": d, "mode": "in-person"})
    log("T1.8 GET +5d 200", r.status_code == 200, f"date={d}")
    if r.status_code != 200:
        return
    data = r.json()
    log("T1.9 future +5d past_slots == []",
        data.get("past_slots") == [], f"past_slots={data.get('past_slots')}")


def test_post_past_slot_rejected():
    today = today_ist_str()
    now_ist = datetime.now(IST)
    past_dt = now_ist - timedelta(minutes=120)
    if past_dt.date() != now_ist.date():
        past_time = "00:30"
    else:
        past_time = past_dt.strftime("%H:%M")
    payload = {
        "patient_name": "Aarav Patel",
        "patient_phone": "9876512300",
        "country_code": "+91",
        "patient_age": 45,
        "patient_gender": "Male",
        "reason": "Past slot rejection test",
        "booking_date": today,
        "booking_time": past_time,
        "mode": "in-person",
    }
    r = requests.post(f"{BASE}/bookings", json=payload, headers=H_OWNER)
    log("T2.1 POST /bookings past slot returns 400", r.status_code == 400,
        f"status={r.status_code} body={r.text[:300]} time={past_time} today={today}")
    detail = ""
    try:
        detail = (r.json().get("detail") or "").lower()
    except Exception:
        pass
    log("T2.2 detail mentions 'past'", "past" in detail, f"detail={detail!r}")


def test_post_future_slot_today(avail):
    if not avail:
        log("T3.0 skipped (no availability data)", False, "")
        return None
    slots = avail.get("slots") or []
    if not slots:
        log("T3.0 no future today slots — skipping happy-path",
            False, "slots empty")
        return None
    booking_time = slots[0]
    today = today_ist_str()
    payload = {
        "patient_name": "Priya Test Booking",
        "patient_phone": "9876512311",
        "patient_age": 32,
        "patient_gender": "Female",
        "reason": "Future-today slot acceptance test",
        "booking_date": today,
        "booking_time": booking_time,
        "mode": "in-person",
    }
    r = requests.post(f"{BASE}/bookings", json=payload, headers=H_OWNER)
    log("T3.1 POST /bookings future-today 200/201",
        r.status_code in (200, 201),
        f"status={r.status_code} body={r.text[:300]} time={booking_time}")
    if r.status_code not in (200, 201):
        return None
    body = r.json()
    log("T3.2 booking_id present", bool(body.get("booking_id")),
        f"booking_id={body.get('booking_id')}")
    log("T3.3 status == requested", body.get("status") == "requested",
        f"status={body.get('status')}")
    log("T3.4 country_code defaults to +91", body.get("country_code") == "+91",
        f"country_code={body.get('country_code')}")
    log("T3.5 booking_date == today", body.get("booking_date") == today,
        f"booking_date={body.get('booking_date')}")
    log("T3.6 booking_time matches", body.get("booking_time") == booking_time,
        f"booking_time={body.get('booking_time')}")
    return body.get("booking_id")


def test_90day_window():
    d89 = date_offset(89)
    r = requests.get(f"{BASE}/availability/slots", params={"date": d89, "mode": "in-person"})
    log("T4.1 +89d returns 200", r.status_code == 200,
        f"date={d89} status={r.status_code} body={r.text[:200]}")
    if r.status_code == 200:
        data = r.json()
        log("T4.2 +89d response shape OK",
            isinstance(data.get("slots"), list),
            f"slots_len={len(data.get('slots') or [])}")

    d100 = date_offset(100)
    r2 = requests.get(f"{BASE}/availability/slots", params={"date": d100, "mode": "in-person"})
    log("T4.3 +100d returns 200 (no backend 90-day cap)",
        r2.status_code == 200,
        f"date={d100} status={r2.status_code} body={r2.text[:200]}")


def test_sanity_booking_listed(booking_id):
    if not booking_id:
        log("T5.0 skipped (no booking_id from T3)", False, "")
        return
    r = requests.get(f"{BASE}/bookings/all", headers=H_OWNER)
    log("T5.1 GET /bookings/all 200", r.status_code == 200, f"status={r.status_code}")
    if r.status_code != 200:
        return
    arr = r.json()
    ids = [b.get("booking_id") for b in arr] if isinstance(arr, list) else []
    log("T5.2 created booking is in /bookings/all",
        booking_id in ids, f"booking_id={booking_id} total={len(ids)}")


def cleanup_booking(booking_id):
    if not booking_id:
        return
    r = requests.delete(f"{BASE}/bookings/{booking_id}", headers=H_OWNER)
    if r.status_code in (200, 204):
        log("CLEANUP DELETE booking", True, f"booking_id={booking_id}")
        return
    r2 = requests.patch(f"{BASE}/bookings/{booking_id}",
                        json={"status": "cancelled", "reason": "test cleanup"},
                        headers=H_OWNER)
    log("CLEANUP PATCH cancelled",
        r2.status_code == 200,
        f"delete_status={r.status_code} patch_status={r2.status_code}")


def main():
    print("== past-slot filtering backend test ==")
    print(f"BASE={BASE}")
    print(f"IST now={datetime.now(IST).isoformat()}")
    print(f"today (IST) = {today_ist_str()}\n")
    avail, today = test_availability_today()
    test_availability_future_5d()
    print()
    test_post_past_slot_rejected()
    print()
    bid = test_post_future_slot_today(avail)
    print()
    test_90day_window()
    print()
    test_sanity_booking_listed(bid)
    print()
    cleanup_booking(bid)
    total = len(results)
    passed = sum(1 for _, p, _ in results if p)
    print("\n" + "=" * 60)
    print(f"RESULTS: {passed}/{total} passed")
    fails = [(n, d) for n, p, d in results if not p]
    if fails:
        print("FAILURES:")
        for n, d in fails:
            print(f"  - {n}: {d}")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
