"""Backend test for auth-callback bridge endpoint and handoff init/poll pair.

Tests directly against http://localhost:8001 (NOT via the K8s ingress) to
ensure the path-based auth-callback bridge variant serves correctly.
"""
import json
import sys
import urllib.request
import urllib.error


BASE = "http://localhost:8001"

results = []


def record(name: str, ok: bool, detail: str = "") -> None:
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {name}{(' — ' + detail) if detail else ''}")
    results.append((name, ok, detail))


def http_get(path: str):
    req = urllib.request.Request(BASE + path, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            return resp.status, dict(resp.headers), body
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        return e.code, dict(e.headers or {}), body


def http_post_json(path: str, payload):
    data = json.dumps(payload).encode("utf-8") if payload is not None else b""
    req = urllib.request.Request(
        BASE + path,
        method="POST",
        data=data,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            return resp.status, body
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        return e.code, body


# -------------------------------------------------------------------------
# 1. GET /auth-callback (no path) — must return 200 + empty handoff default
# -------------------------------------------------------------------------
print("\n=== TEST 1: GET /auth-callback (no path) ===")
status, headers, body = http_get("/auth-callback")
record("GET /auth-callback returns 200", status == 200, f"got {status}")
record(
    "Body contains empty-default handoff line",
    "var handoff = qp['handoff'] || '';" in body,
    "expected literal: var handoff = qp['handoff'] || '';",
)
record(
    "Body contains consulturo://auth-callback",
    "consulturo://auth-callback" in body,
)
record(
    "Body contains intent://auth-callback",
    "intent://auth-callback" in body,
)
ctype = headers.get("content-type", "") or headers.get("Content-Type", "")
record("Content-Type is HTML", "text/html" in ctype.lower(), f"content-type={ctype}")

# -------------------------------------------------------------------------
# 2. GET /auth-callback/abc-123-xyz — must bake handoff into JS
# -------------------------------------------------------------------------
print("\n=== TEST 2: GET /auth-callback/abc-123-xyz ===")
status, headers, body = http_get("/auth-callback/abc-123-xyz")
record("GET /auth-callback/abc-123-xyz returns 200", status == 200, f"got {status}")
record(
    "Body contains baked handoff 'abc-123-xyz'",
    "var handoff = qp['handoff'] || 'abc-123-xyz';" in body,
    "expected: var handoff = qp['handoff'] || 'abc-123-xyz';",
)
record(
    "Body contains consulturo://auth-callback (path variant)",
    "consulturo://auth-callback" in body,
)
record(
    "Body contains intent://auth-callback (path variant)",
    "intent://auth-callback" in body,
)
# Confirm placeholder was actually replaced (not leaked through).
record(
    "Placeholder __PATH_HANDOFF__ NOT present in response",
    "__PATH_HANDOFF__" not in body,
)

# -------------------------------------------------------------------------
# 3. GET /auth-callback/{another_id} — happy variant with realistic UUID
# -------------------------------------------------------------------------
print("\n=== TEST 3: GET /auth-callback/<uuid> ===")
test_id = "f3a91e2c-9d4b-4e21-87c5-8c1b7a6f0d11"
status, headers, body = http_get(f"/auth-callback/{test_id}")
record("UUID-shaped handoff returns 200", status == 200, f"got {status}")
record(
    f"Body bakes handoff '{test_id}' into JS",
    f"var handoff = qp['handoff'] || '{test_id}';" in body,
)

# -------------------------------------------------------------------------
# 4. POST /api/auth/handoff/init — returns {"handoff_id": "..."}
# -------------------------------------------------------------------------
print("\n=== TEST 4: POST /api/auth/handoff/init ===")

# 4a. Without body (server should auto-generate a UUID).
status, body = http_post_json("/api/auth/handoff/init", None)
record("POST /api/auth/handoff/init (no body) returns 200", status == 200, f"got {status} body={body[:120]}")
auto_hid = None
try:
    j = json.loads(body)
    auto_hid = j.get("handoff_id")
    record("Response has 'handoff_id' key (str, non-empty)", isinstance(auto_hid, str) and len(auto_hid) > 0, f"handoff_id={auto_hid!r}")
except Exception as e:
    record("Response is JSON", False, str(e))

# 4b. With client-supplied handoff_id (server should return it back).
client_hid = "test-handoff-9b1c4f2a"
status, body = http_post_json("/api/auth/handoff/init", {"handoff_id": client_hid})
record("POST /api/auth/handoff/init (client-supplied) returns 200", status == 200, f"got {status}")
try:
    j = json.loads(body)
    record(
        "Server echoes client-supplied handoff_id",
        j.get("handoff_id") == client_hid,
        f"got {j.get('handoff_id')!r}",
    )
except Exception as e:
    record("Response is JSON", False, str(e))

# -------------------------------------------------------------------------
# 5. GET /api/auth/handoff/{unknown_id} returns 404
# -------------------------------------------------------------------------
print("\n=== TEST 5: GET /api/auth/handoff/<unknown> ===")
status, headers, body = http_get("/api/auth/handoff/this-id-does-not-exist-xyz")
record("Unknown handoff returns 404", status == 404, f"got {status}")
try:
    j = json.loads(body)
    detail = (j.get("detail") or "").lower()
    record(
        "404 detail mentions handoff",
        "handoff" in detail or "unknown" in detail,
        f"detail={j.get('detail')!r}",
    )
except Exception:
    record("404 body is JSON", False, body[:120])

# -------------------------------------------------------------------------
# 6. GET /api/auth/handoff/{just_initialized} returns 202 pending
#    (sanity — confirms init+poll pair work end-to-end without auth flow)
# -------------------------------------------------------------------------
print("\n=== TEST 6: GET /api/auth/handoff/{just_initialized} (pending) ===")
if auto_hid:
    status, headers, body = http_get(f"/api/auth/handoff/{auto_hid}")
    # Should be 202 pending since no /api/auth/session has resolved it.
    record(
        "Just-initialized handoff returns 202 pending",
        status == 202,
        f"got {status} body={body[:120]}",
    )
    try:
        j = json.loads(body)
        record("Pending body has status='pending'", j.get("status") == "pending", f"got {j.get('status')!r}")
    except Exception:
        record("Pending body is JSON", False, body[:120])
else:
    record("Skipping pending test (no auto_hid)", False, "no handoff_id from init")

# -------------------------------------------------------------------------
# Summary
# -------------------------------------------------------------------------
total = len(results)
passed = sum(1 for _, ok, _ in results if ok)
failed = total - passed
print(f"\n=== SUMMARY: {passed}/{total} passed, {failed} failed ===")
if failed:
    print("\nFAILED:")
    for name, ok, detail in results:
        if not ok:
            print(f"  - {name}: {detail}")
sys.exit(0 if failed == 0 else 1)
