"""PRD — ConsultUro Communications V2 (Comm-1 foundation).

This file captures the running spec / state for the Comm V2 rebuild.
Each phase updates this doc with what shipped, what's flagged off,
what remains, and rollback steps.

Read first before touching any comm_* code.

================================================================
COMM-0 (SHIPPED) — Backup-server flap fix
================================================================
Symptom: "Connected to backup server" banner appeared repeatedly
in production. Root cause: feature endpoints (`/api/register-push`,
`/api/ai/*`, `/api/razorpay/*`, ...) legitimately returned 502/503
when their upstream (Emergent push relay, LLM, Razorpay) was
unconfigured. The frontend's DR-failover interceptor treated ANY
5xx as "primary origin down" and stuck the whole session on the
preview backup for the rest of the process.

Fix (two-sided):
  • Backend `routers/push_register.py`: HTTP is now ALWAYS 200 for
    a registration that reached the API. The body carries the
    truth: {registered:false, error_code, mirrored:true,
    degraded:true}. The Notifications Health panel already reads
    this shape and will continue to display accurate status.
  • Frontend `src/api.ts`: the DR-failover interceptor now only
    fires on an ALLOWLIST of true-infra paths (/health, /me,
    /auth/session|refresh|logout, /version). Feature-endpoint 5xx
    responses propagate to the caller unchanged and NEVER flip
    the session onto the backup URL.

Rollback: revert those two files.

================================================================
COMM-1 (SHIPPED) — Foundation
================================================================
Added collections (indexes only, no data):
  comm_installations, comm_notification_preferences,
  comm_inbox_items, comm_conversations,
  comm_conversation_participants, comm_messages,
  comm_message_receipts, comm_attachments,
  comm_broadcasts, comm_broadcast_recipients,
  comm_home_notices, comm_home_notice_dismissals,
  comm_outbox, comm_delivery_attempts, comm_dead_letters,
  comm_audit_log, comm_migration_map, comm_flags.

Durable Mongo outbox:
  • `services/comm_outbox.py`.
  • States: pending / processing / retry_wait / completed / dead_letter.
  • Atomic `find_one_and_update` leasing → two workers on two
    replicas cannot claim the same row.
  • Exponential backoff + jitter, MAX_ATTEMPTS=8.
  • Restart-safe: expired leases become processable again
    automatically (filter matches locked_until ≤ now).
  • Dead-letter mirror in `comm_dead_letters` + retry API.
  • Per-attempt trace in `comm_delivery_attempts`.

Feature flags (env-driven defaults; DB overrides via API):
  COMMUNICATIONS_V2_ENABLED               (default false)
  COMMUNICATIONS_V2_CANARY_USER_IDS       (CSV, default empty)
  COMMUNICATIONS_V2_MIRROR_LEGACY         (default true)
  COMMUNICATIONS_V2_PUSH_ENABLED          (default false)
  COMMUNICATIONS_V2_MESSAGES_ENABLED      (default false)
  COMMUNICATIONS_V2_BROADCASTS_ENABLED    (default false)
  COMMUNICATIONS_V2_HOME_NOTICES_ENABLED  (default false)
  COMMUNICATIONS_V2_LEGACY_RUNTIME_DISABLED (default false)
  COMMUNICATIONS_V2_ATTACHMENTS_ENABLED   (default false)

Admin endpoints (owner-tier only):
  GET  /api/v2/communications/admin/health
  GET  /api/v2/communications/admin/flags
  POST /api/v2/communications/admin/flags
  GET  /api/v2/communications/admin/outbox/stats
  POST /api/v2/communications/admin/outbox/drain
  GET  /api/v2/communications/admin/outbox/events?status=
  GET  /api/v2/communications/admin/outbox/dead-letters
  POST /api/v2/communications/admin/outbox/dead-letters/retry

Audit trail: `services/comm_audit.py` → `comm_audit_log` collection.
Fire-and-forget; never crashes business paths.

Rollback: comment out the two lines added to server.py (the
Comm V2 import block + the migration/worker calls inside
`_notification_v2_boot._run`). Indexes are safe to leave; empty
collections cost nothing.

================================================================
COMM-2 (PENDING) — Direct FCM v1 Push
================================================================
Blocked on: FIREBASE_SERVICE_ACCOUNT_JSON from user.
Plan: firebase-admin (or raw HTTP v1) using service-account creds
from env; `getDevicePushTokenAsync` on client; new channel IDs
(consulturo_appointments_v2, _messages_v2, _reminders_v2,
_announcements_v2, _system_v2); private lock-screen visibility;
generic push bodies for clinical events; installation registration
endpoint (POST /api/v2/communications/installations/register)
storing platform / native token / permission / app version /
build / runtime / device model / locale / timezone. Emergent
relay retained only behind a rollback flag.

================================================================
COMM-3 → COMM-9 — See README block at top of routers/comm_v2_admin.py
================================================================

================================================================
COMM-8 (SHIPPED) — Migration & Reconciliation
================================================================
Idempotent backfills of the entire legacy comms footprint into V2
collections, plus a non-invasive reconciliation report.

Backfills (all run once per boot, gated by _status markers in
comm_migration_map):
  • migrations/comm_v2_inbox_backfill.py (Comm-3, already shipped)
    notifications          → comm_inbox_items
    Skips kind ∈ {personal, personal_message} — those are messaging.
  • migrations/comm_v2_messaging_backfill.py
    notifications(kind=personal|personal_message) →
      comm_conversations + comm_messages + comm_message_receipts.
    Only patient↔staff pairs migrate. Staff↔staff and patient↔patient
    are out of V2's "one conversation per patient" model and are left
    legacy-only.
    Idempotency-key = "{sender_uid}:legacy:{notification_id}" so we
    never double-insert on force re-runs.
  • migrations/comm_v2_broadcasts_backfill.py
    broadcasts        → comm_broadcasts
       status sent  → state completed
       status approved / pending_approval / rejected → same state
       target all/patients/staff → audience_mode both/patients/staff
    broadcast_inbox   → comm_broadcast_recipients
       delivery_status = 'provider_accepted' (legacy inbox rows were
       only written AFTER send).
    All migrated rows carry migrated_from_legacy:true.

Reconciliation:
  services/comm_reconciliation.py.build_report(db) returns:
    {
      "ok": bool (all four domains ok),
      "notifications_inbox": {legacy_total, legacy_migratable,
                                v2_total_from_legacy, missing_sample[],
                                delta, ok},
      "messages": {legacy_personal_total, v2_migrated_messages,
                    v2_conversations, mapped_rows,
                    delta_mapped_vs_v2, ok},
      "broadcasts": {legacy_total, legacy_by_status, v2_total,
                      v2_from_legacy, v2_by_state_from_legacy,
                      mapped_rows, delta_legacy_vs_v2, ok},
      "broadcast_recipients": {legacy_total, v2_total,
                                 v2_from_legacy, mapped_rows,
                                 delta_legacy_vs_v2, ok},
    }

Admin endpoints (owner-tier only):
  POST /api/v2/communications/admin/migrations/run
       body: {scope: "all"|"notifications"|"messages"|"broadcasts",
              force: bool}
  GET  /api/v2/communications/admin/migrations/status
       → {markers: {notifications_backfilled: {count, completed_at},
                     messages_backfilled: {...},
                     broadcasts_backfilled: {...}}}
  GET  /api/v2/communications/admin/reconciliation/report
       → full reconciliation report (as above).

Boot wiring: server.py `_notification_v2_boot` runs the three
backfills sequentially after the Comm-1 index migration. Each bails
out fast if its _status marker already exists.

Smoke test: tests/smoke_comm8_migration.py — seeds a synthetic
legacy corpus, runs each backfill twice, asserts idempotency, then
verifies the reconciliation report structure. Cleans up its own
rows on exit. PASSING as of shipping.

Rollback: comment out the three try/except blocks in server.py
that call `run_messaging_backfill` and `run_broadcasts_backfill`
(and the existing `run_notifications_backfill`). All V2 collections
retain the `migrated_from_legacy:true` flag so a targeted
`db.comm_*.delete_many({migrated_from_legacy: true})` cleanly
reverses the migration without touching real V2 data.

================================================================
COMM-9 (SHIPPED) — Cutover
================================================================
Cutover flags flipped GLOBALLY (env defaults + persisted DB
overrides via `POST /api/v2/communications/admin/cutover/apply`):
  COMMUNICATIONS_V2_ENABLED               = true
  COMMUNICATIONS_V2_PUSH_ENABLED          = true
  COMMUNICATIONS_V2_MESSAGES_ENABLED      = true
  COMMUNICATIONS_V2_BROADCASTS_ENABLED    = true
  COMMUNICATIONS_V2_HOME_NOTICES_ENABLED  = true
  COMMUNICATIONS_V2_MIRROR_LEGACY         = true   (safety dual-write)
  COMMUNICATIONS_V2_LEGACY_RUNTIME_DISABLED = true (cutover sentinel)

New helpers (services/comm_cutover.py):
  * `legacy_writes_disabled(db)` — true when cutover is active. Used
    by legacy write endpoints to short-circuit to 410 Gone.
  * `legacy_push_disabled(db)` — true when V2 owns the push channel.
    `services.notifications.create_notification` calls this and
    prefers `enqueue_v2_push` → direct FCM v1 outbox over the
    legacy Emergent-relay path.
  * `enqueue_v2_push(db, ...)` — thin wrapper over `comm_outbox.enqueue`
    for `event_type=push.send` with a `via:v2_cutover` marker in data.
  * `cutover_gone_response(pointer)` — standard 410 body.

Retired legacy write endpoints (return 410 Gone when cutover is on;
still 200 while flag is off — safe rollback):
  POST  /api/broadcasts             → V2: /v2/communications/broadcasts/draft
  PATCH /api/broadcasts/{bid}       → V2: /v2/communications/broadcasts/{id}/approve|reject|schedule
  POST  /api/messages/send          → V2: /v2/communications/conversations/{id}/messages

Legacy READ endpoints are UNCHANGED (historical data still readable;
mirror_legacy=true keeps `comm_inbox_items` populated in parallel).

Admin endpoints:
  POST /api/v2/communications/admin/cutover/apply
       → flip all cutover flags on (idempotent).
  POST /api/v2/communications/admin/cutover/rollback
       → revert to safe legacy-only state (mirror stays on).
  GET  /api/v2/communications/admin/cutover/status
       → {state, flags, recent_actions[]} where state ∈ {cutover_active,
         mixed, canary_only, legacy_only}.

Boot verification: the app now boots with `state=cutover_active`,
430+ routes, all three backfills already-applied (idempotent skip),
outbox worker healthy, direct FCM v1 ready.

Smoke test: `tests/smoke_comm9_cutover.py` — flip flags on/off,
verify gate helpers, verify V2 outbox row is created with the
`via:v2_cutover` marker. PASSING.

Rollback path:
  1. `POST /api/v2/communications/admin/cutover/rollback` (instant,
      persisted in db.comm_flags).
  2. OR edit `.env` and set all `COMMUNICATIONS_V2_*_ENABLED=false`
      plus `COMMUNICATIONS_V2_LEGACY_RUNTIME_DISABLED=false`, restart.
  3. Legacy write endpoints resume returning 200; V2 code paths
      become dormant but retain data.
"""
