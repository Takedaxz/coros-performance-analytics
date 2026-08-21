import datetime as dt

import httpx
import pytest
from fastapi import HTTPException

from src.api.routes import training_plan_routes
from src.api.routes.training_plan_routes import (
    CorosWorkoutDraft,
    CorosWorkoutStep,
    TrainingEvent,
    _build_coros_program,
    _calculate_program_summary,
    _draft_from_program,
    _exercise_video_catalog,
    _parse_coros_schedule,
    _schedule_library_hyrox,
    _schedule_new_workout,
    fetch_coros_calendar,
)


def test_exercise_video_catalog_keeps_only_official_coros_videos() -> None:
    videos = _exercise_video_catalog(
        {"data": {"exercises": [
            {
                "id": "375",
                "name": "T1393",
                "overview": "sid_strength_skierg",
                "videoUrlArrStr": "https://s3.coros.com/source/exercise_gif/375/ski.mp4",
            },
            {
                "id": "377",
                "displayName": "Sled Push",
                "videoInfos": (
                    '[{"videoUrl":"https://s3.coros.com/source/exercise_gif/377/sled.mp4"}]'
                ),
            },
            {"id": "0", "displayName": "Ignore", "videoUrl": "https://example.com/video.mp4"},
        ]}}
    )

    assert videos == {
        "skierg": "https://s3.coros.com/source/exercise_gif/375/ski.mp4",
        "sledpush": "https://s3.coros.com/source/exercise_gif/377/sled.mp4",
    }


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
            "programs": [{"idInPlan": 7, "name": "Fallback name", "sportType": 1, "exercises": [{"sortNo": 1, "exerciseType": 1, "targetType": 5, "targetValue": 20000}]}],
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


def test_parse_coros_schedule_handles_distance_in_meters() -> None:
    events = _parse_coros_schedule(
        {
            "entities": [
                {
                    "happenDay": "20260818",
                    "idInPlan": 12,
                    "planId": "plan-2",
                    "planProgramId": 12,
                    "sportData": {"name": "Easy Run", "distance": 900_000, "trainingLoad": 1},
                },
            ],
            "programs": [],
        }
    )

    assert len(events) == 1
    assert events[0].description == "9 km · Load 1"


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


@pytest.mark.asyncio
async def test_coros_calendar_network_timeout_becomes_502(monkeypatch: pytest.MonkeyPatch) -> None:
    async def load_credentials(_db: object, _secret: str) -> tuple[str, str]:
        return "athlete@example.com", "password"

    class Client:
        def __init__(self, **_kwargs: str) -> None:
            pass

        async def login(self) -> None:
            raise httpx.ConnectTimeout("timed out")

    monkeypatch.setattr(training_plan_routes, "load_coros_credentials", load_credentials)
    monkeypatch.setattr(training_plan_routes, "CorosApiClient", Client)

    with pytest.raises(HTTPException) as error:
        await fetch_coros_calendar(dt.date(2026, 8, 16), dt.date(2026, 8, 16), object())

    assert error.value.status_code == 502
    assert error.value.detail == "COROS Calendar unavailable: network request failed."


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
    assert exercises[1]["targetValue"] == 5000
    assert exercises[1]["intensityType"] == 1
    assert exercises[1]["name"] == "T1394"
    assert exercises[1]["subType"] == 2
    assert exercises[1]["overview"] == "sid_strength_sledpush"


def test_swim_program_uses_the_selected_pool_length() -> None:
    program = _build_coros_program(
        CorosWorkoutDraft(
            date="2026-08-12",
            name="20m Pool Swim",
            sport="swim",
            pool_length_m=20,
            steps=[CorosWorkoutStep(kind="training", target="distance", value=400)],
        )
    )

    assert program["poolLength"] == 2_000
    assert program["poolLengthUnit"] == 2
    loaded = _draft_from_program(
        "coros:1:2:20260812",
        "20260812",
        {"name": "20m Pool Swim", "sportType": 3, "poolLength": 2_000, "exercises": []},
    )
    assert loaded.pool_length_m == 20
    unset = _draft_from_program(
        "coros:1:2:20260812",
        "20260812",
        {"name": "Pool Swim", "sportType": 3, "poolLength": 0, "exercises": []},
    )
    assert unset.pool_length_m is None


