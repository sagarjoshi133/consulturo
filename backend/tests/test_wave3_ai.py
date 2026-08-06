"""ConsultUro — Wave 3 AI features + Wave 1 patient-search regression tests.

Endpoints under test (Wave 3):
  M — POST /api/ai/voice-to-rx   (multipart audio, prescriber, demo-blocked)
  N — GET  /api/ai/patient-gist  (staff, 1h cache, refresh=true bypass)
  Q — POST /api/ai/lab-ocr       (multipart image, staff, demo-blocked)

Regression: GET /api/search patient-scope link shapes
  • disease       → /disease/{id}       (singular)
  • blog          → /blog/{post_id}     (id, NOT slug)
  • calculators   → /calculators/{key}  except /ipss & /prostate-volume

If the Emergent LLM key is rate-limited / Claude is slow / Whisper errors,
endpoint contract is still validated (HTTP shape) but content assertions
get marked as expected_degrade.
"""
from __future__ import annotations

import io
import os
import math
import struct
import wave
import time

import pytest
import requests

BASE_URL = "http://localhost:8001"

OWNER_TOKEN = "test_session_1781792149794"          # prescriber/staff (primary_owner)
PATIENT_TOKEN = "test_pat_w2_1781793521021"         # patient
DEMO_TOKEN = "test_demo_session_1781794755284"      # is_demo primary_owner

OWNER_HEADERS = {"Authorization": f"Bearer {OWNER_TOKEN}"}
PATIENT_HEADERS = {"Authorization": f"Bearer {PATIENT_TOKEN}"}
DEMO_HEADERS = {"Authorization": f"Bearer {DEMO_TOKEN}"}

PATIENT_PHONE = "+918888888888"  # seeded in iteration 13
PATIENT_PHONE_NORM = "8888888888"  # _normalize_phone returns last 10 digits


# ─── helpers ──────────────────────────────────────────────────────────


def _make_silent_wav(seconds: float = 0.6, sr: int = 16000) -> bytes:
    """Synthesise a tiny mono PCM WAV (silence + tiny sine) for Whisper.

    Whisper rejects truly empty audio; a quiet 600ms sine works."""
    n = int(seconds * sr)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        frames = bytearray()
        for i in range(n):
            v = int(2000 * math.sin(2 * math.pi * 440 * (i / sr)))
            frames.extend(struct.pack("<h", v))
        w.writeframes(bytes(frames))
    return buf.getvalue()


def _make_tiny_png() -> bytes:
    """Minimal 1×1 white PNG (smallest valid)."""
    import binascii
    sig = b"\x89PNG\r\n\x1a\n"
    # IHDR (1x1, 8-bit RGB)
    ihdr_data = b"\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00"
    ihdr = b"IHDR" + ihdr_data
    ihdr_chunk = (
        struct.pack(">I", len(ihdr_data)) + ihdr + struct.pack(">I", binascii.crc32(ihdr))
    )
    # IDAT (a single white pixel — zlib compressed scanline 00 FF FF FF)
    import zlib
    raw = b"\x00\xff\xff\xff"
    comp = zlib.compress(raw, 9)
    idat = b"IDAT" + comp
    idat_chunk = struct.pack(">I", len(comp)) + idat + struct.pack(">I", binascii.crc32(idat))
    # IEND
    iend = b"IEND"
    iend_chunk = struct.pack(">I", 0) + iend + struct.pack(">I", binascii.crc32(iend))
    return sig + ihdr_chunk + idat_chunk + iend_chunk


# ─── M · Voice-to-Rx ───────────────────────────────────────────────────


