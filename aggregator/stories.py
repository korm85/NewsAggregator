import json
import time
import uuid
from pathlib import Path

STORIES_FILE = Path("state/stories.json")
_STORY_TTL_HOURS = 72   # drop stories older than 3 days


def load() -> dict:
    if STORIES_FILE.exists():
        try:
            return json.loads(STORIES_FILE.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def save(stories: dict) -> None:
    STORIES_FILE.parent.mkdir(exist_ok=True)
    STORIES_FILE.write_text(json.dumps(stories, ensure_ascii=False, indent=2))


def prune(stories: dict) -> dict:
    cutoff = time.time() - _STORY_TTL_HOURS * 3600
    return {k: v for k, v in stories.items() if v.get("last_updated", 0) > cutoff}


def record(stories: dict, story_id: str | None, topic: str, text: str) -> str:
    """Add article to an existing story or create a new one. Returns the story id."""
    now = time.time()
    if story_id and story_id in stories:
        stories[story_id]["article_count"] += 1
        stories[story_id]["last_updated"] = now
        return story_id

    new_id = uuid.uuid4().hex[:8]
    stories[new_id] = {
        "topic": topic,
        "summary": text[:200],
        "article_count": 1,
        "first_seen": now,
        "last_updated": now,
    }
    return new_id
