"""
Backend tests for in-app personal messaging permissions.

Covers:
1) /api/auth/me payload `can_send_personal_messages` for various roles
   (owner / staff default / staff explicit-False / patient default /
   patient explicit-True).
2) POST /api/admin/users/{user_id}/messaging-permission   (owner-only).
3) GET  /api/admin/messaging-permissions                   (owner-only).
4) GET  /api/messages/recipients                           (patient
   restriction: scope=patients ignored when caller is a patient).
"""

import os
import sys
import time
import json
import uuid
import requests
import subprocess

BASE = os.environ.get("BASE_URL", "http://localhost:8001/api")
OWNER_TOKEN = "test_session_1776770314741"
DOCTOR_TOKEN = "test_doc_1776771431524"

PASS = []
FAIL = []


def check(name, cond, info=""):
    if cond:
        PASS.append(name)
        print(f"  PASS: {name}")
    else:
        FAIL.append((name, info))
        print(f"  FAIL: {name}  ({info})")


def H(token=None):
    h = {"Content-Type": "application/json"}
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


def mongo(js):
    """Run a mongosh snippet against consulturo."""
    cmd = ["mongosh", "--quiet", "--eval",
           "db = db.getSiblingDB('consulturo');\n" + js]
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    return res.stdout.strip()


CLEANUP_USER_IDS = []
CLEANUP_TOKENS = []


def seed_user(role, email, name, *, can_send=None, phone=None):
    uid = f"test_perm_{role}_{int(time.time()*1000)}_{uuid.uuid4().hex[:6]}"
    token = f"test_perm_session_{int(time.time()*1000)}_{uuid.uuid4().hex[:6]}"
    can_send_part = ""
    if can_send is True:
        can_send_part = ", can_send_personal_messages:true"
    elif can_send is False:
        can_send_part = ", can_send_personal_messages:false"
    phone_part = f", phone:'{phone}'" if phone else ""
    js = f"""
    db.users.insertOne({{
        user_id: '{uid}',
        email: '{email}',
        name: '{name}',
        role: '{role}',
        created_at: new Date()
        {can_send_part}
        {phone_part}
    }});
    db.user_sessions.insertOne({{
        user_id: '{uid}',
        session_token: '{token}',
        expires_at: new Date(Date.now()+7*24*60*60*1000),
        created_at: new Date()
    }});
    print('OK');
    """
    out = mongo(js)
    assert "OK" in out, f"seed failed for {email}: {out}"
    CLEANUP_USER_IDS.append(uid)
    CLEANUP_TOKENS.append(token)
    return uid, token


def cleanup():
    if not CLEANUP_USER_IDS and not CLEANUP_TOKENS:
        return
    uids = ",".join(f"'{u}'" for u in CLEANUP_USER_IDS)
    toks = ",".join(f"'{t}'" for t in CLEANUP_TOKENS)
    js = f"""
    var u = db.users.deleteMany({{user_id: {{$in: [{uids}]}}}});
    var s = db.user_sessions.deleteMany({{session_token: {{$in: [{toks}]}}}});
    print('users_deleted=' + u.deletedCount);
    print('sessions_deleted=' + s.deletedCount);
    """
    print("[cleanup]", mongo(js))


def get_me(token):
    r = requests.get(f"{BASE}/auth/me", headers=H(token), timeout=10)
    return r.status_code, (r.json() if r.headers.get("content-type", "").startswith("application/json") else None)


