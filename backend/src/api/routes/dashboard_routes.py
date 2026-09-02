"""Dashboard routes: aggregated data for the home dashboard."""

from datetime import date, datetime, time, timedelta
from statistics import fmean, median
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import String, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.engine import get_db_session
from src.activity_laps import training_time_s
from src.db.models import Activity, ActivityLap, DailyHealth, FitnessEstimate, SleepSession, SportType, User
from src.metrics.derived import compute_cardio_fitness_age

router = APIRouter()

TrainingVolumeGroup = Literal["week", "month", "year"]


def _training_volume_bounds(start_date: date, end_date: date) -> tuple[datetime, datetime]:
    if start_date > end_date:
        raise HTTPException(status_code=422, detail="start_date cannot be after end_date")
    return (
        datetime.combine(start_date, time.min),
        datetime.combine(end_date + timedelta(days=1), time.min),
    )


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
        .order_by(Activity.start_time.desc())
        .limit(10)
    )
    activities = act_result.scalars().all()
    rest_duration_by_activity: dict[str, float] = {}
    if activities:
        rest_duration_result = await db.execute(
            select(ActivityLap.activity_id, func.sum(ActivityLap.elapsed_s))
            .where(
                ActivityLap.activity_id.in_([activity.id for activity in activities]),
                ActivityLap.lap_trigger == "coros_rest",
            )
            .group_by(ActivityLap.activity_id)
        )
        rest_duration_by_activity = {
            activity_id: float(rest_duration_s)
            for activity_id, rest_duration_s in rest_duration_result.all()
            if rest_duration_s is not None
        }

    # Daily health for period
    health_result = await db.execute(
        select(DailyHealth).where(DailyHealth.date >= cutoff).order_by(DailyHealth.date.desc())
    )
    health_days = health_result.scalars().all()

    latest_steps_result = await db.execute(
        select(DailyHealth)
        .where(DailyHealth.steps.is_not(None))
        .order_by(DailyHealth.date.desc())
        .limit(1)
    )
    latest_steps = latest_steps_result.scalar_one_or_none()

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
    vo2max_30d_values = list(
        await db.scalars(
            select(FitnessEstimate.vo2max_vendor).where(
                FitnessEstimate.date >= date.today() - timedelta(days=30),
                FitnessEstimate.vo2max_vendor.is_not(None),
            )
        )
    )
    vo2max_30d_avg = fmean(vo2max_30d_values) if vo2max_30d_values else None
    user = await db.scalar(select(User).limit(1))
    sex = user.sex if user and user.sex in {"female", "male"} else None
    cardio_fitness_age = (
        compute_cardio_fitness_age(median(vo2max_30d_values), sex)
        if vo2max_30d_values and sex in {"female", "male"}
        else None
    )

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
                "training_time_s": training_time_s(
                    a.timer_time_s,
                    rest_duration_by_activity.get(a.id, 0.0),
                ),
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
        "latest_steps": (
            {
                "date": latest_steps.date.isoformat(),
                "steps": latest_steps.steps,
                "active_calories_kcal": latest_steps.active_calories_kcal,
            }
            if latest_steps
            else None
        ),
        "sleep": [
            {
                "sleep_start": s.sleep_start.isoformat(),
                "duration_s": s.duration_s,
                "is_nap": s.is_nap,
                "stage_deep_s": s.stage_deep_s,
                "stage_rem_s": s.stage_rem_s,
                "stage_light_s": s.stage_light_s,
                "stage_awake_s": s.stage_awake_s,
                "sleep_quality_vendor": s.sleep_quality_vendor,
            }
            for s in sleep_sessions
        ],
        "fitness": {
            "vo2max": latest_fitness.vo2max_vendor if latest_fitness else None,
            "vo2max_30d_avg": float(vo2max_30d_avg) if vo2max_30d_avg is not None else None,
            "ftp": latest_fitness.ftp_vendor if latest_fitness else None,
            "running_fitness": latest_fitness.running_fitness_score if latest_fitness else None,
            "threshold_pace": latest_fitness.lactate_threshold_pace_s_per_km if latest_fitness else None,
            "cardio_fitness_age": cardio_fitness_age,
            "date": latest_fitness.date.isoformat() if latest_fitness else None,
        },
    }


@router.get("/training-load")
async def training_load_trend(
    days: int = Query(default=365, ge=7, le=3650),
    db: AsyncSession = Depends(get_db_session),
) -> list[dict]:
    """Daily training load over time for trend charts."""
    cutoff = date.today() - timedelta(days=days)
    result = await db.execute(
        select(
            func.date(Activity.start_time).label("day"),
            func.sum(Activity.training_load_vendor).label("total_load"),
            func.count(Activity.id).label("activity_count"),
            func.string_agg(cast(Activity.sport, String), ",").label("sports"),
            func.sum(Activity.distance_m).label("total_distance_m"),
            func.sum(Activity.elapsed_time_s).label("total_duration_s"),
        )
        .where(Activity.start_time >= cutoff)
        .group_by(func.date(Activity.start_time))
        .order_by(func.date(Activity.start_time))
    )
    rows = result.all()
    return [
        {
            "date": str(r.day),
            "total_load": r.total_load or 0,
            "activity_count": r.activity_count,
            "sports": list(dict.fromkeys(r.sports.split(","))) if r.sports else [],
            "total_distance_m": r.total_distance_m or 0,
            "total_duration_s": r.total_duration_s or 0,
        }
        for r in rows
    ]


