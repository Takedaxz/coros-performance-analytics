import json
from datetime import date
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

from src.mcp import coros_mcp_auth, daily_health_client, sleep_client
from src.sync import sync_manager


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "sleep_error", [None, RuntimeError('Authorization "expired"'), ValueError("Tool failed")]
)
async def test_sleep_sync_failure_survives_completion(
    monkeypatch: pytest.MonkeyPatch,
    sleep_error: Exception | None,
) -> None:
    db = MagicMock()
    db.flush = AsyncMock()
    db.commit = AsyncMock()
    client = MagicMock()
    client.login = AsyncMock()
    client.fetch_activities = AsyncMock(return_value=[])
    client.fetch_daily_metrics = AsyncMock(return_value=[])
    client.fetch_analyse = AsyncMock(return_value={})
    client.fetch_dashboard = AsyncMock(return_value={})
    monkeypatch.setattr(sync_manager, "CorosApiClient", lambda **kwargs: client)
    monkeypatch.setattr(
        sync_manager, "load_coros_credentials", AsyncMock(return_value=("email", "password"))
    )
    monkeypatch.setattr(
        sync_manager, "_resolve_sync_start_dates", AsyncMock(return_value=(date(2026, 9, 28),) * 4)
    )
    for name in (
        "_upsert_activities",
        "_upsert_user_heart_rate_profile",
        "_upsert_mcp_daily_health",
        "_upsert_daily_health",
        "_upsert_coros_recovery",
        "_upsert_coros_personal_records",
        "_upsert_coros_running_fitness",
        "_upsert_coros_training_distributions",
        "_upsert_fitness",
    ):
        monkeypatch.setattr(sync_manager, name, AsyncMock(return_value=0))
    monkeypatch.setattr(
        daily_health_client, "fetch_daily_health_via_mcp", AsyncMock(return_value=[])
    )
    monkeypatch.setattr(
        sleep_client, "fetch_sleep_via_mcp", AsyncMock(return_value=[], side_effect=sleep_error)
    )
    monkeypatch.setattr(sync_manager, "_upsert_sleep", AsyncMock(return_value=2))
    events: list[tuple[str, str]] = []

    result = await sync_manager.run_sync(
        db, "owner", on_event=lambda event, data: events.append((event, data))
    )

    assert result.status == "completed"
    event, data = events[-1]
    assert event == "complete"
    completion = json.loads(data)
    assert completion["warning"] == result.error_message
    if sleep_error:
        assert str(sleep_error) in result.error_message
        sleep_stage = json.loads(events[-2][1])
        assert sleep_stage["reason"] == str(sleep_error)
        assert result.records_upserted == 0
    else:
        assert result.error_message is None
        assert result.records_upserted == 2


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "description, expected",
    [
        ("Refresh token expired", "Reconnect COROS MCP in Settings"),
        ("Duplicate grant rejected", "Please wait before syncing again"),
    ],
)
async def test_rejected_refresh_preserves_tokens_and_reports_the_reason(
    monkeypatch: pytest.MonkeyPatch,
    description: str,
    expected: str,
) -> None:
    monkeypatch.setattr(
        coros_mcp_auth,
        "load_tokens",
        AsyncMock(
            return_value={
                "access_token": "expired",
                "refresh_token": "refresh",
                "client_id": "client",
                "expires_at": 0,
            }
        ),
    )
    monkeypatch.setattr(
        coros_mcp_auth,
        "discover_oauth_metadata",
        AsyncMock(return_value={"token_endpoint": "https://example.com/token"}),
    )
    response = httpx.Response(
        400,
        request=httpx.Request("POST", "https://example.com/token"),
        json={"error": "invalid_grant", "error_description": description},
    )
    monkeypatch.setattr(
        coros_mcp_auth,
        "refresh_access_token",
        AsyncMock(
            side_effect=httpx.HTTPStatusError(
                "invalid_grant", request=response.request, response=response
            )
        ),
    )
    save = AsyncMock()
    monkeypatch.setattr(coros_mcp_auth, "save_tokens", save)

    with pytest.raises(RuntimeError, match=expected):
        await coros_mcp_auth.get_valid_access_token(MagicMock(), "https://example.com/mcp")

    save.assert_not_awaited()
