"""End-to-end Broadcast pipeline test against http://localhost:8001/api.

Covers the steps in the review request:
1. POST /api/broadcasts (owner) — create broadcast.
2. POST /api/broadcasts/{id}/approve OR PATCH /api/broadcasts/{id} with
   action=approve — approve & send.
3. GET /api/broadcasts — verify it's listed.
4. Inspect single-broadcast / delivery counts (sent_count, push token
   targeting).
5. GET /api/notifications (owner) — verify in-app notification record was
   created for the broadcast.
6. Cleanup: DELETE the test broadcast (only valid before "sent" — after
   send we delete via mongosh as last resort).
"""
import os
import json
import time
import uuid
import requests
import subprocess

BASE = "http://localhost:8001/api"
OWNER_TOKEN = "test_session_1776770314741"
HDR = {"Authorization": f"Bearer {OWNER_TOKEN}", "Content-Type": "application/json"}

PASS = []
FAIL = []


def check(name, cond, detail=""):
    if cond:
        PASS.append(name)
        print(f"  ✅ {name}")
    else:
        FAIL.append(f"{name} :: {detail}")
        print(f"  ❌ {name} :: {detail}")


def jdump(obj):
    try:
        return json.dumps(obj, default=str, indent=2)[:1500]
    except Exception:
        return str(obj)[:1500]


print("=" * 70)
print("BROADCAST PIPELINE END-TO-END TEST")
print("=" * 70)

# Pre-flight
r = requests.get(f"{BASE}/health", timeout=10)
check("Health endpoint reachable", r.status_code == 200, f"got {r.status_code}")

r = requests.get(f"{BASE}/auth/me", headers=HDR, timeout=10)
check("Owner auth", r.status_code == 200 and r.json().get("role") == "owner",
      f"status={r.status_code} body={r.text[:200]}")
owner_id = r.json().get("user_id")
print(f"  owner_id = {owner_id}")

# ----------------------------------------------------------------
# STEP 1 — Create broadcast
# ----------------------------------------------------------------
print("\n[STEP 1] POST /api/broadcasts")
unique = uuid.uuid4().hex[:8]
title = f"Test Broadcast {unique}"
body_text = f"This is a test (run {unique})"

# Note: server expects `target`, not `audience`, but we send both to honor
# the review request wording. Pydantic ignores unknown keys by default.
payload = {
    "title": title,
    "body": body_text,
    "target": "all",
    "audience": "all",  # alias used in review request — server ignores
}

r = requests.post(f"{BASE}/broadcasts", headers=HDR, json=payload, timeout=15)
print(f"  status={r.status_code}  body={r.text[:300]}")
check("POST /api/broadcasts returns 200", r.status_code == 200,
      f"status={r.status_code} body={r.text[:300]}")

bid = None
created = {}
if r.status_code == 200:
    created = r.json()
    bid = created.get("broadcast_id")
    check("Response has broadcast_id (bc_*)",
          bid and isinstance(bid, str) and bid.startswith("bc_"),
          f"broadcast_id={bid}")
    check("Response has title echoed", created.get("title") == title,
          f"title={created.get('title')}")
    check("Response has body echoed", created.get("body") == body_text,
          f"body={created.get('body')}")
    # Per server.py:4904, owner is an approver so status is auto-"approved",
    # NOT "pending". The review request spec said expect "pending" but the
    # server explicitly auto-approves owner-created broadcasts (still
    # require explicit approve to actually SEND). Capture both cases:
    status_after_create = created.get("status")
    print(f"  initial status = {status_after_create}")
    check("Status is one of {pending_approval, approved} (review said 'pending')",
          status_after_create in ("pending_approval", "approved"),
          f"status={status_after_create}")
    if status_after_create != "pending_approval":
        print(f"  NOTE: review request expected status='pending' but server "
              f"returned '{status_after_create}' because owner is an auto-"
              f"approver (server.py:4904). Broadcast still requires explicit "
              f"approve to actually fan out push/inbox.")

