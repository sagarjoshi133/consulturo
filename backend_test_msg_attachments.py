"""Test attachments feature on POST /api/messages/send.

Owner sends to a non-owner user (the seeded DOCTOR), then DOCTOR session
fetches GET /api/notifications/{id} to verify attachments are persisted
and returned correctly.
"""
import base64
import json
import os
import sys

import httpx

BASE = "http://localhost:8001/api"
OWNER = "test_session_1776770314741"
DOCTOR = "test_doc_1776771431524"

# 1x1 white JPEG (~125 bytes raw). Base64 below is real-ish.
TINY_JPEG_B64 = (
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEB"
    "AQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEB"
    "AQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAr/xAAUEAEA"
    "AAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhED"
    "EQA/AL+AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAA="
)
TINY_PDF_B64 = (
    "JVBERi0xLjQKJeLjz9MKMSAwIG9iago8PC9UeXBlIC9DYXRhbG9nIC9QYWdlcyAyIDAgUj4+CmVuZG9iagp4cmVmCjAg"
    "MQowMDAwMDAwMDAwIDY1NTM1IGYgClRyYWlsZXIKPDwvU2l6ZSAxL1Jvb3QgMSAwIFI+PgolJUVPRg=="
)


def H(tok):
    return {"Authorization": f"Bearer {tok}"}


