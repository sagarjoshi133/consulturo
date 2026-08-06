"""ConsultUro — admin_extras router.

  · /api/admin/backup/status
  · /api/admin/backup/run
  · /api/admin/backup/download/{name}
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
import secrets
import urllib.parse
import uuid
import json
import asyncio
import os
import re
import shlex
import subprocess
from pathlib import Path
import httpx
from fastapi import APIRouter, Body, Depends, HTTPException, Path as FPath, Query, Request
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from db import db
from auth_deps import require_owner, require_super_owner
from models import CreateDemoBody
from server import _human_bytes, _seed_demo_patient_data

router = APIRouter()

_BACKUP_DIR = Path("/app/backups")
# Filenames must look like `consulturo-YYYY-MM-DD-HHMMSS.tar.gz` — anything
# else is rejected to make the download endpoint safe against path-traversal.
_ARCHIVE_RE = re.compile(r"^consulturo-\d{4}-\d{2}-\d{2}-\d{6}\.tar\.gz$")


@router.get("/api/admin/backup/status")
async def admin_backup_status(user=Depends(require_owner)):
    """Owner-only: surface the latest mongodump + off-host mirror status.

    Reads /app/backups/.mirror_status.json (written by mirror_backups.sh)
    and decorates it with details of the most recent local archive so the
    dashboard can show "last backup at X, mirrored to Y".
    """
    backup_dir = _BACKUP_DIR
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


@router.post("/api/admin/backup/run")
async def admin_backup_run(user=Depends(require_owner)):
    """Owner-only: trigger an immediate mongodump + mirror push.

    Runs `/app/scripts/backup_mongo.sh` in a background thread (the
    script is bounded — full dump on a tenant-DB completes well under
    30s) and returns the new archive name on success. The mirror push
    (rclone / S3 / rsync) runs as the script's last step, so the same
    call updates `.mirror_status.json` too.

    Failures bubble up as 500 with the script's stderr so the
    dashboard can show a sensible error.
    """
    script = Path("/app/scripts/backup_mongo.sh")
    if not script.exists():
        raise HTTPException(status_code=500, detail="backup_mongo.sh missing on host")

    snapshot_before = {p.name for p in _BACKUP_DIR.glob("consulturo-*.tar.gz")}

    # Run synchronously inside an executor so we can return the new
    # archive name (the user expects sub-second feedback).
    loop = asyncio.get_running_loop()
    try:
        proc = await loop.run_in_executor(
            None,
            lambda: subprocess.run(
                ["/bin/bash", str(script)],
                capture_output=True, text=True, timeout=180,
            ),
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Backup timed out after 3 minutes")

    if proc.returncode != 0:
        # Trim noisy output so the UI toast stays readable.
        tail = (proc.stderr or proc.stdout or "")[-600:]
        raise HTTPException(status_code=500, detail=f"backup failed: {tail.strip()}")

    snapshot_after = {p.name for p in _BACKUP_DIR.glob("consulturo-*.tar.gz")}
    new_archives = sorted(snapshot_after - snapshot_before, reverse=True)
    new_name = new_archives[0] if new_archives else None

    info: Dict[str, Any] = {"ok": True, "stdout_tail": (proc.stdout or "")[-400:]}
    if new_name:
        try:
            st = (_BACKUP_DIR / new_name).stat()
            info["archive"] = {
                "name": new_name,
                "size_bytes": st.st_size,
                "size_human": _human_bytes(st.st_size),
                "modified": datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat(),
            }
        except Exception:
            info["archive"] = {"name": new_name}
    # Audit trail so partners / co-owners can see manual runs.
    try:
        await db.audit_log.insert_one({
            "ts": datetime.now(timezone.utc),
            "kind": "backup_manual_run",
            "actor_email": (user.get("email") or "").lower(),
            "archive": new_name,
        })
    except Exception:
        pass
    return info


@router.get("/api/admin/backup/download/{name}")
async def admin_backup_download(
    name: str = FPath(..., description="Exact archive filename"),
    user=Depends(require_owner),
):
    """Owner-only: stream a backup archive to the caller as a file
    download. The filename must match the strict
    `consulturo-YYYY-MM-DD-HHMMSS.tar.gz` pattern to prevent
    path-traversal — the request is rejected for anything else."""
    if not _ARCHIVE_RE.match(name):
        raise HTTPException(status_code=400, detail="Invalid backup filename")
    path = _BACKUP_DIR / name
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="Backup archive not found")
    try:
        await db.audit_log.insert_one({
            "ts": datetime.now(timezone.utc),
            "kind": "backup_downloaded",
            "actor_email": (user.get("email") or "").lower(),
            "archive": name,
        })
    except Exception:
        pass
    return FileResponse(
        str(path),
        media_type="application/gzip",
        filename=name,
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )

# ─── Off-host mirror wizard (rclone / Google Drive) ────────────────
# In-app, laptop-free path A:
#   1. The frontend opens https://rclone.org/authorize/?type=drive&scope=drive
#      in the device's browser.
#   2. User grants access, Google returns the user to a page that
#      shows a JSON token (or a string starting with `{ "access_token": ... }`).
#   3. The frontend posts that token here.
#   4. We write `~/.config/rclone/rclone.conf` with a `[gdrive]` block,
#      append BACKUP_MIRROR_MODE / RCLONE_REMOTE to /app/backend/.env,
#      validate with `rclone mkdir gdrive:<folder>`, and refresh
#      `os.environ` so subsequent /api/admin/backup/run calls already
#      see the new settings without waiting for a backend restart.
_RCLONE_CONF_PATH = Path(os.path.expanduser("~/.config/rclone/rclone.conf"))
_BACKEND_ENV_PATH = Path("/app/backend/.env")
# Strict-enough JSON-token pattern check — we let rclone do the real
# validation by writing the config and calling `rclone lsd` on the
# remote. This regex just makes sure we don't write garbage to disk.
# We allow `access_token` as the FIRST key (most common) by using
# `[\s\S]*` rather than `[\s\S]+`.
_RCLONE_TOKEN_RE = re.compile(r'^\s*\{[\s\S]*"access_token"\s*:\s*"[^"]+"', re.MULTILINE)


def _upsert_env_kv(env_path: Path, updates: Dict[str, str]) -> None:
    """Idempotently set the given KEY=value pairs in a dotenv file.
    Preserves comments / unrelated lines, replaces an existing key in
    place if present, otherwise appends it.
    """
    lines: List[str] = []
    if env_path.exists():
        lines = env_path.read_text().splitlines()
    keys_left = set(updates.keys())
    new_lines: List[str] = []
    for ln in lines:
        stripped = ln.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            new_lines.append(ln)
            continue
        k = stripped.split("=", 1)[0].strip()
        if k in updates:
            new_lines.append(f"{k}={updates[k]}")
            keys_left.discard(k)
        else:
            new_lines.append(ln)
    if keys_left:
        # Ensure a separator before appending fresh keys.
        if new_lines and new_lines[-1].strip() != "":
            new_lines.append("")
        new_lines.append("# Off-host backup mirror (added by wizard)")
        for k in sorted(keys_left):
            new_lines.append(f"{k}={updates[k]}")
    env_path.write_text("\n".join(new_lines) + "\n")


def _rclone_installed() -> bool:
    return subprocess.run(
        ["bash", "-lc", "command -v rclone >/dev/null 2>&1"]
    ).returncode == 0


@router.get("/api/admin/backup/mirror/info")
async def mirror_wizard_info(user=Depends(require_owner)):
    """Quick status check for the wizard UI — tells the frontend
    whether rclone is installed, whether a [gdrive] remote already
    exists, and where the config file lives. Owner-only."""
    has_rclone = _rclone_installed()
    has_remote = False
    if _RCLONE_CONF_PATH.exists():
        try:
            text = _RCLONE_CONF_PATH.read_text()
            has_remote = "[gdrive]" in text
        except Exception:
            has_remote = False
    mode = (os.environ.get("BACKUP_MIRROR_MODE") or "").strip().lower()
    remote = (os.environ.get("RCLONE_REMOTE") or "").strip()
    return {
        "rclone_installed": has_rclone,
        "has_gdrive_remote": has_remote,
        "rclone_conf_path": str(_RCLONE_CONF_PATH),
        "current_mode": mode,
        "current_remote": remote,
        "configured": mode == "rclone" and bool(remote) and has_remote,
        "authorize_url": "https://rclone.org/authorize/?type=drive&scope=drive",
    }


@router.post("/api/admin/backup/mirror/connect")
async def mirror_wizard_connect(
    body: Dict[str, Any] = Body(...),
    user=Depends(require_owner),
):
    """Owner-only. Persist a Google-Drive `[gdrive]` remote derived
    from the JSON token the user pasted, then validate by creating
    the destination folder on Drive.

    Body:
      {
        "token":  "<JSON string starting with { \"access_token\": ... }>",
        "folder": "consulturo-backups"   // optional, default
      }

    Returns 200 with a friendly summary on success, 4xx with an
    actionable message on any parse / auth / network failure.
    """
    token_raw = (body.get("token") or "").strip()
    folder = (body.get("folder") or "consulturo-backups").strip() or "consulturo-backups"
    if not token_raw:
        raise HTTPException(status_code=400, detail="Paste the authorization token from your browser.")
    # Light validation — the token Google hands back is a JSON object
    # with access_token / refresh_token / token_type / expiry.
    if not _RCLONE_TOKEN_RE.search(token_raw):
        raise HTTPException(
            status_code=400,
            detail=(
                "That doesn't look like the rclone authorization token. "
                "It should be a JSON string starting with { \"access_token\": \"...\" }."
            ),
        )
    if not _rclone_installed():
        raise HTTPException(
            status_code=500,
            detail="rclone is not installed on the server. Ask the platform admin to run `apt-get install -y rclone`.",
        )
    # Compact the token to a single line — rclone's config parser is
    # whitespace-sensitive when the token spans multiple lines.
    try:
        token_obj = json.loads(token_raw)
        token_one_line = json.dumps(token_obj, separators=(",", ":"))
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Token isn't valid JSON: {e.msg}")

    # Read existing config so we can preserve any other (non-gdrive)
    # remotes the user has previously set up.
    conf_text = ""
    if _RCLONE_CONF_PATH.exists():
        try:
            conf_text = _RCLONE_CONF_PATH.read_text()
        except Exception:
            conf_text = ""
    # Strip any prior [gdrive] block (everything from [gdrive] to the
    # next [section] / EOF) so re-running the wizard replaces the
    # remote cleanly instead of stacking duplicates.
    if "[gdrive]" in conf_text:
        conf_text = re.sub(
            r"\[gdrive\][\s\S]*?(?=\n\[|\Z)", "", conf_text
        ).rstrip() + "\n"
    if conf_text and not conf_text.endswith("\n"):
        conf_text += "\n"
    new_block = (
        "\n[gdrive]\n"
        "type = drive\n"
        "scope = drive\n"
        f"token = {token_one_line}\n"
    )
    _RCLONE_CONF_PATH.parent.mkdir(parents=True, exist_ok=True)
    _RCLONE_CONF_PATH.write_text(conf_text + new_block)
    try:
        os.chmod(_RCLONE_CONF_PATH, 0o600)
    except Exception:
        pass

    # Validate by listing the root of the drive — fastest call that
    # actually exercises the token. If this fails the token is bad.
    loop = asyncio.get_running_loop()
    try:
        check = await loop.run_in_executor(
            None,
            lambda: subprocess.run(
                ["rclone", "lsd", "gdrive:", "--max-depth", "1"],
                capture_output=True, text=True, timeout=30,
            ),
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="rclone timed out connecting to Google Drive.")
    if check.returncode != 0:
        # Likely a stale token / wrong account — keep the conf so the
        # user can retry without re-authorising, but surface the err.
        tail = (check.stderr or check.stdout or "").strip()[-400:]
        raise HTTPException(
            status_code=502,
            detail=f"Could not reach Google Drive with that token. rclone said: {tail}",
        )
    # Make sure our destination folder exists (idempotent).
    remote_path = f"gdrive:{folder}"
    try:
        mk = await loop.run_in_executor(
            None,
            lambda: subprocess.run(
                ["rclone", "mkdir", remote_path],
                capture_output=True, text=True, timeout=30,
            ),
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="rclone timed out creating the backup folder.")
    if mk.returncode != 0:
        tail = (mk.stderr or mk.stdout or "").strip()[-400:]
        raise HTTPException(
            status_code=502, detail=f"Could not create folder on Google Drive: {tail}"
        )

    # Persist BACKUP_MIRROR_MODE + RCLONE_REMOTE to /app/backend/.env
    # AND refresh os.environ so the next /api/admin/backup/run picks
    # up the new mode without a backend restart.
    updates = {
        "BACKUP_MIRROR_MODE": "rclone",
        "RCLONE_REMOTE": remote_path,
        "RCLONE_CONFIG": str(_RCLONE_CONF_PATH),
    }
    try:
        _upsert_env_kv(_BACKEND_ENV_PATH, updates)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not update .env: {e}")
    for k, v in updates.items():
        os.environ[k] = v

    # Best-effort: mirror existing archives once so the user sees an
    # immediate "Mirrored: N files" status. Skipped if there are no
    # archives yet (first-run clinic).
    mirror_status: Dict[str, Any] = {"ok": True, "ran_initial_push": False}
    try:
        any_archive = next(_BACKUP_DIR.glob("consulturo-*.tar.gz"), None)
        if any_archive is not None:
            push = await loop.run_in_executor(
                None,
                lambda: subprocess.run(
                    ["/bin/bash", "/app/scripts/mirror_backups.sh"],
                    capture_output=True, text=True, timeout=120,
                ),
            )
            mirror_status["ran_initial_push"] = True
            mirror_status["mirror_rc"] = push.returncode
            if push.returncode != 0:
                mirror_status["ok"] = False
                mirror_status["detail"] = (push.stderr or push.stdout or "")[-400:]
    except Exception as e:
        mirror_status["ok"] = False
        mirror_status["detail"] = str(e)

    try:
        await db.audit_log.insert_one({
            "ts": datetime.now(timezone.utc),
            "kind": "backup_mirror_connect",
            "actor_email": (user.get("email") or "").lower(),
            "remote": remote_path,
        })
    except Exception:
        pass

    return {
        "ok": True,
        "remote": remote_path,
        "folder": folder,
        "mode": "rclone",
        "initial_push": mirror_status,
        "now": datetime.now(timezone.utc).isoformat(),
    }


@router.post("/api/admin/backup/mirror/test")
async def mirror_wizard_test(user=Depends(require_owner)):
    """Owner-only. Re-run mirror_backups.sh now and surface the result."""
    script = Path("/app/scripts/mirror_backups.sh")
    if not script.exists():
        raise HTTPException(status_code=500, detail="mirror_backups.sh missing on host")
    loop = asyncio.get_running_loop()
    try:
        proc = await loop.run_in_executor(
            None,
            lambda: subprocess.run(
                ["/bin/bash", str(script)],
                capture_output=True, text=True, timeout=180,
            ),
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Mirror test timed out after 3 minutes")
    return {
        "ok": proc.returncode == 0,
        "exit_code": proc.returncode,
        "stdout_tail": (proc.stdout or "")[-600:],
        "stderr_tail": (proc.stderr or "")[-600:],
    }


@router.post("/api/admin/backup/mirror/disconnect")
async def mirror_wizard_disconnect(user=Depends(require_owner)):
    """Owner-only. Remove the gdrive remote from rclone.conf and
    flip BACKUP_MIRROR_MODE back to `none` in the dotenv. Keeps the
    archives on local disk untouched."""
    if _RCLONE_CONF_PATH.exists():
        try:
            text = _RCLONE_CONF_PATH.read_text()
            new = re.sub(r"\[gdrive\][\s\S]*?(?=\n\[|\Z)", "", text).rstrip() + "\n"
            _RCLONE_CONF_PATH.write_text(new)
        except Exception:
            pass
    try:
        _upsert_env_kv(_BACKEND_ENV_PATH, {"BACKUP_MIRROR_MODE": "none"})
    except Exception:
        pass
    os.environ["BACKUP_MIRROR_MODE"] = "none"
    os.environ.pop("RCLONE_REMOTE", None)
    try:
        await db.audit_log.insert_one({
            "ts": datetime.now(timezone.utc),
            "kind": "backup_mirror_disconnect",
            "actor_email": (user.get("email") or "").lower(),
        })
    except Exception:
        pass
    return {"ok": True, "mode": "none"}



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
async def get_audit_log(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    action: Optional[str] = Query(None, description="Filter by `action` prefix (e.g. `prescription.`)"),
    actor_role: Optional[str] = Query(None),
    since_ms: Optional[int] = Query(None, description="Unix ms — only show entries newer than this"),
    until_ms: Optional[int] = Query(None, description="Unix ms — only show entries older than this"),
    q: Optional[str] = Query(None, description="Free text — substring match on action / actor_name / target_id"),
    user=Depends(require_owner),
):
    """Recent role-change / demo / sensitive events. Visible to the
    entire owner-tier so primary_owners and partners can review who
    promoted whom and when.

    Supports filtering and offset pagination so the new Audit-Log
    Viewer UI can browse, narrow down, and paginate older entries.
    Backwards-compatible: callers passing only `limit` still get the
    previous shape, with `items` populated newest-first.
    """
    query: Dict[str, Any] = {}
    if action:
        # Prefix match — e.g. action="prescription." matches
        # prescription.create, prescription.share, etc.
        # Match both `action` (new schema) and `kind` (legacy schema).
        rgx_action = {"$regex": f"^{re.escape(action)}", "$options": "i"}
        query["$or"] = [{"action": rgx_action}, {"kind": rgx_action}]
    if actor_role:
        query["actor_role"] = actor_role
    ts_range: Dict[str, Any] = {}
    if since_ms is not None:
        ts_range["$gte"] = since_ms
    if until_ms is not None:
        ts_range["$lte"] = until_ms
    if ts_range:
        # `ts` may be stored as int (ms) OR ISO string. We compare both
        # representations using $or to keep legacy rows queryable.
        iso_range: Dict[str, Any] = {}
        if since_ms is not None:
            iso_range["$gte"] = datetime.fromtimestamp(since_ms / 1000, tz=timezone.utc).isoformat()
        if until_ms is not None:
            iso_range["$lte"] = datetime.fromtimestamp(until_ms / 1000, tz=timezone.utc).isoformat()
        ts_or = [{"ts": ts_range}, {"ts": iso_range}]
        if "$or" in query:
            # Combine with the existing action $or via $and so neither
            # clause clobbers the other.
            query = {"$and": [{"$or": query.pop("$or")}, {"$or": ts_or}, query]}
        else:
            query["$or"] = ts_or
    if q:
        # Case-insensitive substring match across the text fields most
        # useful for incident lookups. Includes legacy field names.
        rgx = {"$regex": re.escape(q), "$options": "i"}
        text_or = [
            {"action": rgx},
            {"kind": rgx},
            {"actor_name": rgx},
            {"actor_email": rgx},
            {"target_id": rgx},
            {"target_email": rgx},
            {"actor_id": rgx},
        ]
        if "$or" in query:
            query = {"$and": [{"$or": query.pop("$or")}, {"$or": text_or}, query]}
        elif "$and" in query:
            query["$and"].append({"$or": text_or})
        else:
            query["$or"] = text_or

    total = await db.audit_log.count_documents(query)
    rows: List[Dict[str, Any]] = []
    cursor = (
        db.audit_log.find(query, {"_id": 0})
        .sort("ts", -1)
        .skip(int(offset))
        .limit(int(limit))
    )
    async for r in cursor:
        if isinstance(r.get("ts"), datetime):
            r["ts"] = r["ts"].isoformat()
        rows.append(r)
    return {"items": rows, "total": total, "offset": offset, "limit": limit}


@router.get("/api/admin/audit-log/facets")
async def get_audit_log_facets(user=Depends(require_owner)):
    """Returns distinct values for the filter dropdowns in the
    Audit-Log Viewer UI — actions, actor roles, and the timestamp of
    the oldest entry so the date-range picker has a sane min boundary."""
    # Union of new + legacy schemas.
    actions_new = await db.audit_log.distinct("action")
    actions_legacy = await db.audit_log.distinct("kind")
    combined = sorted({a for a in [*actions_new, *actions_legacy] if a})
    roles = await db.audit_log.distinct("actor_role")
    oldest = await db.audit_log.find_one({}, sort=[("ts", 1)])
    newest = await db.audit_log.find_one({}, sort=[("ts", -1)])
    return {
        "actions": combined,
        "actor_roles": sorted([r for r in roles if r]),
        "oldest_ts": (oldest or {}).get("ts"),
        "newest_ts": (newest or {}).get("ts"),
        "total": await db.audit_log.count_documents({}),
    }


# ─── Google Drive OAuth 2.0 wizard (proper "one-tap" flow) ──────────
# Replaces the legacy rclone-authorize paste-token flow (which broke
# when rclone.org/authorize started returning 404). Uses the user's
# own Google Cloud OAuth client so the consent screen says
# "ConsultUro wants access" rather than the deprecated public rclone
# brand.
_GDRIVE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
_GDRIVE_TOKEN_URL = "https://oauth2.googleapis.com/token"
_GDRIVE_SCOPE = "https://www.googleapis.com/auth/drive"
_GDRIVE_CLIENT_DOC_ID = "gdrive_oauth_client"
_GDRIVE_STATE_TTL_SEC = 15 * 60


def _ensure_utc_aware(dt):
    """MongoDB strips tzinfo when reading datetimes back. Normalise to
    UTC-aware so arithmetic with `datetime.now(timezone.utc)` never
    blows up with `can't subtract offset-naive and offset-aware`."""
    if dt is None:
        return datetime.now(timezone.utc)
    if isinstance(dt, str):
        try:
            from datetime import datetime as _dt
            return _dt.fromisoformat(dt.replace("Z", "+00:00"))
        except Exception:
            return datetime.now(timezone.utc)
    if getattr(dt, "tzinfo", None) is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt



def _public_backend_url() -> str:
    """The publicly-reachable base URL Google must redirect to."""
    raw = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "").strip().rstrip("/")
    if raw.startswith("http"):
        return raw
    return ""


def _gdrive_redirect_uri() -> str:
    base = _public_backend_url()
    if not base:
        return ""
    return f"{base}/api/admin/backup/mirror/oauth/callback"


@router.get("/api/admin/backup/mirror/oauth/client")
async def gdrive_oauth_client_status(user=Depends(require_owner)):
    """Owner-only. Tells the wizard whether the OAuth client is saved
    and surfaces the redirect URI the user must register in Google
    Cloud Console."""
    doc = await db.gdrive_oauth.find_one({"_id": _GDRIVE_CLIENT_DOC_ID}, {"_id": 0})
    has_client = bool((doc or {}).get("client_id") and (doc or {}).get("client_secret"))
    return {
        "configured": has_client,
        "client_id": (doc or {}).get("client_id") if has_client else None,
        "redirect_uri": _gdrive_redirect_uri(),
        "public_backend_url": _public_backend_url(),
    }


@router.post("/api/admin/backup/mirror/oauth/client")
async def gdrive_oauth_save_client(
    body: Dict[str, Any] = Body(...),
    user=Depends(require_owner),
):
    """Owner-only. Persist the Google Cloud OAuth client_id +
    client_secret so the rest of the wizard can build consent URLs
    and exchange auth codes."""
    cid = (body.get("client_id") or "").strip()
    csec = (body.get("client_secret") or "").strip()
    if not cid or not csec:
        raise HTTPException(status_code=400, detail="Both client_id and client_secret are required.")
    if not cid.endswith(".apps.googleusercontent.com"):
        raise HTTPException(
            status_code=400,
            detail="That doesn't look like a Google OAuth client_id (should end with .apps.googleusercontent.com).",
        )
    await db.gdrive_oauth.update_one(
        {"_id": _GDRIVE_CLIENT_DOC_ID},
        {"$set": {
            "client_id": cid,
            "client_secret": csec,
            "updated_at": datetime.now(timezone.utc),
            "updated_by": (user.get("email") or "").lower(),
        }},
        upsert=True,
    )
    return {"ok": True, "redirect_uri": _gdrive_redirect_uri()}


@router.delete("/api/admin/backup/mirror/oauth/client")
async def gdrive_oauth_clear_client(user=Depends(require_super_owner)):
    """Super-owner-only. Wipe the stored OAuth client."""
    await db.gdrive_oauth.delete_one({"_id": _GDRIVE_CLIENT_DOC_ID})
    return {"ok": True}


@router.get("/api/admin/backup/mirror/oauth/url")
async def gdrive_oauth_build_url(
    folder: str = Query("consulturo-backups"),
    user=Depends(require_owner),
):
    """Owner-only. Build the Google OAuth consent URL with a one-time
    state token so the callback can be validated."""
    client = await db.gdrive_oauth.find_one({"_id": _GDRIVE_CLIENT_DOC_ID}, {"_id": 0})
    if not client or not client.get("client_id"):
        raise HTTPException(
            status_code=400,
            detail="Google Cloud OAuth client isn't configured yet. Save client_id + client_secret first.",
        )
    redirect_uri = _gdrive_redirect_uri()
    if not redirect_uri:
        raise HTTPException(
            status_code=500,
            detail="EXPO_PUBLIC_BACKEND_URL is not set in backend env — can't compute redirect URI.",
        )
    state = secrets.token_urlsafe(24)
    await db.gdrive_oauth_states.insert_one({
        "state": state,
        "folder": (folder or "consulturo-backups").strip() or "consulturo-backups",
        "user_id": user.get("user_id"),
        "user_email": (user.get("email") or "").lower(),
        "created_at": datetime.now(timezone.utc),
        "consumed": False,
    })
    params = {
        "client_id": client["client_id"],
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": _GDRIVE_SCOPE,
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
        "include_granted_scopes": "true",
    }
    url = f"{_GDRIVE_AUTH_URL}?{urllib.parse.urlencode(params)}"
    return {"authorize_url": url, "state": state, "redirect_uri": redirect_uri}


def _render_oauth_result(ok: bool, title: str, message: str) -> HTMLResponse:
    color = "#10B981" if ok else "#DC2626"
    icon = "&#10003;" if ok else "&#10007;"
    deep = "consulturo:///dashboard?tab=backups"
    html = f"""<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>ConsultUro &mdash; Google Drive</title>
