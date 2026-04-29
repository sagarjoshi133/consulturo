"""ConsultUro — notes router.

  · /api/notes
  · /api/notes/labels
  · /api/notes/{note_id}

Extracted from server.py during Phase 3 modularization.
Behaviour preserved EXACTLY.
"""
from datetime import datetime, timezone
import uuid
from fastapi import APIRouter, Depends, HTTPException
from db import db
from auth_deps import require_user
from models import NoteBody
from server import _clean_labels, _parse_reminder

router = APIRouter()


@router.get("/api/notes")
async def notes_list(user=Depends(require_user)):
    cursor = db.notes.find(
        {"user_id": user["user_id"]}, {"_id": 0}
    ).sort("updated_at", -1)
    return await cursor.to_list(length=500)

@router.get("/api/notes/labels")
async def notes_labels(user=Depends(require_user)):
    """Return distinct labels the current user has used across notes, with
    usage counts, sorted by frequency desc. Used by the editor to power
    autocomplete / recent-chip suggestions."""
    pipeline = [
        {"$match": {"user_id": user["user_id"]}},
        {"$unwind": "$labels"},
        {"$match": {"labels": {"$nin": [None, ""]}}},
        {"$group": {"_id": {"$toLower": "$labels"}, "label": {"$first": "$labels"}, "count": {"$sum": 1}}},
        {"$sort": {"count": -1, "label": 1}},
        {"$limit": 50},
        {"$project": {"_id": 0, "label": 1, "count": 1}},
    ]
    rows = await db.notes.aggregate(pipeline).to_list(length=50)
    return rows

@router.post("/api/notes")
async def notes_create(body: NoteBody, user=Depends(require_user)):
    text = (body.body or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Note body is required")
    now = datetime.now(timezone.utc)
    doc = {
        "note_id": f"note_{uuid.uuid4().hex[:10]}",
        "user_id": user["user_id"],
        "title": (body.title or "").strip()[:120],
        "body": text[:20000],
        "reminder_at": _parse_reminder(body.reminder_at),
        "reminder_fired": False,
        "labels": _clean_labels(body.labels),
        "created_at": now,
        "updated_at": now,
    }
    await db.notes.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc

@router.patch("/api/notes/{note_id}")
async def notes_update(note_id: str, body: NoteBody, user=Depends(require_user)):
    text = (body.body or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Note body is required")
    existing = await db.notes.find_one({"note_id": note_id, "user_id": user["user_id"]})
    if not existing:
        raise HTTPException(status_code=404, detail="Note not found")
    new_reminder = _parse_reminder(body.reminder_at)
    updates = {
        "title": (body.title or "").strip()[:120],
        "body": text[:20000],
        "reminder_at": new_reminder,
        "labels": _clean_labels(body.labels),
        "updated_at": datetime.now(timezone.utc),
    }
    # If user re-set the reminder to a future date, reset the "fired" flag
    # so it can alert again.
    if new_reminder and new_reminder > datetime.now(timezone.utc):
        updates["reminder_fired"] = False
    await db.notes.update_one({"note_id": note_id}, {"$set": updates})
    doc = await db.notes.find_one({"note_id": note_id}, {"_id": 0})
    return doc

@router.delete("/api/notes/{note_id}")
async def notes_delete(note_id: str, user=Depends(require_user)):
    res = await db.notes.delete_one({"note_id": note_id, "user_id": user["user_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Note not found")
    return {"ok": True, "deleted": note_id}
