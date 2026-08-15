"""Training plan routes: fetch and parse iCal calendar events."""

import asyncio
import datetime
import re
from typing import Literal, cast

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import get_settings
from src.db.credential_store import load_coros_credentials
from src.db.engine import get_db_session
from src.sync.api_client import CorosApiClient, CorosApiClientError

router = APIRouter()
settings = get_settings()

_ICAL_URL = "https://p135-caldav.icloud.com/published/2/MTAzNTc1NTUzNDMxMDM1N4gPI9Eruy25g9v9R_Ci0txlHRMQJW0ifWYN4qF0Rbss"
EventType = Literal["run", "ride", "strength", "swim", "yoga", "pilates", "race", "other"]
ScheduleObject = dict[str, object]


CalendarSource = Literal["ical", "coros"]
WorkoutSport = Literal[
    "run",
    "ride",
    "swim",
    "strength",
    "trail_run",
    "indoor_climb",
    "bouldering",
    "xc_ski",
    "hyrox",
]
WorkoutStepKind = Literal["warmup", "training", "rest", "cooldown"]
WorkoutTarget = Literal[
    "time",
    "distance",
    "load",
    "hr_recovery",
    "reps",
    "open",
    "elevation_gain",
    "routes",
]
WorkoutIntensity = Literal[
    "none", "heart_rate", "heart_rate_percent", "pace", "effort_pace",
    "threshold_pace_percent", "effort_pace_percent", "ftp_percent", "power",
    "cadence", "weight", "rpe", "stroke", "speed", "grade",
]
WorkoutIntensityBasis = Literal["max_hr", "reserve", "lthr"]

_SPORT_CONFIG: dict[WorkoutSport, tuple[int, int, str]] = {
    "run": (1, 2, "sid_run_training"),
    "ride": (2, 2, "sid_bike_dist_speed"),
    "swim": (3, 2, "sid_poolswim_dist_default"),
    "strength": (4, 2, "sid_strength_training"),
    "trail_run": (5, 4, "sid_run_training"),
    "indoor_climb": (6, 7, "sid_run_training"),
    "bouldering": (7, 7, "sid_run_training"),
    "xc_ski": (8, 9, "sid_run_training"),
    "hyrox": (9, 9, "sid_strength_training"),
}
_STEP_EXERCISE_TYPE: dict[WorkoutStepKind, int] = {
    "warmup": 1,
    "training": 2,
    "cooldown": 3,
    "rest": 4,
}
_TARGET_CONFIG: dict[WorkoutTarget, tuple[int, int]] = {
    "open": (1, 0),
    "time": (2, 0),
    "reps": (3, 0),
    "distance": (5, 2),
    "load": (6, 0),
    "hr_recovery": (7, 0),
    "elevation_gain": (8, 2),
    "routes": (9, 0),
}


class CorosWorkoutStep(BaseModel):
    kind: WorkoutStepKind = "training"
    target: WorkoutTarget = "time"
    value: float = Field(default=600, ge=0, le=1_000_000)
    name: str = Field(default="", max_length=80)
    repeats: int = Field(default=1, ge=1, le=99)
    intensity: WorkoutIntensity = "none"
    intensity_low: float | None = Field(default=None, ge=-8, le=1_000_000)
    intensity_high: float | None = Field(default=None, ge=-8, le=1_000_000)
    intensity_basis: WorkoutIntensityBasis = "max_hr"
    intensity_zone: int | None = Field(default=None, ge=1, le=7)
    repeat_group: int | None = None
    repeat_count: int | None = Field(default=None, ge=1, le=99)
    repeat_name: str | None = Field(default=None, max_length=80)


class CorosWorkoutDraft(BaseModel):
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    name: str = Field(min_length=1, max_length=100)
    sport: WorkoutSport
    description: str = Field(default="", max_length=300)
    steps: list[CorosWorkoutStep] = Field(min_length=1, max_length=50)


class ConfirmedCorosWorkout(BaseModel):
    draft: CorosWorkoutDraft
    confirmed: Literal[True]
    save_to_library: bool = False


class MoveCorosWorkout(BaseModel):
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    confirmed: Literal[True]


class DeleteCorosWorkout(BaseModel):
    confirmed: Literal[True]


class CorosWorkoutEditorData(CorosWorkoutDraft):
    uid: str


class CorosLibraryWorkout(BaseModel):
    id: str
    name: str
    sport: WorkoutSport
    step_count: int | None = None
    total_time: int | None = None
    total_distance: float | None = None
    step_kinds: list[str] = Field(default_factory=list)


class CorosWorkoutPreview(BaseModel):
    distance: float | None = None
    duration: float | None = None
    training_load: float | None = None


class TrainingEvent(BaseModel):
    uid: str
    summary: str
    start: str  # ISO date or datetime string
    end: str
    description: str
    location: str
    event_type: EventType
    is_all_day: bool
    workout_steps: list[CorosWorkoutStep] = Field(default_factory=list)


def _classify_event(summary: str) -> EventType:
    s = summary.lower()
    # Explicit run keywords
    if any(k in s for k in ("run", "tempo", "long run", "easy run", "marathon", "hyrox")):
        return "run"
    if re.search(r"\b(?:bike|ride|cycling|cycle|trainer)\b", s):
        return "ride"
    # Distance / interval / pace notation → running session
    # e.g. "5 × 8 min @ T", "6×800m @ 4:40", "4:30/km", "@ i", "@ t", "min @"
    if any(
        k in s for k in ("@ t", "@ i", "@ m", "min @", "×", "x 1 km", "/km", "strides", "intervals")
    ):
        return "run"
    # Standalone distance markers without "run" keyword (e.g. "17.5 km")
    if re.search(r"\d+(\.\d+)?\s*km", s):
        return "run"
    if "swim" in s:
        return "swim"
    if any(k in s for k in ("strength", "weight", "gym", "plyometric", "deadlift", "squat")):
        return "strength"
    if "yoga" in s:
        return "yoga"
    if "pilates" in s:
        return "pilates"
    if any(k in s for k in ("race", "marathon", "แข่ง", "competition", "icmm", "amazing thailand")):
        return "race"
    return "other"


def _unfold_ical(raw: str) -> str:
    """Unfold iCal line continuations (RFC 5545 §3.1)."""
    return re.sub(r"\r?\n[ \t]", "", raw)


