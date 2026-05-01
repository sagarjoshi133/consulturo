"""ConsultUro — push router.

  · /api/push/register
  · /api/push/diagnostics
  · /api/push/test

Extracted from server.py during Phase 3 modularization.
Behaviour preserved EXACTLY.
"""
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List
from fastapi import APIRouter, Depends, HTTPException
from db import db
from auth_deps import OWNER_TIER_ROLES, require_owner, require_user
from models import PushRegisterBody
from server import collect_user_tokens, create_notification, send_expo_push_batch

router = APIRouter()


@router.post("/api/push/register")
async def register_push_token(body: PushRegisterBody, user=Depends(require_user)):
    if not body.token or not (body.token.startswith("ExponentPushToken[") or body.token.startswith("ExpoPushToken[")):
        raise HTTPException(status_code=400, detail="Invalid Expo push token")
    now = datetime.now(timezone.utc)
    await db.push_tokens.update_one(
        {"token": body.token},
        {
            "$set": {
                "user_id": user["user_id"],
                "email": user.get("email"),
                "platform": body.platform,
                "device_name": body.device_name,
                "updated_at": now,
            },
            "$setOnInsert": {"created_at": now},
        },
        upsert=True,
    )

    # ── Proactive heal: re-stamp ANY orphaned tokens for this email ──
    # Some accounts have rows where user_id drifted (DB migration,
    # OAuth re-link, clinic switch) but the email is correct. Every
    # time the live app calls /push/register, we use the canonical
    # email of the authenticated user to repair stale rows in one
    # idempotent UPDATE. This guarantees that the very next call to
    # /push/test will find tokens via the fast user_id index path
    # without depending on the email-fallback in collect_user_tokens.
    try:
        email = user.get("email")
        if email:
            await db.push_tokens.update_many(
                {"email": email, "user_id": {"$ne": user["user_id"]}},
                {"$set": {"user_id": user["user_id"], "updated_at": now}},
            )
    except Exception:
        # Never fail a registration because of self-heal. The classic
        # fallback in collect_user_tokens still has us covered.
        pass

    return {"ok": True}

@router.delete("/api/push/register")
async def unregister_push_token(token: str = "", user=Depends(require_user)):
    if not token:
        raise HTTPException(status_code=400, detail="token query required")
    await db.push_tokens.delete_one({"token": token, "user_id": user["user_id"]})
    return {"ok": True}

@router.post("/api/push/heal")
async def force_heal_push_tokens(user=Depends(require_user)):
    """Aggressively re-bind every push_tokens row that relates to the
    caller's email (via any sibling user_id or via the email field
    itself, case-insensitive) onto the caller's canonical user_id.

    Use this when /push/test keeps returning `no_tokens` even though
    diagnostics show rows exist — typically after OAuth re-link or
    legacy seeds created duplicate user docs sharing the same email.

    Returns a JSON diagnostic report showing: total rows before,
    rows touched, total rows after matching canonical user_id."""
    import re as _re
    now = datetime.now(timezone.utc)
    canonical_uid = user["user_id"]
    email = (user.get("email") or "").strip()

    report: Dict[str, Any] = {
        "user_id": canonical_uid,
        "email": email,
        "before": {},
        "after": {},
        "healed_rows": 0,
    }

    # Find sibling user_ids sharing this email (case-insensitive)
    sibling_ids: List[str] = []
    if email:
        try:
            async for u in db.users.find(
                {"email": {"$regex": f"^{_re.escape(email)}$", "$options": "i"}},
                {"_id": 0, "user_id": 1},
            ):
                sibling_ids.append(u["user_id"])
        except Exception:
            pass
    if canonical_uid not in sibling_ids:
        sibling_ids.append(canonical_uid)
    report["sibling_user_ids"] = sibling_ids

    # Before snapshot
    try:
        report["before"]["by_user_id"] = await db.push_tokens.count_documents(
            {"user_id": canonical_uid}
        )
        report["before"]["by_sibling_ids"] = await db.push_tokens.count_documents(
            {"user_id": {"$in": sibling_ids}}
        )
        if email:
            report["before"]["by_email"] = await db.push_tokens.count_documents(
                {"email": {"$regex": f"^{_re.escape(email)}$", "$options": "i"}}
            )
    except Exception as e:
        report["before_error"] = str(e)

    # Aggressive heal: union of (sibling user_ids) ∪ (matching email)
    try:
        or_clauses: List[Dict[str, Any]] = [{"user_id": {"$in": sibling_ids}}]
        if email:
            or_clauses.append({
                "email": {"$regex": f"^{_re.escape(email)}$", "$options": "i"}
            })
        set_patch: Dict[str, Any] = {
            "user_id": canonical_uid,
            "updated_at": now,
        }
        if email:
            set_patch["email"] = email
        res = await db.push_tokens.update_many(
            {"$or": or_clauses}, {"$set": set_patch}
        )
        report["healed_rows"] = res.modified_count
    except Exception as e:
        report["heal_error"] = str(e)

    # After snapshot
    try:
        report["after"]["by_user_id"] = await db.push_tokens.count_documents(
            {"user_id": canonical_uid}
        )
    except Exception as e:
        report["after_error"] = str(e)

    report["ok"] = report["after"].get("by_user_id", 0) > 0
    return report