def test_structured_hyrox_workout_maps_all_eight_stations() -> None:
    program = _build_coros_program(
        CorosWorkoutDraft(
            date="2026-08-12",
            name="HYROX stations",
            sport="hyrox",
            steps=[
                CorosWorkoutStep(
                    name=name,
                    target="reps" if name == "Wall Balls" else "distance",
                    value=100 if name == "Wall Balls" else 50,
                )
                for name in (
                    "Ski Erg", "Sled Push", "Sled Pull", "Burpee Broad Jumps",
                    "Indoor Rower", "Farmer's Carry", "Sandbag Lunges", "Wall Balls",
                )
            ],
        )
    )

    exercises = program["exercises"]
    assert isinstance(exercises, list)
    assert [(exercise["name"], exercise["subType"]) for exercise in exercises] == [
        ("T1393", 2),
        ("T1394", 2),
        ("T1395", 2),
        ("T1396", 2),
        ("T1207", 2),
        ("T1310", 2),
        ("T1064", 2),
        ("T1397", 2),
    ]


def test_structured_hyrox_workout_preserves_coros_station_identity() -> None:
    program = _build_coros_program(
        CorosWorkoutDraft(
            date="2026-08-12",
            name="HYROX stations",
            sport="hyrox",
            steps=[
                CorosWorkoutStep(
                    name=name,
                    target="reps" if name == "Wall Balls" else "distance",
                    value=100,
                )
                for name in (
                    "Ski Erg", "Sled Push", "Sled Pull", "Burpee Broad Jumps",
                    "Indoor Rower", "Farmer's Carry", "Sandbag Lunges", "Wall Balls",
                )
            ],
        )
    )

    exercises = program["exercises"]
    assert isinstance(exercises, list)
    assert [(exercise["originId"], exercise["exerciseKind"]) for exercise in exercises] == [
        ("476760420131192832", 1),
        ("476761244228042852", 2),
        ("476761463271374848", 3),
        ("476762713375293440", 4),
        ("430536120548376576", 5),
        ("469656430677508096", 6),
        ("425832124457861121", 7),
        ("476762944229785600", 8),
    ]
    assert [exercise["equipment"] for exercise in exercises] == [
        [16], [16], [16], [1], [13], [11, 2], [2], [10],
    ]
    assert [exercise["animationId"] for exercise in exercises] == [375, 377, 374, 1, 245, 365, 345, 376]
    assert all(exercise["isDefaultAdd"] == 0 for exercise in exercises)


def test_structured_hyrox_workout_uses_coros_hybrid_program_target() -> None:
    program = _build_coros_program(
        CorosWorkoutDraft(
            date="2026-08-12",
            name="HYROX hybrid",
            sport="hyrox",
            steps=[
                CorosWorkoutStep(name="Ski Erg", target="distance", value=1_000),
                CorosWorkoutStep(name="Wall Balls", target="reps", value=100),
            ],
        )
    )

    assert program["targetType"] == 0
    assert program["targetValue"] == 0
    assert program["hybridTotalSets"] == 2
    assert program["isTargetTypeConsistent"] == 0


def test_structured_hyrox_workout_rejects_station_reps() -> None:
    with pytest.raises(HTTPException, match="Ski Erg must use a distance target"):
        _build_coros_program(
            CorosWorkoutDraft(
                date="2026-08-12",
                name="HYROX stations",
                sport="hyrox",
                steps=[CorosWorkoutStep(name="Ski Erg", target="reps", value=15)],
            )
        )


