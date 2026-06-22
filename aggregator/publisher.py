import time
import logging
import requests
import config

log = logging.getLogger(__name__)

_SEND = "https://api.telegram.org/bot{token}/sendMessage"
_MAX_LEN = 4000
_DELAY = 1.5      # seconds between messages (Telegram allows ~1/sec per chat)
_MAX_RETRIES = 3


def publish(text: str, source_channel: str,
            story_topic: str | None = None,
            is_update: bool = False) -> bool:

    handle = source_channel.lstrip("@")
    footer = f"\n\nvia @{handle}"

    prefix = f"[{story_topic}] " if story_topic else ""

    body = prefix + text + footer
    if len(body) > _MAX_LEN:
        trim = len(body) - _MAX_LEN + 3
        text = text[:-trim] + "..."
        body = prefix + text + footer

    payload = {
        "chat_id": config.OUTPUT_CHANNEL_ID,
        "text": body,
        "disable_web_page_preview": True,
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
