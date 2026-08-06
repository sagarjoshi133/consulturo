"""ConsultUro — Booking display + reminder helpers.

  • _time_12h               — 24h "HH:MM" → "h:MM AM/PM"
  • _format_booking_display — composes the patient/doctor-facing
                              "Mon 5 May at 4:30 PM" string.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

# IST offset — booking timestamps are stored UTC; display in IST.
IST_OFFSET = timedelta(hours=5, minutes=30)


def _time_12h(hhmm: str) -> str:
    """'14:30' -> '2:30 PM'. Defensive."""
    try:
        hh, mm = [int(x) for x in hhmm.split(":")]
        suffix = "AM" if hh < 12 else "PM"
        h12 = hh % 12
        if h12 == 0:
            h12 = 12
        return f"{h12}:{mm:02d} {suffix}"
    except Exception:
        return hhmm

def _format_booking_display(iso_date: str, hhmm: str) -> str:
    """YYYY-MM-DD + HH:mm -> 'DD-MM-YYYY at H:MM AM/PM'."""
    try:
        yr, mo, dy = iso_date.split("-")
        return f"{dy}-{mo}-{yr} at {_time_12h(hhmm)}"
    except Exception:
        return f"{iso_date} at {_time_12h(hhmm)}"
