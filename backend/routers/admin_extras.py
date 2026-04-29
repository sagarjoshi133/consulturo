"""ConsultUro — admin_extras router.

  · /api/admin/backup/status
  · /api/admin/demo/create
  · /api/admin/demo/{user_id}
  · /api/admin/demo
  · /api/admin/platform-stats
  · /api/admin/audit-log

Extracted from server.py during Phase 3 modularization.
Behaviour preserved EXACTLY.
"""
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
import uuid
import json
import asyncio
import os
from fastapi import APIRouter, Depends, HTTPException, Path
from db import db
from auth_deps import require_owner, require_super_owner
from models import CreateDemoBody
from server import _human_bytes, _seed_demo_patient_data

router = APIRouter()


@router.get("/api/admin/backup/status")
async def admin_backup_status(user=Depends(require_owner)):
    """Owner-only: surface the latest mongodump + off-host mirror status.

    Reads /app/backups/.mirror_status.json (written by mirror_backups.sh)
    and decorates it with details of the most recent local archive so the
    dashboard can show "last backup at X, mirrored to Y".
    """
    import os
    import json
    from pathlib import Path

    backup_dir = Path("/app/backups")
    archives = []
    try:
        for p in sorted(backup_dir.glob("consulturo-*.tar.gz"), reverse=True)[:5]:
            try:
                st = p.stat()
                archives.append({
                    "name": p.name,
                    "size_bytes": st.st_size,
                    "size_human": _human_bytes(st.st_size),
                    "modified": datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat(),
                })
            except Exception:
                continue
    except Exception:
        pass

    mirror = None
    status_path = backup_dir / ".mirror_status.json"
    if status_path.exists():
        try:
            mirror = json.loads(status_path.read_text())
        except Exception:
            mirror = {"error": "could not parse mirror_status.json"}

    # Inspect env (read directly from /app/backend/.env so we don't mistakenly
    # surface a missing variable when supervisor has loaded it from a different
    # source — keeps the response truthful).
    mode = os.environ.get("BACKUP_MIRROR_MODE", "").strip().lower() or "none"
    return {
        "mode": mode,
        "configured": mode not in ("", "none"),
        "local": {
            "dir": str(backup_dir),
            "count": len(archives),
            "recent": archives,
        },
        "mirror": mirror,
        "now": datetime.now(timezone.utc).isoformat(),
    }

@router.post("/api/admin/demo/create")
async def create_demo_account(body: CreateDemoBody, user=Depends(require_super_owner)):
    """Super-owner-only. Creates a demo account (`is_demo: true`) with
    the requested role. The middleware blocks every write request from
    demo accounts (regardless of role) — they can navigate the entire
    UI but submits short-circuit with a friendly 403.

    role:
      • "primary_owner" (default) → demo for sales / staff onboarding.
      • "patient"                  → demo of the patient experience.
                                     If `seed_sample_data` (default true)
                                     a fake booking / Rx / IPSS row are
                                     inserted so the demo looks rich.
    """
    email_l = (body.email or "").strip().lower()
    if not email_l or "@" not in email_l:
        raise HTTPException(status_code=400, detail="Valid email required")
    role = (body.role or "primary_owner").strip().lower()
    if role not in {"primary_owner", "patient"}:
        raise HTTPException(status_code=400, detail="role must be 'primary_owner' or 'patient'")
    name = (body.name or email_l.split("@")[0].title())
    perms: Dict[str, Any] = {
        "role": role,
        "is_demo": True,
        "name": name,
    }
    if role == "primary_owner":
        perms.update({
            "can_approve_bookings": True,
            "can_approve_broadcasts": True,
            "can_send_personal_messages": True,
        })
    # Upsert team_invites so future sign-ins keep the role + flag.
    await db.team_invites.update_one(
        {"email": email_l}, {"$set": {**perms, "email": email_l}}, upsert=True
    )
    # If a user already exists, mark the live record too AND grab the
    # existing user_id so we can tag seeded rows with it.
    existing = await db.users.find_one({"email": email_l}, {"_id": 0, "user_id": 1})
    user_id: Optional[str] = (existing or {}).get("user_id")
    if existing:
        await db.users.update_one({"email": email_l}, {"$set": perms})
    elif role == "patient":
        # For demo PATIENTS we want a stable user_id immediately so we
        # can seed bookings / Rx / IPSS now (without waiting for the
        # demo user to actually sign in). Insert a placeholder users
        # row that real auth will update on first login.
        user_id = f"u_demo_{uuid.uuid4().hex[:10]}"
        await db.users.insert_one({
            "user_id": user_id,
            "email": email_l,
            "name": name,
            "role": "patient",
            "is_demo": True,
            "phone": "+910000000001",
            "consent_medical": True,
            "consent_terms": True,
            "consent_at": datetime.now(timezone.utc),
            "created_at": datetime.now(timezone.utc),
        })
    seeded = None
    if role == "patient" and body.seed_sample_data and user_id:
        seeded = await _seed_demo_patient_data(user_id, email_l, name)
    try:
        await db.audit_log.insert_one({
            "ts": datetime.now(timezone.utc), "kind": "demo_created",
            "target_email": email_l, "actor_email": (user.get("email") or "").lower(),
            "demo_role": role, "seeded": seeded,
        })
    except Exception:
        pass
    return {"ok": True, "email": email_l, "role": role, "is_demo": True,
            "user_id": user_id, "seeded": seeded}