def _parse_ical_datetime(value: str) -> tuple[str, bool]:
    """Return (iso_string, is_all_day)."""
    value = value.split(";")[-1]  # strip TZID= params if any
    value = value.strip()
    if len(value) == 8:
        # DATE only: YYYYMMDD
        d = datetime.date(int(value[:4]), int(value[4:6]), int(value[6:8]))
        return d.isoformat(), True
    # DATETIME: YYYYMMDDTHHMMSSZ or local
    try:
        value = value.rstrip("Z")
        dt = datetime.datetime(
            int(value[0:4]),
            int(value[4:6]),
            int(value[6:8]),
            int(value[9:11]),
            int(value[11:13]),
            int(value[13:15]),
        )
        return dt.isoformat(), False
    except (ValueError, IndexError):
        return value, False


def _extract_value(lines: list[str], prop: str) -> str:
    """Extract a property value from a list of unfolded lines."""
    prefix_exact = f"{prop}:"
    prefix_param = f"{prop};"
    for line in lines:
        if line.startswith(prefix_exact):
            return line[len(prefix_exact) :].strip()
        if line.startswith(prefix_param):
            # e.g. DTSTART;TZID=Asia/Bangkok:20260527T090000
            return line.split(":", 1)[-1].strip()
    return ""


def _unescape_ical_text(value: str) -> str:
    """Decode iCalendar text escapes for readable event details."""
    return value.replace("\\n", "\n").replace("\\,", ",").replace("\\;", ";").replace("\\\\", "\\")


