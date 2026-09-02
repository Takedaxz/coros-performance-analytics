"""Read pool-length metrics from a stored FIT activity file."""

from datetime import datetime
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile, is_zipfile

from src.parsers.fit_parser import ParsedFitFile, parse_fit_file

SwimLengthMetric = dict[str, float | int | str | None]
SwimLengthSplit = dict[str, float | int | None]


def swim_length_metrics_from_parsed_files(
    parsed_files: list[ParsedFitFile],
) -> list[SwimLengthMetric]:
    """Build graph and AI values from parsed active pool lengths."""
    metrics: list[SwimLengthMetric] = []
    for parsed_file in parsed_files:
        for length in parsed_file.swim_lengths:
            if length.distance_m is None or length.distance_m <= 0:
                continue
            metrics.append(
                {
                    "start_time": length.start_time.isoformat(),
                    "elapsed_s": round(length.elapsed_s, 2),
                    "distance_m": length.distance_m,
                    "stroke_count": length.stroke_count,
                    "stroke_rate_spm": length.stroke_rate_spm,
                    "stroke_type": length.stroke_type,
                    "swolf": round(length.elapsed_s + length.stroke_count, 1),
                    "distance_per_stroke_m": round(length.distance_m / length.stroke_count, 2),
                }
            )
    return metrics


def swim_length_splits_by_lap(
    lengths: list[SwimLengthMetric],
    lap_windows: list[tuple[str, float, float]],
) -> dict[str, list[SwimLengthSplit]]:
    """Assign FIT pool lengths to their COROS lap windows using elapsed time."""
    if not lengths:
        return {}
    first_start = lengths[0].get("start_time")
    if not isinstance(first_start, str):
        return {}
    origin = datetime.fromisoformat(first_start)
    splits: dict[str, list[SwimLengthSplit]] = {}
    for length in lengths:
        start_time = length.get("start_time")
        elapsed_s = length.get("elapsed_s")
        distance_m = length.get("distance_m")
        if (
            not isinstance(start_time, str)
            or not isinstance(elapsed_s, (int, float))
            or not isinstance(distance_m, (int, float))
            or elapsed_s <= 0
            or distance_m <= 0
        ):
            continue
        start_elapsed_s = (datetime.fromisoformat(start_time) - origin).total_seconds()
        lap_id = next(
            (
                candidate_id
                for candidate_id, lap_start_s, lap_end_s in lap_windows
                if lap_start_s <= start_elapsed_s < lap_end_s
            ),
            None,
        )
        if lap_id is None:
            continue
        stroke_rate = length.get("stroke_rate_spm")
        splits.setdefault(lap_id, []).append(
            {
                "start_elapsed_s": start_elapsed_s,
                "end_elapsed_s": start_elapsed_s + elapsed_s,
                "elapsed_s": float(elapsed_s),
                "distance_m": float(distance_m),
                "avg_speed_mps": float(distance_m) / float(elapsed_s),
                "avg_cadence": stroke_rate if isinstance(stroke_rate, (int, float)) else None,
            }
        )
    return splits


def active_swim_pace_s_100m(lengths: list[SwimLengthMetric]) -> int | None:
    """Return FIT active-length pace in seconds per 100 m."""
    active_time_s = sum(
        float(length["elapsed_s"])
        for length in lengths
        if isinstance(length.get("elapsed_s"), (int, float)) and length["elapsed_s"] > 0
    )
    active_distance_m = sum(
        float(length["distance_m"])
        for length in lengths
        if isinstance(length.get("distance_m"), (int, float)) and length["distance_m"] > 0
    )
    return round(active_time_s * 100 / active_distance_m) if active_distance_m > 0 else None


def swim_length_metrics(
    raw_file_store_path: str,
    source_filename: str | None,
) -> list[SwimLengthMetric]:
    """Return valid per-length stroke metrics without modifying the stored activity."""
    # ponytail: reparses FIT per detail read; cache parsed lengths if files grow large.
    if not source_filename or Path(source_filename).name != source_filename:
        return []
    path = Path(raw_file_store_path) / source_filename
    if not path.is_file():
        return []

    raw = path.read_bytes()
    fit_files = [raw]
    if is_zipfile(BytesIO(raw)):
        with ZipFile(BytesIO(raw)) as archive:
            fit_files = [
                archive.read(name)
                for name in archive.namelist()
                if name.lower().endswith(".fit")
            ]
    parsed_files = [parse_fit_file(fit_file) for fit_file in fit_files]
    return swim_length_metrics_from_parsed_files(parsed_files)
