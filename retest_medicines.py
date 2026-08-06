"""Quick retest for Medicine catalogue endpoint fixes."""
import os
import sys
import requests

BASE = "https://urology-pro.preview.emergentagent.com/api"
OWNER = "test_session_1776770314741"
DOCTOR = "test_doc_1776771431524"
HDR_OWNER = {"Authorization": f"Bearer {OWNER}"}

REQUIRED_KEYS = {"name", "generic", "category", "dosage", "frequency",
                 "duration", "timing", "instructions", "source"}

results = []

def record(name, passed, evidence):
    status = "PASS" if passed else "FAIL"
    print(f"[{status}] {name}: {evidence}")
    results.append((name, passed, evidence))

# B2a
r = requests.get(f"{BASE}/medicines/catalog", headers=HDR_OWNER, timeout=20)
ok = r.status_code == 200
data = r.json() if ok else None
if ok and isinstance(data, list):
    ln = len(data)
    record("B2a default limit>=30", ln >= 30, f"status={r.status_code} len={ln}")
else:
    record("B2a default limit>=30", False, f"status={r.status_code} body={r.text[:300]}")

# B2b: limit=50, every item must have all 9 keys
r = requests.get(f"{BASE}/medicines/catalog", params={"limit": 50}, headers=HDR_OWNER, timeout=20)
ok = r.status_code == 200
data = r.json() if ok else []
missing_report = []
all_have_keys = True
for i, item in enumerate(data):
    missing = REQUIRED_KEYS - set(item.keys())
    if missing:
        all_have_keys = False
        missing_report.append((i, item.get("name"), missing))
record(
    "B2b every item has 9 keys (limit=50)",
    ok and all_have_keys and len(data) > 0,
    f"status={r.status_code} len={len(data)} items_missing_keys={len(missing_report)}"
    + (f" examples={missing_report[:3]}" if missing_report else ""),
)

# Spot-check B14: q=tamsu, first name starts with 'Tamsulosin'
r = requests.get(f"{BASE}/medicines/catalog", params={"q": "tamsu"}, headers=HDR_OWNER, timeout=20)
ok = r.status_code == 200
data = r.json() if ok else []
first_name = data[0]["name"] if data else None
record(
    "B14 q=tamsu first starts with 'Tamsulosin'",
    ok and first_name and first_name.startswith("Tamsulosin"),
    f"status={r.status_code} first_name={first_name!r} len={len(data)}",
)

# B15: category=Antibiotic => all items category==Antibiotic AND all 9 keys
r = requests.get(f"{BASE}/medicines/catalog", params={"category": "Antibiotic"}, headers=HDR_OWNER, timeout=20)
ok = r.status_code == 200
data = r.json() if ok else []
all_abx = all(i.get("category") == "Antibiotic" for i in data) if data else False
all_keys_abx = all(REQUIRED_KEYS.issubset(i.keys()) for i in data) if data else False
bad_cat = [(i.get("name"), i.get("category")) for i in data if i.get("category") != "Antibiotic"]
bad_keys = [(i.get("name"), REQUIRED_KEYS - set(i.keys())) for i in data if not REQUIRED_KEYS.issubset(i.keys())]
record(
    "B15 category=Antibiotic all match + 9 keys",
    ok and all_abx and all_keys_abx and len(data) > 0,
    f"status={r.status_code} len={len(data)} all_abx={all_abx} all_9_keys={all_keys_abx}"
    + (f" bad_cat={bad_cat[:3]}" if bad_cat else "")
    + (f" bad_keys={bad_keys[:3]}" if bad_keys else ""),
)

print("\n==== SUMMARY ====")
for n, p, e in results:
    print(f"  {'PASS' if p else 'FAIL'} - {n}")
    print(f"        {e}")
sys.exit(0 if all(p for _, p, _ in results) else 1)