async def _fetch_and_parse_ical() -> list[TrainingEvent]:
    """Fetch the iCal feed and return parsed TrainingEvent objects."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(_ICAL_URL)
    if resp.status_code != 200:
        raise HTTPException(
            status_code=502, detail=f"Failed to fetch calendar: HTTP {resp.status_code}"
        )

    raw = _unfold_ical(resp.text)
    events: list[TrainingEvent] = []

    vevent_blocks = re.split(r"BEGIN:VEVENT", raw)[1:]
    for block in vevent_blocks:
        end_idx = block.find("END:VEVENT")
        if end_idx == -1:
            continue
        block = block[:end_idx]
        lines = block.strip().splitlines()

        uid = _extract_value(lines, "UID")
        summary = _extract_value(lines, "SUMMARY")
        description = _unescape_ical_text(_extract_value(lines, "DESCRIPTION"))
        location = _unescape_ical_text(_extract_value(lines, "LOCATION")).replace("\n", ", ")

        dtstart_raw = _extract_value(lines, "DTSTART")
        dtend_raw = _extract_value(lines, "DTEND")

        if not dtstart_raw or not summary:
            continue

        start_iso, is_all_day = _parse_ical_datetime(dtstart_raw)
        end_iso, _ = _parse_ical_datetime(dtend_raw) if dtend_raw else (start_iso, is_all_day)

        events.append(
            TrainingEvent(
                uid=uid,
                summary=summary,
                start=start_iso,
                end=end_iso,
                description=description,
                location=location,
                event_type=_classify_event(summary),
                is_all_day=is_all_day,
            )
        )

    return events


def _schedule_programs(raw: ScheduleObject) -> dict[str, ScheduleObject]:
    programs = raw.get("programs")
    if not isinstance(programs, list):
        return {}
    mapped: dict[str, ScheduleObject] = {}
    for program in programs:
        if not isinstance(program, dict):
            continue
        program_data = cast("ScheduleObject", program)
        for key in ("id", "idInPlan"):
            value = program_data.get(key)
            if value is not None:
                mapped.setdefault(str(value), program_data)
    return mapped


def _schedule_event_type(sport_type: object) -> EventType:
    event_types: dict[int, EventType] = {
        1: "run",
        2: "ride",
        3: "swim",
        4: "strength",
        5: "run",
        9: "run",
    }
    return event_types.get(sport_type if isinstance(sport_type, int) else 0, "other")


def _schedule_description(entity: ScheduleObject, program: ScheduleObject | None) -> str:
    parts: list[str] = []
    sport_data = entity.get("sportData")
    if isinstance(sport_data, dict):
        distance = sport_data.get("distance")
        load = sport_data.get("trainingLoad")
    else:
        distance = None
        load = None
    if not isinstance(distance, (int, float)) and program:
        distance = program.get("planDistance", program.get("distance"))
    if not isinstance(load, (int, float)) and program:
        load = program.get("planTrainingLoad", program.get("trainingLoad"))
    if isinstance(distance, (int, float)) and distance > 0:
        distance_km = f"{distance / 100_000:.2f}".rstrip("0").rstrip(".")
        parts.append(f"{distance_km} km")
    if isinstance(load, (int, float)) and load > 0:
        parts.append(f"Load {load:g}")
    return " · ".join(parts)


def _parse_coros_schedule(raw: ScheduleObject) -> list[TrainingEvent]:
    entities = raw.get("entities")
    if not isinstance(entities, list):
        return []
    programs = _schedule_programs(raw)
    events: list[TrainingEvent] = []
    for entity in entities:
        if not isinstance(entity, dict) or entity.get("status") == 3:
            continue
        entity_data = cast("ScheduleObject", entity)
        happen_day = str(entity_data.get("happenDay", ""))
        if not re.fullmatch(r"\d{8}", happen_day):
            continue
        program = programs.get(str(entity_data.get("planProgramId", ""))) or programs.get(
            str(entity_data.get("idInPlan", ""))
        )
        sport_data = entity_data.get("sportData")
        name = (
            (sport_data.get("name") if isinstance(sport_data, dict) else None)
            or (program.get("name") if program else None)
            or entity_data.get("name")
            or "Scheduled workout"
        )
        sport_type = (program or entity_data).get("sportType")
        date_value = f"{happen_day[:4]}-{happen_day[4:6]}-{happen_day[6:]}"
        uid = f"coros:{entity_data.get('planId', '')}:{entity_data.get('idInPlan', '')}:{happen_day}"
        events.append(
            TrainingEvent(
                uid=uid,
                summary=str(name),
                start=date_value,
                end=date_value,
                description=_schedule_description(entity_data, program),
                location="",
                event_type=_schedule_event_type(sport_type),
                is_all_day=True,
                workout_steps=_draft_from_program(uid, happen_day, program).steps if program and isinstance(program.get("exercises"), list) else [],
            )
        )
    return sorted(events, key=lambda event: (event.start, event.uid))


async def fetch_coros_calendar(
    start_date: datetime.date,
    end_date: datetime.date,
    db: AsyncSession,
) -> list[TrainingEvent]:
    """Fetch structured COROS calendar workouts in an exact date range."""
    creds = await load_coros_credentials(db, settings.app_secret_key)
    email = (creds[0] if creds else None) or settings.coros_email
    password = (creds[1] if creds else None) or settings.coros_password
    if not email or not password:
        raise HTTPException(status_code=400, detail="Configure COROS credentials in Settings.")
    client = CorosApiClient(email=email, password=password)
    try:
        await client.login()
        return _parse_coros_schedule(
            await client.fetch_training_schedule(
                start_date.strftime("%Y%m%d"), end_date.strftime("%Y%m%d")
            )
        )
    except CorosApiClientError as exc:
        raise HTTPException(status_code=502, detail=f"COROS Calendar unavailable: {exc}") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail="COROS Calendar unavailable: network request failed.",
        ) from exc


async def _fetch_coros_calendar(
    days_back: int,
    days_forward: int,
    db: AsyncSession,
) -> list[TrainingEvent]:
    today = datetime.date.today()
    return await fetch_coros_calendar(
        today - datetime.timedelta(days=days_back),
        today + datetime.timedelta(days=days_forward),
        db,
    )


def _coros_day(date: str) -> str:
    try:
        return datetime.date.fromisoformat(date).strftime("%Y%m%d")
    except ValueError as exc:
        raise HTTPException(
            status_code=422, detail="Date must be a real YYYY-MM-DD value."
        ) from exc


def _intensity_fields(step: CorosWorkoutStep, sport: WorkoutSport) -> ScheduleObject:
    if step.intensity == "none":
        return {
            "intensityType": 0,
            "intensityValue": 0,
            "intensityValueExtend": 0,
            "intensityMultiplier": 0,
            "intensityDisplayUnit": 0,
            "hrType": 0,
            "isIntensityPercent": False,
            "intensityCustom": 0,
        }
    low = step.intensity_low
    high = step.intensity_high if step.intensity_high is not None else low
    if low is None or high is None:
        raise HTTPException(status_code=422, detail=f"{step.intensity} intensity needs a value.")
    if step.intensity in {
        "heart_rate_percent", "threshold_pace_percent", "effort_pace_percent", "ftp_percent"
    }:
        low, high = sorted((low, high))
        if not 1 <= low <= 300 or not 1 <= high <= 300:
            raise HTTPException(status_code=422, detail="Percentage intensity must be from 1% to 300%.")
        intensity_type = {
            "heart_rate_percent": 2,
            "threshold_pace_percent": 3,
            "effort_pace_percent": 8,
            "ftp_percent": 9,
        }[step.intensity]
        return {
            "intensityType": intensity_type,
            "intensityValue": 0,
            "intensityValueExtend": 0,
            "intensityMultiplier": 0,
            "intensityDisplayUnit": 0,
            "hrType": {"max_hr": 1, "reserve": 2, "lthr": 3}[step.intensity_basis]
            if step.intensity == "heart_rate_percent" else 0,
            "isIntensityPercent": True,
            "intensityCustom": step.intensity_zone or 0,
            "intensityPercent": round(low * 1000),
            "intensityPercentExtend": round(high * 1000),
        }
    if step.intensity == "grade":
        if not -8 <= low <= 4:
            raise HTTPException(status_code=422, detail="Relative grade must be from -8 through +4.")
        return {
            "intensityType": 10,
            "intensityValue": 0,
            "intensityValueExtend": 0,
            "intensityMultiplier": 0,
            "intensityDisplayUnit": 0,
            "hrType": 0,
            "isIntensityPercent": False,
            "intensityCustom": 0,
            "gradeSystem": 7 if sport == "bouldering" else 1,
            "onsightGradeOffset": 32 + round(low),
        }
    if step.intensity in {"weight", "rpe", "stroke"}:
        high = low
    if step.intensity in {"heart_rate", "power", "cadence", "pace", "effort_pace", "speed"}:
        low, high = sorted((low, high))
    minimum, maximum = {
        "heart_rate": (30, 250), "power": (0, 3_000), "cadence": (0, 300),
        "weight": (0, 2_000), "rpe": (1, 10), "speed": (0, 200),
        "pace": (1, 3_600), "effort_pace": (1, 3_600),
    }.get(step.intensity, (0, 255))
    if not minimum <= low <= maximum or not minimum <= high <= maximum:
        raise HTTPException(status_code=422, detail=f"{step.intensity} intensity is outside its supported range.")
    if step.intensity == "rpe" and not low.is_integer():
        raise HTTPException(status_code=422, detail="RPE intensity must be a whole number.")
    if step.intensity == "stroke" and low not in {0, 1, 2, 3, 4, 6, 7, 255}:
        raise HTTPException(status_code=422, detail="Unsupported swim stroke.")
    intensity_type, display_unit = {
        "heart_rate": (2, 0),
        "power": (6, 0),
        "cadence": (7, 0),
        "weight": (1, 6),
        "rpe": (11, 0),
        "stroke": (5, 0),
        "speed": (4, 4),
        "pace": (3, 1),
        "effort_pace": (8, 1),
    }[step.intensity]
    multiplier = {"pace": 1000, "effort_pace": 1000, "speed": 100, "weight": 1000}.get(step.intensity, 0)
    return {
        "intensityType": intensity_type,
        "intensityValue": round(low * multiplier),
        "intensityValueExtend": round(high * multiplier),
        "intensityMultiplier": multiplier,
        "intensityDisplayUnit": display_unit,
        "hrType": 2 if step.intensity == "heart_rate" else 0,
        "isIntensityPercent": False,
        "intensityCustom": 0,
    }


def _build_coros_program(draft: CorosWorkoutDraft) -> ScheduleObject:
    sport_type, pb_version, overview = _SPORT_CONFIG[draft.sport]
    exercises: list[ScheduleObject] = []
    total_distance = 0
    total_time = 0

    def build_exercise(
        step: CorosWorkoutStep, exercise_id: int, sort_no: int, group_id: str
    ) -> tuple[ScheduleObject, int, int]:
        if step.target == "hr_recovery" and step.kind != "rest":
            raise HTTPException(
                status_code=422, detail="HR Recovery is only available for Rest steps."
            )
        if step.target == "reps" and draft.sport not in {"strength", "hyrox"}:
            raise HTTPException(
                status_code=422, detail="Reps are only available for Strength and HYROX."
            )
        if step.target == "elevation_gain" and draft.sport not in {"trail_run", "xc_ski"}:
            raise HTTPException(
                status_code=422, detail="Elevation gain is only available for Trail Run and XC Ski."
            )
        if step.target == "routes" and draft.sport not in {"indoor_climb", "bouldering"}:
            raise HTTPException(
                status_code=422,
                detail="Routes are only available for Indoor Climb and Bouldering.",
            )
        if (
            draft.sport in {"strength", "hyrox"}
            and step.kind == "training"
            and not step.name.strip()
        ):
            raise HTTPException(
                status_code=422, detail="Strength and HYROX training steps need an exercise name."
            )
        target_type, display_unit = _TARGET_CONFIG[step.target]
        if step.target in {"distance", "elevation_gain"}:
            target_value = round(step.value * 100)
            distance = target_value if step.target == "distance" else 0
            duration = 0
        elif step.target == "open":
            target_value = 0
            distance = 0
            duration = 0
        else:
            target_value = round(step.value)
            distance = 0
            duration = target_value if step.target == "time" else 0
        return (
            {
                "id": exercise_id,
                "access": 0,
                "createTimestamp": 0,
                "defaultOrder": sort_no,
                "deleted": 0,
                "equipment": [1],
                "isDefaultAdd": 1 if step.kind == "training" else 0,
                "part": [0],
                "sourceId": "0",
                "sourceUrl": "",
                "status": 1,
                "userId": 0,
                "videoUrl": "",
                "name": step.name.strip() or _friendly_step_name(step.kind),
                "exerciseType": _STEP_EXERCISE_TYPE[step.kind],
                "sportType": sport_type,
                "subType": 0,
                **_intensity_fields(step, draft.sport),
                "targetType": target_type,
                "targetValue": target_value,
                "targetDisplayUnit": display_unit,
                "sets": step.repeats,
                "sortNo": sort_no,
                "restType": 3,
                "restValue": 0,
                "groupId": group_id,
                "isGroup": False,
                "originId": "0",
                "overview": "sid_strength_training"
                if draft.sport in {"strength", "hyrox"}
                else overview,
            },
            distance,
            duration,
        )

    next_id = 0
    consumed_groups: set[int] = set()
    top_index = 0
    for step in draft.steps:
        if step.repeat_group is not None:
            if step.repeat_group in consumed_groups:
                continue
            consumed_groups.add(step.repeat_group)
            children = [item for item in draft.steps if item.repeat_group == step.repeat_group]
            top_index += 1
            next_id += 1
            group_id = next_id
            group_distance = 0
            group_time = 0
            child_exercises: list[ScheduleObject] = []
            for child_index, child in enumerate(children, start=1):
                next_id += 1
                exercise, distance, duration = build_exercise(
                    child, next_id, 16_777_216 * top_index + 65_536 * child_index, str(group_id)
                )
                child_exercises.append(exercise)
                group_distance += distance * child.repeats
                group_time += duration * child.repeats
            repeat_count = step.repeat_count or 1
            group_target_type = 5 if group_distance else 2
            group_target_value = group_distance if group_distance else group_time
            exercises.append(
                {
                    "id": group_id,
                    "name": step.repeat_name or "Repeat",
                    "exerciseType": 0,
                    "sportType": sport_type,
                    "intensityType": 0,
                    "intensityValue": 0,
                    "targetType": group_target_type,
                    "targetValue": group_target_value,
                    "targetDisplayUnit": 2 if group_target_type == 5 else 0,
                    "sets": repeat_count,
                    "sortNo": 16_777_216 * top_index,
                    "restType": 3,
                    "restValue": 0,
                    "groupId": "0",
                    "isGroup": True,
                    "originId": "0",
                    "overview": overview,
                }
            )
            exercises.extend(child_exercises)
            total_distance += group_distance * repeat_count
            total_time += group_time * repeat_count
            continue
        top_index += 1
        next_id += 1
        exercise, distance, duration = build_exercise(step, next_id, 16_777_216 * top_index, "0")
        exercises.append(exercise)
        total_distance += distance * step.repeats
        total_time += duration * step.repeats
    if any(exercise.get("intensityType") == 8 for exercise in exercises):
        pb_version = max(pb_version, 3)
    return {
        "id": "0",
        "idInPlan": "0",
        "authorId": "0",
        "userId": "0",
        "createTimestamp": 0,
        "deleted": 0,
        "status": 1,
        "version": 0,
        "name": draft.name.strip(),
        "sportType": sport_type,
        "subType": 65535,
        "pbVersion": pb_version,
        "referExercise": {"intensityType": 0, "hrType": 0, "valueType": 0},
        "estimatedTime": total_time,
        "estimatedDistance": total_distance,
        "distanceDisplayUnit": 2 if draft.sport == "swim" else 1,
        "estimatedType": 6 if total_distance else 0,
        "targetType": 5 if total_distance else 2,
        "targetValue": total_distance if total_distance else total_time,
        "simple": False,
        "access": 1,
        "essence": 0,
        "originEssence": 0,
        "overview": draft.description.strip(),
        "type": 0,
        "unit": 0,
        "exerciseNum": len(exercises),
        "totalSets": len(exercises),
        "exercises": exercises,
        **(
            {"poolLengthId": 0, "poolLength": 2500, "poolLengthUnit": 2}
            if draft.sport == "swim"
            else {}
        ),
    }


def _apply_calculation(program: ScheduleObject, calculation: object) -> ScheduleObject:
    if not isinstance(calculation, dict):
        raise HTTPException(status_code=502, detail="COROS did not return workout calculations.")
    calculated = dict(program)
    for key in (
        "planDistance",
        "planDuration",
        "planTrainingLoad",
        "planSets",
        "planPitch",
        "distanceDisplayUnit",
        "exerciseBarChart",
        "distance",
        "duration",
        "trainingLoad",
        "pitch",
    ):
        if key in calculation:
            calculated[key] = calculation[key]
    return calculated


async def _coros_client(db: AsyncSession) -> CorosApiClient:
    creds = await load_coros_credentials(db, settings.app_secret_key)
    email = (creds[0] if creds else None) or settings.coros_email
    password = (creds[1] if creds else None) or settings.coros_password
    if not email or not password:
        raise HTTPException(status_code=400, detail="Configure COROS credentials in Settings.")
    client = CorosApiClient(email=email, password=password)
    try:
        await client.login()
    except CorosApiClientError as exc:
        raise HTTPException(status_code=502, detail=f"COROS Calendar unavailable: {exc}") from exc
    return client


async def _scheduled_match(
    client: CorosApiClient, uid: str
) -> tuple[ScheduleObject, ScheduleObject, str]:
    match = re.fullmatch(r"coros:([^:]+):([^:]+):(\d{8})", uid)
    if not match:
        raise HTTPException(status_code=422, detail="Invalid COROS calendar event.")
    plan_id, id_in_plan, happen_day = match.groups()
    raw = await client.fetch_training_schedule(happen_day, happen_day)
    programs = _schedule_programs(raw)
    entities = raw.get("entities")
    if not isinstance(entities, list):
        raise HTTPException(status_code=404, detail="COROS workout not found.")
    for entity in entities:
        if not isinstance(entity, dict):
            continue
        entity_data = cast("ScheduleObject", entity)
        if (
            str(entity_data.get("planId")) != plan_id
            or str(entity_data.get("idInPlan")) != id_in_plan
        ):
            continue
        program = programs.get(str(entity_data.get("planProgramId", id_in_plan))) or programs.get(
            id_in_plan
        )
        if program:
            return entity_data, program, happen_day
    raise HTTPException(status_code=404, detail="COROS workout not found.")


def _sport_from_type(sport_type: object) -> WorkoutSport:
    sport_by_type: dict[int, WorkoutSport] = {
        1: "run",
        2: "ride",
        3: "swim",
        4: "strength",
        5: "trail_run",
        6: "indoor_climb",
        7: "bouldering",
        8: "xc_ski",
        9: "hyrox",
    }
    return sport_by_type.get(sport_type if isinstance(sport_type, int) else 1, "run")


def _friendly_step_name(kind: WorkoutStepKind) -> str:
    return {
        "warmup": "Warm Up",
        "training": "Training",
        "rest": "Rest",
        "cooldown": "Cool Down",
    }[kind]


def _exercise_display_name(exercise: ScheduleObject, kind: WorkoutStepKind) -> str:
    for key in ("displayName", "exerciseName", "nameText", "name", "overview"):
        value = exercise.get(key)
        if not isinstance(value, str) or not value.strip():
            continue
        name = value.strip()
        overview = re.sub(r"^sid_[a-z]+_", "", name, flags=re.IGNORECASE)
        if overview != name:
            return overview.replace("_", " ").title()
        if not re.fullmatch(r"[TS]\d+", name, re.IGNORECASE):
            return name
    return _friendly_step_name(kind)


def _draft_from_program(
    uid: str, happen_day: str, program: ScheduleObject
) -> CorosWorkoutEditorData:
    target_by_type: dict[int, WorkoutTarget] = {
        1: "open",
        2: "time",
        3: "reps",
        5: "distance",
        6: "load",
        7: "hr_recovery",
        8: "elevation_gain",
        9: "routes",
    }
    kind_by_type: dict[int, WorkoutStepKind] = {
        1: "warmup",
        2: "training",
        3: "cooldown",
        4: "rest",
    }
    intensity_by_type: dict[int, WorkoutIntensity] = {
        1: "weight",
        2: "heart_rate",
        3: "pace",
        4: "speed",
        5: "stroke",
        6: "power",
        7: "cadence",
        11: "rpe",
    }
    sport = _sport_from_type(program.get("sportType"))
    raw_exercises = program.get("exercises")
    steps: list[CorosWorkoutStep] = []
    if isinstance(raw_exercises, list):
        exercises = [
            cast("ScheduleObject", item) for item in raw_exercises if isinstance(item, dict)
        ]

        def sort_number(exercise: ScheduleObject) -> int:
            sort_no = exercise.get("sortNo")
            return sort_no if isinstance(sort_no, int) else 0

        exercises.sort(key=sort_number)
        groups = {
            str(exercise.get("id")): exercise
            for exercise in exercises
            if exercise.get("isGroup") is True
        }
        group_positions = {group_id: position for position, group_id in enumerate(groups, start=1)}
        for exercise in exercises:
            if exercise.get("isGroup") is True:
                continue
            target_type = exercise.get("targetType")
            target = target_by_type.get(target_type if isinstance(target_type, int) else 2, "time")
            target_value = exercise.get("targetValue")
            value = float(target_value) if isinstance(target_value, (int, float)) else 600
            if target in {"distance", "elevation_gain"}:
                value /= 100
            intensity_type = exercise.get("intensityType")
            intensity_type_value = intensity_type if isinstance(intensity_type, int) else 0
            is_percent = exercise.get("isIntensityPercent") is True
            intensity = intensity_by_type.get(intensity_type_value, "none")
            if is_percent:
                intensity = {
                    2: "heart_rate_percent",
                    3: "threshold_pace_percent",
                    8: "effort_pace_percent",
                    9: "ftp_percent",
                }.get(intensity_type_value, "none")
            elif intensity_type_value == 8:
                intensity = "effort_pace"
            elif intensity_type_value == 10:
                intensity = "grade"
            intensity_value = exercise.get("intensityValue")
            intensity_high = exercise.get("intensityValueExtend")
            intensity_percent = exercise.get("intensityPercent")
            intensity_percent_high = exercise.get("intensityPercentExtend")
            intensity_custom = exercise.get("intensityCustom")
            multiplier = exercise.get("intensityMultiplier")
            exercise_type = exercise.get("exerciseType")
            kind = kind_by_type.get(
                exercise_type if isinstance(exercise_type, int) else 2,
                "training",
            )
            divisor = 1000 if intensity == "weight" or intensity in {"pace", "effort_pace"} and multiplier == 1000 else 100 if intensity == "speed" else 1
            raw_low = intensity_percent if is_percent else intensity_value
            raw_high = intensity_percent_high if is_percent else intensity_high
            if intensity == "grade":
                offset = exercise.get("onsightGradeOffset")
                raw_low = float(offset) - 32 if isinstance(offset, (int, float)) else 0
                raw_high = raw_low
            percent_divisor = 1000 if is_percent and isinstance(raw_low, (int, float)) and abs(raw_low) > 500 else 1
            basis_by_hr_type: dict[int, WorkoutIntensityBasis] = {1: "max_hr", 2: "reserve", 3: "lthr"}
            hr_type = exercise.get("hrType")
            raw_group_id = str(exercise.get("groupId", "0"))
            group = groups.get(raw_group_id)
            exercise_sets = exercise.get("sets")
            group_sets = group.get("sets") if group else None
            steps.append(
                CorosWorkoutStep(
                    kind=kind,
                    target=target,
                    value=value,
                    name=_exercise_display_name(exercise, kind),
                    repeats=exercise_sets if isinstance(exercise_sets, int) else 1,
                    intensity=intensity,
                    intensity_low=(float(raw_low) / percent_divisor if is_percent else float(raw_low) / divisor)
                    if isinstance(raw_low, (int, float)) and intensity != "none"
                    else None,
                    intensity_high=(float(raw_high) / percent_divisor if is_percent else float(raw_high) / divisor)
                    if isinstance(raw_high, (int, float)) and intensity != "none"
                    else None,
                    intensity_basis=basis_by_hr_type.get(hr_type if isinstance(hr_type, int) else 1, "max_hr"),
                    intensity_zone=intensity_custom if is_percent and isinstance(intensity_custom, int) and intensity_custom > 0 else None,
                    repeat_group=group_positions.get(raw_group_id),
                    repeat_count=group_sets if isinstance(group_sets, int) else None,
                    repeat_name=str(group.get("name", "Repeat")) if group else None,
                )
            )
    return CorosWorkoutEditorData(
        uid=uid,
        date=f"{happen_day[:4]}-{happen_day[4:6]}-{happen_day[6:]}",
        name=str(program.get("name", "Workout")),
        sport=sport,
        description=str(program.get("overview", "")),
        steps=steps or [CorosWorkoutStep()],
    )


async def _schedule_new_workout(
    client: CorosApiClient, draft: CorosWorkoutDraft, save_to_library: bool = False
) -> TrainingEvent:
    happen_day = _coros_day(draft.date)
    program = _build_coros_program(draft)
    calculated = _apply_calculation(
        program, await client.post_training_hub("/training/program/calculate", program)
    )
    if save_to_library:
        program_id = await client.post_training_hub("/training/program/add", calculated)
        if program_id is not None:
            calculated["id"] = str(program_id)
    schedule = await client.fetch_training_schedule(happen_day, happen_day)
    max_id = schedule.get("maxIdInPlan")
    id_in_plan = int(max_id) + 1 if isinstance(max_id, (int, float, str)) else 1
    calculated["idInPlan"] = id_in_plan
    entity: ScheduleObject = {
        "happenDay": happen_day,
        "idInPlan": id_in_plan,
        "sortNoInSchedule": 1,
    }
    if isinstance(calculated.get("exerciseBarChart"), list):
        entity["exerciseBarChart"] = calculated["exerciseBarChart"]
    await client.post_training_hub(
        "/training/schedule/update",
        {
            "entities": [entity],
            "programs": [calculated],
            "versionObjects": [{"id": id_in_plan, "status": 1}],
            "pbVersion": calculated["pbVersion"],
        },
    )
    verified = _parse_coros_schedule(await client.fetch_training_schedule(happen_day, happen_day))
    for event in verified:
        if event.uid.endswith(f":{id_in_plan}:{happen_day}"):
            return event
    raise HTTPException(
        status_code=502, detail="COROS accepted the workout but did not return it on reread."
    )


@router.post("/coros/workouts", response_model=TrainingEvent)
async def create_coros_workout(
    request: ConfirmedCorosWorkout,
    db: AsyncSession = Depends(get_db_session),
) -> TrainingEvent:
    """Calculate, schedule, and reread one manually confirmed COROS workout."""
    try:
        return await _schedule_new_workout(
            await _coros_client(db), request.draft, request.save_to_library
        )
    except CorosApiClientError as exc:
        raise HTTPException(status_code=502, detail=f"COROS Calendar unavailable: {exc}") from exc


@router.post("/coros/workouts/preview", response_model=CorosWorkoutPreview)
async def preview_coros_workout(
    draft: CorosWorkoutDraft,
    db: AsyncSession = Depends(get_db_session),
) -> CorosWorkoutPreview:
    """Calculate a workout in COROS without saving or scheduling it."""
    try:
        calculation = await (await _coros_client(db)).post_training_hub(
            "/training/program/calculate", _build_coros_program(draft)
        )
        if not isinstance(calculation, dict):
            raise HTTPException(
                status_code=502, detail="COROS did not return workout calculations."
            )
        return CorosWorkoutPreview(
            distance=float(calculation["planDistance"])
            if isinstance(calculation.get("planDistance"), (int, float, str))
            else None,
            duration=float(calculation["planDuration"])
            if isinstance(calculation.get("planDuration"), (int, float, str))
            else None,
            training_load=float(calculation["planTrainingLoad"])
            if isinstance(calculation.get("planTrainingLoad"), (int, float, str))
            else None,
        )
    except (CorosApiClientError, ValueError) as exc:
        raise HTTPException(status_code=502, detail=f"COROS Calendar unavailable: {exc}") from exc


@router.get("/coros/workouts/{uid:path}", response_model=CorosWorkoutEditorData)
async def get_coros_workout(
    uid: str,
    db: AsyncSession = Depends(get_db_session),
) -> CorosWorkoutEditorData:
    """Load a scheduled workout into the manual editor without changing it."""
    try:
        _, program, happen_day = await _scheduled_match(await _coros_client(db), uid)
        return _draft_from_program(uid, happen_day, program)
    except CorosApiClientError as exc:
        raise HTTPException(status_code=502, detail=f"COROS Calendar unavailable: {exc}") from exc


def _calculate_program_summary(program: dict[str, object]) -> tuple[int, int, float, list[str]]:
    """Returns (step_count, total_time_seconds, total_distance_meters, step_kinds)."""
    raw_exercises = program.get("exercises")
    if not isinstance(raw_exercises, list):
        return 0, 0, 0.0, []

    kind_by_type: dict[int, str] = {
        1: "warmup",
        2: "training",
        3: "cooldown",
        4: "rest",
    }

    exercises = [ex for ex in raw_exercises if isinstance(ex, dict)]
    exercises.sort(
        key=lambda ex: ex.get("sortNo") if isinstance(ex.get("sortNo"), int) else 0
    )
    groups = {str(ex.get("id")): ex for ex in exercises if ex.get("isGroup") is True}
    emitted_groups: set[str] = set()
    step_count = len(exercises)
    total_time = 0
    total_distance = 0.0
    step_kinds: list[str] = []

    for ex in exercises:
        if ex.get("isGroup") is True:
            step_count -= 1
            continue
        target_type = ex.get("targetType")
        target_val = ex.get("targetValue")
        exercise_type = ex.get("exerciseType")
        kind = kind_by_type.get(exercise_type if isinstance(exercise_type, int) else 2, "training")
        sets = ex.get("sets") if isinstance(ex.get("sets"), int) and ex.get("sets") > 0 else 1

        if len(step_kinds) < 24:
            group_id = str(ex.get("groupId", "0"))
            group = groups.get(group_id)
            if group is None:
                step_kinds.append(kind)
            elif group_id not in emitted_groups:
                emitted_groups.add(group_id)
                children = [
                    child for child in exercises if str(child.get("groupId", "0")) == group_id
                ]
                group_sets = group.get("sets")
                repeat_count = group_sets if isinstance(group_sets, int) and group_sets > 0 else 1
                for _ in range(repeat_count):
                    for child in children:
                        if len(step_kinds) == 24:
                            break
                        child_type = child.get("exerciseType")
                        child_kind = kind_by_type.get(
                            child_type if isinstance(child_type, int) else 2, "training"
                        )
                        step_kinds.append(child_kind)

        if isinstance(target_val, (int, float)) and target_val > 0:
            val = float(target_val * sets)
            if target_type == 2:  # time target in seconds
                total_time += int(val)
            elif target_type == 5:  # COROS distance target in centimeters
                total_distance += val / 100.0
            elif target_type == 1:  # legacy distance target in meters (or cm if >= 100000)
                dist = val / 100.0 if val >= 100000 else val
                total_distance += dist

    return step_count, total_time, total_distance, step_kinds


@router.get("/coros/library", response_model=list[CorosLibraryWorkout])
async def list_coros_library_workouts(
    db: AsyncSession = Depends(get_db_session),
) -> list[CorosLibraryWorkout]:
    """List the athlete's saved COROS workout library with metrics."""
    try:
        client = await _coros_client(db)
        data = await client.post_training_hub("/training/program/query", {})
        if not isinstance(data, list):
            return []

        valid_items = [item for item in data if isinstance(item, dict) and item.get("id") is not None]
        if not valid_items:
            return []

        async def fetch_item_metrics(item: dict[str, object]) -> CorosLibraryWorkout:
            program_id = str(item["id"])
            name = str(item.get("name") or "Workout")
            sport = _sport_from_type(item.get("sportType"))

            step_count, total_time, total_distance, step_kinds = _calculate_program_summary(item)
            fallback = CorosLibraryWorkout(
                id=program_id,
                name=name,
                sport=sport,
                step_count=step_count if step_count > 0 else None,
                total_time=total_time if total_time > 0 else None,
                total_distance=total_distance if total_distance > 0 else None,
                step_kinds=step_kinds,
            )

            # Query items can include a cooldown's time but omit the main distance target.
            try:
                detail = await client.get_training_hub(
                    "/training/program/detail",
                    {"id": program_id, "supportRestExercise": 1},
                )
                if isinstance(detail, dict):
                    sc, tt, td, sk = _calculate_program_summary(detail)
                    return CorosLibraryWorkout(
                        id=program_id,
                        name=str(detail.get("name") or name),
                        sport=_sport_from_type(detail.get("sportType")) if detail.get("sportType") else sport,
                        step_count=sc if sc > 0 else None,
                        total_time=tt if tt > 0 else None,
                        total_distance=td if td > 0 else None,
                        step_kinds=sk,
                    )
            except Exception:
                pass

            return fallback

        workouts = await asyncio.gather(*[fetch_item_metrics(item) for item in valid_items[:30]])
        return list(workouts)
    except CorosApiClientError as exc:
        raise HTTPException(status_code=502, detail=f"COROS Calendar unavailable: {exc}") from exc


