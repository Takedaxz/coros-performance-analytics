"""Focused behavior tests for daily feeling records."""

from datetime import date, timedelta
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException

from src.api.routes import feeling_routes


@pytest.mark.asyncio
async def test_save_feeling_creates_owner_scoped_entry(monkeypatch) -> None:
    db = AsyncMock()
    db.scalar.return_value = None
    db.add = Mock()
    created = []

    async def refresh(entry: object) -> None:
        created.append(entry)

    db.refresh.side_effect = refresh
    monkeypatch.setattr(feeling_routes, "get_owner_id", lambda: "owner")

    response = await feeling_routes.save_feeling(
        date.today(), feeling_routes.FeelingPayload(feeling="good", note="  Fresh legs  "), db
    )

    entry = db.add.call_args.args[0]
    assert entry.user_id == "owner"
    assert entry.feeling == "good"
    assert entry.note == "Fresh legs"
    assert response.feeling == "good"
    assert created == [entry]
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_save_feeling_rejects_future_dates() -> None:
    db = AsyncMock()

    with pytest.raises(HTTPException, match="future date"):
        await feeling_routes.save_feeling(
            date.today() + timedelta(days=1),
            feeling_routes.FeelingPayload(feeling="okay"),
            db,
        )

    db.scalar.assert_not_awaited()
