"""
Entry point for the GitHub Actions cron job.
Fetches → deduplicates → narrates → publishes.
"""
import logging
import config
from aggregator import fetcher, dedup, narrator, publisher
from aggregator import state as state_store
from aggregator import stories as story_store

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger(__name__)


def main() -> None:
    state = state_store.load()
    dedup.prune(state)
    stories = story_store.load()
    stories = story_store.prune(stories)

    # ── 1. Fetch and deduplicate ──────────────────────────────────────────
    new_articles: list[dict] = []
    for channel in config.SOURCE_CHANNELS:
        log.info("Fetching %s", channel)
        posts = fetcher.fetch_channel(channel)
        log.info("  %d posts", len(posts))
        for text in posts:
            if not dedup.is_duplicate(text, state):
                new_articles.append({
                    "index": len(new_articles),
                    "text": text,
                    "source": channel,
                })

    log.info("%d unique articles this run", len(new_articles))
    if not new_articles:
        return

    # ── 2. Narrative analysis (skip for large catch-up runs) ─────────────
    if len(new_articles) <= config.NARRATIVE_BATCH_LIMIT and config.ANTHROPIC_API_KEY:
        log.info("Running narrative analysis via Claude...")
        analyses = narrator.analyze(new_articles, stories)
        analysis_map = {a["index"]: a for a in analyses}
    else:
        if not config.ANTHROPIC_API_KEY:
            log.info("No ANTHROPIC_API_KEY — posting without narrative context")
        else:
            log.info("Large batch (%d) — skipping narrative, posting plain", len(new_articles))
        analysis_map = {}

    # ── 3. Publish ────────────────────────────────────────────────────────
    total_sent = 0
    for article in new_articles:
        a = analysis_map.get(article["index"], {})
        story_topic = a.get("story_topic")
        context_line = a.get("context_line")
        is_update = a.get("is_update", False)

        sent = publisher.publish(
            article["text"],
            article["source"],
            story_topic=story_topic,
            context_line=context_line,
            is_update=is_update,
        )
        if sent:
            dedup.record(article["text"], state)
            story_store.record(
                stories,
                a.get("existing_story_id"),
                story_topic or "News",
                article["text"],
            )
            total_sent += 1

    state_store.save(state)
    story_store.save(stories)
    log.info("Done. %d/%d sent.", total_sent, len(new_articles))


if __name__ == "__main__":
    main()
