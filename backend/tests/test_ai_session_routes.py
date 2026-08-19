"""Regression tests for AI session route transaction boundaries."""

from unittest.mock import AsyncMock, Mock, call

import pytest
from fastapi import HTTPException

from src.api.routes import ai_routes
from src.db.models import ChatMessage, ChatSession


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
async def test_delete_exchange_removes_user_and_following_assistant(monkeypatch) -> None:
    session = ChatSession(id="session-id", user_id="owner", title="Question")
    user = ChatMessage(id="user-id", session_id="session-id", role="user", content="Question")
    assistant = ChatMessage(
        id="assistant-id", session_id="session-id", role="assistant", content="Answer"
    )
    later_user = ChatMessage(
        id="later-user-id", session_id="session-id", role="user", content="Later"
    )
    session_result = type("Result", (), {"scalar_one_or_none": lambda self: session})()
    messages_result = type(
        "Result",
        (),
        {"scalars": lambda self: type("Scalars", (), {"all": lambda self: [user, assistant, later_user]})()},
    )()
    db = AsyncMock()
    db.execute.side_effect = [session_result, messages_result]
    monkeypatch.setattr(ai_routes, "get_owner_id", lambda: "owner")

    result = await ai_routes.delete_exchange("session-id", "user-id", db)

    assert db.delete.await_args_list == [call(user), call(assistant)]
    assert session.title == "Later"
    assert result == ai_routes.DeleteExchangeResponse(session_deleted=False, title="Later")
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_delete_only_exchange_deletes_session(monkeypatch) -> None:
    session = ChatSession(id="session-id", user_id="owner", title="Question")
    user = ChatMessage(id="user-id", session_id="session-id", role="user", content="Question")
    assistant = ChatMessage(
        id="assistant-id", session_id="session-id", role="assistant", content="Answer"
    )
    session_result = type("Result", (), {"scalar_one_or_none": lambda self: session})()
    messages_result = type(
        "Result",
        (),
        {"scalars": lambda self: type("Scalars", (), {"all": lambda self: [user, assistant]})()},
    )()
    db = AsyncMock()
    db.execute.side_effect = [session_result, messages_result]
    monkeypatch.setattr(ai_routes, "get_owner_id", lambda: "owner")

    result = await ai_routes.delete_exchange("session-id", "user-id", db)

    db.delete.assert_awaited_once_with(session)
    assert result == ai_routes.DeleteExchangeResponse(session_deleted=True, title=None)
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_delete_later_exchange_preserves_session_title(monkeypatch) -> None:
    session = ChatSession(id="session-id", user_id="owner", title="Custom title")
    first_user = ChatMessage(
        id="first-user-id", session_id="session-id", role="user", content="First question"
    )
    first_assistant = ChatMessage(
        id="first-assistant-id", session_id="session-id", role="assistant", content="First answer"
    )
    later_user = ChatMessage(
        id="later-user-id", session_id="session-id", role="user", content="Later question"
    )
    later_assistant = ChatMessage(
        id="later-assistant-id", session_id="session-id", role="assistant", content="Later answer"
    )
    session_result = type("Result", (), {"scalar_one_or_none": lambda self: session})()
    messages_result = type(
        "Result",
        (),
        {
            "scalars": lambda self: type(
                "Scalars",
                (),
                {"all": lambda self: [first_user, first_assistant, later_user, later_assistant]},
            )()
        },
    )()
    db = AsyncMock()
    db.execute.side_effect = [session_result, messages_result]
    monkeypatch.setattr(ai_routes, "get_owner_id", lambda: "owner")

    result = await ai_routes.delete_exchange("session-id", "later-user-id", db)

    assert session.title == "Custom title"
    assert result == ai_routes.DeleteExchangeResponse(
        session_deleted=False, title="Custom title"
    )


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


def test_project_customization_rejects_unknown_values() -> None:
    with pytest.raises(HTTPException, match="Unsupported project icon"):
        ai_routes._validate_project_customization(
            ai_routes.ProjectUpdateRequest(name="Training", icon="not-real")
        )

    with pytest.raises(HTTPException, match="Unsupported project highlight color"):
        ai_routes._validate_project_customization(
            ai_routes.ProjectUpdateRequest(name="Training", highlight_color="#ffffff")
        )


def test_project_customization_accepts_nullable_defaults() -> None:
    assert ai_routes._validate_project_customization(
        ai_routes.ProjectUpdateRequest(name=" Training ")
    ) == ("Training", None, None)


def test_message_item_validates_web_search_sources() -> None:
    item = ai_routes.MessageItem(
        id="msg-1",
        role="assistant",
        content="Here are the race details.",
        tool_calls=[
            {
                "name": "web_search",
                "arguments": {"query": "HYROX race structure"},
                "display_result": {
                    "sources": [
                        {"title": "HYROX Guide", "url": "https://hyrox.com", "snippet": "Race info"}
                    ]
                },
            }
        ],
        created_at="2026-08-19T13:20:00Z",
    )
    assert item.tool_calls is not None
    assert item.tool_calls[0]["display_result"]["sources"][0]["title"] == "HYROX Guide"
