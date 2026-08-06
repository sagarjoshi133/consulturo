"""Backend test for POST /api/render/pdf (WeasyPrint)."""
import requests

BASE = "http://localhost:8001"
OWNER_TOKEN = "test_session_1776770314741"

results = []
def check(name, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"[{status}] {name} :: {detail}")
    results.append((status, name, detail))

# 1. Valid HTML with auth -> 200, application/pdf, %PDF-
url = f"{BASE}/api/render/pdf"
headers = {"Authorization": f"Bearer {OWNER_TOKEN}"}
body = {
    "html": "<html><body><h1>Test Rx</h1><p>Patient: John Doe</p><p>Date: 2026-04-25</p><p>Dr Sagar Joshi</p></body></html>",
    "filename": "test.pdf",
}
r = requests.post(url, json=body, headers=headers, timeout=30)
print(f"\n--- T1: valid html + owner auth ---")
print(f"Status: {r.status_code}")
print(f"Content-Type: {r.headers.get('Content-Type')}")
print(f"Content-Disposition: {r.headers.get('Content-Disposition')}")
print(f"First 8 bytes: {r.content[:8]!r}")
print(f"Size: {len(r.content)} bytes")
check("T1.status==200", r.status_code == 200, f"got {r.status_code} body={r.text[:200] if r.status_code != 200 else ''}")
check("T1.content-type==application/pdf",
      (r.headers.get("Content-Type", "").startswith("application/pdf")),
      f"got {r.headers.get('Content-Type')}")
check("T1.body starts with %PDF-",
      r.content[:5] == b"%PDF-",
      f"got {r.content[:8]!r}")
check("T1.content-disposition has filename=\"test.pdf\"",
      'filename="test.pdf"' in (r.headers.get("Content-Disposition") or ""),
      f"got {r.headers.get('Content-Disposition')}")

# 2. HTML too short -> 400
print(f"\n--- T2: html too short ---")
body2 = {"html": "<p>Hi</p>", "filename": "x.pdf"}
r2 = requests.post(url, json=body2, headers=headers, timeout=15)
print(f"Status: {r2.status_code} body: {r2.text[:200]}")
check("T2.status==400", r2.status_code == 400, f"got {r2.status_code}")
try:
    j2 = r2.json()
    detail2 = j2.get("detail", "")
except Exception:
    detail2 = r2.text
check("T2.detail==\"HTML payload missing or too short\"",
      detail2 == "HTML payload missing or too short",
      f"got {detail2!r}")

# 3. No auth (no cookie, no header) -> 401
print(f"\n--- T3: no auth ---")
r3 = requests.post(url, json=body, timeout=15)
print(f"Status: {r3.status_code} body: {r3.text[:200]}")
check("T3.status==401", r3.status_code == 401, f"got {r3.status_code} body={r3.text[:200]}")

# 4. Bonus: filename omitted -> default prescription.pdf
print(f"\n--- T4: filename omitted defaults ---")
r4 = requests.post(url, json={"html": body["html"]}, headers=headers, timeout=30)
print(f"Status: {r4.status_code} CD: {r4.headers.get('Content-Disposition')}")
check("T4.status==200", r4.status_code == 200, f"got {r4.status_code}")
check("T4.default filename=prescription.pdf",
      'filename="prescription.pdf"' in (r4.headers.get("Content-Disposition") or ""),
      f"got {r4.headers.get('Content-Disposition')}")

# 5. Bonus: filename without .pdf gets .pdf appended
print(f"\n--- T5: filename without extension ---")
r5 = requests.post(url, json={"html": body["html"], "filename": "foo"}, headers=headers, timeout=30)
print(f"Status: {r5.status_code} CD: {r5.headers.get('Content-Disposition')}")
check("T5.filename=foo.pdf appended",
      'filename="foo.pdf"' in (r5.headers.get("Content-Disposition") or ""),
      f"got {r5.headers.get('Content-Disposition')}")

print("\n=========")
total = len(results)
fails = sum(1 for s, _, _ in results if s == "FAIL")
print(f"TOTAL {total}  PASS {total-fails}  FAIL {fails}")
for s, n, d in results:
    if s == "FAIL":
        print(f"  - FAIL {n} :: {d}")
