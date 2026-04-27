"""Direct localhost test for rate limiting (bypasses K8s ingress load-balancer)."""
import time
import requests

BASE = "http://localhost:8001/api"
OWNER_TOKEN = "test_session_1776770314741"
HDR_OWNER = {"Authorization": f"Bearer {OWNER_TOKEN}"}


def test_session():
    print("\n=== Direct localhost: POST /api/auth/session (20/min) ===")
    statuses = []
    first_429 = None
    for i in range(1, 26):
        r = requests.post(f"{BASE}/auth/session", json={"session_id": "x_invalid_rl_test"}, timeout=15)
        statuses.append(r.status_code)
        if r.status_code == 429 and first_429 is None:
            first_429 = i
            print(f"  First 429 at request #{i}")
            print(f"  429 body: {r.text}")
    print(f"  Statuses: {statuses}")
    print(f"  First 429 at request #: {first_429}")


def test_logout():
    print("\n=== Direct localhost: POST /api/auth/logout (20/min) ===")
    statuses = []
    first_429 = None
    for i in range(1, 26):
        r = requests.post(f"{BASE}/auth/logout", timeout=15)
        statuses.append(r.status_code)
        if r.status_code == 429 and first_429 is None:
            first_429 = i
            print(f"  First 429 at request #{i}: body={r.text}")
    print(f"  Statuses: {statuses}")
    print(f"  First 429 at request #: {first_429}")


def test_bookings():
    print("\n=== Direct localhost: POST /api/bookings (10/min) ===")
    from datetime import datetime, timedelta, timezone
    bdate = ((datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)).date()
             + timedelta(days=2)).isoformat()
    statuses = []
    bodies = []
    first_429 = None
    slot_minutes = [13*60 + i*5 for i in range(15)]
    slots = [f"{m//60:02d}:{m%60:02d}" for m in slot_minutes]
    for i, t in enumerate(slots, start=1):
        body = {
            "patient_name": "RL Test Local",
            "patient_phone": "9999912345",
            "reason": "rate-limit smoke",
            "booking_date": bdate,
            "booking_time": t,
            "mode": "in-person",
        }
        r = requests.post(f"{BASE}/bookings", json=body, timeout=15)
        statuses.append(r.status_code)
        if r.status_code == 429 and first_429 is None:
            first_429 = i
            print(f"  First 429 at request #{i}: body={r.text}")
        try:
            bodies.append(r.json())
        except Exception:
            bodies.append(None)
    print(f"  Statuses: {statuses}")
    print(f"  First 429 at request #: {first_429}")
    return [b.get("booking_id") for b in bodies if isinstance(b, dict) and b.get("booking_id")]


def cleanup(ids):
    print(f"\n=== Cleanup {len(ids)} bookings ===")
    for bid in ids:
        r = requests.patch(f"{BASE}/bookings/{bid}",
                           json={"status": "cancelled", "reason": "rl-test cleanup"},
                           headers=HDR_OWNER, timeout=15)
        print(f"  cancel {bid} -> {r.status_code}")


if __name__ == "__main__":
    test_session()
    print("\n[wait 65s for window reset]")
    time.sleep(65)
    test_logout()
    print("\n[wait 65s for window reset]")
    time.sleep(65)
    bids = test_bookings()
    cleanup(bids)
