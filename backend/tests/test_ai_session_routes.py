"""Regression tests for AI session route transaction boundaries."""

from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException

from src.api.routes import ai_routes
from src.db.models import ChatSession


def test_project_moves_do_not_automatically_update_session_timestamp() -> None:
    """Changing only project_id must not make an old chat appear recent."""
    assert ChatSession.__table__.c.updated_at.onupdate is None


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


@pytest.mark.asyncio
async def test_create_project_rejects_blank_name(monkeypatch) -> None:
    """The sidebar's create button must not produce an unnamed folder."""
    db = AsyncMock()
    monkeypatch.setattr(ai_routes, "get_owner_id", lambda: "owner")

    with pytest.raises(HTTPException) as exc:
        await ai_routes.create_project(ai_routes.ProjectNameRequest(name="  "), db)

    assert exc.value.status_code == 400
    db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_resolve_project_id_blank_name_clears_folder(monkeypatch) -> None:
    """An empty project name moves the session out of every folder."""
    db = AsyncMock()
    monkeypatch.setattr(ai_routes, "get_owner_id", lambda: "owner")

    assert await ai_routes._resolve_project_id(db, "   ") is None

    db.execute.assert_not_awaited()
    db.add.assert_not_called()


@pytest.mark.asyncio
async def test_resolve_project_id_reuses_case_insensitive_match(monkeypatch) -> None:
    """Typeahead casing must not spawn a second folder for the same name."""
    existing = ai_routes.DBChatProject(id="project-id", user_id="owner", name="Cardio")
    result = type("Result", (), {"scalar_one_or_none": lambda self: existing})()
    db = AsyncMock()
    db.execute.return_value = result
    monkeypatch.setattr(ai_routes, "get_owner_id", lambda: "owner")

    assert await ai_routes._resolve_project_id(db, "cardio") == "project-id"

    db.add.assert_not_called()


@pytest.mark.asyncio
async def test_resolve_project_id_creates_unknown_project(monkeypatch) -> None:
    """An unknown name creates the folder, trimmed, owned by the caller."""
    result = type("Result", (), {"scalar_one_or_none": lambda self: None})()
    db = AsyncMock()
    db.add = Mock()
    db.execute.return_value = result
    monkeypatch.setattr(ai_routes, "get_owner_id", lambda: "owner")

    await ai_routes._resolve_project_id(db, "  Trading  ")

    created = db.add.call_args.args[0]
    assert created.name == "Trading"
    assert created.user_id == "owner"
    db.flush.assert_awaited_once()
