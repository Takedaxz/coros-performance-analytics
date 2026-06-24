"""AI package — unified dispatch layer.

Import the four public functions from here; the correct backend
(Gemini native SDK or OpenAI-compatible) is selected automatically
based on OPENAI_COMPAT_ENABLED in the environment.

Priority: OpenAI-compat > Gemini native.
"""

from src.config import get_settings

_settings = get_settings()

if _settings.openai_compat_enabled and _settings.openai_compat_api_key:
    from src.ai.openai_compat_client import (
        ask_coach,
        ask_coach_stream,
        generate_briefing,
        generate_postmortem,
    )
else:
    from src.ai.gemini_client import (  # type: ignore[no-redef]
        ask_coach,
        ask_coach_stream,
        generate_briefing,
        generate_postmortem,
    )

__all__ = ["ask_coach", "ask_coach_stream", "generate_briefing", "generate_postmortem"]