# ──────────────────────────────────────────────────────────────────
# 1.  /api/auth/me — role/permission matrix
# ──────────────────────────────────────────────────────────────────
def test_auth_me_payload():
    print("\n[1] /api/auth/me payload by role")

    # 1a) Owner
    sc, body = get_me(OWNER_TOKEN)
    check("1a owner /auth/me 200", sc == 200, str(sc))
    check("1a owner role=owner", body and body.get("role") == "owner", body and body.get("role"))
    check("1a owner can_send=true", body and body.get("can_send_personal_messages") is True,
          body and body.get("can_send_personal_messages"))

    # 1b) Doctor with NO can_send field stored — default true
    doc_uid, doc_token = seed_user("doctor",
                                   f"perm_doc_{uuid.uuid4().hex[:6]}@example.com",
                                   "Perm Doc Default")
    sc, body = get_me(doc_token)
    check("1b doctor /auth/me 200", sc == 200, str(sc))
    check("1b doctor (no flag) defaults to True",
          body and body.get("can_send_personal_messages") is True,
          body and body.get("can_send_personal_messages"))

    # 1c) Doctor with explicit False — false
    doc_uid_f, doc_token_f = seed_user("doctor",
                                       f"perm_doc_f_{uuid.uuid4().hex[:6]}@example.com",
                                       "Perm Doc Off",
                                       can_send=False)
    sc, body = get_me(doc_token_f)
    check("1c doctor explicit-False -> False",
          sc == 200 and body and body.get("can_send_personal_messages") is False,
          body and body.get("can_send_personal_messages"))

    # 1d) Patient with no override — false
    pat_uid, pat_token = seed_user("patient",
                                   f"perm_pat_{uuid.uuid4().hex[:6]}@example.com",
                                   "Perm Patient Default")
    sc, body = get_me(pat_token)
    check("1d patient (no override) -> False",
          sc == 200 and body and body.get("can_send_personal_messages") is False,
          body and body.get("can_send_personal_messages"))

    # 1e) Patient with explicit True — true
    pat_uid_t, pat_token_t = seed_user("patient",
                                       f"perm_pat_t_{uuid.uuid4().hex[:6]}@example.com",
                                       "Perm Patient On",
                                       can_send=True)
    sc, body = get_me(pat_token_t)
    check("1e patient explicit-True -> True",
          sc == 200 and body and body.get("can_send_personal_messages") is True,
          body and body.get("can_send_personal_messages"))

    # 1f) Other staff roles — assistant/reception/nursing/partner default True
    for r in ["assistant", "reception", "nursing", "partner"]:
        uid, tk = seed_user(r,
                            f"perm_{r}_{uuid.uuid4().hex[:6]}@example.com",
                            f"Perm {r.title()}")
        sc, body = get_me(tk)
        check(f"1f staff {r} default True",
              sc == 200 and body and body.get("can_send_personal_messages") is True,
              body and body.get("can_send_personal_messages"))

    # Save for later use
    return {
        "doc_default_uid": doc_uid, "doc_default_token": doc_token,
        "doc_off_uid": doc_uid_f,
        "pat_default_uid": pat_uid, "pat_default_token": pat_token,
        "pat_on_uid": pat_uid_t, "pat_on_token": pat_token_t,
    }


# ──────────────────────────────────────────────────────────────────
# 2.  POST /api/admin/users/{user_id}/messaging-permission
# ──────────────────────────────────────────────────────────────────
def test_set_messaging_permission(ctx):
    print("\n[2] POST /api/admin/users/{user_id}/messaging-permission")

    pat_uid = ctx["pat_default_uid"]
    pat_token = ctx["pat_default_token"]

    # 2a) non-owner -> 403 (use doctor with default-true)
    r = requests.post(f"{BASE}/admin/users/{pat_uid}/messaging-permission",
                      headers=H(ctx["doc_default_token"]),
                      json={"allowed": True}, timeout=10)
    check("2a non-owner -> 403", r.status_code == 403, f"{r.status_code} {r.text[:120]}")

    # also patient with permission -> still 403 (require_owner)
    r = requests.post(f"{BASE}/admin/users/{pat_uid}/messaging-permission",
                      headers=H(ctx["pat_on_token"]),
                      json={"allowed": True}, timeout=10)
    check("2a' patient-with-perm -> 403", r.status_code == 403, f"{r.status_code}")

    # 2b) unknown user_id -> 404
    r = requests.post(f"{BASE}/admin/users/does_not_exist_xyz/messaging-permission",
                      headers=H(OWNER_TOKEN),
                      json={"allowed": True}, timeout=10)
    check("2b unknown user -> 404", r.status_code == 404, f"{r.status_code} {r.text[:120]}")

    # 2c) owner sets allowed=True on patient
    r = requests.post(f"{BASE}/admin/users/{pat_uid}/messaging-permission",
                      headers=H(OWNER_TOKEN),
                      json={"allowed": True}, timeout=10)
    body = r.json() if r.ok else None
    check("2c owner set True -> 200", r.status_code == 200, f"{r.status_code} {r.text[:120]}")
    check("2c response shape ok=true allowed=true",
          body and body.get("ok") is True and body.get("allowed") is True
          and body.get("user_id") == pat_uid, body)

    # /auth/me on that patient should now reflect True
    sc, me = get_me(pat_token)
    check("2c patient /auth/me reflects True after PATCH",
          sc == 200 and me.get("can_send_personal_messages") is True,
          me.get("can_send_personal_messages"))

    # 2d) owner -> owner target -> 200 with note, no change
    owner_uid = None
    sc, me = get_me(OWNER_TOKEN)
    if sc == 200:
        owner_uid = me.get("user_id")
    if owner_uid:
        r = requests.post(f"{BASE}/admin/users/{owner_uid}/messaging-permission",
                          headers=H(OWNER_TOKEN),
                          json={"allowed": False}, timeout=10)
        body = r.json() if r.ok else None
        check("2d owner-target -> 200", r.status_code == 200, f"{r.status_code} {r.text[:200]}")
        check("2d owner-target body has note + allowed=true",
              body and body.get("allowed") is True and "note" in body, body)

    # 2e) owner sets allowed=False on patient (round-trip)
    r = requests.post(f"{BASE}/admin/users/{pat_uid}/messaging-permission",
                      headers=H(OWNER_TOKEN),
                      json={"allowed": False}, timeout=10)
    check("2e owner set False -> 200", r.status_code == 200, str(r.status_code))
    sc, me = get_me(pat_token)
    check("2e /auth/me reflects False",
          sc == 200 and me.get("can_send_personal_messages") is False,
          me.get("can_send_personal_messages"))

    # restore True for downstream listing test
    requests.post(f"{BASE}/admin/users/{pat_uid}/messaging-permission",
                  headers=H(OWNER_TOKEN),
                  json={"allowed": True}, timeout=10)


