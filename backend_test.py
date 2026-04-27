"""Backend test for the unified inbox endpoints (review request).

Covers:
  - GET  /api/inbox/all
  - POST /api/inbox/all/read
  - Regression: /api/notifications, /api/broadcasts/inbox, /api/auth/me
"""
from __future__ import annotations
import os
import random
import sys
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import requests

BASE = "http://localhost:8001"
OWNER_TOKEN = "test_session_1776770314741"
DOCTOR_TOKEN = "test_doc_1776771431524"
IST = timezone(timedelta(hours=5, minutes=30))


def hdr(tok: Optional[str]) -> Dict[str, str]:
    return {"Authorization": f"Bearer {tok}"} if tok else {}


passes: List[str] = []
fails: List[str] = []


def check(cond: bool, label: str, extra: str = "") -> bool:
    if cond:
        passes.append(label); print(f"  PASS  {label}")
    else:
        msg = label + (f" — {extra}" if extra else "")
        fails.append(msg); print(f"  FAIL  {msg}")
    return cond


def section(t: str) -> None:
    print(); print("=" * 78); print(t); print("=" * 78)


def get_first_future_slot() -> Tuple[str, str]:
    for delta in range(2, 30):
        d = (datetime.now(IST) + timedelta(days=delta)).strftime("%Y-%m-%d")
        r = requests.get(f"{BASE}/api/availability/slots",
                         params={"date": d, "mode": "in-person"}, timeout=10)
        if r.status_code != 200:
            continue
        body = r.json()
        slots = body.get("slots") or []
        booked = set(body.get("booked_slots") or [])
        for s in slots:
            if s not in booked:
                return d, s
    raise RuntimeError("No future slot found in next 30 days")