@router.get("/coros/library/{program_id}", response_model=CorosWorkoutEditorData)
async def get_coros_library_workout(
    program_id: str,
    date: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"),
    db: AsyncSession = Depends(get_db_session),
) -> CorosWorkoutEditorData:
    """Load one saved workout definition into the editor for scheduling."""
    _coros_day(date)
    try:
        data = await (await _coros_client(db)).get_training_hub(
            "/training/program/detail",
            {"id": program_id, "supportRestExercise": 1},
        )
        if not isinstance(data, dict):
            raise HTTPException(status_code=404, detail="COROS saved workout not found.")
        return _draft_from_program(
            f"library:{program_id}", _coros_day(date), cast("ScheduleObject", data)
        )
    except CorosApiClientError as exc:
        raise HTTPException(status_code=502, detail=f"COROS Calendar unavailable: {exc}") from exc


@router.delete("/coros/library/{program_id}", status_code=204)
async def delete_coros_library_workout(
    program_id: str,
    request: DeleteCorosWorkout,
    db: AsyncSession = Depends(get_db_session),
) -> None:
    """Permanently delete one saved COROS workout library entry."""
    if not program_id.strip():
        raise HTTPException(status_code=422, detail="A COROS library workout ID is required.")
    try:
        await (await _coros_client(db)).post_training_hub("/training/program/delete", [program_id])
    except CorosApiClientError as exc:
        raise HTTPException(status_code=502, detail=f"COROS Calendar unavailable: {exc}") from exc


