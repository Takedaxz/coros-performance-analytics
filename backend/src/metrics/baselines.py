"""Rolling baselines and normal range computation.

Computes individualized baselines for HRV, RHR, and sleep duration
using configurable rolling windows. All functions are pure.
"""

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class Baseline:
    """A rolling baseline with mean and normal range (mean +/- 1 SD)."""

    mean: float
    std_dev: float
    normal_low: float
    normal_high: float
    sample_count: int


def compute_rolling_baseline(
    values: list[float],
    window: int = 30,
) -> Baseline | None:
    """Compute a rolling baseline from a list of values.

    Args:
        values: Chronologically ordered values (most recent last).
        window: Number of recent values to use.

    Returns:
        Baseline with mean, std_dev, and normal range, or None if insufficient data.
    """
    if len(values) < 7:
        return None

    window_values = values[-window:] if len(values) >= window else values
    n = len(window_values)
    mean = sum(window_values) / n
    variance = sum((v - mean) ** 2 for v in window_values) / n
    std_dev = math.sqrt(variance)

    return Baseline(
        mean=round(mean, 2),
        std_dev=round(std_dev, 2),
        normal_low=round(mean - std_dev, 2),
        normal_high=round(mean + std_dev, 2),
        sample_count=n,
    )


def compute_sma(values: list[float], window: int) -> list[float | None]:
    """Compute simple moving average over a list of values.

    Args:
        values: Input values, chronologically ordered.
        window: SMA window size.

    Returns:
        List of SMA values, None for positions where window is not full.
    """
    result: list[float | None] = []
    for i in range(len(values)):
        if i < window - 1:
            result.append(None)
        else:
            window_slice = values[i - window + 1 : i + 1]
            result.append(round(sum(window_slice) / window, 2))
    return result


def compute_zscore(value: float, baseline: Baseline) -> float:
    """Compute z-score of a value against a baseline.

    Args:
        value: The value to score.
        baseline: The baseline to compare against.

    Returns:
        Z-score (number of standard deviations from mean).
    """
    if baseline.std_dev == 0:
        return 0.0
    return round((value - baseline.mean) / baseline.std_dev, 2)
