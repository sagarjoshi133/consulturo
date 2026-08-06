"""ConsultUro — auth helpers + FastAPI dependencies.

Centralises every `require_*` dependency and every `is_*` role
check so router modules can import from a single place without
pulling in the entire server.py monolith.

NOTE: The CANONICAL definitions still live in server.py for
backward compatibility — this module re-imports them lazily so
both `from server import require_owner` and `from auth_deps import
require_owner` work and resolve to the SAME function object.

This indirection lets us extract routers in a later phase without
risking import cycles or duplicated definitions.
"""
from typing import Dict, Any

# Re-export role constants so router modules don't have to know
# about server.py at all. (Constants are tiny — duplicating them
# here is safer than a lazy import for hot-path role checks.)
OWNER_TIER_ROLES = {"super_owner", "primary_owner", "owner", "partner"}
PRIMARY_TIER_ROLES = {"super_owner", "primary_owner", "owner"}
STAFF_ROLES = [
    "super_owner",
    "primary_owner",
    "owner",
    "partner",
    "doctor",
    "assistant",
    "reception",
    "nursing",
]
VALID_ROLES = STAFF_ROLES + ["patient"]


def is_owner_or_partner(user: Dict[str, Any]) -> bool:
    """True for every role with full clinic-admin powers
    (super_owner / primary_owner / partner; legacy `owner` accepted)."""
    return (user or {}).get("role") in OWNER_TIER_ROLES


def is_primary_or_super(user: Dict[str, Any]) -> bool:
    """True only for primary_owner / super_owner (NOT partner)."""
    return (user or {}).get("role") in PRIMARY_TIER_ROLES


def is_super_owner(user: Dict[str, Any]) -> bool:
    """True only for the platform-level super owner."""
    return (user or {}).get("role") == "super_owner"


# Lazy re-exports — resolved on first attribute access. Keeps server.py
# as the single source of truth for the runtime FastAPI dependencies
# while still allowing `from auth_deps import require_owner` in new
# router modules.
def __getattr__(name: str):
    if name in {
        "get_current_user",
        "require_user",
        "require_staff",
        "require_owner",
        "require_primary_owner",
        "require_primary_owner_strict",
        "require_super_owner",
        "require_full_dashboard_access",
        "require_doctor_or_full_access",
        "require_prescriber",
        "require_can_manage_surgeries",
        "require_can_manage_availability",
        "require_blog_writer",
        "is_prescriber",
    }:
        import server  # late import — server.py defines these
        return getattr(server, name)
    raise AttributeError(name)