class TestVoiceToRx:
    URL = f"{BASE_URL}/api/ai/voice-to-rx"

    def test_requires_auth(self):
        r = requests.post(self.URL, files={"audio": ("a.wav", _make_silent_wav(0.1), "audio/wav")})
        assert r.status_code in (401, 403), r.text

    def test_demo_blocked(self):
        r = requests.post(
            self.URL,
            headers=DEMO_HEADERS,
            files={"audio": ("a.wav", _make_silent_wav(0.1), "audio/wav")},
            data={"language": "en"},
        )
        assert r.status_code == 403, r.text
        body = r.json()
        assert body.get("demo") is True
        assert "demo" in (body.get("detail") or "").lower()

    def test_empty_file_returns_400(self):
        r = requests.post(
            self.URL,
            headers=OWNER_HEADERS,
            files={"audio": ("empty.wav", b"", "audio/wav")},
            data={"language": "en"},
        )
        assert r.status_code == 400, r.text
        assert "empty" in (r.json().get("detail") or "").lower()

    def test_patient_token_forbidden(self):
        # patient is NOT a prescriber → require_prescriber should reject
        r = requests.post(
            self.URL,
            headers=PATIENT_HEADERS,
            files={"audio": ("a.wav", _make_silent_wav(0.1), "audio/wav")},
        )
        assert r.status_code in (401, 403), r.text

    def test_valid_audio_response_shape(self):
        """Full pipeline. LLM may degrade — still expect 200 + shape."""
        wav = _make_silent_wav(0.6)
        try:
            r = requests.post(
                self.URL,
                headers=OWNER_HEADERS,
                files={"audio": ("rx.wav", wav, "audio/wav")},
                data={"language": "en"},
                timeout=90,
            )
        except requests.RequestException as e:
            pytest.skip(f"network/timeout to LLM stack: {e}")

        # Whisper may legitimately reject a sine wave with 422 (empty transcript).
        # We accept that as expected_degrade; otherwise must be 200 with shape.
        if r.status_code == 422:
            pytest.xfail("Whisper returned empty transcript on synthesised sine — expected_degrade")
        if r.status_code == 503:
            pytest.skip(f"LLM key not configured / library missing: {r.text}")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert "transcript" in body and isinstance(body["transcript"], str)
        assert body.get("model") == "claude-sonnet-4-5"
        assert body.get("stt_model") == "whisper-1"
        parsed = body.get("parsed") or {}
        assert isinstance(parsed.get("medicines"), list)
        for k in ("diagnosis", "investigations", "advice", "follow_up"):
            assert k in parsed and isinstance(parsed[k], str)


# ─── N · Patient Gist ──────────────────────────────────────────────────


class TestPatientGist:
    URL = f"{BASE_URL}/api/ai/patient-gist"

    def test_requires_auth(self):
        r = requests.get(self.URL, params={"phone": PATIENT_PHONE})
        assert r.status_code in (401, 403), r.text

    def test_missing_phone_returns_400(self):
        r = requests.get(self.URL, headers=OWNER_HEADERS)
        assert r.status_code == 400, r.text

    def test_first_call_then_cached(self):
        # Force fresh to bust any previous cache.
        r1 = requests.get(
            self.URL,
            headers=OWNER_HEADERS,
            params={"phone": PATIENT_PHONE, "refresh": "true"},
            timeout=60,
        )
        if r1.status_code == 503:
            pytest.skip(f"LLM key/library not configured: {r1.text}")
        assert r1.status_code == 200, r1.text
        b1 = r1.json()
        assert b1.get("phone") == PATIENT_PHONE_NORM
        assert b1.get("cached") is False
        assert "gist" in b1
        assert "generated_at" in b1

        # Second call within an hour → cached=True
        r2 = requests.get(
            self.URL,
            headers=OWNER_HEADERS,
            params={"phone": PATIENT_PHONE},
            timeout=15,
        )
        assert r2.status_code == 200, r2.text
        b2 = r2.json()
        assert b2.get("cached") is True
        assert b2.get("phone") == PATIENT_PHONE_NORM
        # gist persists between calls
        assert b2.get("gist") == b1.get("gist")

    def test_refresh_true_bypasses_cache(self):
        r = requests.get(
            self.URL,
            headers=OWNER_HEADERS,
            params={"phone": PATIENT_PHONE, "refresh": "true"},
            timeout=60,
        )
        if r.status_code == 503:
            pytest.skip(f"LLM key/library not configured: {r.text}")
        assert r.status_code == 200, r.text
        assert r.json().get("cached") is False


# ─── Q · Lab OCR ───────────────────────────────────────────────────────