@router.get("/api/push/fcm-errors")
async def push_fcm_errors(limit: int = 20, user=Depends(require_owner)):
    """Surface the actual FCM/APNs rejection reasons from push_log.

    When 'sent: X / failed: Y' dashboard metrics show mass failures
    but the doctor can't see WHY (rows are in MongoDB, not in any
    log panel), this endpoint pulls the last N push attempts that
    had errors and de-duplicates them into a frequency map of
    Expo + FCM error codes:
      - DeviceNotRegistered : token invalid / app uninstalled
      - InvalidCredentials  : FCM v1 service account not uploaded
                              to EAS credentials, OR key rotated
      - MismatchSenderId    : google-services.json sender_id does
                              not match the FCM project bound to
                              this EAS project
      - MessageTooBig / MessageRateExceeded : Expo-side throttle

    Why this matters: no amount of backend code can fix an
    InvalidCredentials / MismatchSenderId. The user must upload the
    FCM service account JSON via `eas credentials` CLI. This
    endpoint's sole job is to prove that's the problem."""
    rows = await db.push_log.find(
        {"errors": {"$ne": []}},
        {"_id": 0, "id": 1, "title": 1, "data_type": 1,
         "total": 1, "sent": 1, "purged": 1, "errors": 1,
         "delivered": 1, "receipts": 1, "created_at": 1},
    ).sort("created_at", -1).to_list(length=max(1, min(limit, 200)))

    # Distil top-level error codes out of the heterogeneous error
    # shapes Expo / FCM return (string vs nested dict vs receipt).
    def _extract_codes(err_list: List[Any]) -> List[str]:
        out: List[str] = []
        for e in err_list or []:
            if not isinstance(e, dict):
                out.append(str(e)[:80])
                continue
            det = e.get("details") if isinstance(e.get("details"), dict) else {}
            code = det.get("error") or e.get("code") or e.get("error")
            if code:
                out.append(str(code))
        return out

    freq: Dict[str, int] = {}
    for r in rows:
        for code in _extract_codes(r.get("errors") or []):
            freq[code] = freq.get(code, 0) + 1
        rcpts = r.get("receipts") or {}
        for code in _extract_codes(rcpts.get("receipt_errors") or []):
            freq[code] = freq.get(code, 0) + 1

    # Plain-English guidance for the most common codes
    hints: Dict[str, str] = {
        "InvalidCredentials":
            "FCM service account is missing or expired on Expo. "
            "Run `eas credentials --platform android` and upload a "
            "Google Service Account JSON downloaded from Firebase "
            "Console > Project > Service Accounts > Generate Key.",
        "MismatchSenderId":
            "google-services.json sender_id does not match the FCM "
            "credentials bound to this EAS project. Re-download "
            "google-services.json from Firebase Console and rebuild "
            "the APK.",
        "DeviceNotRegistered":
            "Token is invalid — app uninstalled, storage cleared, or "
            "project mismatch. Re-register on a fresh install.",
        "MessageRateExceeded":
            "Slow down: Expo throttled recent sends. Back off for a "
            "few minutes and retry.",
        "MessageTooBig":
            "Push payload exceeds 4 KB (FCM limit). Trim title/body.",
    }

    return {
        "count": len(rows),
        "error_frequencies": freq,
        "primary_guidance": [
            {"code": c, "count": freq[c], "fix": hints.get(c, "Check Expo docs for this code.")}
            for c in sorted(freq, key=lambda k: -freq[k])[:5]
        ],
        "recent": rows[:10],
    }