@pytest.mark.parametrize(
    ("sport", "kind", "target", "name"),
    [
        ("run", "training", "distance", ""),
        ("ride", "training", "load", ""),
        ("swim", "training", "time", ""),
        ("strength", "training", "reps", "Squat"),
        ("trail_run", "training", "elevation_gain", ""),
        ("indoor_climb", "training", "routes", ""),
        ("bouldering", "training", "routes", ""),
        ("xc_ski", "rest", "elevation_gain", ""),
        ("hyrox", "training", "reps", "Wall Balls"),
    ],
)
def test_structured_workout_accepts_supported_targets(
    sport: str, kind: str, target: str, name: str,
) -> None:
    _build_coros_program(
        CorosWorkoutDraft(
            date="2026-08-12",
            name="Target check",
            sport=sport,  # type: ignore[arg-type]
            steps=[CorosWorkoutStep(kind=kind, target=target, name=name)],  # type: ignore[arg-type]
        )
    )


@pytest.mark.parametrize(
    ("sport", "kind", "target"),
    [
        ("run", "training", "reps"),
        ("ride", "training", "reps"),
        ("swim", "training", "routes"),
        ("strength", "training", "distance"),
        ("trail_run", "training", "reps"),
        ("indoor_climb", "training", "distance"),
        ("bouldering", "training", "distance"),
        ("xc_ski", "training", "reps"),
    ],
)
def test_structured_workout_rejects_unsupported_targets(
    sport: str, kind: str, target: str,
) -> None:
    with pytest.raises(HTTPException, match="is not available"):
        _build_coros_program(
            CorosWorkoutDraft(
                date="2026-08-12",
                name="Target check",
                sport=sport,  # type: ignore[arg-type]
                steps=[CorosWorkoutStep(kind=kind, target=target)],  # type: ignore[arg-type]
            )
        )


