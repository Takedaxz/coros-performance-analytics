import asyncio
import datetime as dt
from concurrent.futures import TimeoutError as FutureTimeoutError
from types import SimpleNamespace

import pytest

from src.ai import coach_tools
from src.ai.coach_tools import (
    _health_trend,
    _pace_s_km,
    _scheduled_workout_details,
    _sport_type,
    coach_tool_functions,
)
from src.api.routes import training_plan_routes
from src.api.routes.training_plan_routes import CorosWorkoutStep, TrainingEvent
from src.db.models import SportType


def test_activity_tool_normalizes_human_sport_names() -> None:
    assert _sport_type("Running") is SportType.RUN
    assert _sport_type("trail running") is SportType.TRAIL_RUN
    assert _sport_type("cycling") is SportType.RIDE


def test_activity_tool_rejects_unknown_sport() -> None:
    with pytest.raises(ValueError):
        _sport_type("rowing")


def test_activity_tool_computes_compact_pace() -> None:
    assert _pace_s_km(3.0) == 333
    assert _pace_s_km(None) is None


@pytest.mark.asyncio
async def test_health_trend_keeps_rich_data_without_nulls() -> None:
    health = SimpleNamespace(
        date=dt.date(2026, 8, 14),
        overnight_hrv_avg_ms=54.2,
        overnight_hrv_normal_low_ms=50.0,
        overnight_hrv_normal_high_ms=62.0,
        hrv_7d_sma=55.0,
        hrv_30d_sma=57.0,
        hrv_zscore=-1.2,
        resting_hr_bpm=51,
        readiness_score_app=73.0,
        strain_score_app=42.0,
        recovery_vendor=68.0,
        load_impact_vendor=None,
        intensity_trend_vendor=None,
        stress_score=31.0,
        spo2_pct=98.0,
        steps=9_000,
        active_calories_kcal=410,
        breathing_rate=13.2,
        anomaly_flags={"hrv_low_7d": True},
    )
    sleep = SimpleNamespace(
        sleep_start=dt.datetime(2026, 8, 14, 0),
        duration_s=28_800,
        stage_deep_s=4_200,
        stage_rem_s=5_400,
        stage_light_s=None,
        stage_awake_s=1_200,
        sleep_quality_vendor=82.0,
        is_nap=False,
    )
    activity = SimpleNamespace(
        id="activity-1",
        start_time=dt.datetime(2026, 8, 14, 6),
        sport=SportType.RUN,
        title="Easy run",
        distance_m=8_000.0,
        elapsed_time_s=2_400.0,
        avg_speed_mps=3.33,
        avg_hr_bpm=140,
        max_hr_bpm=155,
        avg_cadence=170,
        avg_power_w=None,
        training_load_vendor=68,
        cardiac_drift_pct_app=None,
        elevation_gain_m=80.0,
    )

    class Result:
        def __init__(self, rows: list[object]) -> None:
            self.rows = rows

        def scalars(self) -> "Result":
            return self

        def all(self) -> list[object]:
            return self.rows

    class Db:
        def __init__(self) -> None:
            self.results = iter([Result([health]), Result([sleep]), Result([activity])])

        async def execute(self, _statement: object) -> Result:
            return next(self.results)

    result = await _health_trend(Db(), "owner", 7)

    assert result["health"][0]["hrv_ms"] == 54.2
    assert "load_impact" not in result["health"][0]
    assert result["sleep"][0]["duration_min"] == 480
    assert "light_min" not in result["sleep"][0]
    assert result["activities"][0]["km"] == 8.0


def test_scheduled_workout_details_tool_is_exposed() -> None:
    loop = asyncio.new_event_loop()
    try:
        names = {tool.__name__ for tool in coach_tool_functions("owner", loop)}
    finally:
        loop.close()

    assert "get_scheduled_workout_details" in names
    assert "search_coaching_knowledge" in names
    assert "web_search" in names


def test_scheduled_workout_details_waits_longer_and_cancels_on_timeout(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: dict[str, float | bool] = {}

    class Future:
        def result(self, timeout: float) -> dict[str, str]:
            seen["timeout"] = timeout
            raise FutureTimeoutError

        def cancel(self) -> bool:
            seen["cancelled"] = True
            return True

    def schedule(coro: object, _loop: asyncio.AbstractEventLoop) -> Future:
        coro.close()  # type: ignore[attr-defined]
        return Future()

    monkeypatch.setattr(coach_tools.asyncio, "run_coroutine_threadsafe", schedule)
    loop = asyncio.new_event_loop()
    try:
        tool = next(
            tool
            for tool in coach_tool_functions("owner", loop)
            if tool.__name__ == "get_scheduled_workout_details"
        )
        assert tool("2026-08-16") == {"error": "get_scheduled_workout_details timed out."}
    finally:
        loop.close()

    assert seen == {"timeout": 45.0, "cancelled": True}


@pytest.mark.asyncio
async def test_scheduled_workout_details_returns_coros_steps(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fetch_calendar(
        start_date: dt.date, end_date: dt.date, db: object
    ) -> list[TrainingEvent]:
        assert start_date == end_date == dt.date(2026, 8, 18)
        return [
            TrainingEvent(
                uid="coros:1:2:20260818",
                summary="Intervals",
                start="2026-08-18",
                end="2026-08-18",
                description="",
                location="",
                event_type="run",
                is_all_day=True,
                workout_steps=[
                    CorosWorkoutStep(kind="warmup", target="time", value=600),
                    CorosWorkoutStep(kind="training", target="distance", value=1_000),
                ],
            )
        ]

    monkeypatch.setattr(training_plan_routes, "fetch_coros_calendar", fetch_calendar)

    result = await _scheduled_workout_details(object(), dt.date(2026, 8, 18))

    assert result["source"] == "coros"
    assert result["workouts"][0]["title"] == "Intervals"
    assert result["workouts"][0]["steps"][1]["value"] == 1_000
