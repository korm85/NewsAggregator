import logging
import requests
import config

log = logging.getLogger(__name__)

_API = f"https://api.telegram.org/bot{{}}/sendMessage"


def publish(text: str, source_channel: str) -> bool:
    url = _API.format(config.BOT_TOKEN)
    caption = f'<a href="https://t.me/{source_channel.lstrip("@")}">via {source_channel}</a>'
    payload = {
        "chat_id": config.OUTPUT_CHANNEL_ID,
        "text": f"{text}\n\n{caption}",
        "parse_mode": "HTML",
        "disable_web_page_preview": False,
    }
    try:
        resp = requests.post(url, json=payload, timeout=10)
        resp.raise_for_status()
        return True
    except requests.RequestException as e:
        log.error("Failed to send message: %s", e)
        return False
