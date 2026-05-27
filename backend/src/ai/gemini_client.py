"""Gemini AI client wrapper."""

from google import genai
from google.genai import types

from src.ai.prompts import COACH_SYSTEM_PROMPT, POSTMORTEM_PROMPT, WEEKLY_BRIEFING_PROMPT
from src.config import get_settings

settings = get_settings()


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
        response = client.models.generate_content(
            model=settings.gemini_model,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=COACH_SYSTEM_PROMPT,
                temperature=0.7,
            ),
        )
        return response.text or "No response from AI."
    except Exception as e:
        return f"Error communicating with AI: {str(e)}"


def generate_briefing(context: str) -> str:
    """Generate a weekly briefing."""
    client = get_client()
    if not client:
        return "AI features are disabled."

    try:
        response = client.models.generate_content(
            model=settings.gemini_model,
            contents=context,
            config=types.GenerateContentConfig(
                system_instruction=WEEKLY_BRIEFING_PROMPT,
                temperature=0.5,
            ),
        )
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
        response = client.models.generate_content(
            model=settings.gemini_model,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=POSTMORTEM_PROMPT,
                temperature=0.5,
            ),
        )
        return response.text or "Failed to generate postmortem."
    except Exception as e:
        return f"Error: {str(e)}"
