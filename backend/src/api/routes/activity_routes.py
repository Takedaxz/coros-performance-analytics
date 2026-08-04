"""Activity routes: list, detail, and time-series data for activities."""

from __future__ import annotations

from bisect import bisect_left
from collections.abc import Sequence
from datetime import datetime, timedelta
from typing import TYPE_CHECKING, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, extract, func, or_, select

from src.activity_laps import (
    distance_splits as _distance_splits,
    hyrox_lap_detail as _hyrox_lap_detail,
    lap_type as _lap_type,
    swim_lap_name as _swim_lap_name,
)
from src.db.engine import get_db_session
from src.db.models import Activity, ActivityLap, ActivityRecord, FitnessEstimate

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession
    from sqlalchemy.sql.elements import ColumnElement

router = APIRouter()

DatePeriod = Literal["day", "week", "month", "year"]
ActivitySort = Literal[
    "newest",
    "oldest",
    "duration_desc",
    "duration_asc",
    "load_desc",
    "load_asc",
    "distance_desc",
    "distance_asc",
]


def _period_bounds(
    period: DatePeriod | None,
    value: str | None,
) -> tuple[datetime, datetime] | None:
    if period is None:
        if value:
            raise HTTPException(status_code=422, detail="period is required with period_value")
        return None
    if not value:
        raise HTTPException(status_code=422, detail="period_value is required with period")

    try:
        if period == "day":
            start = datetime.strptime(value, "%Y-%m-%d")
            return start, start + timedelta(days=1)
        if period == "week":
            start = datetime.strptime(f"{value}-1", "%G-W%V-%u")
            return start, start + timedelta(days=7)
        if period == "month":
            start = datetime.strptime(value, "%Y-%m")
            end = (
                start.replace(year=start.year + 1, month=1)
                if start.month == 12
                else start.replace(month=start.month + 1)
            )
            return start, end
        start = datetime.strptime(value, "%Y")
        return start, start.replace(year=start.year + 1)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"Invalid {period} value: {value}") from exc


def _validate_range(
    label: str,
    minimum: float | None,
    maximum: float | None,
) -> None:
    if minimum is not None and maximum is not None and minimum > maximum:
        raise HTTPException(status_code=422, detail=f"{label} minimum cannot exceed maximum")


def _lap_start_elapsed(lap_start: datetime, first_lap_start: datetime) -> float:
    return max(0.0, (lap_start - first_lap_start).total_seconds())


def _interval_hr_recovery(
    laps: list[ActivityLap],
    records: list[ActivityRecord],
) -> dict[int, int]:
    samples = sorted(
        (
            (record.elapsed_s, record.heart_rate_bpm)
            for record in records
            if record.elapsed_s is not None
            if record.heart_rate_bpm is not None
            and 30 <= record.heart_rate_bpm <= 250
        ),
        key=lambda sample: sample[0],
    )
    elapsed_values = [elapsed_s for elapsed_s, _ in samples]

    def heart_rate_at(target: float) -> int | None:
        index = bisect_left(elapsed_values, target)
        candidates = samples[max(0, index - 1) : index + 1]
        if not candidates:
            return None
        elapsed_s, heart_rate = min(
            candidates,
            key=lambda sample: abs(sample[0] - target),
        )
        return heart_rate if abs(elapsed_s - target) <= 2 else None

    recovery_by_lap: dict[int, int] = {}
    first_lap_start = min((lap.start_time for lap in laps), default=None)
    if first_lap_start is None:
        return recovery_by_lap
    for lap in laps:
        if _lap_type(lap.lap_trigger) != "rest":
            continue
        start_elapsed_s = _lap_start_elapsed(lap.start_time, first_lap_start)
        start_hr = heart_rate_at(start_elapsed_s)
        end_hr = heart_rate_at(start_elapsed_s + lap.elapsed_s)
        if start_hr is not None and end_hr is not None:
            recovery_by_lap[lap.lap_index] = start_hr - end_hr
    return recovery_by_lap


