"""ConsultUro — Clinic admin endpoints (Phase E polish).

Adds the higher-stakes lifecycle + reporting endpoints that didn't fit
in the basic CRUD router:

  • DELETE /api/clinics/{clinic_id}             — soft-delete (archive)
  • POST   /api/clinics/{clinic_id}/restore     — un-archive
  • GET    /api/clinics/{clinic_id}/export.zip  — full per-tenant export
                                                   (CSVs of every
                                                    tenant-scoped
                                                    collection + a
                                                    manifest.json)

The audit-log read endpoint lives in services.audit (so the helper
+ reader are colocated). Both routers are wired in server.py at
startup.
"""
from __future__ import annotations

import csv
import io
import json
import time
import uuid
import zipfile
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from auth_deps import is_super_owner, require_user
from db import db
from services.audit import log_action
from services.tenancy import (
    CLINICS_COLL,
    MEMBERSHIPS_COLL,
    TENANT_SCOPED_COLLECTIONS,
    get_clinic_by_id,
)

router = APIRouter()


def _uid(user: Dict[str, Any]) -> str:
    return user.get("user_id") or user.get("id") or ""


async def _require_clinic_admin(user: Dict[str, Any], clinic_id: str) -> Dict[str, Any]:
    """Tighter guard than the regular member check — only super_owner
    or the clinic's primary_owner can run lifecycle / export ops."""
    clinic = await get_clinic_by_id(clinic_id)
    if not clinic:
        raise HTTPException(status_code=404, detail="Clinic not found")
    if is_super_owner(user):
        return clinic
    if clinic.get("primary_owner_id") != _uid(user):
        raise HTTPException(
            status_code=403,
            detail="Only the clinic's primary owner can perform this action.",
        )
    return clinic


# ── Soft-delete / restore ──────────────────────────────────────────────
@router.delete("/api/clinics/{clinic_id}")
async def soft_delete_clinic(
    clinic_id: str,
    request: Request,
    user=Depends(require_user),
) -> Dict[str, Any]:
    """Archive a clinic. SAFE — no data is removed:
      • clinic.deleted_at = now, is_active = false
      • all memberships set to is_active = false (members lose access
        until restore)
      • the clinic's tenant-scoped data is left intact (so an export
        can still produce a complete archive after deletion).

    Use POST .../restore to undo within the retention window.
    """
    clinic = await _require_clinic_admin(user, clinic_id)
    if clinic.get("deleted_at"):
        return {"ok": True, "already_archived": True, "clinic_id": clinic_id}

    now_ms = int(time.time() * 1000)
    await db[CLINICS_COLL].update_one(
        {"clinic_id": clinic_id},
        {"$set": {
            "deleted_at": now_ms,
            "is_active": False,
            "deleted_by": _uid(user),
            "updated_at": now_ms,
        }},
    )
    # Cascade: deactivate every membership so dashboards stop loading.
    res = await db[MEMBERSHIPS_COLL].update_many(
        {"clinic_id": clinic_id, "is_active": True},
        {"$set": {"is_active": False, "deactivated_at": now_ms, "deactivated_reason": "clinic_archived"}},
    )

    await log_action(
        actor=user,
        clinic_id=clinic_id,
        action="clinic.archive",
        target_id=clinic_id,
        target_type="clinic",
        meta={"members_deactivated": res.modified_count},
    )
    return {
        "ok": True,
        "clinic_id": clinic_id,
        "members_deactivated": res.modified_count,
        "deleted_at": now_ms,
    }


@router.post("/api/clinics/{clinic_id}/restore")
async def restore_clinic(
    clinic_id: str,
    request: Request,
    user=Depends(require_user),
) -> Dict[str, Any]:
    """Reverse a soft-delete. Reactivates the clinic + its memberships
    that were deactivated by the archive action."""
    # _require_clinic_admin would 404 a soft-deleted clinic if
    # get_clinic_by_id ignored deleted_at — make sure we bypass that.
    raw = await db[CLINICS_COLL].find_one({"clinic_id": clinic_id}, {"_id": 0})
    if not raw:
        raise HTTPException(status_code=404, detail="Clinic not found")
    if not is_super_owner(user) and raw.get("primary_owner_id") != _uid(user):
        raise HTTPException(status_code=403, detail="Only the clinic's primary owner can restore it.")
    if not raw.get("deleted_at"):
        return {"ok": True, "already_active": True, "clinic_id": clinic_id}

    now_ms = int(time.time() * 1000)
    await db[CLINICS_COLL].update_one(
        {"clinic_id": clinic_id},
        {"$set": {"deleted_at": None, "is_active": True, "updated_at": now_ms}, "$unset": {"deleted_by": ""}},
    )
    res = await db[MEMBERSHIPS_COLL].update_many(
        {"clinic_id": clinic_id, "deactivated_reason": "clinic_archived"},
        {"$set": {"is_active": True}, "$unset": {"deactivated_at": "", "deactivated_reason": ""}},
    )
    await log_action(
        actor=user,
        clinic_id=clinic_id,
        action="clinic.restore",
        target_id=clinic_id,
        target_type="clinic",
        meta={"members_reactivated": res.modified_count},
    )
    return {
        "ok": True,
        "clinic_id": clinic_id,
        "members_reactivated": res.modified_count,
    }


