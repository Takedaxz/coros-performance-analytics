"""Context builder for AI insights."""

import datetime
import math
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.activity_laps import distance_splits, hyrox_lap_detail, lap_type, swim_lap_name
from src.db.models import (
    Activity,
    ActivityLap,
    ActivityRecord,
    DailyFeeling,
    DailyHealth,
    FitnessEstimate,
    Goal,
    SleepSession,
    User,
)

_USER_TZ = ZoneInfo("Asia/Bangkok")  # UTC+7
_DETAIL_CONTEXT_CHAR_BUDGET = 40_000
_RACE_TIER_LABELS = {
    "A": "primary race",
    "B": "important race",
    "C": "supporting race",
    "D": "training race",
    "E": "low-priority race",
}
_STRENGTH_REGION_NAMES = {
    "S4208": "Full Body",
    "S4209": "Shoulders",
    "S4210": "Arms",
    "S4211": "Chest",
    "S4212": "Back",
    "S4213": "Abs",
    "S4214": "Legs & Hips",
}


def _today_local() -> datetime.date:
    """Return today's date in the athlete's local timezone (Asia/Bangkok, UTC+7)."""
    return datetime.datetime.now(_USER_TZ).date()


def _now_local() -> datetime.datetime:
    """Return current datetime in the athlete's local timezone."""
    return datetime.datetime.now(_USER_TZ)


def _format_duration(seconds: float | None) -> str | None:
    if seconds is None or seconds < 0:
        return None
    rounded = round(seconds)
    hours, remainder = divmod(rounded, 3600)
    minutes, secs = divmod(remainder, 60)
    return f"{hours}:{minutes:02d}:{secs:02d}" if hours else f"{minutes}:{secs:02d}"


def _format_pace(speed_mps: float | None, distance_m: int = 1_000) -> str | None:
    if speed_mps is None or speed_mps <= 0:
        return None
    seconds = distance_m / speed_mps
    minutes, secs = divmod(round(seconds), 60)
    unit = f"{distance_m}m" if distance_m < 1_000 else "km"
    return f"{minutes}:{secs:02d}/{unit}"


def _format_personal_records(preferences: dict[object, object] | None) -> str:
    """Format COROS personal records for coach context across 4 weeks, 12 weeks, half year, and all time."""
    if not isinstance(preferences, dict):
        return ""
    raw_groups = preferences.get("coros_personal_record_groups")
    if not isinstance(raw_groups, list):
        return ""

    groups_by_type = {
        group_type: group
        for group in raw_groups
        if isinstance(group, dict)
        and (group_type := group.get("type")) in {1, 2, 3, 4}
    }
    lines: list[str] = []
    for group_type, label in ((1, "4 weeks"), (3, "12 weeks"), (2, "Half year"), (4, "All time")):
        group = groups_by_type.get(group_type)
        records = group.get("records") if isinstance(group, dict) else None
        if not isinstance(records, list):
            continue
        formatted_records = []
        for record in records:
            if not isinstance(record, dict):
                continue
            name = record.get("label")
            duration = _format_duration(_json_number(record.get("duration_s")))
            pace_seconds = _json_number(record.get("pace_s_per_km"))
            pace = _format_duration(pace_seconds)
            date = record.get("date")
            if not isinstance(name, str) or duration is None:
                continue
            details = [duration]
            if pace is not None:
                details.append(f"{pace}/km")
            if isinstance(date, str):
                details.append(date[:10])
            formatted_records.append(f"{name}: {', '.join(details)}")
        if formatted_records:
            lines.append(f"- **{label}:** {'; '.join(formatted_records)}")

    if not lines:
        return ""
    return "\n".join(
        [
            "#### COROS Personal Records",
            *lines,
            "- **Interpretation:** These are best elapsed times within each window, not "
            "verified race performances. A personal record without a "
            "sustained matching-distance effort may include recovery, rest, or normal "
            "jogging; do not treat it as current race fitness. Cross-check recent "
            "continuous hard sessions and HR before using any record to set training "
            "or race paces.",
        ]
    )


def _metric(label: str, value: str | int | float | None) -> str | None:
    return f"{label}={value}" if value is not None else None


def _activity_sport(activity: Activity) -> str:
    return activity.sport.value if hasattr(activity.sport, "value") else str(activity.sport)


