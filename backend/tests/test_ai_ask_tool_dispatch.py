"""Regression tests for the LangChain-only AI Coach dispatch path."""

import asyncio

import pytest

import src.ai as ai_pkg
from src.ai import coach_agent
from src.ai.coach_tools import MAX_TOOL_CALLS
from src.api.routes.ai_routes import _unique_tool_calls


def test_tool_call_limit_is_shared_between_agent_and_tools() -> None:
    """coach_agent must not redefine its own limit; both sites share one constant."""
    assert coach_agent.MAX_TOOL_CALLS is MAX_TOOL_CALLS
    assert not hasattr(coach_agent, "_MAX_TOOL_CALLS")


def test_unique_tool_calls_handles_dict_records() -> None:
    call = {"name": "get_training_plan", "arguments": {"start_date": "2026-08-16"}}
    assert _unique_tool_calls([call, call]) == [call]


def test_ask_coach_uses_the_langchain_tool_loop(monkeypatch) -> None:
    seen: dict[str, object] = {}

    def fake_tools(provider, model_name, question, context, history, user_id, loop, tool_calls):
        seen["provider"] = provider
        tool_calls.append("get_activities")
        return "Tool answer"

    monkeypatch.setattr(ai_pkg, "ask_coach_with_tools", fake_tools)
    monkeypatch.setattr(ai_pkg, "resolve_model", lambda _m: ("gemini", "gemini-3.5-flash"))

    calls: list[str] = []
    answer = ai_pkg.ask_coach(
        "Compare my long runs",
        "Snapshot",
        None,
        model=None,
        user_id="owner",
        tool_calls=calls,
        event_loop=asyncio.new_event_loop(),
    )

    assert answer == "Tool answer"
    assert calls == ["get_activities"]
    assert seen["provider"] == "gemini"


def test_ask_coach_returns_a_safe_error_when_the_langchain_loop_raises(monkeypatch) -> None:

    def failing_tools(*_args, **_kwargs):
        raise RuntimeError("429 quota exhausted")

    monkeypatch.setattr(ai_pkg, "ask_coach_with_tools", failing_tools)
    monkeypatch.setattr(ai_pkg, "resolve_model", lambda _m: ("openai_compat", "model-a"))

    calls: list[str] = ["get_activities"]
    answer = ai_pkg.ask_coach(
        "Question",
        "Snapshot",
        None,
        model=None,
        user_id="owner",
        tool_calls=calls,
        event_loop=asyncio.new_event_loop(),
    )

    assert answer == "Error communicating with AI."
    assert calls == ["get_activities"]


def test_tool_loop_raises_instead_of_returning_an_error_string(monkeypatch) -> None:
    """ask_coach_with_tools must propagate so the caller can decide to fall back."""

    class Model:
        def bind_tools(self, _tools):
            return self

        def invoke(self, _messages):
            raise RuntimeError("503 unavailable")

    monkeypatch.setattr(coach_agent, "_model", lambda _p, _m: Model())
    monkeypatch.setattr(coach_agent, "_tools", lambda _u, _l: [])

    with pytest.raises(RuntimeError, match="503"):
        coach_agent.ask_coach_with_tools(
            "gemini",
            "gemini-3.5-flash",
            "Question",
            "Snapshot",
            None,
            "owner",
            asyncio.new_event_loop(),
            [],
        )