def main():
    results = []
    created_ids = []
    rec_uid = None

    with httpx.Client(timeout=30.0) as c:
        # who is the recipient?
        r = c.get(f"{BASE}/auth/me", headers=H(DOCTOR))
        assert r.status_code == 200, r.text
        rec_uid = r.json()["user_id"]
        results.append(("recipient resolved", rec_uid))

        # ---- Test 1: one small image data URL ----
        payload = {
            "recipient_user_id": rec_uid,
            "title": "Image Test",
            "body": "Tiny image attachment",
            "attachments": [{
                "name": "tiny.jpg",
                "mime": "image/jpeg",
                "size_bytes": int(len(TINY_JPEG_B64) * 3 / 4),
                "data_url": f"data:image/jpeg;base64,{TINY_JPEG_B64}",
                "kind": "image",
            }],
        }
        r = c.post(f"{BASE}/messages/send", headers=H(OWNER), json=payload)
        assert r.status_code == 200, f"T1 send: {r.status_code} {r.text}"
        nid = r.json()["notification_id"]
        created_ids.append(nid)

        # GET as RECIPIENT
        r = c.get(f"{BASE}/notifications/{nid}", headers=H(DOCTOR))
        assert r.status_code == 200, f"T1 get: {r.status_code} {r.text}"
        n = r.json()
        atts = (n.get("data") or {}).get("attachments") or []
        assert isinstance(atts, list) and len(atts) == 1, f"T1 expected 1 att, got {atts}"
        a = atts[0]
        assert a.get("name") == "tiny.jpg", a
        assert (a.get("mime") or "").startswith("image/"), a
        assert a.get("kind") == "image", a
        assert (a.get("data_url") or "").startswith("data:image/"), a
        assert int(a.get("size_bytes") or 0) > 0, a
        results.append(("T1 image attachment OK", {"name": a["name"], "kind": a["kind"], "size": a["size_bytes"]}))

        # ---- Test 2: PDF ----
        payload = {
            "recipient_user_id": rec_uid,
            "title": "PDF Test",
            "body": "PDF attachment",
            "attachments": [{
                "name": "report.pdf",
                "mime": "application/pdf",
                "size_bytes": int(len(TINY_PDF_B64) * 3 / 4),
                "data_url": f"data:application/pdf;base64,{TINY_PDF_B64}",
                # No 'kind' supplied → server must infer.
            }],
        }
        r = c.post(f"{BASE}/messages/send", headers=H(OWNER), json=payload)
        assert r.status_code == 200, f"T2: {r.status_code} {r.text}"
        nid = r.json()["notification_id"]
        created_ids.append(nid)
        r = c.get(f"{BASE}/notifications/{nid}", headers=H(DOCTOR))
        assert r.status_code == 200
        atts = (r.json().get("data") or {}).get("attachments") or []
        assert len(atts) == 1
        a = atts[0]
        assert a.get("name") == "report.pdf"
        assert a.get("mime") == "application/pdf"
        # spec says kind="file" or matches mime
        assert a.get("kind") in ("file",), f"PDF kind expected 'file', got {a.get('kind')}"
        results.append(("T2 PDF inferred kind OK", a.get("kind")))

        # ---- Test 3: oversized -> 400 ----
        payload = {
            "recipient_user_id": rec_uid,
            "title": "Oversize",
            "body": "Should reject",
            "attachments": [{
                "name": "big.bin",
                "mime": "application/octet-stream",
                "size_bytes": 9_000_000,
                "data_url": "data:application/octet-stream;base64," + ("A" * 1024),
                "kind": "file",
            }],
        }
        r = c.post(f"{BASE}/messages/send", headers=H(OWNER), json=payload)
        assert r.status_code == 400, f"T3 expected 400, got {r.status_code} {r.text}"
        detail = (r.json().get("detail") or "").lower()
        assert "8 mb" in detail or "limit" in detail or "exceeds" in detail, detail
        results.append(("T3 oversized rejected", r.json().get("detail")))

        # ---- Test 4: malformed data_url silently dropped ----
        payload = {
            "recipient_user_id": rec_uid,
            "title": "Malformed",
            "body": "Bad data url",
            "attachments": [{
                "name": "bad.jpg",
                "mime": "image/jpeg",
                "size_bytes": 100,
                "data_url": "not-a-data-url",
                "kind": "image",
            }],
        }
        r = c.post(f"{BASE}/messages/send", headers=H(OWNER), json=payload)
        assert r.status_code == 200, f"T4: {r.status_code} {r.text}"
        nid = r.json()["notification_id"]
        created_ids.append(nid)
        r = c.get(f"{BASE}/notifications/{nid}", headers=H(DOCTOR))
        assert r.status_code == 200
        data = r.json().get("data") or {}
        atts = data.get("attachments") or []
        assert len(atts) == 0, f"T4 expected 0 atts, got {atts}"
        results.append(("T4 malformed dropped, attachments empty", True))

        # ---- Test 5: 7 attachments → capped to 6 ----
        atts7 = []
        for i in range(7):
            atts7.append({
                "name": f"img{i}.jpg",
                "mime": "image/jpeg",
                "size_bytes": int(len(TINY_JPEG_B64) * 3 / 4),
                "data_url": f"data:image/jpeg;base64,{TINY_JPEG_B64}",
                "kind": "image",
            })
        payload = {
            "recipient_user_id": rec_uid,
            "title": "Cap Test",
            "body": "7 attachments → capped at 6",
            "attachments": atts7,
        }
        r = c.post(f"{BASE}/messages/send", headers=H(OWNER), json=payload)
        assert r.status_code == 200, f"T5: {r.status_code} {r.text}"
        nid = r.json()["notification_id"]
        created_ids.append(nid)
        r = c.get(f"{BASE}/notifications/{nid}", headers=H(DOCTOR))
        assert r.status_code == 200
        atts = (r.json().get("data") or {}).get("attachments") or []
        assert len(atts) == 6, f"T5 expected 6 atts, got {len(atts)}"
        results.append(("T5 cap=6 enforced", len(atts)))

    # ---- Cleanup notifications ----
    import subprocess
    if created_ids:
        ids_quoted = ",".join(f'"{i}"' for i in created_ids)
        cmd = f'mongosh consulturo --quiet --eval \'db.notifications.deleteMany({{id:{{$in:[{ids_quoted}]}}}})\''
        try:
            subprocess.run(cmd, shell=True, check=False, capture_output=True, timeout=20)
        except Exception:
            pass

    print("\n=== ALL TESTS PASSED ===")
    for k, v in results:
        print(f"  ✅ {k}: {v}")
    print(f"  cleanup: {len(created_ids)} notifications purged")


if __name__ == "__main__":
    try:
        main()
    except AssertionError as e:
        print(f"\n❌ ASSERTION FAILED: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ ERROR: {type(e).__name__}: {e}")
        sys.exit(1)