def _activity_header(index: int, activity: Activity) -> str:
    sport = _activity_sport(activity)
    pace = _format_pace(activity.avg_speed_mps, 100 if sport == "swim" else 1_000)
    metrics = [
        _metric("dur", _format_duration(activity.elapsed_time_s)),
        _metric("dist", f"{activity.distance_m / 1_000:.2f}km" if activity.distance_m else None),
        _metric("kcal", activity.calories_kcal),
        _metric(
            "hr",
            f"{activity.avg_hr_bpm}/{activity.max_hr_bpm}"
            if activity.avg_hr_bpm and activity.max_hr_bpm
            else activity.avg_hr_bpm,
        ),
        _metric("pace", pace),
        _metric(
            "power",
            f"{activity.avg_power_w}/{activity.max_power_w}W"
            if activity.avg_power_w and activity.max_power_w
            else f"{activity.avg_power_w}W" if activity.avg_power_w else None,
        ),
        _metric(
            "cad",
            f"{activity.avg_cadence}/{activity.max_cadence}spm"
            if activity.avg_cadence and activity.max_cadence
            else f"{activity.avg_cadence}spm" if activity.avg_cadence else None,
        ),
        _metric("elev", f"+{activity.elevation_gain_m:.0f}/-{activity.elevation_loss_m:.0f}m"
                if activity.elevation_gain_m is not None and activity.elevation_loss_m is not None
                else None),
        _metric("load", activity.training_load_vendor),
    ]
    title = activity.title or sport.replace("_", " ").title()
    return (
        f"[A{index}] {activity.start_time:%Y-%m-%d %H:%M} | {title}/{sport} | "
        + " ".join(metric for metric in metrics if metric)
    )


def _lap_label(lap: ActivityLap) -> tuple[str, str | None]:
    station_name, load_unit = hyrox_lap_detail(lap.lap_trigger)
    if station_name:
        return station_name, load_unit
    stroke_name = swim_lap_name(lap.lap_trigger)
    if stroke_name:
        return stroke_name, None
    workout_step = lap_type(lap.lap_trigger)
    if workout_step:
        return workout_step.replace("_", " ").title(), None
    if lap.lap_trigger and lap.lap_trigger.startswith("triathlon_"):
        return lap.lap_trigger.removeprefix("triathlon_").replace("_", " ").title(), None
    return "Lap", None


def _lap_line(lap: ActivityLap, sport: str) -> str:
    label, load_unit = _lap_label(lap)
    is_functional = load_unit is not None
    pace = None if is_functional else _format_pace(
        lap.avg_speed_mps,
        100 if sport == "swim" else 1_000,
    )
    load = None
    distance = None
    if lap.distance_m:
        if load_unit == "reps":
            load = f"{lap.distance_m:.0f}reps"
        elif load_unit == "m":
            load = f"{lap.distance_m:.0f}m"
        else:
            distance = (
                f"{lap.distance_m:.0f}m"
                if sport == "swim"
                else f"{lap.distance_m / 1_000:.2f}km"
            )
    metrics = [
        _metric("dur", _format_duration(lap.elapsed_s)),
        _metric("load", load),
        _metric("dist", distance),
        _metric("pace", pace),
        _metric(
            "hr",
            f"{lap.avg_hr_bpm}/{lap.max_hr_bpm}"
            if lap.avg_hr_bpm and lap.max_hr_bpm
            else lap.avg_hr_bpm,
        ),
        _metric("power", f"{lap.avg_power_w}W" if lap.avg_power_w else None),
        _metric("cad", f"{lap.avg_cadence}spm" if lap.avg_cadence else None),
        _metric("kcal", lap.calories_kcal),
    ]
    return f"{lap.lap_index} {label} | " + " ".join(metric for metric in metrics if metric)


def _json_number(value: object) -> float | None:
    return float(value) if isinstance(value, int | float) and not isinstance(value, bool) else None


def _strength_lines(detail: dict[object, object] | None) -> list[str]:
    if not isinstance(detail, dict):
        return []
    exercises = detail.get("exercises_detail")
    if not isinstance(exercises, list):
        return []
    lines = ["strength sets:"]
    for exercise_index, exercise in enumerate(exercises, 1):
        if not isinstance(exercise, dict):
            continue
        raw_name = exercise.get("name")
        name_key = exercise.get("name_key")
        name = (
            raw_name
            if isinstance(raw_name, str) and raw_name and not raw_name.startswith(("S", "T"))
            else _STRENGTH_REGION_NAMES.get(str(name_key), str(name_key or "Exercise"))
        )
        entries = exercise.get("entries")
        entry_parts: list[str] = []
        if isinstance(entries, list):
            for set_index, entry in enumerate(entries, 1):
                if not isinstance(entry, dict):
                    continue
                reps = _json_number(entry.get("reps"))
                weight = _json_number(entry.get("weight_kg"))
                work = _json_number(entry.get("work_s"))
                rest = _json_number(entry.get("rest_s"))
                calories = _json_number(entry.get("calories"))
                set_metrics = [
                    f"{reps:.0f}x{weight:g}kg" if reps is not None and weight else f"{reps:.0f}reps"
                    if reps is not None else None,
                    f"work={_format_duration(work)}" if work is not None else None,
                    f"rest={_format_duration(rest)}" if rest else None,
                    f"kcal={calories:.0f}" if calories is not None else None,
                ]
                entry_parts.append(
                    f"s{set_index} " + " ".join(metric for metric in set_metrics if metric)
                )
        lines.append(f"{exercise_index} {name} | " + "; ".join(entry_parts))
    return lines if len(lines) > 1 else []