print(f"  bid = {bid}")

# ----------------------------------------------------------------
# STEP 2 — Approve broadcast
# ----------------------------------------------------------------
print("\n[STEP 2] Approve broadcast")
# First try POST /approve (the path in the review request)
approve_url_post = f"{BASE}/broadcasts/{bid}/approve"
r_post = requests.post(approve_url_post, headers=HDR, json={}, timeout=15)
print(f"  POST {approve_url_post}  -> {r_post.status_code}  {r_post.text[:200]}")
post_approve_works = r_post.status_code == 200
check("POST /api/broadcasts/{id}/approve exists & returns 200 (review-spec path)",
      post_approve_works,
      f"status={r_post.status_code} body={r_post.text[:200]}")

if not post_approve_works:
    print("  Falling back to PATCH /api/broadcasts/{id} with action=approve "
          "(actual server endpoint, server.py:4970)")
    r_patch = requests.patch(
        f"{BASE}/broadcasts/{bid}",
        headers=HDR,
        json={"action": "approve"},
        timeout=15,
    )
    print(f"  PATCH /api/broadcasts/{bid} (action=approve) -> {r_patch.status_code}  {r_patch.text[:300]}")
    check("PATCH /api/broadcasts/{id} (action=approve) returns 200",
          r_patch.status_code == 200,
          f"status={r_patch.status_code} body={r_patch.text[:300]}")
    approved = r_patch.json() if r_patch.status_code == 200 else {}
else:
    approved = r_post.json()

check("After approval, status is 'sent'",
      approved.get("status") == "sent",
      f"status={approved.get('status')}")
check("After approval, sent_at is set",
      bool(approved.get("sent_at")),
      f"sent_at={approved.get('sent_at')}")
print(f"  sent_count = {approved.get('sent_count')}")
print(f"  sent_at    = {approved.get('sent_at')}")

# ----------------------------------------------------------------
# STEP 3 — GET /api/broadcasts list
# ----------------------------------------------------------------
print("\n[STEP 3] GET /api/broadcasts (list)")
r = requests.get(f"{BASE}/broadcasts", headers=HDR, timeout=10)
check("GET /api/broadcasts returns 200", r.status_code == 200,
      f"status={r.status_code}")
listing = r.json() if r.status_code == 200 else []
check("List contains the just-sent broadcast",
      any(it.get("broadcast_id") == bid for it in listing),
      f"bid={bid} not in {[it.get('broadcast_id') for it in listing[:5]]}")
match = next((it for it in listing if it.get("broadcast_id") == bid), None)
if match:
    check("Listed broadcast has status=sent", match.get("status") == "sent",
          f"status={match.get('status')}")
    print(f"  found: status={match.get('status')} sent_count={match.get('sent_count')}")

# ----------------------------------------------------------------
# STEP 4 — Single-broadcast endpoint / delivery counts
# ----------------------------------------------------------------
print("\n[STEP 4] Single-broadcast endpoint & delivery counts")
r = requests.get(f"{BASE}/broadcasts/{bid}", headers=HDR, timeout=10)
print(f"  GET /api/broadcasts/{bid} -> {r.status_code}  {r.text[:200]}")
single_endpoint_exists = r.status_code == 200
if not single_endpoint_exists:
    print(f"  NOTE: GET /api/broadcasts/{{id}} not implemented (status={r.status_code}). "
          f"Delivery counts only via list endpoint.")

# Inspect counts via the listed match
sent_count = (match or {}).get("sent_count", 0)
print(f"  sent_count from list = {sent_count}")

# Check push tokens — collect_role_tokens uses db.push_tokens. There may be 0
# real devices; that is acceptable per spec.
inbox_url = f"{BASE}/broadcasts/inbox"
r = requests.get(inbox_url, headers=HDR, timeout=10)
print(f"  GET /api/broadcasts/inbox -> {r.status_code}")
if r.status_code == 200:
    inbox = r.json()
    inbox_items = inbox.get("items", [])
    in_inbox = [it for it in inbox_items if it.get("broadcast_id") == bid]
    check("Owner has the broadcast in /api/broadcasts/inbox (server creates inbox doc per target user)",
          len(in_inbox) >= 1,
          f"matching inbox docs for bid={bid}: {len(in_inbox)}")