@router.get("/api/push/diagnostics")
async def push_diagnostics(user=Depends(require_owner)):
    """Snapshot of the push-notification health for the clinic.
    Returns: per-user token counts, last-24h send stats, and the last
    20 push attempts with errors so the admin can pinpoint silent
    failures without reading Mongo."""
    now = datetime.now(timezone.utc)
    last_24h = now - timedelta(hours=24)

    # --- users + token counts ---
    tokens_per_user: List[Dict[str, Any]] = []
    user_rows = await db.users.find(
        {"$or": [
            {"role": {"$in": list(OWNER_TIER_ROLES)}},
            {"can_approve_bookings": True},
        ]},
        {"_id": 0, "user_id": 1, "email": 1, "name": 1, "role": 1},
    ).to_list(length=200)
    for u in user_rows:
        toks = await db.push_tokens.find({"user_id": u["user_id"]}, {"_id": 0}).to_list(length=20)
        tokens_per_user.append({
            "user_id": u["user_id"],
            "email": u.get("email"),
            "name": u.get("name"),
            "role": u.get("role"),
            "token_count": len(toks),
            "tokens": [
                {
                    "platform": t.get("platform"),
                    "device_name": t.get("device_name"),
                    "created_at": t.get("created_at"),
                    "updated_at": t.get("updated_at"),
                    "token_preview": (t.get("token") or "")[:30] + "…",
                }
                for t in toks
            ],
        })

    # --- aggregates ---
    total_tokens = await db.push_tokens.count_documents({})
    sends_24h = await db.push_log.count_documents({"created_at": {"$gte": last_24h}})
    successes_24h = 0
    failures_24h = 0
    async for row in db.push_log.find(
        {"created_at": {"$gte": last_24h}}, {"_id": 0, "sent": 1, "errors": 1, "total": 1}
    ):
        sent = row.get("sent") or 0
        total = row.get("total") or 0
        successes_24h += sent
        failures_24h += max(0, total - sent)

    # --- last 20 send attempts ---
    recent: List[Dict[str, Any]] = []
    async for row in db.push_log.find({}).sort("created_at", -1).limit(20):
        row.pop("_id", None)
        recent.append(row)

    return {
        "total_tokens": total_tokens,
        "sends_last_24h": sends_24h,
        "successes_last_24h": successes_24h,
        "failures_last_24h": failures_24h,
        "users": tokens_per_user,
        "recent": recent,
    }