@router.put("/coros/workouts/{uid:path}", response_model=TrainingEvent)
async def edit_coros_workout(
    uid: str,
    request: ConfirmedCorosWorkout,
    db: AsyncSession = Depends(get_db_session),
) -> TrainingEvent:
    """Replace one scheduled occurrence after recalculating it in COROS."""
    client = await _coros_client(db)
    try:
        entity, previous, happen_day = await _scheduled_match(client, uid)
        if _coros_day(request.draft.date) != happen_day:
            moved = await _schedule_new_workout(client, request.draft)
            await client.post_training_hub(
                "/training/schedule/update",
                {
                    "versionObjects": [
                        {
                            "id": entity["idInPlan"],
                            "planProgramId": entity.get("planProgramId", entity["idInPlan"]),
                            "planId": entity.get("planId", ""),
                            "status": 3,
                        }
                    ],
                    "pbVersion": previous.get("pbVersion", 2),
                },
            )
            return moved
        program = _build_coros_program(request.draft)
        for key in ("id", "idInPlan", "authorId", "userId", "version", "createTimestamp"):
            if key in previous:
                program[key] = previous[key]
        calculated = _apply_calculation(
            program, await client.post_training_hub("/training/program/calculate", program)
        )
        await client.post_training_hub(
            "/training/schedule/update",
            {
                "entities": [entity],
                "programs": [calculated],
                "versionObjects": [
                    {
                        "id": entity["idInPlan"],
                        "status": 2,
                        "planProgramId": entity.get("planProgramId", entity["idInPlan"]),
                        "planId": entity.get("planId", ""),
                    }
                ],
                "pbVersion": calculated["pbVersion"],
            },
        )
        for event in _parse_coros_schedule(
            await client.fetch_training_schedule(happen_day, happen_day)
        ):
            if event.uid == uid:
                return event
        raise HTTPException(
            status_code=502, detail="COROS accepted the edit but did not return it on reread."
        )
    except CorosApiClientError as exc:
        raise HTTPException(status_code=502, detail=f"COROS Calendar unavailable: {exc}") from exc


