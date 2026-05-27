"""Derived metrics: training load ratios, efficiency, cardiac drift.

All functions are pure: data in, computed values out. No DB mutations.
These are app-derived metrics, clearly distinct from vendor metrics.
"""

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class TrainingLoadMetrics:
    """Computed training load analytics for a period."""

    acute_load: float
    chronic_load: float
    acwr: float | None
    monotony: float | None
    strain: float | None
    ramp_rate: float | None


@dataclass(frozen=True)
class EfficiencyMetrics:
    """Per-activity efficiency computations."""

    efficiency_factor: float | None
    cardiac_drift_pct: float | None
    hr_quality_flag: str | None


def compute_training_load(
    daily_loads: list[float],
    acute_window: int = 7,
    chronic_window: int = 28,
) -> TrainingLoadMetrics:
    """Compute ACWR, monotony, and strain from a series of daily load values.

    Args:
        daily_loads: List of daily training load values, most recent last.
        acute_window: Days for acute (short-term) load average.
        chronic_window: Days for chronic (long-term) load average.

    Returns:
        TrainingLoadMetrics with computed values.
    """
    if len(daily_loads) < acute_window:
        return TrainingLoadMetrics(
            acute_load=0.0,
            chronic_load=0.0,
            acwr=None,
            monotony=None,
            strain=None,
            ramp_rate=None,
        )

    acute_slice = daily_loads[-acute_window:]
    acute_load = sum(acute_slice) / acute_window

    chronic_slice = (
        daily_loads[-chronic_window:] if len(daily_loads) >= chronic_window else daily_loads
    )
    chronic_load = sum(chronic_slice) / len(chronic_slice)

    acwr = acute_load / chronic_load if chronic_load > 0 else None

    # Monotony = mean / stddev of acute window
    mean_acute = acute_load
    variance = sum((x - mean_acute) ** 2 for x in acute_slice) / acute_window
    stddev = math.sqrt(variance) if variance > 0 else 0.0
    monotony = mean_acute / stddev if stddev > 0 else None

    # Strain = weekly load * monotony
    weekly_load = sum(acute_slice)
    strain = weekly_load * monotony if monotony is not None else None

    # Ramp rate = acute - chronic
    ramp_rate = acute_load - chronic_load

    return TrainingLoadMetrics(
        acute_load=round(acute_load, 2),
        chronic_load=round(chronic_load, 2),
        acwr=round(acwr, 3) if acwr is not None else None,
        monotony=round(monotony, 3) if monotony is not None else None,
        strain=round(strain, 2) if strain is not None else None,
        ramp_rate=round(ramp_rate, 2),
    )


def compute_efficiency(
    speeds_mps: list[float],
    heart_rates_bpm: list[int],
) -> EfficiencyMetrics:
    """Compute efficiency factor and cardiac drift from paired speed/HR data.

    Args:
        speeds_mps: Per-record speed values in m/s.
        heart_rates_bpm: Per-record heart rate values in bpm.

    Returns:
        EfficiencyMetrics with computed values.
    """
    if len(speeds_mps) < 10 or len(heart_rates_bpm) < 10:
        return EfficiencyMetrics(
            efficiency_factor=None,
            cardiac_drift_pct=None,
            hr_quality_flag="insufficient_data",
        )

    valid_pairs = [
        (s, hr)
        for s, hr in zip(speeds_mps, heart_rates_bpm, strict=False)
        if s > 0 and 30 < hr < 250
    ]

    if len(valid_pairs) < 10:
        return EfficiencyMetrics(
            efficiency_factor=None,
            cardiac_drift_pct=None,
            hr_quality_flag="low_hr_confidence",
        )

    avg_speed = sum(s for s, _ in valid_pairs) / len(valid_pairs)
    avg_hr = sum(hr for _, hr in valid_pairs) / len(valid_pairs)
    efficiency_factor = avg_speed / avg_hr if avg_hr > 0 else None

    # Cardiac drift: compare first half HR to second half HR at similar pace
    midpoint = len(valid_pairs) // 2
    first_half_hr = sum(hr for _, hr in valid_pairs[:midpoint]) / midpoint
    second_half_hr = sum(hr for _, hr in valid_pairs[midpoint:]) / (len(valid_pairs) - midpoint)

    cardiac_drift_pct = None
    if first_half_hr > 0:
        cardiac_drift_pct = ((second_half_hr - first_half_hr) / first_half_hr) * 100

    return EfficiencyMetrics(
        efficiency_factor=round(efficiency_factor, 5) if efficiency_factor else None,
        cardiac_drift_pct=round(cardiac_drift_pct, 2) if cardiac_drift_pct is not None else None,
        hr_quality_flag=None,
    )


