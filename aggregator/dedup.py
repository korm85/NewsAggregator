"""
Two-stage deduplication:
  1. Exact SHA-256 hash (catches identical reposts instantly)
  2. Jaccard similarity on word shingles (catches reworded duplicates)
"""
import hashlib
import re
import time
from typing import Any

import config


def _exact_hash(text: str) -> str:
    return hashlib.sha256(text.lower().strip().encode()).hexdigest()


def _normalize(text: str) -> str:
    text = text.lower()
    text = re.sub(r"https?://\S+", "", text)
    text = re.sub(r"[^\w\s]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _shingles(text: str, k: int = 5) -> set[str]:
    words = _normalize(text).split()
    if len(words) < k:
        return set(words)
    return {" ".join(words[i : i + k]) for i in range(len(words) - k + 1)}


def _jaccard(a: set, b: set) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def is_duplicate(text: str, state: dict) -> bool:
    if len(text.strip()) < config.MIN_TEXT_LENGTH:
        return False

    h = _exact_hash(text)
    if h in state["hashes"]:
        return True

    new_shingles = _shingles(text)
    for stored in state["shingles"]:
        if _jaccard(new_shingles, set(stored)) >= config.SIMILARITY_THRESHOLD:
            return True

    return False


def record(text: str, state: dict) -> None:
    h = _exact_hash(text)
    now = time.time()
    state["hashes"][h] = now
    state["shingles"].append(list(_shingles(text)))
    state["shingle_times"].append(now)


def prune(state: dict) -> None:
    cutoff = time.time() - config.DEDUP_WINDOW_HOURS * 3600

    state["hashes"] = {k: v for k, v in state["hashes"].items() if v > cutoff}

    pairs = list(zip(state["shingles"], state["shingle_times"]))
    pairs = [(s, t) for s, t in pairs if t > cutoff]
    if pairs:
        state["shingles"], state["shingle_times"] = map(list, zip(*pairs))
    else:
        state["shingles"] = []
        state["shingle_times"] = []
