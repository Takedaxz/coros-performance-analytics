"""Lazy historical weather enrichment for GPS activities."""

from __future__ import annotations

import datetime
import logging
import math
from typing import TYPE_CHECKING, TypedDict, cast

import httpx
from sqlalchemy import select

from src.db.models import ActivityRecord

if TYPE_CHECKING:
    from collections.abc import Sequence

    from sqlalchemy.ext.asyncio import AsyncSession

    from src.db.models import Activity

logger = logging.getLogger(__name__)

_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
_HOURLY_FIELDS = (
    "temperature_2m,apparent_temperature,relative_humidity_2m,"
    "precipitation,weather_code,wind_speed_10m"
)


class WeatherSnapshot(TypedDict):
    source: str
    observed_at: str
    latitude: float
    longitude: float
    temperature_c: float
    apparent_temperature_c: float
    humidity_pct: int
    precipitation_mm: float
    weather_code: int
    condition: str
    wind_speed_kph: float


def _weather_condition(code: int) -> str:
    if code == 0:
        return "Clear sky"
    if code == 1:
        return "Mainly clear"
    if code == 2:
        return "Partly cloudy"
    if code == 3:
        return "Overcast"
    if code in {45, 48}:
        return "Fog"
    if code in {51, 53, 55}:
        return "Drizzle"
    if code in {56, 57}:
        return "Freezing drizzle"
    if code in {61, 63, 65}:
        return "Rain"
    if code in {66, 67}:
        return "Freezing rain"
    if code in {71, 73, 75, 77}:
        return "Snow"
    if code in {80, 81, 82}:
        return "Rain showers"
    if code in {85, 86}:
        return "Snow showers"
    if code in {95, 96, 99}:
        return "Thunderstorm"
    return "Unknown"


def _finite_number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def _hourly_number(hourly: dict[str, object], key: str, index: int) -> float | None:
    values = hourly.get(key)
    if not isinstance(values, list) or index >= len(values):
        return None
    return _finite_number(values[index])


def _parse_hour(value: object) -> datetime.datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.datetime.fromisoformat(value)
    except ValueError:
        return None
    return (
        parsed.replace(tzinfo=datetime.UTC)
        if parsed.tzinfo is None
        else parsed.astimezone(datetime.UTC)
    )


def _snapshot_from_payload(
    payload: object,
    observed_at: datetime.datetime,
    latitude: float,
    longitude: float,
) -> WeatherSnapshot | None:
    if not isinstance(payload, dict) or not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
        return None
    hourly = payload.get("hourly")
    if not isinstance(hourly, dict):
        return None
    raw_times = hourly.get("time")
    if not isinstance(raw_times, list):
        return None
    hours = [_parse_hour(value) for value in raw_times]
    valid_hours = [(index, hour) for index, hour in enumerate(hours) if hour is not None]
    if not valid_hours:
        return None

    target = (
        observed_at.replace(tzinfo=datetime.UTC)
        if observed_at.tzinfo is None
        else observed_at.astimezone(datetime.UTC)
    )
    index, matched_hour = min(valid_hours, key=lambda item: abs(item[1] - target))
    temperature = _hourly_number(hourly, "temperature_2m", index)
    apparent = _hourly_number(hourly, "apparent_temperature", index)
    humidity = _hourly_number(hourly, "relative_humidity_2m", index)
    precipitation = _hourly_number(hourly, "precipitation", index)
    weather_code = _hourly_number(hourly, "weather_code", index)
    wind_speed = _hourly_number(hourly, "wind_speed_10m", index)
    if (
        temperature is None
        or apparent is None
        or humidity is None
        or precipitation is None
        or weather_code is None
        or wind_speed is None
    ):
        return None
    if not 0 <= humidity <= 100 or precipitation < 0 or wind_speed < 0:
        return None

    code = int(weather_code)
    if weather_code != code or not 0 <= code <= 99:
        return None
    snapshot: WeatherSnapshot = {
        "source": "Open-Meteo",
        "observed_at": matched_hour.isoformat().replace("+00:00", "Z"),
        "latitude": round(latitude, 5),
        "longitude": round(longitude, 5),
        "temperature_c": round(temperature, 1),
        "apparent_temperature_c": round(apparent, 1),
        "humidity_pct": round(humidity),
        "precipitation_mm": round(precipitation, 1),
        "weather_code": code,
        "condition": _weather_condition(code),
        "wind_speed_kph": round(wind_speed, 1),
    }
    return snapshot


async def _fetch_weather(
    latitude: float,
    longitude: float,
    observed_at: datetime.datetime,
) -> WeatherSnapshot | None:
    target = (
        observed_at.replace(tzinfo=datetime.UTC)
        if observed_at.tzinfo is None
        else observed_at.astimezone(datetime.UTC)
    )
    recent_cutoff = datetime.datetime.now(datetime.UTC).date() - datetime.timedelta(days=5)
    url = _FORECAST_URL if target.date() >= recent_cutoff else _ARCHIVE_URL
    params = {
        "latitude": latitude,
        "longitude": longitude,
        "start_date": target.date().isoformat(),
        "end_date": target.date().isoformat(),
        "hourly": _HOURLY_FIELDS,
        "timezone": "UTC",
        "wind_speed_unit": "kmh",
    }
    async with httpx.AsyncClient(timeout=5.0) as client:
        response = await client.get(url, params=params)
        response.raise_for_status()
    return _snapshot_from_payload(response.json(), target, latitude, longitude)


async def load_activity_weather(
    db: AsyncSession,
    activity: Activity,
    records: Sequence[ActivityRecord] | None = None,
) -> WeatherSnapshot | None:
    """Reuse stored weather, otherwise fetch it once for the first GPS record."""
    gps_record = next(
        (
            record
            for record in records or ()
            if record.position_lat is not None and record.position_long is not None
        ),
        None,
    )
    if gps_record is None and records is None:
        gps_record = await db.scalar(
            select(ActivityRecord)
            .where(
                ActivityRecord.activity_id == activity.id,
                ActivityRecord.position_lat.is_not(None),
                ActivityRecord.position_long.is_not(None),
            )
            .order_by(ActivityRecord.timestamp)
            .limit(1)
        )
    if gps_record is None:
        return None

    stored = getattr(activity, "weather", None)
    if isinstance(stored, dict):
        return cast("WeatherSnapshot", stored)

    try:
        snapshot = await _fetch_weather(
            float(gps_record.position_lat),
            float(gps_record.position_long),
            gps_record.timestamp,
        )
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning(
            "activity_weather_fetch_failed activity_id=%s error=%s",
            activity.id,
            exc,
        )
        return None
    if snapshot is None:
        logger.warning("activity_weather_invalid_payload activity_id=%s", activity.id)
        return None

    activity.weather = dict(snapshot)
    await db.commit()
    return snapshot
