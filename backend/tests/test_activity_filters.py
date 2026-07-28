from datetime import datetime

import pytest
from fastapi import HTTPException

from src.api.routes.activity_routes import DatePeriod, _period_bounds, _validate_range


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
