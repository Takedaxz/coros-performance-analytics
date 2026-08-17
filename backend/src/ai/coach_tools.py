"""Read-only, owner-scoped data tools for AI Coach."""

import asyncio
import datetime as dt
from collections.abc import Callable
from concurrent.futures import TimeoutError as FutureTimeoutError
from typing import Any, NotRequired
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import select
from typing_extensions import TypedDict

from src.ai.brave_search import search_live_coaching_sources as search_web
from src.ai.context_builder import build_plan_context
from src.ai.knowledge import search_coaching_knowledge as search_knowledge_library
from src.ai.knowledge import valid_knowledge_topic
from src.db.engine import async_session_factory
from src.db.models import (
    Activity,
    ActivityLap,
    DailyHealth,
    FitnessEstimate,
    Goal,
    SleepSession,
    SportType,
)

_TREND_DAYS = frozenset({7, 14, 28, 56})
_FITNESS_DAYS = frozenset({28, 56, 90, 180})
MAX_TOOL_CALLS = 2
_USER_TZ = ZoneInfo("Asia/Bangkok")
_SPORT_ALIASES: dict[str, SportType] = {
    "running": SportType.RUN,
    "road_run": SportType.RUN,
    "trail_running": SportType.TRAIL_RUN,
    "cycling": SportType.RIDE,
    "biking": SportType.RIDE,
    "swimming": SportType.SWIM,
    "walking": SportType.WALK,
    "hiking": SportType.HIKE,
}


class ToolCallRecord(TypedDict):
    name: str
    arguments: dict[str, Any]
    display_arguments: NotRequired[dict[str, str | list[str]]]
    display_result: NotRequired[dict[str, list[str]]]


def coach_tool_functions(
    user_id: str,
    event_loop: asyncio.AbstractEventLoop,
) -> list[Callable[..., dict[str, Any]]]:
    """Return SDK-callable functions bound to one authenticated user."""

    def run(name: str, timeout_seconds: float = 15.0, **arguments: Any) -> dict[str, Any]:
        future = asyncio.run_coroutine_threadsafe(
            _execute_tool(name, user_id, arguments), event_loop
        )
        try:
            return future.result(timeout=timeout_seconds)
        except FutureTimeoutError:
            future.cancel()
            return {"error": f"{name} timed out."}

    def get_health_trend(days: int) -> dict[str, Any]:
        """Get health, sleep, readiness, and recovery trends for 7, 14, 28, or 56 days."""
        return run("get_health_trend", days=days)

    def get_activities(
        start_date: str, end_date: str, sport: str | None = None, limit: int = 20
    ) -> dict[str, Any]:
        """Find activities in a date range with an optional canonical sport filter."""
        return run(
            "get_activities", start_date=start_date, end_date=end_date, sport=sport, limit=limit
        )

    def get_activity_detail(activity_id: str) -> dict[str, Any]:
        """Get detailed splits and metrics for one activity owned by the athlete."""
        return run("get_activity_detail", activity_id=activity_id)

    def compare_activities(activity_ids: list[str]) -> dict[str, Any]:
        """Compare 2 to 6 activities of the same sport using their compact coaching metrics."""
        return run("compare_activities", activity_ids=activity_ids)

    def get_training_plan(start_date: str, end_date: str) -> dict[str, Any]:
        """Get planned training sessions in a date range of at most 90 days."""
        return run("get_training_plan", start_date=start_date, end_date=end_date)

    def get_scheduled_workout_details(date: str) -> dict[str, Any]:
        """Get the structured COROS workouts scheduled on one date, including steps and targets."""
        return run("get_scheduled_workout_details", timeout_seconds=45.0, date=date)

    def get_fitness_history(days: int) -> dict[str, Any]:
        """Get fitness estimates and race predictions for 28, 56, 90, or 180 days."""
        return run("get_fitness_history", days=days)

    def get_past_race_goals() -> dict[str, Any]:
        """Retrieve saved past races with times, notes, and dates."""
        return run("get_past_race_goals")

    def search_coaching_knowledge(query: str, topic: str | None = None) -> dict[str, Any]:
        """Find cited general coaching guidance."""
        return run("search_coaching_knowledge", query=query, topic=topic)

    def web_search(query: str) -> dict[str, Any]:
        """Find current coaching research, event rules, or official guidance."""
        return run("web_search", query=query)

    return [
        get_health_trend,
        get_activities,
        get_activity_detail,
        compare_activities,
        get_training_plan,
        get_scheduled_workout_details,
        get_fitness_history,
        get_past_race_goals,
        search_coaching_knowledge,
        web_search,
    ]


