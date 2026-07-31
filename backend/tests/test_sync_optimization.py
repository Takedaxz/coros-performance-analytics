from datetime import UTC, date, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.api.routes.sync_routes import _utc_iso
from src.mcp.daily_health_client import _build_daily_health_args
from src.sync.api_client import _rate_limit_delay
from src.sync.sync_manager import (
    _resolve_sync_start_dates,
    _upsert_activities,
    _upsert_user_heart_rate_profile,
)


def test_rate_limit_retry_delay_is_bounded() -> None:
    assert _rate_limit_delay(None) == 1.0
    assert _rate_limit_delay("2.5") == 2.5
    assert _rate_limit_delay("60") == 5.0
    assert _rate_limit_delay("not-a-number") == 1.0


def test_sync_timestamp_is_serialized_as_utc() -> None:
    assert _utc_iso(datetime(2026, 7, 31, 3, 43, 6)) == "2026-07-31T03:43:06+00:00"
    assert _utc_iso(datetime(2026, 7, 31, 10, 43, 6, tzinfo=UTC)) == (
        "2026-07-31T10:43:06+00:00"
    )


def test_daily_health_uses_one_declared_argument_shape() -> None:
    assert _build_daily_health_args(
        {
            "type": "object",
            "properties": {"days": {"type": "integer"}},
            "required": [],
            "additionalProperties": False,
        },
        "20260724",
        "20260731",
        7,
    ) == {"days": 7}

    with pytest.raises(RuntimeError, match="Unsupported"):
        _build_daily_health_args(
            {"type": "object", "properties": {"query": {"type": "string"}}},
            "20260724",
            "20260731",
            7,
        )


@pytest.mark.asyncio
async def test_sync_windows_are_incremental_when_data_exists() -> None:
    db = MagicMock()
    db.scalar = AsyncMock(
        side_effect=[
            datetime(2026, 7, 30, 6),
            date(2026, 7, 31),
            date(2026, 7, 30),
            datetime(2026, 7, 29, 22),
        ]
    )

    starts = await _resolve_sync_start_dates(db, "user-id", date(2026, 7, 31), None)

    assert starts == (
        date(2026, 7, 2),
        date(2026, 7, 24),
        date(2026, 7, 23),
        date(2026, 7, 22),
    )

    empty_db = MagicMock()
    empty_db.scalar = AsyncMock(side_effect=[None, None, None, None])

    bootstrap_starts = await _resolve_sync_start_dates(
        empty_db, "user-id", date(2026, 7, 31), None
    )

    assert bootstrap_starts == (
        date(2023, 8, 1),
        date(2026, 4, 22),
        date(2026, 4, 22),
        date(2026, 4, 22),
    )


@pytest.mark.asyncio
async def test_activity_upsert_reads_and_flushes_once_for_a_batch() -> None:
    result = MagicMock()
    result.scalars.return_value.all.return_value = []
    db = MagicMock()
    db.execute = AsyncMock(return_value=result)
    db.flush = AsyncMock()
    client = MagicMock()
    items = [
        {"startTime": 1_785_450_000, "sportType": 100, "labelId": "run-1"},
        {"startTime": 1_785_536_400, "sportType": 200, "labelId": "ride-1"},
    ]

    count = await _upsert_activities(db, "user-id", items, client)

    assert count == 2
    assert db.execute.await_count == 1
    assert db.flush.await_count == 1


@pytest.mark.asyncio
async def test_sync_updates_coros_heart_rate_profile() -> None:
    user = MagicMock(max_hr_bpm=None, resting_hr_bpm=None)
    db = MagicMock()
    db.get = AsyncMock(return_value=user)

    count = await _upsert_user_heart_rate_profile(
        db,
        "user-id",
        {"summaryInfo": {"fitnessMaxHr": 198, "rhr": 41}},
    )

    assert count == 1
    assert user.max_hr_bpm == 198
    assert user.resting_hr_bpm == 41
