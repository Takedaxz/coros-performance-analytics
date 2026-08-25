"""Sync manager: orchestrates API data fetch -> canonical DB upsert.

Handles both manual "Sync Now" and scheduled background sync.
Publishes progress events for SSE consumption.
"""

import asyncio
import hashlib
import logging
from collections.abc import Callable
from datetime import date as date_type
from datetime import datetime, timedelta

from redis.asyncio import Redis
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import get_settings
from src.db.credential_store import load_coros_credentials
from src.db.models import (
    Activity,
    ActivityLap,
    ActivityRecord,
    DailyHealth,
    FitnessEstimate,
    SleepSession,
    SourceType,
    SportType,
    SyncEvent,
    User,
)
from src.sync.api_client import CorosApiClient, CorosApiClientError
from src.metrics.anomaly import check_daily_health_anomalies
from src.metrics.baselines import compute_rolling_baseline, compute_zscore
from src.metrics.derived import compute_daily_strain, compute_recovery_score

logger = logging.getLogger(__name__)

# Type alias for SSE event push callback
EventCallback = Callable[[str, str], None]

_PERSONAL_RECORD_GROUPS = {
    1: "4 weeks",
    2: "Half year",
    3: "12 weeks",
    4: "All",
}
_PERSONAL_RECORD_GROUP_ORDER = {1: 0, 3: 1, 2: 2, 4: 3}
_PERSONAL_RECORDS = {
    101: ("Longest Run", None),
    103: ("Most Elevation Gain", None),
    7: ("1K", 1_000),
    6: ("3K", 3_000),
    5: ("5K", 5_000),
    4: ("10K", 10_000),
    2: ("Half Marathon", 21_097.5),
    13: ("Marathon", 42_195),
}

_TRAINING_DISTRIBUTION_FIELDS = {
    "hr_training_load": "hrTlAreaList",
    "hr_distance": "hrDisAreaList",
    "hr_time": "hrTimeAreaList",
    "distance_frequency": "distanceCountAreaList",
    "distance_training_load": "distanceTlAreaList",
    "distance_time": "distanceTimeAreaList",
}

_ACTIVITY_INCREMENTAL_DAYS = 28
_HEALTH_INCREMENTAL_DAYS = 7
_HEALTH_BOOTSTRAP_DAYS = 100
_ACTIVITY_BOOTSTRAP_DAYS = 1095


def _number(value: object) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and value > 0:
        return float(value)
    if isinstance(value, str):
        try:
            parsed = float(value)
        except ValueError:
            return None
        return parsed if parsed > 0 else None
    return None


def _nonnegative_number(value: object) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and value >= 0:
        return float(value)
    if isinstance(value, str):
        try:
            parsed = float(value)
        except ValueError:
            return None
        return parsed if parsed >= 0 else None
    return None


def _first_number(data: dict, keys: tuple[str, ...]) -> float | None:
    for key in keys:
        value = _number(data.get(key))
        if value is not None:
            return value
    return None


def _duration_seconds(value: float | None, *, direct: bool = False) -> int | None:
    if value is None:
        return None
    seconds = value if direct or value < 10_000 else value / 100
    return round(seconds) if seconds > 0 else None


def _strength_calories(value: object) -> int:
    return round((_nonnegative_number(value) or 0) / 1_000)


def _strength_time_seconds(value: object) -> int:
    """Convert COROS strength centiseconds to display seconds."""
    return round((_nonnegative_number(value) or 0) / 100)


def _strength_detail_payload(raw_detail: dict) -> dict[str, object] | None:
    lap_list = raw_detail.get("lapList")
    if not isinstance(lap_list, list) or not lap_list or not isinstance(lap_list[0], dict):
        return None
    lap_items = lap_list[0].get("lapItemList")
    if not isinstance(lap_items, list):
        return None

    exercises_by_index: dict[int, list[dict]] = {}
    for item in lap_items:
        if not isinstance(item, dict):
            continue
        index = int(_nonnegative_number(item.get("exerciseIndex")) or 0)
        exercises_by_index.setdefault(index, []).append(item)

    exercises: list[dict[str, object]] = []
    for grouped_laps in exercises_by_index.values():
        laps = [
            lap
            for lap in grouped_laps
            if lap.get("exerciseNameKey") != "S3618"
        ]
        if not laps:
            continue
        name_item = next(
            (
                lap
                for lap in laps
                if isinstance(lap.get("exerciseNameKey"), str)
                and lap["exerciseNameKey"]
            ),
            None,
        )
        name_key = name_item.get("exerciseNameKey") if isinstance(name_item, dict) else None
        if not isinstance(name_key, str) or not name_key:
            continue
        entries: list[dict[str, int | float]] = []
        for index, lap in enumerate(laps):
            reps = int(_nonnegative_number(lap.get("reps")) or 0)
            sets = int(_nonnegative_number(lap.get("sets")) or 0)
            if reps <= 0 or sets > 0:
                continue
            next_lap = laps[index + 1] if index + 1 < len(laps) else None
            rest_seconds = (
                _strength_time_seconds(next_lap.get("time"))
                if isinstance(next_lap, dict)
                and (_nonnegative_number(next_lap.get("reps")) or 0) == 0
                and (_nonnegative_number(next_lap.get("sets")) or 0) == 0
                else None
            )
            entries.append(
                {
                    "reps": reps,
                    "weight_kg": round((_nonnegative_number(lap.get("weight")) or 0) / 1_000, 2),
                    "work_s": _strength_time_seconds(lap.get("time")),
                    "rest_s": rest_seconds or 0,
                    "calories": _strength_calories(lap.get("calories")),
                }
            )
        if not entries:
            continue
        aggregate = next(
            (lap for lap in laps if (_nonnegative_number(lap.get("sets")) or 0) > 0),
            None,
        )
        entry_reps = sum(int(entry["reps"]) for entry in entries)
        exercises.append(
            {
                "name_key": name_key,
                "name": name_item.get("name") if isinstance(name_item, dict) and isinstance(name_item.get("name"), str) else None,
                "sets": int(_nonnegative_number(aggregate.get("sets")) or len(entries))
                if isinstance(aggregate, dict)
                else len(entries),
                "total_reps": int(_nonnegative_number(aggregate.get("reps")) or entry_reps)
                if isinstance(aggregate, dict)
                else entry_reps,
                "entries": entries,
            }
        )

    if not exercises:
        return None
    summary = raw_detail.get("summary")
    values = summary if isinstance(summary, dict) else raw_detail
    payload: dict[str, object] = {
        "sets": int(_nonnegative_number(values.get("sets")) or sum(int(exercise["sets"]) for exercise in exercises)),
        "total_reps": int(_nonnegative_number(values.get("totalReps")) or sum(int(exercise["total_reps"]) for exercise in exercises)),
        "total_weight_kg": round((_nonnegative_number(values.get("totalWeight")) or 0) / 1_000, 1),
        "exercises": len(exercises),
        "calories": _strength_calories(values.get("calories")),
        "duration_s": _strength_time_seconds(
            values.get("totalTime") or values.get("workoutTime")
        ),
        "exercises_detail": exercises,
    }
    for source_key, target_key in (
        ("avgHr", "avg_hr_bpm"),
        ("maxHr", "max_hr_bpm"),
        ("trainingLoad", "training_load"),
        ("aerobicEffect", "aerobic_effect"),
        ("anaerobicEffect", "anaerobic_effect"),
    ):
        value = _nonnegative_number(values.get(source_key))
        if value is not None:
            payload[target_key] = round(value, 1)
    return payload


