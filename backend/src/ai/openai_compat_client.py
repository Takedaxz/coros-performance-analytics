"""OpenAI-compatible AI client.

Mirrors the public surface of gemini_client so the rest of the codebase
can swap backends purely through environment variables.

Compatible with any server that implements the OpenAI Chat Completions API,
e.g. the KKU OKMD gateway, vLLM, LM Studio, Ollama (OpenAI-compat mode), etc.
"""

import logging
from collections.abc import Iterator
from dataclasses import dataclass
from functools import lru_cache
from time import monotonic

from openai import OpenAI

from src.ai.prompts import COACH_SYSTEM_PROMPT, POSTMORTEM_PROMPT, WEEKLY_BRIEFING_PROMPT
from src.config import get_settings

logger = logging.getLogger(__name__)
_MODEL_CACHE_SECONDS = 300


@dataclass(frozen=True)
class _ProviderConfig:
    enabled: bool
    api_key: str
    base_url: str
    model: str
    headers: dict[str, str] | None = None


def provider_config(provider: str) -> _ProviderConfig:
    """Return credentials and request metadata for an OpenAI-compatible provider."""
    current_settings = get_settings()
    if provider == "agentrouter":
        return _ProviderConfig(
            enabled=bool(current_settings.agentrouter_api_key),
            api_key=current_settings.agentrouter_api_key,
            base_url=current_settings.agentrouter_base_url,
            model=current_settings.agentrouter_model,
            headers={
                "Originator": "codex_cli_rs",
                "User-Agent": "codex_cli_rs/0.101.0 (Mac OS 26.0.1; arm64) Apple_Terminal/464",
                "Version": "0.101.0",
                "HTTP-Referer": "https://github.com/Takedaxz/coros-performance-analytics",
                "X-Title": "coros-core",
            },
        )
    return _ProviderConfig(
        enabled=current_settings.openai_compat_enabled,
        api_key=current_settings.openai_compat_api_key,
        base_url=current_settings.openai_compat_base_url,
        model=current_settings.openai_compat_model,
    )


def _get_client(provider: str = "openai_compat") -> OpenAI | None:
    """Return an initialised OpenAI-compat client, or None if not configured."""
    config = provider_config(provider)
    if not config.enabled or not config.api_key:
        return None
    return OpenAI(
        api_key=config.api_key,
        base_url=config.base_url,
        default_headers=config.headers,
    )


@lru_cache(maxsize=1)
def _discover_models(_cache_bucket: int, provider: str = "openai_compat") -> tuple[str, ...]:
    config = provider_config(provider)
    client = _get_client() if provider == "openai_compat" else _get_client(provider)
    if not client:
        return (config.model,)
    try:
        models = tuple(sorted(model.id for model in client.models.list().data))
        return models or (config.model,)
    except Exception:
        logger.exception("OpenAI-compatible model discovery failed")
        return (config.model,)


def list_models(provider: str = "openai_compat") -> list[str]:
    """Return discovered model IDs with a five-minute in-process cache."""
    cache_bucket = int(monotonic() // _MODEL_CACHE_SECONDS)
    if provider == "openai_compat":
        return list(_discover_models(cache_bucket))
    return list(_discover_models(cache_bucket, provider))


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
    provider: str = "openai_compat",
    model: str | None = None,
) -> str:
    """Ask the AI coach a question (non-streaming)."""
    config = provider_config(provider)
    client = _get_client() if provider == "openai_compat" else _get_client(provider)
    if not client:
        return "OpenAI-compatible AI is not configured."

    messages: list[dict[str, str]] = [{"role": "system", "content": COACH_SYSTEM_PROMPT}]
    messages += _build_history_messages(history or [])
    messages.append({"role": "user", "content": f"{context}\n\nAthlete Question:\n{question}"})

    try:
        response = client.chat.completions.create(
            model=model or config.model,
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
    provider: str = "openai_compat",
) -> Iterator[str]:
    """Stream the AI coach response chunk by chunk."""
    config = provider_config(provider)
    client = _get_client() if provider == "openai_compat" else _get_client(provider)
    if not client:
        yield "OpenAI-compatible AI is not configured."
        return

    messages: list[dict[str, str]] = [{"role": "system", "content": COACH_SYSTEM_PROMPT}]
    messages += _build_history_messages(history or [])
    messages.append({"role": "user", "content": f"{context}\n\nAthlete Question:\n{question}"})

    try:
        stream = client.chat.completions.create(
            model=model or config.model,
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


def generate_briefing(
    context: str, provider: str = "openai_compat", model: str | None = None
) -> str:
    """Generate a weekly briefing (non-streaming)."""
    config = provider_config(provider)
    client = _get_client() if provider == "openai_compat" else _get_client(provider)
    if not client:
        return "OpenAI-compatible AI is not configured."

    messages: list[dict[str, str]] = [
        {"role": "system", "content": WEEKLY_BRIEFING_PROMPT},
        {"role": "user", "content": context},
    ]

    try:
        response = client.chat.completions.create(
            model=model or config.model,
            messages=messages,  # type: ignore[arg-type]
            stream=False,
        )
        return response.choices[0].message.content or "Failed to generate briefing."
    except Exception as exc:
        logger.exception("OpenAI-compat generate_briefing failed")
        return f"Error: {exc}"


def generate_postmortem(
    context: str,
    activity_context: str,
    model: str | None = None,
    provider: str = "openai_compat",
) -> str:
    """Generate a postmortem analysis for a specific activity."""
    config = provider_config(provider)
    client = _get_client() if provider == "openai_compat" else _get_client(provider)
    if not client:
        return "OpenAI-compatible AI is not configured."

    target_model = model or config.model
    messages: list[dict[str, str]] = [
        {"role": "system", "content": POSTMORTEM_PROMPT},
        {"role": "user", "content": f"{context}\n\nActivity Details:\n{activity_context}"},
    ]

    try:
        response = client.chat.completions.create(
            model=target_model,
            messages=messages,  # type: ignore[arg-type]
            stream=False,
        )
        return response.choices[0].message.content or "Failed to generate postmortem."
    except Exception as exc:
        logger.exception("OpenAI-compat generate_postmortem failed")
        return f"Error: {exc}"


def generate_postmortem_stream(
    context: str,
    activity_context: str,
    model: str | None = None,
    provider: str = "openai_compat",
) -> Iterator[str]:
    """Stream a postmortem analysis chunk by chunk."""
    config = provider_config(provider)
    client = _get_client() if provider == "openai_compat" else _get_client(provider)
    if not client:
        yield "OpenAI-compatible AI is not configured."
        return

    target_model = model or config.model
    messages: list[dict[str, str]] = [
        {"role": "system", "content": POSTMORTEM_PROMPT},
        {"role": "user", "content": f"{context}\n\nActivity Details:\n{activity_context}"},
    ]

    try:
        stream = client.chat.completions.create(
            model=target_model,
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
