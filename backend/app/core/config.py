from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration, read from environment variables prefixed with ``DP_``."""

    model_config = SettingsConfigDict(env_prefix="DP_", env_file=".env", extra="ignore")

    env: Literal["dev", "test", "prod"] = "dev"
    api_prefix: str = "/api/v1"
    # The Vite dev server.
    cors_origins: list[str] = ["http://localhost:5173"]
    # Dev-only identity headers (X-DataPilot-Tenant / X-DataPilot-User). Never honoured in prod.
    default_dev_tenant: str = "acme"
    default_dev_user: str = "u-elena"

    @property
    def dev_auth_enabled(self) -> bool:
        return self.env in ("dev", "test")


@lru_cache
def get_settings() -> Settings:
    return Settings()
