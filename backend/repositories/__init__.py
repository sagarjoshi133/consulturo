"""ConsultUro 2.0 — Phase C: repository layer (Mongo-first).

Isolates every direct MongoDB call behind a thin repository API so a
future engine swap (PostgreSQL, per the 2.0 blueprint) only has to
re-implement this package — routers and services stay untouched.

Convention for new Phase C+ code: talk to collections through a
repository, never `db.<collection>` directly. Legacy code migrates
opportunistically.
"""
from repositories.base import MongoRepository
from repositories.files import FileObjectsRepository, files
from repositories.patients import PatientsRepository, patients
from repositories.users import UsersRepository, users

__all__ = [
    "MongoRepository",
    "FileObjectsRepository", "files",
    "PatientsRepository", "patients",
    "UsersRepository", "users",
]
