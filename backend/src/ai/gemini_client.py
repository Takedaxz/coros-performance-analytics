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
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
    "gemini-2.5-flash",
]

_RATE_LIMIT_TERMS: frozenset[str] = frozenset(["429", "exhausted", "quota", "limit", "demand"])
_TRANSIENT_TERMS: frozenset[str] = frozenset(
    [
        "503",
        "unavailable",
        "temporary",
        "disconnected",
        "connection",
        "protocol",
        "reset",
        "eof",
        "broken",
    ]
)


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
            if attempt == max_retries or kind in ("permanent", "rate_limit"):
                logger.warning(
                    "Gemini API call [%s] advancing to model fallback: %s",
                    kind,
                    e,
                )
                raise
            logger.warning(
                "Gemini API transient failure [%s]. Retrying in %.1fs... (attempt %d/%d): %s",
                kind,
                delay,
                attempt + 1,
                max_retries + 1,
                e,
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
            if attempt == max_retries or kind in ("permanent", "rate_limit"):
                logger.warning(
                    "Gemini API stream call [%s] advancing to model fallback: %s",
                    kind,
                    e,
                )
                raise
            logger.warning(
                "Gemini API stream transient failure [%s]. Retrying in %.1fs... (attempt %d/%d): %s",
                kind,
                delay,
                attempt + 1,
                max_retries + 1,
                e,
            )
            time.sleep(delay)
            delay *= backoff_factor


def get_client() -> genai.Client | None:
    """Get the initialized Gemini client if API key is configured and enabled."""
    if not settings.gemini_enabled or not settings.gemini_api_key:
        return None
    return genai.Client(api_key=settings.gemini_api_key)


def list_models() -> list[str]:
    """Return available direct Gemini models."""
    return [
        "gemini-3.7-flash",
        "gemini-3.6-flash",
        "gemini-3.5-flash",
        "gemini-3.5-flash-lite",
        "gemini-3.1-flash-lite",
        "gemini-3-flash-preview",
        "gemini-2.5-flash",
        "gemini-2.5-flash-lite",
    ]


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
                    label,
                    model,
                    e,
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
                    label,
                    model,
                    e,
                )
                last_exc = e
                continue
            raise

    raise RuntimeError(f"All models exhausted for {label}") from last_exc


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def ask_coach(
    question: str,
    context: str,
    history: list[dict[str, str]] | None = None,
    model: str | None = None,
) -> str:
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
    target_model = model or settings.gemini_model

    def build_request(m: str) -> types.GenerateContentResponse:
        return client.models.generate_content(
            model=m,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=COACH_SYSTEM_PROMPT,
                temperature=0.7,
            ),
        )

    try:
        response = _call_with_model_fallback(client, build_request, target_model, "ask_coach")
        return response.text or "No response from AI."
    except Exception:
        logger.exception("Error communicating with AI (ask_coach)")
        return "Error communicating with AI."


def ask_coach_stream(
    question: str,
    context: str,
    history: list[dict[str, str]] | None = None,
    model: str | None = None,
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
    target_model: str = model or settings.gemini_model

    def build_request(m: str) -> Iterator[types.GenerateContentResponse]:
        return client.models.generate_content_stream(
            model=m,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=COACH_SYSTEM_PROMPT,
                temperature=0.7,
            ),
        )

    try:
        in_thinking = False
        for chunk in _stream_with_model_fallback(
            client, build_request, target_model, "ask_coach_stream"
        ):
            if (
                not chunk.candidates
                or not chunk.candidates[0].content
                or not chunk.candidates[0].content.parts
            ):
                if chunk.text:
                    if in_thinking:
                        yield "</think>\n"
                        in_thinking = False
                    yield chunk.text
                continue

            for part in chunk.candidates[0].content.parts:
                is_thought = getattr(part, "thought", False)
                text_content = getattr(part, "text", "")
                if is_thought and text_content:
                    if not in_thinking:
                        yield "<think>"
                        in_thinking = True
                    yield text_content
                elif text_content:
                    if in_thinking:
                        yield "</think>\n"
                        in_thinking = False
                    yield text_content

        if in_thinking:
            yield "</think>\n"
    except Exception:
        logger.exception("Error communicating with AI (ask_coach_stream)")
        yield "Error communicating with AI."


def generate_briefing(context: str, model: str | None = None) -> str:
    """Generate a weekly briefing."""
    client = get_client()
    if not client:
        return "AI features are disabled."

    target_model = model or settings.gemini_model

    def build_request(m: str) -> types.GenerateContentResponse:
        return client.models.generate_content(
            model=m,
            contents=context,
            config=types.GenerateContentConfig(
                system_instruction=WEEKLY_BRIEFING_PROMPT,
                temperature=0.5,
            ),
        )

    try:
        response = _call_with_model_fallback(client, build_request, target_model, "briefing")
        return response.text or "Failed to generate briefing."
    except Exception as e:
        return f"Error: {str(e)}"


def generate_postmortem(context: str, activity_context: str, model: str | None = None) -> str:
    """Generate a postmortem for a specific activity."""
    client = get_client()
    if not client:
        return "AI features are disabled."

    prompt = f"{context}\n\nActivity Details:\n{activity_context}"
    target_model = model or settings.gemini_model

    def build_request(m: str) -> types.GenerateContentResponse:
        return client.models.generate_content(
            model=m,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=POSTMORTEM_PROMPT,
                temperature=0.5,
            ),
        )

    try:
        response = _call_with_model_fallback(client, build_request, target_model, "postmortem")
        return response.text or "Failed to generate postmortem."
    except Exception as e:
        return f"Error: {str(e)}"


def generate_postmortem_stream(
    context: str, activity_context: str, model: str | None = None
) -> Iterator[str]:
    """Stream a postmortem analysis chunk by chunk."""
    client = get_client()
    if not client:
        yield "AI features are disabled."
        return

    prompt = f"{context}\n\nActivity Details:\n{activity_context}"
    target_model = model or settings.gemini_model

    def build_request(m: str) -> Iterator[types.GenerateContentResponse]:
        return client.models.generate_content_stream(
            model=m,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=POSTMORTEM_PROMPT,
                temperature=0.5,
            ),
        )

    try:
        for chunk in _stream_with_model_fallback(
            client, build_request, target_model, "postmortem_stream"
        ):
            if chunk.text:
                yield chunk.text
    except Exception as e:
        yield f"Error: {str(e)}"