def _split_lines(
    activity: Activity,
    laps: list[ActivityLap],
    records: list[ActivityRecord],
) -> list[str]:
    sport = _activity_sport(activity)
    chunk_distance = 1_000 if sport in {"run", "trail_run"} else 20 if sport == "swim" else None
    if chunk_distance is None or not records:
        return []
    useful_laps = [lap for lap in laps if lap.distance_m and lap.distance_m > 0]
    has_long_lap = any(
        (lap.distance_m or 0) > chunk_distance * 1.25 for lap in useful_laps
    )
    if useful_laps and not has_long_lap:
        return []
    source_lap_distances = [float(lap.distance_m) for lap in useful_laps]
    source_lap_start_elapsed = None
    if sport == "swim":
        elapsed_before_lap = 0.0
        source_lap_start_elapsed = []
        for lap in laps:
            if lap.distance_m and lap.distance_m > 0:
                source_lap_start_elapsed.append(elapsed_before_lap)
            elapsed_before_lap += lap.elapsed_s
    splits = distance_splits(
        records,
        chunk_distance,
        source_lap_distances or None,
        source_lap_start_elapsed,
    )
    if not splits:
        return []
    lines = [f"phase distance splits ({chunk_distance:.0f}m):"]
    current_source_lap: int | None = None
    phase_split_index = 0
    for index, split in enumerate(splits, 1):
        source_lap_index = split.get("source_lap_index")
        if isinstance(source_lap_index, int) and source_lap_index != current_source_lap:
            current_source_lap = source_lap_index
            phase_split_index = 0
            if 0 <= source_lap_index < len(useful_laps):
                label, _ = _lap_label(useful_laps[source_lap_index])
                lines.append(f"phase {source_lap_index + 1} {label}:")
            else:
                lines.append(f"phase {source_lap_index + 1}:")
        phase_split_index += 1
        speed = split.get("avg_speed_mps")
        distance = split.get("distance_m")
        elapsed = split.get("elapsed_s")
        metrics = [
            _metric("dur", _format_duration(float(elapsed)) if elapsed is not None else None),
            _metric("dist", f"{float(distance):.0f}m" if distance is not None else None),
            _metric("pace", _format_pace(float(speed), 100 if sport == "swim" else 1_000)
                    if speed is not None else None),
            _metric("hr", split.get("avg_hr_bpm")),
            _metric("power", f"{split['avg_power_w']}W" if split.get("avg_power_w") else None),
            _metric("cad", f"{split['avg_cadence']}spm" if split.get("avg_cadence") else None),
        ]
        split_index = phase_split_index if current_source_lap is not None else index
        lines.append(f"  {split_index} | " + " ".join(metric for metric in metrics if metric))
    return lines


def _telemetry_line(activity: Activity, records: list[ActivityRecord]) -> str | None:
    timed = [record for record in records if record.elapsed_s is not None]
    if not timed:
        return None
    duration = max(record.elapsed_s or 0 for record in timed)
    if duration <= 0:
        return None
    sport = _activity_sport(activity)
    windows: list[str] = []
    for window_index in range(6):
        start = duration * window_index / 6
        end = duration * (window_index + 1) / 6
        window = [
            record
            for record in timed
            if start <= (record.elapsed_s or 0) <= end
            and (window_index == 5 or (record.elapsed_s or 0) < end)
        ]
        if not window:
            continue
        heart_rates = [record.heart_rate_bpm for record in window if record.heart_rate_bpm]
        speeds = [
            record.speed_mps
            for record in window
            if record.speed_mps and record.speed_mps > 0
        ]
        powers = [record.power_w for record in window if record.power_w and record.power_w > 0]
        cadences = [record.cadence for record in window if record.cadence and record.cadence > 0]
        speed = sum(speeds) / len(speeds) if speeds else None
        metrics = [
            _metric("hr", f"{round(sum(heart_rates) / len(heart_rates))}/{max(heart_rates)}"
                    if heart_rates else None),
            _metric(
                "pace" if sport in {"run", "trail_run", "swim"} else "speed",
                _format_pace(speed, 100 if sport == "swim" else 1_000)
                if sport in {"run", "trail_run", "swim"}
                else f"{speed * 3.6:.1f}km/h" if speed else None,
            ),
            _metric(
                "power",
                f"{round(sum(powers) / len(powers))}/{max(powers)}W" if powers else None,
            ),
            _metric("cad", f"{round(sum(cadences) / len(cadences))}/{max(cadences)}spm"
                    if cadences else None),
        ]
        windows.append(
            f"{_format_duration(start)}-{_format_duration(end)} "
            + " ".join(metric for metric in metrics if metric)
        )
    return "telemetry(average/peak): " + "; ".join(windows) if windows else None


def _haversine_m(
    first: tuple[float, float],
    second: tuple[float, float],
) -> float:
    lat1, lon1 = map(math.radians, first)
    lat2, lon2 = map(math.radians, second)
    delta_lat = lat2 - lat1
    delta_lon = lon2 - lon1
    value = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lon / 2) ** 2
    )
    return 6_371_000 * 2 * math.atan2(math.sqrt(value), math.sqrt(1 - value))


