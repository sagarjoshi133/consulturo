"""Comm V2 — Broadcast Templates.

Reusable announcement templates so staff can compose weekly notices
in two taps:
  1. Pick template → 2. Approve draft.

Design:
  * Collection: `comm_broadcast_templates`.
  * Fields:  id, name (unique), title, body, category, audience_mode,
             action_type, selected_patient_user_ids (frozen, optional),
             created_by_user_id, created_by_role, is_active,
             use_count, last_used_at, created_at, updated_at.
  * Templates are CLINIC-WIDE (no per-user templates in v1).
  * Owner-tier can create / edit / delete.
  * All staff (doctor, assistant, reception, nursing, owner-tier) can
    LIST + USE templates.
  * Uses `comm_broadcasts.create_draft` to instantiate — so every
    template use inherits the full draft lifecycle (submit → approve →
    schedule → dispatch).
  * `use_count` and `last_used_at` bump atomically each apply.

Variables: not supported in v1 (Keep-it-simple). Add tokens like
    {{clinic_name}}, {{today}} in a later pass if requested.
"""
from __future__ import annotations

import base64
import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from services import comm_broadcasts as _b

OWNER_TIER = _b.OWNER_TIER
STAFF_TIER = _b.STAFF_TIER
CATEGORIES = _b.CATEGORIES
AUDIENCE_MODES = _b.AUDIENCE_MODES

_NAME_MAX = 80
_TITLE_MAX = 200
_BODY_MAX = 4000
_NAME_ALLOWED = re.compile(r"^(?=.*\w)[\w\s\-\u2019'&/.:!?()]+$")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _is_owner(user: Dict[str, Any]) -> bool:
    return (user or {}).get("role") in OWNER_TIER


def _is_staff(user: Dict[str, Any]) -> bool:
    return (user or {}).get("role") in STAFF_TIER


# ── Indexes (called once by boot migration) ─────────────────────

async def ensure_indexes(db) -> List[str]:
    """Idempotent index bootstrap. Returns newly-created index names."""
    created: List[str] = []
    existing = set()
    async for idx in db.comm_broadcast_templates.list_indexes():
        existing.add(idx.get("name"))
    plan = [
        {"name": "tpl_name_unique",
         "keys": [("name", 1)],
         "unique": True,
         "partialFilterExpression": {"name": {"$type": "string"}}},
        {"name": "tpl_active_updated",
         "keys": [("is_active", 1), ("updated_at", -1)]},
        {"name": "tpl_category",
         "keys": [("category", 1), ("updated_at", -1)]},
    ]
    for spec in plan:
        n = spec["name"]
        if n in existing:
            continue
        keys = spec["keys"]
        opts = {k: v for k, v in spec.items() if k not in ("name", "keys")}
        try:
            await db.comm_broadcast_templates.create_index(keys, name=n, **opts)
            created.append(n)
        except Exception as e:
            print(f"[comm_broadcast_templates] skipped {n}: {e}")
    return created


# ── Validation ──────────────────────────────────────────────────

def _validate_fields(*, name: str, title: str, body: str,
                     category: str, audience_mode: str,
                     action_type: str,
                     selected_patient_user_ids: Optional[List[str]] = None) -> None:
    if not name or len(name) > _NAME_MAX:
        raise ValueError("bad_name")
    if not _NAME_ALLOWED.match(name):
        raise ValueError("bad_name_chars")
    if not title or len(title) > _TITLE_MAX:
        raise ValueError("bad_title")
    if not body or len(body) > _BODY_MAX:
        raise ValueError("bad_body")
    if category not in CATEGORIES:
        raise ValueError("bad_category")
    if audience_mode not in AUDIENCE_MODES:
        raise ValueError("bad_audience_mode")
    if audience_mode == "selected_patients" and not selected_patient_user_ids:
        raise ValueError("selected_patients_required")
    if action_type not in {"open_broadcast", "open_home", "open_booking",
                            "open_notice", "none"}:
        raise ValueError("bad_action_type")


