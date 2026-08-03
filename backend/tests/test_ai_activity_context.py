from datetime import datetime, timedelta

from src.ai.context_builder import _format_detailed_activity_context, _split_lines
from src.db.models import Activity, ActivityLap, ActivityRecord


def test_detailed_activity_context_keeps_segments_and_compresses_sensor_data() -> None:
    start = datetime(2026, 7, 29, 15, 15)
    activity = Activity(
        id="activity-id",
        sport="other",
        subsport="1200",
        title="Hybrid Fitness (Hyrox)",
        start_time=start,
        elapsed_time_s=360,
        distance_m=1_500,
        calories_kcal=80,
        avg_hr_bpm=142,
        max_hr_bpm=164,
        training_load_vendor=20,
    )
    laps = [
        ActivityLap(
            activity_id=activity.id,
            lap_index=1,
            start_time=start,
            elapsed_s=80,
            distance_m=500,
            avg_hr_bpm=146,
            max_hr_bpm=152,
            avg_speed_mps=3.0,
            avg_cadence=172,
            lap_trigger="coros_run",
        ),
        ActivityLap(
            activity_id=activity.id,
            lap_index=2,
            start_time=start + timedelta(seconds=80),
            elapsed_s=280,
            distance_m=1_000,
            avg_hr_bpm=140,
            max_hr_bpm=160,
            avg_cadence=154,
            lap_trigger="coros_hyrox:T1393:m",
        ),
    ]
    records = [
        ActivityRecord(
            activity_id=activity.id,
            timestamp=start + timedelta(seconds=elapsed),
            elapsed_s=elapsed,
            heart_rate_bpm=heart_rate,
            cadence=160,
            position_lat=13.7563 + elapsed / 1_000_000,
            position_long=100.5018 + elapsed / 1_000_000,
        )
        for elapsed, heart_rate in ((0, 120), (60, 135), (120, 145), (240, 150), (360, 142))
    ]

    context = _format_detailed_activity_context(
        [activity],
        {activity.id: laps},
        {activity.id: records},
    )

    assert "1 Run |" in context
    assert "2 Ski Erg |" in context
    assert "telemetry(average/peak):" in context
    assert "route: gps_points=5" in context
    assert "position_lat" not in context
    assert "13.7563" not in context
    assert "100.5018" not in context

    constrained = _format_detailed_activity_context(
        [activity],
        {activity.id: laps},
        {activity.id: records},
        char_budget=200,
    )
    assert "1 Run |" in constrained
    assert "2 Ski Erg |" in constrained
    assert "telemetry(average/peak):" not in constrained
    assert "Detail budget omitted 2 telemetry/route line(s)" in constrained


def test_run_splits_restart_inside_each_workout_phase() -> None:
    start = datetime(2026, 7, 23, 18, 34)
    activity = Activity(
        id="tempo-id",
        sport="run",
        title="Tempo",
        start_time=start,
        elapsed_time_s=3_077,
        distance_m=9_230,
    )
    phase_distances = [3_330.0, 4_410.0, 1_490.0]
    phase_durations = [1_237.0, 1_200.0, 640.0]
    laps = [
        ActivityLap(
            activity_id=activity.id,
            lap_index=index,
            start_time=start + timedelta(seconds=sum(phase_durations[: index - 1])),
            elapsed_s=duration,
            distance_m=distance,
        )
        for index, (distance, duration) in enumerate(
            zip(phase_distances, phase_durations, strict=True),
            1,
        )
    ]
    records = [
        ActivityRecord(
            activity_id=activity.id,
            timestamp=start + timedelta(seconds=distance / 3),
            elapsed_s=distance / 3,
            distance_m=float(distance),
            speed_mps=3,
            heart_rate_bpm=170,
        )
        for distance in range(0, 9_231, 10)
    ]

    lines = _split_lines(activity, laps, records)
    phase_starts = [
        index
        for index, line in enumerate(lines)
        if line.startswith("phase ") and not line.startswith("phase distance")
    ]
    phase_counts = [
        (phase_starts[index + 1] if index + 1 < len(phase_starts) else len(lines))
        - phase_start
        - 1
        for index, phase_start in enumerate(phase_starts)
    ]

    assert phase_counts == [4, 5, 2]
    assert any("dist=410m" in line for line in lines)


def test_split_lines_handles_source_lap_index_out_of_bounds() -> None:
    start = datetime(2026, 7, 29, 15, 15)
    activity = Activity(
        id="act-bounds-test",
        sport="run",
        start_time=start,
        elapsed_time_s=600,
        distance_m=2_000,
    )
    laps = [
        ActivityLap(
            activity_id=activity.id,
            lap_index=1,
            start_time=start,
            elapsed_s=300,
            distance_m=1_500,
        )
    ]
    records = [
        ActivityRecord(
            activity_id=activity.id,
            timestamp=start + timedelta(seconds=dist / 3),
            elapsed_s=dist / 3,
            distance_m=float(dist),
            speed_mps=3,
            heart_rate_bpm=150,
        )
        for dist in range(0, 2_001, 10)
    ]

    # Must not raise IndexError
    lines = _split_lines(activity, laps, records)
    assert isinstance(lines, list)