def _coros_detail_lap_items(raw_detail: dict, group_type: int | None = None) -> list[dict]:
    """Select the most detailed COROS lap group, matching CorosLink."""
    summary = raw_detail.get("summaryInfo")
    sources = [raw_detail, summary] if isinstance(summary, dict) else [raw_detail]
    best_items: list[dict] = []

    for source in sources:
        lap_list = source.get("lapList") or source.get("laps") or source.get("lapInfoList")
        if not isinstance(lap_list, list):
            continue
        for lap in lap_list:
            if group_type is not None and (
                not isinstance(lap, dict) or _nonnegative_number(lap.get("type")) != group_type
            ):
                continue
            items = (
                lap.get("lapItemList")
                if isinstance(lap, dict) and isinstance(lap.get("lapItemList"), list)
                else [lap]
            )
            items = [item for item in items if isinstance(item, dict)]
            populated = sum(
                1
                for item in items
                if _nonnegative_number(item.get("distance") or item.get("totalDistance")) is not None
                or _nonnegative_number(item.get("totalTime") or item.get("time") or item.get("duration")) is not None
            )
            best_populated = sum(
                1
                for item in best_items
                if _nonnegative_number(item.get("distance") or item.get("totalDistance")) is not None
                or _nonnegative_number(item.get("totalTime") or item.get("time") or item.get("duration")) is not None
            )
            if populated > best_populated or (populated == best_populated and len(items) > len(best_items)):
                best_items = items
    return best_items


def _detail_activity_laps(activity: Activity, raw_detail: dict) -> list[ActivityLap]:
    """Convert COROS detail lap items from centiseconds and centimetres."""
    elapsed_before = 0.0
    laps: list[ActivityLap] = []
    is_hyrox = activity.subsport == "1200"
    is_running = activity.sport in {SportType.RUN, SportType.TRAIL_RUN}
    is_swim = activity.sport == SportType.SWIM
    is_ride = activity.sport == SportType.RIDE
    items = [
        item
        for item in _coros_detail_lap_items(
            raw_detail,
            2 if is_running or is_swim or is_ride else None,
        )
        if _nonnegative_number(item.get("mode")) != 16
    ]
    if is_ride and not any(
        _nonnegative_number(item.get("exerciseType")) in {1, 2, 3, 4} for item in items
    ):
        return []
    first_start = _nonnegative_number(items[0].get("startTimestamp")) if items else None
    for item in items:
        mode = _nonnegative_number(item.get("mode"))
        exercise_type = _nonnegative_number(item.get("exerciseType"))
        time_raw = next(
            (
                value
                for key in ("totalTime", "time", "duration")
                if (value := _nonnegative_number(item.get(key))) is not None
            ),
            None,
        )
        distance_raw = next(
            (
                value
                for key in ("distance", "totalDistance")
                if (value := _nonnegative_number(item.get(key))) is not None
            ),
            None,
        )
        actual_value = _nonnegative_number(item.get("actualValue"))
        target_type = _nonnegative_number(item.get("targetType"))
        if mode == 2 and actual_value is not None:
            distance_raw = max(distance_raw or 0, actual_value)
        elif mode == 14:
            distance_raw = actual_value
        elapsed_s = time_raw / 100 if time_raw is not None else 0
        distance_m = (
            distance_raw
            if mode == 14 and target_type == 3
            else distance_raw / 100
            if distance_raw is not None
            else None
        )
        if elapsed_s <= 0 and distance_m is None:
            continue
        start_timestamp = _nonnegative_number(item.get("startTimestamp"))
        start_offset_s = (
            (start_timestamp - first_start) / 100
            if start_timestamp is not None and first_start is not None
            else elapsed_before
        )
        exercise_name_key = item.get("exerciseNameKey")
        workout_step_trigger = (
            {
                1: "coros_warmup",
                2: "coros_run" if is_running else "coros_training",
                3: "coros_cooldown",
                4: "coros_rest",
            }.get(int(exercise_type))
            if (is_running or is_ride) and exercise_type is not None
            else None
        )
        swim_trigger = (
            {
                1: "coros_swim:warm_up",
                3: "coros_swim:cool_down",
                4: "coros_rest",
            }.get(int(exercise_type))
            if is_swim and exercise_type is not None
            else None
        )
        lap_trigger = workout_step_trigger or swim_trigger or (
            "coros_rest"
            if is_swim and mode == 3
            else "coros_swim"
            if is_swim
            else
            "coros_rest"
            if (is_hyrox or is_running or is_ride) and mode == 3
            else "coros_ride"
            if is_ride and mode in {0, 2} and distance_m is not None and distance_m > 0
            else "coros_run"
            if (is_hyrox or is_running)
            and mode in {0, 2}
            and distance_m is not None
            and distance_m > 0
            else f"coros_hyrox:{exercise_name_key}:{'reps' if target_type == 3 else 'm'}"
            if is_hyrox and mode == 14 and isinstance(exercise_name_key, str)
            else "coros_functional"
            if is_hyrox and mode == 0
            else "coros_detail"
        )
        laps.append(
            ActivityLap(
                activity_id=activity.id,
                lap_index=len(laps) + 1,
                start_time=activity.start_time + timedelta(seconds=start_offset_s),
                elapsed_s=elapsed_s,
                distance_m=distance_m,
                avg_hr_bpm=int(_nonnegative_number(item.get("avgHr")) or 0) or None,
                max_hr_bpm=int(_nonnegative_number(item.get("maxHr")) or 0) or None,
                avg_speed_mps=distance_m / elapsed_s
                if lap_trigger
                in {
                    "coros_warmup",
                    "coros_training",
                    "coros_cooldown",
                    "coros_rest",
                    "coros_run",
                    "coros_ride",
                    "coros_swim",
                    "coros_swim:warm_up",
                    "coros_swim:cool_down",
                }
                and distance_m is not None
                and elapsed_s > 0
                else None,
                avg_power_w=int(_nonnegative_number(item.get("avgPower")) or 0) or None,
                calories_kcal=round((_nonnegative_number(item.get("calories")) or 0) / 1_000)
                or None,
                avg_cadence=int(_nonnegative_number(item.get("avgCadence")) or 0) or None,
                lap_trigger=lap_trigger,
            )
        )
        elapsed_before += elapsed_s
    return laps


