"""ConsultUro routers — domain-specific FastAPI APIRouter modules.

Each file in this package owns the routes for one logical domain
(diseases, bookings, prescriptions, etc.). server.py registers them
all via app.include_router() during startup.

Phase 2 of the modularization plan — Phase 1 already extracted
models / db / auth_deps. URL paths, dependencies, and payloads are
preserved EXACTLY. No behaviour change.
"""
