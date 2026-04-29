"""ConsultUro — Email helper (Resend).

Single function `_send_email(to, subject, html)` — wraps the Resend
HTTP API. Called by auth (magic links / OTP) and team management
(invite + role-change notifications).
"""
import os
import json
import logging
from typing import Optional

import requests
from dotenv import load_dotenv

load_dotenv()
log = logging.getLogger(__name__)

RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
RESEND_FROM    = os.environ.get("RESEND_FROM_EMAIL", "ConsultUro <noreply@consulturo.com>")


def _send_email(to: str, subject: str, html: str) -> bool:
    """Send a transactional email via Resend.

    NOTE: Resend's default test sender (`onboarding@resend.dev`) is
    restricted — it can ONLY deliver to the email address registered on
    the Resend account. To send OTPs / magic-links to arbitrary users,
    a verified custom domain must be set up at https://resend.com/domains
    and `RESEND_FROM_EMAIL` updated to `noreply@<your-domain>`.
    """
    if not _resend.api_key:
        try:
            print(f"[resend] no API key configured — skipping send to={to}")
        except Exception:
            pass
        return False
    try:
        resp = _resend.Emails.send({
            "from": RESEND_FROM,
            "to": [to],
            "subject": subject,
            "html": html,
        })
        try:
            # Resend returns {"id": "..."} on success; log it so we can
            # correlate later in the Resend dashboard / debug stuck mail.
            print(f"[resend] sent ok to={to} id={resp.get('id') if isinstance(resp, dict) else resp}")
        except Exception:
            pass
        return True
    except Exception as e:
        try:
            # Always surface the full error message so test-mode
            # restrictions ("you can only send to your own email") are
            # visible in supervisor logs instead of failing silently.
            print(f"[resend] send failed to={to}: {type(e).__name__}: {e}")
        except Exception:
            pass
        return False
