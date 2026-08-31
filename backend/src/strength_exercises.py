"""Resolve COROS strength exercise keys to the names shown in the app."""

import json
import re
from functools import cache
from pathlib import Path

_EXERCISE_NAMES_PATH = (
    Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "exerciseNames.json"
)
_BODY_REGION_NAMES = {
    "S4208": "Full Body",
    "S4209": "Shoulders",
    "S4210": "Arms",
    "S4211": "Chest",
    "S4212": "Back",
    "S4213": "Abs",
    "S4214": "Legs & Hips",
}
_EXERCISE_CODE_RE = re.compile(r"^[TS]\d")


@cache
def _exercise_names() -> dict[str, str]:
    raw = json.loads(_EXERCISE_NAMES_PATH.read_text())
    if not isinstance(raw, dict):
        raise ValueError("COROS exercise name map must be an object")
    return {key: value for key, value in raw.items() if isinstance(key, str) and isinstance(value, str)}


def resolve_exercise_name(name_key: str | None, raw_name: str | None) -> str:
    """Return the shared UI name for a COROS exercise key or raw name."""
    key = name_key.strip() if name_key else ""
    mapped = _exercise_names().get(key) or _BODY_REGION_NAMES.get(key)
    if mapped:
        return mapped
    name = raw_name.strip() if raw_name else ""
    if name and not _EXERCISE_CODE_RE.match(name):
        return _exercise_names().get(name, name)
    return key or name or "Exercise"