# ── Per-tenant data export ──────────────────────────────────────────────
def _flatten(value: Any) -> str:
    """Coerce a cell value to something CSV-safe. dicts / lists → JSON."""
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        try:
            return json.dumps(value, ensure_ascii=False, default=str)
        except Exception:
            return str(value)
    if isinstance(value, datetime):
        return value.replace(microsecond=0).isoformat()
    return str(value)


def _docs_to_csv(docs: List[Dict[str, Any]]) -> bytes:
    if not docs:
        return b""
    # Stable column order: union of keys, alphabetised — predictable
    # for diffs across exports.
    headers: List[str] = sorted({k for d in docs for k in d.keys()})
    buf = io.StringIO()
    w = csv.writer(buf, quoting=csv.QUOTE_MINIMAL)
    w.writerow(headers)
    for d in docs:
        w.writerow([_flatten(d.get(h, "")) for h in headers])
    return buf.getvalue().encode("utf-8")


@router.get("/api/clinics/{clinic_id}/export.zip")
async def export_clinic_data(
    clinic_id: str,
    request: Request,
    user=Depends(require_user),
):
    """Stream a ZIP of every tenant-scoped collection's rows for
    clinic_id, plus a manifest. CSV rows preserve every Mongo field
    (dicts/lists are serialised as JSON inside the cell).

    Permission: super_owner OR the clinic's primary_owner. The export
    is auditable (logged via services.audit)."""
    clinic = await _require_clinic_admin(user, clinic_id)

    buf = io.BytesIO()
    manifest: Dict[str, Any] = {
        "clinic_id": clinic_id,
        "clinic_name": clinic.get("name"),
        "slug": clinic.get("slug"),
        "exported_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "exported_by": _uid(user),
        "collections": {},
    }

    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        # Always include the clinic + memberships rows themselves.
        zf.writestr(
            "clinic.json",
            json.dumps(clinic, ensure_ascii=False, default=str, indent=2).encode("utf-8"),
        )
        members = [
            m
            async for m in db[MEMBERSHIPS_COLL].find(
                {"clinic_id": clinic_id}, {"_id": 0}
            )
        ]
        zf.writestr("memberships.csv", _docs_to_csv(members))
        manifest["collections"]["memberships"] = len(members)

        # Tenant-scoped collections (defined in services.tenancy).
        for coll in TENANT_SCOPED_COLLECTIONS:
            try:
                cursor = db[coll].find({"clinic_id": clinic_id}, {"_id": 0})
                rows = await cursor.to_list(length=20_000)
            except Exception as e:  # noqa: BLE001
                manifest["collections"][coll] = f"error: {e}"
                continue
            csv_bytes = _docs_to_csv(rows)
            if csv_bytes:
                zf.writestr(f"{coll}.csv", csv_bytes)
            manifest["collections"][coll] = len(rows)

        # Audit log — useful in an export so the recipient can see who
        # touched what (also bounded to this clinic).
        audit_rows = [
            r
            async for r in db["audit_log"].find(
                {"clinic_id": clinic_id}, {"_id": 0}
            )
            .sort("ts", -1)
            .limit(5000)
        ]
        if audit_rows:
            zf.writestr("audit_log.csv", _docs_to_csv(audit_rows))
            manifest["collections"]["audit_log"] = len(audit_rows)

        zf.writestr(
            "manifest.json",
            json.dumps(manifest, ensure_ascii=False, default=str, indent=2).encode("utf-8"),
        )

    buf.seek(0)
    await log_action(
        actor=user,
        clinic_id=clinic_id,
        action="clinic.export",
        target_id=clinic_id,
        target_type="clinic",
        meta={
            "rows": sum(v for v in manifest["collections"].values() if isinstance(v, int)),
        },
    )
    safe_slug = (clinic.get("slug") or clinic_id).replace("/", "_")
    filename = f"consulturo-{safe_slug}-{int(time.time())}.zip"
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )
