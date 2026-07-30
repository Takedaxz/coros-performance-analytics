"""AI package — dynamic unified dispatch layer.

Import public functions from here; the active backend
(OpenAI-compatible / OKMD gateway or Gemini native SDK) is selected dynamically
on every request based on current settings.

Priority: OpenAI-compat (OKMD) > Gemini native.
"""

from collections.abc import Iterator

from src.ai import gemini_client, openai_compat_client
from src.config import get_settings


def _use_openai_compat() -> bool:
    settings = get_settings()
    return bool(settings.openai_compat_enabled and settings.openai_compat_api_key)


def ask_coach(
    question: str,
    context: str,
    history: list[dict] | None = None,
) -> str:
    if _use_openai_compat():
        return openai_compat_client.ask_coach(question, context, history)
    return gemini_client.ask_coach(question, context, history)


def ask_coach_stream(
    question: str,
    context: str,
    history: list[dict[str, str]] | None = None,
    model: str | None = None,
) -> Iterator[str]:
    if _use_openai_compat():
        yield from openai_compat_client.ask_coach_stream(question, context, history, model)
    else:
        yield from gemini_client.ask_coach_stream(question, context, history)


def list_models() -> list[str]:
    settings = get_settings()
    if _use_openai_compat():
        return openai_compat_client.list_models()
    return [settings.gemini_model]


def generate_briefing(context: str) -> str:
    if _use_openai_compat():
        return openai_compat_client.generate_briefing(context)
    return gemini_client.generate_briefing(context)


def generate_postmortem(context: str, activity_context: str) -> str:
    if _use_openai_compat():
        return openai_compat_client.generate_postmortem(context, activity_context)
    return gemini_client.generate_postmortem(context, activity_context)


def generate_postmortem_stream(context: str, activity_context: str) -> Iterator[str]:
    if _use_openai_compat():
        yield from openai_compat_client.generate_postmortem_stream(context, activity_context)
    else:
        yield from gemini_client.generate_postmortem_stream(context, activity_context)


__all__ = [
    "ask_coach",
    "ask_coach_stream",
    "generate_briefing",
    "generate_postmortem",
    "generate_postmortem_stream",
    "list_models",
]
