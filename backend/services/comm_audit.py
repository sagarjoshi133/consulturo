"""Communications V2 append-only audit log.

Every state change in the Comm V2 surface (broadcast approve/reject,
conversation assign/escalate/resolve, outbox admin actions, flag
overrides, dead-letter retries, home-notice CRUD) writes a row here.

Never used as an authorization gate — this is *observability only*,
so failures MUST NOT bubble up to the caller. All writes are wrapped.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional


async def log(
    db,
    *,
    action: str,
    actor_user_id: Optional[str],
    actor_role: Optional[str] = None,
    target_type: Optional[str] = None,
    target_id: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    try:
        await db.comm_audit_log.insert_one({
            "id": str(uuid.uuid4()),
            "action": action,
            "actor_user_id": actor_user_id,
            "actor_role": actor_role,
            "target_type": target_type,
            "target_id": target_id,
            "metadata": metadata or {},
            "created_at": datetime.now(timezone.utc),
        })
    except Exception:
        # Never crash a business operation because the audit write failed.
        pass
