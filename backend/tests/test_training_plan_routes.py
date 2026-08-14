import pytest

from src.api.routes import training_plan_routes
from src.api.routes.training_plan_routes import (
    CorosWorkoutDraft,
    CorosWorkoutStep,
    TrainingEvent,
    _build_coros_program,
    _calculate_program_summary,
    _draft_from_program,
    _parse_coros_schedule,
    _schedule_new_workout,
)


def test_parse_coros_schedule_normalizes_calendar_workouts() -> None:
    events = _parse_coros_schedule(
        {
            "entities": [
                {
                    "happenDay": "20260811",
                    "idInPlan": 7,
                    "planId": "plan-1",
                    "planProgramId": 7,
                    "sportData": {"name": "Tempo Run", "distance": 10_000_00, "trainingLoad": 68},
                },
                {"happenDay": "20260811", "idInPlan": 8, "status": 3},
            ],
            "programs": [{"idInPlan": 7, "name": "Fallback name", "sportType": 1, "exercises": [{"sortNo": 1, "exerciseType": 1, "targetType": 5, "targetValue": 20_000}]}],
        }
    )

    assert events == [
        TrainingEvent(
            uid="coros:plan-1:7:20260811",
            summary="Tempo Run",
            start="2026-08-11",
            end="2026-08-11",
            description="10 km · Load 68",
            location="",
            event_type="run",
            is_all_day=True,
            workout_steps=[CorosWorkoutStep(kind="warmup", target="distance", value=200, name="Warm Up")],
        )
    ]
    assert [(step.kind, step.target, step.value) for step in events[0].workout_steps] == [("warmup", "distance", 200)]


@pytest.mark.asyncio
async def test_ical_source_keeps_existing_fetch_path(monkeypatch: pytest.MonkeyPatch) -> None:
    expected = [
        TrainingEvent(
            uid="ical-1",
            summary="Easy Run",
            start="2026-08-11",
            end="2026-08-11",
            description="",
            location="",
            event_type="run",
            is_all_day=True,
        )
    ]

    async def fetch_ical() -> list[TrainingEvent]:
        return expected

    monkeypatch.setattr(training_plan_routes, "_fetch_and_parse_ical", fetch_ical)

    assert (
        await training_plan_routes.get_training_plan_events(
            days_back=30,
            days_forward=60,
            source="ical",
            db=object(),  # type: ignore[arg-type]
        )
        == expected
    )


def test_structured_hyrox_workout_uses_coros_units() -> None:
    program = _build_coros_program(
        CorosWorkoutDraft(
            date="2026-08-12",
            name="HYROX Prep",
            sport="hyrox",
            steps=[
                CorosWorkoutStep(kind="warmup", target="time", value=600),
                CorosWorkoutStep(
                    kind="training",
                    name="Sled Push",
                    target="distance",
                    value=50,
                    intensity="weight",
                    intensity_low=100,
                ),
            ],
        )
    )

    exercises = program["exercises"]
    assert isinstance(exercises, list)
    assert program["sportType"] == 9
    assert program["pbVersion"] == 9
    assert exercises[1]["targetType"] == 5
    assert exercises[1]["targetValue"] == 5_000
    assert exercises[1]["intensityType"] == 1


def test_structured_workout_intensity_uses_coros_metric_units() -> None:
    program = _build_coros_program(
        CorosWorkoutDraft(
            date="2026-08-12",
            name="Metric ranges",
            sport="run",
            steps=[
                CorosWorkoutStep(
                    intensity="speed",
                    intensity_low=14.5,
                    intensity_high=12.5,
                ),
                CorosWorkoutStep(
                    intensity="pace",
                    intensity_low=300,
                    intensity_high=270,
                ),
            ],
        )
    )

    exercises = program["exercises"]
    assert isinstance(exercises, list)
    assert (exercises[0]["intensityValue"], exercises[0]["intensityValueExtend"]) == (1250, 1450)
    assert (exercises[0]["intensityDisplayUnit"], exercises[0]["intensityMultiplier"]) == (4, 100)
    assert (exercises[1]["intensityValue"], exercises[1]["intensityValueExtend"]) == (270_000, 300_000)
    assert (exercises[1]["intensityDisplayUnit"], exercises[1]["intensityMultiplier"]) == (1, 1000)