@router.delete("/api/admin/demo/{user_id}")
async def revoke_demo_primary_owner(user_id: str, user=Depends(require_super_owner)):
    """Revoke a demo account — demote to patient and clear is_demo.
    For patient demos we ALSO sweep up the seeded sample bookings /
    prescriptions / IPSS rows so the user record + their "fake history"
    disappear together.

    Accepts `user_id="pending:<email>"` to revoke a demo invite that
    hasn't signed in yet (no users row exists yet)."""
    # Pending-invite branch — no users doc exists.
    if user_id.startswith("pending:"):
        email_l = user_id.split(":", 1)[1].strip().lower()
        res = await db.team_invites.delete_many({"email": email_l, "is_demo": True})
        return {"ok": True, "revoked_invites": res.deleted_count, "cleanup": {"bookings": 0, "prescriptions": 0, "ipss": 0}}
    target = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if not target.get("is_demo"):
        raise HTTPException(status_code=400, detail="Not a demo account")
    perms = {"role": "patient", "is_demo": False,
             "can_approve_bookings": False, "can_approve_broadcasts": False,
             "can_send_personal_messages": False}
    await db.users.update_one({"user_id": user_id}, {"$set": perms})
    await db.team_invites.update_many({"email": (target.get("email") or "").lower()},
                                      {"$set": perms})
    # Sweep seeded sample data (best-effort).
    cleanup = {"bookings": 0, "prescriptions": 0, "ipss": 0}
    try:
        cleanup["bookings"] = (await db.bookings.delete_many({"user_id": user_id, "is_demo_seed": True})).deleted_count
        cleanup["prescriptions"] = (await db.prescriptions.delete_many({"user_id": user_id, "is_demo_seed": True})).deleted_count
        cleanup["ipss"] = (await db.ipss_submissions.delete_many({"user_id": user_id, "is_demo_seed": True})).deleted_count
    except Exception:
        pass
    return {"ok": True, "cleanup": cleanup}

@router.get("/api/admin/demo")
async def list_demo_accounts(user=Depends(require_super_owner)):
    """Lists every demo account including those that have not signed
    in yet. Previously only `users` with `is_demo:true` were returned
    which hid freshly-created primary_owner demos (they only exist as
    team_invites until the user signs in for the first time)."""
    items: List[Dict[str, Any]] = []
    seen_emails: set = set()
    # 1) Live users
    async for u in db.users.find({"is_demo": True}, {"_id": 0}):
        em = (u.get("email") or "").lower()
        if em in seen_emails:
            continue
        seen_emails.add(em)
        items.append({"user_id": u.get("user_id"), "email": em,
                      "name": u.get("name"), "role": u.get("role"),
                      "picture": u.get("picture"),
                      "signed_in": True})
    # 2) Pending invites (not signed in yet).
    async for iv in db.team_invites.find({"is_demo": True}, {"_id": 0}):
        em = (iv.get("email") or "").lower()
        if em in seen_emails:
            continue
        seen_emails.add(em)
        items.append({"user_id": None, "email": em,
                      "name": iv.get("name"), "role": iv.get("role"),
                      "picture": None,
                      "signed_in": False})
    return {"items": items}

@router.get("/api/admin/platform-stats")
async def platform_stats(user=Depends(require_super_owner)):
    """One-shot summary used by the super-owner dashboard."""
    import asyncio
    [primary_count, partner_count, staff_count, patient_count,
     bookings_30d, rx_30d, demo_count] = await asyncio.gather(
        db.users.count_documents({"role": "primary_owner"}),
        db.users.count_documents({"role": "partner"}),
        db.users.count_documents({"role": {"$in": ["doctor", "assistant", "reception", "nursing"]}}),
        db.users.count_documents({"role": "patient"}),
        db.bookings.count_documents({"created_at": {"$gte": (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()}}),
        db.prescriptions.count_documents({"created_at": {"$gte": (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()}}),
        db.users.count_documents({"is_demo": True}),
    )
    return {
        "primary_owners": primary_count,
        "partners": partner_count,
        "staff": staff_count,
        "patients": patient_count,
        "bookings_last_30d": bookings_30d,
        "prescriptions_last_30d": rx_30d,
        "demo_accounts": demo_count,
    }

@router.get("/api/admin/audit-log")
async def get_audit_log(limit: int = 50, user=Depends(require_owner)):
    """Recent role-change / demo / sensitive events. Visible to the
    entire owner-tier so primary_owners and partners can review who
    promoted whom and when."""
    rows: List[Dict[str, Any]] = []
    async for r in db.audit_log.find({}, {"_id": 0}).sort("ts", -1).limit(int(limit)):
        if isinstance(r.get("ts"), datetime):
            r["ts"] = r["ts"].isoformat()
        rows.append(r)
    return {"items": rows}
