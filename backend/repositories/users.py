"""Repository for `users` (keyed by user_id)."""
from __future__ import annotations

from typing import Any, Dict, Optional

from repositories.base import MongoRepository


class UsersRepository(MongoRepository):
    collection_name = "users"
    id_field = "user_id"

    async def get_by_email(self, email: str) -> Optional[Dict[str, Any]]:
        return await self.find_one({"email": (email or "").lower()})


users = UsersRepository()
