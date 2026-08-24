"""Admin-only endpoint: merge duplicate user accounts sharing an email.

The bug this solves
-------------------
OAuth re-link, manual seed scripts, and pre-normalised email casing
created multiple `users` documents in MongoDB that share the same
email (e.g. "Dr. Sagar Joshi" with dot vs "Dr Sagar Joshi" without).
Each has a distinct user_id, so:

  • push_tokens stamped to one user_id don't show up for the other
  • bookings / prescriptions / notes pile up under whichever id the
    OAuth flow minted on that session
  • team rosters double-count the same human
  • /push/test says "no tokens registered for this account" even
    though the user has 15 tokens under their OTHER account

This endpoint performs a safe one-shot merge:

  1. Pick the CANONICAL user_id = the oldest created_at row (that row
     typically has all the manually-assigned role/tenant links).
  2. For every related collection (push_tokens, bookings,
     prescriptions, notes, notifications, audit_log, tenant_members,
     ipss_history, user_roles, etc.) — re-stamp every row whose
     user_id belongs to ANY sibling onto the canonical user_id.
  3. Delete the sibling user docs.

Idempotent: running it twice with the same email is a no-op on
the second call. Returns a detailed report of everything merged.

Callable ONLY by super_owner or primary_owner. The caller MUST pass
their admin password (defence-in-depth against accidental /merge on
a logged-in session).
"""
from __future__ import annotations

from typing import List, Dict, Any
from datetime import datetime, timezone
import re as _re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr

from server import db
from auth_deps import require_user

router = APIRouter()


class MergeRequest(BaseModel):
    """Input for POST /api/admin/users/merge-by-email."""
    email: EmailStr


# Every collection where a `user_id` field is written. When you add a
# new collection that references users, add it here so merges stay
# complete.
_USER_ID_COLLECTIONS: List[str] = [
    "push_tokens",
    "bookings",
    "prescriptions",
    "notes",
    "notifications",
    "audit_log",
    "tenant_members",
    "ipss_history",
    "user_roles",
    "drafts",
    "consultation_notes",
    "broadcasts",
    "broadcast_recipients",
]


async def _canonical_user_for_email(email: str) -> Dict[str, Any]:
    """Pick the winner: oldest-created user doc for a case-insensitive email."""
    q = {"email": {"$regex": f"^{_re.escape(email)}$", "$options": "i"}}
    users = await db.users.find(q).sort("created_at", 1).to_list(length=50)
    if not users:
        raise HTTPException(status_code=404, detail="No users found with that email")
    return users[0]


@router.post("/api/admin/users/merge-by-email")
async def merge_users_by_email(
    body: MergeRequest,
    actor=Depends(require_user),
):
    # ACL — only super_owner / primary_owner. Also returned email in
    # lower-case in the response for client confirmation.
    actor_role = (actor.get("role") or "").lower()
    if actor_role not in ("super_owner", "primary_owner"):
        raise HTTPException(
            status_code=403,
            detail="Only super_owner or primary_owner may merge accounts",
        )

    email = body.email.strip().lower()
    canonical = await _canonical_user_for_email(email)
    canonical_uid = canonical["user_id"]

    # Collect siblings (everyone sharing the email except the winner)
    q = {"email": {"$regex": f"^{_re.escape(email)}$", "$options": "i"}}
    all_users = await db.users.find(q).to_list(length=50)
    sibling_ids = [u["user_id"] for u in all_users if u["user_id"] != canonical_uid]

    report: Dict[str, Any] = {
        "email": email,
        "canonical_user_id": canonical_uid,
        "canonical_created_at": str(canonical.get("created_at") or ""),
        "sibling_user_ids": sibling_ids,
        "sibling_count": len(sibling_ids),
        "collections_updated": {},
        "users_deleted": 0,
    }

    if not sibling_ids:
        report["noop"] = True
        report["message"] = "No duplicate accounts found — already canonical."
        return report

    now = datetime.now(timezone.utc)

    # Re-stamp every tracked collection
    for coll in _USER_ID_COLLECTIONS:
        try:
            r = await db[coll].update_many(
                {"user_id": {"$in": sibling_ids}},
                {"$set": {"user_id": canonical_uid, "merged_at": now}},
            )
            report["collections_updated"][coll] = int(r.modified_count or 0)
        except Exception as e:
            report["collections_updated"][coll] = f"error: {e}"

    # Also re-stamp email (lowercase) on the canonical doc to prevent
    # future case-sensitivity collisions.
    try:
        await db.users.update_one(
            {"user_id": canonical_uid},
            {"$set": {"email": email, "updated_at": now}},
        )
    except Exception:
        pass

    # Delete the sibling user docs
    try:
        delres = await db.users.delete_many({"user_id": {"$in": sibling_ids}})
        report["users_deleted"] = int(delres.deleted_count or 0)
    except Exception as e:
        report["users_deleted"] = f"error: {e}"

    # Audit trail so super-admin can see who did it
    try:
        await db.audit_log.insert_one({
            "type": "users.merge_by_email",
            "email": email,
            "canonical_user_id": canonical_uid,
            "sibling_user_ids": sibling_ids,
            "actor_user_id": actor["user_id"],
            "actor_email": actor.get("email"),
            "created_at": now,
            "report": report,
        })
    except Exception:
        pass

    report["ok"] = True
    return report


