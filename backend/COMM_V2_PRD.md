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
"""
