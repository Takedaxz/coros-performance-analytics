"""Single-user owner identity helpers.

This module is the single source of truth for the owner user ID.
All route handlers import ``get_owner_id()`` instead of hardcoding a UUID.
"""

from src.config import get_settings


def get_owner_id() -> str:
    """Return the configured stable user ID for the installation owner."""
    return str(get_settings().owner_user_id)