def _detail_activity_records(activity: Activity, raw_detail: dict) -> list[ActivityRecord]:
    """Convert COROS Hybrid frequency samples into existing activity records."""
    points = raw_detail.get("frequencyList")
    if not isinstance(points, list):
        return []
    items = [
        item
        for item in _coros_detail_lap_items(raw_detail)
        if _nonnegative_number(item.get("mode")) != 16
    ]
    first_start = _nonnegative_number(items[0].get("startTimestamp")) if items else None
    if first_start is None:
        return []

    records: list[ActivityRecord] = []
    for point in points:
        if not isinstance(point, dict):
            continue
        timestamp_raw = _nonnegative_number(point.get("timestamp"))
        if timestamp_raw is None or timestamp_raw < first_start:
            continue
        elapsed_s = (timestamp_raw - first_start) / 100
        pace_s_per_km = _nonnegative_number(point.get("speed"))
        distance_cm = _nonnegative_number(point.get("distance"))
        records.append(
            ActivityRecord(
                activity_id=activity.id,
                timestamp=activity.start_time + timedelta(seconds=elapsed_s),
                elapsed_s=elapsed_s,
                distance_m=distance_cm / 100 if distance_cm is not None else None,
                speed_mps=1000 / pace_s_per_km if pace_s_per_km else None,
                heart_rate_bpm=int(_nonnegative_number(point.get("heart")) or 0) or None,
                cadence=int(_nonnegative_number(point.get("cadence")) or 0) or None,
                power_w=int(_nonnegative_number(point.get("power")) or 0) or None,
                ground_time_ms=_nonnegative_number(point.get("groundTime")),
                stride_length_cm=_nonnegative_number(point.get("cadenceLength")),
                stride_ratio_pct=(
                    value / 10
                    if (value := _nonnegative_number(point.get("verticalStrideRatio")))
                    is not None
                    else None
                ),
                stride_height_cm=(
                    value / 10
                    if (value := _nonnegative_number(point.get("verticalVibration")))
                    is not None
                    else None
                ),
            )
        )
    return records


def _record_date(data: dict) -> str | None:
    for key in ("happenDay", "date", "recordDay", "day", "createTime", "startTime", "happenTime"):
        value = data.get(key)
        if value is None and isinstance(data.get("record"), dict):
            value = data["record"].get(key)
        if value is None:
            continue
        text = str(value).strip()
        if len(text) == 8 and text.isdigit():
            return f"{text[:4]}-{text[4:6]}-{text[6:]}"
        if len(text) >= 10:
            return text[:10]
    return None


def _normalize_longest_run_distance(value: float | None) -> float | None:
    if value is None:
        return None
    if value >= 100_000:
        return value / 100
    if value >= 1_000:
        return value
    if value >= 100:
        return value * 10
    return value / 100 if value >= 1 else None


def _normalize_elevation_gain(value: float | None) -> float | None:
    if value is None:
        return None
    if value >= 10_000:
        return value / 100
    if value >= 500 and value.is_integer() and value % 100 == 0:
        return value / 100
    return value


def _normalize_coros_personal_records(dashboard_data: dict) -> list[dict[str, object]]:
    summary = dashboard_data.get("summaryInfo")
    if not isinstance(summary, dict):
        return []
    raw_groups = summary.get("recordDetailList")
    if not isinstance(raw_groups, list):
        return []

    groups: list[dict[str, object]] = []
    for raw_group in raw_groups:
        if not isinstance(raw_group, dict):
            continue
        group_type_value = _number(raw_group.get("type"))
        group_type = int(group_type_value) if group_type_value is not None else 0
        raw_records = raw_group.get("recordList")
        if group_type not in _PERSONAL_RECORD_GROUPS or not isinstance(raw_records, list):
            continue

        records_by_type: dict[int, dict[str, object]] = {}
        for raw_record in raw_records:
            if not isinstance(raw_record, dict):
                continue
            record_type_value = _number(raw_record.get("type"))
            record_type = int(record_type_value) if record_type_value is not None else 0
            record_meta = _PERSONAL_RECORDS.get(record_type)
            if record_meta is None:
                continue

            label, fixed_distance_m = record_meta
            raw_value = _first_number(raw_record, ("record", "recordValue", "value", "best"))
            date_value = _record_date(raw_record)
            if record_type == 101:
                distance_m = _normalize_longest_run_distance(
                    raw_value
                    or _first_number(raw_record, ("distance", "totalDistance", "dis", "recordDis"))
                )
                duration_s = _duration_seconds(_first_number(raw_record, ("duration",)), direct=True)
                if duration_s is None:
                    duration_s = _duration_seconds(_first_number(raw_record, ("time",)))
            elif record_type == 103:
                distance_m = _normalize_elevation_gain(
                    _first_number(
                        raw_record,
                        ("record", "recordDis", "recordValue", "time", "distance", "ascent"),
                    )
                )
                duration_s = None
            else:
                distance_m = fixed_distance_m
                duration_s = _duration_seconds(
                    _first_number(raw_record, ("duration",)), direct=True
                ) or _duration_seconds(
                    _first_number(raw_record, ("best", "record", "time", "recordValue"))
                )

            if distance_m is None or (record_type != 103 and duration_s is None):
                continue
            pace_s_per_km = (
                round(duration_s / (distance_m / 1_000))
                if duration_s is not None and distance_m > 0 and record_type != 103
                else None
            )
            records_by_type[record_type] = {
                "type": record_type,
                "label": label,
                "distance_m": round(distance_m, 2),
                "duration_s": duration_s,
                "pace_s_per_km": pace_s_per_km,
                "date": date_value,
            }

        records = [
            records_by_type[record_type]
            for record_type in _PERSONAL_RECORDS
            if record_type in records_by_type
        ]
        if records:
            groups.append(
                {
                    "type": group_type,
                    "label": _PERSONAL_RECORD_GROUPS[group_type],
                    "records": records,
                }
            )

    return sorted(groups, key=lambda group: _PERSONAL_RECORD_GROUP_ORDER[int(group["type"])])


