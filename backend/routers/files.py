"""ConsultUro 2.0 — Phase C: file storage router.

  · POST /api/files/upload   — store a base64 payload in Emergent
                               Object Storage; returns {file_id, url}.
  · GET  /api/files/{id}     — stream it back. Auth via Bearer header
                               OR `?sid=<session_token>` query (web
                               <img> tags cannot send headers).

Access rules on download:
  1. uploader (owner_id) always;
  2. sender/recipient of any personal message referencing the file;
  3. `scope=broadcast` files — any signed-in user.
"""
from __future__ import annotations

import base64
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel

from auth_deps import get_current_user, require_user
from db import db
from repositories import files as files_repo
from services.object_storage import (
    StorageQuotaError,
    build_upload_path,
    get_object,
    put_object,
)

router = APIRouter()

MAX_FILE_BYTES = 8 * 1024 * 1024  # matches the messaging attachment cap

_EXT_BY_MIME = {
    "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp",
    "image/gif": ".gif", "image/heic": ".heic",
    "video/mp4": ".mp4", "video/quicktime": ".mov",
    "audio/mpeg": ".mp3", "audio/mp4": ".m4a",
    "application/pdf": ".pdf", "text/plain": ".txt",
}


def _ext_for(name: str, mime: str) -> str:
    m = re.search(r"(\.[A-Za-z0-9]{2,5})$", name or "")
    if m:
        return m.group(1).lower()
    return _EXT_BY_MIME.get((mime or "").lower().split(";")[0], ".bin")


class FileUploadBody(BaseModel):
    name: str
    mime: Optional[str] = None
    # Either a full data URL ("data:<mime>;base64,....") or raw base64.
    data_url: Optional[str] = None
    data_base64: Optional[str] = None
    kind: Optional[str] = None    # image | video | audio | file
    scope: Optional[str] = "message"


@router.post("/api/files/upload")
async def upload_file(body: FileUploadBody, user=Depends(require_user)):
    b64 = (body.data_base64 or "").strip()
    mime = (body.mime or "").strip()
    if not b64 and body.data_url:
        du = body.data_url.strip()
        if not du.startswith("data:") or "," not in du:
            raise HTTPException(status_code=400, detail="Malformed data_url")
        header, b64 = du.split(",", 1)
        if not mime:
            mime = header[5:].split(";")[0]
    if not b64:
        raise HTTPException(status_code=400, detail="No file data supplied")
    try:
        blob = base64.b64decode(b64, validate=False)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 payload")
    if not blob:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(blob) > MAX_FILE_BYTES:
        raise HTTPException(status_code=400, detail="File exceeds the 8 MB limit")
    mime = mime or "application/octet-stream"

    uid = user["user_id"]
    path = build_upload_path(uid, _ext_for(body.name, mime))
    try:
        res = await put_object(path, blob, mime)
    except StorageQuotaError:
        raise HTTPException(status_code=402, detail={
            "error_code": "storage_quota_exhausted",
            "message": "Object storage credits are exhausted — uploads are paused. Existing files still download.",
        })
    except Exception as e:
        raise HTTPException(status_code=502, detail={
            "error_code": "storage_upstream_error",
            "message": f"Object storage upload failed: {str(e)[:200]}",
        })

    file_id = str(uuid.uuid4())
    row: Dict[str, Any] = {
        "id": file_id,
        "owner_id": uid,
        "storage_path": (res or {}).get("path") or path,
        "name": (body.name or "attachment")[:120],
        "mime": mime,
        "size_bytes": len(blob),
        "kind": (body.kind or "").strip() or None,
        "scope": (body.scope or "message").strip() or "message",
        "etag": (res or {}).get("etag"),
        "deleted": False,
        "created_at": datetime.now(timezone.utc),
    }
    await files_repo.insert(row)
    return {
        "file_id": file_id,
        "url": f"/api/files/{file_id}",
        "name": row["name"],
        "mime": mime,
        "size_bytes": row["size_bytes"],
        "kind": row["kind"],
    }


async def _user_from_sid(sid: str) -> Optional[Dict[str, Any]]:
    """Resolve a session token passed via query string (web <img> tags
    can't send Authorization headers). Mirrors get_current_user."""
    if not sid:
        return None
    session = await db.user_sessions.find_one({"session_token": sid}, {"_id": 0})
    if not session:
        return None
    expires_at = session.get("expires_at")
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at and expires_at < datetime.now(timezone.utc):
        return None
    return await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})


async def _may_access(user: Dict[str, Any], row: Dict[str, Any]) -> bool:
    uid = user["user_id"]
    if row.get("owner_id") == uid:
        return True
    if row.get("scope") == "broadcast":
        return True  # broadcast media is clinic-wide by definition
    # Personal-message attachment: caller must be the recipient or
    # sender of a notification referencing this file.
    hit = await db.notifications.find_one(
        {
            "data.attachments.file_id": row["id"],
            "$or": [{"user_id": uid}, {"data.sender_user_id": uid}],
        },
        {"_id": 0, "id": 1},
    )
    return bool(hit)


@router.get("/api/files/{file_id}")
async def download_file(file_id: str, sid: str = "", user=Depends(get_current_user)):
    if not user and sid:
        user = await _user_from_sid(sid)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if user.get("suspended"):
        raise HTTPException(status_code=403, detail="Account suspended")
    row = await files_repo.get(file_id)
    if not row or row.get("deleted"):
        raise HTTPException(status_code=404, detail="File not found")
    if not await _may_access(user, row):
        raise HTTPException(status_code=403, detail="You don't have access to this file")
    try:
        content, upstream_ct = await get_object(row["storage_path"])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Storage read failed: {str(e)[:200]}")
    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", row.get("name") or "attachment")
    return Response(
        content=content,
        media_type=row.get("mime") or upstream_ct,
        headers={
            "Content-Disposition": f'inline; filename="{safe_name}"',
            "Cache-Control": "private, max-age=3600",
        },
    )
