"""
Calls Claude to cluster new articles into story threads and generate
one-line context headers so the output channel reads as narrative, not
a list of disconnected headlines.
"""
import json
import logging
import anthropic
import config

log = logging.getLogger(__name__)

_MODEL = "claude-haiku-4-5-20251001"


def _build_prompt(articles: list[dict], active_stories: dict) -> str:
    if active_stories:
        story_lines = "\n".join(
            f"- ID:{sid} | {s['topic']} | {s['article_count']} update(s) | {s['summary'][:120]}"
            for sid, s in list(active_stories.items())[-15:]
        )
    else:
        story_lines = "(none yet)"

    article_lines = "\n".join(
        f"[{a['index']}] source:{a['source']}\n{a['text'][:400]}"
        for a in articles
    )

    return f"""You are a news narrative analyst. Articles come from Middle East / Israeli news channels (Hebrew, Arabic, English mixed).

Active story threads (last 72h):
{story_lines}

New articles this cycle:
{article_lines}

For each article decide:
1. Does it continue an active story (2+ shared entities / topic)? If yes, use its ID.
2. Or is it a genuinely new story?

Reply with a JSON array only — no prose, no markdown fences:
[
  {{
    "index": 0,
    "existing_story_id": "<id>" or null,
    "story_topic": "<3-6 word English topic label>",
    "context_line": "<single line, max 90 chars, e.g. 'Update 3: Hamas rejects latest proposal'>",
    "is_update": true
  }},
  ...
]"""


def analyze(articles: list[dict], active_stories: dict) -> list[dict]:
    """
    articles: [{"index": int, "text": str, "source": str}]
    Returns list of analysis dicts, one per article.
    Falls back to plain-forward dicts on any error.
    """
    if not config.ANTHROPIC_API_KEY:
        return _fallback(articles)

    client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)
    try:
        resp = client.messages.create(
            model=_MODEL,
            max_tokens=1024,
            messages=[{"role": "user", "content": _build_prompt(articles, active_stories)}],
        )
        raw = resp.content[0].text.strip()
        result = json.loads(raw)
        return result
    except Exception as e:
        log.error("Narrator error: %s", e)
        return _fallback(articles)


def _fallback(articles: list[dict]) -> list[dict]:
    return [
        {"index": a["index"], "existing_story_id": None,
         "story_topic": None, "context_line": None, "is_update": False}
        for a in articles
    ]
