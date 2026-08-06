"""ConsultUro — Razorpay Payment Gateway router.

Endpoints (all under /api/payments/razorpay):
  · GET    /config                — public config (key_id, mode, enabled)
  · POST   /order                 — create a Razorpay order for a target
                                    (consultation booking / IPD bill / Rx receipt)
  · POST   /verify                — verify the signature returned by checkout
                                    and persist a Receipt + mark target as paid
  · POST   /webhook               — Razorpay webhook (server→server) for async
                                    confirmation; updates payment status

Notes:
  • Activation pending — the system gracefully falls back to "disabled" if
    RAZORPAY_KEY_ID / SECRET are empty so the rest of the app keeps working.
  • Amounts are stored in **paise** on the wire (Razorpay convention) but
    we expose `amount_inr` in API responses for convenience.
  • All persisted records live in collection `payments` keyed by `payment_id`
    (Razorpay's pay_xxx) plus a local `local_id` so the patient can be
    deep-linked from a notification (e.g. /receipts/<local_id>).
"""
from __future__ import annotations
import os
import uuid
import hmac
import hashlib
import time
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from db import db
from auth_deps import require_user, require_staff

try:
    import razorpay  # type: ignore
except Exception:  # pragma: no cover
    razorpay = None  # noqa: N816

log = logging.getLogger("razorpay")

router = APIRouter(prefix="/api/payments/razorpay", tags=["payments"])


# ─── Config helpers ──────────────────────────────────────────────


def _cfg() -> Dict[str, Any]:
    return {
        "mode": (os.environ.get("RAZORPAY_MODE") or "test").lower(),
        "key_id": (os.environ.get("RAZORPAY_KEY_ID") or "").strip(),
        "key_secret": (os.environ.get("RAZORPAY_KEY_SECRET") or "").strip(),
        "webhook_secret": (os.environ.get("RAZORPAY_WEBHOOK_SECRET") or "").strip(),
    }


def _enabled() -> bool:
    c = _cfg()
    return bool(c["key_id"] and c["key_secret"] and razorpay is not None)


def _client():
    if not _enabled():
        raise HTTPException(
            status_code=503,
            detail=(
                "Razorpay is not yet activated. Please add RAZORPAY_KEY_ID and "
                "RAZORPAY_KEY_SECRET to backend/.env. Activation pending."
            ),
        )
    c = _cfg()
    return razorpay.Client(auth=(c["key_id"], c["key_secret"]))


# ─── Pydantic models ─────────────────────────────────────────────


class OrderBody(BaseModel):
    amount_inr: float = Field(..., gt=0, description="Amount in rupees (₹)")
    target_kind: str = Field(..., description="consultation | ipd | receipt | rx | other")
    target_id: Optional[str] = Field(None, description="booking_id / admission_id / receipt_id")
    description: Optional[str] = Field(None, description="Shown in checkout & saved on receipt")
    patient_name: Optional[str] = None
    patient_phone: Optional[str] = None
    patient_email: Optional[str] = None
    # Optional metadata stored alongside the order for later reconciliation
    notes: Optional[Dict[str, Any]] = None


