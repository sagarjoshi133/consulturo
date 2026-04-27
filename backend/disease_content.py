"""Trilingual diseases content (loaded from _diseases_trilingual.json)."""
import json
from pathlib import Path

_JSON_PATH = Path(__file__).parent / "_diseases_trilingual.json"
_DATA = json.loads(_JSON_PATH.read_text())

_TEXT_FIELDS = ["name", "tagline", "overview", "when_to_see"]
_LIST_FIELDS = ["symptoms", "causes", "treatments"]


def _localize(item: dict, lang: str) -> dict:
    out = {"id": item["id"], "icon": item.get("icon"), "image": item.get("image")}
    for f in _TEXT_FIELDS + _LIST_FIELDS:
        obj = item.get(f, {})
        if isinstance(obj, dict):
            out[f] = obj.get(lang) or obj.get("en") or ""
        else:
            out[f] = obj
    return out


def list_localized(lang: str = "en"):
    return [_localize(d, lang) for d in _DATA]


def get_localized(did: str, lang: str = "en"):
    for d in _DATA:
        if d["id"] == did:
            return _localize(d, lang)
    return None
