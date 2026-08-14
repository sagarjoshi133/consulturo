"""Repository for the canonical `patients` registry (Phase D).

Keyed by `patient_id` (UUID). Merged duplicates keep their row but
carry `merged_into: <patient_id>` and are excluded from search."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from repositories.base import MongoRepository


class PatientsRepository(MongoRepository):
    collection_name = "patients"
    id_field = "patient_id"

    async def search(self, flt: Dict[str, Any], *, limit: int = 50, skip: int = 0) -> List[Dict[str, Any]]:
        q = {**flt, "merged_into": {"$exists": False}}
        cur = self.col.find(q, {"_id": 0}).sort("first_seen_at", -1).skip(skip).limit(limit)
        return await cur.to_list(length=limit)

    async def get_active(self, patient_id: str) -> Optional[Dict[str, Any]]:
        """Resolve a patient_id, following one merge hop."""
        row = await self.get(patient_id)
        if row and row.get("merged_into"):
            row = await self.get(row["merged_into"]) or row
        return row


patients = PatientsRepository()
