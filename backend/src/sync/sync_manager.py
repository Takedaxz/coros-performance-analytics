"""Sync manager: orchestrates API data fetch -> canonical DB upsert.

Handles both manual "Sync Now" and scheduled background sync.
Publishes progress events for SSE consumption.
"""

import hashlib
import logging
from collections.abc import Callable
from datetime import date as date_type
from datetime import datetime, timedelta

from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import get_settings
from src.db.models import (
    Activity,
    DailyHealth,
    FitnessEstimate,
    SleepSession,
    SourceType,
    SportType,
    SyncEvent,
    User,
)
from src.sync.api_client import CorosApiClient
from src.metrics.baselines import compute_rolling_baseline, compute_zscore
from src.metrics.derived import compute_daily_strain, compute_recovery_score, compute_biological_age

logger = logging.getLogger(__name__)

# Type alias for SSE event push callback
EventCallback = Callable[[str, str], None]


async def run_sync(
    db: AsyncSession,
    user_id: str,
    days: int = 14,
    on_event: EventCallback | None = None,
    redis: Redis | None = None,
) -> SyncEvent:
    """Execute a full API sync and upsert results into canonical tables."""
    sync_event = SyncEvent(
        user_id=user_id,
        source_type=SourceType.API_OFFICIAL,
        status="running",
        started_at=datetime.utcnow(),
    )
    db.add(sync_event)
    await db.flush()

    total_upserted = 0
    settings = get_settings()

    if not settings.coros_email or not settings.coros_password:
        raise ValueError("COROS_EMAIL or COROS_PASSWORD not set in environment")

    try:
        client = CorosApiClient(
            email=settings.coros_email,
            password=settings.coros_password,
            redis=redis,
        )
        # Use Team API only (teamapi.coros.com) — no Mobile API login.
        # Calling /coros/user/login invalidates the phone's active session;
        # sleep stages are unavailable via Team API REST but we keep HRV
        # from fetch_hrv() and fetch_daily_metrics() below.
        await client.login()

        end_date = datetime.utcnow().date()
        start_date = end_date - timedelta(days=days)
        start_str = start_date.strftime("%Y%m%d")
        end_str = end_date.strftime("%Y%m%d")

        # --- Activities ---
        _emit(on_event, "progress", '{"stage": "activities", "message": "Fetching activities..."}')
        raw_activities = await client.fetch_activities(start_str, end_str)
        activity_count = await _upsert_activities(db, user_id, raw_activities)
        total_upserted += activity_count
        _emit(on_event, "progress", f'{{"stage": "activities_done", "count": {activity_count}}}')

        # --- Daily Health & Fitness (Team API only) ---
        _emit(on_event, "progress", '{"stage": "health", "message": "Fetching daily health..."}')
        raw_health = await client.fetch_daily_metrics(start_str, end_str)
        raw_hrv = await client.fetch_hrv()
        raw_fitness = await client.fetch_analyse()

        health_count = await _upsert_daily_health(db, user_id, raw_health, raw_hrv)
        total_upserted += health_count

        fitness_count = await _upsert_fitness(db, user_id, raw_fitness)
        total_upserted += fitness_count

        _emit(
            on_event,
            "progress",
            f'{{"stage": "health_done", "count": {health_count}}}',
        )

        # --- Sleep stages via COROS MCP (no Mobile API) ---
        _emit(on_event, "progress", '{"stage": "sleep", "message": "Fetching sleep stages (MCP)..."}')
        sleep_count = 0
        try:
            from src.mcp.sleep_client import fetch_sleep_via_mcp
            raw_sleep = await fetch_sleep_via_mcp(start_str, end_str, db)
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

    await db.flush()
    return sync_event


def _emit(callback: EventCallback | None, event_type: str, data: str) -> None:
    if callback is not None:
        callback(event_type, data)


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


async def _upsert_activities(db: AsyncSession, user_id: str, items: list[dict]) -> int:
    count = 0
    for item in items:
        start_dt = _parse_timestamp(item.get("startTime"))
        if not start_dt:
            continue

        raw_sport = item.get("sportType", 0)

        # Quick map for Coros sport types to our enum
        if raw_sport in (100, 101, 102, 103, 8, 9, 10, 11):
            sport_enum = SportType.RUN
        elif raw_sport in (200, 201, 2, 3):
            sport_enum = SportType.RIDE
        elif raw_sport in (300, 301, 5):
            sport_enum = SportType.SWIM
        elif raw_sport in (402, 4):
            sport_enum = SportType.STRENGTH
        elif raw_sport in (10000, 10001):
            sport_enum = SportType.MULTISPORT
        elif raw_sport in (12, 13):
            sport_enum = SportType.WALK
        else:
            sport_enum = SportType.OTHER

        existing = await db.execute(
            select(Activity).where(
                Activity.user_id == user_id,
                Activity.start_time == start_dt,
            )
        )
        activity = existing.scalar_one_or_none()

        source_hash = hashlib.sha256(f"api:{start_dt.isoformat()}:{raw_sport}".encode()).hexdigest()

        # Calories logic - API often returns small calories, divide by 1000 if too large
        cal = item.get("calorie", 0)
        if cal > 10000:
            cal = cal / 1000.0

        dist = item.get("distance") or item.get("totalDistance", 0)
        elapsed = item.get("totalTime", 0)
        speed_mps = (dist / elapsed) if elapsed and elapsed > 0 else None

        if activity is None:
            activity = Activity(
                user_id=user_id,
                sport=sport_enum,
                subsport=str(raw_sport),
                title=item.get("name") or item.get("remark", "Activity"),
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
            )
            db.add(activity)
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
                count += 1

    await db.flush()
    return count


