import json
from pathlib import Path

STATE_FILE = Path("state/seen.json")

_EMPTY: dict = {"hashes": {}, "shingles": [], "shingle_times": []}


def load() -> dict:
    if STATE_FILE.exists():
        try:
            data = json.loads(STATE_FILE.read_text())
            # Ensure all keys exist (forwards-compat with old state files)
            for k, v in _EMPTY.items():
                data.setdefault(k, type(v)())
            return data
        except (json.JSONDecodeError, KeyError):
            pass
    return {k: type(v)() for k, v in _EMPTY.items()}


def save(state: dict) -> None:
    STATE_FILE.parent.mkdir(exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, separators=(",", ":")))
