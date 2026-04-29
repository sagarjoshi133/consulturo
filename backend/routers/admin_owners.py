"""ConsultUro — admin_owners router.

  · /api/admin/primary-owners
  · /api/admin/primary-owners/promote
  · /api/admin/primary-owners/{user_id}
  · /api/admin/primary-owners/{user_id}/suspend
  · /api/admin/primary-owners/{user_id}/blog-perm
  · /api/admin/primary-owners/{user_id}/dashboard-perm
  · /api/admin/primary-owner-analytics
  · /api/admin/partners
  · /api/admin/partners/promote
  · /api/admin/partners/{user_id}
  · /api/admin/partners/{user_id}/dashboard-perm

Extracted from server.py during Phase 3 modularization.
Behaviour preserved EXACTLY.
"""
from datetime import datetime, timezone
from typing import Any, Dict, List
from fastapi import APIRouter, Depends, HTTPException
from db import db
from auth_deps import require_owner, require_primary_owner_strict, require_super_owner
from models import BlogPermBody, DashboardPermBody, PromoteByEmailBody, SuspendBody
from server import OWNER_EMAIL, _promote_user_to_role

router = APIRouter()


@router.post("/api/admin/primary-owners/promote")
async def promote_primary_owner(body: PromoteByEmailBody, user=Depends(require_super_owner)):
    """Promote any email to primary_owner. Only the super_owner may
    invoke this — primary_owners managing other primary_owners is
    explicitly disallowed (the super_owner has ultimate authority)."""
    return await _promote_user_to_role(body.email, "primary_owner", actor=user)

@router.delete("/api/admin/primary-owners/{user_id}")
async def demote_primary_owner(user_id: str, user=Depends(require_super_owner)):
    """Demote a primary_owner back to a regular `doctor` role. Only the
    super_owner may invoke this. Cannot demote the configured
    OWNER_EMAIL — that account always remains a primary_owner."""
    target = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if (target.get("email") or "").lower() == OWNER_EMAIL:
        raise HTTPException(status_code=400, detail="Cannot demote the configured primary owner")
    if target.get("role") != "primary_owner":
        raise HTTPException(status_code=400, detail="User is not a primary owner")
    return await _promote_user_to_role(target["email"], "doctor", actor=user)

@router.get("/api/admin/primary-owners")
async def list_primary_owners(user=Depends(require_owner)):
    """List all primary_owners + super_owner. Visible to anyone in the
    owner tier. Includes `can_create_blog` + `dashboard_full_access`
    so the super-owner UI can render per-row toggles. Also includes
    `created_at` (ISO string — set on first promotion or earliest
    timestamp recoverable from the user doc) and `suspended` so the
    super-owner UI can render an "Active since X" tag and a
    Suspend/Resume button per row."""
    rows: List[Dict[str, Any]] = []
    seen_emails: set = set()
    async for u in db.users.find({"role": {"$in": ["primary_owner", "super_owner"]}}, {"_id": 0}):
        # Defensive dedupe — the unique email index should make this
        # impossible, but a legacy snapshot or a race during migration
        # could still surface duplicates. Render at most one card per
        # email (case-insensitive).
        em_key = (u.get("email") or "").lower().strip()
        if em_key and em_key in seen_emails:
            continue
        if em_key:
            seen_emails.add(em_key)
        dfa_raw = u.get("dashboard_full_access")
        dfa = (dfa_raw is not False) if u.get("role") in {"primary_owner", "super_owner"} else bool(dfa_raw)
        # `created_at` may be missing on rows that pre-date the field —
        # fall back to `promoted_at`, then to a stable string so the UI
        # can still render an Active-since label.
        created_at = u.get("created_at") or u.get("promoted_at")
        if isinstance(created_at, datetime):
            created_at = created_at.isoformat()
        rows.append({
            "user_id": u.get("user_id"),
            "email": u.get("email"),
            "name": u.get("name"),
            "role": u.get("role"),
            "picture": u.get("picture"),
            "can_create_blog": bool(u.get("can_create_blog")) or u.get("role") == "super_owner",
            "dashboard_full_access": dfa,
            "created_at": created_at,
            "suspended": bool(u.get("suspended")),
            "suspended_at": (u.get("suspended_at").isoformat() if isinstance(u.get("suspended_at"), datetime) else u.get("suspended_at")),
            "suspended_reason": u.get("suspended_reason"),
        })
    return {"items": rows}

