"""
Apply the unapplied translation corrections from the JSONL checkpoint
using procedure-key context, so duplicated short strings (e.g.
"Retrograde ejaculation (60-80%)") are still safely updated within
their owning procedure block.

Run:
    cd /app/backend && python -m tools.apply_remaining_corrections
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Dict, List, Tuple


JSONL = Path("/app/backend/tools/translation_corrections.jsonl")
FILES = {
    "p1": Path("/app/backend/data/consent_procedures.py"),
    "p2": Path("/app/backend/data/consent_procedures_part2.py"),
    "ts": Path("/app/frontend/src/consent-pdf.ts"),
}


def find_proc_block(src: str, key: str) -> Tuple[int, int]:
    """Return (start, end) char indexes of the dict block for the
    procedure with the given key inside a Python source file."""
    pat = re.compile(rf'"key"\s*:\s*"{re.escape(key)}"')
    m = pat.search(src)
    if not m:
        return -1, -1
    # Walk forward from `m.start()` to find the enclosing dict's braces.
    # Scan backwards for the opening `{` of this procedure entry.
    i = m.start()
    depth = 0
    start = -1
    j = i
    while j >= 0:
        c = src[j]
        if c == "}":
            depth += 1
        elif c == "{":
            if depth == 0:
                start = j
                break
            depth -= 1
        j -= 1
    if start < 0:
        return -1, -1
    # Forward from start, find matching close brace.
    depth = 0
    end = -1
    for j in range(start, len(src)):
        c = src[j]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                end = j + 1
                break
    return start, end


def apply_in_block(src: str, block: Tuple[int, int], old: str, new: str) -> Tuple[str, bool]:
    a, b = block
    if a < 0:
        return src, False
    blk = src[a:b]
    if old not in blk:
        return src, False
    cnt = blk.count(old)
    if cnt != 1:
        # Even within a single procedure block, the string isn't unique
        # — skip rather than corrupt data.
        return src, False
    new_blk = blk.replace(old, new, 1)
    return src[:a] + new_blk + src[b:], True


def main() -> int:
    if not JSONL.exists():
        print(f"No checkpoint at {JSONL}")
        return 1
    results: List[Dict] = []
    for line in JSONL.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            results.append(json.loads(line))
        except Exception:
            continue

    srcs: Dict[str, str] = {k: p.read_text(encoding="utf-8") for k, p in FILES.items()}

    applied_hi = 0
    applied_gu = 0
    missed: List[str] = []

    for r in results:
        if not (r["changed_hi"] or r["changed_gu"]):
            continue
        eid = r["id"]
        # Determine owning procedure key for procedure entries
        m = re.match(r"^([a-z0-9_]+)\.", eid)
        proc_key = m.group(1) if m else None

        # If it's a boilerplate (COMMON_RISKS / DECLARATION), it lives in TS file.
        is_ts = eid.startswith("COMMON_RISKS") or eid == "DECLARATION"

        targets: List[Tuple[str, Tuple[int, int]]] = []
        if is_ts:
            # Whole-file context for TS source (small file)
            targets.append(("ts", (0, len(srcs["ts"]))))
        else:
            # Try each python source file
            for k in ("p1", "p2"):
                if not proc_key:
                    continue
                blk = find_proc_block(srcs[k], proc_key)
                if blk[0] >= 0:
                    targets.append((k, blk))
        if not targets:
            missed.append(eid)
            continue

        def try_apply(field: str, old: str, new: str) -> bool:
            if not old or old == new:
                return False
            for fkey, blk in targets:
                new_src, ok = apply_in_block(srcs[fkey], blk, old, new)
                if ok:
                    srcs[fkey] = new_src
                    # Block coordinates change after substitution if length differs.
                    # Re-locate the block for any subsequent fields in this same entry.
                    if proc_key and not is_ts:
                        # update targets for this same procedure
                        new_blk = find_proc_block(srcs[fkey], proc_key)
                        targets[targets.index((fkey, blk))] = (fkey, new_blk)
                    return True
            return False

        ok_hi = ok_gu = False
        if r["changed_hi"] and r["old_hi"]:
            ok_hi = try_apply("hi", r["old_hi"], r["new_hi"])
            if ok_hi:
                applied_hi += 1
        if r["changed_gu"] and r["old_gu"]:
            ok_gu = try_apply("gu", r["old_gu"], r["new_gu"])
            if ok_gu:
                applied_gu += 1
        if (r["changed_hi"] and not ok_hi) or (r["changed_gu"] and not ok_gu):
            missed.append(eid)

    # Write back
    for k, p in FILES.items():
        p.write_text(srcs[k], encoding="utf-8")
        print(f"  saved → {p}")
    print(f"\nHindi corrections applied:    {applied_hi}")
    print(f"Gujarati corrections applied: {applied_gu}")
    print(f"Still missed: {len(missed)}")
    if missed[:10]:
        print("  examples:", missed[:10])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