def test_structured_workout_intensity_uses_coros_metric_units() -> None:
    program = _build_coros_program(
        CorosWorkoutDraft(
            date="2026-08-12",
            name="Metric ranges",
            sport="run",
            steps=[
                CorosWorkoutStep(
                    intensity="heart_rate",
                    intensity_low=125,
                    intensity_high=145,
                ),
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
    assert (exercises[0]["intensityValue"], exercises[0]["intensityValueExtend"]) == (125, 145)
    assert (exercises[1]["intensityValue"], exercises[1]["intensityValueExtend"]) == (1250, 1450)
    assert (exercises[1]["intensityDisplayUnit"], exercises[1]["intensityMultiplier"]) == (4, 100)
    assert (
        exercises[2]["intensityValue"],
        exercises[2]["intensityValueExtend"],
    ) == (270_000, 300_000)
    assert (exercises[2]["intensityDisplayUnit"], exercises[2]["intensityMultiplier"]) == (1, 1000)


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


def test_structured_workout_allows_zero_percent_recovery_intensity() -> None:
    program = _build_coros_program(
        CorosWorkoutDraft(
            date="2026-08-12",
            name="Recovery",
            sport="run",
            steps=[
                CorosWorkoutStep(
                    intensity="heart_rate_percent",
                    intensity_basis="lthr",
                    intensity_low=0,
                    intensity_high=80,
                    intensity_zone=6,
                )
            ],
        )
    )

    exercises = program["exercises"]
    assert isinstance(exercises, list)
    assert (exercises[0]["intensityPercent"], exercises[0]["intensityPercentExtend"]) == (0, 80_000)


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
async def test_native_library_hyrox_schedules_only_the_selected_workout() -> None:
    class FakeClient:
        def __init__(self) -> None:
            self.calls: list[str] = []
            self.scheduled: dict[str, object] | None = None

        async def get_training_hub(self, _path: str, _params: object) -> object:
            return {
                "id": "library",
                "sportType": 9,
                "pbVersion": 9,
                "name": "Hyrox",
                "exercises": [{"exerciseKind": 1}],
            }

        async def post_training_hub(self, path: str, payload: object) -> object:
            self.calls.append(path)
            if path == "/training/program/calculate":
                return {"planDuration": 600}
            self.scheduled = payload  # type: ignore[assignment]
            return None

        async def fetch_training_schedule(self, _start: str, _end: str) -> dict[str, object]:
            if self.scheduled is None:
                return {"maxIdInPlan": 7}
            return {
                "entities": [{"happenDay": "20260811", "idInPlan": 8, "planId": "plan-1"}],
                "programs": self.scheduled["programs"],  # type: ignore[index]
            }

    client = FakeClient()
    event = await _schedule_library_hyrox(client, "library", "2026-08-11")  # type: ignore[arg-type]

    assert client.calls == ["/training/program/calculate", "/training/schedule/update"]
    assert client.scheduled is not None
    scheduled_program = client.scheduled["programs"][0]  # type: ignore[index]
    assert scheduled_program["id"] == "library"
    assert scheduled_program["idInPlan"] == 8
    assert scheduled_program["exercises"] == [{"exerciseKind": 1}]
    assert event.uid == "coros:plan-1:8:20260811"


@pytest.mark.asyncio
async def test_native_library_hyrox_rejects_non_hyrox_library() -> None:
    class FakeClient:
        async def get_training_hub(self, _path: str, _params: object) -> object:
            return {"id": "library", "sportType": 1}

        async def fetch_training_schedule(self, _start: str, _end: str) -> dict[str, object]:
            return {
                "programs": [],
                "entities": [],
            }

    with pytest.raises(HTTPException, match="HYROX workouts only"):
        await _schedule_library_hyrox(FakeClient(), "library", "2026-08-11")  # type: ignore[arg-type]


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
async def test_library_editor_uses_program_query_when_detail_is_unavailable(monkeypatch) -> None:
    class FakeClient:
        async def post_training_hub(self, _path: str, _payload: object) -> object:
            return [
                {
                    "id": "hyrox",
                    "name": "Hyrox Full Race",
                    "sportType": 9,
                    "exercises": [
                        {
                            "exerciseType": 2,
                            "exerciseKind": 1,
                            "exerciseName": "Ski Erg",
                            "targetType": 5,
                            "targetValue": 100_000,
                        }
                    ],
                }
            ]

        async def get_training_hub(self, _path: str, _params: object) -> object:
            raise AssertionError("program detail should not be requested")

    async def fake_coros_client(_db: object) -> FakeClient:
        return FakeClient()

    monkeypatch.setattr(training_plan_routes, "_coros_client", fake_coros_client)

    workout = await training_plan_routes.get_coros_library_workout(
        "hyrox", "2026-08-21", None  # type: ignore[arg-type]
    )

    assert workout.sport == "hyrox"
    assert workout.steps[0].name == "Ski Erg"


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


def test_build_coros_program_distance_units() -> None:
    # 7000m run -> targetValue = 700,000 cm (7 km), targetDisplayUnit = 1 (km)
    draft_run = CorosWorkoutDraft(
        date="2026-08-12",
        name="7km Run",
        sport="run",
        steps=[CorosWorkoutStep(kind="training", target="distance", value=7000)],
    )
    program_run = _build_coros_program(draft_run)
    assert program_run["exercises"][0]["targetValue"] == 700_000
    assert program_run["exercises"][0]["targetDisplayUnit"] == 1

    # 50m HYROX Sled Push -> targetValue = 5000 cm (50m), targetDisplayUnit = 2 (m)
    draft_hyrox = CorosWorkoutDraft(
        date="2026-08-12",
        name="HYROX Prep",
        sport="hyrox",
        steps=[CorosWorkoutStep(kind="training", name="Sled Push", target="distance", value=50)],
    )
    program_hyrox = _build_coros_program(draft_hyrox)
    assert program_hyrox["exercises"][0]["targetValue"] == 5000
    assert program_hyrox["exercises"][0]["targetDisplayUnit"] == 2