@router.get("/api/admin/users/find-duplicates")
async def find_duplicate_emails(actor=Depends(require_user)):
    """List all emails with more than one users doc.

    Read-only diagnostic — used by the admin UI to decide which
    emails need merging, without exposing the full user list.
    """
    actor_role = (actor.get("role") or "").lower()
    if actor_role not in ("super_owner", "primary_owner"):
        raise HTTPException(status_code=403, detail="Admin-only")

    pipeline = [
        {"$match": {"email": {"$exists": True, "$ne": None, "$ne": ""}}},
        {"$group": {
            "_id": {"$toLower": "$email"},
            "count": {"$sum": 1},
            "user_ids": {"$push": "$user_id"},
            "names": {"$push": "$name"},
        }},
        {"$match": {"count": {"$gt": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 100},
    ]
    rows = await db.users.aggregate(pipeline).to_list(length=100)
    return {
        "count": len(rows),
        "duplicates": [
            {
                "email": r["_id"],
                "count": r["count"],
                "user_ids": r["user_ids"],
                "names": r["names"],
            }
            for r in rows
        ],
    }


async def _activity_counts(user_id: str) -> Dict[str, int]:
    """Count the activity rows tied to a (possibly quarantined) user so
    the admin can see how much data a merge would carry over."""
    out: Dict[str, int] = {}
    for coll in ("bookings", "prescriptions", "push_tokens", "notes"):
        try:
            out[coll] = int(await db[coll].count_documents({"user_id": user_id}))
        except Exception:
            out[coll] = 0
    return out


@router.get("/api/admin/users/quarantined-duplicates")
async def list_quarantined_duplicates(actor=Depends(require_user)):
    """List users whose `email` / `phone` was quarantined at startup.

    When two `users` rows shared the same email/phone, the boot-time
    dedup renamed the field to `email_dup_quarantine` /
    `phone_dup_quarantine` on the NEWER row(s) so the unique index could
    build without deleting anything. Those rows are invisible in normal
    directory views — this endpoint surfaces them next to the canonical
    (live) account that currently holds the value, so an admin can merge
    or restore them.
    """
    actor_role = (actor.get("role") or "").lower()
    if actor_role not in ("super_owner", "primary_owner"):
        raise HTTPException(status_code=403, detail="Admin-only")

    q = {"$or": [
        {"email_dup_quarantine": {"$exists": True}},
        {"phone_dup_quarantine": {"$exists": True}},
    ]}
    out: List[Dict[str, Any]] = []
    async for u in db.users.find(q):
        q_email = (u.get("email_dup_quarantine") or "").strip()
        q_phone = (u.get("phone_dup_quarantine") or "").strip()
        field = "email" if q_email else "phone"
        value = q_email or q_phone
        # Find the canonical live user currently holding this value.
        canonical = None
        if q_email:
            canonical = await db.users.find_one(
                {"email": {"$regex": f"^{_re.escape(q_email)}$", "$options": "i"}},
                {"_id": 0, "user_id": 1, "name": 1, "email": 1, "role": 1, "created_at": 1},
            )
        elif q_phone:
            canonical = await db.users.find_one(
                {"phone": q_phone},
                {"_id": 0, "user_id": 1, "name": 1, "phone": 1, "role": 1, "created_at": 1},
            )
        out.append({
            "quarantined_user_id": u.get("user_id"),
            "quarantined_name": u.get("name"),
            "quarantined_role": u.get("role"),
            "quarantined_created_at": str(u.get("created_at") or ""),
            "field": field,
            "value": value,
            "activity": await _activity_counts(u.get("user_id")),
            "canonical": canonical,
            # If no canonical row holds the value anymore, the value can
            # be safely RESTORED onto the quarantined row.
            "canonical_exists": bool(canonical),
        })
    return {"count": len(out), "quarantined": out}


class ResolveQuarantineRequest(BaseModel):
    """Input for POST /api/admin/users/resolve-quarantine."""
    quarantined_user_id: str
    action: str  # "merge" | "restore"


@router.post("/api/admin/users/resolve-quarantine")
async def resolve_quarantine(body: ResolveQuarantineRequest, actor=Depends(require_user)):
    """Resolve one quarantined duplicate.

      • action="merge"   → re-stamp all activity from the quarantined
        row onto the canonical (live) user holding the value, then
        delete the quarantined user document.
      • action="restore" → give the quarantined value back to the row
        (renames `*_dup_quarantine` → the real field). Allowed ONLY
        when no live user currently holds that value.
    """
    actor_role = (actor.get("role") or "").lower()
    if actor_role not in ("super_owner", "primary_owner"):
        raise HTTPException(status_code=403, detail="Admin-only")

    action = (body.action or "").strip().lower()
    if action not in ("merge", "restore"):
        raise HTTPException(status_code=400, detail="action must be 'merge' or 'restore'")

    quar = await db.users.find_one({"user_id": body.quarantined_user_id})
    if not quar:
        raise HTTPException(status_code=404, detail="Quarantined user not found")

    q_email = (quar.get("email_dup_quarantine") or "").strip()
    q_phone = (quar.get("phone_dup_quarantine") or "").strip()
    if not q_email and not q_phone:
        raise HTTPException(status_code=400, detail="This user has no quarantined email/phone")

    field = "email" if q_email else "phone"
    value = q_email or q_phone
    now = datetime.now(timezone.utc)

    # Locate the canonical live holder of the value.
    if q_email:
        canonical = await db.users.find_one(
            {"email": {"$regex": f"^{_re.escape(q_email)}$", "$options": "i"}}
        )
    else:
        canonical = await db.users.find_one({"phone": q_phone})

    report: Dict[str, Any] = {
        "action": action,
        "field": field,
        "value": value,
        "quarantined_user_id": body.quarantined_user_id,
    }

    if action == "restore":
        if canonical:
            raise HTTPException(
                status_code=409,
                detail="A live account already holds this value — merge instead of restore.",
            )
        # Rename the quarantine field back to the real field.
        set_field = value.lower() if field == "email" else value
        await db.users.update_one(
            {"user_id": body.quarantined_user_id},
            {"$set": {field: set_field, "updated_at": now},
             "$unset": {f"{field}_dup_quarantine": ""}},
        )
        report["ok"] = True
        report["restored"] = True
    else:  # merge
        if not canonical:
            raise HTTPException(
                status_code=409,
                detail="No live account holds this value — restore instead of merge.",
            )
        canonical_uid = canonical["user_id"]
        if canonical_uid == body.quarantined_user_id:
            raise HTTPException(status_code=400, detail="Cannot merge a row into itself")
        report["canonical_user_id"] = canonical_uid
        report["collections_updated"] = {}
        for coll in _USER_ID_COLLECTIONS:
            try:
                r = await db[coll].update_many(
                    {"user_id": body.quarantined_user_id},
                    {"$set": {"user_id": canonical_uid, "merged_at": now}},
                )
                report["collections_updated"][coll] = int(r.modified_count or 0)
            except Exception as e:
                report["collections_updated"][coll] = f"error: {e}"
        # Remove the quarantined stub now that its activity is re-homed.
        try:
            await db.users.delete_one({"user_id": body.quarantined_user_id})
            report["user_deleted"] = True
        except Exception as e:
            report["user_deleted"] = f"error: {e}"
        report["ok"] = True

    # Audit trail.
    try:
        await db.audit_log.insert_one({
            "type": "users.resolve_quarantine",
            "actor_user_id": actor["user_id"],
            "actor_email": actor.get("email"),
            "created_at": now,
            "report": report,
        })
    except Exception:
        pass

    return report
