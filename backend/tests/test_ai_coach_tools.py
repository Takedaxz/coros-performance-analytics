import asyncio
import datetime as dt
from concurrent.futures import TimeoutError as FutureTimeoutError
from types import SimpleNamespace

import pytest

from src.ai import coach_tools
from src.ai.coach_tools import (
    _activity_detail,
    _calendar_change_proposal,
    _execute_tool,
    _health_trend,
    _pace_s_km,
    _past_race_goals,
    _scheduled_workout_details,
    _sport_type,
    coach_tool_functions,
)
from src.api.routes import training_plan_routes
from src.api.routes.activity_routes import ActivityNoteUpdate, update_activity_note
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


def test_calendar_change_proposal_validates_a_draft_without_writing() -> None:
    result = _calendar_change_proposal(
        "create",
        draft={
            "date": "2026-08-25",
            "name": "Easy Run",
            "sport": "run",
            "steps": [{"kind": "training", "target": "time", "value": 1800}],
        },
    )

    assert result == {
        "pending_confirmation": True,
        "action": "create",
        "summary": "Create Easy Run on 2026-08-25",
    }
    assert _calendar_change_proposal("delete", uid="not-a-coros-event") == {
        "error": "uid must be a COROS calendar event returned by get_training_plan"
    }


def test_calendar_change_proposal_rejects_an_interval_without_rest_group() -> None:
    result = _calendar_change_proposal(
        "create",
        draft={
            "date": "2026-08-25",
            "name": "Swim Intervals",
            "sport": "swim",
            "pool_length_m": 20,
            "steps": [
                {"kind": "training", "target": "distance", "value": 100, "repeats": 6}
            ],
        },
    )

    assert result == {
        "error": "Repeated steps must use repeat_group/repeat_count with a rest step."
    }


def test_calendar_change_proposal_requires_pool_length_for_swimming() -> None:
    result = _calendar_change_proposal(
        "create",
        draft={
            "date": "2026-08-25",
            "name": "Pool Swim",
            "sport": "swim",
            "steps": [{"kind": "training", "target": "distance", "value": 400}],
        },
    )

    assert result == {"error": "pool_length_m is required for a pool swim workout."}


def test_calendar_change_proposal_requires_intensity_values() -> None:
    result = _calendar_change_proposal(
        "create",
        draft={
            "date": "2026-08-25",
            "name": "Easy Run",
            "sport": "run",
            "steps": [
                {
                    "kind": "training",
                    "target": "distance",
                    "value": 5_000,
                    "intensity": "heart_rate",
                }
            ],
        },
    )

    assert result == {"error": "invalid workout draft: heart_rate intensity needs a value."}


@pytest.mark.asyncio
async def test_activity_detail_tool_rejects_non_uuid_without_querying_database() -> None:
    result = await _execute_tool(
        "get_activity_detail", "owner", {"activity_id": "2026-08-16-hyrox-race"}
    )

    assert result == {"error": "activity_id must be a UUID returned by get_activities"}


@pytest.mark.asyncio
async def test_activity_comparison_tool_rejects_non_uuid_without_querying_database() -> None:
    result = await _execute_tool(
        "compare_activities",
        "owner",
        {"activity_ids": ["2026-08-16-hyrox-race", "also-not-a-uuid"]},
    )

    assert result == {"error": "activity_ids must be UUIDs returned by get_activities"}


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


@pytest.mark.asyncio
async def test_activity_detail_tool_includes_a_saved_note() -> None:
    activity = SimpleNamespace(
        id="activity-1",
        start_time=dt.datetime(2026, 8, 16, 9, 40),
        sport=SportType.RUN,
        title="Race",
        distance_m=10_000.0,
        elapsed_time_s=2_400.0,
        avg_speed_mps=4.16,
        avg_hr_bpm=160,
        max_hr_bpm=178,
        avg_cadence=178,
        avg_power_w=300,
        normalized_power_w=305,
        training_load_vendor=120,
        cardiac_drift_pct_app=2.1,
        elevation_gain_m=50.0,
        elevation_loss_m=50.0,
        activity_note="Legs felt heavy after the sled push.",
    )

    class Result:
        def __init__(self, value: object) -> None:
            self.value = value

        def scalar_one_or_none(self) -> object:
            return self.value

        def scalars(self) -> "Result":
            return self

        def all(self) -> list[object]:
            return []

    class Db:
        def __init__(self) -> None:
            self.results = iter([Result(activity), Result([]), Result([])])

        async def execute(self, _statement: object) -> Result:
            return next(self.results)

    result = await _activity_detail(Db(), "owner", "activity-1")

    assert result["activity"]["note"] == "Legs felt heavy after the sled push."


