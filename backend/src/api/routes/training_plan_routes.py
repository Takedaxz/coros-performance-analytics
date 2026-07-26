"""Training plan routes: fetch and parse iCal calendar events."""

import datetime
import re
from typing import Literal

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from src.config import get_settings

router = APIRouter()
settings = get_settings()

_ICAL_URL = "https://p135-caldav.icloud.com/published/2/MTAzNTc1NTUzNDMxMDM1N4gPI9Eruy25g9v9R_Ci0txlHRMQJW0ifWYN4qF0Rbss"


class TrainingEvent(BaseModel):
    uid: str
    summary: str
    start: str  # ISO date or datetime string
    end: str
    description: str
    location: str
    event_type: Literal["run", "ride", "strength", "swim", "yoga", "pilates", "race", "other"]
    is_all_day: bool


def _classify_event(summary: str) -> Literal["run", "ride", "strength", "swim", "yoga", "pilates", "race", "other"]:
    s = summary.lower()
    # Explicit run keywords
    if any(k in s for k in ("run", "tempo", "long run", "easy run", "marathon", "hyrox")):
        return "run"
    if re.search(r"\b(?:bike|ride|cycling|cycle|trainer)\b", s):
        return "ride"
    # Distance / interval / pace notation → running session
    # e.g. "5 × 8 min @ T", "6×800m @ 4:40", "4:30/km", "@ i", "@ t", "min @"
    if any(k in s for k in ("@ t", "@ i", "@ m", "min @", "×", "x 1 km", "/km", "strides", "intervals")):
        return "run"
    # Standalone distance markers without "run" keyword (e.g. "17.5 km")
    if re.search(r"\d+(\.\d+)?\s*km", s):
        return "run"
    if "swim" in s:
        return "swim"
    if any(k in s for k in ("strength", "weight", "gym", "plyometric", "deadlift", "squat")):
        return "strength"
    if "yoga" in s:
        return "yoga"
    if "pilates" in s:
        return "pilates"
    if any(k in s for k in ("race", "marathon", "แข่ง", "competition", "icmm", "amazing thailand")):
        return "race"
    return "other"


def _unfold_ical(raw: str) -> str:
    """Unfold iCal line continuations (RFC 5545 §3.1)."""
    return re.sub(r"\r?\n[ \t]", "", raw)


def _parse_ical_datetime(value: str) -> tuple[str, bool]:
    """Return (iso_string, is_all_day)."""
    value = value.split(";")[-1]  # strip TZID= params if any
    value = value.strip()
    if len(value) == 8:
        # DATE only: YYYYMMDD
        d = datetime.date(int(value[:4]), int(value[4:6]), int(value[6:8]))
        return d.isoformat(), True
    # DATETIME: YYYYMMDDTHHMMSSZ or local
    try:
        value = value.rstrip("Z")
        dt = datetime.datetime(
            int(value[0:4]),
            int(value[4:6]),
            int(value[6:8]),
            int(value[9:11]),
            int(value[11:13]),
            int(value[13:15]),
        )
        return dt.isoformat(), False
    except (ValueError, IndexError):
        return value, False


def _extract_value(lines: list[str], prop: str) -> str:
    """Extract a property value from a list of unfolded lines."""
    prefix_exact = f"{prop}:"
    prefix_param = f"{prop};"
    for line in lines:
        if line.startswith(prefix_exact):
            return line[len(prefix_exact):].strip()
        if line.startswith(prefix_param):
            # e.g. DTSTART;TZID=Asia/Bangkok:20260527T090000
            return line.split(":", 1)[-1].strip()
    return ""


def _unescape_ical_text(value: str) -> str:
    """Decode iCalendar text escapes for readable event details."""
    return (
        value.replace("\\n", "\n")
        .replace("\\,", ",")
        .replace("\\;", ";")
        .replace("\\\\", "\\")
    )


async def _fetch_and_parse_ical() -> list[TrainingEvent]:
    """Fetch the iCal feed and return parsed TrainingEvent objects."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(_ICAL_URL)
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Failed to fetch calendar: HTTP {resp.status_code}")

    raw = _unfold_ical(resp.text)
    events: list[TrainingEvent] = []

    vevent_blocks = re.split(r"BEGIN:VEVENT", raw)[1:]
    for block in vevent_blocks:
        end_idx = block.find("END:VEVENT")
        if end_idx == -1:
            continue
        block = block[:end_idx]
        lines = block.strip().splitlines()

        uid = _extract_value(lines, "UID")
        summary = _extract_value(lines, "SUMMARY")
        description = _unescape_ical_text(_extract_value(lines, "DESCRIPTION"))
        location = _unescape_ical_text(_extract_value(lines, "LOCATION")).replace("\n", ", ")

        dtstart_raw = _extract_value(lines, "DTSTART")
        dtend_raw = _extract_value(lines, "DTEND")

        if not dtstart_raw or not summary:
            continue

        start_iso, is_all_day = _parse_ical_datetime(dtstart_raw)
        end_iso, _ = _parse_ical_datetime(dtend_raw) if dtend_raw else (start_iso, is_all_day)

        events.append(
            TrainingEvent(
                uid=uid,
                summary=summary,
                start=start_iso,
                end=end_iso,
                description=description,
                location=location,
                event_type=_classify_event(summary),
                is_all_day=is_all_day,
            )
        )

    return events


@router.get("/events", response_model=list[TrainingEvent])
async def get_training_plan_events(
    days_back: int = Query(default=30, ge=0, le=365),
    days_forward: int = Query(default=60, ge=0, le=365),
) -> list[TrainingEvent]:
    """Return training plan events within a window around today."""
    events = await _fetch_and_parse_ical()

    today = datetime.date.today()
    window_start = today - datetime.timedelta(days=days_back)
    window_end = today + datetime.timedelta(days=days_forward)

    filtered: list[TrainingEvent] = []
    for ev in events:
        try:
            # Parse just the date portion for comparison
            start_date = datetime.date.fromisoformat(ev.start[:10])
        except ValueError:
            continue
        if window_start <= start_date <= window_end:
            filtered.append(ev)

    filtered.sort(key=lambda e: e.start)
    return filtered


@router.get("/today", response_model=list[TrainingEvent])
async def get_today_events() -> list[TrainingEvent]:
    """Return training plan events scheduled for today."""
    events = await _fetch_and_parse_ical()
    today_str = datetime.date.today().isoformat()

    return [ev for ev in events if ev.start[:10] == today_str]