def test_library_editor_converts_coros_weight_grams_to_kilograms() -> None:
    draft = _draft_from_program(
        "library:1",
        "20260812",
        {
            "name": "Hyrox",
            "sportType": 9,
            "exercises": [{"exerciseType": 2, "targetType": 5, "targetValue": 5_000, "intensityType": 1, "intensityValue": 24_000, "intensityValueExtend": 24_000}],
        },
    )

    assert draft.steps[0].intensity_low == 24
    program = _build_coros_program(CorosWorkoutDraft(date="2026-08-12", name="Hyrox", sport="hyrox", steps=draft.steps))
    exercises = program["exercises"]
    assert isinstance(exercises, list)
    assert exercises[0]["intensityValue"] == 24_000


def test_structured_workout_encodes_coros_percentage_intensity() -> None:
    program = _build_coros_program(
        CorosWorkoutDraft(
            date="2026-08-12",
            name="Threshold session",
            sport="run",
            steps=[
                CorosWorkoutStep(
                    intensity="heart_rate_percent",
                    intensity_basis="lthr",
                    intensity_low=96,
                    intensity_high=102,
                    intensity_zone=3,
                ),
                CorosWorkoutStep(
                    intensity="effort_pace_percent",
                    intensity_low=95,
                    intensity_high=108,
                ),
            ],
        )
    )

    exercises = program["exercises"]
    assert isinstance(exercises, list)
    assert exercises[0]["intensityType"] == 2
    assert exercises[0]["hrType"] == 3
    assert exercises[0]["isIntensityPercent"] is True
    assert exercises[0]["intensityCustom"] == 3
    assert (exercises[0]["intensityPercent"], exercises[0]["intensityPercentExtend"]) == (96_000, 102_000)
    assert exercises[1]["intensityType"] == 8
    assert program["pbVersion"] == 3


def test_library_editor_decodes_coros_percentage_intensity() -> None:
    draft = _draft_from_program(
        "library:1",
        "20260812",
        {
            "name": "Threshold",
            "sportType": 1,
            "exercises": [
                {
                    "exerciseType": 2,
                    "targetType": 2,
                    "targetValue": 600,
                    "intensityType": 2,
                    "isIntensityPercent": True,
                    "hrType": 3,
                    "intensityPercent": 96_000,
                    "intensityPercentExtend": 102_000,
                    "intensityCustom": 3,
                }
            ],
        },
    )

    step = draft.steps[0]
    assert (step.intensity, step.intensity_basis) == ("heart_rate_percent", "lthr")
    assert (step.intensity_low, step.intensity_high) == (96, 102)
    assert step.intensity_zone == 3


def test_library_editor_uses_friendly_names_for_coros_template_codes() -> None:
    draft = _draft_from_program(
        "library:1",
        "20260811",
        {
            "name": "Tempo",
            "sportType": 1,
            "exercises": [
                {"exerciseType": 1, "targetType": 5, "targetValue": 300_000, "name": "T1120"},
                {"exerciseType": 4, "targetType": 2, "targetValue": 120, "name": "T1123"},
            ],
        },
    )

    assert [step.name for step in draft.steps] == ["Warm Up", "Rest"]


def test_library_editor_uses_coros_exercise_labels_for_hyrox_steps() -> None:
    draft = _draft_from_program(
        "library:1",
        "20260811",
        {
            "name": "Hyrox",
            "sportType": 9,
            "exercises": [
                {"exerciseType": 2, "targetType": 5, "targetValue": 100_000, "name": "T1", "exerciseName": "Ski Erg"},
                {"exerciseType": 2, "targetType": 5, "targetValue": 5_000, "displayName": "sid_hyrox_sled_push"},
            ],
        },
    )

    assert [step.name for step in draft.steps] == ["Ski Erg", "Sled Push"]


def test_repeat_group_round_trips_between_coros_program_and_editor() -> None:
    draft = _draft_from_program(
        "library:1",
        "20260811",
        {
            "name": "Interval Time",
            "sportType": 1,
            "exercises": [
                {"id": 1, "isGroup": True, "name": "Repeat", "sets": 2, "sortNo": 16_777_216},
                {
                    "id": 2,
                    "groupId": "1",
                    "exerciseType": 2,
                    "targetType": 2,
                    "targetValue": 480,
                    "sortNo": 16_842_752,
                },
                {
                    "id": 3,
                    "groupId": "1",
                    "exerciseType": 4,
                    "targetType": 2,
                    "targetValue": 120,
                    "sortNo": 16_908_288,
                },
            ],
        },
    )

    assert [(step.repeat_group, step.repeat_count) for step in draft.steps] == [(1, 2), (1, 2)]
    program = _build_coros_program(CorosWorkoutDraft(**draft.model_dump(exclude={"uid"})))
    exercises = program["exercises"]
    assert isinstance(exercises, list)
    assert exercises[0]["isGroup"] is True
    assert exercises[0]["sets"] == 2
    assert [exercise["groupId"] for exercise in exercises[1:]] == [str(exercises[0]["id"])] * 2


