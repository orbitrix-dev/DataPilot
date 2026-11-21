from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.client_address import parse_trusted_proxies
from app.core.security import parse_keyring

BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    """Runtime configuration, read from ``DP_*`` environment variables.

    Values are also read from ``.env`` at the repository root (shared with Docker Compose) and then
    ``backend/.env``; real environment variables take precedence over both. See ``.env.example``.
    """

    model_config = SettingsConfigDict(
        env_prefix="DP_",
        env_file=(REPO_DIR / ".env", BACKEND_DIR / ".env"),
        extra="ignore",
        # Validation errors must never echo an input: settings hold database passwords and key secrets.
        hide_input_in_errors=True,
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

    # Reverse proxies whose X-Forwarded-For is trusted: comma-separated IPs/CIDRs. Empty (default) trusts none, so the
    # client address is always the direct peer. See app/core/client_address.py.
    trusted_proxies: str = ""

    @property
    def trusted_proxy_networks(self) -> tuple:
        return parse_trusted_proxies(self.trusted_proxies)

    @field_validator("trusted_proxies")
    @classmethod
    def _valid_proxies(cls, v: str) -> str:
        parse_trusted_proxies(v)  # ValueError (→ ValidationError) on any invalid entry: misconfiguration stops startup
        return v

    # ---- Authentication (Stage 3B.1). Keyrings are "<version>=<secret>" lists (secrets >= 32 characters); the active
    # version signs/hashes, every listed version still verifies, so keys can be rotated without logging users out.
    jwt_signing_keys: SecretStr | None = None
    jwt_active_kid: str | None = None
    jwt_issuer: str = "datapilot"
    jwt_audience: str = "datapilot-api"
    access_token_ttl_seconds: int = Field(default=900, ge=60, le=900)  # 15 minutes at most
    refresh_session_ttl_days: int = Field(default=30, ge=1, le=90)  # absolute session lifetime
    api_key_peppers: SecretStr | None = None
    api_key_pepper_version: str | None = None
    invitation_ttl_hours: int = Field(default=24, ge=1, le=72)
    # ---- MFA (Stage 3B.2). TOTP secrets are encrypted with AES-256-GCM under a key derived (HKDF-SHA256) from the
    # active version's secret; every listed version still decrypts, and secrets are re-encrypted on use.
    mfa_encryption_keys: SecretStr | None = None
    mfa_encryption_key_version: str | None = None
    mfa_issuer: str = "DataPilot"  # the name authenticator apps show

    @property
    def dev_auth_enabled(self) -> bool:
        return self.env in ("dev", "test")

    @field_validator(
        "database_url",
        "migration_database_url",
        "jwt_signing_keys",
        "api_key_peppers",
        "mfa_encryption_keys",
        mode="before",
    )
    @classmethod
    def _empty_means_unset(cls, v: object) -> object:
        return None if isinstance(v, str) and not v.strip() else v

    @field_validator("jwt_active_kid", "api_key_pepper_version", "mfa_encryption_key_version", mode="before")
    @classmethod
    def _empty_version_means_unset(cls, v: object) -> object:
        return None if isinstance(v, str) and not v.strip() else v

    @field_validator("jwt_signing_keys", "api_key_peppers", "mfa_encryption_keys")
    @classmethod
    def _valid_keyring(cls, v: SecretStr | None) -> SecretStr | None:
        parse_keyring(v)  # malformed entries or short secrets stop startup (the error never contains a secret)
        return v

    @model_validator(mode="after")
    def _require_database_in_prod(self) -> "Settings":
        if self.env == "prod" and self.database_url is None:
            raise ValueError("DP_DATABASE_URL is required when DP_ENV=prod")
        for keys, active, name in (
            (self.jwt_signing_keys, self.jwt_active_kid, "DP_JWT_SIGNING_KEYS/DP_JWT_ACTIVE_KID"),
            (self.api_key_peppers, self.api_key_pepper_version, "DP_API_KEY_PEPPERS/DP_API_KEY_PEPPER_VERSION"),
            (
                self.mfa_encryption_keys,
                self.mfa_encryption_key_version,
                "DP_MFA_ENCRYPTION_KEYS/DP_MFA_ENCRYPTION_KEY_VERSION",
            ),
        ):
            if keys is not None or active is not None or self.env == "prod":
                if keys is None or active is None:
                    raise ValueError(f"{name} must both be set" + (" when DP_ENV=prod" if self.env == "prod" else ""))
                if active not in parse_keyring(keys):
                    raise ValueError(f"{name}: the active version is not in the keyring")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