async def _upsert_daily_health(
    db: AsyncSession, user_id: str, daily: list[dict], hrv: list[dict]
) -> int:
    count = 0

    # Merge hrv by date
    hrv_by_date = {}
    for h in hrv:
        dt = _parse_date(h.get("happenDay"))
        if dt:
            hrv_by_date[dt] = h.get("avgSleepHrv")

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

        hrv_val = item.get("avgSleepHrv") or hrv_by_date.get(dt)

        valid_hrvs = [val for val in hrv_by_date.values() if val is not None]
        hrv_7d_sma = int(sum(valid_hrvs) / len(valid_hrvs)) if valid_hrvs else None
        
        # Build RHR baseline from the incoming daily data batch
        rhr_by_date = {
            _parse_date(d.get("happenDay")): d.get("rhr") 
            for d in daily if _parse_date(d.get("happenDay")) and d.get("rhr")
        }
        valid_rhrs = [val for val in rhr_by_date.values() if val is not None]
        rhr_7d_sma = int(sum(valid_rhrs) / len(valid_rhrs)) if valid_rhrs else None

        # Calculate a true readiness score based on HRV, RHR, and Fatigue
        rhr_val = item.get("rhr")
        tired_rate = item.get("tiredRate", 0)
        
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
        # Map this new robust score to both readiness and recovery variables
        recovery = readiness

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
        strain = compute_daily_strain(daily_load)

        if health is None:
            health = DailyHealth(
                user_id=user_id,
                date=dt,
                resting_hr_bpm=item.get("rhr"),
                overnight_hrv_avg_ms=hrv_val,
                hrv_7d_sma=hrv_7d_sma,
                recovery_vendor=recovery,
                readiness_score_app=readiness,
                strain_score_app=strain,
                source_type=SourceType.API_OFFICIAL,
            )
            db.add(health)
        else:
            health.resting_hr_bpm = item.get("rhr") or health.resting_hr_bpm
            health.overnight_hrv_avg_ms = hrv_val or health.overnight_hrv_avg_ms
            health.hrv_7d_sma = hrv_7d_sma or health.hrv_7d_sma
            health.recovery_vendor = recovery if recovery is not None else health.recovery_vendor
            health.readiness_score_app = readiness or health.readiness_score_app
            health.strain_score_app = strain
        count += 1

        # Sleep sessions are now handled in _upsert_sleep

    await db.flush()
    return count


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

        # Compute biological age if birthdate is known
        bio_age = None
        user_res = await db.execute(select(User).where(User.id == user_id))
        user = user_res.scalar_one_or_none()
        if user and user.birthdate and vo2max:
            age = (date_type.today() - user.birthdate).days // 365
            bio_age = compute_biological_age(vo2max, age)

        if fitness is None:
            fitness = FitnessEstimate(
                user_id=user_id,
                date=dt,
                vo2max_vendor=vo2max,
                lactate_threshold_hr=item.get("lthr"),
                lactate_threshold_pace_s_per_km=item.get("ltsp"),
                running_fitness_score=stamina,
                biological_age_app=bio_age,
                source_type=SourceType.API_OFFICIAL,
            )
            db.add(fitness)
            count += 1
        else:
            fitness.vo2max_vendor = vo2max or fitness.vo2max_vendor
            fitness.lactate_threshold_hr = item.get("lthr") or fitness.lactate_threshold_hr
            fitness.lactate_threshold_pace_s_per_km = item.get("ltsp") or fitness.lactate_threshold_pace_s_per_km
            fitness.running_fitness_score = stamina or fitness.running_fitness_score
            fitness.biological_age_app = bio_age or fitness.biological_age_app

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

        start_dt = datetime(int(happen_day[:4]), int(happen_day[4:6]), int(happen_day[6:8]))

        existing = await db.execute(
            select(SleepSession).where(
                SleepSession.user_id == user_id,
                SleepSession.sleep_start == start_dt,
            )
        )
        session = existing.scalar_one_or_none()

        total_mins = sd.get("totalSleepTime", 0)
        end_dt = start_dt + timedelta(minutes=total_mins)
        duration_s = total_mins * 60

        source_hash = hashlib.sha256(f"api:sleep:{start_dt.isoformat()}".encode()).hexdigest()

        if session is None:
            session = SleepSession(
                user_id=user_id,
                sleep_start=start_dt,
                sleep_end=end_dt,
                duration_s=duration_s,
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

    await db.flush()
    return count
