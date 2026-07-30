from datetime import datetime

import pytest
from fastapi import HTTPException

from src.api.routes.activity_routes import (
    DatePeriod,
    _lap_start_elapsed,
    _lap_type,
    _period_bounds,
    _validate_range,
)


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
        ("None", None),
        (None, None),
    ],
)
def test_lap_type_uses_only_persisted_coros_labels(
    trigger: str | None,
    expected: str | None,
) -> None:
    assert _lap_type(trigger) == expected
