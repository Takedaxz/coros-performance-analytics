"""Application configuration loaded from environment variables."""

from functools import cache
from uuid import UUID

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
    raw_file_store_path: str = "./data/raw_files"

    # --- Owner (single-user installation) ---
    # Keep the legacy ID when upgrading. New installations may set a unique UUID.
    owner_user_id: UUID = UUID(int=0)
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
    gemini_model: str = "gemini-3.6-flash"
    gemini_enabled: bool = False

    # --- OpenAI-compatible AI ---
    openai_compat_enabled: bool = False
    openai_compat_api_key: str = ""
    openai_compat_base_url: str = "https://gen.ai.kku.ac.th/okmd/api/v1"
    openai_compat_model: str = "gemini-3.5-flash-lite"

    # --- AgentRouter (OpenAI-compatible AI) ---
    agentrouter_api_key: str = ""
    agentrouter_base_url: str = "https://agentrouter.org/v1"
    agentrouter_model: str = "gpt-5.5"

    # --- Web Search Providers ---
    tavily_api_key: str = ""
    brave_search_api_key: str = ""

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    # Back-compat alias used in older code paths.
    @property
    def allowed_user_email(self) -> str:
        return self.owner_email


@cache
def get_settings() -> Settings:
    """Factory function for settings singleton."""
    return Settings()
