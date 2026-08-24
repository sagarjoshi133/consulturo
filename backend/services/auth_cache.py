"""In-process TTL cache for session-token → user lookups.

WHY: every authenticated request runs get_current_user which used to do
2 sequential Atlas round-trips (user_sessions + users). On the deployed
K8s backend each round-trip to the managed Atlas cluster costs real
network latency, so the auth tax alone made every screen feel slow.
Caching the resolved user for a short TTL removes those round-trips for
every request after the first.

Staleness contract:
  • TTL is 30s — role/permission/suspension changes propagate within
    30s at worst.
  • Logout and account-deletion invalidate IMMEDIATELY (see
    routers/auth.py) so a revoked token can never outlive its session.
  • Profile edits invalidate the user's entries so /auth/me reflects
    the change instantly.
"""
import time
from typing import Any, Dict, Optional

_TTL_SECONDS = 30.0
_MAX_ENTRIES = 5000

# token -> (monotonic_expiry, user_doc)
_cache: Dict[str, tuple] = {}


def get(token: str) -> Optional[Dict[str, Any]]:
    entry = _cache.get(token)
    if not entry:
        return None
    expiry, user = entry
    if expiry < time.monotonic():
        _cache.pop(token, None)
        return None
    return user


def put(token: str, user: Dict[str, Any]) -> None:
    if len(_cache) >= _MAX_ENTRIES:
        # Cheap wholesale reset — refilling is 1 query per active token.
        _cache.clear()
    _cache[token] = (time.monotonic() + _TTL_SECONDS, user)


def invalidate_token(token: str) -> None:
    _cache.pop(token, None)


def invalidate_user(user_id: str) -> None:
    """Drop every cached session belonging to this user (role change,
    suspension, profile edit, account deletion)."""
    if not user_id:
        return
    stale = [t for t, (_, u) in _cache.items() if (u or {}).get("user_id") == user_id]
    for t in stale:
        _cache.pop(t, None)


def clear() -> None:
    _cache.clear()
