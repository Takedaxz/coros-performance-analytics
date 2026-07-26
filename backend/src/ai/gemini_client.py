"""Gemini AI client wrapper."""

import logging
import time
from collections.abc import Callable, Iterator
from typing import ParamSpec, TypeVar

from google import genai
from google.genai import types

from src.ai.prompts import COACH_SYSTEM_PROMPT, POSTMORTEM_PROMPT, WEEKLY_BRIEFING_PROMPT
from src.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Model fallback chain
# When the primary model hits a rate/quota limit the client cascades through
# this list in order.  Connection-level transient errors retry the *same*
# model; only quota/rate errors advance to the next model.
# ---------------------------------------------------------------------------

_FALLBACK_MODELS: list[str] = [
    "gemini-3.5-flash",       # newer flash — separate quota pool from 2.5
    "gemini-2.5-flash-lite",  # lightest 2.5 tier, rarely exhausted
    "gemini-3.1-pro",         # pro-tier, separate quota
]

_RATE_LIMIT_TERMS: frozenset[str] = frozenset(["429", "exhausted", "quota", "limit", "demand"])
_TRANSIENT_TERMS: frozenset[str] = frozenset([
    "503", "unavailable", "temporary",
    "disconnected", "connection", "protocol",
    "reset", "eof", "broken",
])


def _classify_error(err_msg: str) -> str:
    """Return 'rate_limit', 'transient', or 'permanent' for an error message."""
    lower = err_msg.lower()
    if any(t in lower for t in _RATE_LIMIT_TERMS):
        return "rate_limit"
    if any(t in lower for t in _TRANSIENT_TERMS):
        return "transient"
    return "permanent"


T = TypeVar("T")
P = ParamSpec("P")


def _build_model_chain(primary: str) -> list[str]:
    """Return [primary] + fallbacks, deduplicating if primary is already in the list."""
    chain = [primary]
    for m in _FALLBACK_MODELS:
        if m != primary:
            chain.append(m)
    return chain


def retry_with_backoff(
    func: Callable[..., T],
    *args,
    max_retries: int = 3,
    initial_delay: float = 1.0,
    backoff_factor: float = 2.0,
    **kwargs,
) -> T:
    """Execute a function with exponential backoff retries for transient errors."""
    delay = initial_delay
    for attempt in range(max_retries + 1):
        try:
            return func(*args, **kwargs)
        except Exception as e:
            kind = _classify_error(str(e))
            if attempt == max_retries or kind == "permanent":
                logger.error(
                    "Gemini API call failed permanently: %s (attempt %d/%d)",
                    e, attempt + 1, max_retries + 1,
                )
                raise
            logger.warning(
                "Gemini API transient failure [%s]. Retrying in %.1fs... (attempt %d/%d): %s",
                kind, delay, attempt + 1, max_retries + 1, e,
            )
            time.sleep(delay)
            delay *= backoff_factor


def retry_generator_with_backoff(
    func: Callable[P, Iterator[T]],
    *args: P.args,
    max_retries: int = 3,
    initial_delay: float = 1.0,
    backoff_factor: float = 2.0,
    **kwargs: P.kwargs,
) -> Iterator[T]:
    """Execute a generator function with exponential backoff retries for transient errors."""
    delay: float = initial_delay
    for attempt in range(max_retries + 1):
        try:
            gen: Iterator[T] = func(*args, **kwargs)
            iterator: Iterator[T] = iter(gen)
            first_chunk: T = next(iterator)
            yield first_chunk
            yield from iterator
            return
        except StopIteration:
            return
        except Exception as e:
            kind = _classify_error(str(e))
            if attempt == max_retries or kind == "permanent":
                logger.error(
                    "Gemini API stream call failed permanently: %s (attempt %d/%d)",
                    e, attempt + 1, max_retries + 1,
                )
                raise
            logger.warning(
                "Gemini API stream transient failure [%s]. Retrying in %.1fs... (attempt %d/%d): %s",
                kind, delay, attempt + 1, max_retries + 1, e,
            )
            time.sleep(delay)
            delay *= backoff_factor


def get_client() -> genai.Client | None:
    """Get the initialized Gemini client if enabled."""
    if not settings.gemini_enabled or not settings.gemini_api_key:
        return None
    return genai.Client(api_key=settings.gemini_api_key)


# ---------------------------------------------------------------------------
# Internal helpers that try each model in the chain
# ---------------------------------------------------------------------------

def _call_with_model_fallback(
    client: genai.Client,
    build_request: Callable[[str], types.GenerateContentResponse],
    primary_model: str,
    label: str,
) -> types.GenerateContentResponse:
    """Call build_request(model) cycling through the fallback chain on rate limits."""
    chain = _build_model_chain(primary_model)
    last_exc: Exception | None = None

    for model in chain:
        try:
            response = retry_with_backoff(lambda m=model: build_request(m))
            if model != primary_model:
                logger.info("Gemini %s succeeded with fallback model: %s", label, model)
            return response
        except Exception as e:
            kind = _classify_error(str(e))
            if kind == "rate_limit" and model != chain[-1]:
                logger.warning(
                    "Gemini %s rate-limited on %s — trying next model. Error: %s",
                    label, model, e,
                )
                last_exc = e
                continue
            raise

    raise RuntimeError(f"All models exhausted for {label}") from last_exc


