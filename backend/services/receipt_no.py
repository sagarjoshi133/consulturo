"""ConsultUro — Receipt-number allocator (Phase 3.8 — Billing & Receipts).

`allocate_receipt_no()` returns a stable, IST-day-keyed receipt number
in the format `RCYYMMDD###` (e.g. `RC25053001`). Sequence resets each
day at IST midnight.

Counter is stored in `counters` collection keyed by
`receipt_<YYYY-MM-DD>`. Separate keyspace from the patient
reg_no counter so they can never collide.
"""
from datetime import datetime, timezone, timedelta
from typing import Optional

from pymongo import ReturnDocument

from db import db

IST_OFFSET = timedelta(hours=5, minutes=30)


def _ist_today_key(receipt_date: Optional[str] = None) -> str:
    """Return YYYY-MM-DD for IST today (or for the explicit date string)."""
    if receipt_date and len(receipt_date) >= 10:
        return receipt_date[:10]
    today_local = (datetime.now(timezone.utc) + IST_OFFSET).date()
    return today_local.strftime("%Y-%m-%d")


async def allocate_receipt_no(receipt_date: Optional[str] = None) -> str:
    """Atomically allocate the next receipt number for the given (IST)
    date. Format: `RCYYMMDD###`.
    """
    day_iso = _ist_today_key(receipt_date)
    counter_key = f"receipt_{day_iso}"
    res = await db.counters.find_one_and_update(
        {"key": counter_key},
        {"$inc": {"count": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    seq = res.get("count", 1)
    # YYMMDD from YYYY-MM-DD
    yymmdd = day_iso[2:4] + day_iso[5:7] + day_iso[8:10]
    return f"RC{yymmdd}{seq:03d}"
