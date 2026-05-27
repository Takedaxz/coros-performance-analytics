"""Application configuration loaded from environment variables."""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


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
    allowed_user_email: str = "you@example.com"
    raw_file_store_path: str = "./data/raw_files"

    # --- Database ---
    database_url: str = "postgresql+asyncpg://coros:coros_dev@localhost:5432/coros_analytics"

    # --- Redis ---
    redis_url: str = "redis://localhost:6379/0"

    # Coros API
    coros_email: str | None = None
    coros_password: str | None = None
    sync_interval_minutes: int = Field(default=15, ge=1, le=1440)

    # --- Gemini AI ---
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"
    gemini_enabled: bool = False

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


def get_settings() -> Settings:
    """Factory function for settings singleton."""
    return Settings()
