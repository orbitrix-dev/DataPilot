"""Stage 1: PostgreSQL connection management, per-request transactions and the DB health check."""

from collections.abc import Iterator
from typing import get_args
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import text

from app.core.config import Settings
from app.core.db import Database, DbSession
from app.core.errors import Conflict
from app.main import create_app

UNREACHABLE = "postgresql+psycopg://nobody:not-a-real-password@127.0.0.1:1/nowhere_test"


@pytest.fixture
def probe(database: Database) -> Iterator[str]:
    """A throwaway table, since Stage 1 has no schema yet. Dropped after the test."""
    name = f"stage1_probe_{uuid4().hex[:8]}"
    with database.session() as s:
        s.execute(text(f"CREATE TABLE {name} (id int PRIMARY KEY, note text NOT NULL)"))
    yield name
    with database.session() as s:
        s.execute(text(f"DROP TABLE IF EXISTS {name}"))


def rows(database: Database, table: str) -> list[tuple]:
    with database.engine.connect() as conn:  # a separate connection: sees committed data only
        return [tuple(r) for r in conn.execute(text(f"SELECT id, note FROM {table} ORDER BY id"))]


# ---------------------------------------------------------------- connection


def test_connects_to_the_isolated_test_database(database):
    assert database.ping() > 0
    with database.engine.connect() as conn:
        assert conn.execute(text("SELECT current_database()")).scalar_one().endswith("_test")
        assert int(conn.execute(text("SHOW server_version_num")).scalar_one()) >= 160000


def test_engine_applies_pool_and_session_settings():
    db = Database(UNREACHABLE.replace("127.0.0.1:1", "localhost"), pool_size=3, max_overflow=2, pool_timeout=4)
    try:
        assert db.engine.pool.size() == 3
        assert db.engine.pool._max_overflow == 2
        assert db.engine.pool._pre_ping is True
    finally:
        db.dispose()


def test_statement_timeout_is_enforced_by_the_server(database):
    db = Database(database.engine.url.render_as_string(hide_password=False), statement_timeout_ms=150)
    try:
        with db.engine.connect() as conn:
            assert conn.execute(text("SHOW statement_timeout")).scalar_one() == "150ms"
            assert conn.execute(text("SHOW TimeZone")).scalar_one() == "UTC"
            with pytest.raises(Exception, match="statement timeout"):
                conn.execute(text("SELECT pg_sleep(2)"))
    finally:
        db.dispose()


# ---------------------------------------------------------------- unit of work


def test_session_commits_when_the_block_succeeds(database, probe):
    with database.session() as s:
        s.execute(text(f"INSERT INTO {probe} VALUES (1, 'kept')"))
    assert rows(database, probe) == [(1, "kept")]


def test_session_rolls_back_when_the_block_raises(database, probe):
    with pytest.raises(RuntimeError), database.session() as s:
        s.execute(text(f"INSERT INTO {probe} VALUES (1, 'lost')"))
        raise RuntimeError("boom")
    assert rows(database, probe) == []


def test_failed_statement_rolls_back_the_whole_transaction(database, probe):
    with pytest.raises(Exception, match="duplicate key"), database.session() as s:
        s.execute(text(f"INSERT INTO {probe} VALUES (1, 'first')"))
        s.execute(text(f"INSERT INTO {probe} VALUES (1, 'duplicate')"))
    assert rows(database, probe) == []


# ---------------------------------------------------------------- per-request transactions


@pytest.fixture
def tx_client(database, probe) -> TestClient:
    """The real app plus two routes that write through the DbSession dependency."""
    app = create_app(Settings(env="test"), database=database)

    @app.post("/_probe/ok")
    def ok(db: DbSession) -> dict:
        db.execute(text(f"INSERT INTO {probe} VALUES (1, 'committed')"))
        return {"rows": rows(database, probe)}  # what another connection sees *before* the response

    @app.post("/_probe/conflict")
    def conflict(db: DbSession) -> dict:
        db.execute(text(f"INSERT INTO {probe} VALUES (2, 'rolled back')"))
        raise Conflict("Something is in the way")

    return TestClient(app)


def test_request_transaction_commits_on_success(tx_client, database, probe):
    r = tx_client.post("/_probe/ok")
    assert r.status_code == 200
    assert r.json() == {"rows": []}  # not visible to other connections until the route returns...
    assert rows(database, probe) == [(1, "committed")]  # ...then committed


