"""Anomaly flag and efficiency derivation wired into the sync/detail paths."""

from datetime import date, timedelta

from src.api.routes.activity_routes import _efficiency_from_records
from src.db.models import ActivityRecord
from src.metrics.anomaly import check_daily_health_anomalies
from src.metrics.baselines import compute_rolling_baseline
from src.sync.sync_manager import _history_upto


def test_history_upto_excludes_future_days() -> None:
    day = date(2026, 3, 10)
    series = {day - timedelta(days=offset): float(offset) for offset in range(5)}
    series[day + timedelta(days=1)] = 99.0

    history = _history_upto(series, day)

    assert 99.0 not in history
    # offset 4 is the oldest day, so it sorts first; today's value (0.0) lands last.
    assert history == [4.0, 3.0, 2.0, 1.0, 0.0]


def test_history_upto_is_chronological_and_windowed() -> None:
    day = date(2026, 3, 10)
    series = {day - timedelta(days=offset): float(offset) for offset in range(40)}

    history = _history_upto(series, day, window=30)

    assert len(history) == 30
    assert history[-1] == 0.0  # most recent last, as compute_rolling_baseline expects


def test_stable_history_produces_no_anomaly_flags() -> None:
    baseline = compute_rolling_baseline([50.0] * 30)
    assert baseline is not None

    results = check_daily_health_anomalies(
        hrv=50.0,
        rhr=None,
        sleep_hours=None,
        hrv_baseline_mean=baseline.mean,
        hrv_baseline_std=baseline.std_dev,
        rhr_baseline_mean=None,
        rhr_baseline_std=None,
        sleep_baseline_mean=None,
        sleep_baseline_std=None,
    )

    assert results == []


def test_hrv_crash_is_flagged_low() -> None:
    history = [50.0, 52.0, 48.0, 51.0, 49.0, 50.0, 53.0, 47.0, 50.0, 51.0]
    baseline = compute_rolling_baseline(history)
    assert baseline is not None

    results = check_daily_health_anomalies(
        hrv=20.0,
        rhr=None,
        sleep_hours=None,
        hrv_baseline_mean=baseline.mean,
        hrv_baseline_std=baseline.std_dev,
        rhr_baseline_mean=None,
        rhr_baseline_std=None,
        sleep_baseline_mean=None,
        sleep_baseline_std=None,
    )

    assert [r.metric_name for r in results] == ["overnight_hrv"]
    assert results[0].direction == "low"
    assert results[0].severity == "critical"


def _record(speed: float | None, hr: int | None) -> ActivityRecord:
    return ActivityRecord(speed_mps=speed, heart_rate_bpm=hr)


def test_efficiency_drops_samples_missing_either_channel() -> None:
    # Misaligned channels would pair speed with the wrong HR without the filter.
    records = [_record(3.0, None), *[_record(3.0, 150) for _ in range(10)]]

    result = _efficiency_from_records(records)

    assert result.hr_quality_flag is None
    assert result.efficiency_factor == round(3.0 / 150, 5)


def test_efficiency_reports_insufficient_data_rather_than_guessing() -> None:
    result = _efficiency_from_records([_record(3.0, 150) for _ in range(9)])

    assert result.hr_quality_flag == "insufficient_data"
    assert result.efficiency_factor is None
    assert result.cardiac_drift_pct is None


def test_cardiac_drift_detects_rising_hr_at_steady_pace() -> None:
    records = [_record(3.0, 140) for _ in range(10)] + [_record(3.0, 154) for _ in range(10)]

    result = _efficiency_from_records(records)

    assert result.cardiac_drift_pct == 10.0
