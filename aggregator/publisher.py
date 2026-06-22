import time
import logging
import requests
import config

log = logging.getLogger(__name__)

_SEND = "https://api.telegram.org/bot{token}/sendMessage"
_MAX_LEN = 4000
_DELAY = 1.5       # seconds between successful sends
_MAX_RETRIES = 2   # retries for network errors only
_MAX_RATE_WAIT = 60  # if Telegram asks us to wait longer than this, skip the message


def publish(text: str, source_channel: str,
            story_topic: str | None = None,
            context_line: str | None = None,
            is_update: bool = False) -> bool:

    handle = source_channel.lstrip("@")
    footer = f'\n\n<a href="https://t.me/{handle}">via @{handle}</a>'

    if story_topic and is_update and context_line:
        header = f"🔄 <b>{story_topic}</b>\n<i>{context_line}</i>\n\n"
    elif story_topic:
        header = f"🔵 <b>{story_topic}</b>\n\n"
    else:
        header = ""

    body = header + text + footer
    if len(body) > _MAX_LEN:
        trim = len(body) - _MAX_LEN + 3
        text = text[:-trim] + "..."
        body = header + text + footer

    payload = {
        "chat_id": config.OUTPUT_CHANNEL_ID,
        "text": body,
        "parse_mode": "HTML",
        "disable_web_page_preview": False,
    }
    url = _SEND.format(token=config.BOT_TOKEN)

    # Handle rate limiting separately from network retries
    for attempt in range(_MAX_RETRIES + 1):
        try:
            resp = requests.post(url, json=payload, timeout=10)
            if resp.status_code == 429:
                wait = resp.json().get("parameters", {}).get("retry_after", 10)
                if wait > _MAX_RATE_WAIT:
                    log.warning("Rate limit wait too long (%ds) — skipping message", wait)
                    return False
                log.warning("Rate limited — waiting %ds", wait)
                time.sleep(wait)
                continue  # one rate-limit retry, doesn't count against _MAX_RETRIES
            resp.raise_for_status()
            time.sleep(_DELAY)
            return True
        except requests.RequestException as e:
            if attempt < _MAX_RETRIES:
                log.warning("Send failed, retrying: %s", e)
                time.sleep(2 ** attempt)
            else:
                log.error("Send failed after %d attempts: %s", _MAX_RETRIES + 1, e)

    return False
