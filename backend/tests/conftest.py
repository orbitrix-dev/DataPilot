import os
from collections.abc import Iterator
from urllib.parse import urlsplit

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import Connection
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import BACKEND_DIR, Settings
from app.core.db import Database
from app.main import create_app
from app.seed import demo_registry
from app.seed_postgres import seed_demo


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
    # Every Settings() built during the test run (including Alembic's, and ones tests create directly) uses the test
    # database, never the development database configured in .env. Real environment variables override .env files.
    os.environ["DP_DATABASE_URL"] = TEST_DATABASE_URL.get_secret_value()
else:
    # Empty, not removed: removing it would let Settings() fall back to the development database URL in .env.
    os.environ["DP_DATABASE_URL"] = ""
# Migrations in tests always target the test database too (an empty value falls back to DP_DATABASE_URL).
os.environ["DP_MIGRATION_DATABASE_URL"] = ""


def alembic_config() -> Config:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.attributes["configure_logger"] = False  # keep pytest's logging setup
    return cfg


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


@pytest.fixture(scope="session")
def migrated(database) -> Database:
    """The test database rebuilt from empty by Alembic once per run (downgrade base, then upgrade head)."""
    cfg = alembic_config()
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")
    return database


@pytest.fixture
def db_session(migrated) -> Iterator[Session]:
    """A session whose work is rolled back after the test. Code under test may still use savepoints and flush;
    nothing it does is ever committed, so tests can't see each other's rows."""
    conn = migrated.engine.connect()
    outer = conn.begin()
    session = Session(bind=conn, join_transaction_mode="create_savepoint")
    try:
        yield session
    finally:
        session.close()
        outer.rollback()
        conn.close()


class BoundDatabase(Database):
    """A ``Database`` whose sessions run inside one test connection's transaction.

    Request transactions become savepoints: the app commits and rolls back exactly as in production (commit hooks
    such as audit publishing included), and everything is discarded when the test's outer transaction rolls back.
    """

    def __init__(self, base: Database, connection: Connection) -> None:
        self.engine = base.engine  # ping() only
        self._sessions = sessionmaker(bind=connection, join_transaction_mode="create_savepoint", expire_on_commit=False)

    def dispose(self) -> None:
        pass  # the connection belongs to the test fixture


@pytest.fixture
def pg_conn(migrated) -> Iterator[Connection]:
    """A connection in an outer transaction with the demo tenant seeded; rolled back after the test."""
    conn = migrated.engine.connect()
    outer = conn.begin()
    with Session(bind=conn, join_transaction_mode="create_savepoint") as s:
        seed_demo(s)
        s.commit()
    try:
        yield conn
    finally:
        outer.rollback()
        conn.close()


@pytest.fixture
def pg_db(migrated, pg_conn) -> BoundDatabase:
    return BoundDatabase(migrated, pg_conn)


@pytest.fixture
def registry():
    """In-memory data for the modules not yet in PostgreSQL (Connect, Trust, Automate, Billing, API keys, audit)."""
    return demo_registry()


@pytest.fixture
def client(registry, pg_db) -> TestClient:
    """A fresh app per test: Tenants in PostgreSQL (demo seeded), other modules in memory. Requests act as Elena Vance
    (Administrator) unless `as_user` is passed."""
    return TestClient(create_app(Settings(env="test"), registry, database=pg_db), base_url="http://testserver/api/v1")


def as_user(user_id: str) -> dict[str, str]:
    return {"X-DataPilot-User": user_id}


def audit_events(client: TestClient, **params) -> list[dict]:
    return client.get("/audit-events", params=params).json()["items"]
