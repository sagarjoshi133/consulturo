"""
One-off batch translator.
Pulls DISEASES list from backend/server.py, asks Claude Sonnet 4.5 to produce
Hindi + Gujarati translations for every text field, and writes the result to
backend/disease_content.py as a Python dict.

Run once: python /app/backend/_translate_diseases.py
"""
import asyncio
import json
import os
import re
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

# Make the backend importable
sys.path.insert(0, "/app/backend")

import server  # noqa: E402

from emergentintegrations.llm.chat import LlmChat, UserMessage  # noqa: E402

API_KEY = os.environ["EMERGENT_LLM_KEY"]

# Fields that need translation
TEXT_FIELDS = ["name", "tagline", "overview", "when_to_see"]
LIST_FIELDS = ["symptoms", "causes", "treatments"]

SYSTEM = (
    "You are an expert medical translator. You will receive a urology disease description "
    "in English (as a JSON object) and you MUST return a JSON object with ONLY the "
    "Hindi and Gujarati translations.\n\n"
    "Rules:\n"
    "- Return ONLY strict valid JSON. NO markdown fences. NO prose outside the JSON.\n"
    "- Preserve medical accuracy. Keep well-known medical abbreviations in English "
    "(BPH, PSA, URS, PCNL, ESWL, UTI, CKD, AKI, IPSS, etc.).\n"
    "- Keep the SAME number of items in each list.\n"
    "- Use patient-friendly Hindi (hi-IN, Devanagari) and Gujarati (gu-IN, Gujarati script).\n"
    "- Output schema:\n"
    "{\n"
    '  "hi": { "name": "...", "tagline": "...", "overview": "...", "when_to_see": "...",\n'
    '          "symptoms": [...], "causes": [...], "treatments": [...] },\n'
    '  "gu": { ...same keys... }\n'
    "}\n"
)


async def translate_one(d: dict) -> dict:
    payload = {k: d.get(k, "") for k in TEXT_FIELDS + LIST_FIELDS}
    msg = UserMessage(text="INPUT:\n" + json.dumps(payload, ensure_ascii=False, indent=2))

    chat = (
        LlmChat(api_key=API_KEY, session_id=f"dis-{d['id']}", system_message=SYSTEM)
        .with_model("anthropic", "claude-sonnet-4-5-20250929")
    )
    resp = await chat.send_message(msg)
    # Strip any accidental code fences
    s = resp.strip()
    if s.startswith("```"):
        s = re.sub(r"^```[a-zA-Z]*\n?|```$", "", s.strip(), flags=re.M).strip()
    return json.loads(s)


async def main():
    items = server.DISEASES
    print(f"Translating {len(items)} diseases…")

    # Preserve original top-level entries (id, icon, image) and add localized fields as
    # {en:..., hi:..., gu:...}
    results = []
    for i, d in enumerate(items):
        try:
            tr = await translate_one(d)
        except Exception as e:  # pragma: no cover
            print(f"  ❌ {i+1}/{len(items)} {d['id']}: {e}")
            # Fall back: copy English into both.
            tr = {
                "hi": {k: d.get(k, "") for k in TEXT_FIELDS + LIST_FIELDS},
                "gu": {k: d.get(k, "") for k in TEXT_FIELDS + LIST_FIELDS},
            }
        row = {
            "id": d["id"],
            "icon": d.get("icon"),
            "image": d.get("image"),
        }
        for f in TEXT_FIELDS + LIST_FIELDS:
            row[f] = {
                "en": d.get(f, ""),
                "hi": tr["hi"].get(f, d.get(f, "")),
                "gu": tr["gu"].get(f, d.get(f, "")),
            }
        results.append(row)
        print(f"  ✅ {i+1}/{len(items)} {d['id']}")

    out = Path("/app/backend/_diseases_trilingual.json")
    out.write_text(json.dumps(results, ensure_ascii=False, indent=2))
    print(f"\nSaved {out} ({len(results)} diseases)")


if __name__ == "__main__":
    asyncio.run(main())
