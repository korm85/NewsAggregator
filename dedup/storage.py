import sqlite3
import hashlib
import time
from datetime import datetime, timedelta
from pathlib import Path
import config


DB_PATH = Path("seen_messages.db")


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with _connect() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS seen_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                msg_hash TEXT NOT NULL,
                text TEXT NOT NULL,
                source_channel TEXT NOT NULL,
                seen_at REAL NOT NULL
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_seen_at ON seen_messages(seen_at)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_hash ON seen_messages(msg_hash)")


def _exact_hash(text: str) -> str:
    return hashlib.sha256(text.lower().strip().encode()).hexdigest()


def is_exact_duplicate(text: str) -> bool:
    h = _exact_hash(text)
    cutoff = time.time() - config.DEDUP_WINDOW_HOURS * 3600
    with _connect() as conn:
        row = conn.execute(
            "SELECT 1 FROM seen_messages WHERE msg_hash = ? AND seen_at > ?",
            (h, cutoff),
        ).fetchone()
    return row is not None


def get_recent_texts() -> list[str]:
    cutoff = time.time() - config.DEDUP_WINDOW_HOURS * 3600
    with _connect() as conn:
        rows = conn.execute(
            "SELECT text FROM seen_messages WHERE seen_at > ? ORDER BY seen_at DESC",
            (cutoff,),
        ).fetchall()
    return [r["text"] for r in rows]


def record_message(text: str, source_channel: str) -> None:
    h = _exact_hash(text)
    with _connect() as conn:
        conn.execute(
            "INSERT INTO seen_messages (msg_hash, text, source_channel, seen_at) VALUES (?, ?, ?, ?)",
            (h, text, source_channel, time.time()),
        )


def purge_old_records() -> int:
    cutoff = time.time() - config.DEDUP_WINDOW_HOURS * 3600
    with _connect() as conn:
        cursor = conn.execute(
            "DELETE FROM seen_messages WHERE seen_at < ?", (cutoff,)
        )
        return cursor.rowcount
