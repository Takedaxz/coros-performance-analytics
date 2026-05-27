"""Anomaly detection for health and training metrics.

Z-score and IQR-based anomaly detection on HRV, RHR, sleep, and load.
All functions are pure.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class AnomalyResult:
    """Result of anomaly check for a single metric."""

    metric_name: str
    value: float
    is_anomaly: bool
    severity: str
    direction: str
    zscore: float | None = None
    message: str | None = None


def detect_zscore_anomaly(
    metric_name: str,
    value: float,
    mean: float,
    std_dev: float,
    threshold: float = 2.0,
) -> AnomalyResult:
    """Detect anomaly using z-score method.

    Args:
        metric_name: Name of the metric being checked.
        value: Current value.
        mean: Baseline mean.
        std_dev: Baseline standard deviation.
        threshold: Z-score threshold for anomaly (default: 2.0 = ~95th percentile).

    Returns:
        AnomalyResult with detection outcome.
    """
    if std_dev == 0:
        return AnomalyResult(
            metric_name=metric_name,
            value=value,
            is_anomaly=False,
            severity="none",
            direction="neutral",
            zscore=0.0,
        )

    zscore = (value - mean) / std_dev
    is_anomaly = abs(zscore) >= threshold
    direction = "high" if zscore > 0 else "low"

    severity = "none"
    if abs(zscore) >= 3.0:
        severity = "critical"
    elif abs(zscore) >= 2.5:
        severity = "high"
    elif abs(zscore) >= 2.0:
        severity = "moderate"

    message = None
    if is_anomaly:
        message = (
            f"{metric_name} is unusually {direction}: "
            f"{value:.1f} (z={zscore:.1f}, baseline={mean:.1f})"
        )

    return AnomalyResult(
        metric_name=metric_name,
        value=value,
        is_anomaly=is_anomaly,
        severity=severity,
        direction=direction,
        zscore=round(zscore, 2),
        message=message,
    )


def detect_iqr_outlier(
    metric_name: str,
    value: float,
    values: list[float],
    multiplier: float = 1.5,
) -> AnomalyResult:
    """Detect outlier using IQR method.

    Args:
        metric_name: Name of the metric.
        value: Value to check.
        values: Historical values to compute IQR from.
        multiplier: IQR multiplier for fence (1.5 = mild, 3.0 = extreme).

    Returns:
        AnomalyResult with detection outcome.
    """
    if len(values) < 10:
        return AnomalyResult(
            metric_name=metric_name,
            value=value,
            is_anomaly=False,
            severity="none",
            direction="neutral",
            message="Insufficient data for IQR analysis",
        )

    sorted_vals = sorted(values)
    n = len(sorted_vals)
    q1 = sorted_vals[n // 4]
    q3 = sorted_vals[(3 * n) // 4]
    iqr = q3 - q1

    lower_fence = q1 - multiplier * iqr
    upper_fence = q3 + multiplier * iqr

    is_outlier = value < lower_fence or value > upper_fence
    direction = "high" if value > upper_fence else ("low" if value < lower_fence else "neutral")

    severity = "none"
    if is_outlier:
        extreme_lower = q1 - 3.0 * iqr
        extreme_upper = q3 + 3.0 * iqr
        severity = "critical" if (value < extreme_lower or value > extreme_upper) else "moderate"

    message = None
    if is_outlier:
        message = (
            f"{metric_name} is an outlier ({direction}): "
            f"{value:.1f} (range: {lower_fence:.1f}-{upper_fence:.1f})"
        )

    return AnomalyResult(
        metric_name=metric_name,
        value=value,
        is_anomaly=is_outlier,
        severity=severity,
        direction=direction,
        message=message,
    )


def check_daily_health_anomalies(
    hrv: float | None,
    rhr: int | None,
    sleep_hours: float | None,
    hrv_baseline_mean: float | None,
    hrv_baseline_std: float | None,
    rhr_baseline_mean: float | None,
    rhr_baseline_std: float | None,
    sleep_baseline_mean: float | None,
    sleep_baseline_std: float | None,
) -> list[AnomalyResult]:
    """Run anomaly checks on a day's health metrics against baselines.

    Returns list of detected anomalies (only anomalous results).
    """
    results: list[AnomalyResult] = []

    if hrv is not None and hrv_baseline_mean is not None and hrv_baseline_std is not None:
        result = detect_zscore_anomaly("overnight_hrv", hrv, hrv_baseline_mean, hrv_baseline_std)
        if result.is_anomaly:
            results.append(result)

    if rhr is not None and rhr_baseline_mean is not None and rhr_baseline_std is not None:
        result = detect_zscore_anomaly(
            "resting_hr", float(rhr), rhr_baseline_mean, rhr_baseline_std
        )
        if result.is_anomaly:
            results.append(result)

    if (
        sleep_hours is not None
        and sleep_baseline_mean is not None
        and sleep_baseline_std is not None
    ):
        result = detect_zscore_anomaly(
            "sleep_duration", sleep_hours, sleep_baseline_mean, sleep_baseline_std
        )
        if result.is_anomaly:
            results.append(result)

    return results