def test_commit_failure_is_reported_to_the_client_not_hidden_behind_a_200(database):
    """The commit runs before the response is sent. A deferred constraint only fails at COMMIT: the client must
    get an error, not a success for data that was never saved. (With FastAPI's default request-scoped dependency
    cleanup the 200 would already be on the wire when the commit failed.)"""
    table = f"stage1_deferred_{uuid4().hex[:8]}"
    with database.session() as s:
        s.execute(text(f"CREATE TABLE {table} (id int, UNIQUE (id) DEFERRABLE INITIALLY DEFERRED)"))
    try:
        app = create_app(Settings(env="test"), database=database)

        @app.post("/_probe/deferred")
        def deferred(db: DbSession) -> dict:
            db.execute(text(f"INSERT INTO {table} VALUES (1), (1)"))  # accepted until COMMIT
            return {"saved": True}

        r = TestClient(app, raise_server_exceptions=False).post("/_probe/deferred")
        assert r.status_code == 500 and "saved" not in r.text
        with database.engine.connect() as conn:
            assert conn.execute(text(f"SELECT count(*) FROM {table}")).scalar_one() == 0
    finally:
        with database.session() as s:
            s.execute(text(f"DROP TABLE IF EXISTS {table}"))


def test_db_session_dependency_is_function_scoped():
    """The behaviour above depends on scope="function" (FastAPI >= 0.121). Fail loudly if it's ever dropped."""
    depends = get_args(DbSession)[1]
    assert depends.scope == "function", "DbSession must commit before the response is sent"


def test_request_transaction_rolls_back_on_domain_error(tx_client, database, probe):
    r = tx_client.post("/_probe/conflict")
    assert r.status_code == 409
    assert r.json() == {"error": {"code": "conflict", "message": "Something is in the way"}}
    assert rows(database, probe) == []


def test_database_failures_return_503_without_leaking_details():
    app = create_app(Settings(env="test", database_url=UNREACHABLE, db_connect_timeout_seconds=1))

    @app.get("/_probe/read")
    def read(db: DbSession) -> dict:
        db.execute(text("SELECT 1"))
        return {}

    r = TestClient(app).get("/_probe/read")
    assert r.status_code == 503
    assert r.json() == {"error": {"code": "service_unavailable", "message": "The database is temporarily unavailable"}}
    assert "not-a-real-password" not in r.text and "127.0.0.1" not in r.text


def test_routes_needing_the_database_return_503_when_it_is_not_configured():
    app = create_app(Settings(env="test", database_url=None))

    @app.get("/_probe/read")
    def read(db: DbSession) -> dict:
        return {}

    r = TestClient(app).get("/_probe/read")
    assert r.status_code == 503 and r.json()["error"]["code"] == "service_unavailable"


# ---------------------------------------------------------------- health check & config


def test_health_check_reports_a_reachable_database(database):
    r = TestClient(create_app(Settings(env="test"), database=database)).get("/healthz/db")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok" and body["database"] == "ok" and body["latency_ms"] >= 0


def test_health_check_reports_an_unreachable_database():
    app = create_app(Settings(env="test", database_url=UNREACHABLE, db_connect_timeout_seconds=1))
    r = TestClient(app).get("/healthz/db")
    assert r.status_code == 503
    assert r.json() == {"status": "unavailable", "database": "unreachable"}
    assert "not-a-real-password" not in r.text


def test_health_check_reports_a_missing_configuration():
    r = TestClient(create_app(Settings(env="test", database_url=None))).get("/healthz/db")
    assert r.status_code == 503
    assert r.json() == {"status": "unavailable", "database": "not_configured"}


def test_liveness_does_not_depend_on_the_database():
    app = create_app(Settings(env="test", database_url=UNREACHABLE))
    assert TestClient(app).get("/healthz").json() == {"status": "ok", "env": "test"}


def test_production_requires_a_database_url():
    with pytest.raises(ValidationError, match="DP_DATABASE_URL is required"):
        Settings(env="prod", database_url=None)


def test_database_url_is_never_printed():
    s = Settings(env="test", database_url=UNREACHABLE)
    assert "not-a-real-password" not in repr(s) and "not-a-real-password" not in str(s.model_dump())


def test_empty_database_url_means_not_configured():
    assert Settings(env="test", database_url="  ").database_url is None


def test_app_disposes_its_own_engine_on_shutdown(database):  # `database`: requires the test DB to be configured
    app = create_app(Settings(env="test"))
    with TestClient(app) as c:
        assert c.get("/healthz/db").status_code == 200
        assert app.state.db.engine.pool.checkedin() >= 1
    assert app.state.db.engine.pool.checkedin() == 0  # pool emptied by dispose()