def _date(value: str) -> dt.date:
    return dt.date.fromisoformat(value)


def _sport_type(value: str | None) -> SportType | None:
    if value is None:
        return None
    normalized = value.strip().lower().replace("-", "_").replace(" ", "_")
    if normalized in _SPORT_ALIASES:
        return _SPORT_ALIASES[normalized]
    return SportType(normalized)


def _pace_s_km(speed_mps: float | None) -> int | None:
    return round(1_000 / speed_mps) if speed_mps and speed_mps > 0 else None


def _activity_uuid(value: object) -> str | None:
    try:
        return str(UUID(str(value)))
    except (TypeError, ValueError):
        return None


async def _execute_tool(name: str, user_id: str, arguments: dict[str, Any]) -> dict[str, Any]:
    if name == "web_search":
        query = arguments.get("query", "").strip()
        if not 3 <= len(query) <= 300:
            return {"error": "query must be 3-300 characters"}
        return await search_web(query)

    if name == "get_activity_detail":
        activity_id = _activity_uuid(arguments.get("activity_id"))
        if activity_id is None:
            return {"error": "activity_id must be a UUID returned by get_activities"}
        arguments = {**arguments, "activity_id": activity_id}
    if name == "compare_activities":
        activity_ids = arguments.get("activity_ids")
        if not isinstance(activity_ids, list) or not 2 <= len(activity_ids) <= 6:
            return {"error": "activity_ids must contain 2 to 6 activities"}
        valid_activity_ids = [_activity_uuid(activity_id) for activity_id in activity_ids]
        if any(activity_id is None for activity_id in valid_activity_ids):
            return {"error": "activity_ids must be UUIDs returned by get_activities"}
        arguments = {**arguments, "activity_ids": valid_activity_ids}

    async with async_session_factory() as db:
        if name == "get_health_trend":
            days = arguments["days"]
            if days not in _TREND_DAYS:
                return {"error": "days must be 7, 14, 28, or 56"}
            return await _health_trend(db, user_id, days)
        if name == "get_training_plan":
            start, end = _date(arguments["start_date"]), _date(arguments["end_date"])
            if end < start or (end - start).days > 90:
                return {"error": "date range must be between 0 and 90 days"}
            today = dt.date.today()
            return {"data": await build_plan_context((today - start).days, (end - today).days)}
        if name == "get_scheduled_workout_details":
            try:
                date = _date(arguments["date"])
            except ValueError:
                return {"error": "date must be a real YYYY-MM-DD value"}
            return await _scheduled_workout_details(db, date)
        if name == "get_activities":
            return await _activities(db, user_id, arguments)
        if name == "get_activity_detail":
            return await _activity_detail(db, user_id, arguments["activity_id"])
        if name == "compare_activities":
            activity_ids = arguments["activity_ids"]
            return {
                "activities": [
                    await _activity_detail(db, user_id, activity_id) for activity_id in activity_ids
                ]
            }
        if name == "get_fitness_history":
            return await _fitness_history(db, user_id, arguments["days"])
        if name == "get_past_race_goals":
            return await _past_race_goals(db, user_id)
        if name == "search_coaching_knowledge":
            query = arguments.get("query", "").strip()
            topic = arguments.get("topic")
            if not 3 <= len(query) <= 300:
                return {"error": "query must be 3-300 characters"}
            if not valid_knowledge_topic(topic):
                return {
                    "error": (
                        "topic must be one of: running, ultra, cycling, swimming, endurance, "
                        "recovery, nutrition, strength, hyrox, crossfit"
                    )
                }
            excerpts = search_knowledge_library(query, topic)
            return (
                {"knowledge": excerpts}
                if excerpts
                else {"error": "no matching coaching knowledge"}
            )
    return {"error": "unknown tool"}


