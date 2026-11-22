import os
import secrets
from collections.abc import Iterator
from contextlib import contextmanager
from urllib.parse import urlsplit

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import event, text
from sqlalchemy.engine import Connection, Engine, make_url
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import BACKEND_DIR, Settings
from app.core.db import Database
from app.main import create_app
from app.seed import demo_registry
from app.seed_postgres import seed_demo

from .tenant_context_guard import GUARD


class _TestEnv(BaseSettings):
    """Reads the test database URLs from the environment or the same .env files the app uses."""

    model_config = SettingsConfigDict(env_prefix="DP_", env_file=Settings.model_config["env_file"], extra="ignore")
    # The runtime user (datapilot_app): what the application connects as.
    test_database_url: SecretStr | None = None
    # The owner: migrations, schema-constraint tests and cleanup.
    test_migration_database_url: SecretStr | None = None


def _configured(v: SecretStr | None) -> str | None:
    return v.get_secret_value() if v is not None and v.get_secret_value().strip() else None


_env = _TestEnv()
TEST_DATABASE_URL = _configured(_env.test_database_url)  # empty means "not configured"
TEST_OWNER_URL = _configured(_env.test_migration_database_url)

if TEST_DATABASE_URL is not None:
    if TEST_OWNER_URL is None or make_url(TEST_OWNER_URL).username == make_url(TEST_DATABASE_URL).username:
        raise pytest.UsageError(
            "Set DP_TEST_MIGRATION_DATABASE_URL to the owner user; it must differ from DP_TEST_DATABASE_URL's runtime "
            "user (see .env.example)"
        )
    for _url in (TEST_DATABASE_URL, TEST_OWNER_URL):
        _db_name = urlsplit(_url).path.lstrip("/")
        if not _db_name.endswith("_test"):
            raise pytest.UsageError(
                f"Test URL points at {_db_name!r}; tests only run against a database ending in '_test'"
            )
    # Every Settings() built during the run (the app's, Alembic's, ones tests create) uses the test database, never the
    # development database in .env. Real environment variables override .env files.
    os.environ["DP_DATABASE_URL"] = TEST_DATABASE_URL
    os.environ["DP_MIGRATION_DATABASE_URL"] = TEST_OWNER_URL
else:
    # Empty, not removed: removing them would let Settings() fall back to the development URLs in .env.
    os.environ["DP_DATABASE_URL"] = ""
    os.environ["DP_MIGRATION_DATABASE_URL"] = ""


# Fresh random authentication keys for every test run (never the development keys from .env, never committed).
TEST_JWT_KID = "test-k1"
os.environ["DP_JWT_SIGNING_KEYS"] = f"{TEST_JWT_KID}={secrets.token_urlsafe(48)}"
os.environ["DP_JWT_ACTIVE_KID"] = TEST_JWT_KID
os.environ["DP_API_KEY_PEPPERS"] = f"p1={secrets.token_urlsafe(48)}"
os.environ["DP_API_KEY_PEPPER_VERSION"] = "p1"
os.environ["DP_MFA_ENCRYPTION_KEYS"] = f"m1={secrets.token_urlsafe(48)}"
os.environ["DP_MFA_ENCRYPTION_KEY_VERSION"] = "m1"
os.environ["DP_THROTTLE_KEYS"] = f"t1={secrets.token_urlsafe(48)}"
os.environ["DP_THROTTLE_KEY_VERSION"] = "t1"


def alembic_config() -> Config:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.attributes["configure_logger"] = False  # keep pytest's logging setup
    return cfg


def _connect(url: str | None) -> Database:
    """Fails (never skips) when the test database isn't configured or reachable."""
    if url is None:
        pytest.fail("DP_TEST_DATABASE_URL is not set. Start PostgreSQL with Docker Compose; see backend/README.md")
    db = Database(url, connect_timeout=3)
    try:
        db.ping()
    except Exception as exc:  # noqa: BLE001 — turn any connection failure into a clear test failure
        db.dispose()
        pytest.fail(f"Test database is unreachable ({type(exc).__name__}). Is `docker compose up -d postgres` running?")
    return db


