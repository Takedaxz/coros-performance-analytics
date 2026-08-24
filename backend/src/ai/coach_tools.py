"""Read-only, owner-scoped data tools for AI Coach."""

import asyncio
import datetime as dt
import re
from collections.abc import Callable
from concurrent.futures import TimeoutError as FutureTimeoutError
from difflib import SequenceMatcher
from typing import Any, Literal, NotRequired
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from pydantic import ValidationError
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
    ActivityRecord,
    DailyHealth,
    FitnessEstimate,
    Goal,
    SleepSession,
    SportType,
)

_TREND_DAYS = frozenset({7, 14, 28, 56})
_FITNESS_DAYS = frozenset({28, 56, 90, 180})
MAX_TOOL_CALLS = 4
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
CalendarChangeAction = Literal["create", "update", "move", "delete"]
_COROS_EVENT_UID = r"coros:[^:]+:[^:]+:\d{8}"


class ToolCallRecord(TypedDict):
    name: str
    arguments: dict[str, Any]
    display_arguments: NotRequired[dict[str, Any]]
    display_result: NotRequired[dict[str, Any]]


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

    def search_strength_exercises(names: list[str]) -> dict[str, Any]:
        """Find up to five COROS strength-catalog matches for each requested movement name."""
        return run("search_strength_exercises", names=names)

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

    # Import after AI initialization to avoid the routes package's AI import cycle.
    from src.api.routes.training_plan_routes import CorosWorkoutDraft

    def propose_create_calendar_workout(draft: CorosWorkoutDraft) -> dict[str, Any]:
        """Prepare a new COROS workout (keep description concise, max 200 chars, only a few words)."""
        return _calendar_change_proposal("create", draft=draft.model_dump())

    def propose_update_calendar_workout(
        uid: str, draft: CorosWorkoutDraft
    ) -> dict[str, Any]:
        """Prepare an edit to a COROS workout (keep description concise, max 200 chars, only a few words)."""
        return _calendar_change_proposal("update", draft=draft.model_dump(), uid=uid)

    def propose_move_calendar_workout(uid: str, date: str) -> dict[str, Any]:
        """Prepare moving one COROS workout identified by a calendar UID."""
        return _calendar_change_proposal("move", uid=uid, date=date)

    def propose_delete_calendar_workout(uid: str) -> dict[str, Any]:
        """Prepare deleting one COROS workout identified by a calendar UID."""
        return _calendar_change_proposal("delete", uid=uid)

    return [
        get_health_trend,
        get_activities,
        get_activity_detail,
        compare_activities,
        get_training_plan,
        get_scheduled_workout_details,
        search_strength_exercises,
        get_fitness_history,
        get_past_race_goals,
        search_coaching_knowledge,
        web_search,
        propose_create_calendar_workout,
        propose_update_calendar_workout,
        propose_move_calendar_workout,
        propose_delete_calendar_workout,
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


def _calendar_change_proposal(
    action: CalendarChangeAction,
    draft: dict[str, Any] | None = None,
    uid: str | None = None,
    date: str | None = None,
) -> dict[str, Any]:
    """Validate a calendar write without performing it."""
    if action in {"update", "move", "delete"} and (
        not isinstance(uid, str) or re.fullmatch(_COROS_EVENT_UID, uid) is None
    ):
        return {"error": "uid must be a COROS calendar event returned by get_training_plan"}
    if action in {"create", "update"}:
        # Avoid importing the routes package during AI module initialization.
        from src.api.routes.training_plan_routes import CorosWorkoutDraft, _build_coros_program

        try:
            workout = CorosWorkoutDraft.model_validate(draft)
        except ValidationError as exc:
            return {"error": f"invalid workout draft: {exc.errors()[0]['msg']}"}
        if workout.sport == "swim" and workout.pool_length_m is None:
            return {"error": "pool_length_m is required for a pool swim workout."}
        repeat_error = _repeat_group_error(workout)
        if repeat_error:
            return {"error": repeat_error}
        try:
            _build_coros_program(workout)
        except HTTPException as exc:
            return {"error": f"invalid workout draft: {exc.detail}"}
        return {
            "pending_confirmation": True,
            "action": action,
            "summary": f"{action.title()} {workout.name} on {workout.date}",
        }
    if action == "move":
        try:
            target_date = _date(date or "")
        except ValueError:
            return {"error": "date must be a real YYYY-MM-DD value"}
        return {
            "pending_confirmation": True,
            "action": action,
            "summary": f"Move workout to {target_date.isoformat()}",
        }
    return {"pending_confirmation": True, "action": action, "summary": "Delete scheduled workout"}


def _repeat_group_error(workout: Any) -> str | None:
    repeated_steps = [
        step for step in workout.steps if step.repeats > 1 and step.repeat_group is None
    ]
    if repeated_steps:
        return "Repeated steps must use repeat_group/repeat_count with a rest step."

    groups: dict[int, list[Any]] = {}
    for step in workout.steps:
        if step.repeat_group is not None:
            groups.setdefault(step.repeat_group, []).append(step)
    for steps in groups.values():
        counts = {step.repeat_count for step in steps}
        if len(steps) < 2 or not any(step.kind == "rest" for step in steps) or len(counts) != 1:
            return "Each repeat group must contain a rest step and one shared repeat_count."
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
        if name == "search_strength_exercises":
            names = arguments.get("names")
            if (
                not isinstance(names, list)
                or not 1 <= len(names) <= 10
                or any(
                    not isinstance(item, str) or not 2 <= len(item.strip()) <= 80
                    for item in names
                )
            ):
                return {
                    "error": "names must contain 1 to 10 movement names, each 2 to 80 characters"
                }
            return await _strength_exercise_matches(db, [item.strip() for item in names])
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


def _exercise_match_name(row: dict[str, object]) -> str | None:
    for key in ("overview", "displayName", "exerciseName", "nameText", "name"):
        value = row.get(key)
        if not isinstance(value, str) or not value.strip():
            continue
        name = re.sub(r"^sid_[a-z]+_", "", value.strip(), flags=re.IGNORECASE)
        return name.replace("_", " ").title()
    return None


def _normalised_exercise_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def _strength_match_score(query: str, exercise: dict[str, str]) -> tuple[int, str]:
    normalised_name = _normalised_exercise_name(exercise["name"])
    if normalised_name == query:
        relevance = 1_000
    elif query in normalised_name or normalised_name in query:
        relevance = 800
    else:
        relevance = round(SequenceMatcher(None, query, normalised_name).ratio() * 100)
    return relevance, exercise["name"].lower()


def _rank_strength_exercises(catalog: object, names: list[str]) -> dict[str, Any]:
    from src.api.routes.training_plan_routes import _exercise_catalog_rows

    exercises: dict[str, dict[str, str]] = {}
    for row in _exercise_catalog_rows(catalog):
        display_name = _exercise_match_name(row)
        exercise_code = row.get("name")
        exercise_id = next(
            (str(row[key]) for key in ("exerciseId", "originId", "id") if row.get(key) is not None),
            None,
        )
        if (
            display_name is None
            or not isinstance(exercise_code, str)
            or not exercise_code.strip()
            or exercise_id is None
        ):
            continue
        exercises.setdefault(
            exercise_id,
            {
                "name": display_name,
                "exercise_code": exercise_code.strip(),
                "exercise_id": exercise_id,
            },
        )

    results: list[dict[str, Any]] = []
    for query in names:
        normalised_query = _normalised_exercise_name(query)
        matches = sorted(
            exercises.values(),
            key=lambda exercise: (
                -_strength_match_score(normalised_query, exercise)[0],
                _strength_match_score(normalised_query, exercise)[1],
            ),
        )[:5]
        results.append({"query": query, "matches": matches})
    return {"matches": results}


async def _strength_exercise_matches(db: Any, names: list[str]) -> dict[str, Any]:
    from src.api.routes.training_plan_routes import _coros_client
    from src.sync.api_client import CorosApiClientError

    try:
        catalog = await (await _coros_client(db)).get_training_hub(
            "/training/exercise/query", {"sportType": 4, "keyword": ""}
        )
    except CorosApiClientError as exc:
        return {"error": f"COROS exercise catalog unavailable: {exc}"}
    return _rank_strength_exercises(catalog, names)


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

    records = (
        (
            await db.execute(
                select(ActivityRecord)
                .where(ActivityRecord.activity_id == activity_id)
                .order_by(ActivityRecord.timestamp.asc())
            )
        )
        .scalars()
        .all()
    )

    km_splits: list[dict[str, Any]] = []
    if records:
        valid_recs = [r for r in records if r.distance_m is not None]
        if valid_recs:
            start_rec = valid_recs[0]
            accum_hrs: list[int] = []
            accum_powers: list[int] = []
            accum_cadences: list[int] = []
            km_counter = 1

            for i, r in enumerate(valid_recs):
                if r.heart_rate_bpm:
                    accum_hrs.append(r.heart_rate_bpm)
                if r.power_w:
                    accum_powers.append(r.power_w)
                if r.cadence:
                    accum_cadences.append(r.cadence)

                dist_covered = (r.distance_m or 0) - (start_rec.distance_m or 0)
                is_last = i == len(valid_recs) - 1

                if dist_covered >= 1000.0 or (is_last and dist_covered > 50):
                    time_diff_s = (r.timestamp - start_rec.timestamp).total_seconds()
                    if time_diff_s > 0:
                        avg_speed = dist_covered / time_diff_s
                        avg_hr = round(sum(accum_hrs) / len(accum_hrs)) if accum_hrs else None
                        avg_pwr = (
                            round(sum(accum_powers) / len(accum_powers)) if accum_powers else None
                        )
                        avg_cad = (
                            round(sum(accum_cadences) / len(accum_cadences))
                            if accum_cadences
                            else None
                        )
                        elev_delta = (
                            round(r.altitude_m - start_rec.altitude_m)
                            if (r.altitude_m is not None and start_rec.altitude_m is not None)
                            else None
                        )

                        km_splits.append(
                            {
                                "km": km_counter,
                                "sec": round(time_diff_s),
                                "m": round(dist_covered),
                                "pace_s_km": _pace_s_km(avg_speed),
                                "hr": avg_hr,
                                "cadence": avg_cad,
                                "power": avg_pwr,
                                "elev_delta_m": elev_delta,
                            }
                        )
                        km_counter += 1
                        start_rec = r
                        accum_hrs = []
                        accum_powers = []
                        accum_cadences = []

    return {
        "activity": {
            "id": activity.id,
            "date": activity.start_time.isoformat(),
            "sport": str(activity.sport),
            "title": activity.title,
            "km": round(activity.distance_m / 1000, 2) if getattr(activity, "distance_m", None) else None,
            "min": round(activity.elapsed_time_s / 60, 1) if getattr(activity, "elapsed_time_s", None) else None,
            "pace_s_km": _pace_s_km(getattr(activity, "avg_speed_mps", None)),
            "hr": getattr(activity, "avg_hr_bpm", None),
            "max_hr": getattr(activity, "max_hr_bpm", None),
            "cadence": getattr(activity, "avg_cadence", None),
            "power": getattr(activity, "avg_power_w", None),
            "max_power": getattr(activity, "max_power_w", None),
            "norm_power": getattr(activity, "normalized_power_w", None),
            "load": getattr(activity, "training_load_vendor", None),
            "drift": getattr(activity, "cardiac_drift_pct_app", None),
            "efficiency_factor": getattr(activity, "efficiency_factor_app", None),
            "te_aerobic": getattr(activity, "training_effect_aerobic_vendor", None),
            "te_anaerobic": getattr(activity, "training_effect_anaerobic_vendor", None),
            "elev_gain_m": getattr(activity, "elevation_gain_m", None),
            "elev_loss_m": getattr(activity, "elevation_loss_m", None),
            **({"note": activity.activity_note} if getattr(activity, "activity_note", None) else {}),
        },
        "laps": [
            {
                "n": lap.lap_index,
                "sec": round(lap.elapsed_s),
                "m": round(lap.distance_m) if getattr(lap, "distance_m", None) else None,
                "pace_s_km": _pace_s_km(getattr(lap, "avg_speed_mps", None)),
                "hr": getattr(lap, "avg_hr_bpm", None),
                "max_hr": getattr(lap, "max_hr_bpm", None),
                "cadence": getattr(lap, "avg_cadence", None),
                "power": getattr(lap, "avg_power_w", None),
                "trigger": getattr(lap, "lap_trigger", None),
            }
            for lap in laps
        ],
        "km_splits": km_splits,
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
                    "race_tier": goal.goal_race_tier,
                    "weekly_training_hours": goal.weekly_training_hours,
                    "active": goal.is_active,
                }
            )
            for goal in rows
        ],
    }
