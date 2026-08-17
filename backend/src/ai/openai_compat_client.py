"""OpenAI-compatible AI client.

Mirrors the public surface of gemini_client so the rest of the codebase
can swap backends purely through environment variables.

Compatible with any server that implements the OpenAI Chat Completions API,
e.g. the KKU OKMD gateway, vLLM, LM Studio, Ollama (OpenAI-compat mode), etc.
"""

import logging
from collections.abc import Iterator
from functools import lru_cache
from time import monotonic

from openai import OpenAI

from src.ai.prompts import COACH_SYSTEM_PROMPT, POSTMORTEM_PROMPT, WEEKLY_BRIEFING_PROMPT
from src.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)
_MODEL_CACHE_SECONDS = 300


def _get_client() -> OpenAI | None:
    """Return an initialised OpenAI-compat client, or None if not configured."""
    if not settings.openai_compat_enabled or not settings.openai_compat_api_key:
        return None
    return OpenAI(
        api_key=settings.openai_compat_api_key,
        base_url=settings.openai_compat_base_url,
    )


@lru_cache(maxsize=1)
def _discover_models(_cache_bucket: int) -> tuple[str, ...]:
    client = _get_client()
    if not client:
        return (settings.openai_compat_model,)
    try:
        models = tuple(sorted(model.id for model in client.models.list().data))
        return models or (settings.openai_compat_model,)
    except Exception:
        logger.exception("OpenAI-compatible model discovery failed")
        return (settings.openai_compat_model,)


def list_models() -> list[str]:
    """Return discovered model IDs with a five-minute in-process cache."""
    cache_bucket = int(monotonic() // _MODEL_CACHE_SECONDS)
    return list(_discover_models(cache_bucket))


def _build_history_messages(history: list[dict[str, str]]) -> list[dict[str, str]]:
    """Convert up to six recent conversation turns to OpenAI message format."""
    messages: list[dict[str, str]] = []
    for msg in history[-12:]:
        role = "user" if msg["role"] == "user" else "assistant"
        messages.append({"role": role, "content": msg["content"]})
    return messages


# ---------------------------------------------------------------------------
# Public API  (matches gemini_client signatures exactly)
# ---------------------------------------------------------------------------


def ask_coach(
    question: str,
    context: str,
    history: list[dict] | None = None,
) -> str:
    """Ask the AI coach a question (non-streaming)."""
    client = _get_client()
    if not client:
        return "OpenAI-compatible AI is not configured."

    messages: list[dict[str, str]] = [{"role": "system", "content": COACH_SYSTEM_PROMPT}]
    messages += _build_history_messages(history or [])
    messages.append({"role": "user", "content": f"{context}\n\nAthlete Question:\n{question}"})

    try:
        response = client.chat.completions.create(
            model=settings.openai_compat_model,
            messages=messages,  # type: ignore[arg-type]
            stream=False,
        )
        return response.choices[0].message.content or "No response from AI."
    except Exception:
        logger.exception("OpenAI-compat ask_coach failed")
        return "Error communicating with AI."


def ask_coach_stream(
    question: str,
    context: str,
    history: list[dict[str, str]] | None = None,
    model: str | None = None,
) -> Iterator[str]:
    """Stream the AI coach response chunk by chunk."""
    client = _get_client()
    if not client:
        yield "OpenAI-compatible AI is not configured."
        return

    messages: list[dict[str, str]] = [{"role": "system", "content": COACH_SYSTEM_PROMPT}]
    messages += _build_history_messages(history or [])
    messages.append({"role": "user", "content": f"{context}\n\nAthlete Question:\n{question}"})

    try:
        stream = client.chat.completions.create(
            model=model or settings.openai_compat_model,
            messages=messages,  # type: ignore[arg-type]
            stream=True,
        )
        in_thinking = False
        for chunk in stream:
            if not chunk.choices:
                continue
            delta_obj = chunk.choices[0].delta
            reasoning = getattr(delta_obj, "reasoning_content", None)
            content = delta_obj.content

            if reasoning:
                if not in_thinking:
                    yield "<think>"
                    in_thinking = True
                yield reasoning
            elif content:
                if in_thinking:
                    yield "</think>\n"
                    in_thinking = False
                yield content
        if in_thinking:
            yield "</think>\n"
    except Exception:
        logger.exception("OpenAI-compat ask_coach_stream failed")
        yield "Error communicating with AI."


def generate_briefing(context: str) -> str:
    """Generate a weekly briefing (non-streaming)."""
    client = _get_client()
    if not client:
        return "OpenAI-compatible AI is not configured."

    messages: list[dict[str, str]] = [
        {"role": "system", "content": WEEKLY_BRIEFING_PROMPT},
        {"role": "user", "content": context},
    ]

    try:
        response = client.chat.completions.create(
            model=settings.openai_compat_model,
            messages=messages,  # type: ignore[arg-type]
            stream=False,
        )
        return response.choices[0].message.content or "Failed to generate briefing."
    except Exception as exc:
        logger.exception("OpenAI-compat generate_briefing failed")
        return f"Error: {exc}"


def generate_postmortem(context: str, activity_context: str) -> str:
    """Generate a postmortem analysis for a specific activity."""
    client = _get_client()
    if not client:
        return "OpenAI-compatible AI is not configured."

    messages: list[dict[str, str]] = [
        {"role": "system", "content": POSTMORTEM_PROMPT},
        {"role": "user", "content": f"{context}\n\nActivity Details:\n{activity_context}"},
    ]

    try:
        response = client.chat.completions.create(
            model=settings.openai_compat_model,
            messages=messages,  # type: ignore[arg-type]
            stream=False,
        )
        return response.choices[0].message.content or "Failed to generate postmortem."
    except Exception as exc:
        logger.exception("OpenAI-compat generate_postmortem failed")
        return f"Error: {exc}"


def generate_postmortem_stream(context: str, activity_context: str) -> Iterator[str]:
    """Stream a postmortem analysis chunk by chunk."""
    client = _get_client()
    if not client:
        yield "OpenAI-compatible AI is not configured."
        return

    messages: list[dict[str, str]] = [
        {"role": "system", "content": POSTMORTEM_PROMPT},
        {"role": "user", "content": f"{context}\n\nActivity Details:\n{activity_context}"},
    ]

    try:
        stream = client.chat.completions.create(
            model=settings.openai_compat_model,
            messages=messages,  # type: ignore[arg-type]
            stream=True,
        )
        for chunk in stream:
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta
    except Exception:
        logger.exception("OpenAI-compat generate_postmortem_stream failed")
        yield "Error generating postmortem."
