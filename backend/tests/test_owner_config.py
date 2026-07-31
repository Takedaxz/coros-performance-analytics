from uuid import UUID

from pytest import MonkeyPatch

from src.config import Settings, get_settings
from src.db.owner import get_owner_id


def test_owner_user_id_defaults_to_legacy_and_accepts_override(
    monkeypatch: MonkeyPatch,
) -> None:
    assert Settings.model_fields["owner_user_id"].default == UUID(int=0)

    monkeypatch.setenv("OWNER_USER_ID", "11111111-1111-1111-1111-111111111111")
    assert Settings().owner_user_id == UUID(
        "11111111-1111-1111-1111-111111111111"
    )


def test_owner_id_uses_reconciled_settings() -> None:
    get_settings.cache_clear()
    try:
        settings = get_settings()
        settings.owner_user_id = UUID("22222222-2222-2222-2222-222222222222")

        assert get_owner_id() == "22222222-2222-2222-2222-222222222222"
    finally:
        get_settings.cache_clear()