else:
    check("Owner inbox endpoint reachable", False, f"status={r.status_code}")

# ----------------------------------------------------------------
# STEP 5 — /api/notifications has the broadcast entry
# ----------------------------------------------------------------
print("\n[STEP 5] GET /api/notifications (in-app bell)")
r = requests.get(f"{BASE}/notifications?limit=50", headers=HDR, timeout=10)
check("GET /api/notifications returns 200", r.status_code == 200,
      f"status={r.status_code}")
notifs = (r.json() or {}).get("items", [])
print(f"  total notifs returned = {len(notifs)}, unread_count={r.json().get('unread_count') if r.status_code == 200 else '?'}")
# server.py:5054 creates an author notification with kind=broadcast +
# data.broadcast_id == bid, title contains "Broadcast approved & sent"
match_notif = [
    n for n in notifs
    if (n.get("data") or {}).get("broadcast_id") == bid
       and n.get("kind") == "broadcast"
]
check("In-app notification with kind=broadcast and data.broadcast_id matches exists for owner (author)",
      len(match_notif) >= 1,
      f"found {len(match_notif)} matches for bid={bid}; first 3 broadcast notifs: " +
      jdump([{k: v for k, v in n.items() if k in ('id','title','kind','data','created_at')} for n in notifs if n.get('kind') == 'broadcast'][:3]))
if match_notif:
    n = match_notif[0]
    check("Broadcast notif title contains 'Broadcast'",
          "Broadcast" in (n.get("title") or ""),
          f"title={n.get('title')}")
    print(f"  notification title: {n.get('title')}")
    print(f"  notification body : {n.get('body')}")

# ----------------------------------------------------------------
# STEP 6 — Cleanup
# ----------------------------------------------------------------
print("\n[STEP 6] Cleanup")
# Try DELETE — server.py:5091 disallows deleting a 'sent' broadcast via API.
r = requests.delete(f"{BASE}/broadcasts/{bid}", headers=HDR, timeout=10)
print(f"  DELETE /api/broadcasts/{bid} -> {r.status_code}  {r.text[:200]}")
if r.status_code == 200:
    check("Cleanup via DELETE endpoint", True)
else:
    print(f"  DELETE blocked (expected, status=sent). Falling back to mongosh purge.")
    cleanup_cmd = f"""
mongosh --quiet --eval "
db = db.getSiblingDB('consulturo');
var r1 = db.broadcasts.deleteMany({{broadcast_id:'{bid}'}});
var r2 = db.broadcast_inbox.deleteMany({{broadcast_id:'{bid}'}});
var r3 = db.notifications.deleteMany({{'data.broadcast_id':'{bid}'}});
print('broadcasts_deleted=' + r1.deletedCount);
print('inbox_deleted=' + r2.deletedCount);
print('notifications_deleted=' + r3.deletedCount);
"
""".strip()
    out = subprocess.run(cleanup_cmd, shell=True, capture_output=True, text=True, timeout=20)
    print("  mongosh stdout:")
    for line in (out.stdout or "").splitlines():
        print(f"    {line}")
    if out.stderr:
        print(f"  mongosh stderr: {out.stderr[:300]}")
    check("Cleanup via mongosh purge succeeded",
          "broadcasts_deleted=1" in (out.stdout or ""),
          out.stdout[:300])

# Summary
print("\n" + "=" * 70)
print(f"PASS: {len(PASS)}   FAIL: {len(FAIL)}")
print("=" * 70)
for f in FAIL:
    print(f"  FAIL: {f}")
if not FAIL:
    print("ALL CHECKS PASS")