def compute_hr_zone_distribution(
    heart_rates_bpm: list[int],
    max_hr: int,
) -> dict[str, float]:
    """Compute percentage of time spent in each HR zone.

    Zones:
        Z1: < 60% max HR
        Z2: 60-70% max HR
        Z3: 70-80% max HR
        Z4: 80-90% max HR
        Z5: > 90% max HR

    Args:
        heart_rates_bpm: Per-record HR values.
        max_hr: User's maximum heart rate.

    Returns:
        Dict mapping zone name to percentage of time.
    """
    if not heart_rates_bpm or max_hr <= 0:
        return {}

    zones = {"Z1": 0, "Z2": 0, "Z3": 0, "Z4": 0, "Z5": 0}
    total = 0

    for hr in heart_rates_bpm:
        if hr <= 0 or hr > 250:
            continue
        total += 1
        pct = hr / max_hr
        if pct < 0.60:
            zones["Z1"] += 1
        elif pct < 0.70:
            zones["Z2"] += 1
        elif pct < 0.80:
            zones["Z3"] += 1
        elif pct < 0.90:
            zones["Z4"] += 1
        else:
            zones["Z5"] += 1

    if total == 0:
        return {}

    return {zone: round((count / total) * 100, 1) for zone, count in zones.items()}


def compute_daily_strain(daily_load: float) -> float:
    """Compute daily cardiovascular strain on a 0-21 logarithmic scale.
    
    Formula: Strain = 21 * (1 - e^(-0.0025 * load))
    This maps a training load of 0 to 0, 100 to ~4.6, 500 to ~15, and 1000 to ~19.3.
    """
    if daily_load <= 0:
        return 0.0
    strain = 21.0 * (1.0 - math.exp(-0.0025 * daily_load))
    return round(max(0.0, min(21.0, strain)), 1)


def compute_recovery_score(hrv_zscore: float | None, rhr_zscore: float | None) -> float | None:
    """Compute a 0-100% recovery score based on HRV and RHR z-scores."""
    if hrv_zscore is None and rhr_zscore is None:
        return None
        
    scores = []
    if hrv_zscore is not None:
        # Higher HRV is better
        score = 50 + (hrv_zscore * 25)
        scores.append(score)
        
    if rhr_zscore is not None:
        # Lower RHR is better
        score = 50 - (rhr_zscore * 25)
        scores.append(score)
        
    avg_score = sum(scores) / len(scores)
    return round(max(0.0, min(100.0, avg_score)), 1)


def compute_biological_age(vo2max: float, actual_age: int) -> int:
    """Estimate biological age using VO2 Max and chronological age.
    
    Uses a simplified unisex baseline: Expected VO2 = 55 - (0.45 * Age)
    """
    if actual_age <= 0 or vo2max <= 0:
        return actual_age
        
    expected_vo2 = 55.0 - (0.45 * actual_age)
    vo2_difference = expected_vo2 - vo2max
    
    # 1.5 years penalty/reward for every 1 point difference in VO2 Max
    bio_age = actual_age + (vo2_difference * 1.5)
    
    # Bound to somewhat realistic numbers (not less than 18, not more than 100)
    return int(max(18, min(100, round(bio_age))))
