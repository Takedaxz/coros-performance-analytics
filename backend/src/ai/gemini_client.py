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


def retry_with_backoff(func, *args, max_retries=3, initial_delay=1.0, backoff_factor=2.0, **kwargs):
    """Execute a function with exponential backoff retries for transient errors."""
    delay = initial_delay
    for attempt in range(max_retries + 1):
        try:
            return func(*args, **kwargs)
        except Exception as e:
            err_msg = str(e).lower()
            # Check if this is a transient error (e.g. 503, 429, Unavailable, ResourceExhausted)
            is_transient = any(
                term in err_msg
                for term in [
                    "503", "429", "unavailable", "exhausted",
                    "temporary", "demand", "limit"
                ]
            )

            if attempt == max_retries or not is_transient:
                logger.error(
                    f"Gemini API call failed permanently: {str(e)} "
                    f"(attempt {attempt + 1}/{max_retries + 1})"
                )
                raise e

            logger.warning(
                f"Gemini API transient failure. Retrying in {delay:.1f}s... "
                f"(attempt {attempt + 1}/{max_retries + 1}): {str(e)}"
            )
            time.sleep(delay)
            delay *= backoff_factor


T = TypeVar("T")
P = ParamSpec("P")


def retry_generator_with_backoff(  # noqa: UP047
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
            # Fetch the first chunk to trigger the connection
            first_chunk: T = next(iterator)
            yield first_chunk
            yield from iterator
            return
        except StopIteration:

            return
        except Exception as e:
            err_msg: str = str(e).lower()
            is_transient: bool = any(
                term in err_msg
                for term in [
                    "503", "429", "unavailable", "exhausted",
                    "temporary", "demand", "limit"
                ]
            )

            if attempt == max_retries or not is_transient:
                logger.error(
                    f"Gemini API stream call failed permanently: {str(e)} "
                    f"(attempt {attempt + 1}/{max_retries + 1})"
                )
                raise e

            logger.warning(
                f"Gemini API stream transient failure. Retrying in {delay:.1f}s... "
                f"(attempt {attempt + 1}/{max_retries + 1}): {str(e)}"
            )
            time.sleep(delay)
            delay *= backoff_factor


def get_client() -> genai.Client | None:
    """Get the initialized Gemini client if enabled."""
    if not settings.gemini_enabled or not settings.gemini_api_key:
        return None
    return genai.Client(api_key=settings.gemini_api_key)


def ask_coach(question: str, context: str, history: list[dict] = None) -> str:
    """Ask the AI coach a question, given the user's data context and conversation history."""
    client = get_client()
    if not client:
        return "AI features are currently disabled."

    history_str = ""
    if history:
        history_str = "Recent Conversation History:\n"
        # Only keep the last 4 messages to save context length
        for msg in history[-4:]:
            role = "Athlete" if msg["role"] == "user" else "Coach"
            history_str += f"{role}: {msg['content']}\n"
        history_str += "\n"

    prompt = f"{context}\n\n{history_str}Athlete Question:\n{question}"

    try:
        def call_api():
            return client.models.generate_content(
                model=settings.gemini_model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=COACH_SYSTEM_PROMPT,
                    temperature=0.7,
                ),
            )
        response = retry_with_backoff(call_api)
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
        # Only keep the last 4 messages to save context length
        for msg in history[-4:]:
            role: str = "Athlete" if msg["role"] == "user" else "Coach"
            history_str += f"{role}: {msg['content']}\n"
        history_str += "\n"

    prompt: str = f"{context}\n\n{history_str}Athlete Question:\n{question}"

    try:
        def call_api_stream() -> Iterator[types.GenerateContentResponse]:
            assert client is not None
            return client.models.generate_content_stream(
                model=settings.gemini_model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=COACH_SYSTEM_PROMPT,
                    temperature=0.7,
                ),
            )
        for chunk in retry_generator_with_backoff(call_api_stream):
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

    try:
        def call_briefing():
            return client.models.generate_content(
                model=settings.gemini_model,
                contents=context,
                config=types.GenerateContentConfig(
                    system_instruction=WEEKLY_BRIEFING_PROMPT,
                    temperature=0.5,
                ),
            )
        response = retry_with_backoff(call_briefing)
        return response.text or "Failed to generate briefing."
    except Exception as e:
        return f"Error: {str(e)}"


def generate_postmortem(context: str, activity_context: str) -> str:
    """Generate a postmortem for a specific activity."""
    client = get_client()
    if not client:
        return "AI features are disabled."

    prompt = f"{context}\n\nActivity Details:\n{activity_context}"
    try:
        def call_postmortem():
            return client.models.generate_content(
                model=settings.gemini_model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=POSTMORTEM_PROMPT,
                    temperature=0.5,
                ),
            )
        response = retry_with_backoff(call_postmortem)
        return response.text or "Failed to generate postmortem."
    except Exception as e:
        return f"Error: {str(e)}"