class VerifyBody(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str
    # Echo back the target so we can mark it paid even if the order
    # was lost to a flaky network (idempotency by payment_id).
    target_kind: Optional[str] = None
    target_id: Optional[str] = None


# ─── Endpoints ───────────────────────────────────────────────────


@router.get("/config")
async def get_config() -> Dict[str, Any]:
    """Public-safe config consumed by the mobile checkout WebView."""
    c = _cfg()
    return {
        "enabled": _enabled(),
        "mode": c["mode"],
        "key_id": c["key_id"] if _enabled() else "",
        "supports": ["upi", "card", "netbanking", "wallet"],
        "currency": "INR",
    }


@router.post("/order")
async def create_order(body: OrderBody, user=Depends(require_user)) -> Dict[str, Any]:
    """Create a Razorpay order and persist the local record. Returns the
    order id + key_id that the frontend feeds into the checkout."""
    client = _client()  # also enforces 'enabled'

    amount_paise = int(round(float(body.amount_inr) * 100))
    if amount_paise < 100:
        raise HTTPException(status_code=400, detail="Minimum amount is ₹1.00")

    receipt_short = f"cu_{uuid.uuid4().hex[:16]}"  # ≤40 chars (Razorpay limit)
    notes = {
        "target_kind": body.target_kind,
        "target_id": body.target_id or "",
        "user_id": (user or {}).get("user_id") or "",
        **(body.notes or {}),
    }
    try:
        order = client.order.create({
            "amount": amount_paise,
            "currency": "INR",
            "payment_capture": 1,
            "receipt": receipt_short,
            "notes": notes,
        })
    except Exception as e:  # noqa: BLE001
        log.exception("razorpay order.create failed")
        raise HTTPException(status_code=502, detail=f"Razorpay error: {e}")

    local_id = f"pay_{uuid.uuid4().hex[:18]}"
    rec = {
        "local_id": local_id,
        "order_id": order["id"],
        "amount_paise": amount_paise,
        "amount_inr": amount_paise / 100.0,
        "currency": "INR",
        "status": "created",
        "target_kind": body.target_kind,
        "target_id": body.target_id,
        "description": body.description,
        "patient_name": body.patient_name,
        "patient_phone": body.patient_phone,
        "patient_email": body.patient_email,
        "user_id": (user or {}).get("user_id"),
        "user_email": (user or {}).get("email"),
        "notes": notes,
        "created_at": _now_iso(),
        "mode": _cfg()["mode"],
    }
    await db["payments"].insert_one(rec)

    return {
        "ok": True,
        "local_id": local_id,
        "order_id": order["id"],
        "amount": amount_paise,
        "amount_inr": amount_paise / 100.0,
        "currency": "INR",
        "key_id": _cfg()["key_id"],
        "name": "ConsultUro",
        "description": body.description or "ConsultUro payment",
        "prefill": {
            "name": body.patient_name or (user or {}).get("name") or "",
            "email": body.patient_email or (user or {}).get("email") or "",
            "contact": body.patient_phone or (user or {}).get("phone") or "",
        },
        "theme": {"color": "#0E7C8B"},
        "mode": _cfg()["mode"],
    }


@router.post("/verify")
async def verify_payment(body: VerifyBody, user=Depends(require_user)) -> Dict[str, Any]:
    """Verify HMAC signature returned by Razorpay Checkout, mark the
    payment + linked target as paid."""
    client = _client()
    try:
        client.utility.verify_payment_signature({
            "razorpay_order_id": body.razorpay_order_id,
            "razorpay_payment_id": body.razorpay_payment_id,
            "razorpay_signature": body.razorpay_signature,
        })
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid signature")

    # Idempotent: if already marked paid, no-op.
    existing = await db["payments"].find_one({"payment_id": body.razorpay_payment_id})
    if existing and existing.get("status") == "paid":
        return {"ok": True, "already_paid": True, "local_id": existing.get("local_id")}

    rec = await db["payments"].find_one({"order_id": body.razorpay_order_id})
    if not rec:
        raise HTTPException(status_code=404, detail="Order not found")

    await db["payments"].update_one(
        {"_id": rec["_id"]},
        {"$set": {
            "payment_id": body.razorpay_payment_id,
            "signature": body.razorpay_signature,
            "status": "paid",
            "paid_at": _now_iso(),
        }},
    )

    # Mark linked target as paid (booking / admission / receipt).
    # Fetch the full Razorpay payment info so we can stamp the actual
    # method (upi/card/wallet) onto the receipt mode.
    try:
        full = _client().payment.fetch(body.razorpay_payment_id)
    except Exception:
        full = None
    await _mark_target_paid(
        kind=body.target_kind or rec.get("target_kind"),
        target_id=body.target_id or rec.get("target_id"),
        payment_id=body.razorpay_payment_id,
        amount_inr=rec.get("amount_inr"),
        raw_payment=full,
    )

    return {
        "ok": True,
        "local_id": rec.get("local_id"),
        "payment_id": body.razorpay_payment_id,
        "amount_inr": rec.get("amount_inr"),
        "target_kind": rec.get("target_kind"),
        "target_id": rec.get("target_id"),
    }


@router.post("/webhook")
async def webhook(request: Request) -> Dict[str, Any]:
    """Server-to-server webhook from Razorpay. Validates the signature using
    RAZORPAY_WEBHOOK_SECRET (set on the Razorpay dashboard) and updates
    the local payment row. Idempotent on payment_id."""
    secret = _cfg()["webhook_secret"]
    if not secret:
        raise HTTPException(status_code=503, detail="Webhook secret not configured")

    body = await request.body()
    sig = request.headers.get("X-Razorpay-Signature", "")
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig):
        raise HTTPException(status_code=400, detail="Invalid webhook signature")

    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Bad JSON")

    event = payload.get("event") or ""
    pay = ((payload.get("payload") or {}).get("payment") or {}).get("entity") or {}
    payment_id = pay.get("id")
    order_id = pay.get("order_id")
    amount = pay.get("amount")  # paise
    if not (payment_id and order_id):
        return {"ok": True, "ignored": event}

    update: Dict[str, Any] = {
        "last_webhook_event": event,
        "last_webhook_at": _now_iso(),
        "raw_payment": pay,
    }
    if event == "payment.captured":
        update["status"] = "paid"
        update["payment_id"] = payment_id
        update["paid_at"] = _now_iso()
    elif event == "payment.failed":
        update["status"] = "failed"
        update["failure_reason"] = pay.get("error_description") or ""

    rec = await db["payments"].find_one({"order_id": order_id})
    if not rec:
        # Create a shadow record so this event isn't lost (rare race).
        await db["payments"].insert_one({
            "local_id": f"pay_{uuid.uuid4().hex[:18]}",
            "order_id": order_id,
            "payment_id": payment_id,
            "amount_paise": amount,
            "amount_inr": (amount or 0) / 100.0,
            "currency": "INR",
            "status": "paid" if event == "payment.captured" else "failed",
            "created_at": _now_iso(),
            **update,
        })
    else:
        await db["payments"].update_one({"_id": rec["_id"]}, {"$set": update})

    if event == "payment.captured":
        await _mark_target_paid(
            kind=(rec or {}).get("target_kind"),
            target_id=(rec or {}).get("target_id"),
            payment_id=payment_id,
            amount_inr=(amount or 0) / 100.0,
            raw_payment=pay,
        )

    return {"ok": True, "event": event}


