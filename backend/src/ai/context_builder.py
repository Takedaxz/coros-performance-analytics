"""Context builder for AI insights."""

import datetime

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.models import Activity, DailyHealth, Goal, SleepSession, User


async def _fetch_user_goal(db: AsyncSession, user_id: str) -> str:
    """Return a markdown string describing user goals and profile, or empty string."""
    from sqlalchemy import select as sa_select
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
        import datetime as _dt
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

    # Goals
    goals_res = await db.execute(
        sa_select(Goal)
        .where(Goal.user_id == user_id, Goal.is_active)
        .order_by(Goal.goal_race_date.asc())
    )
    active_goals = goals_res.scalars().all()

    if active_goals:
        parts.append("### Athlete Goals")
        for i, goal in enumerate(active_goals, 1):
            goal_details = []
            if goal.goal_race_name:
                goal_details.append(f"  - **Target Race:** {goal.goal_race_name}")
            if goal.goal_race_date:
                import datetime as _dt
                days_to_race = (goal.goal_race_date - _dt.date.today()).days
                goal_details.append(
                    f"  - **Race Date:** {goal.goal_race_date.isoformat()} "
                    f"({days_to_race} days away)"
                )
            if goal.goal_target_time:
                goal_details.append(f"  - **Goal Finish Time:** {goal.goal_target_time}")
            if goal.weekly_training_hours:
                goal_details.append(
                    f"  - **Weekly Training Target:** {goal.weekly_training_hours}h"
                )
            if goal.goal_description:
                goal_details.append(f"  - **Notes:** {goal.goal_description}")

            if goal_details:
                parts.append(f"\n**Goal {i}:**")
                parts.extend(goal_details)

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
        if not summary or not dtstart_raw:
            continue
        start_date = _parse_ical_date(dtstart_raw)
        if start_date is None:
            continue
        if window_start <= start_date <= window_end:
            events.append({"date": start_date.isoformat(), "summary": summary})

    events.sort(key=lambda e: e["date"])
    return events


async def build_training_context(db: AsyncSession, user_id: str, days: int = 14) -> str:
    """Build a markdown string containing recent training context."""
    today = datetime.date.today()
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

    # Build Context String
    lines = []
    if goal_section:
        lines.append(goal_section)
        lines.append("")
    lines += [
        f"### Training Context (Last {days} days from {start_date} to {today})",
        "",
        "#### Daily Health & Recovery",
        "| Date | HRV (ms) | RHR (bpm) | Recovery/Fatigue |",
        "|------|----------|-----------|------------------|",
    ]

    for h in health_records:
        hrv = f"{h.overnight_hrv_avg_ms:.0f}" if h.overnight_hrv_avg_ms else "--"
        rhr = str(h.resting_hr_bpm) if h.resting_hr_bpm else "--"
        rec = f"{h.recovery_vendor}%" if h.recovery_vendor is not None else "--"
        lines.append(f"| {h.date} | {hrv} | {rhr} | {rec} |")

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
            "| Date | Type | Distance (km) | Duration (m) | Load |",
            "|------|------|---------------|--------------|------|",
        ]
    )

    for a in activities:
        date_str = a.start_time.strftime("%Y-%m-%d %H:%M")
        atype = a.title or (a.sport.value if a.sport else "--")
        dist = f"{a.distance_m / 1000:.2f}" if a.distance_m else "--"
        dur = f"{a.elapsed_time_s / 60:.1f}" if a.elapsed_time_s else "--"
        load = str(a.training_load_vendor) if a.training_load_vendor else "--"
        lines.append(f"| {date_str} | {atype} | {dist} | {dur} | {load} |")

    return "\n".join(lines)


async def build_plan_context(days_back: int = 7, days_forward: int = 14) -> str:
    """Build a markdown string of upcoming and recent training plan events."""
    today = datetime.date.today()
    window_start = today - datetime.timedelta(days=days_back)
    window_end = today + datetime.timedelta(days=days_forward)

    events = await _fetch_plan_events(window_start, window_end)

    lines = [
        f"### Training Plan Schedule ({window_start} to {window_end})",
        f"Today is {today.isoformat()}.",
        "",
        "| Date | Session | Status |",
        "|------|---------|--------|",
    ]

    for ev in events:
        event_date = datetime.date.fromisoformat(ev["date"])
        if event_date < today:
            status = "Past"
        elif event_date == today:
            status = "TODAY"
        else:
            status = "Upcoming"
        lines.append(f"| {ev['date']} | {ev['summary']} | {status} |")

    return "\n".join(lines)
