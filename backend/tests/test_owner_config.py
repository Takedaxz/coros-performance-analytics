from uuid import UUID

from pytest import MonkeyPatch

from src.config import Settings


def test_owner_user_id_defaults_to_legacy_and_accepts_override(
    monkeypatch: MonkeyPatch,
) -> None:
    assert Settings.model_fields["owner_user_id"].default == UUID(int=0)

    monkeypatch.setenv("OWNER_USER_ID", "11111111-1111-1111-1111-111111111111")
    assert Settings().owner_user_id == UUID(
        "11111111-1111-1111-1111-111111111111"
    )
