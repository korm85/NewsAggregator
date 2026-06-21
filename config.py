import os
from dotenv import load_dotenv

load_dotenv()

BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
OUTPUT_CHANNEL_ID = os.environ["OUTPUT_CHANNEL_ID"]

SOURCE_CHANNELS = [
    ch.strip()
    for ch in os.environ["SOURCE_CHANNELS"].split(",")
    if ch.strip()
]

DEDUP_WINDOW_HOURS = int(os.getenv("DEDUP_WINDOW_HOURS", "48"))
SIMILARITY_THRESHOLD = float(os.getenv("SIMILARITY_THRESHOLD", "0.6"))
MIN_TEXT_LENGTH = 30
