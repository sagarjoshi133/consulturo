"""Comm V2 Broadcast Studio.

Full lifecycle per spec:

    draft
      → pending_approval  (author submits)
      → approved          (owner approves — recipients FROZEN here)
      → scheduled         (owner schedules — dispatch event enqueued)
      → dispatching       (worker leases the dispatch event)
      → completed | partially_failed
      → rejected          (from pending_approval)
      → cancelled         (from approved / scheduled — never from dispatching)

Rules (all enforced server-side):
    - Staff may create/edit/submit drafts.
    - Only owner-tier (super_owner / primary_owner / owner / partner) may
      approve, reject, schedule, cancel, retry-failed.
    - Audience is FROZEN into comm_broadcast_recipients at approve time.
      Dispatch NEVER re-queries the audience.
    - Consent/preference exclusion is computed at freeze time and stored
      on the recipient row (excluded_reason).
    - Retry-failed only retries recipients that PROVIDER-REJECTED, never
      recipients that were excluded or already accepted.
    - Duplicate prevention: unique(broadcast_id, user_id) on recipients.
    - Analytics reports each counter INDEPENDENTLY — never conflates
      "provider accepted" with "patient reached" or "read".
"""
from __future__ import annotations

import base64
import json
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

# ── Lifecycle constants ────────────────────────────────────────

BROADCAST_STATES = {
    "draft", "pending_approval", "approved", "scheduled",
    "dispatching", "completed", "partially_failed",
    "rejected", "cancelled",
}

_ALLOWED_TRANSITIONS = {
    "draft":            {"pending_approval", "cancelled"},
    "pending_approval": {"approved", "rejected", "draft", "cancelled"},
    "approved":         {"scheduled", "dispatching", "cancelled"},
    "scheduled":        {"dispatching", "cancelled"},
    "dispatching":      {"completed", "partially_failed"},
    "completed":        set(),   # terminal
    "partially_failed": set(),   # terminal, but retry-failed operates on recipients
    "rejected":         {"draft"},
    "cancelled":        set(),
}

AUDIENCE_MODES = {"patients", "staff", "both", "selected_patients",
                    "patients_with_future_appointments"}

CATEGORIES = {"appointments", "announcements", "reminders", "system", "marketing"}