# ── CRUD ────────────────────────────────────────────────────────

async def create_template(
    db,
    *,
    actor: Dict[str, Any],
    name: str,
    title: str,
    body: str,
    category: str = "announcements",
    audience_mode: str = "patients",
    action_type: str = "open_broadcast",
    selected_patient_user_ids: Optional[List[str]] = None,
) -> Dict[str, Any]:
    if not _is_owner(actor):
        raise PermissionError("owner_only")
    _validate_fields(name=name, title=title, body=body,
                        category=category, audience_mode=audience_mode,
                        action_type=action_type,
                        selected_patient_user_ids=selected_patient_user_ids)
    now = _now()
    doc = {
        "id": str(uuid.uuid4()),
        "name": name.strip(),
        "title": title.strip(),
        "body": body.strip(),
        "category": category,
        "audience_mode": audience_mode,
        "action_type": action_type,
        "selected_patient_user_ids": list(selected_patient_user_ids or []),
        "created_by_user_id": actor.get("user_id") or actor.get("id"),
        "created_by_role": actor.get("role"),
        "is_active": True,
        "use_count": 0,
        "last_used_at": None,
        "created_at": now,
        "updated_at": now,
        "schema_version": 1,
    }
    try:
        await db.comm_broadcast_templates.insert_one(doc)
    except Exception:
        raise ValueError("duplicate_name")
    doc.pop("_id", None)
    return doc


async def update_template(
    db,
    *,
    actor: Dict[str, Any],
    template_id: str,
    fields: Dict[str, Any],
) -> Dict[str, Any]:
    if not _is_owner(actor):
        raise PermissionError("owner_only")
    t = await get_template(db, template_id)
    if not t:
        raise ValueError("template_not_found")
    allowed = {"name", "title", "body", "category", "audience_mode",
                "action_type", "selected_patient_user_ids", "is_active"}
    update = {k: v for k, v in fields.items() if k in allowed}
    if not update:
        return t
    # Re-validate against merged state (only the fields that would change).
    merged = {**t, **update}
    try:
        _validate_fields(
            name=merged["name"], title=merged["title"], body=merged["body"],
            category=merged["category"], audience_mode=merged["audience_mode"],
            action_type=merged["action_type"],
            selected_patient_user_ids=merged.get("selected_patient_user_ids"),
        )
    except ValueError:
        raise
    update["updated_at"] = _now()
    try:
        await db.comm_broadcast_templates.update_one({"id": template_id}, {"$set": update})
    except Exception:
        raise ValueError("duplicate_name")
    return await get_template(db, template_id)


async def delete_template(
    db, *, actor: Dict[str, Any], template_id: str,
) -> bool:
    """Soft delete — flip is_active=false so historical drafts still
    trace back cleanly. Hard delete only via admin one-shot."""
    if not _is_owner(actor):
        raise PermissionError("owner_only")
    res = await db.comm_broadcast_templates.update_one(
        {"id": template_id, "is_active": True},
        {"$set": {"is_active": False, "updated_at": _now()}},
    )
    return bool(res.modified_count)


async def get_template(db, template_id: str) -> Optional[Dict[str, Any]]:
    return await db.comm_broadcast_templates.find_one(
        {"id": template_id}, {"_id": 0},
    )


# ── List (with cursor) ─────────────────────────────────────────

def _encode_cursor(ts: datetime, tid: str) -> str:
    payload = json.dumps({"k": ts.isoformat(), "i": tid})
    return base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")


def _decode_cursor(cursor: Optional[str]) -> Optional[Tuple[datetime, str]]:
    if not cursor:
        return None
    try:
        pad = "=" * (-len(cursor) % 4)
        payload = json.loads(base64.urlsafe_b64decode((cursor + pad).encode()))
        return datetime.fromisoformat(payload["k"]), str(payload["i"])
    except Exception:
        return None