@pytest.fixture(scope="session")
def database() -> Iterator[Database]:
    """The test database as the runtime user (datapilot_app): exactly the application's privileges."""
    db = _connect(TEST_DATABASE_URL)
    yield db
    db.dispose()


@pytest.fixture(scope="session")
def owner_database() -> Iterator[Database]:
    """The test database as the owner: migrations, schema-constraint tests and cleanup."""
    db = _connect(TEST_OWNER_URL)
    yield db
    db.dispose()


@pytest.fixture(scope="session")
def migrated(database, owner_database) -> Database:
    """The test database rebuilt from empty by Alembic (as the owner) once per run; returns the runtime-user handle."""
    cfg = alembic_config()
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")
    return database


def _rolled_back_session(db: Database) -> Iterator[Session]:
    conn = db.engine.connect()
    outer = conn.begin()
    session = Session(bind=conn, join_transaction_mode="create_savepoint")
    try:
        yield session
    finally:
        session.close()
        outer.rollback()
        conn.close()


@pytest.fixture
def db_session(migrated) -> Iterator[Session]:
    """A runtime-user session whose work is rolled back after the test (savepoints and flushes still work)."""
    yield from _rolled_back_session(migrated)


@pytest.fixture
def owner_session(migrated, owner_database) -> Iterator[Session]:
    """An owner session whose work is rolled back: for tests of database constraints and delete rules themselves."""
    yield from _rolled_back_session(owner_database)


class BoundDatabase(Database):
    """A ``Database`` whose sessions run inside one test connection's transaction.

    Request transactions become savepoints: the app commits and rolls back exactly as in production, and everything is
    discarded when the test's outer transaction rolls back.

    The tenant context (``app.tenant_id``, app/core/tenant_scope.py) is transaction-local in production, but releasing
    a savepoint keeps it in the outer transaction. Each unit of work therefore starts and ends with it cleared, as a
    production transaction would: one request's tenant must never be inherited by the next request of a test.
    """

    def __init__(self, base: Database, connection: Connection) -> None:
        self.engine = base.engine  # ping() only
        self._connection = connection
        self._sessions = sessionmaker(bind=connection, join_transaction_mode="create_savepoint", expire_on_commit=False)

    def _clear_tenant_context(self) -> None:
        self._connection.execute(text("SELECT set_config('app.tenant_id', '', true)"))

    @contextmanager
    def session(self) -> Iterator[Session]:
        self._clear_tenant_context()
        try:
            with super().session() as session:
                yield session
        finally:
            self._clear_tenant_context()

    def dispose(self) -> None:
        pass  # the connection belongs to the test fixture


@pytest.fixture
def pg_conn(migrated) -> Iterator[Connection]:
    """A runtime-user connection in an outer transaction with the demo tenant seeded (as the runtime user); rolled
    back after the test."""
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
    """In-memory data for the modules not yet in PostgreSQL (Connect, Trust, Automate, Billing, Notifications, keys)."""
    return demo_registry()


class RecordingSecurityAudit:
    """Test double for ``SecurityAuditWriter`` in tests whose data lives in an uncommitted test transaction (the real
    writer's independent transaction couldn't see that tenant). It validates exactly like the writer (registered
    action, metadata allowlist) and keeps the events for assertions. The real writer is exercised end to end, with
    committed data, in test_mfa.py and test_audit_postgres.py."""

    def __init__(self) -> None:
        self.events: list[dict] = []

    def record(self, action: str, summary: str, **fields) -> bool:
        from app.modules.audit import actions
        from app.modules.audit.sanitize import clean_metadata

        definition = actions.get(action)
        clean_metadata(definition, fields.get("metadata"))
        self.events.append({"action": action, "summary": summary, **fields})
        return True

    def actions(self) -> list[str]:
        return [e["action"] for e in self.events]

    def health(self) -> dict:
        return {"healthy": True, "state": "healthy", "events_written": len(self.events), "events_failed": 0}


@pytest.fixture
def security_audit() -> RecordingSecurityAudit:
    return RecordingSecurityAudit()


@pytest.fixture(scope="session")
def _shared_throttle(migrated):
    """One real limiter for the run (its own small pool on the test database, as the runtime user)."""
    from app.modules.auth.throttle import AuthThrottle

    limiter = AuthThrottle.from_settings(Settings(env="test"))
    yield limiter
    limiter.dispose()