@router.post("/coros/workouts/{uid:path}/move", response_model=TrainingEvent)
async def move_coros_workout(
    uid: str,
    request: MoveCorosWorkout,
    db: AsyncSession = Depends(get_db_session),
) -> TrainingEvent:
    """Move safely by adding the destination before deleting the source occurrence."""
    client = await _coros_client(db)
    try:
        entity, program, old_day = await _scheduled_match(client, uid)
        new_day = _coros_day(request.date)
        if new_day == old_day:
            return next(
                event
                for event in _parse_coros_schedule(
                    await client.fetch_training_schedule(old_day, old_day)
                )
                if event.uid == uid
            )
        copied = dict(program)
        copied["id"] = "0"
        copied["idInPlan"] = "0"
        schedule = await client.fetch_training_schedule(new_day, new_day)
        max_id = schedule.get("maxIdInPlan")
        new_id = int(max_id) + 1 if isinstance(max_id, (int, float, str)) else 1
        copied["idInPlan"] = new_id
        new_entity: ScheduleObject = {
            "happenDay": new_day,
            "idInPlan": new_id,
            "sortNoInSchedule": entity.get("sortNoInSchedule", 1),
        }
        if isinstance(copied.get("exerciseBarChart"), list):
            new_entity["exerciseBarChart"] = copied["exerciseBarChart"]
        await client.post_training_hub(
            "/training/schedule/update",
            {
                "entities": [new_entity],
                "programs": [copied],
                "versionObjects": [{"id": new_id, "status": 1}],
                "pbVersion": copied.get("pbVersion", 2),
            },
        )
        await client.post_training_hub(
            "/training/schedule/update",
            {
                "versionObjects": [
                    {
                        "id": entity["idInPlan"],
                        "planProgramId": entity.get("planProgramId", entity["idInPlan"]),
                        "planId": entity.get("planId", ""),
                        "status": 3,
                    }
                ],
                "pbVersion": program.get("pbVersion", 2),
            },
        )
        for event in _parse_coros_schedule(await client.fetch_training_schedule(new_day, new_day)):
            if event.uid.endswith(f":{new_id}:{new_day}"):
                return event
        raise HTTPException(
            status_code=502, detail="COROS moved the workout but did not return it on reread."
        )
    except CorosApiClientError as exc:
        raise HTTPException(status_code=502, detail=f"COROS Calendar unavailable: {exc}") from exc