async def list_templates(
    db,
    *,
    actor: Dict[str, Any],
    limit: int = 30,
    cursor: Optional[str] = None,
    category: Optional[str] = None,
    include_inactive: bool = False,
    search: Optional[str] = None,
) -> Dict[str, Any]:
    if not _is_staff(actor):
        raise PermissionError("staff_only")
    limit = max(1, min(100, int(limit or 30)))
    q: Dict[str, Any] = {}
    if not include_inactive:
        q["is_active"] = True
    if category and category in CATEGORIES:
        q["category"] = category
    if search:
        safe = re.escape(search.strip())[:80]
        if safe:
            q["$or"] = [
                {"name": {"$regex": safe, "$options": "i"}},
                {"title": {"$regex": safe, "$options": "i"}},
            ]
    dec = _decode_cursor(cursor)
    if dec:
        ts, tid = dec
        q.setdefault("$and", [])
        q["$and"].append({
            "$or": [
                {"updated_at": {"$lt": ts}},
                {"updated_at": ts, "id": {"$lt": tid}},
            ]
        })
    rows: List[Dict[str, Any]] = []
    async for r in db.comm_broadcast_templates.find(q, {"_id": 0}).sort(
        [("updated_at", -1), ("id", -1)]
    ).limit(limit + 1):
        rows.append(r)
    next_cursor = None
    if len(rows) > limit:
        last = rows[limit - 1]
        rows = rows[:limit]
        next_cursor = _encode_cursor(last["updated_at"], last["id"])
    return {"items": rows, "next_cursor": next_cursor, "count": len(rows)}


# ── Instantiate → new draft broadcast ──────────────────────────

async def create_draft_from_template(
    db,
    *,
    actor: Dict[str, Any],
    template_id: str,
    overrides: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Create a NEW draft broadcast from a template.

    Overrides may replace: title, body, category, audience_mode,
    selected_patient_user_ids, action_type, scheduled_at. Anything
    else is inherited from the template.

    Idempotency: templates are safe to re-apply — this always creates
    a brand-new broadcast row (the template itself is unchanged).
    Bumps `use_count` and `last_used_at` atomically post-instantiation.
    """
    if not _is_staff(actor):
        raise PermissionError("staff_only")
    t = await get_template(db, template_id)
    if not t:
        raise ValueError("template_not_found")
    if not t.get("is_active"):
        raise ValueError("template_inactive")

    overrides = overrides or {}
    title = overrides.get("title") or t["title"]
    body = overrides.get("body") or t["body"]
    category = overrides.get("category") or t.get("category") or "announcements"
    audience_mode = overrides.get("audience_mode") or t["audience_mode"]
    selected_patient_user_ids = (
        overrides.get("selected_patient_user_ids")
        if overrides.get("selected_patient_user_ids") is not None
        else t.get("selected_patient_user_ids") or []
    )
    action_type = overrides.get("action_type") or t.get("action_type") or "open_broadcast"
    scheduled_at = overrides.get("scheduled_at")

    draft = await _b.create_draft(
        db, actor=actor,
        title=title, body=body,
        category=category, audience_mode=audience_mode,
        selected_patient_user_ids=selected_patient_user_ids,
        scheduled_at=scheduled_at, action_type=action_type,
    )
    # Track lineage on the draft so analytics can group by template.
    await db.comm_broadcasts.update_one(
        {"id": draft["id"]},
        {"$set": {"source_template_id": template_id,
                   "source_template_name": t["name"]}},
    )
    draft["source_template_id"] = template_id
    draft["source_template_name"] = t["name"]

    # Bump use_count + last_used_at atomically.
    await db.comm_broadcast_templates.update_one(
        {"id": template_id},
        {"$inc": {"use_count": 1},
         "$set": {"last_used_at": _now()}},
    )

    # Best-effort audit trail.
    try:
        from services import comm_audit
        await comm_audit.log(
            db, action="broadcast_template.apply",
            actor_user_id=actor.get("user_id") or actor.get("id"),
            actor_role=actor.get("role"),
            target_type="broadcast_template", target_id=template_id,
            metadata={"broadcast_id": draft["id"], "overrides": overrides},
        )
    except Exception:
        pass
    return draft
