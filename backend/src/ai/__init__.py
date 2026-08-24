"""AI package — dynamic multi-provider dispatch layer.

Routes requests dynamically across all configured AI backends
(e.g., OpenAI-compatible gateway and Google Gemini Direct) based on
the selected model ID.
"""

import asyncio
import logging
from collections.abc import Iterator
from typing import Any

from src.ai import gemini_client, openai_compat_client
from src.ai.coach_agent import ask_coach_with_tools, ask_coach_with_tools_stream
from src.ai.coach_tools import ToolCallRecord
from src.config import get_settings

logger = logging.getLogger(__name__)

_GEMINI_FALLBACK_MODEL = "gemini-3.5-flash-lite"
_GEMINI_RATE_LIMIT_TERMS = ("429", "quota", "exhausted", "resource exhausted")


def _can_fallback_to_gemini_flash_lite(
    provider: str, model: str, error: Exception, tool_calls: list[ToolCallRecord]
) -> bool:
    """Return whether a clean Gemini request can safely use the configured fallback."""
    return (
        provider == "gemini"
        and model != _GEMINI_FALLBACK_MODEL
        and not tool_calls
        and any(term in str(error).lower() for term in _GEMINI_RATE_LIMIT_TERMS)
    )


def _openai_compat_ready() -> bool:
    settings = get_settings()
    return settings.openai_compat_enabled and bool(settings.openai_compat_api_key)


def _agentrouter_ready() -> bool:
    settings = get_settings()
    return bool(settings.agentrouter_api_key)


def _gemini_ready() -> bool:
    settings = get_settings()
    return settings.gemini_enabled and bool(settings.gemini_api_key)


def list_provider_models() -> list[dict[str, Any]]:
    """Return provider groups with available models."""
    providers: list[dict[str, Any]] = []

    if _gemini_ready():
        gem_models = gemini_client.list_models()
        providers.append(
            {
                "id": "gemini",
                "name": "Google Gemini",
                "models": [{"id": f"gemini:{m}", "name": m} for m in gem_models],
            }
        )

    if _openai_compat_ready():
        raw_models = openai_compat_client.list_models()
        providers.append(
            {
                "id": "openai_compat",
                "name": "OKMD OpenAI-Compatible",
                "models": [{"id": f"openai_compat:{m}", "name": m} for m in raw_models],
            }
        )

    if _agentrouter_ready():
        raw_models = openai_compat_client.list_models("agentrouter")
        providers.append(
            {
                "id": "agentrouter",
                "name": "AgentRouter",
                "models": [{"id": f"agentrouter:{m}", "name": m} for m in raw_models],
            }
        )

    return providers


def list_models() -> list[str]:
    """Flat list of model IDs for backwards compatibility."""
    flat: list[str] = []
    for provider in list_provider_models():
        for m in provider["models"]:
            flat.append(m["id"])
    return flat


_MODEL_ALIASES: dict[str, str] = {
    "3.5-flash0lite": "gemini-3.5-flash-lite",
    "3.5-flash-lite": "gemini-3.5-flash-lite",
    "3.5-flashlite": "gemini-3.5-flash-lite",
    "gemini-3.5-flash0lite": "gemini-3.5-flash-lite",
    "3.5-flash": "gemini-3.5-flash",
    "3.6-flash": "gemini-3.6-flash",
    "3.7-flash": "gemini-3.7-flash",
    "2.5-flash": "gemini-2.5-flash",
    "2.5-flash-lite": "gemini-2.5-flash-lite",
    "3.1-flash-lite": "gemini-3.1-flash-lite",
}


def resolve_model(model_name: str | None) -> tuple[str, str]:
    """Resolve a raw model_name string into (provider_id, clean_model_name)."""
    settings = get_settings()
    if not model_name:
        if _openai_compat_ready():
            return "openai_compat", settings.openai_compat_model
        if _agentrouter_ready():
            return "agentrouter", settings.agentrouter_model
        if _gemini_ready():
            return "gemini", settings.gemini_model
        return "openai_compat", settings.openai_compat_model

    if model_name.startswith("openai_compat:"):
        raw_name = model_name.split("openai_compat:", 1)[1]
        clean_name = _MODEL_ALIASES.get(raw_name.lower(), raw_name)
        return "openai_compat", clean_name

    if model_name.startswith("agentrouter:"):
        raw_name = model_name.split("agentrouter:", 1)[1]
        clean_name = _MODEL_ALIASES.get(raw_name.lower(), raw_name)
        return "agentrouter", clean_name

    if model_name.startswith("gemini:"):
        raw_name = model_name.split("gemini:", 1)[1]
        clean_name = _MODEL_ALIASES.get(raw_name.lower(), raw_name)
        return "gemini", clean_name

    model_name = _MODEL_ALIASES.get(model_name.lower(), model_name)

    # Legacy / non-prefixed model names: check where the model belongs
    if _openai_compat_ready():
        compat_models = openai_compat_client.list_models()
        if model_name in compat_models:
            return "openai_compat", model_name

    if _agentrouter_ready():
        agentrouter_models = openai_compat_client.list_models("agentrouter")
        if model_name in agentrouter_models:
            return "agentrouter", model_name

    if _gemini_ready():
        gemini_models = gemini_client.list_models()
        if model_name in gemini_models or model_name.startswith("gemini"):
            return "gemini", model_name

    # Fallback to active default provider
    if _openai_compat_ready():
        return "openai_compat", model_name
    if _agentrouter_ready():
        return "agentrouter", model_name
    return "gemini", model_name


