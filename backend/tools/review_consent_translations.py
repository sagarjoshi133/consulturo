"""
ConsultUro — Hindi & Gujarati consent translation reviewer.

One-off offline script. Iterates every trilingual entry in:
  • backend/data/consent_procedures.py
  • backend/data/consent_procedures_part2.py
  • frontend/src/consent-pdf.ts  (COMMON_RISKS + DECLARATION)

For each entry the script sends (English source · current Hindi ·
current Gujarati) to Gemini 2.5 Pro with a focused medical-Hindi/
Gujarati editor system prompt, asks for grammatically + medically
corrected versions in MIXED REGISTER (keep widely-understood English
terms like "TURP", "catheter", "ureter" inline rather than aggressively
re-translating to obscure shuddh Hindi), and writes a JSON corrections
report to /app/backend/tools/translation_corrections.json so the diffs
can be reviewed before applying.

Run:
    cd /app/backend && python -m tools.review_consent_translations
        [--apply]            # apply corrections to source files
        [--limit N]          # only first N entries (debug)
        [--start N]          # resume from entry N (recover from crash)
        [--report-only]      # default — only produce JSON, don't edit
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Tuple

from dotenv import load_dotenv

# Ensure repo root on sys.path so we can import the data modules.
HERE = Path(__file__).resolve().parent
APP_DIR = HERE.parent  # /app/backend
sys.path.insert(0, str(APP_DIR))

load_dotenv(APP_DIR / ".env")

EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
if not EMERGENT_KEY:
    raise RuntimeError("EMERGENT_LLM_KEY missing from backend/.env")

from emergentintegrations.llm.chat import LlmChat, UserMessage  # noqa: E402

# ─── Data sources ──────────────────────────────────────────────
from data.consent_procedures import PROCEDURES  # noqa: E402
from data.consent_procedures_part2 import PROCEDURES_PART2  # noqa: E402

ALL_PROCS: List[Dict[str, Any]] = PROCEDURES + PROCEDURES_PART2

# ─── System prompt ─────────────────────────────────────────────
SYSTEM_PROMPT = """You are a senior medical translator and copy-editor specialising in Indian patient-facing surgical-consent documents.

Your task: given an English source string and existing Hindi (Devanagari) + Gujarati translations of it, return corrected Hindi and Gujarati translations.

STYLE RULES (very important — follow strictly):
1. MIXED REGISTER. Keep widely-understood English medical terms inline (TURP, HoLEP, catheter, ureter, prostate, biopsy, transfusion, anaesthesia, ICU, MRI, CT, USG, antibiotic, laser, embolisation, percutaneous, stent, fistula, etc.) — do NOT replace them with obscure shuddh-Hindi/Sanskritised terms (avoid पुरःस्थ ग्रंथि, मूत्र वाहिनी, etc.). This is how clinicians actually speak with North-Indian and Gujarati patients.
2. Use simple sentence structure that a non-medical reader can follow. Active voice preferred.
3. Preserve the meaning, percentages, time spans, and clinical caveats EXACTLY. Do not drop or add clinical content.
4. Hindi uses Devanagari; Gujarati uses Gujarati script. Use proper punctuation (। for Hindi sentence-final, . for Gujarati).
5. Keep the translation roughly the same length as the English (do not over-elaborate).
6. Numbers (60-80%, 1-2 days, etc.) should be in Arabic numerals, identical to the English.
7. If the existing translation is already correct, return it UNCHANGED — do not "improve" perfectly good text.