@router.get("/training-volume")
async def training_volume_trend(
    group_by: TrainingVolumeGroup = "month",
    start_date: date | None = None,
    end_date: date | None = None,
    sport: str | None = None,
    db: AsyncSession = Depends(get_db_session),
) -> list[dict]:
    """Aggregate training volume by calendar period for the Trends chart."""
    today = date.today()
    resolved_end_date = end_date or today
    resolved_start_date = start_date or resolved_end_date - timedelta(days=365)
    start, end = _training_volume_bounds(resolved_start_date, resolved_end_date)

    conditions = [Activity.start_time >= start, Activity.start_time < end]
    if sport == "run":
        conditions.append(
            or_(
                Activity.sport == SportType.RUN,
                Activity.subsport == "101",
                Activity.title.ilike("%treadmill%"),
                Activity.title.ilike("%indoor run%"),
            )
        )
    elif sport == "treadmill":
        conditions.append(
            or_(
                Activity.subsport == "101",
                Activity.title.ilike("%treadmill%"),
                Activity.title.ilike("%indoor run%"),
            )
        )
    elif sport:
        conditions.append(Activity.sport == sport)

    period_start = func.date_trunc(group_by, Activity.start_time).label("period_start")
    result = await db.execute(
        select(
            period_start,
            func.sum(Activity.distance_m).label("distance_m"),
            func.sum(Activity.elapsed_time_s).label("duration_s"),
            func.sum(Activity.training_load_vendor).label("training_load"),
            func.count(Activity.id).label("activity_count"),
        )
        .where(*conditions)
        .group_by(period_start)
        .order_by(period_start)
    )
    return [
        {
            "period_start": row.period_start.date().isoformat(),
            "distance_m": row.distance_m or 0,
            "duration_s": row.duration_s or 0,
            "training_load": row.training_load or 0,
            "activity_count": row.activity_count,
        }
        for row in result.all()
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
    user = await db.scalar(select(User).limit(1))
    sex = user.sex if user and user.sex in {"female", "male"} else None
    response: list[dict[str, object]] = []
    for row in rows:
        # ponytail: at most 365 rows; replace with a window query only if this endpoint grows.
        recent_vo2max = [
            item.vo2max_vendor
            for item in rows
            if row.date - timedelta(days=29) <= item.date <= row.date
            and item.vo2max_vendor is not None
        ]
        cardio_fitness_age = (
            compute_cardio_fitness_age(median(recent_vo2max), sex)
            if recent_vo2max and sex in {"female", "male"}
            else None
        )
        response.append(
            {
                "date": str(row.date),
                "vo2max": row.vo2max_vendor,
                "running_fitness": row.running_fitness_score,
                "ftp": row.ftp_vendor,
                "threshold_pace": row.lactate_threshold_pace_s_per_km,
                "lthr": row.lactate_threshold_hr,
                "cardio_fitness_age": cardio_fitness_age,
            }
        )
    return response


@router.get("/running-fitness")
async def running_fitness(db: AsyncSession = Depends(get_db_session)) -> dict[str, float | None]:
    """Latest official COROS running-fitness snapshot cached during sync."""
    user = await db.scalar(select(User).order_by(User.updated_at.desc()).limit(1))
    preferences = user.device_preferences if user is not None else None
    cached = preferences.get("coros_running_fitness", {}) if preferences else {}
    snapshot = cached if isinstance(cached, dict) else {}
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
    return {field: float(snapshot[field]) if isinstance(snapshot.get(field), (int, float)) else None for field in fields}


@router.get("/personal-records")
async def personal_records(
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Return official COROS records cached during the latest Team API sync."""
    user = await db.scalar(select(User).order_by(User.updated_at.desc()).limit(1))
    preferences = user.device_preferences if user is not None else None
    groups = preferences.get("coros_personal_record_groups", []) if preferences else []
    return {"groups": groups}


@router.get("/training-distributions")
async def training_distributions(
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Return COROS zones plus locally grouped 4-week distance bands."""
    user = await db.scalar(select(User).order_by(User.updated_at.desc()).limit(1))
    preferences = user.device_preferences if user is not None else None
    cached = preferences.get("coros_training_distributions", {}) if preferences else {}
    distributions = dict(cached) if isinstance(cached, dict) else {}
    bands = [
        ("0–5 km", 0, 5_000),
        ("5–10 km", 5_000, 10_000),
        ("10–20 km", 10_000, 20_000),
        ("20–40 km", 20_000, 40_000),
        ("40+ km", 40_000, None)
    ]
    activities = (
        await db.scalars(
            select(Activity).where(
                Activity.start_time >= date.today() - timedelta(days=28),
                Activity.distance_m > 0,
            )
        )
    ).all()
    buckets = [{"index": index + 1, "value": 0.0, "load": 0.0, "duration": 0.0} for index in range(len(bands))]
    for activity in activities:
        distance = activity.distance_m or 0
        for index, (_, lower, upper) in enumerate(bands):
            if distance >= lower and (upper is None or distance < upper):
                buckets[index]["value"] += 1
                buckets[index]["load"] += activity.training_load_vendor or 0
                buckets[index]["duration"] += activity.elapsed_time_s or 0
                break
    distributions["distance_frequency"] = [
        {"index": bucket["index"], "value": bucket["value"]} for bucket in buckets
    ]
    distributions["distance_training_load"] = [
        {"index": bucket["index"], "value": bucket["load"]} for bucket in buckets
    ]
    distributions["distance_time"] = [
        {"index": bucket["index"], "value": bucket["duration"]} for bucket in buckets
    ]
    return distributions


_ZONE_BOUNDARIES_PCT: list[tuple[float, float]] = [
    (0.50, 0.60),  # Zone 1 — Active Recovery
    (0.60, 0.70),  # Zone 2 — Aerobic Base
    (0.70, 0.80),  # Zone 3 — Aerobic Threshold
    (0.80, 0.90),  # Zone 4 — Lactate Threshold
    (0.90, 1.00),  # Zone 5 — VO2 Max
]


def _classify_zone(avg_hr: int, max_hr: int) -> int:
    """Return HR zone 1-5. Anything below zone 1 lower bound = zone 1."""
    pct = avg_hr / max_hr
    for zone_index, (low, high) in enumerate(_ZONE_BOUNDARIES_PCT, start=1):
        if pct < high:
            return zone_index
    return 5


@router.get("/weekly-hr-zones")
async def weekly_hr_zones(
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Minutes spent in each HR zone (1-5) over the rolling last 7 days.

    Uses Activity.avg_hr_bpm as zone classifier and Activity.elapsed_time_s for
    duration. The max HR reference is taken from User.max_hr_bpm when available,
    then 220-age from birthdate, then 190 bpm as final fallback.
    """
    today = date.today()
    window_start = today - timedelta(days=6)  # rolling 7-day window
    window_end = today + timedelta(days=1)    # exclusive: captures all of today

    # Fetch a user max_hr_bpm (first user in the table — single-user app)
    user_result = await db.execute(select(User).limit(1))
    user = user_result.scalar_one_or_none()
    if user and user.max_hr_bpm:
        max_hr: int = user.max_hr_bpm
    elif user and user.birthdate:
        age = (date.today() - user.birthdate).days // 365
        max_hr = max(160, 220 - age)  # 160 floor prevents absurd values for very old ages
    else:
        max_hr = 190  # population-level fallback when no profile data exists

    act_result = await db.execute(
        select(Activity).where(
            Activity.start_time >= window_start,
            Activity.start_time < window_end,
            Activity.avg_hr_bpm.is_not(None),
            Activity.elapsed_time_s.is_not(None),
        )
    )
    activities = act_result.scalars().all()

    zone_minutes: dict[int, float] = {z: 0.0 for z in range(1, 6)}
    zone_activities: dict[int, list[str]] = {z: [] for z in range(1, 6)}

    for act in activities:
        zone = _classify_zone(act.avg_hr_bpm, max_hr)
        zone_minutes[zone] += act.elapsed_time_s / 60.0
        if act.title:
            zone_activities[zone].append(act.title)

    total_minutes = sum(zone_minutes.values())

    return {
        "week_start": str(window_start),
        "week_end": str(today),  # display as today, +1 is an internal exclusive bound
        "max_hr_used": max_hr,
        "total_minutes": round(total_minutes, 1),
        "zones": [
            {
                "zone": z,
                "label": ["Active Recovery", "Aerobic Base", "Aerobic Threshold", "Lactate Threshold", "VO2 Max"][z - 1],
                "hr_range": f"{int(_ZONE_BOUNDARIES_PCT[z-1][0]*max_hr)}–{int(_ZONE_BOUNDARIES_PCT[z-1][1]*max_hr)} bpm",
                "minutes": round(zone_minutes[z], 1),
                "activities": zone_activities[z],
            }
            for z in range(1, 6)
        ],
    }


@router.get("/daily-health-trends")
async def daily_health_trends(
    days: int = Query(default=42, ge=7, le=365),
    db: AsyncSession = Depends(get_db_session),
) -> list[dict]:
    """Daily steps, active calories, and resting HR over time."""
    cutoff = date.today() - timedelta(days=days)
    result = await db.execute(
        select(DailyHealth)
        .where(DailyHealth.date >= cutoff)
        .order_by(DailyHealth.date.asc())
    )
    rows = result.scalars().all()
    return [
        {
            "date": str(r.date),
            "steps": r.steps,
            "active_calories_kcal": r.active_calories_kcal,
            "resting_hr_bpm": r.resting_hr_bpm,
        }
        for r in rows
    ]
