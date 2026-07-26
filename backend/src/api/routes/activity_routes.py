"""Activity routes: list, detail, and time-series data for activities."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, select, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.engine import get_db_session
from src.db.models import Activity, ActivityLap, ActivityRecord

router = APIRouter()


def _is_recovery_lap(laps: list[ActivityLap], index: int) -> bool:
    """Identify a short recovery interval between two hard running reps."""
    if index == 0 or index == len(laps) - 1:
        return False
    previous, current, following = laps[index - 1], laps[index], laps[index + 1]
    if (
        current.distance_m is None
        or current.avg_speed_mps is None
        or previous.distance_m is None
        or previous.avg_speed_mps is None
        or following.distance_m is None
        or following.avg_speed_mps is None
    ):
        return False
    is_between_hard_reps = following.distance_m >= 400
    is_before_cooldown = following.elapsed_s >= 240 and following.avg_speed_mps <= previous.avg_speed_mps * 0.75
    return (
        60 <= current.elapsed_s <= 300
        and current.distance_m < 500
        and previous.distance_m >= 400
        and (is_between_hard_reps or is_before_cooldown)
        and current.avg_speed_mps <= previous.avg_speed_mps * 0.75
    )


def _distance_splits(
    records: list[ActivityRecord],
    chunk_distance_m: float,
    source_lap_distances: list[float] | None = None,
    source_lap_start_elapsed: list[float] | None = None,
) -> list[dict[str, float | int | None]]:
    """Build fixed-distance splits from raw records, retaining COROS lap boundaries."""
    distance_records = [
        record
        for record in records
        if record.distance_m is not None and record.elapsed_s is not None
    ]
    if len(distance_records) < 2:
        return []

    start_distance = distance_records[0].distance_m
    start_elapsed = distance_records[0].elapsed_s
    end_distance = distance_records[-1].distance_m
    end_elapsed = distance_records[-1].elapsed_s
    if start_distance is None or start_elapsed is None or end_distance is None or end_elapsed is None:
        return []

    splits: list[dict[str, float | int | None]] = []
    source_distance_total = sum(source_lap_distances or [])
    source_origin = end_distance - source_distance_total if source_distance_total else start_distance
    segment_start_distance = source_origin
    segment_start_elapsed = records[0].elapsed_s if records[0].elapsed_s is not None else start_elapsed
    segment_start_index = 0
    lap_end_distances: list[float] = []
    lap_end_distance = source_origin
    for lap_distance in source_lap_distances or []:
        if lap_distance > 0:
            lap_end_distance += lap_distance
            lap_end_distances.append(lap_end_distance)
    lap_end_index = 0
    next_split_distance = min(
        source_origin + chunk_distance_m,
        lap_end_distances[lap_end_index] if lap_end_distances else float("inf"),
    )

    def append_split(
        segment_end_distance: float,
        segment_end_elapsed: float,
        segment_end_index: int,
    ) -> None:
        segment_records = distance_records[segment_start_index : segment_end_index + 1]
        hr_values = [record.heart_rate_bpm for record in segment_records if record.heart_rate_bpm is not None]
        power_values = [record.power_w for record in segment_records if record.power_w is not None]
        cadence_values = [record.cadence for record in segment_records if record.cadence is not None]
        elapsed_s = max(0.0, segment_end_elapsed - segment_start_elapsed)
        distance_m = max(0.0, segment_end_distance - segment_start_distance)
        splits.append(
            {
                "lap_index": len(splits),
                "source_lap_index": lap_end_index if lap_end_distances else None,
                "elapsed_s": elapsed_s,
                "distance_m": distance_m,
                "avg_hr_bpm": round(sum(hr_values) / len(hr_values)) if hr_values else None,
                "max_hr_bpm": max(hr_values) if hr_values else None,
                "avg_speed_mps": distance_m / elapsed_s if elapsed_s > 0 else None,
                "avg_power_w": round(sum(power_values) / len(power_values)) if power_values else None,
                "avg_cadence": round(sum(cadence_values) / len(cadence_values)) if cadence_values else None,
            }
        )

    previous_distance = source_origin
    previous_elapsed = segment_start_elapsed
    for index, current in enumerate(distance_records):
        if current.distance_m is None or current.elapsed_s is None:
            continue
        if current.distance_m <= previous_distance:
            continue

        while current.distance_m >= next_split_distance:
            fraction = (next_split_distance - previous_distance) / (current.distance_m - previous_distance)
            crossing_elapsed = previous_elapsed + fraction * (current.elapsed_s - previous_elapsed)
            append_split(next_split_distance, crossing_elapsed, index)
            segment_start_distance = next_split_distance
            segment_start_elapsed = crossing_elapsed
            segment_start_index = index
            if (
                lap_end_index < len(lap_end_distances)
                and next_split_distance >= lap_end_distances[lap_end_index]
            ):
                lap_end_index += 1
                if source_lap_start_elapsed and lap_end_index < len(source_lap_start_elapsed):
                    segment_start_elapsed = source_lap_start_elapsed[lap_end_index]
            next_split_distance = min(
                segment_start_distance + chunk_distance_m,
                lap_end_distances[lap_end_index]
                if lap_end_index < len(lap_end_distances)
                else float("inf"),
            )
        previous_distance = current.distance_m
        previous_elapsed = current.elapsed_s

    if end_distance > segment_start_distance:
        append_split(end_distance, end_elapsed, len(distance_records) - 1)

    return splits


@router.get("/")
async def list_activities(
    sport: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """List activities with optional sport filter, pagination."""
    query = select(Activity).order_by(Activity.start_time.desc())
    count_query = select(func.count()).select_from(Activity)

    if sport:
        query = query.where(Activity.sport == sport)
        count_query = count_query.where(Activity.sport == sport)

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
from src.sync.api_client import CorosApiClient
from src.parsers.fit_parser import parse_fit_file

logger = logging.getLogger(__name__)


async def ensure_activity_fit_downloaded(db: AsyncSession, activity: Activity) -> None:
    """Lazy download & parse FIT file on demand when user views an activity."""
    records_count = await db.scalar(
        select(func.count(ActivityRecord.id)).where(ActivityRecord.activity_id == activity.id)
    )
    lap_count = await db.scalar(
        select(func.count(ActivityLap.id)).where(ActivityLap.activity_id == activity.id)
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
    if (records_count > 0 and not rebuild_multisport) or not activity.label_id:
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
        if rebuild_multisport:
            await db.execute(delete(ActivityLap).where(ActivityLap.activity_id == activity.id))
            await db.execute(delete(ActivityRecord).where(ActivityRecord.activity_id == activity.id))
        if not lap_count or rebuild_multisport:
            db.add_all(db_laps)

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
                cadence=r.cadence,
                power_w=r.power_w,
                temperature_c=r.temperature_c,
            )
            for r in fit_records
        ]
        db.add_all(db_records)
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

    # Fetch laps
    lap_result = await db.execute(
        select(ActivityLap)
        .where(ActivityLap.activity_id == activity_id)
        .order_by(ActivityLap.lap_index)
    )
    laps = lap_result.scalars().all()
    lap_payload = [
        {
            "lap_index": lap.lap_index,
            "start_time": lap.start_time.isoformat(),
            "leg": lap.lap_trigger.removeprefix("triathlon_") if lap.lap_trigger and lap.lap_trigger.startswith("triathlon_") else None,
            "elapsed_s": lap.elapsed_s,
            "distance_m": lap.distance_m,
            "avg_hr_bpm": lap.avg_hr_bpm,
            "max_hr_bpm": lap.max_hr_bpm,
            "avg_speed_mps": lap.avg_speed_mps,
            "avg_power_w": lap.avg_power_w,
            "avg_cadence": lap.avg_cadence,
            "lap_type": (
                "rest"
                if lap.lap_trigger == "coros_rest"
                else "run"
                if lap.lap_trigger == "coros_run"
                else "functional"
                if lap.lap_trigger == "coros_functional"
                else "recovery"
                if activity.sport in {"run", "trail_run"} and _is_recovery_lap(laps, index)
                else None
            ),
        }
        for index, lap in enumerate(laps)
    ]

    lap_splits: dict[str, list[dict[str, float | int | None]]] = {}
    split_distance_m = (
        1_000
        if activity.sport in {"run", "trail_run"}
        else 20
        if activity.sport == "swim"
        else None
    )
    if split_distance_m is not None and laps:
        record_result = await db.execute(
            select(ActivityRecord)
            .where(ActivityRecord.activity_id == activity_id)
            .order_by(ActivityRecord.timestamp)
        )
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
            record_result.scalars().all(),
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
                "position_lat": r.position_lat,
                "position_long": r.position_long,
            }
            for r in records
        ],
    }
