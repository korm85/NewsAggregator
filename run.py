"""
Entry point for the GitHub Actions cron job.
Fetches posts from all source channels, deduplicates, and forwards unique ones.
"""
import logging
import config
from aggregator import fetcher, dedup, publisher, state as state_store

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger(__name__)


def main() -> None:
    state = state_store.load()
    dedup.prune(state)

    total_seen = 0
    total_sent = 0

    for channel in config.SOURCE_CHANNELS:
        log.info("Fetching %s", channel)
        posts = fetcher.fetch_channel(channel)
        log.info("  Got %d posts", len(posts))

        for text in posts:
            total_seen += 1
            if dedup.is_duplicate(text, state):
                continue
            dedup.record(text, state)
            if publisher.publish(text, channel):
                total_sent += 1

    state_store.save(state)
    log.info("Done. %d unique posted out of %d seen.", total_sent, total_seen)


if __name__ == "__main__":
    main()