OUTPUT FORMAT (strict): return ONLY a JSON object with exactly these keys, nothing else (no markdown fences, no commentary):
{
  "hi": "<corrected Hindi string>",
  "gu": "<corrected Gujarati string>",
  "changed_hi": <true|false>,
  "changed_gu": <true|false>,
  "reason": "<one short sentence — only if anything changed, else empty>"
}
"""


def make_chat(session_id: str, model: str = "gemini-2.5-pro") -> LlmChat:
    return LlmChat(
        api_key=EMERGENT_KEY,
        session_id=session_id,
        system_message=SYSTEM_PROMPT,
    ).with_model("gemini", model)


# ─── Reviewer ──────────────────────────────────────────────────
async def review_triplet(en: str, hi: str, gu: str, context_label: str, model: str = "gemini-2.5-pro") -> Dict[str, Any]:
    """Return reviewer dict {hi, gu, changed_hi, changed_gu, reason} for one triplet."""
    chat = make_chat(session_id=f"consent-rev-{context_label}-{int(time.time() * 1000)}", model=model)
    msg = UserMessage(
        text=(
            f"Context: {context_label}\n\n"
            f"English source:\n{en}\n\n"
            f"Current Hindi:\n{hi}\n\n"
            f"Current Gujarati:\n{gu}\n\n"
            "Return only the JSON object as specified."
        ),
    )
    try:
        raw = await chat.send_message(msg)
    except Exception as e:
        return {
            "hi": hi, "gu": gu,
            "changed_hi": False, "changed_gu": False,
            "reason": f"LLM error: {e}",
            "_error": True,
        }
    # Strip optional ```json fences
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        # Some models occasionally return JSON with trailing prose.
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if not m:
            return {
                "hi": hi, "gu": gu,
                "changed_hi": False, "changed_gu": False,
                "reason": f"JSON parse failed: {text[:160]!r}",
                "_error": True,
            }
        try:
            data = json.loads(m.group(0))
        except Exception as e:
            return {
                "hi": hi, "gu": gu,
                "changed_hi": False, "changed_gu": False,
                "reason": f"JSON parse failed: {e}",
                "_error": True,
            }
    # Coerce
    new_hi = (data.get("hi") or "").strip()
    new_gu = (data.get("gu") or "").strip()
    # If the model returns empty (defensive), fall back to original.
    if not new_hi:
        new_hi = hi
    if not new_gu:
        new_gu = gu
    return {
        "hi": new_hi,
        "gu": new_gu,
        "changed_hi": new_hi != hi,
        "changed_gu": new_gu != gu,
        "reason": (data.get("reason") or "").strip(),
    }


# ─── Entry enumeration ────────────────────────────────────────
def enumerate_entries() -> List[Tuple[str, str, str, str]]:
    """Yield (entry_id, context_label, en, hi, gu) tuples — every
    trilingual entry across the procedures DB."""
    rows: List[Tuple[str, str, str, str, str]] = []
    # 1) Boilerplate common risks + declaration are in the frontend
    #    TS file. We hardcode them here (read once below) and review.
    rows.extend(_consent_pdf_ts_entries())
    # 2) Procedures
    for proc in ALL_PROCS:
        key = proc["key"]
        # name
        n = proc.get("name", {})
        if n.get("en"):
            rows.append((f"{key}.name", f"{key} · name", n.get("en", ""), n.get("hi", ""), n.get("gu", "")))
        # procedure description
        p = proc.get("procedure", {})
        if p.get("en"):
            rows.append((f"{key}.procedure", f"{key} · procedure description", p.get("en", ""), p.get("hi", ""), p.get("gu", "")))
        # alternatives
        a = proc.get("alternatives", {})
        if a.get("en"):
            rows.append((f"{key}.alternatives", f"{key} · alternatives", a.get("en", ""), a.get("hi", ""), a.get("gu", "")))
        # specific risks
        for i, r in enumerate(proc.get("specific_risks", [])):
            if r.get("en"):
                rows.append((
                    f"{key}.specific_risks[{i}]",
                    f"{key} · specific risk #{i + 1}",
                    r.get("en", ""), r.get("hi", ""), r.get("gu", ""),
                ))
    return rows


def _consent_pdf_ts_entries() -> List[Tuple[str, str, str, str, str]]:
    """Parse COMMON_RISKS arrays and DECLARATION strings out of the
    TypeScript file using a tolerant regex (single source of truth
    is the TS file itself so we don't drift)."""
    ts_path = Path("/app/frontend/src/consent-pdf.ts")
    src = ts_path.read_text(encoding="utf-8")

    # Extract COMMON_RISKS arrays for each lang
    def grab_array(lang: str) -> List[str]:
        # match `  en: [   ...   ],`
        m = re.search(
            rf"COMMON_RISKS:[^=]*=\s*\{{[\s\S]*?{lang}:\s*\[(?P<body>[\s\S]*?)\][,\s]*",
            src,
        )
        if not m:
            # Fallback: search per-lang block
            m = re.search(rf"\s{lang}:\s*\[(?P<body>[\s\S]*?)\],", src)
            if not m:
                return []
        body = m.group("body")
        return re.findall(r"'((?:\\.|[^'\\])*)'", body) + re.findall(
            r'"((?:\\.|[^"\\])*)"', body
        )

    en_arr = grab_array("en")
    hi_arr = grab_array("hi")
    gu_arr = grab_array("gu")
    out: List[Tuple[str, str, str, str, str]] = []
    if en_arr and hi_arr and gu_arr and len(en_arr) == len(hi_arr) == len(gu_arr):
        for i, (en, hi, gu) in enumerate(zip(en_arr, hi_arr, gu_arr)):
            out.append((
                f"COMMON_RISKS[{i}]",
                f"common_risks · #{i + 1}",
                en, hi, gu,
            ))
    # DECLARATION block
    decl_m = re.search(
        r"DECLARATION:[^=]*=\s*\{(?P<body>[\s\S]*?)\};",
        src,
    )
    if decl_m:
        body = decl_m.group("body")

        def grab_decl(lang: str) -> str:
            m = re.search(
                rf"{lang}:\s*'((?:\\.|[^'\\])*)'",
                body,
            )
            return m.group(1) if m else ""

        en, hi, gu = grab_decl("en"), grab_decl("hi"), grab_decl("gu")
        if en and hi and gu:
            out.append(("DECLARATION", "declaration of consent", en, hi, gu))
    return out


# ─── Runner ───────────────────────────────────────────────────
async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true",
                    help="Apply corrections back to source files.")
    ap.add_argument("--report-only", action="store_true",
                    help="Default — only produce JSON report.")
    ap.add_argument("--limit", type=int, default=0,
                    help="Only review first N entries (debug).")
    ap.add_argument("--start", type=int, default=0,
                    help="Resume from entry index N.")
    ap.add_argument("--concurrency", type=int, default=4,
                    help="Parallel Gemini calls (default 4).")
    ap.add_argument("--out", type=str,
                    default=str(HERE / "translation_corrections.json"))
    ap.add_argument("--model", type=str, default="gemini-2.5-pro",
                    help="Gemini model: gemini-2.5-pro, gemini-2.5-flash, gemini-3-flash-preview")
    ap.add_argument("--checkpoint", type=str,
                    default=str(HERE / "translation_corrections.jsonl"),
                    help="Path to JSONL checkpoint file (one result per line, written incrementally).")
    ap.add_argument("--resume", action="store_true",
                    help="Skip entries whose id already appears in the checkpoint file.")
    args = ap.parse_args()

    entries = enumerate_entries()
    if args.limit:
        entries = entries[args.start : args.start + args.limit]
    elif args.start:
        entries = entries[args.start:]

    # Resume support — skip entries that already appear in the
    # checkpoint JSONL file so a crash can resume cheaply.
    done_ids: set = set()
    prior_results: List[Dict[str, Any]] = []
    ckpt_path = Path(args.checkpoint)
    if args.resume and ckpt_path.exists():
        for line in ckpt_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                r = json.loads(line)
                done_ids.add(r["id"])
                prior_results.append(r)
            except Exception:
                continue
        print(f"Resume: {len(done_ids)} entries already in checkpoint")
        entries = [e for e in entries if e[0] not in done_ids]
    else:
        # Truncate the checkpoint at the start of a fresh run.
        ckpt_path.write_text("", encoding="utf-8")

    print(f"Reviewing {len(entries)} trilingual entries with {args.model} …")

    sem = asyncio.Semaphore(args.concurrency)
    ckpt_lock = asyncio.Lock()

    async def go(idx: int, e: Tuple[str, str, str, str, str]) -> Dict[str, Any]:
        eid, ctx, en, hi, gu = e
        async with sem:
            result = await review_triplet(en, hi, gu, ctx, model=args.model)
            tag = ""
            if result.get("_error"):
                tag = "  [ERROR]"
            elif result["changed_hi"] or result["changed_gu"]:
                flags = []
                if result["changed_hi"]:
                    flags.append("HI")
                if result["changed_gu"]:
                    flags.append("GU")
                tag = f"  [{'+'.join(flags)}]"
            print(f"  [{idx + 1:>3}/{len(entries)}] {eid:<48s}{tag}", flush=True)
            entry_result = {
                "id": eid,
                "context": ctx,
                "en": en,
                "old_hi": hi,
                "old_gu": gu,
                "new_hi": result["hi"],
                "new_gu": result["gu"],
                "changed_hi": result["changed_hi"],
                "changed_gu": result["changed_gu"],
                "reason": result.get("reason", ""),
                "error": result.get("_error", False),
            }
            # Persist to checkpoint immediately so a crash never loses
            # more than one entry's worth of work.
            async with ckpt_lock:
                with ckpt_path.open("a", encoding="utf-8") as fh:
                    fh.write(json.dumps(entry_result, ensure_ascii=False) + "\n")
            return entry_result

    tasks = [go(i, e) for i, e in enumerate(entries)]
    new_results = await asyncio.gather(*tasks)
    # Merge with any resumed prior results
    results = prior_results + new_results

    # Stats
    changed = [r for r in results if r["changed_hi"] or r["changed_gu"]]
    errors = [r for r in results if r["error"]]
    print(f"\nReviewed: {len(results)}   Changed: {len(changed)}   Errors: {len(errors)}")

    # Write report
    Path(args.out).write_text(
        json.dumps(results, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"Report written → {args.out}")

    if args.apply and not args.report_only:
        apply_corrections(results)
        print("Applied corrections to source files.")

    return 0 if not errors else 1


# ─── Corrections applier ──────────────────────────────────────
def apply_corrections(results: List[Dict[str, Any]]) -> None:
    """Replace old_hi / old_gu strings in their respective source files
    with new_hi / new_gu. Only acts on entries marked changed."""
    files = {
        "consent_procedures.py": Path("/app/backend/data/consent_procedures.py"),
        "consent_procedures_part2.py": Path("/app/backend/data/consent_procedures_part2.py"),
        "consent-pdf.ts": Path("/app/frontend/src/consent-pdf.ts"),
    }
    sources = {k: p.read_text(encoding="utf-8") for k, p in files.items()}

    def replace_in_any(old: str, new: str) -> bool:
        """Replace the first occurrence of `old` in any source file
        (the strings are long enough that collisions are extremely
        unlikely; we sanity-check uniqueness)."""
        for k, txt in sources.items():
            # Escape quotes / backslashes for Python string literal
            # search. We search for the bare string content; quotes
            # surrounding it (either `"..."` or `'...'`) come from the
            # source file's own syntax.
            if old in txt:
                count = txt.count(old)
                if count > 1:
                    print(f"  WARN: '{old[:50]}…' occurs {count}× in {k}; skipping (manual review)")
                    return False
                sources[k] = txt.replace(old, new, 1)
                return True
        return False

    for r in results:
        if not (r["changed_hi"] or r["changed_gu"]):
            continue
        if r["changed_hi"] and r["old_hi"]:
            ok = replace_in_any(r["old_hi"], r["new_hi"])
            if not ok:
                print(f"  MISS hi: {r['id']} (string not found uniquely)")
        if r["changed_gu"] and r["old_gu"]:
            ok = replace_in_any(r["old_gu"], r["new_gu"])
            if not ok:
                print(f"  MISS gu: {r['id']} (string not found uniquely)")

    for k, p in files.items():
        p.write_text(sources[k], encoding="utf-8")
        print(f"  saved → {p}")


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
