from datetime import datetime

from src.parsers.fit_parser import ParsedFitFile, ParsedSwimLength
from src.swim_metrics import (
    active_swim_pace_s_100m,
    swim_length_metrics_from_parsed_files,
    swim_length_splits_by_lap,
)


def test_swim_length_metrics_derive_swolf_and_distance_per_stroke() -> None:
    result = swim_length_metrics_from_parsed_files(
        [
            ParsedFitFile(
                swim_lengths=[
                    ParsedSwimLength(
                        start_time=datetime(2026, 9, 2, 8),
                        elapsed_s=30.5,
                        distance_m=20.0,
                        stroke_count=10,
                        stroke_rate_spm=20,
                        stroke_type="freestyle",
                    )
                ]
            )
        ]
    )

    assert result == [
        {
            "start_time": "2026-09-02T08:00:00",
            "elapsed_s": 30.5,
            "distance_m": 20.0,
            "stroke_count": 10,
            "stroke_rate_spm": 20,
            "stroke_type": "freestyle",
            "swolf": 40.5,
            "distance_per_stroke_m": 2.0,
        }
    ]


def test_swim_length_splits_use_raw_length_time_not_preceding_rest() -> None:
    result = swim_length_splits_by_lap(
        [
            {
                "start_time": "2026-09-02T08:00:00+00:00",
                "elapsed_s": 20.0,
                "distance_m": 20.0,
                "stroke_rate_spm": 18,
            },
            {
                "start_time": "2026-09-02T08:00:50+00:00",
                "elapsed_s": 30.0,
                "distance_m": 20.0,
                "stroke_rate_spm": 20,
            }
        ],
        [("12", 40.0, 90.0)],
    )

    assert result == {
        "12": [
            {
                "start_elapsed_s": 50.0,
                "end_elapsed_s": 80.0,
                "elapsed_s": 30.0,
                "distance_m": 20.0,
                "avg_speed_mps": 20 / 30,
                "avg_cadence": 20,
            }
        ]
    }


def test_active_swim_pace_uses_only_active_fit_lengths() -> None:
    assert active_swim_pace_s_100m(
        [
            {"elapsed_s": 30.0, "distance_m": 20.0},
            {"elapsed_s": 30.0, "distance_m": 20.0},
        ]
    ) == 150