async def _upsert_coros_personal_records(
    db: AsyncSession,
    user_id: str,
    dashboard_data: dict,
) -> int:
    record_groups = _normalize_coros_personal_records(dashboard_data)
    if not record_groups:
        return 0

    user = await db.scalar(select(User).where(User.id == user_id))
    if user is None:
        return 0
    preferences = dict(user.device_preferences or {})
    preferences["coros_personal_record_groups"] = record_groups
    user.device_preferences = preferences
    await db.flush()
    return len(record_groups)


async def _upsert_coros_running_fitness(
    db: AsyncSession,
    user_id: str,
    dashboard_data: dict,
) -> int:
    summary = dashboard_data.get("summaryInfo")
    if not isinstance(summary, dict):
        return 0

    fields = (
        "aerobicEnduranceScore",
        "lactateThresholdCapacityScore",
        "anaerobicEnduranceScore",
        "anaerobicCapacityScore",
        "lthr",
        "ltsp",
        "fitnessMaxHr",
        "runningLevelHr",
    )
    fitness = {field: value for field in fields if (value := _number(summary.get(field))) is not None}
    if not fitness:
        return 0

    user = await db.scalar(select(User).where(User.id == user_id))
    if user is None:
        return 0
    preferences = dict(user.device_preferences or {})
    preferences["coros_running_fitness"] = fitness
    user.device_preferences = preferences
    await db.flush()
    return 1


