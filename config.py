import os
from dotenv import load_dotenv

load_dotenv()

API_ID = int(os.environ["TELEGRAM_API_ID"])
API_HASH = os.environ["TELEGRAM_API_HASH"]
PHONE = os.environ["TELEGRAM_PHONE"]
OUTPUT_CHANNEL = os.environ["OUTPUT_CHANNEL"]
SESSION_NAME = os.getenv("SESSION_NAME", "news_aggregator")

SOURCE_CHANNELS = [
    ch.strip()
    for ch in os.environ["SOURCE_CHANNELS"].split(",")
    if ch.strip()
]

DEDUP_WINDOW_HOURS = int(os.getenv("DEDUP_WINDOW_HOURS", "48"))
SIMILARITY_THRESHOLD = float(os.getenv("SIMILARITY_THRESHOLD", "0.6"))

# Minimum message length to bother deduplicating (very short messages are forwarded as-is)
MIN_TEXT_LENGTH = 30
