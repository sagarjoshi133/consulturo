"""Generic Mongo-backed repository.

All documents use an application-level string id (`id` by default —
never Mongo's `_id`, which is always projected away). Subclasses set
`collection_name` (and optionally `id_field`) and add domain-specific
finders.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple


class MongoRepository:
    collection_name: str = ""
    id_field: str = "id"

    @property
    def col(self):
        # Late-bound so importing a repository never forces a DB
        # connection at module-import time (keeps tests + tooling fast).
        from db import db as _db
        return _db[self.collection_name]

    async def get(self, id_value: str) -> Optional[Dict[str, Any]]:
        return await self.col.find_one({self.id_field: id_value}, {"_id": 0})

    async def find(
        self,
        flt: Optional[Dict[str, Any]] = None,
        *,
        sort: Optional[List[Tuple[str, int]]] = None,
        limit: int = 100,
        projection: Optional[Dict[str, int]] = None,
    ) -> List[Dict[str, Any]]:
        proj = {"_id": 0, **(projection or {})}
        cur = self.col.find(flt or {}, proj)
        if sort:
            cur = cur.sort(sort)
        return await cur.to_list(length=limit)

    async def find_one(self, flt: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        return await self.col.find_one(flt, {"_id": 0})

    async def insert(self, doc: Dict[str, Any]) -> Dict[str, Any]:
        # Copy so the caller's dict is not mutated with Mongo's _id.
        await self.col.insert_one(dict(doc))
        return doc

    async def update(self, id_value: str, patch: Dict[str, Any]) -> int:
        res = await self.col.update_one({self.id_field: id_value}, {"$set": patch})
        return res.modified_count

    async def delete(self, id_value: str) -> int:
        res = await self.col.delete_one({self.id_field: id_value})
        return res.deleted_count

    async def count(self, flt: Optional[Dict[str, Any]] = None) -> int:
        return await self.col.count_documents(flt or {})