@router.get("/")
async def list_activities(
    sport: str | None = None,
    period: DatePeriod | None = None,
    period_value: str | None = None,
    weekday: int | None = Query(default=None, ge=1, le=7),
    min_duration_s: float | None = Query(default=None, ge=0),
    max_duration_s: float | None = Query(default=None, ge=0),
    min_training_load: float | None = Query(default=None, ge=0),
    max_training_load: float | None = Query(default=None, ge=0),
    min_distance_m: float | None = Query(default=None, ge=0),
    max_distance_m: float | None = Query(default=None, ge=0),
    sort: ActivitySort = "newest",
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """List activities with filters, sorting, and pagination."""
    _validate_range("Duration", min_duration_s, max_duration_s)
    _validate_range("Training load", min_training_load, max_training_load)
    _validate_range("Distance", min_distance_m, max_distance_m)

    conditions: list[ColumnElement[bool]] = []
    if sport:
        if sport == "treadmill":
            conditions.append(
                or_(
                    Activity.subsport == "101",
                    Activity.title.ilike("%treadmill%"),
                    Activity.title.ilike("%indoor run%"),
                )
            )
        else:
            conditions.append(Activity.sport == sport)

    bounds = _period_bounds(period, period_value)
    if bounds:
        conditions.extend((Activity.start_time >= bounds[0], Activity.start_time < bounds[1]))
    if weekday is not None:
        conditions.append(extract("isodow", Activity.start_time) == weekday)
    if min_duration_s is not None:
        conditions.append(Activity.elapsed_time_s >= min_duration_s)
    if max_duration_s is not None:
        conditions.append(Activity.elapsed_time_s <= max_duration_s)
    if min_training_load is not None:
        conditions.append(Activity.training_load_vendor >= min_training_load)
    if max_training_load is not None:
        conditions.append(Activity.training_load_vendor <= max_training_load)
    if min_distance_m is not None:
        conditions.append(Activity.distance_m >= min_distance_m)
    if max_distance_m is not None:
        conditions.append(Activity.distance_m <= max_distance_m)

    if sort == "oldest":
        order = (Activity.start_time.asc(),)
    elif sort == "duration_desc":
        order = (Activity.elapsed_time_s.desc().nulls_last(), Activity.start_time.desc())
    elif sort == "duration_asc":
        order = (Activity.elapsed_time_s.asc().nulls_last(), Activity.start_time.desc())
    elif sort == "load_desc":
        order = (Activity.training_load_vendor.desc().nulls_last(), Activity.start_time.desc())
    elif sort == "load_asc":
        order = (Activity.training_load_vendor.asc().nulls_last(), Activity.start_time.desc())
    elif sort == "distance_desc":
        order = (Activity.distance_m.desc().nulls_last(), Activity.start_time.desc())
    elif sort == "distance_asc":
        order = (Activity.distance_m.asc().nulls_last(), Activity.start_time.desc())
    else:
        order = (Activity.start_time.desc(),)

    query = select(Activity).where(*conditions).order_by(*order)
    count_query = select(func.count()).select_from(Activity)
    if conditions:
        count_query = count_query.where(*conditions)

    query = query.limit(limit).offset(offset)

    result = await db.execute(query)
    activities = result.scalars().all()

    count_result = await db.execute(count_query)
    total_count = count_result.scalar() or 0

    return {
        "total_count": total_count,
        "activities": [
            {
                "id": a.id,
                "sport": a.sport,
                "subsport": a.subsport,
                "title": a.title,
                "start_time": a.start_time.isoformat(),
                "elapsed_time_s": a.elapsed_time_s,
                "distance_m": a.distance_m,
                "elevation_gain_m": a.elevation_gain_m,
                "avg_hr_bpm": a.avg_hr_bpm,
                "avg_speed_mps": a.avg_speed_mps,
                "avg_power_w": a.avg_power_w,
                "calories_kcal": a.calories_kcal,
                "training_load_vendor": a.training_load_vendor,
                "source_type": a.source_type,
            }
            for a in activities
        ],
        "limit": limit,
        "offset": offset,
    }


import logging
import os
from io import BytesIO
from zipfile import ZipFile, is_zipfile
from src.config import get_settings
from src.db.credential_store import load_coros_credentials
from src.sync.api_client import CorosApiClient, CorosApiClientError
from src.sync.sync_manager import _detail_activity_laps
from src.metrics.derived import EfficiencyMetrics, compute_efficiency
from src.parsers.fit_parser import parse_fit_file

logger = logging.getLogger(__name__)
RUNNING_DYNAMICS_PARSER_VERSION = "0.3.1"
RUNNING_DYNAMICS_READY_VERSIONS = {
    "0.2.0",
    "0.3.0",
    RUNNING_DYNAMICS_PARSER_VERSION,
}


def _efficiency_from_records(records: Sequence[ActivityRecord]) -> EfficiencyMetrics:
    """Compute efficiency from stored records.

    Speed and HR must stay index-aligned because compute_efficiency zips them
    positionally, so a sample is dropped unless both channels are present.
    """
    paired_samples = [
        (record.speed_mps, record.heart_rate_bpm)
        for record in records
        if record.speed_mps is not None and record.heart_rate_bpm is not None
    ]
    return compute_efficiency(
        [speed for speed, _ in paired_samples],
        [hr for _, hr in paired_samples],
    )


async def _backfill_efficiency(db: AsyncSession, activity: Activity) -> None:
    """Derive efficiency for activities whose records were stored before it was computed.

    Runs once per activity: hr_quality_flag is set even when the data is too thin,
    so a second view does not re-query the records.
    """
    if activity.efficiency_factor_app is not None or activity.hr_quality_flag is not None:
        return
    record_result = await db.execute(
        select(ActivityRecord)
        .where(ActivityRecord.activity_id == activity.id)
        .order_by(ActivityRecord.timestamp)
    )
    records = list(record_result.scalars().all())
    if not records:
        return
    efficiency = _efficiency_from_records(records)
    activity.efficiency_factor_app = efficiency.efficiency_factor
    activity.cardiac_drift_pct_app = efficiency.cardiac_drift_pct
    activity.hr_quality_flag = efficiency.hr_quality_flag
    await db.commit()


async def ensure_activity_fit_downloaded(db: AsyncSession, activity: Activity) -> None:
    """Lazy download & parse FIT file on demand when user views an activity."""
    records_count = await db.scalar(
        select(func.count(ActivityRecord.id)).where(ActivityRecord.activity_id == activity.id)
    )
    lap_count = await db.scalar(
        select(func.count(ActivityLap.id)).where(ActivityLap.activity_id == activity.id)
    )
    unlabeled_lap_count = await db.scalar(
        select(func.count(ActivityLap.id)).where(
            ActivityLap.activity_id == activity.id,
            or_(ActivityLap.lap_trigger.is_(None), ActivityLap.lap_trigger == "None"),
        )
    )
    rebuild_multisport = False
    if activity.sport == "multisport" and records_count:
        unique_laps = await db.scalar(
            select(func.count(func.distinct(ActivityLap.lap_index))).where(ActivityLap.activity_id == activity.id)
        )
        unique_records = await db.scalar(
            select(func.count(func.distinct(ActivityRecord.timestamp))).where(ActivityRecord.activity_id == activity.id)
        )
        rebuild_multisport = lap_count != unique_laps or records_count != unique_records
    needs_step_labels = (
        activity.sport in {"run", "trail_run"}
        and bool(lap_count)
        and bool(unlabeled_lap_count)
    )
    needs_phase_refresh = (
        activity.sport in {"run", "trail_run"}
        and bool(lap_count)
        and activity.parser_version != RUNNING_DYNAMICS_PARSER_VERSION
    )
    needs_running_dynamics = (
        activity.sport in {"run", "trail_run"}
        and bool(records_count)
        and activity.parser_version not in RUNNING_DYNAMICS_READY_VERSIONS
    )
    has_complete_fit_data = (
        records_count > 0 and not rebuild_multisport and not needs_running_dynamics
    )
    if (
        has_complete_fit_data
        and not needs_step_labels
        and not needs_phase_refresh
    ) or not activity.label_id:
        await _backfill_efficiency(db, activity)
        return

    settings = get_settings()
    creds = await load_coros_credentials(db, settings.app_secret_key)
    _email = (creds[0] if creds else None) or settings.coros_email
    _password = (creds[1] if creds else None) or settings.coros_password
    if not _email or not _password:
        return

    try:
        logger.info(f"on_demand_fit: fetching FIT file for activity {activity.id} (label_id: {activity.label_id})")
        client = CorosApiClient(email=_email, password=_password)
        await client.login()

        sport_type = int(activity.subsport or 0)
        detail_laps: list[ActivityLap] = []
        if activity.sport in {"run", "trail_run", "swim", "ride"}:
            try:
                detail = await client.fetch_activity_detail(activity.label_id, sport_type)
                detail_laps = _detail_activity_laps(activity, detail)
            except CorosApiClientError as exc:
                logger.warning(
                    "coros_lap_labels_fetch_failed: activity=%s error=%s",
                    activity.id,
                    exc,
                )

        if (
            records_count > 0
            and (needs_step_labels or needs_phase_refresh)
            and not needs_running_dynamics
        ):
            if detail_laps:
                await db.execute(delete(ActivityLap).where(ActivityLap.activity_id == activity.id))
                db.add_all(detail_laps)
                activity.parser_version = RUNNING_DYNAMICS_PARSER_VERSION
                await db.commit()
            return

        fit_url = await client.fetch_activity_fit_url(activity.label_id, sport_type)
        fit_bytes = await client.download_file(fit_url)

        os.makedirs(settings.raw_file_store_path, exist_ok=True)
        fit_filename = f"{activity.id}.zip" if is_zipfile(BytesIO(fit_bytes)) else f"{activity.id}.fit"
        fit_filepath = os.path.join(settings.raw_file_store_path, fit_filename)
        with open(fit_filepath, "wb") as f:
            f.write(fit_bytes)

        activity.source_filename = fit_filename

        fit_files = [fit_bytes]
        if is_zipfile(BytesIO(fit_bytes)):
            with ZipFile(BytesIO(fit_bytes)) as archive:
                fit_files = [
                    archive.read(name)
                    for name in archive.namelist()
                    if name.lower().endswith(".fit")
                ]
        parsed_segments = [parse_fit_file(data) for data in fit_files]
        parsed_segments = [segment for segment in parsed_segments if segment.sessions]
        if not parsed_segments:
            raise ValueError("COROS download contains no readable FIT sessions")

        db_laps = []
        fit_records = []
        for segment in parsed_segments:
            segment_sport = segment.sessions[0].sport
            for lap in segment.laps:
                db_laps.append(
                    ActivityLap(
                        activity_id=activity.id,
                        lap_index=len(db_laps) + 1,
                        start_time=lap.start_time.replace(tzinfo=None) if lap.start_time.tzinfo else lap.start_time,
                        elapsed_s=lap.elapsed_s,
                        distance_m=lap.distance_m,
                        avg_hr_bpm=lap.avg_hr_bpm,
                        max_hr_bpm=lap.max_hr_bpm,
                        avg_speed_mps=lap.avg_speed_mps,
                        avg_power_w=lap.avg_power_w,
                        calories_kcal=lap.calories_kcal,
                        avg_cadence=lap.avg_cadence,
                        lap_trigger=f"triathlon_{segment_sport}" if len(parsed_segments) > 1 else lap.lap_trigger,
                    )
                )
            fit_records.extend(segment.records)
        if activity.sport == "swim" and len(detail_laps) == len(db_laps):
            for detail_lap, fit_lap in zip(detail_laps, db_laps, strict=True):
                if detail_lap.lap_trigger == "coros_swim":
                    detail_lap.lap_trigger = (
                        "coros_swim:drills"
                        if fit_lap.lap_trigger == "coros_swim:drill"
                        else fit_lap.lap_trigger
                    )
                detail_lap.avg_cadence = detail_lap.avg_cadence or fit_lap.avg_cadence
        if rebuild_multisport or (needs_phase_refresh and detail_laps):
            await db.execute(delete(ActivityLap).where(ActivityLap.activity_id == activity.id))
        if rebuild_multisport or needs_running_dynamics:
            await db.execute(delete(ActivityRecord).where(ActivityRecord.activity_id == activity.id))
        if not lap_count or rebuild_multisport or (needs_phase_refresh and detail_laps):
            db.add_all(detail_laps or db_laps)

        fit_records.sort(key=lambda record: record.timestamp)
        first_ts = fit_records[0].timestamp if fit_records else None
        db_records = [
            ActivityRecord(
                activity_id=activity.id,
                timestamp=r.timestamp.replace(tzinfo=None) if r.timestamp.tzinfo else r.timestamp,
                elapsed_s=(r.timestamp - first_ts).total_seconds() if first_ts else 0.0,
                position_lat=r.position_lat,
                position_long=r.position_long,
                distance_m=r.distance_m,
                altitude_m=r.altitude_m,
                speed_mps=r.speed_mps,
                heart_rate_bpm=r.heart_rate_bpm,
                cadence=(
                    r.cadence * 2
                    if activity.sport in {"run", "trail_run"} and r.cadence is not None
                    else r.cadence
                ),
                power_w=r.power_w,
                ground_time_ms=r.ground_time_ms,
                stride_length_cm=r.stride_length_cm,
                stride_ratio_pct=r.stride_ratio_pct,
                stride_height_cm=r.stride_height_cm,
                temperature_c=r.temperature_c,
            )
            for r in fit_records
        ]
        db.add_all(db_records)

        efficiency = _efficiency_from_records(db_records)
        activity.efficiency_factor_app = efficiency.efficiency_factor
        activity.cardiac_drift_pct_app = efficiency.cardiac_drift_pct
        activity.hr_quality_flag = efficiency.hr_quality_flag

        activity.parser_version = RUNNING_DYNAMICS_PARSER_VERSION
        await db.commit()
        logger.info(f"on_demand_fit: populated {len(db_records)} records and {len(db_laps)} laps for activity {activity.id}")
    except Exception as exc:
        logger.warning(f"on_demand_fit: failed to fetch FIT file for activity {activity.id}: {exc}")


@router.get("/{activity_id}")
async def get_activity(
    activity_id: str,
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Full activity detail including summary, laps, and metadata."""
    result = await db.execute(select(Activity).where(Activity.id == activity_id))
    activity = result.scalar_one_or_none()
    if activity is None:
        raise HTTPException(status_code=404, detail="Activity not found")

    await ensure_activity_fit_downloaded(db, activity)

    fitness = (
        await db.scalar(
            select(FitnessEstimate)
            .where(FitnessEstimate.user_id == activity.user_id)
            .order_by(FitnessEstimate.date.desc())
            .limit(1)
        )
        if activity.sport in {"run", "trail_run"}
        else None
    )

    # Fetch laps
    lap_result = await db.execute(
        select(ActivityLap)
        .where(ActivityLap.activity_id == activity_id)
        .order_by(ActivityLap.lap_index)
    )
    laps = lap_result.scalars().all()
    lap_origin = laps[0].start_time if laps else activity.start_time
    split_distance_m = (
        1_000
        if activity.sport in {"run", "trail_run"}
        else 20
        if activity.sport == "swim"
        else None
    )
    records: list[ActivityRecord] = []
    needs_records = split_distance_m is not None or any(
        _lap_type(lap.lap_trigger) == "rest" for lap in laps
    )
    if laps and needs_records:
        record_result = await db.execute(
            select(ActivityRecord)
            .where(ActivityRecord.activity_id == activity_id)
            .order_by(ActivityRecord.timestamp)
        )
        records = list(record_result.scalars().all())
    recovery_by_lap = _interval_hr_recovery(laps, records)

    lap_payload = []
    for lap in laps:
        lap_name, load_unit = _hyrox_lap_detail(lap.lap_trigger)
        lap_name = lap_name or _swim_lap_name(lap.lap_trigger)
        lap_payload.append(
            {
                "lap_index": lap.lap_index,
                "start_time": lap.start_time.isoformat(),
                "start_elapsed_s": _lap_start_elapsed(lap.start_time, lap_origin),
                "leg": lap.lap_trigger.removeprefix("triathlon_")
                if lap.lap_trigger and lap.lap_trigger.startswith("triathlon_")
                else None,
                "lap_name": lap_name,
                "load_unit": load_unit,
                "elapsed_s": lap.elapsed_s,
                "distance_m": lap.distance_m,
                "avg_hr_bpm": lap.avg_hr_bpm,
                "max_hr_bpm": lap.max_hr_bpm,
                "avg_speed_mps": lap.avg_speed_mps,
                "avg_power_w": lap.avg_power_w,
                "avg_cadence": lap.avg_cadence,
                "lap_type": _lap_type(lap.lap_trigger),
                "hrr_bpm": recovery_by_lap.get(lap.lap_index),
            }
        )

    lap_splits: dict[str, list[dict[str, float | int | None]]] = {}
    if split_distance_m is not None and laps:
        source_laps = [lap for lap in laps if lap.distance_m is not None and lap.distance_m > 0]
        source_lap_distances = [float(lap.distance_m) for lap in source_laps]
        source_lap_start_elapsed = None
        if activity.sport == "swim":
            elapsed_before_lap = 0.0
            source_lap_start_elapsed = []
            for lap in laps:
                if lap.distance_m is not None and lap.distance_m > 0:
                    source_lap_start_elapsed.append(elapsed_before_lap)
                elapsed_before_lap += lap.elapsed_s
        distance_splits = _distance_splits(
            records,
            split_distance_m,
            source_lap_distances,
            source_lap_start_elapsed,
        )
        for split in distance_splits:
            source_lap_index = split.pop("source_lap_index", None)
            if isinstance(source_lap_index, int) and source_lap_index < len(source_laps):
                lap_splits.setdefault(str(source_laps[source_lap_index].lap_index), []).append(split)

    return {
        "id": activity.id,
        "sport": activity.sport,
        "subsport": activity.subsport,
        "title": activity.title,
        "start_time": activity.start_time.isoformat(),
        "end_time": activity.end_time.isoformat() if activity.end_time else None,
        "timezone": activity.timezone,
        "elapsed_time_s": activity.elapsed_time_s,
        "timer_time_s": activity.timer_time_s,
        "moving_time_s": activity.moving_time_s,
        "distance_m": activity.distance_m,
        "elevation_gain_m": activity.elevation_gain_m,
        "elevation_loss_m": activity.elevation_loss_m,
        "calories_kcal": activity.calories_kcal,
        "avg_speed_mps": activity.avg_speed_mps,
        "max_speed_mps": activity.max_speed_mps,
        "avg_hr_bpm": activity.avg_hr_bpm,
        "max_hr_bpm": activity.max_hr_bpm,
        "avg_cadence": activity.avg_cadence,
        "max_cadence": activity.max_cadence,
        "avg_power_w": activity.avg_power_w,
        "max_power_w": activity.max_power_w,
        "normalized_power_w": activity.normalized_power_w,
        "training_load_vendor": activity.training_load_vendor,
        "recovery_vendor": activity.recovery_vendor,
        "vo2max_vendor": activity.vo2max_vendor,
        "efficiency_factor_app": activity.efficiency_factor_app,
        "cardiac_drift_pct_app": activity.cardiac_drift_pct_app,
        "hr_quality_flag": activity.hr_quality_flag,
        "strength_detail": activity.strength_detail,
        "postmortem": activity.postmortem,
        "source_type": activity.source_type,
        "threshold_hr_bpm": (
            fitness.lactate_threshold_hr if (fitness and fitness.lactate_threshold_hr) else 173
        ),
        "threshold_pace_s_per_km": (
            fitness.lactate_threshold_pace_s_per_km if fitness else None
        ),
        "laps": lap_payload,
        "lap_splits": lap_splits,
    }


@router.get("/{activity_id}/records")
async def get_activity_records(
    activity_id: str,
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Per-second time-series records for chart rendering."""
    # Verify activity exists
    act_result = await db.execute(select(Activity).where(Activity.id == activity_id))
    activity = act_result.scalar_one_or_none()
    if activity is None:
        raise HTTPException(status_code=404, detail="Activity not found")

    await ensure_activity_fit_downloaded(db, activity)

    result = await db.execute(
        select(ActivityRecord)
        .where(ActivityRecord.activity_id == activity_id)
        .order_by(ActivityRecord.timestamp)
    )
    records = result.scalars().all()

    return {
        "activity_id": activity_id,
        "record_count": len(records),
        "records": [
            {
                "timestamp": r.timestamp.isoformat(),
                "elapsed_s": r.elapsed_s,
                "distance_m": r.distance_m,
                "altitude_m": r.altitude_m,
                "speed_mps": r.speed_mps,
                "heart_rate_bpm": r.heart_rate_bpm,
                "cadence": r.cadence,
                "power_w": r.power_w,
                "ground_time_ms": r.ground_time_ms,
                "stride_length_cm": r.stride_length_cm,
                "stride_ratio_pct": r.stride_ratio_pct,
                "stride_height_cm": r.stride_height_cm,
                "position_lat": r.position_lat,
                "position_long": r.position_long,
            }
            for r in records
        ],
    }
