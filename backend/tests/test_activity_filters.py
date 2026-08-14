from datetime import date, datetime
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from src.activity_laps import swim_lap_name
from src.api.routes.activity_routes import (
    DatePeriod,
    _lap_start_elapsed,
    _lap_type,
    _period_bounds,
    _validate_range,
)
from src.api.routes.dashboard_routes import _training_volume_bounds, training_volume_trend
from src.parsers.fit_parser import _fit_lap_trigger


@pytest.mark.parametrize(
    ("period", "value", "expected"),
    [
        ("day", "2026-07-28", (datetime(2026, 7, 28), datetime(2026, 7, 29))),
        ("week", "2026-W31", (datetime(2026, 7, 27), datetime(2026, 8, 3))),
        ("month", "2026-07", (datetime(2026, 7, 1), datetime(2026, 8, 1))),
        ("year", "2026", (datetime(2026, 1, 1), datetime(2027, 1, 1))),
    ],
)
def test_period_bounds(period: DatePeriod, value: str, expected: tuple[datetime, datetime]) -> None:
    assert _period_bounds(period, value) == expected


def test_invalid_filter_values_raise_422() -> None:
    with pytest.raises(HTTPException, match="Invalid month value"):
        _period_bounds("month", "2026-13")
    with pytest.raises(HTTPException, match="minimum cannot exceed maximum"):
        _validate_range("Distance", 10, 5)


def test_training_volume_bounds_are_inclusive_and_validated() -> None:
    assert _training_volume_bounds(date(2026, 8, 1), date(2026, 8, 3)) == (
        datetime(2026, 8, 1),
        datetime(2026, 8, 4),
    )
    with pytest.raises(HTTPException, match="start_date cannot be after end_date"):
        _training_volume_bounds(date(2026, 8, 4), date(2026, 8, 3))


@pytest.mark.asyncio
async def test_training_volume_serializes_aggregate_rows() -> None:
    class Result:
        def all(self) -> list[SimpleNamespace]:
            return [
                SimpleNamespace(
                    period_start=datetime(2026, 8, 3),
                    distance_m=12500,
                    duration_s=4200,
                    training_load=82,
                    activity_count=2,
                )
            ]

    class Session:
        async def execute(self, _query: object) -> Result:
            return Result()

    assert await training_volume_trend(
        group_by="week",
        start_date=date(2026, 8, 1),
        end_date=date(2026, 8, 9),
        db=Session(),  # type: ignore[arg-type]
    ) == [
        {
            "period_start": "2026-08-03",
            "distance_m": 12500,
            "duration_s": 4200,
            "training_load": 82,
            "activity_count": 2,
        }
    ]


def test_lap_elapsed_uses_first_lap_as_origin() -> None:
    first = datetime(2026, 7, 28, 12, 43, 15)

    assert _lap_start_elapsed(first, first) == 0
    assert _lap_start_elapsed(datetime(2026, 7, 28, 12, 44, 35), first) == 80


@pytest.mark.parametrize(
    ("trigger", "expected"),
    [
        ("coros_warmup", "warmup"),
        ("coros_training", "training"),
        ("coros_rest", "rest"),
        ("coros_cooldown", "cooldown"),
        ("coros_swim:freestyle", "swim"),
        ("None", None),
        (None, None),
    ],
)
def test_lap_type_uses_only_persisted_coros_labels(
    trigger: str | None,
    expected: str | None,
) -> None:
    assert _lap_type(trigger) == expected


def test_swim_lap_mapping_uses_fit_sport_and_stroke() -> None:
    assert _fit_lap_trigger(
        "swimming", "lap_swimming", 100, "freestyle", "None"
    ) == "coros_swim:freestyle"
    assert _fit_lap_trigger(
        "swimming", "lap_swimming", 0, None, "None"
    ) == "coros_rest"
    assert _fit_lap_trigger("running", None, 1000, None, "None") is None
    assert swim_lap_name("coros_swim:breaststroke") == "Breaststroke"
