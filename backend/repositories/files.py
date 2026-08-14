"""Repository for `file_objects` — metadata rows for objects stored in
Emergent Object Storage (Phase C).

Row shape:
    id            — app-level UUID (== public file_id)
    owner_id      — uploader's user_id
    storage_path  — path inside the object store bucket
    name / mime / size_bytes / kind
    scope         — "message" | "broadcast" | ...
    created_at
    deleted       — soft delete flag (storage has no delete API)
"""
from __future__ import annotations

from repositories.base import MongoRepository


class FileObjectsRepository(MongoRepository):
    collection_name = "file_objects"


files = FileObjectsRepository()
