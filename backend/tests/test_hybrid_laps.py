from datetime import datetime, timedelta

from src.api.routes.activity_routes import _interval_hr_recovery
from src.db.models import Activity, ActivityLap, ActivityRecord, SportType
from src.sync.sync_manager import _detail_activity_laps, _detail_activity_records


def test_hyrox_detail_laps_remove_helpers_and_preserve_loads() -> None:
    activity = Activity(
        id="activity-id",
        sport=SportType.OTHER,
        subsport="1200",
        start_time=datetime(2026, 7, 29, 15, 15),
    )
    raw_detail = {
        "lapList": [
            {
                "lapItemList": [
                    {
                        "exerciseType": 2,
                        "mode": 2,
                        "startTimestamp": 100000,
                        "time": 8149,
                        "distance": 50000,
                        "actualValue": 20628,
                        "avgHr": 146,
                    },
                    {
                        "exerciseType": 2,
                        "mode": 14,
                        "startTimestamp": 108149,
                        "time": 29178,
                        "actualValue": 100000,
                        "targetType": 5,
                        "exerciseNameKey": "T1393",
                        "avgHr": 140,
                    },
                    {
                        "exerciseType": 2,
                        "mode": 16,
                        "startTimestamp": 108149,
                        "time": 29178,
                        "actualValue": 100000,
                        "targetType": 5,
                        "exerciseNameKey": "T1393",
                    },
                    {
                        "exerciseType": 2,
                        "mode": 14,
                        "startTimestamp": 137327,
                        "time": 41907,
                        "actualValue": 100,
                        "targetType": 3,
                        "exerciseNameKey": "T1397",
                        "avgHr": 146,
                    },
                ]
            }
        ],
        "frequencyList": [
            {
                "timestamp": 100000,
                "heart": 146,
                "speed": 400,
                "distance": 250,
                "power": 172,
                "groundTime": 262,
                "cadenceLength": 100,
                "verticalStrideRatio": 86,
                "verticalVibration": 81,
            },
            {
                "timestamp": 108149,
                "heart": 140,
                "cadence": 154,
                "distance": 0,
            },
        ],
    }

    laps = _detail_activity_laps(activity, raw_detail)
    records = _detail_activity_records(activity, raw_detail)

    assert [(lap.lap_index, lap.distance_m, lap.lap_trigger) for lap in laps] == [
        (1, 500, "coros_run"),
        (2, 1000, "coros_hyrox:T1393:m"),
        (3, 100, "coros_hyrox:T1397:reps"),
    ]
    assert laps[0].avg_speed_mps is not None
    assert laps[1].avg_speed_mps is None
    assert laps[1].start_time == datetime(2026, 7, 29, 15, 16, 21, 490000)
    assert [(record.elapsed_s, record.speed_mps, record.cadence) for record in records] == [
        (0, 2.5, None),
        (81.49, None, 154),
    ]
    assert records[0].power_w == 172
    assert records[0].ground_time_ms == 262
    assert records[0].stride_length_cm == 100
    assert records[0].stride_ratio_pct == 8.6
    assert records[0].stride_height_cm == 8.1


def test_structured_run_uses_coros_workout_step_labels() -> None:
    activity = Activity(
        id="activity-id",
        sport=SportType.RUN,
        subsport="100",
        start_time=datetime(2026, 7, 28, 19, 43, 15),
    )
    raw_detail = {
        "lapList": [
            {
                "lapItemList": [
                    {"exerciseType": 1, "mode": 4, "time": 6000, "distance": 12969},
                    {"exerciseType": 2, "mode": 2, "time": 2000, "distance": 9324},
                    {"exerciseType": 4, "mode": 3, "time": 6198, "distance": 10115},
                    {"exerciseType": 3, "mode": 5, "time": 18920, "distance": 22605},
                ]
            }
        ]
    }

    laps = _detail_activity_laps(activity, raw_detail)

    assert [lap.lap_trigger for lap in laps] == [
        "coros_warmup",
        "coros_training",
        "coros_rest",
        "coros_cooldown",
    ]


def test_swim_uses_summary_phases_instead_of_length_group() -> None:
    activity = Activity(
        id="activity-id",
        sport=SportType.SWIM,
        subsport="300",
        start_time=datetime(2026, 7, 24, 17, 46, 41),
    )
    raw_detail = {
        "lapList": [
            {
                "type": 3,
                "lapItemList": [
                    {"exerciseType": 2, "mode": 2, "time": 6000, "distance": 2000},
                    {"exerciseType": 2, "mode": 2, "time": 6000, "distance": 2000},
                ],
            },
            {
                "type": 2,
                "lapItemList": [
                    {"exerciseType": 1, "mode": 4, "time": 34493, "distance": 20000},
                    {
                        "exerciseType": 2,
                        "mode": 2,
                        "time": 14472,
                        "distance": 10000,
                    },
                    {"exerciseType": 4, "mode": 3, "time": 3195, "distance": 2000},
                    {"exerciseType": 3, "mode": 5, "time": 34285, "distance": 20000},
                ],
            },
        ]
    }

    laps = _detail_activity_laps(activity, raw_detail)

    assert [lap.lap_trigger for lap in laps] == [
        "coros_swim:warm_up",
        "coros_swim",
        "coros_rest",
        "coros_swim:cool_down",
    ]
    assert [(lap.distance_m, lap.elapsed_s) for lap in laps] == [
        (200, 344.93),
        (100, 144.72),
        (20, 31.95),
        (200, 342.85),
    ]


def test_ride_maps_only_structured_workout_phases() -> None:
    activity = Activity(
        id="activity-id",
        sport=SportType.RIDE,
        subsport="201",
        start_time=datetime(2026, 7, 31, 7, 0),
    )
    unstructured = {
        "lapList": [
            {
                "type": 2,
                "lapItemList": [
                    {"exerciseType": 0, "mode": 0, "time": 141829, "distance": 0},
                ],
            }
        ]
    }
    structured = {
        "lapList": [
            {
                "type": 2,
                "lapItemList": [
                    {"exerciseType": 1, "mode": 4, "time": 60000, "distance": 500000},
                    {"exerciseType": 2, "mode": 2, "time": 120000, "distance": 1500000},
                    {"exerciseType": 4, "mode": 3, "time": 30000, "distance": 100000},
                    {"exerciseType": 3, "mode": 5, "time": 60000, "distance": 500000},
                ],
            }
        ]
    }

    assert _detail_activity_laps(activity, unstructured) == []
    assert [lap.lap_trigger for lap in _detail_activity_laps(activity, structured)] == [
        "coros_warmup",
        "coros_training",
        "coros_rest",
        "coros_cooldown",
    ]


def test_interval_hr_recovery_uses_rest_phase_boundaries() -> None:
    start = datetime(2026, 7, 30, 19, 9, 40)
    lap = ActivityLap(
        activity_id="activity-id",
        lap_index=7,
        start_time=start,
        elapsed_s=180,
        lap_trigger="coros_rest",
    )
    records = [
        ActivityRecord(
            activity_id="activity-id",
            timestamp=start,
            elapsed_s=0,
            heart_rate_bpm=172,
        ),
        ActivityRecord(
            activity_id="activity-id",
            timestamp=start + timedelta(seconds=180),
            elapsed_s=180,
            heart_rate_bpm=139,
        ),
    ]

    assert _interval_hr_recovery([lap], records) == {7: 33}