@router.delete("/coros/workouts/{uid:path}", status_code=204)
async def delete_coros_workout(
    uid: str,
    request: DeleteCorosWorkout,
    db: AsyncSession = Depends(get_db_session),
) -> None:
    """Delete one manually confirmed scheduled COROS workout and verify it is absent."""
    client = await _coros_client(db)
    try:
        entity, program, happen_day = await _scheduled_match(client, uid)
        await client.post_training_hub(
            "/training/schedule/update",
            {
                "versionObjects": [
                    {
                        "id": entity["idInPlan"],
                        "planProgramId": entity.get("planProgramId", entity["idInPlan"]),
                        "planId": entity.get("planId", ""),
                        "status": 3,
                    }
                ],
                "pbVersion": program.get("pbVersion", 2),
            },
        )
        if any(
            event.uid == uid
            for event in _parse_coros_schedule(
                await client.fetch_training_schedule(happen_day, happen_day)
            )
        ):
            raise HTTPException(
                status_code=502, detail="COROS did not remove the workout on reread."
            )
    except CorosApiClientError as exc:
        raise HTTPException(status_code=502, detail=f"COROS Calendar unavailable: {exc}") from exc


@router.get("/events", response_model=list[TrainingEvent])
async def get_training_plan_events(
    days_back: int = Query(default=30, ge=0, le=365),
    days_forward: int = Query(default=60, ge=0, le=365),
    source: CalendarSource = Query(default="ical"),
    db: AsyncSession = Depends(get_db_session),
) -> list[TrainingEvent]:
    """Return training plan events within a window around today."""
    if source == "coros":
        return await _fetch_coros_calendar(days_back, days_forward, db)
    events = await _fetch_and_parse_ical()

    today = datetime.date.today()
    window_start = today - datetime.timedelta(days=days_back)
    window_end = today + datetime.timedelta(days=days_forward)

    filtered: list[TrainingEvent] = []
    for ev in events:
        try:
            # Parse just the date portion for comparison
            start_date = datetime.date.fromisoformat(ev.start[:10])
        except ValueError:
            continue
        if window_start <= start_date <= window_end:
            filtered.append(ev)

    filtered.sort(key=lambda e: e.start)
    return filtered


@router.get("/today", response_model=list[TrainingEvent])
async def get_today_events() -> list[TrainingEvent]:
    """Return training plan events scheduled for today."""
    events = await _fetch_and_parse_ical()
    today_str = datetime.date.today().isoformat()

    return [ev for ev in events if ev.start[:10] == today_str]
