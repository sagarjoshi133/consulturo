"""Comm V2 push handler — registered with the durable outbox.

Event contract (payload):
    {
      "installation_ids": ["…"] OR "user_id": "…" (fan-out to all active),
      "category": "appointments" | "messages" | "reminders" | ...,
      "title": "generic lock-screen title",
      "body":  "generic lock-screen body (no clinical detail!)",
      "data":  { inbox_item_id? conversation_id? message_id? broadcast_id? ... }
    }

Handler behavior:
  - Resolves installation_ids (either explicit or via user_id).
  - Sends each via direct FCM v1 (services.comm_fcm).
  - Invalidates installations that return UNREGISTERED / INVALID_ARGUMENT.
  - Aggregates results: {ok: any(succeeded), detail: per-installation array}.
  - Returns ok=True if AT LEAST ONE recipient succeeded OR the payload was
    a no-op (no active installations left) — the outbox is not the place
    to retry indefinitely against a user with no working device.
"""
from __future__ import annotations

from typing import Any, Dict, List

from services import comm_fcm, comm_installations
from services import comm_outbox


async def _handle_push_send(row: Dict[str, Any]) -> Dict[str, Any]:
    """Outbox handler for event_type = 'push.send'."""
    from server import db as _db

    payload = row.get("payload") or {}
    category = str(payload.get("category") or "system")
    title = str(payload.get("title") or "ConsultUro")
    body = str(payload.get("body") or "You have a new update. Open the app to view it.")
    data = payload.get("data") or {}

    # Resolve target installations.
    inst_ids: List[str] = list(payload.get("installation_ids") or [])
    if not inst_ids and payload.get("user_id"):
        rows = await comm_installations.list_active_for_user(_db, payload["user_id"])
        inst_ids = [r["installation_id"] for r in rows]

    if not inst_ids:
        return {"ok": True, "detail": {"skipped": "no_active_installations"}}

    # Configuration check: if firebase_admin isn't set up, this is a
    # config failure — outbox retries won't fix it, so return ok=False
    # with a message. The outbox will backoff and eventually dead-letter,
    # which is fine (owner sees it in the admin panel).
    if not comm_fcm.is_configured():
        return {"ok": False, "detail": {"error": "fcm_not_configured",
                                          "reason": comm_fcm.last_init_error()}}

    results: List[Dict[str, Any]] = []
    any_ok = False
    for inst_id in inst_ids:
        tok = await comm_installations.get_token_for_send(_db, inst_id)
        if not tok or not tok.get("token"):
            results.append({"installation_id": inst_id, "ok": False,
                             "code": "no_active_token"})
            continue
        r = await comm_fcm.send_to_token(
            token=tok["token"],
            category=category,
            title=title,
            body=body,
            data={**data, "installation_id": inst_id},
        )
        results.append({"installation_id": inst_id, **r,
                         # scrub token from surface
                         "token_hash": tok.get("token_hash")})
        if r.get("ok"):
            any_ok = True
            continue
        # Permanent token error → invalidate the installation immediately.
        if r.get("category") == "invalidate":
            await comm_installations.invalidate_token_hash(
                _db, provider=tok.get("provider") or "fcm",
                token_hash_hex=tok.get("token_hash") or "",
                reason=str(r.get("code") or "invalidate"),
            )

    # If NOTHING succeeded, treat as transient failure so the outbox
    # retries with backoff — unless every result was "invalidate" (in
    # which case retrying is pointless).
    if any_ok:
        return {"ok": True, "detail": results}
    all_permanent = all(x.get("category") == "invalidate" or
                          x.get("code") == "no_active_token"
                          for x in results)
    if all_permanent:
        # Nothing to retry against — mark ok=True to prevent dead-letter
        # noise (delivery genuinely can't happen for these installations).
        return {"ok": True, "detail": {"all_permanent": True, "results": results}}
    return {"ok": False, "detail": results}


def register() -> None:
    comm_outbox.register_handler("push.send", _handle_push_send)
