from datetime import datetime

from src.db.models import Activity
from src.sync.sync_manager import _detail_activity_laps, _detail_activity_records


def test_hyrox_detail_laps_remove_helpers_and_preserve_loads() -> None:
    activity = Activity(id="activity-id", start_time=datetime(2026, 7, 29, 15, 15))
    raw_detail = {
        "lapList": [
            {
                "lapItemList": [
                    {
                        "mode": 2,
                        "startTimestamp": 100000,
                        "time": 8149,
                        "distance": 50000,
                        "actualValue": 20628,
                        "avgHr": 146,
                    },
                    {
                        "mode": 14,
                        "startTimestamp": 108149,
                        "time": 29178,
                        "actualValue": 100000,
                        "targetType": 5,
                        "exerciseNameKey": "T1393",
                        "avgHr": 140,
                    },
                    {
                        "mode": 16,
                        "startTimestamp": 108149,
                        "time": 29178,
                        "actualValue": 100000,
                        "targetType": 5,
                        "exerciseNameKey": "T1393",
                    },
                    {
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


def test_structured_run_uses_coros_workout_step_labels() -> None:
    activity = Activity(id="activity-id", start_time=datetime(2026, 7, 28, 19, 43, 15))
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