<style>
 body{{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
       background:#F7FAFC;color:#1F2937;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;}}
 .card{{max-width:420px;background:#fff;border-radius:18px;padding:28px 24px;text-align:center;
        box-shadow:0 10px 40px rgba(0,0,0,0.08);border-top:4px solid {color};}}
 .ic{{width:56px;height:56px;border-radius:28px;background:{color}1A;color:{color};
      font-size:32px;line-height:56px;margin:0 auto 12px;font-weight:700;}}
 h1{{margin:0 0 8px;font-size:18px;color:#0F172A;}}
 p{{margin:0 0 16px;font-size:14px;color:#475569;line-height:1.5;}}
 a.btn{{display:inline-block;padding:11px 22px;background:#0E7C8B;color:#fff;border-radius:999px;
        text-decoration:none;font-weight:600;font-size:14px;}}
 .muted{{margin-top:14px;font-size:11px;color:#94A3B8;}}
</style></head><body>
<div class="card">
 <div class="ic">{icon}</div>
 <h1>{title}</h1>
 <p>{message}</p>
 <a class="btn" href="{deep}">Return to ConsultUro</a>
 <div class="muted">You can safely close this tab.</div>
</div>
</body></html>"""
    return HTMLResponse(content=html, status_code=200 if ok else 400)


@router.get("/api/admin/backup/mirror/oauth/callback")
async def gdrive_oauth_callback(
    request: Request,
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
):
    """Public endpoint &mdash; Google redirects here with ?code & ?state."""
    if error:
        return _render_oauth_result(False, "Authorization cancelled", f"Google reported: {error}")
    if not code or not state:
        return _render_oauth_result(False, "Missing parameters", "The redirect didn't include both <code>code</code> and <code>state</code>. Try the wizard again.")
    st = await db.gdrive_oauth_states.find_one({"state": state})
    if not st:
        return _render_oauth_result(False, "Unknown request", "That authorization link is invalid or expired. Tap Authorize in the wizard again.")
    age = (datetime.now(timezone.utc) - _ensure_utc_aware(st["created_at"])).total_seconds()
    if st.get("consumed") or age > _GDRIVE_STATE_TTL_SEC:
        return _render_oauth_result(False, "Link expired", "Authorization links expire after 15 minutes. Tap Authorize in the wizard again.")
    folder = (st.get("folder") or "consulturo-backups").strip()
    client = await db.gdrive_oauth.find_one({"_id": _GDRIVE_CLIENT_DOC_ID}, {"_id": 0})
    if not client or not client.get("client_id") or not client.get("client_secret"):
        return _render_oauth_result(False, "Client not configured", "The OAuth client_id/secret are missing on the server.")
    redirect_uri = _gdrive_redirect_uri()
    try:
        async with httpx.AsyncClient(timeout=20) as hc:
            r = await hc.post(_GDRIVE_TOKEN_URL, data={
                "code": code,
                "client_id": client["client_id"],
                "client_secret": client["client_secret"],
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            })
        data = r.json()
    except Exception as e:
        return _render_oauth_result(False, "Token exchange failed", f"Could not reach Google: {e}")
    if r.status_code != 200 or "access_token" not in data:
        return _render_oauth_result(False, "Token exchange failed", f"Google returned: {data.get('error_description') or data.get('error') or 'unknown error'}")
    rclone_token = {
        "access_token": data["access_token"],
        "token_type": data.get("token_type", "Bearer"),
        "refresh_token": data.get("refresh_token", ""),
        "expiry": (datetime.now(timezone.utc) + timedelta(seconds=int(data.get("expires_in", 3600)))).isoformat().replace("+00:00", "Z"),
    }
    conf_text = ""
    if _RCLONE_CONF_PATH.exists():
        try:
            conf_text = _RCLONE_CONF_PATH.read_text()
        except Exception:
            conf_text = ""
    if "[gdrive]" in conf_text:
        conf_text = re.sub(r"\[gdrive\][\s\S]*?(?=\n\[|\Z)", "", conf_text).rstrip() + "\n"
    if conf_text and not conf_text.endswith("\n"):
        conf_text += "\n"
    new_block = (
        "\n[gdrive]\n"
        "type = drive\n"
        "scope = drive\n"
        f"client_id = {client['client_id']}\n"
        f"client_secret = {client['client_secret']}\n"
        f"token = {json.dumps(rclone_token, separators=(',', ':'))}\n"
    )
    try:
        _RCLONE_CONF_PATH.parent.mkdir(parents=True, exist_ok=True)
        _RCLONE_CONF_PATH.write_text(conf_text + new_block)
        os.chmod(_RCLONE_CONF_PATH, 0o600)
    except Exception as e:
        return _render_oauth_result(False, "Could not save token", f"Write to rclone.conf failed: {e}")
    loop = asyncio.get_running_loop()
    try:
        check = await loop.run_in_executor(
            None,
            lambda: subprocess.run(
                ["rclone", "lsd", "gdrive:", "--max-depth", "1"],
                capture_output=True, text=True, timeout=30,
            ),
        )
    except Exception as e:
        return _render_oauth_result(False, "rclone test failed", f"{e}")
    if check.returncode != 0:
        return _render_oauth_result(False, "rclone test failed", (check.stderr or check.stdout or "")[-300:])
    remote_path = f"gdrive:{folder}"
    try:
        await loop.run_in_executor(
            None,
            lambda: subprocess.run(
                ["rclone", "mkdir", remote_path],
                capture_output=True, text=True, timeout=30,
            ),
        )
    except Exception:
        pass
    try:
        _upsert_env_kv(_BACKEND_ENV_PATH, {
            "BACKUP_MIRROR_MODE": "rclone",
            "RCLONE_REMOTE": remote_path,
            "RCLONE_CONFIG": str(_RCLONE_CONF_PATH),
        })
    except Exception:
        pass
    os.environ["BACKUP_MIRROR_MODE"] = "rclone"
    os.environ["RCLONE_REMOTE"] = remote_path
    os.environ["RCLONE_CONFIG"] = str(_RCLONE_CONF_PATH)
    await db.gdrive_oauth_states.update_one(
        {"state": state}, {"$set": {"consumed": True, "consumed_at": datetime.now(timezone.utc)}}
    )
    try:
        await db.audit_log.insert_one({
            "ts": datetime.now(timezone.utc),
            "kind": "backup_mirror_oauth_connect",
            "actor_email": st.get("user_email"),
            "remote": remote_path,
        })
    except Exception:
        pass
    try:
        any_archive = next(_BACKUP_DIR.glob("consulturo-*.tar.gz"), None)
        if any_archive is not None:
            await loop.run_in_executor(
                None,
                lambda: subprocess.run(
                    ["/bin/bash", "/app/scripts/mirror_backups.sh"],
                    capture_output=True, text=True, timeout=120,
                ),
            )
    except Exception:
        pass
    return _render_oauth_result(
        True,
        "Google Drive connected",
        f"Your backups will mirror to <strong>{remote_path}</strong>. Return to ConsultUro &mdash; the Backups screen will now show Mirror: Active.",
    )
