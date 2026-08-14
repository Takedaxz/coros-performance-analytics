"""Backend-controlled, read-only tool loop for AI Coach."""

import asyncio
import json
import logging
from collections.abc import Iterator
from typing import Any

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.tools import BaseTool, StructuredTool
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_openai import ChatOpenAI
from pydantic import SecretStr

from src.ai.coach_tools import MAX_TOOL_CALLS, coach_tool_functions
from src.ai.prompts import COACH_SYSTEM_PROMPT
from src.config import get_settings

logger = logging.getLogger(__name__)


def _messages(
    question: str, context: str, history: list[dict[str, str]] | None
) -> list[BaseMessage]:
    messages: list[BaseMessage] = [SystemMessage(content=COACH_SYSTEM_PROMPT)]
    for item in (history or [])[-12:]:
        if item["role"] == "assistant":
            messages.append(AIMessage(content=item["content"]))
        elif item["role"] == "user":
            messages.append(HumanMessage(content=item["content"]))
    messages.append(HumanMessage(content=f"{context}\n\nAthlete Question:\n{question}"))
    return messages


def _model(provider: str, model_name: str) -> ChatGoogleGenerativeAI | ChatOpenAI:
    settings = get_settings()
    if provider == "gemini":
        return ChatGoogleGenerativeAI(
            model=model_name,
            api_key=settings.gemini_api_key,
            temperature=0.7,
            request_timeout=60,
        )
    return ChatOpenAI(
        model=model_name,
        api_key=SecretStr(settings.openai_compat_api_key),
        base_url=settings.openai_compat_base_url,
        temperature=0.7,
        timeout=60,
        max_retries=0,
    )


def _content(message: BaseMessage) -> str:
    if isinstance(message.content, str):
        return message.content
    return "\n".join(
        block["text"]
        for block in message.content
        if isinstance(block, dict) and isinstance(block.get("text"), str)
    )


def _tool_result(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), default=str)


def _tools(
    user_id: str, event_loop: asyncio.AbstractEventLoop, tool_calls: list[str]
) -> list[BaseTool]:
    functions = coach_tool_functions(user_id, event_loop, tool_calls)
    return [StructuredTool.from_function(function) for function in functions]


def _prepare_tool_messages(
    provider: str,
    model_name: str,
    question: str,
    context: str,
    history: list[dict[str, str]] | None,
    user_id: str,
    event_loop: asyncio.AbstractEventLoop,
    tool_calls: list[str],
) -> tuple[ChatGoogleGenerativeAI | ChatOpenAI, list[BaseMessage], BaseMessage | None]:
    """Run the controlled tool loop and return messages ready for a final answer."""
    tools = _tools(user_id, event_loop, tool_calls)
    tools_by_name = {tool.name: tool for tool in tools}
    messages = _messages(question, context, history)
    model = _model(provider, model_name)

    try:
        model_with_tools = model.bind_tools(tools)
        for _ in range(MAX_TOOL_CALLS):
            response = model_with_tools.invoke(messages)
            if not isinstance(response, AIMessage) or not response.tool_calls:
                return model, messages, response

            messages.append(response)
            remaining_calls = MAX_TOOL_CALLS - len(tool_calls)
            for index, call in enumerate(response.tool_calls):
                name = str(call.get("name", ""))
                call_id = str(call.get("id") or f"tool-{index}")
                tool = tools_by_name.get(name)
                if index >= remaining_calls:
                    result: dict[str, str] = {"error": "Tool call limit reached."}
                    status = "error"
                elif tool is None:
                    result = {"error": "Unknown tool."}
                    status = "error"
                else:
                    try:
                        result = tool.invoke(call.get("args", {}))
                        status = "error" if "error" in result else "success"
                    except Exception:
                        logger.exception("AI Coach tool failed", extra={"tool_name": name})
                        result = {"error": "Tool failed."}
                        status = "error"
                messages.append(
                    ToolMessage(
                        content=_tool_result(result),
                        name=name,
                        tool_call_id=call_id,
                        status=status,
                    )
                )
            if len(tool_calls) >= MAX_TOOL_CALLS:
                break
            messages.append(
                HumanMessage(
                    content="Use these results. Call one more narrow tool only if it is needed."
                )
            )

        messages.append(
            HumanMessage(
                content="Use the tool results above to answer the athlete. Do not call more tools."
            )
        )
        return model, messages, None
    except Exception:
        logger.exception("AI Coach controlled tool loop failed", extra={"provider": provider})
        raise


def ask_coach_with_tools(
    provider: str,
    model_name: str,
    question: str,
    context: str,
    history: list[dict[str, str]] | None,
    user_id: str,
    event_loop: asyncio.AbstractEventLoop,
    tool_calls: list[str],
) -> str:
    """Run read-only tools, then return the final coach answer."""
    model, messages, completed_response = _prepare_tool_messages(
        provider, model_name, question, context, history, user_id, event_loop, tool_calls
    )
    if completed_response is not None:
        return _content(completed_response) or "No response from AI."
    return _content(model.invoke(messages)) or "No response from AI."


def ask_coach_with_tools_stream(
    provider: str,
    model_name: str,
    question: str,
    context: str,
    history: list[dict[str, str]] | None,
    user_id: str,
    event_loop: asyncio.AbstractEventLoop,
    tool_calls: list[str],
) -> Iterator[str]:
    """Run read-only tools, then stream the final coach answer."""
    model, messages, completed_response = _prepare_tool_messages(
        provider, model_name, question, context, history, user_id, event_loop, tool_calls
    )
    if completed_response is not None:
        text = _content(completed_response)
        if text:
            yield text
        return
    for chunk in model.stream(messages):
        text = _content(chunk)
        if text:
            yield text
