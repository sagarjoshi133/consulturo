"""ConsultUro — rx_verify router.

  · /api/rx/verify/{prescription_id}

Extracted from server.py during Phase 3 modularization.
Behaviour preserved EXACTLY.
"""
from datetime import datetime
from fastapi import APIRouter
from fastapi.responses import HTMLResponse
from db import db
from server import _verify_page_html

router = APIRouter()


@router.get("/api/rx/verify/{prescription_id}")
async def verify_prescription(prescription_id: str):
    """Public verification page for a prescription QR code.
    Only exposes issue metadata (no clinical details) to protect patient privacy."""
    doc = await db.prescriptions.find_one({"prescription_id": prescription_id}, {"_id": 0})
    if not doc:
        return HTMLResponse(
            status_code=404,
            content=_verify_page_html(
                ok=False,
                rx_id=prescription_id,
                issued_at=None,
                patient_initials=None,
                med_count=0,
            ),
        )
    # Patient privacy: only expose initials like "R.S." and the issue date.
    name = (doc.get("patient_name") or "").strip()
    initials = ".".join([p[0].upper() for p in name.split() if p])[:6] or "—"
    created = doc.get("created_at")
    if isinstance(created, datetime):
        issued_at = created.strftime("%d-%m-%Y %H:%M UTC")
    else:
        issued_at = str(created) if created else "—"
    med_count = len(doc.get("medicines") or [])
    return HTMLResponse(
        content=_verify_page_html(
            ok=True,
            rx_id=prescription_id,
            issued_at=issued_at,
            patient_initials=initials,
            med_count=med_count,
        ),
    )