def _normalize_zone_distribution(raw: object) -> list[dict[str, float | int]]:
    if not isinstance(raw, list):
        return []
    entries: list[dict[str, float | int]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        index = _nonnegative_number(item.get("index"))
        if index is None:
            continue
        entry: dict[str, float | int] = {"index": int(index)}
        ratio = _nonnegative_number(item.get("ratio"))
        value = _nonnegative_number(item.get("value"))
        if ratio is not None:
            entry["ratio"] = ratio
        if value is not None:
            entry["value"] = value
        entries.append(entry)
    return sorted(entries, key=lambda entry: int(entry["index"]))


def _normalize_rpe_distribution(activities: list[dict]) -> dict[str, object]:
    buckets = [
        {"level": level, "frequency": 0, "srpe": 0.0, "time_seconds": 0.0}
        for level in range(1, 6)
    ]
    rated = 0
    for activity in activities:
        feel_info = activity.get("sportFeelInfo")
        feel_source = feel_info if isinstance(feel_info, dict) else activity
        feel_type = _number(feel_source.get("feelType"))
        if feel_type is None or not feel_type.is_integer() or not 1 <= feel_type <= 5:
            continue
        duration = _number(activity.get("totalTime"))
        bucket = buckets[int(feel_type) - 1]
        bucket["frequency"] = int(bucket["frequency"]) + 1
        rated += 1
        if duration is not None:
            bucket["time_seconds"] = float(bucket["time_seconds"]) + duration
            bucket["srpe"] = float(bucket["srpe"]) + (feel_type * 2 * duration / 60)
    return {"buckets": buckets, "coverage": {"rated": rated, "total": len(activities)}}


async def _load_coros_rpe_inputs(
    client: CorosApiClient,
    activities: list[dict],
    cached_feel_types: dict[str, int],
) -> tuple[list[dict], dict[str, int]]:
    inputs: list[dict] = []
    refreshed_cache: dict[str, int] = {}
    cutoff = datetime.utcnow() - timedelta(days=28)
    for activity in activities:
        start_time = _parse_timestamp(activity.get("startTime"))
        if start_time is None or start_time < cutoff:
            continue
        label_id = activity.get("labelId")
        sport_type = _number(activity.get("sportType"))
        if not isinstance(label_id, (str, int)) or sport_type is None:
            continue
        cache_key = str(label_id)
        feel_type = cached_feel_types.get(cache_key)
        if feel_type is None:
            try:
                feel_type = await client.fetch_activity_feel_type(cache_key, int(sport_type))
            except CorosApiClientError as exc:
                logger.warning("coros_rpe_detail_fetch_failed: activity=%s error=%s", cache_key, exc)
                continue
            await asyncio.sleep(0.4)
        if feel_type is None:
            continue
        refreshed_cache[cache_key] = feel_type
        inputs.append({"sportFeelInfo": {"feelType": feel_type}, "totalTime": activity.get("totalTime")})
    return inputs, refreshed_cache


async def _upsert_coros_training_distributions(
    db: AsyncSession,
    user_id: str,
    analytics_data: dict,
    activities: list[dict],
    client: CorosApiClient,
) -> None:
    user = await db.scalar(select(User).where(User.id == user_id))
    if user is None:
        return
    summary = analytics_data.get("summaryInfo")
    summary_data = summary if isinstance(summary, dict) else {}
    distributions = {
        key: _normalize_zone_distribution(summary_data.get(field))
        for key, field in _TRAINING_DISTRIBUTION_FIELDS.items()
    }
    preferences = dict(user.device_preferences or {})
    raw_cache = preferences.get("coros_rpe_feel_types", {})
    cached_feel_types = raw_cache if isinstance(raw_cache, dict) else {}
    rpe_inputs, refreshed_cache = await _load_coros_rpe_inputs(
        client, activities, cached_feel_types
    )
    distributions["rpe"] = _normalize_rpe_distribution(rpe_inputs)
    preferences["coros_training_distributions"] = distributions
    preferences["coros_rpe_feel_types"] = refreshed_cache
    user.device_preferences = preferences
    await db.flush()


async def run_sync(
    db: AsyncSession,
    user_id: str,
    days: int | None = None,
    on_event: EventCallback | None = None,
    redis: Redis | None = None,
    sync_event_id: str | None = None,
) -> SyncEvent:
    """Execute a full API sync and upsert results into canonical tables."""
    sync_kwargs: dict = {}
    if sync_event_id:
        sync_kwargs["id"] = sync_event_id
    sync_event = SyncEvent(
        user_id=user_id,
        source_type=SourceType.API_OFFICIAL,
        status="running",
        started_at=datetime.utcnow(),
        **sync_kwargs,
    )
    db.add(sync_event)
    await db.flush()

    total_upserted = 0
    settings = get_settings()

    # Resolve credentials: DB store takes priority over env vars.
    # Env vars still work as a fallback for backwards-compatibility.
    _db_creds = await load_coros_credentials(db, settings.app_secret_key)
    _email = (_db_creds[0] if _db_creds else None) or settings.coros_email
    _password = (_db_creds[1] if _db_creds else None) or settings.coros_password

    if not _email or not _password:
        raise ValueError(
            "COROS credentials are not configured. "
            "Set them via the Settings page or COROS_EMAIL/COROS_PASSWORD env vars."
        )

    try:
        client = CorosApiClient(
            email=_email,
            password=_password,
            redis=redis,
        )
        # Use Team API only (teamapi.coros.com) — no Mobile API login.
        # Calling /coros/user/login invalidates the phone's active session;
        # sleep stages are unavailable via Team API REST but we keep HRV
        # from the Training Hub dashboard and daily metrics below.
        await client.login()

        end_date = datetime.utcnow().date()
        activity_start, health_start, mcp_health_start, sleep_start = (
            await _resolve_sync_start_dates(db, user_id, end_date, days)
        )
        start_str = activity_start.strftime("%Y%m%d")
        end_str = end_date.strftime("%Y%m%d")
        health_start_str = health_start.strftime("%Y%m%d")
        mcp_health_start_str = mcp_health_start.strftime("%Y%m%d")
        sleep_start_str = sleep_start.strftime("%Y%m%d")

        # --- Activities ---
        _emit(on_event, "progress", '{"stage": "activities", "message": "Fetching activities..."}')
        raw_activities, raw_health, raw_fitness, raw_dashboard = await asyncio.gather(
            client.fetch_activities(start_str, end_str),
            client.fetch_daily_metrics(health_start_str, end_str),
            client.fetch_analyse(),
            client.fetch_dashboard(),
        )
        activity_count = await _upsert_activities(db, user_id, raw_activities, client)
        total_upserted += activity_count
        _emit(on_event, "progress", f'{{"stage": "activities_done", "count": {activity_count}}}')

        # --- Daily Health & Fitness (Team API only) ---
        _emit(on_event, "progress", '{"stage": "health", "message": "Updating daily health..."}')
        raw_hrv = raw_dashboard.get("summaryInfo", {}).get("sleepHrvData", {}).get("sleepHrvList", [])
        total_upserted += await _upsert_user_heart_rate_profile(
            db, user_id, raw_dashboard
        )

        # --- Steps and active calories via COROS MCP (no Mobile API) ---
        try:
            from src.mcp.daily_health_client import fetch_daily_health_via_mcp

            raw_mcp_health = await fetch_daily_health_via_mcp(
                mcp_health_start_str, end_str, db
            )
            mcp_health_count = await _upsert_mcp_daily_health(db, user_id, raw_mcp_health)
            total_upserted += mcp_health_count
        except RuntimeError as exc:
            logger.info("coros_mcp_daily_health: skipped — %s", exc)
        except Exception as exc:
            logger.warning("coros_mcp_daily_health: unexpected error — %s", exc)

        health_count = await _upsert_daily_health(db, user_id, raw_health, raw_hrv)
        total_upserted += health_count

        recovery_count = await _upsert_coros_recovery(db, user_id, raw_dashboard)
        total_upserted += recovery_count

        personal_record_count = await _upsert_coros_personal_records(
            db, user_id, raw_dashboard
        )
        total_upserted += personal_record_count
        total_upserted += await _upsert_coros_running_fitness(db, user_id, raw_dashboard)

        await _upsert_coros_training_distributions(
            db, user_id, raw_fitness, raw_activities, client
        )

        fitness_count = await _upsert_fitness(db, user_id, raw_fitness.get("dayList", []))
        total_upserted += fitness_count

        _emit(
            on_event,
            "progress",
            f'{{"stage": "health_done", "count": {health_count}}}',
        )

        # --- Sleep stages via COROS MCP (no Mobile API) ---
        _emit(on_event, "progress", '{"stage": "sleep", "message": "Fetching sleep stages..."}')
        sleep_count = 0
        try:
            from src.mcp.sleep_client import fetch_sleep_via_mcp
            raw_sleep = await fetch_sleep_via_mcp(sleep_start_str, end_str, db)
            sleep_count = await _upsert_sleep(db, user_id, raw_sleep)
            total_upserted += sleep_count
            _emit(on_event, "progress", f'{{"stage": "sleep_done", "count": {sleep_count}}}')
        except RuntimeError as exc:
            # MCP not connected yet — normal on first run before OAuth
            logger.info("coros_mcp_sleep: skipped — %s", exc)
            _emit(on_event, "progress", '{"stage": "sleep_skipped", "reason": "MCP not connected"}')
        except Exception as exc:
            logger.warning("coros_mcp_sleep: unexpected error — %s", exc)
            _emit(on_event, "progress", f'{{"stage": "sleep_error", "reason": "{exc}"}}' )

        sync_event.status = "completed"
        sync_event.records_upserted = total_upserted
        sync_event.completed_at = datetime.utcnow()
        _emit(
            on_event,
            "complete",
            f'{{"message": "Sync complete", "total_upserted": {total_upserted}}}',
        )

    except Exception as exc:
        logger.error("sync_failed: %s", str(exc))
        sync_event.status = "failed"
        sync_event.error_message = str(exc)
        sync_event.completed_at = datetime.utcnow()
        _emit(on_event, "error", f'{{"message": "Sync failed: {exc}"}}')

    await db.commit()
    return sync_event


def _emit(callback: EventCallback | None, event_type: str, data: str) -> None:
    if callback is not None:
        callback(event_type, data)


async def _upsert_user_heart_rate_profile(
    db: AsyncSession,
    user_id: str,
    dashboard_data: dict,
) -> int:
    summary = dashboard_data.get("summaryInfo")
    if not isinstance(summary, dict):
        return 0

    max_hr = _number(summary.get("fitnessMaxHr"))
    resting_hr = _number(summary.get("rhr"))
    max_hr_bpm = round(max_hr) if max_hr is not None and max_hr <= 250 else None
    resting_hr_bpm = (
        round(resting_hr) if resting_hr is not None and resting_hr <= 250 else None
    )
    if max_hr_bpm is None and resting_hr_bpm is None:
        return 0

    user = await db.get(User, user_id)
    if user is None:
        return 0

    changed = False
    if max_hr_bpm is not None and user.max_hr_bpm != max_hr_bpm:
        user.max_hr_bpm = max_hr_bpm
        changed = True
    if resting_hr_bpm is not None and user.resting_hr_bpm != resting_hr_bpm:
        user.resting_hr_bpm = resting_hr_bpm
        changed = True
    return int(changed)


async def _resolve_sync_start_dates(
    db: AsyncSession,
    user_id: str,
    end_date: date_type,
    requested_activity_days: int | None,
) -> tuple[date_type, date_type, date_type, date_type]:
    latest_activity = await db.scalar(
        select(func.max(Activity.start_time)).where(Activity.user_id == user_id)
    )
    latest_health = await db.scalar(
        select(func.max(DailyHealth.date)).where(DailyHealth.user_id == user_id)
    )
    latest_mcp_health = await db.scalar(
        select(func.max(DailyHealth.date)).where(
            DailyHealth.user_id == user_id,
            or_(
                DailyHealth.steps.is_not(None),
                DailyHealth.active_calories_kcal.is_not(None),
            ),
        )
    )
    latest_sleep = await db.scalar(
        select(func.max(SleepSession.sleep_start)).where(SleepSession.user_id == user_id)
    )

    if requested_activity_days is not None:
        activity_start = end_date - timedelta(days=requested_activity_days)
    elif latest_activity is not None:
        activity_start = min(latest_activity.date(), end_date) - timedelta(
            days=_ACTIVITY_INCREMENTAL_DAYS
        )
    else:
        activity_start = end_date - timedelta(days=_ACTIVITY_BOOTSTRAP_DAYS)

    health_start = (
        min(latest_health, end_date) - timedelta(days=_HEALTH_INCREMENTAL_DAYS)
        if latest_health is not None
        else end_date - timedelta(days=_HEALTH_BOOTSTRAP_DAYS)
    )
    mcp_health_start = (
        min(latest_mcp_health, end_date) - timedelta(days=_HEALTH_INCREMENTAL_DAYS)
        if latest_mcp_health is not None
        else end_date - timedelta(days=_HEALTH_BOOTSTRAP_DAYS)
    )
    sleep_start = (
        min(latest_sleep.date(), end_date) - timedelta(days=_HEALTH_INCREMENTAL_DAYS)
        if latest_sleep is not None
        else end_date - timedelta(days=_HEALTH_BOOTSTRAP_DAYS)
    )
    return activity_start, health_start, mcp_health_start, sleep_start


def _parse_timestamp(ts) -> datetime | None:
    if not ts:
        return None
    try:
        # Check if ms
        ts_val = float(ts)
        if ts_val > 2e11:
            ts_val = ts_val / 1000.0
        return datetime.fromtimestamp(ts_val)
    except Exception:
        return None


def _parse_date(d: str) -> date_type | None:
    if not d:
        return None
    try:
        return datetime.strptime(str(d), "%Y%m%d").date()
    except Exception:
        try:
            return datetime.strptime(str(d)[:10], "%Y-%m-%d").date()
        except Exception:
            return None


async def _upsert_activities(
    db: AsyncSession, user_id: str, items: list[dict], client: CorosApiClient
) -> int:
    count = 0
    from sqlalchemy import func
    from src.parsers.fit_parser import parse_fit_file
    import os

    start_times = [
        start_time
        for item in items
        if (start_time := _parse_timestamp(item.get("startTime"))) is not None
    ]
    existing_by_start: dict[datetime, Activity] = {}
    if start_times:
        existing_result = await db.execute(
            select(Activity).where(
                Activity.user_id == user_id,
                Activity.start_time.in_(start_times),
            )
        )
        existing_by_start = {
            activity.start_time: activity for activity in existing_result.scalars().all()
        }

    for item in items:
        start_dt = _parse_timestamp(item.get("startTime"))
        if not start_dt:
            continue

        raw_sport = item.get("sportType", 0)

        # COROS sport type integer → our enum.
        # Modern codes (v2 API, 3-digit): confirmed via community reverse-engineering.
        # Legacy codes (v1 API / FIT-era, 1-2 digit): present on older syncs.
        if raw_sport in (100, 103):
            # 100 = Outdoor Road Run, 103 = Track Run
            sport_enum = SportType.RUN
        elif raw_sport in (101, 9):
            # 101 = Indoor Run / Treadmill, 9 = Indoor Run (legacy)
            sport_enum = SportType.RUN
        elif raw_sport in (102, 8):
            # 102 = Trail Run (modern), 8 = Trail Running (legacy)
            sport_enum = SportType.TRAIL_RUN
        elif raw_sport in (200, 201, 203, 204, 3, 10):
            # 200 = Road Bike, 201 = Indoor Bike, 203 = Gravel, 204 = MTB
            # 3 = Cycling (legacy), 10 = Indoor Cycling (legacy)
            sport_enum = SportType.RIDE
        elif raw_sport in (300, 301, 4):
            # 300 = Pool Swim, 301 = Open Water, 4 = Swimming (legacy)
            sport_enum = SportType.SWIM
        elif raw_sport in (900, 5, 2):
            # 900 = Walk (modern), 5 = Walk/Hike (legacy), 2 = Road Run (legacy — use walk as safe default)
            sport_enum = SportType.WALK
        elif raw_sport in (104, 13):
            # 104 = Hike, 13 = Outdoor Cardio/Hike (legacy)
            sport_enum = SportType.HIKE
        elif raw_sport in (402, 11):
            # 402 = Strength Training (modern), 11 = Strength (legacy)
            sport_enum = SportType.STRENGTH
        elif raw_sport in (10000, 10001, 12):
            # 10000/10001 = Triathlon / Multisport, 12 = Cardio/Gym (legacy)
            sport_enum = SportType.MULTISPORT
        else:
            sport_enum = SportType.OTHER

        activity_name = str(item.get("name") or item.get("remark") or "")
        if "strength" in activity_name.casefold():
            sport_enum = SportType.STRENGTH

        activity = existing_by_start.get(start_dt)

        source_hash = hashlib.sha256(f"api:{start_dt.isoformat()}:{raw_sport}".encode()).hexdigest()

        # Calories logic - API often returns small calories, divide by 1000 if too large
        cal = item.get("calorie", 0)
        if cal > 10000:
            cal = cal / 1000.0

        dist = item.get("distance") or item.get("totalDistance", 0)
        elapsed = item.get("totalTime", 0)
        speed_mps = (dist / elapsed) if elapsed and elapsed > 0 else None
        label_id_val = item.get("labelId")
        if activity is None:
            activity = Activity(
                user_id=user_id,
                sport=sport_enum,
                subsport=str(raw_sport),
                title=activity_name or "Activity",
                start_time=start_dt,
                distance_m=dist,
                elapsed_time_s=elapsed,
                avg_hr_bpm=item.get("avgHr"),
                avg_speed_mps=speed_mps,
                avg_power_w=item.get("avgPower"),
                calories_kcal=cal,
                training_load_vendor=item.get("trainingLoad"),
                source_type=SourceType.API_OFFICIAL,
                source_hash=source_hash,
                label_id=str(label_id_val) if label_id_val else None,
            )
            db.add(activity)
            existing_by_start[start_dt] = activity
            count += 1
        else:
            if activity.source_type == SourceType.API_OFFICIAL:
                activity.sport = sport_enum
                activity.subsport = str(raw_sport)
                activity.training_load_vendor = (
                    item.get("trainingLoad") or activity.training_load_vendor
                )
                activity.calories_kcal = cal or activity.calories_kcal
                activity.avg_power_w = item.get("avgPower") or activity.avg_power_w
                activity.avg_speed_mps = speed_mps or activity.avg_speed_mps
                if label_id_val and not activity.label_id:
                    activity.label_id = str(label_id_val)
                count += 1

        if sport_enum == SportType.STRENGTH and activity.strength_detail is None:
            label_id = item.get("labelId")
            if isinstance(label_id, str) and label_id:
                try:
                    detail = await client.fetch_activity_detail(label_id, int(raw_sport))
                    activity.strength_detail = _strength_detail_payload(detail)
                    await asyncio.sleep(0.4)
                except CorosApiClientError as exc:
                    logger.warning(
                        "coros_sync: failed to fetch strength detail for %s: %s",
                        activity.id,
                        exc,
                    )
        elif raw_sport == 1200:
            label_id = item.get("labelId")
            if isinstance(label_id, str) and label_id:
                try:
                    if activity.id is None:
                        await db.flush()
                    detail = await client.fetch_activity_detail(label_id, int(raw_sport))
                    detail_laps = _detail_activity_laps(activity, detail)
                    detail_records = _detail_activity_records(activity, detail)
                    if detail_laps:
                        await db.execute(delete(ActivityLap).where(ActivityLap.activity_id == activity.id))
                        db.add_all(detail_laps)
                    if detail_records:
                        await db.execute(
                            delete(ActivityRecord).where(ActivityRecord.activity_id == activity.id)
                        )
                        db.add_all(detail_records)
                    await asyncio.sleep(0.4)
                except CorosApiClientError as exc:
                    logger.warning(
                        "coros_sync: failed to fetch Hybrid Fitness detail for %s: %s",
                        activity.id,
                        exc,
                    )

    await db.flush()
    return count


def _history_upto(
    series: dict[date_type, float], day: date_type, window: int = 30
) -> list[float]:
    """Values on or before `day`, chronologically ordered with the most recent last."""
    return [value for date_key, value in sorted(series.items()) if date_key <= day][-window:]


async def _upsert_daily_health(
    db: AsyncSession, user_id: str, daily: list[dict], hrv: list[dict]
) -> int:
    count = 0

    # Merge hrv by date
    hrv_by_date: dict[date_type, float] = {}
    for h in [*hrv, *daily]:
        dt = _parse_date(h.get("happenDay"))
        hrv_value = _number(h.get("avgSleepHrv"))
        if dt and hrv_value is not None:
            hrv_by_date[dt] = hrv_value

    # Build RHR baseline from the incoming daily data batch
    rhr_by_date: dict[date_type, float] = {}
    for entry in daily:
        entry_date = _parse_date(entry.get("happenDay"))
        entry_rhr = _number(entry.get("rhr"))
        if entry_date and entry_rhr:
            rhr_by_date[entry_date] = entry_rhr
    valid_rhrs = list(rhr_by_date.values())
    rhr_7d_sma = int(sum(valid_rhrs) / len(valid_rhrs)) if valid_rhrs else None

    for item in daily:
        dt = _parse_date(item.get("happenDay"))
        if not dt:
            continue

        existing = await db.execute(
            select(DailyHealth).where(
                DailyHealth.user_id == user_id,
                DailyHealth.date == dt,
            )
        )
        health = existing.scalar_one_or_none()

        hrv_val = _number(item.get("avgSleepHrv")) or hrv_by_date.get(dt)
        hrv_window = [
            value
            for day, value in hrv_by_date.items()
            if dt - timedelta(days=6) <= day <= dt
        ]
        hrv_7d_sma = round(sum(hrv_window) / len(hrv_window), 1) if hrv_window else None

        # Calculate a true readiness score based on HRV, RHR, and Fatigue
        rhr_val = item.get("rhr")
        tired_rate = item.get("tiredRate", 0)

        # Individualized baselines drive the z-scores and anomaly flags the AI coach reads.
        hrv_baseline = compute_rolling_baseline(_history_upto(hrv_by_date, dt))
        rhr_baseline = compute_rolling_baseline(_history_upto(rhr_by_date, dt))
        hrv_zscore = (
            compute_zscore(hrv_val, hrv_baseline)
            if hrv_val is not None and hrv_baseline is not None
            else None
        )
        anomalies = check_daily_health_anomalies(
            hrv=hrv_val,
            rhr=rhr_val,
            sleep_hours=None,
            hrv_baseline_mean=hrv_baseline.mean if hrv_baseline else None,
            hrv_baseline_std=hrv_baseline.std_dev if hrv_baseline else None,
            rhr_baseline_mean=rhr_baseline.mean if rhr_baseline else None,
            rhr_baseline_std=rhr_baseline.std_dev if rhr_baseline else None,
            sleep_baseline_mean=None,
            sleep_baseline_std=None,
        )
        anomaly_flags = {
            result.metric_name: {
                "severity": result.severity,
                "direction": result.direction,
                "zscore": result.zscore,
                "message": result.message,
            }
            for result in anomalies
        } or None

        readiness_score = 100.0

        # 1. HRV component (+ points if higher than baseline, - if lower)
        if hrv_val and hrv_7d_sma and hrv_7d_sma > 0:
            hrv_ratio = hrv_val / hrv_7d_sma
            readiness_score += (hrv_ratio - 1.0) * 100.0
            
        # 2. RHR component (- points if higher than baseline, + if lower)
        if rhr_val and rhr_7d_sma and rhr_7d_sma > 0:
            rhr_ratio = rhr_val / rhr_7d_sma
            readiness_score -= (rhr_ratio - 1.0) * 100.0
            
        # 3. Fatigue component (penalize if tired_rate > 40)
        if tired_rate > 40:
            readiness_score -= (tired_rate - 40)
            
        # Clamp to 0-100
        readiness = int(max(0, min(100, readiness_score)))
        # Compute Strain from today's activities
        day_start = datetime.combine(dt, datetime.min.time())
        day_end = datetime.combine(dt, datetime.max.time())
        activities_res = await db.execute(
            select(Activity).where(
                Activity.user_id == user_id,
                Activity.start_time >= day_start,
                Activity.start_time <= day_end
            )
        )
        day_activities = activities_res.scalars().all()
        daily_load = sum(a.training_load_vendor or 0 for a in day_activities)
        strain = compute_daily_strain(
            daily_load,
            steps=health.steps if health else None,
            active_calories=health.active_calories_kcal if health else None,
        )

        if health is None:
            health = DailyHealth(
                user_id=user_id,
                date=dt,
                resting_hr_bpm=item.get("rhr"),
                overnight_hrv_avg_ms=hrv_val,
                hrv_7d_sma=hrv_7d_sma,
                hrv_zscore=hrv_zscore,
                readiness_score_app=readiness,
                strain_score_app=strain,
                anomaly_flags=anomaly_flags,
                source_type=SourceType.API_OFFICIAL,
            )
            db.add(health)
        else:
            health.resting_hr_bpm = item.get("rhr") or health.resting_hr_bpm
            health.overnight_hrv_avg_ms = hrv_val or health.overnight_hrv_avg_ms
            health.hrv_7d_sma = hrv_7d_sma or health.hrv_7d_sma
            health.hrv_zscore = hrv_zscore
            health.readiness_score_app = readiness or health.readiness_score_app
            health.strain_score_app = strain
            health.anomaly_flags = anomaly_flags
        count += 1

        # Sleep sessions are now handled in _upsert_sleep

    await db.flush()
    return count


async def _upsert_mcp_daily_health(
    db: AsyncSession, user_id: str, daily: list[dict]
) -> int:
    """Update or create daily health fields from MCP daily health records."""
    count = 0
    for item in daily:
        dt = _parse_date(item.get("happenDay", ""))
        if dt is None:
            continue
        health = await db.scalar(
            select(DailyHealth).where(DailyHealth.user_id == user_id, DailyHealth.date == dt)
        )
        steps = item.get("steps")
        calories = item.get("calories")

        if health is None:
            if steps is not None or calories is not None:
                health = DailyHealth(
                    user_id=user_id,
                    date=dt,
                    steps=steps,
                    active_calories_kcal=calories,
                    source_type=SourceType.API_OFFICIAL,
                )
                db.add(health)
                count += 1
        else:
            if steps is not None:
                health.steps = steps
            if calories is not None:
                health.active_calories_kcal = calories
            if steps is not None or calories is not None:
                count += 1
    await db.flush()
    return count


async def _upsert_coros_recovery(db: AsyncSession, user_id: str, dashboard_data: dict) -> int:
    summary = dashboard_data.get("summaryInfo", {})
    recovery = summary.get("recoveryPct")
    if recovery is None:
        return 0

    dt = datetime.utcnow().date()
    health = await db.scalar(
        select(DailyHealth).where(DailyHealth.user_id == user_id, DailyHealth.date == dt)
    )
    if health is None:
        health = DailyHealth(
            user_id=user_id,
            date=dt,
            recovery_vendor=recovery,
            source_type=SourceType.API_OFFICIAL,
        )
        db.add(health)
    else:
        health.recovery_vendor = recovery
    await db.flush()
    return 1


async def _upsert_fitness(db: AsyncSession, user_id: str, analyse_data: list[dict]) -> int:
    count = 0
    for item in analyse_data:
        dt = _parse_date(str(item.get("happenDay", "")))
        if not dt:
            continue

        vo2max = item.get("vo2max")
        stamina = item.get("staminaLevel")
        if vo2max is None and stamina is None:
            continue

        existing = await db.execute(
            select(FitnessEstimate).where(
                FitnessEstimate.user_id == user_id,
                FitnessEstimate.date == dt,
            )
        )
        fitness = existing.scalar_one_or_none()

        if fitness is None:
            fitness = FitnessEstimate(
                user_id=user_id,
                date=dt,
                vo2max_vendor=vo2max,
                lactate_threshold_hr=item.get("lthr"),
                lactate_threshold_pace_s_per_km=item.get("ltsp"),
                running_fitness_score=stamina,
                source_type=SourceType.API_OFFICIAL,
            )
            db.add(fitness)
            count += 1
        else:
            fitness.vo2max_vendor = vo2max or fitness.vo2max_vendor
            fitness.lactate_threshold_hr = item.get("lthr") or fitness.lactate_threshold_hr
            fitness.lactate_threshold_pace_s_per_km = item.get("ltsp") or fitness.lactate_threshold_pace_s_per_km
            fitness.running_fitness_score = stamina or fitness.running_fitness_score

    await db.flush()
    return count


async def _upsert_sleep(db: AsyncSession, user_id: str, daily_sleep: list[dict]) -> int:
    count = 0
    for item in daily_sleep:
        sd = item.get("sleepData", {})
        if not sd:
            continue

        # happenDay is format YYYYMMDD e.g. 20260525
        happen_day = str(item.get("happenDay", ""))
        if len(happen_day) != 8:
            continue

        is_nap = bool(item.get("isNap"))
        start_dt = datetime(int(happen_day[:4]), int(happen_day[4:6]), int(happen_day[6:8]))
        if is_nap and isinstance(item.get("sleepStart"), str):
            start_dt = datetime.fromisoformat(item["sleepStart"])

        existing = await db.execute(
            select(SleepSession).where(
                SleepSession.user_id == user_id,
                SleepSession.sleep_start == start_dt,
            )
        )
        session = existing.scalar_one_or_none()

        total_mins = sd.get("totalSleepTime", 0)
        end_dt = start_dt + timedelta(minutes=total_mins)
        if is_nap and isinstance(item.get("sleepEnd"), str):
            end_dt = datetime.fromisoformat(item["sleepEnd"])
        duration_s = total_mins * 60

        source_hash = hashlib.sha256(f"api:sleep:{start_dt.isoformat()}:{is_nap}".encode()).hexdigest()

        if session is None:
            session = SleepSession(
                user_id=user_id,
                sleep_start=start_dt,
                sleep_end=end_dt,
                duration_s=duration_s,
                is_nap=is_nap,
                stage_deep_s=sd.get("deepTime", 0) * 60,
                stage_light_s=sd.get("lightTime", 0) * 60,
                stage_rem_s=sd.get("eyeTime", 0) * 60,
                stage_awake_s=sd.get("wakeTime", 0) * 60,
                sleep_quality_vendor=item.get("performance"),
                source_type=SourceType.API_OFFICIAL,
                source_hash=source_hash,
            )
            db.add(session)
            count += 1
        else:
            session.sleep_end = end_dt
            session.duration_s = duration_s
            session.is_nap = is_nap
            
            new_deep = sd.get("deepTime", 0) * 60
            new_light = sd.get("lightTime", 0) * 60
            new_rem = sd.get("eyeTime", 0) * 60
            new_awake = sd.get("wakeTime", 0) * 60
            
            if new_deep > 0 or new_light > 0 or new_rem > 0 or new_awake > 0:
                session.stage_deep_s = new_deep
                session.stage_light_s = new_light
                session.stage_rem_s = new_rem
                session.stage_awake_s = new_awake
                
            if item.get("performance") is not None:
                session.sleep_quality_vendor = item.get("performance")
            count += 1

    await db.flush()
    return count
