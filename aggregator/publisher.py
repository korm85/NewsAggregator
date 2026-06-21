import logging
import requests
import config

log = logging.getLogger(__name__)

_SEND = f"https://api.telegram.org/bot{{}}/sendMessage"
_MAX_LEN = 4000


def publish(text: str, source_channel: str) -> bool:
    handle = source_channel.lstrip("@")
    footer = f'\n\n<a href="https://t.me/{handle}">via @{handle}</a>'

    # Truncate if needed to stay within Telegram's 4096 char limit
    if len(text) + len(footer) > _MAX_LEN:
        text = text[: _MAX_LEN - len(footer) - 3] + "..."

    payload = {
        "chat_id": config.OUTPUT_CHANNEL_ID,
        "text": text + footer,
        "parse_mode": "HTML",
        "disable_web_page_preview": False,
        "disable_notification": False,
    }
    try:
        resp = requests.post(_SEND.format(config.BOT_TOKEN), json=payload, timeout=10)
        resp.raise_for_status()
        return True
    except requests.RequestException as e:
        log.error("Failed to send message: %s", e)
        return False
