"""ConsultUro — receipts (Billing) router (Phase 3.8).

Endpoints:
  · POST   /api/receipts                        — record a payment
  · GET    /api/receipts                        — list (filters: date/from/to/phone/mode)
  · GET    /api/receipts/{receipt_id}           — single receipt
  · DELETE /api/receipts/{receipt_id}           — owner-only delete
  · GET    /api/receipts/daily-collection       — daily summary
  · GET    /api/receipts/by-patient/{phone}     — all receipts for a patient
"""
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, Query

from db import db
from auth_deps import require_staff, require_owner
from models import ReceiptBody
from services.tenancy import resolve_clinic_id, tenant_filter
from services.receipt_no import allocate_receipt_no, _ist_today_key
from services.reg_no import get_or_set_reg_no

router = APIRouter()


def _normalize_phone(raw: Optional[str]) -> str:
    digits = re.sub(r"\D", "", raw or "")
    return digits[-10:] if len(digits) >= 10 else digits


def _compute_totals(items: List[Dict[str, Any]], discount: float, gst_enabled: bool, gst_pct: float):
    subtotal = 0.0
    out_items: List[Dict[str, Any]] = []
    for it in items:
        qty = float(it.get("qty") or 1)
        amount = float(it.get("amount") or 0)
        line_total = round(qty * amount, 2)
        subtotal += line_total
        out_items.append({
            "description": (it.get("description") or "").strip(),
            "service_type": it.get("service_type"),
            "qty": qty,
            "amount": amount,
            "line_total": line_total,
        })
    subtotal = round(subtotal, 2)
    discount_amt = round(float(discount or 0), 2)
    after_disc = max(0.0, subtotal - discount_amt)
    gst_amount = 0.0
    if gst_enabled and gst_pct:
        gst_amount = round(after_disc * (float(gst_pct) / 100.0), 2)
    total = round(after_disc + gst_amount, 2)
    return out_items, subtotal, discount_amt, gst_amount, total


@router.post("/api/receipts")
async def create_receipt(request: Request, body: ReceiptBody, user=Depends(require_staff)):
    if not body.items or len(body.items) == 0:
        raise HTTPException(status_code=400, detail="At least one line item is required")
    # Validate items each have description + amount > 0
    raw_items = [it.dict() for it in body.items]
    for it in raw_items:
        if not (it.get("description") or "").strip():
            raise HTTPException(status_code=400, detail="Each item needs a description")
        if float(it.get("amount") or 0) < 0:
            raise HTTPException(status_code=400, detail="Amount cannot be negative")

    receipt_date = body.receipt_date or _ist_today_key()
    # Guard: receipts must NEVER carry a future date (clinics close their
    # books daily; a future-dated receipt would mess up daily totals).
    if receipt_date > _ist_today_key():
        raise HTTPException(status_code=400, detail="Receipts cannot be dated in the future")
    receipt_no = await allocate_receipt_no(receipt_date)
    clinic_id = await resolve_clinic_id(request, user)

    phone = _normalize_phone(body.patient_phone)
    patient_user_id: Optional[str] = None
    if phone:
        m = await db.users.find_one({"phone_digits": {"$in": [phone, "91" + phone]}}, {"_id": 0, "user_id": 1})
        if m:
            patient_user_id = m["user_id"]

    reg_no = await get_or_set_reg_no(
        phone,
        (body.registration_no or "").strip() or None,
        body.patient_name,
        email=body.patient_email,
    )
    # Phase D — canonical patient registry id.
    from services.patient_registry import resolve_patient_id
    receipt_patient_id = await resolve_patient_id(phone, body.patient_email, body.patient_name)

    items, subtotal, discount_amt, gst_amount, total = _compute_totals(
        raw_items,
        float(body.discount or 0),
        bool(body.gst_enabled),
        float(body.gst_pct or 0),
    )
    paid = body.paid if body.paid is not None else total
    paid = round(float(paid), 2)
    balance = round(total - paid, 2)

    mode = (body.mode or "Cash").strip()
    # Allowed modes (Phase 5.10 — Razorpay-backed modes added so the
    # Record Payment screen can record what the patient actually used):
    #   • Manual modes: Cash · UPI (Direct) · Cheque · Other
    #   • Razorpay-fetched: UPI (Razorpay) · Card (Razorpay) · Wallet (Razorpay)
    #   • Legacy: UPI · Card  — accepted for back-compat with older receipts
    _allowed = {
        "Cash", "UPI", "Card", "Wallet", "Cheque", "Other",
        "UPI (Direct)", "UPI (Razorpay)", "Card (Razorpay)", "Wallet (Razorpay)",
        "Pending Razorpay",
    }
    if mode not in _allowed:
        mode = "Other"

    doc = {
        "receipt_id": f"rc_{uuid.uuid4().hex[:10]}",
        "receipt_no": receipt_no,
        "clinic_id": clinic_id,
        "patient_phone": phone or None,
        "patient_name": (body.patient_name or "").strip() or None,
        "patient_email": (body.patient_email or "").strip() or None,
        "patient_user_id": patient_user_id,
        "registration_no": reg_no,
        "patient_id": receipt_patient_id,
        "items": items,
        "subtotal": subtotal,
        "discount": discount_amt,
        "gst_enabled": bool(body.gst_enabled),
        "gst_pct": float(body.gst_pct or 0),
        "gst_amount": gst_amount,
        "total": total,
        "paid": paid,
        "balance": balance,
        "mode": mode,
        "payment_ref": (body.payment_ref or "").strip() or None,
        "notes": (body.notes or "").strip() or None,
        "receipt_date": receipt_date,
        "encounter_id": (body.encounter_id or "").strip() or None,
        "created_by": user["user_id"],
        "created_by_name": user.get("name") or user.get("email") or "Staff",
        "created_at": datetime.now(timezone.utc),
    }
    await db.receipts.insert_one(doc)
    doc.pop("_id", None)

    # If this receipt is tied to an encounter, refresh that encounter's
    # payment badge (pending → paid) for the reception worklist.
    if doc.get("encounter_id"):
        try:
            from routers.encounters import recompute_encounter_payment
            await recompute_encounter_payment(doc["encounter_id"])
        except Exception:
            pass

    # ── Push notification (Phase 4 — broader rollout, 2026-05-31) ──
    # Inform the patient that a receipt was issued in their name —
    # gives them a paper trail without us having to email.
    try:
        from services.notifications import create_notification
        first = ((doc.get("patient_name") or "").strip().split(" ")[0]) or "Patient"
        await create_notification(
            user_id=patient_user_id,
            phone=phone,
            email=doc.get("patient_email"),
            title="🧾 Receipt issued",
            body=(
                f"Hi {first}, your receipt {receipt_no} for ₹{total:.2f} has been "
                "generated. Tap to view & download."
            ),
            kind="receipt_issued",
            data={
                "type": "receipt_issued",
                "receipt_id": doc["receipt_id"],
                "receipt_no": receipt_no,
                "deep_link": f"/receipts/{doc['receipt_id']}",
            },
            push=True,
        )
    except Exception:
        pass

    return doc


