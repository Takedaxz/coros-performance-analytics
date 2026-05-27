"""Activity routes: list, detail, and time-series data for activities."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.engine import get_db_session
from src.db.models import Activity, ActivityLap, ActivityRecord

router = APIRouter()


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

    # Fetch laps
    lap_result = await db.execute(
        select(ActivityLap)
        .where(ActivityLap.activity_id == activity_id)
        .order_by(ActivityLap.lap_index)
    )
    laps = lap_result.scalars().all()

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
        "source_type": activity.source_type,
        "laps": [
            {
                "lap_index": lap.lap_index,
                "elapsed_s": lap.elapsed_s,
                "distance_m": lap.distance_m,
                "avg_hr_bpm": lap.avg_hr_bpm,
                "max_hr_bpm": lap.max_hr_bpm,
                "avg_speed_mps": lap.avg_speed_mps,
                "avg_power_w": lap.avg_power_w,
                "avg_cadence": lap.avg_cadence,
            }
            for lap in laps
        ],
    }


@router.get("/{activity_id}/records")
async def get_activity_records(
    activity_id: str,
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Per-second time-series records for chart rendering."""
    # Verify activity exists
    act_result = await db.execute(select(Activity.id).where(Activity.id == activity_id))
    if act_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Activity not found")

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
