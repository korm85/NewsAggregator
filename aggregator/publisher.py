import time
import logging
import requests
import config

log = logging.getLogger(__name__)

_SEND = "https://api.telegram.org/bot{token}/sendMessage"
_MAX_LEN = 4000
_DELAY = 1.5      # seconds between messages (Telegram allows ~1/sec per chat)
_MAX_RETRIES = 3


def publish(text: str, source_channel: str) -> bool:
    handle = source_channel.lstrip("@")
    footer = f'\n\n<a href="https://t.me/{handle}">via @{handle}</a>'

    if len(text) + len(footer) > _MAX_LEN:
        text = text[: _MAX_LEN - len(footer) - 3] + "..."

    payload = {
        "chat_id": config.OUTPUT_CHANNEL_ID,
        "text": text + footer,
        "parse_mode": "HTML",
        "disable_web_page_preview": False,
    }
    url = _SEND.format(token=config.BOT_TOKEN)

    for attempt in range(_MAX_RETRIES):
        try:
            resp = requests.post(url, json=payload, timeout=10)
            if resp.status_code == 429:
                wait = resp.json().get("parameters", {}).get("retry_after", 30)
                log.warning("Rate limited — waiting %ds", wait)
                time.sleep(wait)
                continue
            resp.raise_for_status()
            time.sleep(_DELAY)
            return True
        except requests.RequestException as e:
            log.error("Send failed (attempt %d): %s", attempt + 1, e)
            time.sleep(2 ** attempt)

    return False