def _stream_with_model_fallback(
    client: genai.Client,
    build_request: Callable[[str], Iterator[types.GenerateContentResponse]],
    primary_model: str,
    label: str,
) -> Iterator[types.GenerateContentResponse]:
    """Stream build_request(model) cycling through the fallback chain on rate limits."""
    chain = _build_model_chain(primary_model)
    last_exc: Exception | None = None

    for model in chain:
        try:
            yielded_any = False
            for chunk in retry_generator_with_backoff(lambda m=model: build_request(m)):
                yielded_any = True
                yield chunk
            if model != primary_model and yielded_any:
                logger.info("Gemini %s stream succeeded with fallback model: %s", label, model)
            return
        except Exception as e:
            kind = _classify_error(str(e))
            if kind == "rate_limit" and model != chain[-1]:
                logger.warning(
                    "Gemini %s stream rate-limited on %s — trying next model. Error: %s",
                    label, model, e,
                )
                last_exc = e
                continue
            raise

    raise RuntimeError(f"All models exhausted for {label}") from last_exc


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def ask_coach(question: str, context: str, history: list[dict] = None) -> str:
    """Ask the AI coach a question, given the user's data context and conversation history."""
    client = get_client()
    if not client:
        return "AI features are currently disabled."

    history_str = ""
    if history:
        history_str = "Recent Conversation History:\n"
        for msg in history[-12:]:
            role = "Athlete" if msg["role"] == "user" else "Coach"
            history_str += f"{role}: {msg['content']}\n"
        history_str += "\n"

    prompt = f"{context}\n\n{history_str}Athlete Question:\n{question}"

    def build_request(model: str) -> types.GenerateContentResponse:
        return client.models.generate_content(
            model=model,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=COACH_SYSTEM_PROMPT,
                temperature=0.7,
            ),
        )

    try:
        response = _call_with_model_fallback(client, build_request, settings.gemini_model, "ask_coach")
        return response.text or "No response from AI."
    except Exception:
        logger.exception("Error communicating with AI (ask_coach)")
        return "Error communicating with AI."


def ask_coach_stream(
    question: str,
    context: str,
    history: list[dict[str, str]] | None = None,
) -> Iterator[str]:
    """Stream questions to the AI coach."""
    client: genai.Client | None = get_client()
    if not client:
        yield "AI features are currently disabled."
        return

    history_str: str = ""
    if history:
        history_str = "Recent Conversation History:\n"
        for msg in history[-12:]:
            role: str = "Athlete" if msg["role"] == "user" else "Coach"
            history_str += f"{role}: {msg['content']}\n"
        history_str += "\n"

    prompt: str = f"{context}\n\n{history_str}Athlete Question:\n{question}"

    def build_request(model: str) -> Iterator[types.GenerateContentResponse]:
        return client.models.generate_content_stream(
            model=model,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=COACH_SYSTEM_PROMPT,
                temperature=0.7,
            ),
        )

    try:
        for chunk in _stream_with_model_fallback(client, build_request, settings.gemini_model, "ask_coach_stream"):
            if chunk.text:
                yield chunk.text
    except Exception:
        logger.exception("Error communicating with AI (ask_coach_stream)")
        yield "Error communicating with AI."


def generate_briefing(context: str) -> str:
    """Generate a weekly briefing."""
    client = get_client()
    if not client:
        return "AI features are disabled."

    def build_request(model: str) -> types.GenerateContentResponse:
        return client.models.generate_content(
            model=model,
            contents=context,
            config=types.GenerateContentConfig(
                system_instruction=WEEKLY_BRIEFING_PROMPT,
                temperature=0.5,
            ),
        )

    try:
        response = _call_with_model_fallback(client, build_request, settings.gemini_model, "briefing")
        return response.text or "Failed to generate briefing."
    except Exception as e:
        return f"Error: {str(e)}"


def generate_postmortem(context: str, activity_context: str) -> str:
    """Generate a postmortem for a specific activity."""
    client = get_client()
    if not client:
        return "AI features are disabled."

    prompt = f"{context}\n\nActivity Details:\n{activity_context}"

    def build_request(model: str) -> types.GenerateContentResponse:
        return client.models.generate_content(
            model=model,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=POSTMORTEM_PROMPT,
                temperature=0.5,
            ),
        )

    try:
        response = _call_with_model_fallback(client, build_request, settings.gemini_model, "postmortem")
        return response.text or "Failed to generate postmortem."
    except Exception as e:
        return f"Error: {str(e)}"


def generate_postmortem_stream(context: str, activity_context: str) -> Iterator[str]:
    """Stream a postmortem analysis chunk by chunk."""
    client = get_client()
    if not client:
        yield "AI features are disabled."
        return

    prompt = f"{context}\n\nActivity Details:\n{activity_context}"

    try:
        response_stream = client.models.generate_content_stream(
            model=settings.gemini_model,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=POSTMORTEM_PROMPT,
                temperature=0.5,
            ),
        )
        for chunk in response_stream:
            if chunk.text:
                yield chunk.text
    except Exception as e:
        yield f"Error: {str(e)}"


