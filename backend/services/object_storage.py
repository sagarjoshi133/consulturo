"""ConsultUro 2.0 — Phase C: Emergent Object Storage client.

Managed storage per the Emergent playbook: the mobile app never talks
to storage directly — only this backend does, authenticated with
EMERGENT_LLM_KEY via the /init → storage_key handshake.

Sync `requests` calls are wrapped with run_in_threadpool so the event
loop never blocks. A stale storage_key surfaces as HTTP 503 — we reset
and re-init exactly once per call.
"""
from __future__ import annotations

import os
from typing import Any, Dict, Tuple

import requests
from fastapi.concurrency import run_in_threadpool

STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
APP_NAME = "consulturo"

_storage_key: str | None = None


class StorageQuotaError(Exception):
    """Raised on HTTP 402 — storage credits exhausted (uploads blocked,
    reads keep working). Callers must NOT retry-loop."""


def _init_sync() -> str:
    global _storage_key
    if _storage_key:
        return _storage_key
    resp = requests.post(
        f"{STORAGE_URL}/init",
        json={"emergent_key": os.environ.get("EMERGENT_LLM_KEY")},
        timeout=30,
    )
    resp.raise_for_status()
    _storage_key = resp.json()["storage_key"]
    return _storage_key


def _reset_key() -> None:
    global _storage_key
    _storage_key = None


def _put_sync(path: str, data: bytes, content_type: str) -> Dict[str, Any]:
    for attempt in (1, 2):
        key = _init_sync()
        resp = requests.put(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key, "Content-Type": content_type},
            data=data,
            timeout=120,
        )
        if resp.status_code == 402:
            raise StorageQuotaError("Object storage credits exhausted")
        if resp.status_code == 503 and attempt == 1:
            _reset_key()  # stale key — re-init once
            continue
        resp.raise_for_status()
        return resp.json()
    raise RuntimeError("unreachable")


def _get_sync(path: str) -> Tuple[bytes, str]:
    for attempt in (1, 2):
        key = _init_sync()
        resp = requests.get(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key},
            timeout=60,
        )
        if resp.status_code == 503 and attempt == 1:
            _reset_key()
            continue
        resp.raise_for_status()
        return resp.content, resp.headers.get("Content-Type", "application/octet-stream")
    raise RuntimeError("unreachable")


# ── Async facade ─────────────────────────────────────────────────────

async def init_storage() -> None:
    await run_in_threadpool(_init_sync)


async def put_object(path: str, data: bytes, content_type: str) -> Dict[str, Any]:
    return await run_in_threadpool(_put_sync, path, data, content_type)


async def get_object(path: str) -> Tuple[bytes, str]:
    return await run_in_threadpool(_get_sync, path)


def build_upload_path(user_id: str, filename_ext: str) -> str:
    """`consulturo/uploads/{user_id}/{uuid}{ext}` — no leading slash,
    UUID filename; the original name lives in file_objects."""
    import uuid as _uuid
    return f"{APP_NAME}/uploads/{user_id}/{_uuid.uuid4().hex}{filename_ext}"
