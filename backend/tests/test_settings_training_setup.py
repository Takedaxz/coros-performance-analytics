import pytest
from pydantic import ValidationError

from src.api.routes.settings_routes import UserProfile


def test_user_profile_accepts_ai_training_setup() -> None:
    profile = UserProfile(
        gym_equipment=["machines", "cable"],
        strength_equipment_preference="machines_first",
        pool_length_m=25,
    )

    assert profile.gym_equipment == ["machines", "cable"]
    assert profile.strength_equipment_preference == "machines_first"
    assert profile.pool_length_m == 25


def test_user_profile_rejects_an_invalid_pool_length() -> None:
    with pytest.raises(ValidationError):
        UserProfile(pool_length_m=5)
