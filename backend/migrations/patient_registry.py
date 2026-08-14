"""ConsultUro 2.0 — Phase D migration shim.

Every boot (idempotent):
  • Indexes: patients.phone_digits, patients.patient_id,
    {bookings, prescriptions, surgeries, receipts}.patient_id.

Once (guarded by schema_migrations "003_patient_registry"):
  • Stamp patient_id + phone_digits onto every existing patients row.
  • Get-or-create patients rows for orphan phones found only in
    activity collections (legacy data without a registry row).
  • Stamp patient_id onto activity rows by phone match (cap 10 000
    per collection).
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict

from db import db

MIGRATION_NAME = "003_patient_registry"
_ACTIVITY = ("bookings", "prescriptions", "surgeries", "receipts")


def _last10(raw) -> str:
    digits = re.sub(r"\D", "", raw or "")
    return digits[-10:] if len(digits) >= 10 else digits


async def run_patient_registry_migration() -> Dict[str, Any]:
    now = datetime.now(timezone.utc)
    summary: Dict[str, Any] = {"indexes": "ok"}

    # ── Indexes (every boot) ─────────────────────────────────────────
    try:
        await db.patients.create_index("phone_digits")
        await db.patients.create_index("patient_id")
        for coll in _ACTIVITY:
            await db[coll].create_index("patient_id")
    except Exception as e:
        summary["indexes"] = f"error: {str(e)[:200]}"

    # ── One-time backfill ────────────────────────────────────────────
    done = await db.schema_migrations.find_one({"name": MIGRATION_NAME})
    if done:
        summary["backfill"] = "already_applied"
        return summary

    # 1) patient_id + phone_digits on every patients row.
    stamped_patients = 0
    async for r in db.patients.find({}, {"_id": 1, "patient_id": 1, "phone": 1, "phone_digits": 1}):
        patch: Dict[str, Any] = {}
        if not r.get("patient_id"):
            patch["patient_id"] = str(uuid.uuid4())
        digits = _last10(r.get("phone"))
        if digits and r.get("phone_digits") != digits:
            patch["phone_digits"] = digits
        if patch:
            await db.patients.update_one({"_id": r["_id"]}, {"$set": patch})
            stamped_patients += 1
    summary["patients_stamped"] = stamped_patients

    # 2) phone_digits → patient_id map.
    pid_by_phone: Dict[str, str] = {}
    async for r in db.patients.find(
        {"patient_id": {"$exists": True}}, {"_id": 0, "patient_id": 1, "phone_digits": 1, "phone": 1}
    ):
        d = r.get("phone_digits") or _last10(r.get("phone"))
        if d and d not in pid_by_phone:
            pid_by_phone[d] = r["patient_id"]

    # 3) Stamp activity rows (creating registry rows for orphan phones).
    created_from_activity = 0
    for coll in _ACTIVITY:
        stamped = 0
        async for row in db[coll].find(
            {"patient_id": {"$exists": False},
             "patient_phone": {"$exists": True, "$nin": [None, ""]}},
            {"_id": 1, "patient_phone": 1, "patient_name": 1, "registration_no": 1},
        ).limit(10000):
            digits = _last10(row.get("patient_phone"))
            if not digits:
                continue
            pid = pid_by_phone.get(digits)
            if not pid:
                pid = str(uuid.uuid4())
                await db.patients.insert_one({
                    "patient_id": pid,
                    "phone": digits,
                    "phone_digits": digits,
                    "name": row.get("patient_name"),
                    "reg_no": row.get("registration_no"),
                    "first_seen_at": now,
                    "created_at": now,
                    "updated_at": now,
                    "backfilled": True,
                })
                pid_by_phone[digits] = pid
                created_from_activity += 1
            await db[coll].update_one({"_id": row["_id"]}, {"$set": {"patient_id": pid}})
            stamped += 1
        summary[f"{coll}_stamped"] = stamped
    summary["patients_created_from_activity"] = created_from_activity

    await db.schema_migrations.insert_one({
        "name": MIGRATION_NAME,
        "applied_at": now,
        **{k: v for k, v in summary.items() if k != "indexes"},
    })
    summary["backfill"] = "applied"
    return summary