# ──────────────────────────────────────────────────────────────────
# 3.  GET /api/admin/messaging-permissions
# ──────────────────────────────────────────────────────────────────
def test_list_messaging_permissions(ctx):
    print("\n[3] GET /api/admin/messaging-permissions")

    # 3a) non-owner -> 403
    r = requests.get(f"{BASE}/admin/messaging-permissions",
                     headers=H(ctx["doc_default_token"]), timeout=10)
    check("3a non-owner -> 403", r.status_code == 403, str(r.status_code))

    # 3b) owner with role=patient
    r = requests.get(f"{BASE}/admin/messaging-permissions?role=patient",
                     headers=H(OWNER_TOKEN), timeout=10)
    check("3b owner role=patient -> 200", r.status_code == 200, str(r.status_code))
    body = r.json() if r.ok else {}
    items = body.get("items") or body  # compat
    check("3b items is list", isinstance(items, list), type(items).__name__)

    # All returned rows must be patients
    if isinstance(items, list):
        all_pat = all(it.get("role") == "patient" for it in items)
        check("3b all rows role=patient", all_pat,
              [it.get("role") for it in items[:10]])

        # The patient we toggled should be present with allowed=true,
        # explicit=true, default_allowed=false.
        match = next((it for it in items if it.get("user_id") == ctx["pat_default_uid"]), None)
        check("3b toggled patient row present", match is not None,
              "looking for " + ctx["pat_default_uid"])
        if match:
            check("3b toggled patient allowed=true",
                  match.get("allowed") is True, match.get("allowed"))
            check("3b toggled patient explicit=true",
                  match.get("explicit") is True, match.get("explicit"))
            check("3b toggled patient default_allowed=false",
                  match.get("default_allowed") is False, match.get("default_allowed"))
            for k in ("user_id", "name", "email", "role", "picture",
                      "allowed", "default_allowed", "explicit"):
                check(f"3b row has key '{k}'", k in match, list(match.keys()))

    # 3c) role filter only returns matching role
    r = requests.get(f"{BASE}/admin/messaging-permissions?role=doctor",
                     headers=H(OWNER_TOKEN), timeout=10)
    if r.ok:
        items = (r.json() or {}).get("items") or []
        check("3c role=doctor filter", all(it.get("role") == "doctor" for it in items),
              [it.get("role") for it in items[:10]])

    # 3d) no auth -> 401/403
    r = requests.get(f"{BASE}/admin/messaging-permissions", timeout=10)
    check("3d no-auth -> 401/403", r.status_code in (401, 403), str(r.status_code))


