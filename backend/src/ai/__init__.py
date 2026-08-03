"""AI package — dynamic multi-provider dispatch layer.

Routes requests dynamically across all configured AI backends
(e.g., OpenAI-compatible gateway and Google Gemini Direct) based on
the selected model ID.
"""

from collections.abc import Iterator
from typing import Any

from src.ai import gemini_client, openai_compat_client
from src.config import get_settings


def _openai_compat_ready() -> bool:
    settings = get_settings()
    return bool(settings.openai_compat_api_key)


def _gemini_ready() -> bool:
    settings = get_settings()
    return bool(settings.gemini_api_key)


def list_provider_models() -> list[dict[str, Any]]:
    """Return provider groups with available models."""
    providers: list[dict[str, Any]] = []

    if _gemini_ready():
        gem_models = gemini_client.list_models()
        providers.append({
            "id": "gemini",
            "name": "Google Gemini",
            "models": [
                {"id": f"gemini:{m}", "name": m}
                for m in gem_models
            ],
        })

    if _openai_compat_ready():
        raw_models = openai_compat_client.list_models()
        providers.append({
            "id": "openai_compat",
            "name": "OKMD OpenAI-Compatible",
            "models": [
                {"id": f"openai_compat:{m}", "name": m}
                for m in raw_models
            ],
        })

    return providers


def list_models() -> list[str]:
    """Flat list of model IDs for backwards compatibility."""
    flat: list[str] = []
    for provider in list_provider_models():
        for m in provider["models"]:
            flat.append(m["id"])
    return flat


def resolve_model(model_name: str | None) -> tuple[str, str]:
    """Resolve a raw model_name string into (provider_id, clean_model_name)."""
    settings = get_settings()
    if not model_name:
        if _openai_compat_ready():
            return "openai_compat", settings.openai_compat_model
        if _gemini_ready():
            return "gemini", settings.gemini_model
        return "openai_compat", settings.openai_compat_model

    if model_name.startswith("openai_compat:"):
        return "openai_compat", model_name.split("openai_compat:", 1)[1]

    if model_name.startswith("gemini:"):
        return "gemini", model_name.split("gemini:", 1)[1]

    # Legacy / non-prefixed model names: check where the model belongs
    if _openai_compat_ready():
        compat_models = openai_compat_client.list_models()
        if model_name in compat_models:
            return "openai_compat", model_name

    if _gemini_ready():
        gemini_models = gemini_client.list_models()
        if model_name in gemini_models or model_name.startswith("gemini"):
            return "gemini", model_name

    # Fallback to active default provider
    if _openai_compat_ready():
        return "openai_compat", model_name
    return "gemini", model_name


def ask_coach(
    question: str,
    context: str,
    history: list[dict] | None = None,
    model: str | None = None,
) -> str:
    provider, clean_model = resolve_model(model)
    if provider == "gemini":
        return gemini_client.ask_coach(question, context, history, model=clean_model)
    return openai_compat_client.ask_coach(question, context, history)


def ask_coach_stream(
    question: str,
    context: str,
    history: list[dict[str, str]] | None = None,
    model: str | None = None,
) -> Iterator[str]:
    provider, clean_model = resolve_model(model)
    if provider == "gemini":
        yield from gemini_client.ask_coach_stream(question, context, history, model=clean_model)
    else:
        yield from openai_compat_client.ask_coach_stream(question, context, history, model=clean_model)


def generate_briefing(context: str, model: str | None = None) -> str:
    provider, clean_model = resolve_model(model)
    if provider == "gemini":
        return gemini_client.generate_briefing(context, model=clean_model)
    return openai_compat_client.generate_briefing(context)


def generate_postmortem(context: str, activity_context: str, model: str | None = None) -> str:
    provider, clean_model = resolve_model(model)
    if provider == "gemini":
        return gemini_client.generate_postmortem(context, activity_context, model=clean_model)
    return openai_compat_client.generate_postmortem(context, activity_context)


def generate_postmortem_stream(
    context: str, activity_context: str, model: str | None = None
) -> Iterator[str]:
    provider, clean_model = resolve_model(model)
    if provider == "gemini":
        yield from gemini_client.generate_postmortem_stream(context, activity_context, model=clean_model)
    else:
        yield from openai_compat_client.generate_postmortem_stream(context, activity_context)


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