def _route_line(activity: Activity, records: list[ActivityRecord]) -> str | None:
    points = [
        (record.position_lat, record.position_long)
        for record in records
        if record.position_lat is not None and record.position_long is not None
    ]
    if len(points) < 2:
        return None
    typed_points = [(float(lat), float(lon)) for lat, lon in points]
    latitudes = [point[0] for point in typed_points]
    longitudes = [point[1] for point in typed_points]
    mid_latitude = (min(latitudes) + max(latitudes)) / 2
    width = _haversine_m((mid_latitude, min(longitudes)), (mid_latitude, max(longitudes)))
    height = _haversine_m((min(latitudes), min(longitudes)), (max(latitudes), min(longitudes)))
    gap = _haversine_m(typed_points[0], typed_points[-1])
    loop_limit = max(250, (activity.distance_m or 0) * 0.05)
    shape = "loop" if gap <= loop_limit else "point-to-point"
    altitudes = [record.altitude_m for record in records if record.altitude_m is not None]
    altitude = f" alt={min(altitudes):.0f}-{max(altitudes):.0f}m" if altitudes else ""
    return (
        f"route: gps_points={len(points)} shape={shape} "
        f"span={width / 1_000:.2f}x{height / 1_000:.2f}km start_end={gap:.0f}m{altitude}"
    )


def _format_detailed_activity_context(
    activities: list[Activity],
    laps_by_activity: dict[str, list[ActivityLap]],
    records_by_activity: dict[str, list[ActivityRecord]],
    char_budget: int = _DETAIL_CONTEXT_CHAR_BUDGET,
) -> str:
    header = [
        "#### Detailed Activity Execution",
        "Legend: hr=average/maximum bpm; power=average/maximum; "
        "cad=average/maximum; telemetry windows=average/peak.",
    ]
    blocks: list[tuple[list[str], list[str]]] = []
    for activity_index, activity in enumerate(activities, 1):
        sport = _activity_sport(activity)
        laps = laps_by_activity.get(activity.id, [])
        records = records_by_activity.get(activity.id, [])
        required = [_activity_header(activity_index, activity)]
        if laps:
            required.append("segments/splits:")
            required.extend(_lap_line(lap, sport) for lap in laps)
        required.extend(_strength_lines(activity.strength_detail))
        required.extend(_split_lines(activity, laps, records))
        optional = [
            line
            for line in (_telemetry_line(activity, records), _route_line(activity, records))
            if line
        ]
        blocks.append((required, optional))

    required_chars = len("\n".join(header)) + sum(
        len("\n".join(required)) + 2 for required, _ in blocks
    )
    remaining = max(0, char_budget - required_chars)
    selected_optional: list[list[str]] = []
    omitted = 0
    for _, optional in blocks:
        selected: list[str] = []
        for line in optional:
            cost = len(line) + 1
            if cost <= remaining:
                selected.append(line)
                remaining -= cost
            else:
                omitted += 1
        selected_optional.append(selected)

    output = list(header)
    for (required, _), optional in zip(blocks, selected_optional, strict=True):
        output.append("")
        output.extend(required)
        output.extend(optional)
    if omitted:
        output.append(
            f"\nDetail budget omitted {omitted} telemetry/route line(s); "
            "all structured rows remain."
        )
    return "\n".join(output)


