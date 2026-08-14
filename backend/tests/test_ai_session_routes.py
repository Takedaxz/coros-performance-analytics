"""Regression tests for AI session route transaction boundaries."""

from unittest.mock import AsyncMock

import pytest

from src.api.routes import ai_routes


@pytest.mark.asyncio
async def test_delete_session_commits_before_responding(monkeypatch) -> None:
    """A following session-list request must not observe the deleted session."""
    session = object()
    result = type("Result", (), {"scalar_one_or_none": lambda self: session})()
    db = AsyncMock()
    db.execute.return_value = result
    monkeypatch.setattr(ai_routes, "get_owner_id", lambda: "owner")

    await ai_routes.delete_session("session-id", db)

    db.delete.assert_awaited_once_with(session)
    db.commit.assert_awaited_once()