@router.get("/api/receipts")
async def list_receipts(
    request: Request,
    date: Optional[str] = Query(None, description="Filter to a single YYYY-MM-DD (IST)"),
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    phone: Optional[str] = Query(None),
    mode: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    user=Depends(require_staff),
):
    clinic_id = await resolve_clinic_id(request, user)
    q: Dict[str, Any] = tenant_filter(user, clinic_id, allow_global=True)
    if date:
        q["receipt_date"] = date
    elif from_date or to_date:
        rng: Dict[str, Any] = {}
        if from_date:
            rng["$gte"] = from_date
        if to_date:
            rng["$lte"] = to_date
        q["receipt_date"] = rng
    if phone:
        q["patient_phone"] = _normalize_phone(phone)
    if mode:
        q["mode"] = mode
    cursor = db.receipts.find(q, {"_id": 0}).sort([("receipt_date", -1), ("created_at", -1)]).limit(limit)
    return await cursor.to_list(length=limit)


@router.get("/api/receipts/daily-collection")
async def daily_collection(
    request: Request,
    date: Optional[str] = Query(None),
    user=Depends(require_staff),
):
    """Aggregate summary for one IST day:
      { date, total, count, by_mode, by_service }
    """
    clinic_id = await resolve_clinic_id(request, user)
    day = date or _ist_today_key()
    q: Dict[str, Any] = tenant_filter(user, clinic_id, allow_global=True)
    q["receipt_date"] = day
    rows = await db.receipts.find(q, {"_id": 0}).to_list(length=2000)
    by_mode: Dict[str, float] = {}
    by_service: Dict[str, float] = {}
    total = 0.0
    paid_total = 0.0
    balance_total = 0.0
    for r in rows:
        amt = float(r.get("total") or 0)
        paid_total += float(r.get("paid") or 0)
        balance_total += float(r.get("balance") or 0)
        total += amt
        m = r.get("mode") or "Other"
        by_mode[m] = round(by_mode.get(m, 0.0) + float(r.get("paid") or 0), 2)
        for it in r.get("items") or []:
            s = it.get("service_type") or "Other"
            by_service[s] = round(by_service.get(s, 0.0) + float(it.get("line_total") or 0), 2)
    return {
        "date": day,
        "count": len(rows),
        "total": round(total, 2),
        "paid": round(paid_total, 2),
        "balance": round(balance_total, 2),
        "by_mode": by_mode,
        "by_service": by_service,
    }


@router.get("/api/receipts/by-patient/{phone}")
async def receipts_by_patient(request: Request, phone: str, user=Depends(require_staff)):
    norm = _normalize_phone(phone)
    if not norm:
        raise HTTPException(status_code=400, detail="Invalid phone")
    clinic_id = await resolve_clinic_id(request, user)
    q: Dict[str, Any] = tenant_filter(user, clinic_id, allow_global=True)
    q["patient_phone"] = norm
    cursor = db.receipts.find(q, {"_id": 0}).sort("created_at", -1).limit(200)
    return await cursor.to_list(length=200)


@router.get("/api/receipts/{receipt_id}")
async def get_receipt(request: Request, receipt_id: str, user=Depends(require_staff)):
    clinic_id = await resolve_clinic_id(request, user)
    q: Dict[str, Any] = tenant_filter(user, clinic_id, allow_global=True)
    q["receipt_id"] = receipt_id
    row = await db.receipts.find_one(q, {"_id": 0})
    if not row:
        raise HTTPException(status_code=404, detail="Receipt not found")
    return row


@router.delete("/api/receipts/{receipt_id}")
async def delete_receipt(request: Request, receipt_id: str, user=Depends(require_owner)):
    """Owner-tier only — receipts are permanent for audit, but owners
    can delete a wrongly-entered one."""
    clinic_id = await resolve_clinic_id(request, user)
    q: Dict[str, Any] = tenant_filter(user, clinic_id, allow_global=True)
    q["receipt_id"] = receipt_id
    result = await db.receipts.delete_one(q)
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Receipt not found")
    return {"ok": True}
