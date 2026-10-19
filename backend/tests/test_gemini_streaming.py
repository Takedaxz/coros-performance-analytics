import asyncio
from collections.abc import Iterator
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from google.genai import types
from langchain_core.messages import AIMessage, BaseMessage
from langchain_google_genai.chat_models import _parse_response_candidate

from src.ai import coach_agent


def test_gemini_requests_thought_summaries(monkeypatch: pytest.MonkeyPatch) -> None:
    constructor = Mock()
    monkeypatch.setattr(coach_agent, "ChatGoogleGenerativeAI", constructor)
    coach_agent._model("gemini", "gemini-4-argon")
    assert constructor.call_args.kwargs["include_thoughts"] is True


@pytest.mark.parametrize("model_name", ["gemini-4-argon", "gemini-3.6-flash"])
def test_gemini_streams_thoughts_and_answer_progressively(
    monkeypatch: pytest.MonkeyPatch,
    model_name: str,
) -> None:
    parts = [
        [types.Part(text="Checking ", thought=True)],
        [types.Part(text="recovery.", thought=True, thought_signature=b"thought-signature")],
        [types.Part(text="Take "), types.Part(text="an easy day.")],
        [types.Part(text="", thought_signature=b"answer-signature")],
    ]
    consumed: list[int] = []

    def stream(_messages: list[BaseMessage]) -> Iterator[AIMessage]:
        for index, chunk_parts in enumerate(parts):
            consumed.append(index)
            yield _parse_response_candidate(
                types.Candidate(content=types.Content(parts=chunk_parts)),
                streaming=True,
                model_name_for_content=model_name,
            )

    model = SimpleNamespace(stream=stream)
    model.bind_tools = lambda _tools: model
    monkeypatch.setattr(coach_agent, "_model", lambda _provider, _model: model)
    monkeypatch.setattr(coach_agent, "_tools", lambda _user_id, _loop: [])
    loop = asyncio.new_event_loop()
    try:
        output = coach_agent.ask_coach_with_tools_stream(
            "gemini",
            model_name,
            "Question",
            "Snapshot",
            None,
            "user-id",
            loop,
            [],
        )
        assert next(output) == "<think>Checking "
        assert consumed == [0]
        assert next(output) == "recovery."
        assert consumed == [0, 1]
        assert next(output) == "</think>\nTake an easy day."
        assert list(output) == []
    finally:
        loop.close()


@pytest.mark.parametrize("final_answer", ["", "Take an easy day."])
def test_gemini_tool_continuation_preserves_thought_signatures(
    monkeypatch: pytest.MonkeyPatch,
    final_answer: str,
) -> None:
    tool_chunk = _parse_response_candidate(
        types.Candidate(
            content=types.Content(
                parts=[
                    types.Part(text="Checking training.", thought=True),
                    types.Part(
                        function_call=types.FunctionCall(name="get_activities", args={}),
                        thought_signature=b"tool-signature",
                    ),
                ]
            )
        ),
        streaming=True,
        model_name_for_content="gemini-3.6-flash",
    )
    calls = 0

    def stream(messages: list[BaseMessage]) -> Iterator[AIMessage]:
        nonlocal calls
        calls += 1
        if calls == 1:
            yield tool_chunk
            return
        response = next(message for message in messages if isinstance(message, AIMessage))
        assert response.content == tool_chunk.content
        assert response.additional_kwargs == tool_chunk.additional_kwargs
        assert response.additional_kwargs
        yield _parse_response_candidate(
            types.Candidate(
                content=types.Content(
                    parts=[
                        types.Part(text="Still analyzing.", thought=True),
                        types.Part(text=final_answer),
                    ]
                )
            ),
            streaming=True,
            model_name_for_content="gemini-3.6-flash",
        )

    model = SimpleNamespace(stream=stream)
    model.bind_tools = lambda _tools: model
    monkeypatch.setattr(coach_agent, "_model", lambda _provider, _model: model)
    monkeypatch.setattr(
        coach_agent,
        "_tools",
        lambda _user_id, _loop: [
            SimpleNamespace(name="get_activities", invoke=lambda _args: {}),
        ],
    )
    monkeypatch.setattr(coach_agent, "MAX_TOOL_CALLS", 1)
    loop = asyncio.new_event_loop()
    try:
        answer = "".join(
            coach_agent.ask_coach_with_tools_stream(
                "gemini",
                "gemini-3.6-flash",
                "Question",
                "Snapshot",
                None,
                "user-id",
                loop,
                [],
            )
        )
    finally:
        loop.close()
    assert "<think>Checking training." in answer
    assert "<think>Still analyzing.</think>" in answer
    assert answer.endswith(final_answer or coach_agent._INCOMPLETE_ANSWER_MESSAGE)
    assert (coach_agent._INCOMPLETE_ANSWER_MESSAGE in answer) is (not final_answer)
    assert answer.count("<think>") == answer.count("</think>")