def ask_coach(
    question: str,
    context: str,
    history: list[dict[str, str]] | None = None,
    model: str | None = None,
    images: list[str] | None = None,
    *,
    user_id: str,
    tool_calls: list[ToolCallRecord],
    event_loop: asyncio.AbstractEventLoop,
) -> str:
    provider, clean_model = resolve_model(model)
    try:
        return ask_coach_with_tools(
            provider, clean_model, question, context, history, user_id, event_loop, tool_calls, images
        )
    except Exception as error:
        if _can_fallback_to_gemini_flash_lite(provider, clean_model, error, tool_calls):
            logger.warning(
                "Gemini Coach quota exhausted; retrying with Flash Lite",
                extra={"model": clean_model, "fallback_model": _GEMINI_FALLBACK_MODEL},
            )
            try:
                return ask_coach_with_tools(
                    provider,
                    _GEMINI_FALLBACK_MODEL,
                    question,
                    context,
                    history,
                    user_id,
                    event_loop,
                    tool_calls,
                    images,
                )
            except Exception:
                logger.exception("Gemini Coach fallback failed")
        logger.exception("AI Coach request failed", extra={"provider": provider})
        return "Error communicating with AI."


def ask_coach_stream(
    question: str,
    context: str,
    history: list[dict[str, str]] | None = None,
    model: str | None = None,
    images: list[str] | None = None,
    *,
    user_id: str,
    tool_calls: list[ToolCallRecord],
    event_loop: asyncio.AbstractEventLoop,
) -> Iterator[str]:
    provider, clean_model = resolve_model(model)
    streamed_text = False
    try:
        for chunk in ask_coach_with_tools_stream(
            provider, clean_model, question, context, history, user_id, event_loop, tool_calls, images
        ):
            streamed_text = True
            yield chunk
    except Exception as error:
        if (
            not streamed_text
            and _can_fallback_to_gemini_flash_lite(provider, clean_model, error, tool_calls)
        ):
            logger.warning(
                "Gemini Coach quota exhausted; streaming with Flash Lite",
                extra={"model": clean_model, "fallback_model": _GEMINI_FALLBACK_MODEL},
            )
            try:
                yield from ask_coach_with_tools_stream(
                    provider,
                    _GEMINI_FALLBACK_MODEL,
                    question,
                    context,
                    history,
                    user_id,
                    event_loop,
                    tool_calls,
                    images,
                )
                return
            except Exception:
                logger.exception("Gemini Coach streaming fallback failed")
        logger.exception("AI Coach stream failed", extra={"provider": provider})
        yield "Error communicating with AI."


def generate_briefing(context: str, model: str | None = None) -> str:
    provider, clean_model = resolve_model(model)
    if provider == "gemini":
        return gemini_client.generate_briefing(context, model=clean_model)
    return openai_compat_client.generate_briefing(context, provider=provider, model=clean_model)


def generate_postmortem(context: str, activity_context: str, model: str | None = None) -> str:
    provider, clean_model = resolve_model(model)
    if provider == "gemini":
        return gemini_client.generate_postmortem(context, activity_context, model=clean_model)
    return openai_compat_client.generate_postmortem(
        context, activity_context, model=clean_model, provider=provider
    )


def generate_postmortem_stream(
    context: str, activity_context: str, model: str | None = None
) -> Iterator[str]:
    provider, clean_model = resolve_model(model)
    if provider == "gemini":
        yield from gemini_client.generate_postmortem_stream(
            context, activity_context, model=clean_model
        )
    else:
        yield from openai_compat_client.generate_postmortem_stream(
            context, activity_context, model=clean_model, provider=provider
        )


__all__ = [
    "ask_coach",
    "ask_coach_stream",
    "generate_briefing",
    "generate_postmortem",
    "generate_postmortem_stream",
    "list_models",
    "list_provider_models",
    "resolve_model",
]
