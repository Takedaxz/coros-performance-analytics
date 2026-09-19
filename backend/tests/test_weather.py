import datetime
from types import SimpleNamespace
from typing import TYPE_CHECKING, cast
from unittest.mock import AsyncMock

import pytest

from src.db.models import ActivityRecord
from src.weather import WeatherSnapshot, _snapshot_from_payload, load_activity_weather

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


WEATHER: WeatherSnapshot = {
    "source": "Open-Meteo",
    "observed_at": "2026-09-19T06:00:00Z",
    "latitude": 13.75,
    "longitude": 100.5,
    "temperature_c": 30.0,
    "apparent_temperature_c": 34.0,
    "humidity_pct": 70,
    "precipitation_mm": 0.2,
    "weather_code": 61,
    "condition": "Rain",
    "wind_speed_kph": 8.0,
}


def test_weather_snapshot_matches_nearest_hour() -> None:
    payload = {
        "hourly": {
            "time": ["2026-09-19T05:00", "2026-09-19T06:00"],
            "temperature_2m": [29.0, 30.0],
            "apparent_temperature": [33.0, 34.0],
            "relative_humidity_2m": [74, 70],
            "precipitation": [0.0, 0.2],
            "weather_code": [2, 61],
            "wind_speed_10m": [6.0, 8.0],
        }
    }

    assert (
        _snapshot_from_payload(
            payload,
            datetime.datetime(2026, 9, 19, 5, 40),
            13.75,
            100.5,
        )
        == WEATHER
    )


def test_weather_snapshot_rejects_invalid_provider_values() -> None:
    payload = {
        "hourly": {
            "time": ["2026-09-19T06:00"],
            "temperature_2m": [30.0],
            "apparent_temperature": [34.0],
            "relative_humidity_2m": [140],
            "precipitation": [0.0],
            "weather_code": [0],
            "wind_speed_10m": [8.0],
        }
    }

    assert (
        _snapshot_from_payload(
            payload,
            datetime.datetime(2026, 9, 19, 6),
            13.75,
            100.5,
        )
        is None
    )


@pytest.mark.asyncio
async def test_activity_without_gps_does_not_reuse_or_fetch_weather(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fetch = AsyncMock(return_value=WEATHER)
    monkeypatch.setattr("src.weather._fetch_weather", fetch)
    activity = SimpleNamespace(id="activity-1", weather=dict(WEATHER))

    result = await load_activity_weather(
        cast("AsyncSession", None),
        activity,
        [],
    )

    assert result is None
    fetch.assert_not_awaited()


@pytest.mark.asyncio
async def test_activity_weather_fetches_once_then_reuses_snapshot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fetch = AsyncMock(return_value=WEATHER)
    monkeypatch.setattr("src.weather._fetch_weather", fetch)
    activity = SimpleNamespace(id="activity-1", weather=None)
    record = ActivityRecord(
        activity_id="activity-1",
        timestamp=datetime.datetime(2026, 9, 19, 5, 40),
        position_lat=13.75,
        position_long=100.5,
    )
    db = AsyncMock()

    first = await load_activity_weather(db, activity, [record])
    second = await load_activity_weather(db, activity, [record])

    assert first == WEATHER
    assert second == WEATHER
    assert activity.weather == WEATHER
    fetch.assert_awaited_once()
    db.commit.assert_awaited_once()