def _without_nulls(values: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in values.items() if value is not None}


async def _health_trend(db: Any, user_id: str, days: int) -> dict[str, Any]:
    """Return the complete coaching trend without Markdown table overhead."""
    start_date = dt.date.today() - dt.timedelta(days=days)
    start_time = dt.datetime.combine(start_date, dt.time.min)
    health = (
        (
            await db.execute(
                select(DailyHealth)
                .where(DailyHealth.user_id == user_id, DailyHealth.date >= start_date)
                .order_by(DailyHealth.date)
            )
        )
        .scalars()
        .all()
    )
    sleep = (
        (
            await db.execute(
                select(SleepSession)
                .where(SleepSession.user_id == user_id, SleepSession.sleep_start >= start_time)
                .order_by(SleepSession.sleep_start)
            )
        )
        .scalars()
        .all()
    )
    activities = (
        (
            await db.execute(
                select(Activity)
                .where(Activity.user_id == user_id, Activity.start_time >= start_time)
                .order_by(Activity.start_time)
            )
        )
        .scalars()
        .all()
    )
    return {
        "range": f"{start_date}/{dt.date.today()}",
        "health": [
            _without_nulls(
                {
                    "date": item.date.isoformat(),
                    "hrv_ms": round(item.overnight_hrv_avg_ms, 1)
                    if item.overnight_hrv_avg_ms is not None
                    else None,
                    "hrv_baseline_ms": [
                        round(item.overnight_hrv_normal_low_ms, 1),
                        round(item.overnight_hrv_normal_high_ms, 1),
                    ]
                    if item.overnight_hrv_normal_low_ms is not None
                    and item.overnight_hrv_normal_high_ms is not None
                    else None,
                    "hrv_7d_ms": (
                        round(item.hrv_7d_sma, 1) if item.hrv_7d_sma is not None else None
                    ),
                    "hrv_30d_ms": (
                        round(item.hrv_30d_sma, 1) if item.hrv_30d_sma is not None else None
                    ),
                    "hrv_z": round(item.hrv_zscore, 2) if item.hrv_zscore is not None else None,
                    "rhr_bpm": item.resting_hr_bpm,
                    "readiness": round(item.readiness_score_app, 1)
                    if item.readiness_score_app is not None
                    else None,
                    "strain": round(item.strain_score_app, 1)
                    if item.strain_score_app is not None
                    else None,
                    "recovery": round(item.recovery_vendor, 1)
                    if item.recovery_vendor is not None
                    else None,
                    "load_impact": round(item.load_impact_vendor, 1)
                    if item.load_impact_vendor is not None
                    else None,
                    "intensity_trend": item.intensity_trend_vendor,
                    "stress": (
                        round(item.stress_score, 1) if item.stress_score is not None else None
                    ),
                    "spo2": round(item.spo2_pct, 1) if item.spo2_pct is not None else None,
                    "steps": item.steps,
                    "active_kcal": item.active_calories_kcal,
                    "breathing_rate": round(item.breathing_rate, 1)
                    if item.breathing_rate is not None
                    else None,
                    "anomalies": item.anomaly_flags,
                }
            )
            for item in health
        ],
        "sleep": [
            _without_nulls(
                {
                    "date": item.sleep_start.date().isoformat(),
                    "duration_min": round(item.duration_s / 60),
                    "deep_min": (
                        round(item.stage_deep_s / 60) if item.stage_deep_s is not None else None
                    ),
                    "rem_min": (
                        round(item.stage_rem_s / 60) if item.stage_rem_s is not None else None
                    ),
                    "light_min": (
                        round(item.stage_light_s / 60) if item.stage_light_s is not None else None
                    ),
                    "awake_min": (
                        round(item.stage_awake_s / 60) if item.stage_awake_s is not None else None
                    ),
                    "quality": round(item.sleep_quality_vendor, 1)
                    if item.sleep_quality_vendor is not None
                    else None,
                    "nap": item.is_nap or None,
                }
            )
            for item in sleep
        ],
        "activities": [
            _without_nulls(
                {
                    "id": item.id,
                    "date": item.start_time.isoformat(),
                    "sport": str(item.sport),
                    "title": item.title,
                    "km": (
                        round(item.distance_m / 1_000, 2) if item.distance_m is not None else None
                    ),
                    "min": round(item.elapsed_time_s / 60, 1)
                    if item.elapsed_time_s is not None
                    else None,
                    "pace_s_km": _pace_s_km(item.avg_speed_mps),
                    "hr": item.avg_hr_bpm,
                    "max_hr": item.max_hr_bpm,
                    "cadence": item.avg_cadence,
                    "power": item.avg_power_w,
                    "load": item.training_load_vendor,
                    "drift": round(item.cardiac_drift_pct_app, 1)
                    if item.cardiac_drift_pct_app is not None
                    else None,
                    "elev_gain_m": round(item.elevation_gain_m)
                    if item.elevation_gain_m is not None
                    else None,
                }
            )
            for item in activities
        ],
    }