def main() -> int:
    section("0. Pre-flight — owner /api/auth/me")
    r = requests.get(f"{BASE}/api/auth/me", headers=hdr(OWNER_TOKEN), timeout=10)
    check(r.status_code == 200, "owner /api/auth/me 200")
    me_owner = r.json() if r.status_code == 200 else {}
    check(me_owner.get("role") == "owner", "owner role")

    section("1. GET /api/inbox/all without auth → 401")
    r = requests.get(f"{BASE}/api/inbox/all", timeout=10)
    check(r.status_code == 401, "GET /api/inbox/all no auth → 401",
          extra=f"got {r.status_code}: {r.text[:200]}")

    section("1b. POST /api/inbox/all/read without auth → 401")
    r = requests.post(f"{BASE}/api/inbox/all/read", timeout=10)
    check(r.status_code == 401, "POST /api/inbox/all/read no auth → 401",
          extra=f"got {r.status_code}: {r.text[:200]}")

    section("2. Trigger notification — POST /api/bookings (anonymous)")
    bdate, btime = get_first_future_slot()
    print(f"  using slot {bdate} {btime}")
    rand_phone = "9" + "".join(str(random.randint(0, 9)) for _ in range(9))
    payload = {
        "patient_name": "Inbox Test Patient",
        "patient_phone": rand_phone,
        "patient_age": 42,
        "patient_gender": "Male",
        "reason": "Routine check (inbox test)",
        "booking_date": bdate,
        "booking_time": btime,
        "mode": "in-person",
    }
    r = requests.post(f"{BASE}/api/bookings", json=payload, timeout=15)
    booking_id: Optional[str] = None
    if r.status_code == 200:
        booking_id = r.json().get("booking_id")
        check(bool(booking_id), f"booking created ({booking_id})")
    else:
        check(False, "booking created",
              extra=f"status={r.status_code} body={r.text[:300]}")

    time.sleep(0.6)

    section("3. GET /api/inbox/all (owner)")
    r = requests.get(f"{BASE}/api/inbox/all", headers=hdr(OWNER_TOKEN), timeout=15)
    check(r.status_code == 200, "GET /api/inbox/all 200",
          extra=f"got {r.status_code}: {r.text[:200]}")
    body: Dict[str, Any] = r.json() if r.status_code == 200 else {}
    items = body.get("items"); unread = body.get("unread")
    check(isinstance(items, list), "items is list")
    check(isinstance(unread, int), f"unread is int (={unread!r})")
    items = items or []
    print(f"  feed length = {len(items)}, unread = {unread}")

    required_keys = {"id", "title", "body", "kind", "source_type",
                     "read", "created_at"}
    valid_source = {"user", "broadcast", "push", "other"}
    bad_schema, bad_source = [], []
    for it in items:
        missing = required_keys - set(it.keys())
        if missing:
            bad_schema.append((it.get("id"), missing))
        if it.get("source_type") not in valid_source:
            bad_source.append((it.get("id"), it.get("source_type")))
    check(not bad_schema, "every item has all required keys",
          extra=str(bad_schema[:3]))
    check(not bad_source,
          "every item.source_type in {user|broadcast|push|other}",
          extra=str(bad_source[:3]))

    def ts(v):
        if isinstance(v, str):
            try:
                return datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp()
            except Exception:
                return 0
        return 0
    ts_list = [ts(it.get("created_at")) for it in items]
    sorted_ok = all(a >= b for a, b in zip(ts_list, ts_list[1:]))
    check(sorted_ok, "items sorted newest-first by created_at")

    if booking_id:
        booking_item = None
        for it in items:
            d = it.get("data") or {}
            if d.get("booking_id") == booking_id:
                booking_item = it; break
        check(booking_item is not None,
              "newly-created booking notification visible in feed")
        if booking_item:
            check(booking_item.get("kind") == "booking",
                  f"booking item kind=='booking' (got {booking_item.get('kind')!r})")
            check(booking_item.get("source_type") == "user",
                  f"booking item source_type=='user' (got {booking_item.get('source_type')!r})")
            check(booking_item.get("read") is False,
                  "booking item read==False")
            print(f"  booking item title: {booking_item.get('title')!r}")

    if booking_id:
        check(isinstance(unread, int) and unread >= 1,
              f"unread >= 1 after booking notif (got {unread})")

    section("4. POST /api/inbox/all/read (owner)")
    r = requests.post(f"{BASE}/api/inbox/all/read", headers=hdr(OWNER_TOKEN), timeout=15)
    check(r.status_code == 200, "POST /api/inbox/all/read 200",
          extra=f"got {r.status_code}: {r.text[:200]}")
    rb: Dict[str, Any] = r.json() if r.status_code == 200 else {}
    check(rb.get("ok") is True, f"response.ok==True (got {rb.get('ok')!r})")
    check(isinstance(rb.get("marked"), int),
          f"response.marked is int (got {rb.get('marked')!r})")
    print(f"  marked={rb.get('marked')}")

    section("5. GET /api/inbox/all again — unread must be 0")
    r = requests.get(f"{BASE}/api/inbox/all", headers=hdr(OWNER_TOKEN), timeout=15)
    check(r.status_code == 200, "second GET /api/inbox/all 200")
    body2 = r.json() if r.status_code == 200 else {}
    check(body2.get("unread") == 0,
          f"unread==0 after mark-read (got {body2.get('unread')!r})")
    items2 = body2.get("items") or []
    all_read = all(it.get("read") is True for it in items2)
    check(all_read, "every item.read==True after mark-read")

    section("6. Regression — GET /api/notifications (legacy)")
    r = requests.get(f"{BASE}/api/notifications", headers=hdr(OWNER_TOKEN), timeout=10)
    check(r.status_code == 200, "GET /api/notifications 200")
    nb = r.json() if r.status_code == 200 else {}
    check(isinstance(nb.get("items"), list),
          "/api/notifications has items[] (legacy shape)")
    check("unread_count" in nb,
          "/api/notifications has unread_count (legacy key, not 'unread')")
    print(f"  legacy items={len(nb.get('items') or [])} unread_count={nb.get('unread_count')}")

    section("7. Regression — GET /api/broadcasts/inbox (legacy)")
    r = requests.get(f"{BASE}/api/broadcasts/inbox", headers=hdr(OWNER_TOKEN), timeout=10)
    check(r.status_code == 200, "GET /api/broadcasts/inbox 200")
    bb = r.json() if r.status_code == 200 else {}
    check(isinstance(bb.get("items"), list),
          "/api/broadcasts/inbox has items[]")
    check("unread" in bb,
          "/api/broadcasts/inbox has 'unread' (legacy shape)")

    section("8. Regression — GET /api/auth/me has 'phone' field")
    r = requests.get(f"{BASE}/api/auth/me", headers=hdr(OWNER_TOKEN), timeout=10)
    check(r.status_code == 200, "GET /api/auth/me 200")
    mb = r.json() if r.status_code == 200 else {}
    check("phone" in mb, "/api/auth/me has 'phone' key")
    print(f"  /api/auth/me phone = {mb.get('phone')!r}")

    section("9. Doctor token /api/inbox/all 200 (sanity)")
    r = requests.get(f"{BASE}/api/inbox/all", headers=hdr(DOCTOR_TOKEN), timeout=10)
    check(r.status_code == 200, "doctor GET /api/inbox/all 200")
    db_body = r.json() if r.status_code == 200 else {}
    check(isinstance(db_body.get("items"), list), "doctor items is list")
    check(isinstance(db_body.get("unread"), int), "doctor unread is int")

    section("10. Cleanup — cancel test booking")
    if booking_id:
        rc = requests.patch(
            f"{BASE}/api/bookings/{booking_id}",
            headers=hdr(OWNER_TOKEN),
            json={"status": "cancelled", "reason": "inbox test cleanup"},
            timeout=10,
        )
        print(f"  PATCH cancel → {rc.status_code}")

    print(); print("=" * 78)
    print(f"PASS: {len(passes)}    FAIL: {len(fails)}")
    print("=" * 78)
    if fails:
        print("Failed assertions:")
        for f in fails:
            print(f"  - {f}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