@router.get("/list")
async def list_payments(user=Depends(require_user), limit: int = 50) -> Dict[str, Any]:
    """List the current user's payments (most recent first). Staff/owner
    callers can override with ?for_user=<id>... but kept simple for v1."""
    uid = (user or {}).get("user_id")
    cur = db["payments"].find({"user_id": uid}).sort("created_at", -1).limit(int(limit))
    items = []
    async for row in cur:
        row.pop("_id", None)
        row.pop("signature", None)
        items.append(row)
    return {"items": items, "count": len(items)}


@router.get("/admin/list")
async def admin_list(user=Depends(require_staff), limit: int = 100) -> Dict[str, Any]:
    cur = db["payments"].find({}).sort("created_at", -1).limit(int(limit))
    items = []
    async for row in cur:
        row.pop("_id", None)
        row.pop("signature", None)
        items.append(row)
    return {"items": items, "count": len(items)}


# ─── Helpers ─────────────────────────────────────────────────────


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


async def _mark_target_paid(
    kind: Optional[str],
    target_id: Optional[str],
    payment_id: str,
    amount_inr: Optional[float],
    raw_payment: Optional[Dict[str, Any]] = None,
) -> None:
    """Best-effort mark the linked clinical entity as paid. Silently
    skipped when kind/target_id is missing or unknown.

    For receipts, additionally translate the Razorpay payment method
    (`upi` / `card` / `wallet` / …) into a friendly mode label so the
    Billing & Receipts list shows the actual method the patient used.
    """
    if not kind or not target_id:
        return
    patch = {
        "payment_status": "paid",
        "payment_id": payment_id,
        "paid_amount_inr": amount_inr,
        "paid_at": _now_iso(),
    }
    try:
        if kind == "consultation":
            await db["bookings"].update_one({"booking_id": target_id}, {"$set": patch})
        elif kind == "ipd":
            await db["ipd_admissions"].update_one({"admission_id": target_id}, {"$set": patch})
            await db["ipd_bills"].update_one({"bill_id": target_id}, {"$set": patch})
        elif kind in ("receipt", "rx"):
            # Fetch the Razorpay payment method so we can store a
            # user-friendly mode on the receipt ("UPI (Razorpay)" /
            # "Card (Razorpay)" / "Wallet (Razorpay)"). Default to
            # "UPI (Razorpay)" when we can't tell — most clinics in
            # India see >90% UPI traffic.
            method = ""
            if raw_payment:
                method = str(raw_payment.get("method") or "").lower()
            if not method:
                try:
                    cli = _client()
                    info = cli.payment.fetch(payment_id)
                    method = str((info or {}).get("method") or "").lower()
                except Exception:
                    method = ""
            friendly = "UPI (Razorpay)"
            if method == "card":
                friendly = "Card (Razorpay)"
            elif method == "wallet":
                friendly = "Wallet (Razorpay)"
            elif method == "upi":
                friendly = "UPI (Razorpay)"
            elif method == "netbanking":
                friendly = "Card (Razorpay)"
            receipt_patch = {
                **patch,
                "mode": friendly,
                "payment_ref": payment_id,
            }
            if amount_inr is not None and float(amount_inr) > 0:
                receipt_patch["paid"] = float(amount_inr)
                receipt_patch["balance"] = 0.0
            await db["receipts"].update_one({"receipt_id": target_id}, {"$set": receipt_patch})
            await db["prescriptions"].update_one({"prescription_id": target_id}, {"$set": patch})
    except Exception:  # noqa: BLE001
        log.exception("mark_target_paid failed for %s/%s", kind, target_id)
