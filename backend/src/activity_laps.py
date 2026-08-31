"""Shared activity-lap labels and distance-split calculations."""

from src.db.models import ActivityRecord

PauseInterval = tuple[float, float]

_HYROX_EXERCISE_NAMES = {
    "T1064": "Dumbbell Lunges",
    "T1207": "Indoor Rower",
    "T1310": "Farmer's Walk",
    "T1393": "Ski Erg",
    "T1394": "Sled Push",
    "T1395": "Sled Pull",
    "T1396": "Burpee Broad Jumps",
    "T1397": "Wall Balls",
}


def hyrox_lap_detail(lap_trigger: str | None) -> tuple[str | None, str | None]:
    if not lap_trigger or not lap_trigger.startswith("coros_hyrox:"):
        return None, None
    _, exercise_key, load_unit = lap_trigger.split(":", maxsplit=2)
    return _HYROX_EXERCISE_NAMES.get(exercise_key, "Functional"), load_unit


def swim_lap_name(lap_trigger: str | None) -> str | None:
    if not lap_trigger or not lap_trigger.startswith("coros_swim"):
        return None
    stroke = lap_trigger.removeprefix("coros_swim:").replace("_", " ")
    return stroke.title() if stroke and stroke != "coros swim" else "Swim"


def lap_type(lap_trigger: str | None) -> str | None:
    coros_types = {
        "coros_warmup": "warmup",
        "coros_training": "training",
        "coros_cooldown": "cooldown",
        "coros_rest": "rest",
        "coros_run": "run",
        "coros_ride": "ride",
    }
    if lap_trigger in coros_types:
        return coros_types[lap_trigger]
    if lap_trigger == "coros_functional" or (lap_trigger or "").startswith("coros_hyrox:"):
        return "functional"
    if (lap_trigger or "").startswith("coros_swim"):
        return "swim"
    return None


def training_time_s(timer_time_s: float | None, rest_time_s: float) -> float | None:
    """Return timer time excluding explicitly labelled COROS rest intervals."""
    if timer_time_s is None:
        return None
    return max(0.0, timer_time_s - rest_time_s)


def distance_splits(
    records: list[ActivityRecord],
    chunk_distance_m: float,
    source_lap_distances: list[float] | None = None,
    source_lap_start_elapsed: list[float] | None = None,
    pause_intervals: list[PauseInterval] | None = None,
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

    pauses = pause_intervals or []

    def active_elapsed(wall_elapsed_s: float) -> float:
        return max(0.0, wall_elapsed_s - sum(
            max(0.0, min(wall_elapsed_s, end) - start)
            for start, end in pauses
            if wall_elapsed_s > start
        ))

    def wall_elapsed(active_elapsed_s: float) -> float:
        paused_before_s = 0.0
        for start, end in pauses:
            if active_elapsed_s < start - paused_before_s:
                break
            paused_before_s += end - start
        return active_elapsed_s + paused_before_s

    splits: list[dict[str, float | int | None]] = []
    source_distance_total = sum(source_lap_distances or [])
    source_origin = end_distance - source_distance_total if source_distance_total else start_distance
    segment_start_distance = source_origin
    segment_start_elapsed = (
        records[0].elapsed_s if records[0].elapsed_s is not None else start_elapsed
    )
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
        heart_rates = [
            record.heart_rate_bpm
            for record in segment_records
            if record.heart_rate_bpm is not None
        ]
        powers = [
            record.power_w for record in segment_records if record.power_w is not None
        ]
        cadences = [
            record.cadence for record in segment_records if record.cadence is not None
        ]
        elapsed_s = max(0.0, active_elapsed(segment_end_elapsed) - active_elapsed(segment_start_elapsed))
        distance_m = max(0.0, segment_end_distance - segment_start_distance)
        splits.append(
            {
                "lap_index": len(splits),
                "start_elapsed_s": segment_start_elapsed,
                "end_elapsed_s": segment_end_elapsed,
                "source_lap_index": lap_end_index if lap_end_distances and lap_end_index < len(lap_end_distances) else None,
                "elapsed_s": elapsed_s,
                "distance_m": distance_m,
                "avg_hr_bpm": round(sum(heart_rates) / len(heart_rates))
                if heart_rates
                else None,
                "max_hr_bpm": max(heart_rates) if heart_rates else None,
                "avg_speed_mps": distance_m / elapsed_s if elapsed_s > 0 else None,
                "avg_power_w": round(sum(powers) / len(powers)) if powers else None,
                "avg_cadence": round(sum(cadences) / len(cadences)) if cadences else None,
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
            fraction = (next_split_distance - previous_distance) / (
                current.distance_m - previous_distance
            )
            crossing_active_elapsed = active_elapsed(previous_elapsed) + fraction * (
                active_elapsed(current.elapsed_s) - active_elapsed(previous_elapsed)
            )
            crossing_elapsed = wall_elapsed(crossing_active_elapsed)
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