@pytest.mark.asyncio
async def test_activity_note_update_trims_and_persists(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    activity = SimpleNamespace(activity_note=None)

    class Result:
        def scalar_one_or_none(self) -> object:
            return activity

    class Db:
        committed = False

        async def execute(self, _statement: object) -> Result:
            return Result()

        async def commit(self) -> None:
            self.committed = True

    monkeypatch.setattr("src.api.routes.activity_routes.get_owner_id", lambda: "owner")
    db = Db()

    result = await update_activity_note(
        "activity-1", ActivityNoteUpdate(activity_note="  Good effort.  "), db  # type: ignore[arg-type]
    )

    assert result == {"activity_note": "Good effort."}
    assert db.committed


def test_scheduled_workout_details_tool_is_exposed() -> None:
    loop = asyncio.new_event_loop()
    try:
        names = {tool.__name__ for tool in coach_tool_functions("owner", loop)}
    finally:
        loop.close()

    assert "get_scheduled_workout_details" in names
    assert "get_past_race_goals" in names
    assert "search_coaching_knowledge" in names
    assert "web_search" in names
    assert {
        "propose_create_calendar_workout",
        "propose_update_calendar_workout",
        "propose_move_calendar_workout",
        "propose_delete_calendar_workout",
    } <= names


@pytest.mark.asyncio
async def test_past_race_goals_tool_returns_result_time_and_notes() -> None:
    goal = SimpleNamespace(
        id="goal-1",
        goal_race_name="HYROX Bangkok",
        goal_race_date=dt.date(2026, 6, 14),
        goal_target_time="1:35:00",
        goal_result_time="1:38:42",
        goal_description="First HYROX race; sled push was the limiter.",
        goal_race_note="Went out too hard but finished strong.",
        weekly_training_hours=8.0,
        is_active=False,
    )

    class Result:
        def scalars(self) -> "Result":
            return self

        def all(self) -> list[object]:
            return [goal]

    class Db:
        async def execute(self, _statement: object) -> Result:
            return Result()

    result = await _past_race_goals(Db(), "owner")

    assert result["races"] == [
        {
            "id": "goal-1",
            "race": "HYROX Bangkok",
            "date": "2026-06-14",
            "target_time": "1:35:00",
            "result_time": "1:38:42",
            "notes": "First HYROX race; sled push was the limiter.",
            "race_notes": "Went out too hard but finished strong.",
            "weekly_training_hours": 8.0,
            "active": False,
        }
    ]


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


@pytest.mark.asyncio
async def test_compare_activities_tool_returns_deep_details(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    uuid1 = "11111111-1111-4111-8111-111111111111"
    uuid2 = "22222222-2222-4222-8222-222222222222"

    async def mock_activity_detail(_db: object, _user_id: str, act_id: str) -> dict:
        return {
            "activity": {
                "id": act_id,
                "title": f"Run {act_id[:4]}",
                "km": 10.0,
                "efficiency_factor": 1.45,
                "te_aerobic": 3.5,
            },
            "laps": [],
            "km_splits": [{"km": 1, "pace_s_km": 270, "hr": 150}],
        }

    monkeypatch.setattr(coach_tools, "_activity_detail", mock_activity_detail)

    res = await coach_tools._execute_tool(
        "compare_activities",
        "owner",
        {"activity_ids": [uuid1, uuid2]},
    )

    assert "activities" in res
    assert len(res["activities"]) == 2
    assert res["activities"][0]["activity"]["efficiency_factor"] == 1.45
    assert len(res["activities"][0]["km_splits"]) == 1