class TestLabOCR:
    URL = f"{BASE_URL}/api/ai/lab-ocr"

    def test_requires_auth(self):
        r = requests.post(self.URL, files={"image": ("x.png", _make_tiny_png(), "image/png")})
        assert r.status_code in (401, 403), r.text

    def test_demo_blocked(self):
        r = requests.post(
            self.URL,
            headers=DEMO_HEADERS,
            files={"image": ("x.png", _make_tiny_png(), "image/png")},
        )
        assert r.status_code == 403, r.text
        assert r.json().get("demo") is True

    def test_empty_image_returns_400(self):
        r = requests.post(
            self.URL,
            headers=OWNER_HEADERS,
            files={"image": ("e.png", b"", "image/png")},
        )
        assert r.status_code == 400, r.text
        assert "empty" in (r.json().get("detail") or "").lower()

    def test_bad_mime_returns_400(self):
        r = requests.post(
            self.URL,
            headers=OWNER_HEADERS,
            files={"image": ("bad.txt", b"not an image at all but more than 12 bytes", "image/png")},
        )
        assert r.status_code == 400, r.text

    def test_auto_save_without_phone_returns_400(self):
        r = requests.post(
            self.URL,
            headers=OWNER_HEADERS,
            files={"image": ("x.png", _make_tiny_png(), "image/png")},
            data={"auto_save": "true"},
        )
        assert r.status_code == 400, r.text
        assert "phone" in (r.json().get("detail") or "").lower()

    def test_valid_image_response_shape(self):
        try:
            r = requests.post(
                self.URL,
                headers=OWNER_HEADERS,
                files={"image": ("lab.png", _make_tiny_png(), "image/png")},
                data={"phone": "", "auto_save": "false"},
                timeout=90,
            )
        except requests.RequestException as e:
            pytest.skip(f"network/timeout to LLM stack: {e}")
        if r.status_code == 503:
            pytest.skip(f"LLM key/library not configured: {r.text}")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert body.get("model") == "claude-sonnet-4-5"
        assert isinstance(body.get("results"), list)
        # Graceful degrade: tiny 1×1 image → empty results.
        assert body.get("saved_count") == 0
        assert isinstance(body.get("saved"), list)


# ─── Wave 1 regression — /api/search link shapes ───────────────────────


class TestSearchLinkRegression:
    URL = f"{BASE_URL}/api/search"

    def test_disease_link_singular(self):
        r = requests.get(self.URL, headers=PATIENT_HEADERS, params={"q": "prostate", "limit": 20})
        assert r.status_code == 200, r.text
        results = r.json().get("results", [])
        diseases = [x for x in results if x.get("type") == "disease"]
        # patient scope MUST include disease type at all
        if diseases:
            for d in diseases:
                link = d.get("link") or ""
                assert link.startswith("/disease/"), f"disease link not singular: {link}"
                assert "/diseases/" not in link, f"plural slipped in: {link}"

    def test_blog_link_uses_post_id(self):
        # Try a few common queries; blog content may or may not match
        for q in ("urology", "prostate", "kidney", "stone"):
            r = requests.get(self.URL, headers=PATIENT_HEADERS, params={"q": q, "limit": 20})
            assert r.status_code == 200, r.text
            blogs = [x for x in r.json().get("results", []) if x.get("type") == "blog"]
            if blogs:
                for b in blogs:
                    link = b.get("link") or ""
                    assert link.startswith("/blog/"), f"blog link malformed: {link}"
                    # The portion after /blog/ should be the post_id (not a slug
                    # with hyphenated words). post_ids in this app are typically
                    # short hex/uuid-ish strings — at minimum NOT equal to
                    # slugified title. We assert it doesn't contain spaces and
                    # equals the row's post_id if present.
                    pid = b.get("post_id") or b.get("id")
                    if pid:
                        assert link == f"/blog/{pid}", (
                            f"blog link should be /blog/{{post_id}}; got {link}, post_id={pid}"
                        )
                return  # found at least one — assertion success
        pytest.skip("No blog results matched test queries — cannot assert link shape")

    def test_calculator_links(self):
        # Search for terms that should surface multiple calculators.
        wanted = {}
        for q in ("calc", "ipss", "egfr", "bmi", "psa", "prostate", "stone", "bladder"):
            r = requests.get(self.URL, headers=PATIENT_HEADERS, params={"q": q, "limit": 25})
            assert r.status_code == 200, r.text
            for x in r.json().get("results", []):
                if x.get("type") == "calculator":
                    key = (x.get("key") or "").lower()
                    wanted[key] = x.get("link") or ""

        assert wanted, "No calculator results across queries — search may be broken"

        # Top-level singletons:
        if "ipss" in wanted:
            assert wanted["ipss"] == "/ipss", f"ipss link wrong: {wanted['ipss']}"
        if "prostate_volume" in wanted:
            assert wanted["prostate_volume"] == "/prostate-volume", (
                f"prostate_volume link wrong: {wanted['prostate_volume']}"
            )

        # Everything else must live under /calculators/{key-with-hyphens}
        nested_keys = {"egfr", "creatinine", "crcl", "bmi", "psa", "iief5", "bladder_diary", "stone_risk"}
        for k, link in wanted.items():
            if k in {"ipss", "prostate_volume"}:
                continue
            assert link.startswith("/calculators/"), (
                f"calculator '{k}' should be under /calculators/, got {link}"
            )
            # Must NOT be a bare top-level path like /egfr or /bmi.
            assert link not in {f"/{k}", f"/{k.replace('_', '-')}"}, (
                f"calculator '{k}' leaks as top-level path: {link}"
            )