@router.post("/api/push/test")
async def push_self_test(user=Depends(require_user)):
    """Fire a test push to the calling user's devices, then wait ~22 s
    to poll Expo's receipts endpoint so the caller gets BOTH the send
    outcome AND the actual FCM/APNs delivery outcome in one response.

    This is the fastest way to diagnose why pushes aren't reaching a
    device — it bypasses Mongo inspection entirely and surfaces FCM
    errors (MismatchSenderId, InvalidCredentials, DeviceNotRegistered,
    …) in the response body.

    NOTE: collect_user_tokens auto-heals orphaned-by-stale-user_id
    tokens via an email fallback, so /push/test "just works" even
    if a DB migration drifted the user_id."""
    import asyncio as _asyncio

    tokens = await collect_user_tokens([user["user_id"]])
    if not tokens:
        # ── Rich diagnostics when no tokens resolved ─────────────────
        # Surface the raw DB state so the admin can understand WHY.
        # Shows: total rows in push_tokens, rows matching current
        # user_id, rows matching current email, all sibling user_ids
        # that share this email, and a sample of orphaned rows.
        diag: Dict[str, Any] = {}
        try:
            email = user.get("email")
            diag["user_id"] = user["user_id"]
            diag["email"] = email
            diag["by_user_id"] = await db.push_tokens.count_documents(
                {"user_id": user["user_id"]}
            )
            if email:
                diag["by_email"] = await db.push_tokens.count_documents(
                    {"email": {"$regex": f"^{email}$", "$options": "i"}}
                )
                sibling_ids = [
                    u["user_id"] async for u in db.users.find(
                        {"email": {"$regex": f"^{email}$", "$options": "i"}},
                        {"_id": 0, "user_id": 1},
                    )
                ]
                diag["sibling_user_ids"] = sibling_ids
                diag["by_sibling_user_ids"] = await db.push_tokens.count_documents(
                    {"user_id": {"$in": sibling_ids}}
                ) if sibling_ids else 0
            diag["total_rows"] = await db.push_tokens.count_documents({})
            sample = await db.push_tokens.find(
                {}, {"_id": 0, "user_id": 1, "email": 1, "platform": 1}
            ).to_list(length=5)
            diag["sample_rows"] = sample
        except Exception as e:
            diag["diag_error"] = str(e)
        return {
            "ok": False,
            "reason": "no_tokens",
            "message": "No push tokens registered for this account. Grant notification permission in the app and restart.",
            "tokens_found": 0,
            "diagnostics": diag,
        }
    result = await send_expo_push_batch(
        tokens,
        "🔔 Test notification",
        "If you see this, push notifications are working!",
        {"type": "self_test", "user_id": user["user_id"]},
    )
    # Also drop an in-app note so it's visible in the bell
    try:
        await create_notification(
            user_id=user["user_id"],
            title="🔔 Test notification",
            body="If you see this, push notifications are working!",
            kind="self_test",
            data={"type": "self_test"},
            push=False,  # push already fired above
        )
    except Exception:
        pass

    # ── Poll receipts so the response includes the FCM outcome ───────
    # send_expo_push_batch already kicked off the background poller,
    # but we also wait briefly here and read the receipts ourselves so
    # the response body can tell the doctor EXACTLY why a push didn't
    # arrive. Budget: ≤25 s total (route keeps within the 30 s
    # ingress timeout).
    receipts_result: Dict[str, Any] = {"polled": False}
    ticket_ids = result.get("ticket_ids") or []
    if ticket_ids:
        try:
            import httpx  # local import, httpx already a dep

            await _asyncio.sleep(10)  # initial wait — most receipts ready by now
            delivered = 0
            receipt_errors: List[Dict[str, Any]] = []
            pending = list(ticket_ids)
            # Up to 3 short polls (10 s + 7 s + 6 s) to catch slow FCM
            # responses, bail early as soon as all receipts arrive.
            for delay in (7, 6):
                if not pending:
                    break
                async with httpx.AsyncClient(timeout=12.0) as hc:
                    resp = await hc.post(
                        "https://exp.host/--/api/v2/push/getReceipts",
                        json={"ids": pending},
                        headers={"Content-Type": "application/json"},
                    )
                try:
                    rdata = resp.json() or {}
                except Exception:
                    rdata = {}
                r_block = rdata.get("data") or {}
                still_pending: List[str] = []
                for tid in pending:
                    r = r_block.get(tid) if isinstance(r_block, dict) else None
                    if r is None:
                        still_pending.append(tid)
                        continue
                    if isinstance(r, dict) and r.get("status") == "ok":
                        delivered += 1
                    elif isinstance(r, dict):
                        d = r.get("details") or {}
                        receipt_errors.append({
                            "error": d.get("error") if isinstance(d, dict) else None,
                            "message": r.get("message"),
                            "details": d,
                        })
                pending = still_pending
                if not pending:
                    break
                await _asyncio.sleep(delay)

            receipts_result = {
                "polled": True,
                "delivered": delivered,
                "pending": len(pending),
                "receipt_errors": receipt_errors[:10],
            }
        except Exception as e:
            receipts_result = {"polled": False, "error": str(e)[:300]}

    return {
        "ok": (result.get("sent") or 0) > 0,
        "tokens_found": len(tokens),
        "sent": result.get("sent"),
        "errors": result.get("errors"),
        "purged": result.get("purged"),
        "ticket_ids": ticket_ids,
        "receipts": receipts_result,
    }
