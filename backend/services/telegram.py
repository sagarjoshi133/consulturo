"""ConsultUro — Telegram audit relay.

`notify_telegram(text)` posts an admin alert to the configured
Telegram bot/chat. Used for sign-up notifications, errors, and
high-signal audit events. Failures are logged but never raised.
"""
import os
import logging

import httpx
from dotenv import load_dotenv

load_dotenv()
log = logging.getLogger(__name__)

TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
# Match server.py canonical env-var name (some deployments still use
# the older TELEGRAM_CHAT_ID — fall back so we don't break legacy).
TELEGRAM_OWNER_CHAT_ID = (
    os.environ.get("TELEGRAM_OWNER_CHAT_ID")
    or os.environ.get("TELEGRAM_CHAT_ID")
    or ""
)


async def notify_telegram(text: str) -> None:
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_OWNER_CHAT_ID:
        return
    try:
        async with httpx.AsyncClient(timeout=6.0) as hc:
            await hc.post(
                f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
                json={
                    "chat_id": TELEGRAM_OWNER_CHAT_ID,
                    "text": text,
                    "parse_mode": "HTML",
                    "disable_web_page_preview": True,
                },
            )
    except Exception:
        pass
