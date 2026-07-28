from src.metrics.derived import compute_cardio_fitness_age, compute_daily_strain


def test_daily_strain_is_training_load_dominant_without_double_counting_movement() -> None:
    assert compute_daily_strain(0) == 0.0
    assert compute_daily_strain(0, steps=10_000, active_calories=500) == 0.6
    assert compute_daily_strain(100, steps=10_000, active_calories=500) == 3.0
    assert compute_daily_strain(500, steps=10_000, active_calories=500) == 10.1
    assert compute_daily_strain(1_000, steps=10_000, active_calories=500) == 15.1


def test_cardio_fitness_age_uses_sex_specific_hunt_reference() -> None:
    assert compute_cardio_fitness_age(vo2max=60, sex="male") == 18
    assert compute_cardio_fitness_age(vo2max=54, sex="male") == 25
    assert compute_cardio_fitness_age(vo2max=43, sex="female") == 25
    assert compute_cardio_fitness_age(vo2max=51.5, sex="male") == 30
