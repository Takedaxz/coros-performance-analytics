"""Single-user owner identity helpers.

This module is the single source of truth for the owner user ID.
All route handlers import ``get_owner_id()`` instead of hardcoding a UUID.
"""

from src.config import get_settings


def get_owner_id() -> str:
    """Return the stable user ID for the installation owner.

    The value is derived from ``OWNER_EMAIL`` (or ``owner_email`` in .env)
    via UUID5 (UUID แบบ deterministic จาก namespace + email), so it changes
    automatically when the email changes and never requires manual UUID management.
    """
    return get_settings().owner_user_id