def test_library_summary_matches_selected_day_repeat_structure() -> None:
    _, _, _, step_kinds = _calculate_program_summary(
        {
            "exercises": [
                {"id": 1, "exerciseType": 1, "sortNo": 1},
                {"id": 2, "isGroup": True, "sets": 2, "sortNo": 2},
                {"id": 3, "groupId": "2", "exerciseType": 2, "sortNo": 3},
                {"id": 4, "groupId": "2", "exerciseType": 4, "sortNo": 4},
                {"id": 5, "exerciseType": 3, "sortNo": 5},
            ]
        }
    )

    assert step_kinds == ["warmup", "training", "rest", "training", "rest", "cooldown"]


@pytest.mark.asyncio
async def test_library_summary_uses_detail_over_partial_query_item(monkeypatch) -> None:
    class FakeClient:
        async def post_training_hub(self, _path: str, _payload: object) -> object:
            return [
                {
                    "id": "long-run",
                    "name": "Long Run",
                    "sportType": 100,
                    "exercises": [{"targetType": 2, "targetValue": 300}],
                }
            ]

        async def get_training_hub(self, _path: str, _params: object) -> object:
            return {
                "id": "long-run",
                "name": "Long Run",
                "sportType": 100,
                "exercises": [
                    {"targetType": 5, "targetValue": 1_500_000},
                    {"targetType": 2, "targetValue": 300},
                ],
            }

    async def fake_coros_client(_db: object) -> FakeClient:
        return FakeClient()

    monkeypatch.setattr(training_plan_routes, "_coros_client", fake_coros_client)

    [workout] = await training_plan_routes.list_coros_library_workouts(None)  # type: ignore[arg-type]

    assert workout.total_distance == 15000
    assert workout.total_time == 300


@pytest.mark.asyncio
async def test_schedule_can_save_workout_to_library_first() -> None:
    class FakeClient:
        def __init__(self) -> None:
            self.paths: list[str] = []
            self.scheduled: dict[str, object] | None = None

        async def post_training_hub(self, path: str, payload: object) -> object:
            self.paths.append(path)
            if path == "/training/program/calculate":
                return {"planDuration": 600}
            if path == "/training/program/add":
                return 42
            if path == "/training/schedule/update":
                self.scheduled = payload  # type: ignore[assignment]
            return None

        async def fetch_training_schedule(self, start_day: str, end_day: str) -> dict[str, object]:
            if self.scheduled is None:
                return {"maxIdInPlan": 0}
            programs = self.scheduled["programs"]  # type: ignore[index]
            return {
                "entities": [{"happenDay": start_day, "idInPlan": 1, "planId": "plan-1"}],
                "programs": programs,
            }

    client = FakeClient()
    event = await _schedule_new_workout(
        client,  # type: ignore[arg-type]
        CorosWorkoutDraft(
            date="2026-08-12",
            name="Easy Run",
            sport="run",
            steps=[CorosWorkoutStep()],
        ),
        save_to_library=True,
    )

    assert client.paths == [
        "/training/program/calculate",
        "/training/program/add",
        "/training/schedule/update",
    ]
    assert event.summary == "Easy Run"


@pytest.mark.asyncio
async def test_delete_library_workout_uses_coros_program_delete(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeClient:
        def __init__(self) -> None:
            self.request: tuple[str, object] | None = None

        async def post_training_hub(self, path: str, payload: object) -> None:
            self.request = (path, payload)

    client = FakeClient()

    async def coros_client(_: object) -> FakeClient:
        return client

    monkeypatch.setattr(training_plan_routes, "_coros_client", coros_client)

    await training_plan_routes.delete_coros_library_workout(
        "42", training_plan_routes.DeleteCorosWorkout(confirmed=True), object()  # type: ignore[arg-type]
    )

    assert client.request == ("/training/program/delete", ["42"])