async def _scheduled_workout_details(db: Any, date: dt.date) -> dict[str, Any]:
    from src.api.routes.training_plan_routes import fetch_coros_calendar

    workouts = await fetch_coros_calendar(date, date, db)
    return {
        "source": "coros",
        "date": date.isoformat(),
        "workouts": [
            {
                "id": workout.uid,
                "title": workout.summary,
                "sport": workout.event_type,
                "description": workout.description or None,
                "steps": [step.model_dump(exclude_none=True) for step in workout.workout_steps],
            }
            for workout in workouts
        ],
    }


async def _activities(db: Any, user_id: str, arguments: dict[str, Any]) -> dict[str, Any]:
    start, end = _date(arguments["start_date"]), _date(arguments["end_date"])
    limit = arguments.get("limit", 20)
    if end < start or (end - start).days > 90 or not 1 <= limit <= 50:
        return {"error": "date range must be 0-90 days and limit must be 1-50"}
    stmt = (
        select(Activity)
        .where(
            Activity.user_id == user_id,
            Activity.start_time >= dt.datetime.combine(start, dt.time.min),
            Activity.start_time < dt.datetime.combine(end + dt.timedelta(days=1), dt.time.min),
        )
        .order_by(Activity.start_time.desc())
        .limit(limit)
    )
    try:
        sport = _sport_type(arguments.get("sport"))
    except ValueError:
        return {
            "error": (
                "sport must be run, trail_run, ride, swim, walk, hike, strength, "
                "multisport, or other"
            )
        }
    if sport is not None:
        stmt = stmt.where(Activity.sport == sport)
    rows = (await db.execute(stmt)).scalars().all()
    return {
        "range": f"{start}/{end}",
        "activities": [
            {
                "id": a.id,
                "date": a.start_time.date().isoformat(),
                "sport": str(a.sport),
                "title": a.title,
                "km": round(a.distance_m / 1000, 2) if a.distance_m else None,
                "min": round(a.elapsed_time_s / 60, 1) if a.elapsed_time_s else None,
                "pace_s_km": _pace_s_km(a.avg_speed_mps),
                "hr": a.avg_hr_bpm,
                "load": a.training_load_vendor,
                "drift": a.cardiac_drift_pct_app,
            }
            for a in rows
        ],
    }


