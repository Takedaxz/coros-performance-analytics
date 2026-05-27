"""Dashboard routes: aggregated data for the home dashboard."""

from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.engine import get_db_session
from src.db.models import Activity, DailyHealth, FitnessEstimate, SleepSession

router = APIRouter()


@router.get("/summary")
async def dashboard_summary(
    days: int = Query(default=7, ge=1, le=90),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Home dashboard summary: recent activities, health trends, readiness."""
    cutoff = date.today() - timedelta(days=days)

    # Recent activities
    act_result = await db.execute(
        select(Activity)
        .where(Activity.start_time >= cutoff)
        .order_by(Activity.start_time.desc())
        .limit(10)
    )
    activities = act_result.scalars().all()

    # Daily health for period
    health_result = await db.execute(
        select(DailyHealth).where(DailyHealth.date >= cutoff).order_by(DailyHealth.date.desc())
    )
    health_days = health_result.scalars().all()

    # Sleep for period
    sleep_result = await db.execute(
        select(SleepSession)
        .where(SleepSession.sleep_start >= cutoff)
        .order_by(SleepSession.sleep_start.desc())
    )
    sleep_sessions = sleep_result.scalars().all()

    # Latest fitness estimates
    fitness_result = await db.execute(
        select(FitnessEstimate).order_by(FitnessEstimate.date.desc()).limit(1)
    )
    latest_fitness = fitness_result.scalar_one_or_none()

    return {
        "period_days": days,
        "activities": [
            {
                "id": a.id,
                "sport": a.sport,
                "title": a.title,
                "start_time": a.start_time.isoformat(),
                "distance_m": a.distance_m,
                "elapsed_time_s": a.elapsed_time_s,
                "avg_hr_bpm": a.avg_hr_bpm,
                "avg_speed_mps": a.avg_speed_mps,
                "avg_power_w": a.avg_power_w,
                "calories_kcal": a.calories_kcal,
                "training_load_vendor": a.training_load_vendor,
                "source_type": a.source_type,
            }
            for a in activities
        ],
        "health": [
            {
                "date": h.date.isoformat(),
                "resting_hr_bpm": h.resting_hr_bpm,
                "overnight_hrv_avg_ms": h.overnight_hrv_avg_ms,
                "hrv_7d_sma": h.hrv_7d_sma,
                "recovery_vendor": h.recovery_vendor,
                "steps": h.steps,
                "readiness_score_app": h.readiness_score_app,
                "strain_score_app": h.strain_score_app,
                "anomaly_flags": h.anomaly_flags,
            }
            for h in health_days
        ],
        "sleep": [
            {
                "sleep_start": s.sleep_start.isoformat(),
                "duration_s": s.duration_s,
                "stage_deep_s": s.stage_deep_s,
                "stage_rem_s": s.stage_rem_s,
                "stage_light_s": s.stage_light_s,
                "stage_awake_s": s.stage_awake_s,
            }
            for s in sleep_sessions
        ],
        "fitness": {
            "vo2max": latest_fitness.vo2max_vendor if latest_fitness else None,
            "ftp": latest_fitness.ftp_vendor if latest_fitness else None,
            "running_fitness": latest_fitness.running_fitness_score if latest_fitness else None,
            "threshold_pace": latest_fitness.lactate_threshold_pace_s_per_km if latest_fitness else None,
            "biological_age": latest_fitness.biological_age_app if latest_fitness else None,
            "date": latest_fitness.date.isoformat() if latest_fitness else None,
        },
    }


@router.get("/training-load")
async def training_load_trend(
    days: int = Query(default=42, ge=7, le=365),
    db: AsyncSession = Depends(get_db_session),
) -> list[dict]:
    """Daily training load over time for trend charts."""
    cutoff = date.today() - timedelta(days=days)
    result = await db.execute(
        select(
            func.date(Activity.start_time).label("day"),
            func.sum(Activity.training_load_vendor).label("total_load"),
            func.count(Activity.id).label("activity_count"),
        )
        .where(Activity.start_time >= cutoff)
        .group_by(func.date(Activity.start_time))
        .order_by(func.date(Activity.start_time))
    )
    rows = result.all()
    return [
        {"date": str(r.day), "total_load": r.total_load or 0, "activity_count": r.activity_count}
        for r in rows
    ]


@router.get("/fitness-trend")
async def fitness_trend(
    days: int = Query(default=180, ge=7, le=365),
    db: AsyncSession = Depends(get_db_session),
) -> list[dict]:
    """VO2 Max and fitness estimates over time."""
    cutoff = date.today() - timedelta(days=days)
    result = await db.execute(
        select(FitnessEstimate)
        .where(FitnessEstimate.date >= cutoff)
        .order_by(FitnessEstimate.date.asc())
    )
    rows = result.scalars().all()
    return [
        {
            "date": str(r.date),
            "vo2max": r.vo2max_vendor,
            "running_fitness": r.running_fitness_score,
            "ftp": r.ftp_vendor,
            "threshold_pace": r.lactate_threshold_pace_s_per_km,
            "biological_age": r.biological_age_app,
        }
        for r in rows
    ]

@router.get("/personal-records")
async def personal_records(
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Calculate personal records (longest run, fastest 5k, etc.) from activities."""
    prs = {}

    # 1. Longest Run
    longest_run = await db.execute(
        select(Activity).where(Activity.sport == "run").order_by(Activity.distance_m.desc()).limit(1)
    )
    longest_run_act = longest_run.scalar_one_or_none()
    if longest_run_act and longest_run_act.distance_m:
        prs["longest_run"] = {
            "title": longest_run_act.title or "Run",
            "date": longest_run_act.start_time.isoformat(),
            "distance_m": longest_run_act.distance_m,
            "elapsed_time_s": longest_run_act.elapsed_time_s
        }

    # 2. Longest Ride
    longest_ride = await db.execute(
        select(Activity).where(Activity.sport == "ride").order_by(Activity.distance_m.desc()).limit(1)
    )
    longest_ride_act = longest_ride.scalar_one_or_none()
    if longest_ride_act and longest_ride_act.distance_m:
        prs["longest_ride"] = {
            "title": longest_ride_act.title or "Ride",
            "date": longest_ride_act.start_time.isoformat(),
            "distance_m": longest_ride_act.distance_m,
            "elapsed_time_s": longest_ride_act.elapsed_time_s
        }

    # 3. Best average pace run (runs >= 5km, ranked by avg_speed_mps which is on-watch computed)
    best_pace_run = await db.execute(
        select(Activity)
        .where(Activity.sport.in_(["run", "trail_run"]), Activity.distance_m >= 5000, Activity.avg_speed_mps.is_not(None))
        .order_by(Activity.avg_speed_mps.desc())
        .limit(1)
    )
    best_pace_act = best_pace_run.scalar_one_or_none()
    if best_pace_act and best_pace_act.avg_speed_mps:
        pace_s_per_km = int(1000.0 / best_pace_act.avg_speed_mps)
        prs["best_pace_run"] = {
            "title": best_pace_act.title or "Run",
            "date": best_pace_act.start_time.isoformat(),
            "distance_m": best_pace_act.distance_m,
            "pace_s_per_km": pace_s_per_km,
        }

    # 4. Six-month totals: activity count + total km
    from datetime import timezone
    from sqlalchemy import func as sa_func
    six_months_ago = date.today() - timedelta(days=183)
    totals_result = await db.execute(
        select(
            sa_func.count(Activity.id).label("total_activities"),
            sa_func.sum(Activity.distance_m).label("total_distance_m"),
        ).where(Activity.start_time >= six_months_ago)
    )
    totals_row = totals_result.one()
    prs["six_month_totals"] = {
        "total_activities": totals_row.total_activities or 0,
        "total_distance_km": round((totals_row.total_distance_m or 0) / 1000, 1),
    }

    # 5. Highest Power Ride
    highest_power = await db.execute(
        select(Activity).where(Activity.sport == "ride").order_by(Activity.max_power_w.desc()).limit(1)
    )
    highest_power_act = highest_power.scalar_one_or_none()
    if highest_power_act and highest_power_act.max_power_w:
        prs["highest_power_ride"] = {
            "title": highest_power_act.title or "Ride",
            "date": highest_power_act.start_time.isoformat(),
            "max_power_w": highest_power_act.max_power_w,
            "avg_power_w": highest_power_act.avg_power_w,
            "distance_m": highest_power_act.distance_m
        }

    return prs
