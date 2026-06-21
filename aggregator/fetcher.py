"""
Fetches recent posts from public Telegram channels via t.me/s/<channel>.
No API keys or authentication required.
"""
import re
import time
import logging
from html.parser import HTMLParser
import requests

log = logging.getLogger(__name__)

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; NewsAggregator/1.0)",
    "Accept-Language": "en-US,en;q=0.9",
}
_TIMEOUT = 15


class _PostParser(HTMLParser):
    """Extracts visible text from tgme_widget_message_text divs."""

    def __init__(self) -> None:
        super().__init__()
        self._in_text = 0
        self._current: list[str] = []
        self.posts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list) -> None:
        classes = dict(attrs).get("class", "")
        if tag == "div" and "tgme_widget_message_text" in classes:
            self._in_text += 1
        elif self._in_text and tag == "br":
            self._current.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if self._in_text and tag == "div":
            self._in_text -= 1
            if self._in_text == 0 and self._current:
                text = "".join(self._current).strip()
                if text:
                    self.posts.append(text)
                self._current = []

    def handle_data(self, data: str) -> None:
        if self._in_text:
            self._current.append(data)

    def handle_entityref(self, name: str) -> None:
        if self._in_text:
            self._current.append(f"&{name};")


def fetch_channel(channel: str) -> list[str]:
    """Return up to 20 most recent post texts from a public channel."""
    handle = channel.lstrip("@")
    url = f"https://t.me/s/{handle}"
    try:
        resp = requests.get(url, headers=_HEADERS, timeout=_TIMEOUT)
        resp.raise_for_status()
    except requests.RequestException as e:
        log.error("Failed to fetch %s: %s", channel, e)
        return []

    parser = _PostParser()
    parser.feed(resp.text)
    return parser.posts