async def _activity_detail(db: Any, user_id: str, activity_id: str) -> dict[str, Any]:
    activity = (
        await db.execute(
            select(Activity).where(Activity.id == activity_id, Activity.user_id == user_id)
        )
    ).scalar_one_or_none()
    if not activity:
        return {"error": "activity not found"}
    laps = (
        (
            await db.execute(
                select(ActivityLap)
                .where(ActivityLap.activity_id == activity_id)
                .order_by(ActivityLap.lap_index)
            )
        )
        .scalars()
        .all()
    )
    return {
        "activity": {
            "id": activity.id,
            "date": activity.start_time.isoformat(),
            "sport": str(activity.sport),
            "title": activity.title,
            "km": round(activity.distance_m / 1000, 2) if activity.distance_m else None,
            "min": round(activity.elapsed_time_s / 60, 1) if activity.elapsed_time_s else None,
            "pace_s_km": _pace_s_km(activity.avg_speed_mps),
            "hr": activity.avg_hr_bpm,
            "max_hr": activity.max_hr_bpm,
            "cadence": activity.avg_cadence,
            "power": activity.avg_power_w,
            "norm_power": activity.normalized_power_w,
            "load": activity.training_load_vendor,
            "drift": activity.cardiac_drift_pct_app,
            "elev_gain_m": activity.elevation_gain_m,
            "elev_loss_m": activity.elevation_loss_m,
            **({"note": activity.activity_note} if activity.activity_note else {}),
        },
        "laps": [
            {
                "n": lap.lap_index,
                "sec": round(lap.elapsed_s),
                "m": round(lap.distance_m) if lap.distance_m else None,
                "pace_s_km": _pace_s_km(lap.avg_speed_mps),
                "hr": lap.avg_hr_bpm,
                "max_hr": lap.max_hr_bpm,
                "cadence": lap.avg_cadence,
                "power": lap.avg_power_w,
                "trigger": lap.lap_trigger,
            }
            for lap in laps
        ],
    }


async def _fitness_history(db: Any, user_id: str, days: int) -> dict[str, Any]:
    if days not in _FITNESS_DAYS:
        return {"error": "days must be 28, 56, 90, or 180"}
    since = dt.date.today() - dt.timedelta(days=days)
    rows = (
        (
            await db.execute(
                select(FitnessEstimate)
                .where(FitnessEstimate.user_id == user_id, FitnessEstimate.date >= since)
                .order_by(FitnessEstimate.date)
            )
        )
        .scalars()
        .all()
    )
    return {
        "since": since.isoformat(),
        "fitness": [
            {
                "date": item.date.isoformat(),
                "vo2max": item.vo2max_vendor,
                "threshold_hr": item.lactate_threshold_hr,
                "threshold_pace_s_km": item.lactate_threshold_pace_s_per_km,
                "ftp": item.ftp_vendor,
                "run_fitness": item.running_fitness_score,
                "pred_5k_s": item.race_pred_5k_s,
                "pred_half_s": item.race_pred_half_s,
            }
            for item in rows
        ],
    }


async def _past_race_goals(db: Any, user_id: str) -> dict[str, Any]:
    """Return every saved race whose Bangkok race date has passed."""
    today = dt.datetime.now(_USER_TZ).date()
    rows = (
        (
            await db.execute(
                select(Goal)
                .where(Goal.user_id == user_id, Goal.goal_race_date < today)
                .order_by(Goal.goal_race_date.desc())
            )
        )
        .scalars()
        .all()
    )
    return {
        "as_of": today.isoformat(),
        "races": [
            _without_nulls(
                {
                    "id": goal.id,
                    "race": goal.goal_race_name,
                    "date": goal.goal_race_date.isoformat(),
                    "target_time": goal.goal_target_time,
                    "result_time": goal.goal_result_time,
                    "notes": goal.goal_description,
                    "race_notes": goal.goal_race_note,
                    "weekly_training_hours": goal.weekly_training_hours,
                    "active": goal.is_active,
                }
            )
            for goal in rows
        ],
    }
