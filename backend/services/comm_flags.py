"""Communications V2 feature flags.

Environment-controlled with SAFE defaults (all off, except mirror_legacy).
Read once per process from env, then may be overridden at runtime via the
owner-protected /api/v2/communications/admin/flags endpoint (writes go to
db.comm_flags and take effect on next _get_flag call — no restart needed).

Never fail closed on a missing collection: defaults are baked in.
"""
from __future__ import annotations

import os
from typing import Any, Dict, Optional


def _env_bool(name: str, default: str = "false") -> bool:
    return (os.environ.get(name, default) or "").strip().lower() in ("1", "true", "yes", "on")


def _env_list(name: str) -> list:
    raw = (os.environ.get(name, "") or "").strip()
    if not raw:
        return []
    return [x.strip() for x in raw.split(",") if x.strip()]


# Default (env-driven) snapshot. Safe defaults.
_ENV_DEFAULTS: Dict[str, Any] = {
    "COMMUNICATIONS_V2_ENABLED": _env_bool("COMMUNICATIONS_V2_ENABLED", "false"),
    "COMMUNICATIONS_V2_CANARY_USER_IDS": _env_list("COMMUNICATIONS_V2_CANARY_USER_IDS"),
    "COMMUNICATIONS_V2_MIRROR_LEGACY": _env_bool("COMMUNICATIONS_V2_MIRROR_LEGACY", "true"),
    "COMMUNICATIONS_V2_PUSH_ENABLED": _env_bool("COMMUNICATIONS_V2_PUSH_ENABLED", "false"),
    "COMMUNICATIONS_V2_MESSAGES_ENABLED": _env_bool("COMMUNICATIONS_V2_MESSAGES_ENABLED", "false"),
    "COMMUNICATIONS_V2_BROADCASTS_ENABLED": _env_bool("COMMUNICATIONS_V2_BROADCASTS_ENABLED", "false"),
    "COMMUNICATIONS_V2_HOME_NOTICES_ENABLED": _env_bool("COMMUNICATIONS_V2_HOME_NOTICES_ENABLED", "false"),
    "COMMUNICATIONS_V2_LEGACY_RUNTIME_DISABLED": _env_bool("COMMUNICATIONS_V2_LEGACY_RUNTIME_DISABLED", "false"),
    "COMMUNICATIONS_V2_ATTACHMENTS_ENABLED": _env_bool("COMMUNICATIONS_V2_ATTACHMENTS_ENABLED", "false"),
}


async def _load_db_overrides(db) -> Dict[str, Any]:
    try:
        rows = {}
        async for r in db.comm_flags.find({}, {"_id": 0}):
            rows[r.get("key")] = r.get("value")
        return rows
    except Exception:
        return {}


async def get_all_flags(db) -> Dict[str, Any]:
    """Return the currently-effective flag map (env defaults + DB overrides)."""
    out = dict(_ENV_DEFAULTS)
    overrides = await _load_db_overrides(db)
    for k, v in overrides.items():
        if k in out:
            out[k] = v
    return out


async def get_flag(db, key: str, default: Any = None) -> Any:
    all_flags = await get_all_flags(db)
    return all_flags.get(key, default)


async def is_enabled_for_user(db, key: str, user_id: Optional[str]) -> bool:
    """A flag is 'on for user' when the global flag is True OR the user_id
    is in the canary list. `COMMUNICATIONS_V2_ENABLED` is a master gate:
    if it's false and the user isn't a canary, everything is off."""
    flags = await get_all_flags(db)
    canary = set(flags.get("COMMUNICATIONS_V2_CANARY_USER_IDS") or [])
    master = bool(flags.get("COMMUNICATIONS_V2_ENABLED"))
    child = bool(flags.get(key))
    if user_id and user_id in canary:
        return child or master
    return master and child


async def set_flag(db, key: str, value: Any, actor_user_id: Optional[str] = None) -> None:
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    await db.comm_flags.update_one(
        {"key": key},
        {"$set": {"key": key, "value": value, "updated_at": now, "updated_by": actor_user_id},
         "$setOnInsert": {"created_at": now}},
        upsert=True,
    )


VALID_KEYS = set(_ENV_DEFAULTS.keys())