OWNER_TIER = {"super_owner", "primary_owner", "owner", "partner"}
STAFF_TIER = {"super_owner", "primary_owner", "owner", "partner",
               "doctor", "assistant", "reception", "nursing"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _is_owner(user: Dict[str, Any]) -> bool:
    return (user or {}).get("role") in OWNER_TIER


def _is_staff(user: Dict[str, Any]) -> bool:
    return (user or {}).get("role") in STAFF_TIER


# ── Cursor pagination (mirrors comm_inbox / comm_messaging) ────

def _encode_cursor(k: datetime, iid: str) -> str:
    payload = json.dumps({"k": k.isoformat(), "i": iid})
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


# ── Audience resolution ────────────────────────────────────────

async def _resolve_audience(
    db,
    *,
    audience_mode: str,
    selected_patient_user_ids: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """Return the raw user list matching the audience mode, BEFORE
    consent/preference exclusion. Each entry: {user_id, role, has_active_installation}.
    """
    q: Dict[str, Any] = {}
    if audience_mode == "patients":
        q["role"] = "patient"
    elif audience_mode == "staff":
        q["role"] = {"$in": list(STAFF_TIER)}
    elif audience_mode == "both":
        q["role"] = {"$in": ["patient"] + list(STAFF_TIER)}
    elif audience_mode == "selected_patients":
        if not selected_patient_user_ids:
            return []
        q = {"role": "patient", "user_id": {"$in": list(selected_patient_user_ids)}}
    elif audience_mode == "patients_with_future_appointments":
        now = _now()
        try:
            uids: List[str] = []
            async for b in db.bookings.find(
                {"start_at": {"$gt": now}, "status": {"$nin": ["cancelled", "rejected"]}},
                {"_id": 0, "user_id": 1, "patient_user_id": 1, "patient_id": 1}
            ).sort("start_at", 1):
                uid = b.get("patient_user_id") or b.get("user_id") or b.get("patient_id")
                if uid:
                    uids.append(uid)
            uids = list(set(uids))
            if not uids:
                return []
            q = {"role": "patient", "user_id": {"$in": uids}}
        except Exception:
            return []
    else:
        return []

    # Fetch users
    users: List[Dict[str, Any]] = []
    async for u in db.users.find(q, {"_id": 0, "user_id": 1, "role": 1,
                                       "email": 1, "name": 1, "phone": 1,
                                       "prefs_broadcast_opt_out": 1}):
        if u.get("user_id"):
            users.append(u)

    # Efficient bulk lookup of "has active installation"
    if users:
        uids = [u["user_id"] for u in users]
        active: set = set()
        async for row in db.comm_installations.find(
            {"user_id": {"$in": uids}, "status": "active"},
            {"_id": 0, "user_id": 1},
        ):
            active.add(row["user_id"])
        for u in users:
            u["has_active_installation"] = u["user_id"] in active
    return users


def _exclusion_reason(user: Dict[str, Any]) -> Optional[str]:
    """Consent/preference exclusion policy. Returns a reason string
    (recorded on the recipient row) or None if included."""
    if user.get("prefs_broadcast_opt_out"):
        return "consent_opt_out"
    return None


# ── Broadcast lifecycle ────────────────────────────────────────

async def create_draft(
    db,
    *,
    actor: Dict[str, Any],
    title: str,
    body: str,
    category: str,
    audience_mode: str,
    selected_patient_user_ids: Optional[List[str]] = None,
    scheduled_at: Optional[datetime] = None,
    action_type: str = "open_broadcast",
) -> Dict[str, Any]:
    if not _is_staff(actor):
        raise PermissionError("staff_only")
    title = (title or "").strip()
    body = (body or "").strip()
    if not title or len(title) > 200:
        raise ValueError("bad_title")
    if not body or len(body) > 4000:
        raise ValueError("bad_body")
    if category not in CATEGORIES:
        category = "announcements"
    if audience_mode not in AUDIENCE_MODES:
        raise ValueError("bad_audience_mode")
    if audience_mode == "selected_patients" and not selected_patient_user_ids:
        raise ValueError("selected_patients_required")

    now = _now()
    doc = {
        "id": str(uuid.uuid4()),
        "state": "draft",
        "title": title,
        "body": body,
        "category": category,
        "audience_mode": audience_mode,
        "selected_patient_user_ids": list(selected_patient_user_ids or []),
        "scheduled_at": scheduled_at,
        "action_type": action_type if action_type in
            {"open_broadcast", "open_home", "open_booking", "open_notice", "none"} else "open_broadcast",
        "created_by_user_id": actor.get("user_id") or actor.get("id"),
        "created_by_role": actor.get("role"),
        "approved_by_user_id": None,
        "approved_at": None,
        "rejected_by_user_id": None,
        "rejected_at": None,
        "rejection_reason": None,
        "cancelled_by_user_id": None,
        "cancelled_at": None,
        "dispatch_started_at": None,
        "dispatch_completed_at": None,
        "frozen_at": None,
        "recipient_count_frozen": 0,
        "created_at": now,
        "updated_at": now,
        "schema_version": 1,
    }
    await db.comm_broadcasts.insert_one(doc)
    doc.pop("_id", None)
    return doc


async def update_draft(
    db,
    *,
    actor: Dict[str, Any],
    broadcast_id: str,
    fields: Dict[str, Any],
) -> Dict[str, Any]:
    if not _is_staff(actor):
        raise PermissionError("staff_only")
    b = await get_broadcast(db, broadcast_id)
    if not b:
        raise ValueError("broadcast_not_found")
    if b["state"] not in ("draft", "rejected"):
        raise ValueError(f"cannot_edit_state:{b['state']}")
    allowed = {"title", "body", "category", "audience_mode",
                "selected_patient_user_ids", "scheduled_at", "action_type"}
    update = {k: v for k, v in fields.items() if k in allowed}
    if "audience_mode" in update and update["audience_mode"] not in AUDIENCE_MODES:
        raise ValueError("bad_audience_mode")
    if "category" in update and update["category"] not in CATEGORIES:
        update["category"] = "announcements"
    update["updated_at"] = _now()
    # If the row was previously rejected, re-open as draft.
    if b["state"] == "rejected":
        update["state"] = "draft"
    await db.comm_broadcasts.update_one({"id": broadcast_id}, {"$set": update})
    return await get_broadcast(db, broadcast_id)


async def submit_for_approval(
    db, *, actor: Dict[str, Any], broadcast_id: str,
) -> Dict[str, Any]:
    if not _is_staff(actor):
        raise PermissionError("staff_only")
    return await _transition(db, broadcast_id=broadcast_id,
                                new_state="pending_approval", actor=actor)


async def preview_broadcast(
    db, *, actor: Dict[str, Any], broadcast_id: str,
) -> Dict[str, Any]:
    """Return the message + audience preview WITHOUT freezing recipients."""
    if not _is_staff(actor):
        raise PermissionError("staff_only")
    b = await get_broadcast(db, broadcast_id)
    if not b:
        raise ValueError("broadcast_not_found")
    users = await _resolve_audience(
        db,
        audience_mode=b["audience_mode"],
        selected_patient_user_ids=b.get("selected_patient_user_ids") or [],
    )
    included: List[Dict[str, Any]] = []
    excluded: List[Dict[str, Any]] = []
    push_eligible = 0
    for u in users:
        reason = _exclusion_reason(u)
        if reason:
            excluded.append({"user_id": u["user_id"], "reason": reason})
        else:
            included.append({"user_id": u["user_id"], "role": u.get("role"),
                              "has_active_installation": u.get("has_active_installation")})
            if u.get("has_active_installation"):
                push_eligible += 1
    return {
        "broadcast": b,
        "audience_summary": {
            "intended_total": len(users),
            "included": len(included),
            "excluded": len(excluded),
            "push_eligible": push_eligible,
        },
        "sample_included_user_ids": [x["user_id"] for x in included[:10]],
        "excluded_by_reason": _bucket_by_reason(excluded),
    }


def _bucket_by_reason(excluded: List[Dict[str, Any]]) -> Dict[str, int]:
    out: Dict[str, int] = {}
    for x in excluded:
        r = x["reason"]
        out[r] = out.get(r, 0) + 1
    return out


async def approve_broadcast(
    db, *, actor: Dict[str, Any], broadcast_id: str,
) -> Dict[str, Any]:
    if not _is_owner(actor):
        raise PermissionError("owner_only")
    b = await get_broadcast(db, broadcast_id)
    if not b:
        raise ValueError("broadcast_not_found")
    if b["state"] != "pending_approval":
        raise ValueError(f"cannot_approve_state:{b['state']}")

    # FREEZE the audience — this is the point-of-no-return for recipient
    # composition. Dispatch will NEVER re-query the audience.
    users = await _resolve_audience(
        db,
        audience_mode=b["audience_mode"],
        selected_patient_user_ids=b.get("selected_patient_user_ids") or [],
    )
    now = _now()
    frozen_rows = []
    for u in users:
        reason = _exclusion_reason(u)
        row = {
            "id": str(uuid.uuid4()),
            "broadcast_id": broadcast_id,
            "user_id": u["user_id"],
            "role": u.get("role"),
            "has_active_installation_at_freeze": bool(u.get("has_active_installation")),
            "excluded_reason": reason,
            "delivery_status": "excluded" if reason else "pending",
            "inbox_item_id": None,
            "push_event_id": None,
            "provider_accepted_at": None,
            "provider_error_code": None,
            "app_opened_at": None,
            "read_at": None,
            "created_at": now,
        }
        frozen_rows.append(row)
    # Bulk insert, but per-row for the unique(broadcast_id,user_id) index
    # to no-op duplicates cleanly.
    inserted = 0
    for row in frozen_rows:
        try:
            await db.comm_broadcast_recipients.insert_one(row)
            inserted += 1
        except Exception:
            pass

    await db.comm_broadcasts.update_one(
        {"id": broadcast_id},
        {"$set": {"state": "approved",
                   "approved_by_user_id": actor.get("user_id") or actor.get("id"),
                   "approved_at": now,
                   "frozen_at": now,
                   "recipient_count_frozen": inserted,
                   "updated_at": now}},
    )
    try:
        from services import comm_audit
        await comm_audit.log(db, action="broadcast.approve",
            actor_user_id=actor.get("user_id") or actor.get("id"),
            actor_role=actor.get("role"),
            target_type="broadcast", target_id=broadcast_id,
            metadata={"recipient_count_frozen": inserted})
    except Exception:
        pass
    return await get_broadcast(db, broadcast_id)


async def reject_broadcast(
    db, *, actor: Dict[str, Any], broadcast_id: str, reason: Optional[str] = None,
) -> Dict[str, Any]:
    if not _is_owner(actor):
        raise PermissionError("owner_only")
    b = await get_broadcast(db, broadcast_id)
    if not b:
        raise ValueError("broadcast_not_found")
    if b["state"] != "pending_approval":
        raise ValueError(f"cannot_reject_state:{b['state']}")
    now = _now()
    await db.comm_broadcasts.update_one(
        {"id": broadcast_id},
        {"$set": {"state": "rejected",
                   "rejected_by_user_id": actor.get("user_id") or actor.get("id"),
                   "rejected_at": now,
                   "rejection_reason": (reason or "")[:500],
                   "updated_at": now}},
    )
    return await get_broadcast(db, broadcast_id)


async def schedule_broadcast(
    db, *, actor: Dict[str, Any], broadcast_id: str,
    scheduled_at: datetime,
) -> Dict[str, Any]:
    """Enqueue the dispatch outbox event at scheduled_at."""
    if not _is_owner(actor):
        raise PermissionError("owner_only")
    b = await get_broadcast(db, broadcast_id)
    if not b:
        raise ValueError("broadcast_not_found")
    if b["state"] not in ("approved", "scheduled"):
        raise ValueError(f"cannot_schedule_state:{b['state']}")

    now = _now()
    if scheduled_at.tzinfo is None:
        scheduled_at = scheduled_at.replace(tzinfo=timezone.utc)
    if scheduled_at < now:
        # "Send now" — clamp to now.
        scheduled_at = now

    await db.comm_broadcasts.update_one(
        {"id": broadcast_id},
        {"$set": {"state": "scheduled",
                   "scheduled_at": scheduled_at,
                   "updated_at": now}},
    )
    # Enqueue via outbox with a dedupe_key so re-scheduling never
    # double-dispatches.
    from services import comm_outbox
    await comm_outbox.enqueue(
        db,
        event_type="broadcast.dispatch",
        aggregate_type="broadcast",
        aggregate_id=broadcast_id,
        payload={"broadcast_id": broadcast_id},
        dedupe_key=f"bcast:dispatch:{broadcast_id}",
        available_at=scheduled_at,
        correlation_id=f"bcast:{broadcast_id}",
    )
    try:
        from services import comm_audit
        await comm_audit.log(db, action="broadcast.schedule",
            actor_user_id=actor.get("user_id") or actor.get("id"),
            actor_role=actor.get("role"),
            target_type="broadcast", target_id=broadcast_id,
            metadata={"scheduled_at": scheduled_at.isoformat()})
    except Exception:
        pass
    return await get_broadcast(db, broadcast_id)


async def cancel_broadcast(
    db, *, actor: Dict[str, Any], broadcast_id: str,
) -> Dict[str, Any]:
    if not _is_owner(actor):
        raise PermissionError("owner_only")
    b = await get_broadcast(db, broadcast_id)
    if not b:
        raise ValueError("broadcast_not_found")
    if b["state"] in ("dispatching", "completed", "partially_failed", "cancelled", "rejected"):
        raise ValueError(f"cannot_cancel_state:{b['state']}")
    now = _now()
    await db.comm_broadcasts.update_one(
        {"id": broadcast_id},
        {"$set": {"state": "cancelled",
                   "cancelled_by_user_id": actor.get("user_id") or actor.get("id"),
                   "cancelled_at": now,
                   "updated_at": now}},
    )
    # Remove any pending dispatch outbox row so it never fires.
    try:
        await db.comm_outbox.update_one(
            {"dedupe_key": f"bcast:dispatch:{broadcast_id}",
             "status": {"$in": ["pending", "retry_wait"]}},
            {"$set": {"status": "completed",
                       "completed_at": now,
                       "last_error": "cancelled_by_owner"}},
        )
    except Exception:
        pass
    return await get_broadcast(db, broadcast_id)


async def retry_failed(
    db, *, actor: Dict[str, Any], broadcast_id: str,
) -> Dict[str, Any]:
    """Requeue ONLY recipients whose delivery_status ∈ {provider_error,
    push_enqueue_error}. Excluded recipients are never retried; already-
    accepted recipients are never re-sent."""
    if not _is_owner(actor):
        raise PermissionError("owner_only")
    b = await get_broadcast(db, broadcast_id)
    if not b:
        raise ValueError("broadcast_not_found")

    from services import comm_outbox, comm_inbox
    now = _now()
    requeued = 0
    async for r in db.comm_broadcast_recipients.find(
        {"broadcast_id": broadcast_id,
         "delivery_status": {"$in": ["provider_error", "push_enqueue_error"]}},
        {"_id": 0, "id": 1, "user_id": 1, "inbox_item_id": 1},
    ):
        # Reset row to pending, then enqueue a per-recipient push event
        # (idempotent via dedupe_key).
        await db.comm_broadcast_recipients.update_one(
            {"id": r["id"]},
            {"$set": {"delivery_status": "pending",
                       "provider_error_code": None,
                       "provider_accepted_at": None}},
        )
        try:
            await comm_outbox.enqueue(
                db, event_type="push.send",
                aggregate_type="broadcast", aggregate_id=broadcast_id,
                payload={
                    "user_id": r["user_id"],
                    "category": b.get("category") or "announcements",
                    "title": "ConsultUro announcement",
                    "body": "You have a new announcement. Open the app to view it.",
                    "data": {"type": "broadcast", "broadcast_id": broadcast_id,
                              "inbox_action": "open_broadcast",
                              "inbox_item_id": r.get("inbox_item_id") or ""},
                },
                dedupe_key=f"bcast:{broadcast_id}:push:{r['user_id']}:retry",
                correlation_id=f"bcast:{broadcast_id}",
            )
            requeued += 1
        except Exception:
            pass
    return {"requeued": requeued}


# ── Dispatch handler (invoked by outbox worker) ────────────────

async def _handle_dispatch(row: Dict[str, Any]) -> Dict[str, Any]:
    """Outbox handler for 'broadcast.dispatch'.

    Runs once per broadcast. Sets state to dispatching, iterates
    frozen recipients, creates inbox items + enqueues per-recipient
    push.send events. Final state = completed (all accepted) or
    partially_failed (any provider_error remaining after this pass).
    """
    from server import db as _db
    from services import comm_inbox, comm_outbox

    broadcast_id = (row.get("payload") or {}).get("broadcast_id")
    if not broadcast_id:
        return {"ok": True, "detail": "no_broadcast_id"}
    b = await get_broadcast(_db, broadcast_id)
    if not b:
        return {"ok": True, "detail": "broadcast_missing"}
    if b["state"] in ("cancelled", "completed", "partially_failed", "rejected"):
        return {"ok": True, "detail": f"skipped:{b['state']}"}

    now = _now()
    await _db.comm_broadcasts.update_one(
        {"id": broadcast_id},
        {"$set": {"state": "dispatching",
                   "dispatch_started_at": now,
                   "updated_at": now}},
    )

    fanout = 0
    enqueue_errors = 0
    async for r in _db.comm_broadcast_recipients.find(
        {"broadcast_id": broadcast_id, "delivery_status": "pending"},
        {"_id": 0},
    ):
        # 1. Inbox item — item_type=v2_broadcast, source_id=broadcast_id,
        #    stable across retries via unique(user, item_type, source_id).
        inbox = await comm_inbox.create_inbox_item(
            _db,
            user_id=r["user_id"],
            category=b.get("category") or "announcements",
            title=b.get("title") or "ConsultUro announcement",
            body=b.get("body") or "",
            item_type="v2_broadcast",
            source_id=broadcast_id,
            action_type=b.get("action_type") or "open_broadcast",
            action_target=broadcast_id,
            metadata={"broadcast_id": broadcast_id},
            priority="normal",
        )
        inbox_id = (inbox or {}).get("id")
        await _db.comm_broadcast_recipients.update_one(
            {"id": r["id"]},
            {"$set": {"inbox_item_id": inbox_id,
                       "delivery_status": "inbox_created"}},
        )

        # 2. Push (only if the recipient has an active installation).
        #    If they don't, we STILL count them as delivered-to-inbox —
        #    the spec explicitly says "In-app notification record must
        #    exist even when push delivery fails".
        if not r.get("has_active_installation_at_freeze"):
            await _db.comm_broadcast_recipients.update_one(
                {"id": r["id"]},
                {"$set": {"delivery_status": "no_push_eligible"}},
            )
            fanout += 1
            continue

        try:
            ev = await comm_outbox.enqueue(
                _db, event_type="push.send",
                aggregate_type="broadcast", aggregate_id=broadcast_id,
                payload={
                    "user_id": r["user_id"],
                    "category": b.get("category") or "announcements",
                    "title": "ConsultUro announcement",
                    "body": "You have a new announcement. Open the app to view it.",
                    "data": {"type": "broadcast", "broadcast_id": broadcast_id,
                              "inbox_action": "open_broadcast",
                              "inbox_item_id": inbox_id or ""},
                },
                dedupe_key=f"bcast:{broadcast_id}:push:{r['user_id']}",
                correlation_id=f"bcast:{broadcast_id}",
            )
            await _db.comm_broadcast_recipients.update_one(
                {"id": r["id"]},
                {"$set": {"push_event_id": ev.get("event_id"),
                           "delivery_status": "push_enqueued"}},
            )
            fanout += 1
        except Exception as e:
            enqueue_errors += 1
            await _db.comm_broadcast_recipients.update_one(
                {"id": r["id"]},
                {"$set": {"delivery_status": "push_enqueue_error",
                           "provider_error_code": str(e)[:200]}},
            )

    # Terminal state: partially_failed if any push_enqueue_error, else completed.
    remaining_errors = await _db.comm_broadcast_recipients.count_documents(
        {"broadcast_id": broadcast_id, "delivery_status": "push_enqueue_error"})
    final_state = "partially_failed" if remaining_errors else "completed"
    await _db.comm_broadcasts.update_one(
        {"id": broadcast_id},
        {"$set": {"state": final_state,
                   "dispatch_completed_at": _now(),
                   "updated_at": _now()}},
    )
    return {"ok": True, "detail": {"fanout": fanout,
                                      "enqueue_errors": enqueue_errors,
                                      "final_state": final_state}}


def register_handlers() -> None:
    """Register broadcast.dispatch on the durable outbox."""
    from services import comm_outbox
    comm_outbox.register_handler("broadcast.dispatch", _handle_dispatch)


# ── Analytics ──────────────────────────────────────────────────

async def broadcast_analytics(db, *, broadcast_id: str) -> Dict[str, Any]:
    """Honest per-broadcast analytics. Every counter is INDEPENDENT
    and named for exactly what it measures — never conflates
    "provider accepted" with "read"."""
    b = await get_broadcast(db, broadcast_id)
    if not b:
        raise ValueError("broadcast_not_found")

    # Aggregate recipient statuses.
    counters = {
        "intended_recipients": 0,
        "excluded_recipients": 0,
        "inbox_items_created": 0,
        "push_eligible": 0,
        "push_enqueued": 0,
        "provider_accepted": 0,
        "provider_failed": 0,
        "invalid_tokens": 0,
        "app_opened": 0,
        "broadcast_read": 0,
    }
    excluded_by_reason: Dict[str, int] = {}
    async for r in db.comm_broadcast_recipients.find(
        {"broadcast_id": broadcast_id}, {"_id": 0}
    ):
        counters["intended_recipients"] += 1
        st = r.get("delivery_status")
        excl = r.get("excluded_reason")
        if excl:
            counters["excluded_recipients"] += 1
            excluded_by_reason[excl] = excluded_by_reason.get(excl, 0) + 1
        if r.get("inbox_item_id"):
            counters["inbox_items_created"] += 1
        if r.get("has_active_installation_at_freeze"):
            counters["push_eligible"] += 1
        if st in ("push_enqueued", "provider_accepted", "provider_error"):
            counters["push_enqueued"] += 1
        if r.get("provider_accepted_at"):
            counters["provider_accepted"] += 1
        if r.get("provider_error_code"):
            counters["provider_failed"] += 1
            if str(r.get("provider_error_code")).upper() in (
                    "UNREGISTERED", "INVALID_ARGUMENT", "NOT_FOUND",
                    "SENDER_ID_MISMATCH"):
                counters["invalid_tokens"] += 1
        if r.get("app_opened_at"):
            counters["app_opened"] += 1
        if r.get("read_at"):
            counters["broadcast_read"] += 1

    return {
        "broadcast_id": broadcast_id,
        "state": b.get("state"),
        "counters": counters,
        "excluded_by_reason": excluded_by_reason,
        "note": ("provider_accepted means FCM accepted the message for delivery. "
                 "It does NOT mean the patient received or read it. "
                 "Use broadcast_read to count actual reads."),
    }


# ── Read-side helpers ──────────────────────────────────────────

async def get_broadcast(db, broadcast_id: str) -> Optional[Dict[str, Any]]:
    return await db.comm_broadcasts.find_one({"id": broadcast_id}, {"_id": 0})


async def list_broadcasts(
    db,
    *,
    actor: Dict[str, Any],
    limit: int = 20,
    cursor: Optional[str] = None,
    state: Optional[str] = None,
) -> Dict[str, Any]:
    if not _is_staff(actor):
        raise PermissionError("staff_only")
    limit = max(1, min(100, int(limit or 20)))
    q: Dict[str, Any] = {}
    if state and state in BROADCAST_STATES:
        q["state"] = state
    dec = _decode_cursor(cursor)
    if dec:
        ts, iid = dec
        q["$or"] = [
            {"created_at": {"$lt": ts}},
            {"created_at": ts, "id": {"$lt": iid}},
        ]
    rows: List[Dict[str, Any]] = []
    async for r in db.comm_broadcasts.find(q, {"_id": 0}).sort([
        ("created_at", -1), ("id", -1)
    ]).limit(limit + 1):
        rows.append(r)
    next_cursor = None
    if len(rows) > limit:
        last = rows[limit - 1]
        rows = rows[:limit]
        next_cursor = _encode_cursor(last["created_at"], last["id"])
    return {"items": rows, "next_cursor": next_cursor, "count": len(rows)}


async def _transition(db, *, broadcast_id: str, new_state: str,
                        actor: Dict[str, Any]) -> Dict[str, Any]:
    b = await get_broadcast(db, broadcast_id)
    if not b:
        raise ValueError("broadcast_not_found")
    from_state = b.get("state")
    if new_state not in _ALLOWED_TRANSITIONS.get(from_state, set()):
        raise ValueError(f"illegal_transition:{from_state}->{new_state}")
    await db.comm_broadcasts.update_one(
        {"id": broadcast_id},
        {"$set": {"state": new_state, "updated_at": _now()}},
    )
    return await get_broadcast(db, broadcast_id)
