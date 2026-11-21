from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    """Runtime configuration, read from ``DP_*`` environment variables.

    Values are also read from ``.env`` at the repository root (shared with Docker Compose) and then
    ``backend/.env``; real environment variables take precedence over both. See ``.env.example``.
    """

    model_config = SettingsConfigDict(
        env_prefix="DP_", env_file=(REPO_DIR / ".env", BACKEND_DIR / ".env"), extra="ignore"
    )

    env: Literal["dev", "test", "prod"] = "dev"
    api_prefix: str = "/api/v1"
    # The Vite dev server.
    cors_origins: list[str] = ["http://localhost:5173"]
    # Dev-only identity headers (X-DataPilot-Tenant / X-DataPilot-User). Never honoured in prod.
    default_dev_tenant: str = "acme"
    default_dev_user: str = "u-elena"

    # PostgreSQL, as a SQLAlchemy URL: postgresql+psycopg://user:password@host:5432/dbname.
    # Optional outside prod while modules still run on in-memory storage.
    database_url: SecretStr | None = None
    # Used only by Alembic. Optional: falls back to DP_DATABASE_URL. Set it when migrations should run as a
    # different (schema-owner) role than the API.
    migration_database_url: SecretStr | None = None
    # Migrations give up instead of queueing behind long transactions and blocking live traffic. 0 disables.
    db_migration_lock_timeout_ms: int = Field(default=10_000, ge=0)
    db_pool_size: int = Field(default=5, ge=1, le=100)
    db_max_overflow: int = Field(default=10, ge=0, le=100)
    db_pool_timeout_seconds: float = Field(default=10, gt=0)
    # Recycle connections before server/proxy idle limits close them. -1 disables.
    db_pool_recycle_seconds: int = Field(default=1800, ge=-1)
    db_connect_timeout_seconds: int = Field(default=5, ge=1)
    # Server-side cap on any single statement. 0 disables.
    db_statement_timeout_ms: int = Field(default=15_000, ge=0)
    db_echo: bool = False

    @property
    def dev_auth_enabled(self) -> bool:
        return self.env in ("dev", "test")

    @field_validator("database_url", "migration_database_url", mode="before")
    @classmethod
    def _empty_means_unset(cls, v: object) -> object:
        return None if isinstance(v, str) and not v.strip() else v

    @model_validator(mode="after")
    def _require_database_in_prod(self) -> "Settings":
        if self.env == "prod" and self.database_url is None:
            raise ValueError("DP_DATABASE_URL is required when DP_ENV=prod")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