@router.get("/api/admin/primary-owner-analytics")
async def super_owner_primary_owner_analytics(user=Depends(require_super_owner)):
    """Strictly super-owner-only. One row per primary_owner with
    aggregated usage stats sourced from users / bookings /
    prescriptions / surgeries / user_sessions collections."""
    from datetime import timedelta as _td
    now = datetime.now(timezone.utc)
    today_iso = now.strftime("%Y-%m-%d")
    week_start = (now - _td(days=now.weekday())).date().isoformat()
    month_start = now.replace(day=1).date().isoformat()
    ninety_ago = (now - _td(days=90)).date().isoformat()

    owners = await db.users.find(
        {"role": "primary_owner"}, {"_id": 0}
    ).to_list(length=200)

    rows = []
    for o in owners:
        oid = o.get("user_id") or ""
        oemail = (o.get("email") or "").lower()

        # Bookings: created_by matches owner OR clinic-wide
        # (we treat any booking as "their clinic" since this is single
        #  tenant today; multi-tenant work is on the backlog).
        # Use booking_date for today/week/month windows.
        b_total = await db.bookings.count_documents({})
        b_today = await db.bookings.count_documents({"booking_date": today_iso})
        b_week  = await db.bookings.count_documents({"booking_date": {"$gte": week_start}})
        b_month = await db.bookings.count_documents({"booking_date": {"$gte": month_start}})

        # Prescriptions written by this owner specifically.
        rx_total = await db.prescriptions.count_documents({"created_by": oid})

        # Surgeries logged by this owner.
        sx_total = await db.surgeries.count_documents({"created_by": oid})

        # Team size — staff users + pending invites (excluding super_owners
        # since they are cross-tenant platform admins, not team members).
        team_users = await db.users.count_documents({
            "role": {"$in": ["doctor", "partner", "assistant", "reception", "nursing"]}
        })
        team_invites = await db.team_invites.count_documents({})
        team_size = team_users + team_invites

        # Last-active: most recent user_session for this user_id.
        last_session = None
        try:
            sess = await db.user_sessions.find_one(
                {"user_id": oid}, sort=[("created_at", -1)], projection={"_id": 0, "created_at": 1}
            )
            if sess and sess.get("created_at"):
                last_session = sess["created_at"]
        except Exception:
            pass

        # Login frequency over the last 30 days (count of distinct
        # session days). Cheap & informative.
        try:
            since = now - _td(days=30)
            distinct_days = await db.user_sessions.distinct(
                "created_at_day",
                {"user_id": oid, "created_at": {"$gte": since}},
            )
            login_days_30 = len(distinct_days) if distinct_days is not None else 0
        except Exception:
            login_days_30 = 0

        # 90-day growth series — count bookings + Rx per day for chart.
        series = []
        try:
            pipeline_b = [
                {"$match": {"booking_date": {"$gte": ninety_ago}}},
                {"$group": {"_id": "$booking_date", "n": {"$sum": 1}}},
                {"$sort": {"_id": 1}},
            ]
            b_by_day = {row["_id"]: row["n"] async for row in db.bookings.aggregate(pipeline_b)}
            pipeline_rx = [
                {"$match": {"created_by": oid, "created_at": {"$gte": now - _td(days=90)}}},
                {"$group": {
                    "_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$created_at"}},
                    "n": {"$sum": 1},
                }},
                {"$sort": {"_id": 1}},
            ]
            rx_by_day = {row["_id"]: row["n"] async for row in db.prescriptions.aggregate(pipeline_rx)}
            # Build a continuous 90-day series.
            for i in range(90, -1, -1):
                d = (now - _td(days=i)).date().isoformat()
                series.append({
                    "date": d,
                    "bookings": int(b_by_day.get(d, 0) or 0),
                    "rx": int(rx_by_day.get(d, 0) or 0),
                })
        except Exception:
            series = []

        rows.append({
            "user_id": oid,
            "email": oemail,
            "name": o.get("name") or oemail,
            "language": o.get("language") or "en",
            "suspended": bool(o.get("suspended")),
            "created_at": o.get("created_at"),
            "last_active": last_session,
            "login_days_last_30": login_days_30,
            "bookings": {
                "today": b_today, "week": b_week, "month": b_month, "total": b_total,
            },
            "rx_total": rx_total,
            "surgeries_total": sx_total,
            "team_size": team_size,
            "subscription_tier": o.get("subscription_tier") or "free",  # future billing
            "growth_90d": series,
        })

    # Sort by last_active desc (most recently used owners first).
    rows.sort(key=lambda r: r.get("last_active") or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    return {"items": rows, "generated_at": now.isoformat()}

@router.patch("/api/admin/primary-owners/{user_id}/suspend")
async def set_primary_owner_suspended(
    user_id: str, body: SuspendBody, user=Depends(require_super_owner)
):
    """Super-owner-only. Temporarily suspend (or resume) a primary owner.
    A suspended user is blocked from logging in and from making any
    authenticated API call (auth middleware enforces). Useful when the
    super-owner needs to pause a clinic without deleting historical
    data."""
    target = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.get("role") not in ("primary_owner", "owner"):
        raise HTTPException(status_code=400, detail="Only primary owners can be suspended")
    update: Dict[str, Any] = {"suspended": bool(body.suspended)}
    if body.suspended:
        update["suspended_at"] = datetime.utcnow()
        update["suspended_by"] = user.get("user_id")
        update["suspended_reason"] = (body.reason or "").strip() or None
    else:
        update["suspended_at"] = None
        update["suspended_by"] = None
        update["suspended_reason"] = None
        # Drop any active sessions for this user so they're forced to
        # re-authenticate after we resume them. This is a low-cost
        # hygiene step — sessions for suspended-then-resumed accounts
        # may carry stale role flags.
    await db.users.update_one({"user_id": user_id}, {"$set": update})
    if body.suspended:
        # Hard-stop: invalidate every existing session token so the
        # user is logged out immediately on their next request.
        await db.user_sessions.delete_many({"user_id": user_id})
    return {"ok": True, "suspended": bool(body.suspended)}

@router.patch("/api/admin/primary-owners/{user_id}/blog-perm")
async def set_primary_owner_blog_perm(
    user_id: str, body: BlogPermBody, user=Depends(require_super_owner)
):
    """Super-owner-only. Grant / revoke blog editorial access for a
    specific primary_owner. Super_owner is always allowed regardless of
    this flag (immutable)."""
    target = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.get("role") != "primary_owner":
        raise HTTPException(status_code=400, detail="Target must be a primary_owner")
    val = bool(body.can_create_blog)
    await db.users.update_one({"user_id": user_id}, {"$set": {"can_create_blog": val}})
    # Persist on team_invites too so the flag survives sign-out / sign-in.
    email_l = (target.get("email") or "").lower()
    if email_l:
        # NOTE: upsert=False — we must NOT auto-create a stub team_invites
        # row that only carries the `can_create_blog` flag (no role, no
        # name). Such stubs surface later as "ghost" pending invites and
        # were the root cause of the duplicate Primary Owner perception
        # for sagar.joshi133@gmail.com. The flag is already persisted on
        # the live `users` row above; mirroring onto an existing invite
        # is best-effort only.
        await db.team_invites.update_one(
            {"email": email_l}, {"$set": {"can_create_blog": val}}, upsert=False
        )
    try:
        await db.audit_log.insert_one({
            "ts": datetime.now(timezone.utc),
            "kind": "blog_perm_change",
            "target_email": email_l,
            "target_user_id": user_id,
            "new_value": val,
            "actor_email": (user.get("email") or "").lower(),
        })
    except Exception:
        pass
    return {"ok": True, "user_id": user_id, "can_create_blog": val}

@router.patch("/api/admin/primary-owners/{user_id}/dashboard-perm")
async def set_primary_owner_dashboard_perm(
    user_id: str, body: DashboardPermBody, user=Depends(require_super_owner)
):
    """Super-owner-only. Grant / revoke full-dashboard access for a
    specific primary_owner. All owner-tier accounts start with full
    access by default — this flips the explicit override. Super_owner
    can never be limited (flag is forced True)."""
    target = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.get("role") != "primary_owner":
        raise HTTPException(status_code=400, detail="Target must be a primary_owner")
    val = bool(body.dashboard_full_access)
    await db.users.update_one(
        {"user_id": user_id}, {"$set": {"dashboard_full_access": val}}
    )
    email_l = (target.get("email") or "").lower()
    if email_l:
        # See blog-perm above — same rationale: never upsert a stub.
        await db.team_invites.update_one(
            {"email": email_l}, {"$set": {"dashboard_full_access": val}}, upsert=False
        )
    try:
        await db.audit_log.insert_one({
            "ts": datetime.now(timezone.utc),
            "kind": "dashboard_perm_change",
            "target_email": email_l,
            "target_user_id": user_id,
            "new_value": val,
            "actor_email": (user.get("email") or "").lower(),
        })
    except Exception:
        pass
    return {"ok": True, "user_id": user_id, "dashboard_full_access": val}

@router.patch("/api/admin/partners/{user_id}/dashboard-perm")
async def set_partner_dashboard_perm(
    user_id: str, body: DashboardPermBody, user=Depends(require_primary_owner_strict)
):
    """Primary-owner / super-owner. Grant / revoke full-dashboard access
    for a specific partner. Partners start with full access by default —
    this flips the explicit override. The Partner role is otherwise
    co-equal to Primary Owner clinically; this control lets a Primary
    Owner narrow their Partner's administrative reach (Backups, Team,
    Analytics, Blog, Broadcasts) without demoting the role itself."""
    target = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.get("role") != "partner":
        raise HTTPException(status_code=400, detail="Target must be a partner")
    val = bool(body.dashboard_full_access)
    await db.users.update_one(
        {"user_id": user_id}, {"$set": {"dashboard_full_access": val}}
    )
    email_l = (target.get("email") or "").lower()
    if email_l:
        # Mirror onto pending-invite row if any (no upsert — we never
        # want to spawn a stub team_invites doc here).
        await db.team_invites.update_one(
            {"email": email_l}, {"$set": {"dashboard_full_access": val}}, upsert=False
        )
    try:
        await db.audit_log.insert_one({
            "ts": datetime.now(timezone.utc),
            "kind": "partner_dashboard_perm_change",
            "target_email": email_l,
            "target_user_id": user_id,
            "new_value": val,
            "actor_email": (user.get("email") or "").lower(),
        })
    except Exception:
        pass
    return {"ok": True, "user_id": user_id, "dashboard_full_access": val}

@router.post("/api/admin/partners/promote")
async def promote_partner(body: PromoteByEmailBody, user=Depends(require_primary_owner_strict)):
    """Promote any email to partner. primary_owner or super_owner may
    invoke this — partners themselves cannot create partners."""
    return await _promote_user_to_role(body.email, "partner", actor=user)

@router.delete("/api/admin/partners/{user_id}")
async def demote_partner(user_id: str, user=Depends(require_primary_owner_strict)):
    """Demote a partner to a regular doctor role.
    Accepts user_id='pending:<email>' to revoke a partner who hasn't
    signed in yet (only the team_invite exists)."""
    if user_id.startswith("pending:"):
        email_l = user_id.split(":", 1)[1].strip().lower()
        res = await db.team_invites.delete_many({"email": email_l, "role": "partner"})
        return {"ok": True, "revoked_invites": res.deleted_count, "email": email_l}
    target = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.get("role") != "partner":
        raise HTTPException(status_code=400, detail="User is not a partner")
    return await _promote_user_to_role(target["email"], "doctor", actor=user)

@router.get("/api/admin/partners")
async def list_partners(user=Depends(require_owner)):
    """List all partners — visible to anyone in the owner tier.
    Includes both LIVE users with role='partner' AND pending team_invites
    (partners promoted via email but who haven't signed in yet). The
    pending row carries `signed_in:false` and `user_id:null`."""
    rows: List[Dict[str, Any]] = []
    seen_emails: set = set()
    async for u in db.users.find({"role": "partner"}, {"_id": 0}):
        em = (u.get("email") or "").lower()
        if em in seen_emails:
            continue
        seen_emails.add(em)
        # Default-True for owner-tier roles unless explicitly revoked,
        # mirrors the rule in /api/me/tier so the toggle UI stays in
        # sync with what the partner actually experiences.
        dfa_raw = u.get("dashboard_full_access")
        dfa = (dfa_raw is not False)
        rows.append({
            "user_id": u.get("user_id"),
            "email": em,
            "name": u.get("name"),
            "role": u.get("role"),
            "picture": u.get("picture"),
            "signed_in": True,
            "dashboard_full_access": dfa,
        })
    async for iv in db.team_invites.find({"role": "partner"}, {"_id": 0}):
        em = (iv.get("email") or "").lower()
        if em in seen_emails:
            continue
        seen_emails.add(em)
        rows.append({
            "user_id": None,
            "email": em,
            "name": iv.get("name"),
            "role": "partner",
            "picture": None,
            "signed_in": False,
            "dashboard_full_access": True,
        })
    return {"items": rows}