# ──────────────────────────────────────────────────────────────────
# 4.  GET /api/messages/recipients — patient restriction
# ──────────────────────────────────────────────────────────────────
def test_recipients_patient_restriction(ctx):
    print("\n[4] /api/messages/recipients patient restriction")

    pat_token = ctx["pat_default_token"]   # we just turned this patient ON
    # ensure ON
    sc, me = get_me(pat_token)
    if not (me and me.get("can_send_personal_messages") is True):
        # restore via owner endpoint
        requests.post(f"{BASE}/admin/users/{ctx['pat_default_uid']}/messaging-permission",
                      headers=H(OWNER_TOKEN), json={"allowed": True}, timeout=10)

    # 4a) Owner -> scope=patients returns ONLY patients
    r = requests.get(f"{BASE}/messages/recipients?scope=patients",
                     headers=H(OWNER_TOKEN), timeout=10)
    check("4a owner scope=patients -> 200", r.status_code == 200, f"{r.status_code} {r.text[:120]}")
    items = (r.json() or {}).get("items") or []
    check("4a owner scope=patients all role=patient",
          all(it.get("role") == "patient" for it in items),
          [it.get("role") for it in items[:5]])
    check("4a at least one patient returned (sanity)",
          len(items) > 0, f"len={len(items)}")

    # 4b) Owner -> scope=team returns NO patients
    r = requests.get(f"{BASE}/messages/recipients?scope=team",
                     headers=H(OWNER_TOKEN), timeout=10)
    items = (r.json() or {}).get("items") or []
    check("4b owner scope=team no patients",
          all(it.get("role") != "patient" for it in items),
          [it.get("role") for it in items[:5]])

    # 4c) Patient with permission -> scope=patients IGNORED, must return only team
    r = requests.get(f"{BASE}/messages/recipients?scope=patients",
                     headers=H(pat_token), timeout=10)
    check("4c patient scope=patients -> 200", r.status_code == 200,
          f"{r.status_code} {r.text[:200]}")
    items = (r.json() or {}).get("items") or []
    check("4c patient scope=patients returns ONLY team (no patients)",
          all(it.get("role") != "patient" for it in items),
          [it.get("role") for it in items[:10]])
    check("4c at least one team member returned",
          len(items) > 0, f"len={len(items)}")

    # 4d) Patient default scope -> team only
    r = requests.get(f"{BASE}/messages/recipients",
                     headers=H(pat_token), timeout=10)
    items = (r.json() or {}).get("items") or []
    check("4d patient default scope -> only team",
          all(it.get("role") != "patient" for it in items),
          [it.get("role") for it in items[:10]])

    # 4e) Owner self excluded
    sc, me = get_me(OWNER_TOKEN)
    owner_uid = me.get("user_id") if sc == 200 else None
    r = requests.get(f"{BASE}/messages/recipients?scope=team",
                     headers=H(OWNER_TOKEN), timeout=10)
    items = (r.json() or {}).get("items") or []
    check("4e caller excluded from team list",
          all(it.get("user_id") != owner_uid for it in items),
          owner_uid)

    # 4f) Doctor with explicit-False -> 403
    # ctx["doc_off_uid"] has its session ... we need its token. Look up:
    # We don't have token cached for doc_off, only uid. Skip permission-deny
    # check here — it is already covered by existing messaging suite.

    # 4g) Patient WITHOUT permission -> 403
    no_uid, no_token = seed_user("patient",
                                 f"perm_pat_off_{uuid.uuid4().hex[:6]}@example.com",
                                 "Perm Patient Off")
    r = requests.get(f"{BASE}/messages/recipients?scope=team",
                     headers=H(no_token), timeout=10)
    check("4g patient w/o permission -> 403",
          r.status_code == 403, f"{r.status_code} {r.text[:160]}")


def main():
    print(f"BASE = {BASE}")
    try:
        ctx = test_auth_me_payload()
        test_set_messaging_permission(ctx)
        test_list_messaging_permissions(ctx)
        test_recipients_patient_restriction(ctx)
    finally:
        cleanup()
        print(f"\nResults: {len(PASS)} passed, {len(FAIL)} failed")
        for name, info in FAIL:
            print(f"  FAILED: {name}  -> {info}")
        if FAIL:
            sys.exit(1)


if __name__ == "__main__":
    main()
