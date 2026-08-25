from datetime import datetime
from typing import TYPE_CHECKING, cast

import pytest

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

from src.ai.prompts import POSTMORTEM_PROMPT
from src.api.routes.ai_routes import (
    _build_laps_with_km_breakdown,
    _postmortem_focus,
    _postmortem_sport,
)
from src.db.models import Activity, SportType


def test_postmortem_focus_covers_each_activity_type() -> None:
    expected = {
        SportType.RUN: "Pacing, split consistency, and heart-rate response.",
        SportType.TRAIL_RUN: "Effort, pacing, elevation, and heart-rate response.",
        SportType.RIDE: "Power, pacing, elevation, and heart-rate response.",
        SportType.SWIM: "Intervals, pace, stroke/cadence, and heart-rate response when available.",
        SportType.WALK: "Pacing, duration, and heart-rate response.",
        SportType.HIKE: "Duration, elevation, effort, and heart-rate response.",
        SportType.STRENGTH: (
            "Session structure, work-rest pattern, training load, and exercise modifications."
        ),
        SportType.MULTISPORT: "Each discipline's execution and the transitions between them.",
        SportType.OTHER: "Session structure, effort, training load, and available telemetry.",
    }

    assert {_postmortem_focus(sport.value) for sport in SportType} == set(expected.values())


def test_postmortem_title_prioritizes_strength_over_hyrox() -> None:
    activity = Activity(
        id="activity-id",
        user_id="user-id",
        sport=SportType.OTHER,
        title="HYROX Weak-Station Strength",
        start_time=datetime(2026, 8, 24),
    )

    assert _postmortem_sport(activity) == "strength"


@pytest.mark.asyncio
async def test_strength_postmortem_omits_kilometer_breakdown() -> None:
    activity = Activity(
        id="strength-id",
        user_id="user-id",
        sport=SportType.STRENGTH,
        start_time=datetime(2026, 8, 24),
    )

    db = cast("AsyncSession", None)
    assert await _build_laps_with_km_breakdown(db, activity, []) == []


def test_postmortem_prompt_is_activity_aware() -> None:
    assert "professional performance coach" in POSTMORTEM_PROMPT
    assert "do not discuss\n  pace or per-kilometer splits" in POSTMORTEM_PROMPT
