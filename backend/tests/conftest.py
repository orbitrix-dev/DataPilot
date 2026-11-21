import os
from urllib.parse import urlsplit

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.config import Settings
from app.core.db import Database
from app.main import create_app
from app.seed import demo_registry


class _TestEnv(BaseSettings):
    """Reads DP_TEST_DATABASE_URL from the environment or the same .env files the app uses."""

    model_config = SettingsConfigDict(env_prefix="DP_", env_file=Settings.model_config["env_file"], extra="ignore")
    test_database_url: SecretStr | None = None


TEST_DATABASE_URL = _TestEnv().test_database_url
if TEST_DATABASE_URL is not None and not TEST_DATABASE_URL.get_secret_value().strip():
    TEST_DATABASE_URL = None  # DP_TEST_DATABASE_URL= (empty) means "not configured"

if TEST_DATABASE_URL is not None:
    _db_name = urlsplit(TEST_DATABASE_URL.get_secret_value()).path.lstrip("/")
    if not _db_name.endswith("_test"):
        raise pytest.UsageError(
            f"DP_TEST_DATABASE_URL points at database {_db_name!r}; tests only run against a database ending in '_test'"
        )
    # Every Settings() built during the test run (including ones tests create directly) uses the test database,
    # never the development database configured in .env. Real environment variables override .env files.
    os.environ["DP_DATABASE_URL"] = TEST_DATABASE_URL.get_secret_value()
else:
    # Empty, not removed: removing it would let Settings() fall back to the development database URL in .env.
    os.environ["DP_DATABASE_URL"] = ""


@pytest.fixture(scope="session")
def database() -> Database:
    """The isolated test database. Fails (never skips) when it isn't configured or reachable."""
    if TEST_DATABASE_URL is None:
        pytest.fail("DP_TEST_DATABASE_URL is not set. Start PostgreSQL with Docker Compose; see backend/README.md")
    db = Database(TEST_DATABASE_URL.get_secret_value(), connect_timeout=3)
    try:
        db.ping()
    except Exception as exc:  # noqa: BLE001 — turn any connection failure into a clear test failure
        db.dispose()
        pytest.fail(f"Test database is unreachable ({type(exc).__name__}). Is `docker compose up -d postgres` running?")
    yield db
    db.dispose()


@pytest.fixture
def registry():
    return demo_registry()


@pytest.fixture
def client(registry) -> TestClient:
    """A fresh app and demo tenant per test. Requests act as Elena Vance (Administrator) unless `as_user` is passed."""
    return TestClient(create_app(Settings(env="test"), registry), base_url="http://testserver/api/v1")


def as_user(user_id: str) -> dict[str, str]:
    return {"X-DataPilot-User": user_id}


def audit_events(client: TestClient, **params) -> list[dict]:
    return client.get("/audit-events", params=params).json()["items"]
