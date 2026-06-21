import os
import json
from dotenv import load_dotenv

load_dotenv()

BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]

with open("channels.json") as f:
    _cfg = json.load(f)

OUTPUT_CHANNEL_ID = _cfg["output_channel_id"]
SOURCE_CHANNELS = _cfg["source_channels"]

DEDUP_WINDOW_HOURS = int(os.getenv("DEDUP_WINDOW_HOURS", "48"))
SIMILARITY_THRESHOLD = float(os.getenv("SIMILARITY_THRESHOLD", "0.6"))
MIN_TEXT_LENGTH = 30

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")

# If a single run surfaces more articles than this, skip narrative analysis
# (catch-up/backfill runs — narrative isn't useful for bulk history)
NARRATIVE_BATCH_LIMIT = int(os.getenv("NARRATIVE_BATCH_LIMIT", "20"))