async def _fetch_user_goal(db: AsyncSession, user_id: str) -> str:
    """Return a markdown string describing user goals and profile, or empty string."""
    from sqlalchemy import select as sa_select
    import datetime as _dt

    res = await db.execute(sa_select(User).where(User.id == user_id))
    user = res.scalar_one_or_none()
    if not user:
        return ""
    parts: list[str] = []

    # Biometrics & Profile
    profile_parts = []
    if user.first_name or user.last_name or user.nickname:
        name = " ".join(filter(None, [user.first_name, user.last_name]))
        if user.nickname:
            name += f" ({user.nickname})"
        profile_parts.append(f"**Name:** {name.strip()}")
    if user.birthdate:
        age = (_dt.date.today() - user.birthdate).days // 365
        profile_parts.append(f"**Age:** {age} ({user.birthdate.isoformat()})")
    if user.height_cm:
        profile_parts.append(f"**Height:** {user.height_cm} cm")
    if user.weight_kg:
        profile_parts.append(f"**Weight:** {user.weight_kg} kg")
    if user.body_fat_pct:
        profile_parts.append(f"**Body Fat:** {user.body_fat_pct}%")

    if profile_parts:
        parts.append("### Athlete Profile\n" + "\n".join(profile_parts) + "\n")

    if user.training_notes and user.training_notes.strip():
        parts.append(
            "### Personal Training Notes (User Preferences & Constraints)\n"
            "> The athlete has provided the following personal notes. "
            "Always respect these constraints when generating plans, recommendations, or briefings.\n\n"
            + user.training_notes.strip()
            + "\n"
        )

    training_setup = user.device_preferences.get("ai_training_setup", {}) if user.device_preferences else {}
    if isinstance(training_setup, dict):
        equipment = training_setup.get("gym_equipment")
        preference = training_setup.get("strength_equipment_preference")
        pool_length = training_setup.get("pool_length_m")
        setup_lines: list[str] = []
        if isinstance(equipment, list) and all(isinstance(item, str) for item in equipment) and equipment:
            setup_lines.append(f"**Available gym equipment:** {', '.join(item.replace('_', ' ') for item in equipment)}")
        if preference in {"machines_first", "free_weights_first"}:
            setup_lines.append(f"**Strength preference:** {str(preference).replace('_', ' ')}")
        if isinstance(pool_length, (int, float)) and 10 <= pool_length <= 100:
            setup_lines.append(f"**Default pool length:** {pool_length:g} m")
        if setup_lines:
            parts.append("### Training Setup (User Preferences & Constraints)\n" + "\n".join(setup_lines) + "\n")

    today = _today_local()
    # Goals within the 30-day post-race recovery window are still surfaced to the AI
    # so it can advise on recovery, deload, and next cycle planning.
    recovery_cutoff = today - _dt.timedelta(days=30)

    # Fetch all active goals (upcoming AND those still within the recovery window)
    goals_res = await db.execute(
        sa_select(Goal)
        .where(
            Goal.user_id == user_id,
            Goal.is_active,
        )
        .order_by(Goal.goal_race_date.asc())
    )
    all_active_goals = goals_res.scalars().all()

    # Split: goals with a future/no race date vs. goals whose race was 1–30 days ago
    active_goals = []
    recovery_goals = []
    for g in all_active_goals:
        if g.goal_race_date is None or g.goal_race_date >= today:
            active_goals.append(g)
        elif g.goal_race_date >= recovery_cutoff:
            # Race happened within the last 30 days — keep for recovery context
            recovery_goals.append(g)
        # else: race was >30 days ago — drop from AI context automatically

    if active_goals:
        parts.append("### Athlete Goals")
        parts.append(
            "Race tiers rank priority: A is highest and E is lowest. Use them to resolve "
            "conflicts in training load, taper, recovery, and race scheduling."
        )
        for i, goal in enumerate(active_goals, 1):
            goal_details = []
            if goal.goal_race_name:
                goal_details.append(f"  - **Target Race:** {goal.goal_race_name}")
            if goal.goal_race_date:
                days_to_race = (goal.goal_race_date - today).days
                goal_details.append(
                    f"  - **Race Date:** {goal.goal_race_date.isoformat()} "
                    f"({days_to_race} days away)"
                )
            if goal.goal_target_time:
                goal_details.append(f"  - **Goal Finish Time:** {goal.goal_target_time}")
            if goal.goal_result_time:
                goal_details.append(f"  - **Actual Finish Time:** {goal.goal_result_time}")
            if goal.goal_race_note:
                goal_details.append(f"  - **Race Notes:** {goal.goal_race_note}")
            if goal.goal_race_tier:
                tier_label = _RACE_TIER_LABELS.get(goal.goal_race_tier, "race")
                goal_details.append(f"  - **Race Tier:** {goal.goal_race_tier} ({tier_label})")
            if goal.weekly_training_hours:
                goal_details.append(
                    f"  - **Weekly Training Target:** {goal.weekly_training_hours}h"
                )
            if goal.goal_description:
                goal_details.append(f"  - **Notes:** {goal.goal_description}")

            if goal_details:
                parts.append(f"\n**Goal {i}:**")
                parts.extend(goal_details)

    if recovery_goals:
        parts.append("\n### Recently Completed Race Goals (Post-Race Recovery Window)")
        parts.append(
            "> These races have already taken place. Use this context to guide "
            "post-race recovery, deload planning, and next training cycle recommendations. "
            "Do NOT reference these as upcoming goals — the race is done."
        )
        for goal in recovery_goals:
            days_since = (today - goal.goal_race_date).days
            race_label = goal.goal_race_name or "Race"
            parts.append(f"\n**🏁 {race_label} — Completed {days_since} day(s) ago:**")
            parts.append(
                f"  - **Race Date:** {goal.goal_race_date.isoformat()} "
                f"({days_since} days ago — **COMPLETED**)"
            )
            if goal.goal_target_time:
                parts.append(f"  - **Goal Finish Time:** {goal.goal_target_time}")
            if goal.goal_result_time:
                parts.append(f"  - **Actual Finish Time:** {goal.goal_result_time}")
            if goal.goal_race_note:
                parts.append(f"  - **Race Notes:** {goal.goal_race_note}")
            if goal.goal_race_tier:
                tier_label = _RACE_TIER_LABELS.get(goal.goal_race_tier, "race")
                parts.append(f"  - **Race Tier:** {goal.goal_race_tier} ({tier_label})")
            if goal.weekly_training_hours:
                parts.append(
                    f"  - **Pre-race Weekly Training Target:** {goal.weekly_training_hours}h"
                )
            if goal.goal_description:
                parts.append(f"  - **Notes:** {goal.goal_description}")

    # Target Training Paces
    if user.threshold_pace_s_per_km:
        pace = user.threshold_pace_s_per_km

        def fmt_pace(secs_per_km: float) -> str:
            m = int(secs_per_km // 60)
            s = int(round(secs_per_km % 60))
            if s >= 60:
                m += 1
                s -= 60
            return f"{m}:{s:02d}/km"

        daniels_paces = [
            f"  - **Repetition (@R):** {fmt_pace(pace * 0.85)}",
            f"  - **Interval (@I):** {fmt_pace(pace * 0.93)}",
            f"  - **Threshold (@T):** {fmt_pace(pace)}",
            f"  - **Marathon (@M):** {fmt_pace(pace * 1.15)}",
            f"  - **Easy (@E):** {fmt_pace(pace * 1.25)}"
        ]

        friel_zones = [
            f"  - **Z5c (Anaerobic):** < {fmt_pace(pace * 0.90)}",
            f"  - **Z5a/b (Super-Threshold):** {fmt_pace(pace)} to {fmt_pace(pace * 0.90)}",
            f"  - **Z4 (Threshold):** {fmt_pace(pace * 1.05)} to {fmt_pace(pace)}",
            f"  - **Z3 (Tempo):** {fmt_pace(pace * 1.14)} to {fmt_pace(pace * 1.05)}",
            f"  - **Z2 (Endurance):** {fmt_pace(pace * 1.29)} to {fmt_pace(pace * 1.14)}",
            f"  - **Z1 (Recovery):** > {fmt_pace(pace * 1.29)}"
        ]

        parts.append("\n### Athlete Target Training Paces")
        parts.append("**Daniels' Running Formula:**")
        parts.extend(daniels_paces)
        parts.append("\n**Friel's Triathlete's Training Bible Zones:**")
        parts.extend(friel_zones)

    if not parts:
        return ""

    return "\n".join(parts)

_ICAL_URL = "https://p135-caldav.icloud.com/published/2/MTAzNTc1NTUzNDMxMDM1N4gPI9Eruy25g9v9R_Ci0txlHRMQJW0ifWYN4qF0Rbss"


def _unfold_ical(raw: str) -> str:
    import re
    return re.sub(r"\r?\n[ \t]", "", raw)


def _extract_ical_value(lines: list[str], prop: str) -> str:
    for line in lines:
        if line.startswith(f"{prop}:"):
            return line[len(f"{prop}:"):].strip()
        if line.startswith(f"{prop};"):
            return line.split(":", 1)[-1].strip()
    return ""


def _parse_ical_date(value: str) -> datetime.date | None:
    value = value.split(";")[-1].strip().rstrip("Z")
    try:
        return datetime.date(int(value[:4]), int(value[4:6]), int(value[6:8]))
    except (ValueError, IndexError):
        return None


async def _fetch_plan_events(window_start: datetime.date, window_end: datetime.date) -> list[dict]:
    """Fetch and filter training plan events from the iCal feed."""
    import re
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(_ICAL_URL)
        if resp.status_code != 200:
            return []
    except Exception:
        return []

    raw = _unfold_ical(resp.text)
    events: list[dict] = []

    for block in re.split(r"BEGIN:VEVENT", raw)[1:]:
        end_idx = block.find("END:VEVENT")
        if end_idx == -1:
            continue
        lines = block[:end_idx].strip().splitlines()
        summary = _extract_ical_value(lines, "SUMMARY")
        dtstart_raw = _extract_ical_value(lines, "DTSTART")
        description_raw = _extract_ical_value(lines, "DESCRIPTION")
        if not summary or not dtstart_raw:
            continue
        start_date = _parse_ical_date(dtstart_raw)
        if start_date is None:
            continue
            
        description = ""
        if description_raw:
            description = (
                description_raw.replace("\\n", "\n")
                .replace("\\N", "\n")
                .replace("\\,", ",")
                .replace("\\;", ";")
            )

        if window_start <= start_date <= window_end:
            events.append({
                "date": start_date.isoformat(), 
                "summary": summary,
                "description": description
            })

    events.sort(key=lambda e: e["date"])
    return events


async def build_training_context(
    db: AsyncSession,
    user_id: str,
    days: int = 14,
    include_activity_details: bool = False,
) -> str:
    """Build a markdown string containing recent training context."""
    today = _today_local()
    start_date = today - datetime.timedelta(days=days)

    # 0. Fetch user goal
    goal_section = await _fetch_user_goal(db, user_id)

    # 1. Fetch Daily Health (includes HRV, RHR, Fatigue/Recovery)
    stmt = (
        select(DailyHealth)
        .where(DailyHealth.user_id == user_id)
        .where(DailyHealth.date >= start_date)
        .order_by(DailyHealth.date.asc())
    )
    res = await db.execute(stmt)
    health_records = res.scalars().all()

    feeling_records = list(
        await db.scalars(
            select(DailyFeeling)
            .where(DailyFeeling.user_id == user_id, DailyFeeling.date >= start_date)
            .order_by(DailyFeeling.date.asc())
        )
    )

    # 2. Fetch Sleep (aggregate by day if possible, or just raw sessions)
    start_time = datetime.datetime.combine(start_date, datetime.time.min)
    stmt = (
        select(SleepSession)
        .where(SleepSession.user_id == user_id)
        .where(SleepSession.sleep_start >= start_time)
        .order_by(SleepSession.sleep_start.asc())
    )
    res = await db.execute(stmt)
    sleep_records = res.scalars().all()

    # 3. Fetch Activities
    stmt = (
        select(Activity)
        .where(Activity.user_id == user_id)
        .where(Activity.start_time >= start_time)
        .order_by(Activity.start_time.asc())
    )
    res = await db.execute(stmt)
    activities = res.scalars().all()

    detailed_activity_context = ""
    if include_activity_details and activities:
        activity_ids = [activity.id for activity in activities]
        laps_result = await db.execute(
            select(ActivityLap)
            .where(ActivityLap.activity_id.in_(activity_ids))
            .order_by(ActivityLap.activity_id, ActivityLap.lap_index)
        )
        laps_by_activity: dict[str, list[ActivityLap]] = {}
        for lap in laps_result.scalars():
            laps_by_activity.setdefault(lap.activity_id, []).append(lap)

        records_result = await db.execute(
            select(ActivityRecord)
            .where(ActivityRecord.activity_id.in_(activity_ids))
            .order_by(ActivityRecord.activity_id, ActivityRecord.timestamp)
        )
        records_by_activity: dict[str, list[ActivityRecord]] = {}
        for record in records_result.scalars():
            records_by_activity.setdefault(record.activity_id, []).append(record)

        detailed_activity_context = _format_detailed_activity_context(
            activities,
            laps_by_activity,
            records_by_activity,
        )

    # 4. Fetch latest FitnessEstimate
    stmt = (
        select(FitnessEstimate)
        .where(FitnessEstimate.user_id == user_id)
        .order_by(FitnessEstimate.date.desc())
        .limit(1)
    )
    res = await db.execute(stmt)
    fitness = res.scalar_one_or_none()

    preferences = await db.scalar(
        select(User.device_preferences).where(User.id == user_id)
    )
    personal_records = _format_personal_records(
        preferences if isinstance(preferences, dict) else None
    )

    # Build Context String
    lines = []
    now = _now_local()
    yesterday = today - datetime.timedelta(days=1)
    lines += [
        "### Current Date & Time Reference",
        f"- **Current Timestamp:** {now.strftime('%A, %Y-%m-%d %H:%M')} (Timezone: {_USER_TZ.key})",
        f"- **Today's Date:** {today.isoformat()} ({now.strftime('%A')})",
        f"- **Yesterday's Date:** {yesterday.isoformat()} ({(now - datetime.timedelta(days=1)).strftime('%A')})",
        "",
    ]
    if goal_section:
        lines.append(goal_section)
        lines.append("")
    lines += [
        f"### Training Context (Last {days} days from {start_date} to {today})",
        "",
        "#### Daily Health & Recovery",
        "| Date | HRV (ms) | HRV Band (ms) | HRV Z-Score | Readiness | Strain | RHR (bpm) | Recovery | Stress | SpO2 (%) | Anomalies |",
        "|------|----------|---------------|-------------|-----------|--------|-----------|----------|--------|----------|-----------|",
    ]

    for h in health_records:
        hrv = f"{h.overnight_hrv_avg_ms:.0f}" if h.overnight_hrv_avg_ms else "--"
        hrv_lo = f"{h.overnight_hrv_normal_low_ms:.0f}" if h.overnight_hrv_normal_low_ms else "--"
        hrv_hi = f"{h.overnight_hrv_normal_high_ms:.0f}" if h.overnight_hrv_normal_high_ms else "--"
        hrv_band = f"{hrv_lo}\u2013{hrv_hi}" if hrv_lo != "--" or hrv_hi != "--" else "--"
        zscore = f"{h.hrv_zscore:+.2f}" if h.hrv_zscore is not None else "--"
        readiness = f"{h.readiness_score_app:.0f}" if h.readiness_score_app is not None else "--"
        strain = f"{h.strain_score_app:.1f}" if h.strain_score_app is not None else "--"
        rhr = str(h.resting_hr_bpm) if h.resting_hr_bpm else "--"
        rec = f"{h.recovery_vendor}%" if h.recovery_vendor is not None else "--"
        stress = f"{h.stress_score:.0f}" if h.stress_score is not None else "--"
        spo2 = f"{h.spo2_pct:.1f}" if h.spo2_pct is not None else "--"
        flags = ", ".join(h.anomaly_flags.keys()) if h.anomaly_flags else "--"
        lines.append(
            f"| {h.date} | {hrv} | {hrv_band} | {zscore} | {readiness} | {strain} | {rhr} | {rec} | {stress} | {spo2} | {flags} |"
        )

    lines.extend(["", "#### Athlete-Reported Daily Feeling"])
    if feeling_records:
        for feeling in feeling_records:
            note = f" — {feeling.note}" if feeling.note else ""
            lines.append(f"- {feeling.date}: {feeling.feeling.replace('_', ' ')}{note}")
    else:
        lines.append("- No athlete-reported feelings in this period.")

    lines.extend(
        [
            "",
            "#### Sleep Data",
            "| Date | Duration (h) | Deep (h) | REM (h) |",
            "|------|--------------|----------|---------|",
        ]
    )

    for s in sleep_records:
        date_str = s.sleep_start.strftime("%Y-%m-%d")
        dur = f"{s.duration_s / 3600:.1f}" if s.duration_s else "--"
        deep = f"{s.stage_deep_s / 3600:.1f}" if s.stage_deep_s else "--"
        rem = f"{s.stage_rem_s / 3600:.1f}" if s.stage_rem_s else "--"
        lines.append(f"| {date_str} | {dur} | {deep} | {rem} |")

    lines.extend(
        [
            "",
            "#### Recent Activities",
            "| Date | Type | Distance (km) | Duration (m) | Avg HR (bpm) | Load |",
            "|------|------|---------------|--------------|--------------|------|",
        ]
    )

    for a in activities:
        date_str = a.start_time.strftime("%Y-%m-%d %H:%M")
        atype = a.title or (a.sport.value if a.sport else "--")
        dist = f"{a.distance_m / 1000:.2f}" if a.distance_m else "--"
        dur = f"{a.elapsed_time_s / 60:.1f}" if a.elapsed_time_s else "--"
        avg_hr = str(a.avg_hr_bpm) if a.avg_hr_bpm else "--"
        load = str(a.training_load_vendor) if a.training_load_vendor else "--"
        lines.append(f"| {date_str} | {atype} | {dist} | {dur} | {avg_hr} | {load} |")

    if detailed_activity_context:
        lines.extend(["", detailed_activity_context])

    if personal_records:
        lines.extend(["", personal_records])

    # Fitness Snapshot — vendor-provided values only
    if fitness:
        fitness_parts = [f"#### Current Fitness Snapshot (as of {fitness.date})"]
        if fitness.vo2max_vendor is not None:
            fitness_parts.append(f"- **VO2max (COROS):** {fitness.vo2max_vendor:.1f} ml/kg/min")
        if fitness.lactate_threshold_pace_s_per_km is not None:
            pace = fitness.lactate_threshold_pace_s_per_km
            t_min = int(pace // 60)
            t_sec = int(round(pace % 60))
            fitness_parts.append(f"- **Threshold Pace (COROS):** {t_min}:{t_sec:02d}/km")
        if fitness.lactate_threshold_hr is not None:
            fitness_parts.append(f"- **Threshold HR (COROS):** {fitness.lactate_threshold_hr} bpm")
        if fitness.ftp_vendor is not None:
            fitness_parts.append(f"- **FTP (COROS):** {fitness.ftp_vendor} W")
        lines.append("")
        lines.extend(fitness_parts)

    return "\n".join(lines)


async def build_plan_context(days_back: int = 7, days_forward: int = 14) -> str:
    """Build a markdown string of upcoming and recent training plan events."""
    now = _now_local()
    today = now.date()
    window_start = today - datetime.timedelta(days=days_back)
    window_end = today + datetime.timedelta(days=days_forward)

    events = await _fetch_plan_events(window_start, window_end)

    day_name = today.strftime("%A")  # e.g. "Sunday"
    local_time_str = now.strftime("%H:%M")

    lines = [
        f"### Training Plan Schedule ({window_start} to {window_end})",
        f"Current date (athlete local time, UTC+7 / Asia/Bangkok): {today.isoformat()} ({day_name}), {local_time_str}.",
        "",
        "| Date | Session | Status |",
        "|------|---------|--------|",
    ]

    events_with_details = []

    for ev in events:
        event_date = datetime.date.fromisoformat(ev["date"])
        date_label = f"{ev['date']} ({event_date.strftime('%A')})"
        if event_date < today:
            status = "Past"
        elif event_date == today:
            status = "TODAY"
        else:
            status = "Upcoming"
        lines.append(f"| {date_label} | {ev['summary']} | {status} |")

        if ev.get("description"):
            events_with_details.append((ev, date_label, status))

    if events_with_details:
        lines.append("")
        lines.append("#### Session Details")
        for ev, date_label, status in events_with_details:
            lines.append(f"**{date_label} - {ev['summary']} ({status})**")
            for d in ev["description"].splitlines():
                lines.append(f"> {d}")
            lines.append("")

    return "\n".join(lines)
