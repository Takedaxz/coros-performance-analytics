"""Application configuration loaded from environment variables."""

import uuid

from pydantic import Field, computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Stable UUID5 namespace for deriving per-installation user IDs.
_USER_NS = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")  # uuid.NAMESPACE_URL


class Settings(BaseSettings):
    """Central configuration. All values come from env vars or .env file."""

    model_config = SettingsConfigDict(
        env_file="../.env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # --- App ---
    app_env: str = "development"
    app_secret_key: str = "change-me-in-production"
    raw_file_store_path: str = "./data/raw_files"

    # --- Owner (single-user installation) ---
    # Set OWNER_EMAIL in your .env file.  All other owner fields are optional.
    owner_email: str = "you@example.com"
    owner_timezone: str = "UTC"
    owner_units: str = "metric"  # "metric" | "imperial"

    # --- Database ---
    database_url: str = "postgresql+asyncpg://coros:coros_dev@localhost:5432/coros_analytics"

    # --- Redis ---
    redis_url: str = "redis://localhost:6379/0"

    # --- COROS API ---
    coros_email: str | None = None
    coros_password: str | None = None
    sync_interval_minutes: int = Field(default=15, ge=1, le=1440)

    # --- COROS MCP (OAuth for sleep data) ---
    coros_mcp_url: str = "https://mcpus.coros.com/mcp"
    coros_mcp_redirect_uri: str = "http://localhost:8000/auth/coros-mcp/callback"

    # --- Gemini AI ---
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"
    gemini_enabled: bool = False

    # --- OpenAI-compatible AI ---
    openai_compat_enabled: bool = False
    openai_compat_api_key: str = ""
    openai_compat_base_url: str = "https://gen.ai.kku.ac.th/okmd/api/v1"
    openai_compat_model: str = "gemini-2.5-flash-lite"

    @computed_field  # type: ignore[misc]
    @property
    def owner_user_id(self) -> str:
        """Stable UUID5 (UUID แบบ deterministic จาก namespace + email) derived from owner_email.

        Different email → different ID automatically.
        Override with OWNER_USER_ID env var if you need a specific value.
        """
        return str(uuid.uuid5(_USER_NS, self.owner_email))

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    # Back-compat alias used in older code paths.
    @property
    def allowed_user_email(self) -> str:
        return self.owner_email


def get_settings() -> Settings:
    """Factory function for settings singleton."""
    return Settings()