def _clear_throttle_counters(owner_database) -> None:
    with owner_database.session() as s:
        s.execute(text("DELETE FROM auth_throttle_buckets"))


# Every engine in the run (the app's, the security writer's, the limiter's) reports to the tenant-context guard.
event.listen(Engine, "before_cursor_execute", GUARD.before_cursor_execute)


@pytest.fixture(autouse=True)
def _tenant_context_guard(request):
    """Fails a database test in which application code touched tenant-owned rows with no tenant bound
    (tests/tenant_context_guard.py). Tests of the guard itself opt out with ``@pytest.mark.no_tenant_guard``."""
    if "migrated" not in request.fixturenames or request.node.get_closest_marker("no_tenant_guard"):
        yield
        return
    GUARD.reset()
    GUARD.enabled = True
    try:
        yield
    finally:
        GUARD.enabled = False
    if GUARD.violations:
        pytest.fail(GUARD.report(), pytrace=False)


@pytest.fixture(autouse=True)
def _fresh_throttle_counters(request):
    """Abuse-protection counters are committed (they must survive a request's rollback), so they would carry over from
    test to test. Every test that touches the database starts and ends with an empty table."""
    if "migrated" not in request.fixturenames:
        yield
        return
    owner = request.getfixturevalue("owner_database")
    _clear_throttle_counters(owner)
    yield
    _clear_throttle_counters(owner)


@pytest.fixture
def throttle(_shared_throttle, security_audit):
    """The shared limiter, reporting throttling events to this test's security-event recorder."""
    _shared_throttle.security_audit = security_audit
    _shared_throttle._down_until = 0.0
    return _shared_throttle


_CURRENT: dict = {"throttle": None}


@pytest.fixture(autouse=True)
def _current_throttle(request):
    """Makes the shared limiter available to ``make_app`` in tests that use the database."""
    _CURRENT["throttle"] = request.getfixturevalue("throttle") if "pg_db" in request.fixturenames else None
    yield
    _CURRENT["throttle"] = None


def make_app(settings=None, registry=None, *, database=None, **kwargs):
    """``create_app`` for tests that inject the test database: wires in the shared limiter (unless one is given), as
    production wires in its own. Without a limiter, password and code checks fail closed (503)."""
    kwargs.setdefault("rate_limiter", _CURRENT["throttle"])
    return create_app(settings, registry, database=database, **kwargs)


@pytest.fixture
def client(registry, pg_db, security_audit, throttle) -> TestClient:
    """A fresh app per test: Tenants and audit in PostgreSQL (demo seeded), other modules in memory. Requests act as
    Elena Vance (Administrator) unless `as_user` is passed."""
    app = create_app(
        Settings(env="test"), registry, database=pg_db, security_audit=security_audit, rate_limiter=throttle
    )
    return TestClient(app, base_url="http://testserver/api/v1")


def as_user(user_id: str) -> dict[str, str]:
    return {"X-DataPilot-User": user_id}


def audit_events(client: TestClient, **params) -> list[dict]:
    return client.get("/audit-events", params=params).json()["items"]


def mfa_code(client: TestClient, user_id: str = "u-elena") -> str:
    """A real, unused TOTP code for ``user_id``, enrolling an authenticator for them first if needed (through the app's
    own test transaction). Codes are single use per 30-second step, so this clears the factor's last used step: tests
    may need several codes within one step."""
    import pyotp
    from sqlalchemy import select

    from app.modules.auth import mfa
    from app.modules.identity.models import User

    settings = Settings(env="test")
    with client.app.state.db.session() as s:
        user = s.scalar(select(User).where(User.public_id == user_id))
        factor = mfa.factor_for(s, user)
        if factor is None:
            secret = mfa.start_enrollment(s, settings, user).secret
            throttle = client.app.state.rate_limiter
            mfa.confirm_enrollment(s, settings, user, pyotp.TOTP(secret).now(), throttle=throttle)
            factor = mfa.factor_for(s, user)
        factor.last_used_step = None
        secret = mfa._secret(mfa.mfa_keyring(settings), factor, user)
    return pyotp.TOTP(secret).now()
