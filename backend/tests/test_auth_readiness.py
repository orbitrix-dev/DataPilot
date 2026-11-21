"""Stage 3B.1: production refuses to start while a stored security setting can't be honoured or a control is missing."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.readiness import ProductionNotReady, assert_production_ready, production_blockers, tenant_blockers
from app.modules.audit import retention
from app.modules.auth import enforcement
from app.modules.tenants.models import Tenant, TenantSettings
from app.seed import demo_registry

from .conftest import TEST_DATABASE_URL, RecordingSecurityAudit, make_app


def db(conn) -> Session:
    return Session(bind=conn, join_transaction_mode="create_savepoint")


def _no_other_blockers(pg_db, monkeypatch) -> None:
    monkeypatch.setattr(retention, "is_enforced", lambda: True)
    with db(pg_db._sessions.kw["bind"]) as s:
        s.execute(update(TenantSettings).values(enforce_sso=False))
        s.commit()


def test_production_refuses_to_start_without_a_limiter(pg_db, monkeypatch):
    """Stage 3B.3: abuse protection is checked on the actual limiter instance, not a flag."""
    _no_other_blockers(pg_db, monkeypatch)
    assert production_blockers() == []  # nothing code-derived claims protection on its own
    with pytest.raises(ProductionNotReady, match="abuse protection is not active: no limiter"):
        assert_production_ready(pg_db, RecordingSecurityAudit(), None)


def test_production_checks_the_limiters_table_and_privileges(pg_db, monkeypatch, throttle):
    _no_other_blockers(pg_db, monkeypatch)
    assert_production_ready(pg_db, RecordingSecurityAudit(), throttle)  # every control in place: starts
    real_problems = throttle.problems

    def missing_table(session):
        return [*real_problems(session), "Abuse protection: table auth_throttle_buckets is missing"]

    monkeypatch.setattr(throttle, "problems", missing_table)
    with pytest.raises(ProductionNotReady, match="auth_throttle_buckets is missing"):
        assert_production_ready(pg_db, RecordingSecurityAudit(), throttle)


def test_limiter_problems_reports_a_missing_table(owner_session, throttle):
    """problems() runs real catalog queries (the runtime user's grants are checked by check-db-privileges too)."""
    from sqlalchemy import text

    assert throttle.problems(owner_session) == []
    owner_session.execute(text("ALTER TABLE auth_throttle_buckets RENAME TO auth_throttle_buckets_gone"))
    assert throttle.problems(owner_session) == [
        "Abuse protection: table auth_throttle_buckets is missing (run alembic upgrade head)"
    ]
    owner_session.execute(text("ALTER TABLE auth_throttle_buckets_gone RENAME TO auth_throttle_buckets"))


def test_production_settings_require_the_throttle_key():
    with pytest.raises(ValueError, match="DP_THROTTLE_KEYS"):
        Settings(env="prod", database_url="postgresql+psycopg://u@h/d", throttle_keys=None)


def test_the_demo_tenant_blocks_production_because_of_sso_only(pg_conn):
    """Since Stage 3B.2 require_mfa is enforced, so it no longer blocks; enforce_sso still does."""
    assert enforcement.mfa_enforced() is True
    with db(pg_conn) as s:
        assert tenant_blockers(s) == ["Tenant 'acme' has enforce_sso set, but SSO is not implemented"]


def test_each_setting_is_checked_on_its_own(pg_conn, monkeypatch):
    with db(pg_conn) as s:
        s.execute(update(TenantSettings).values(enforce_sso=False))
        assert tenant_blockers(s) == []
        monkeypatch.setattr(enforcement, "mfa_enforced", lambda: False)  # the guard still works if MFA regresses
        assert tenant_blockers(s) == ["Tenant 'acme' requires MFA, but MFA is not implemented"]


def test_deleted_tenants_do_not_block(pg_conn):
    with db(pg_conn) as s:
        s.execute(update(Tenant).values(status="deleted", deleted_at=Tenant.created_at))
        assert tenant_blockers(s) == []


def test_startup_reports_tenant_blockers_from_the_database(pg_db, monkeypatch, throttle):
    monkeypatch.setattr(retention, "is_enforced", lambda: True)
    with pytest.raises(ProductionNotReady, match="enforce_sso set, but SSO is not implemented"):
        assert_production_ready(pg_db, RecordingSecurityAudit(), throttle)
    app = make_app(Settings(env="prod", database_url=TEST_DATABASE_URL), demo_registry(), database=pg_db)
    with pytest.raises(ProductionNotReady, match="enforce_sso"), TestClient(app):
        pass


def test_production_needs_a_security_audit_writer(pg_db, monkeypatch, throttle):
    _no_other_blockers(pg_db, monkeypatch)
    with pytest.raises(ProductionNotReady, match="No security audit writer"):
        assert_production_ready(pg_db, None, throttle)
    with pytest.raises(ProductionNotReady, match="exposes no health"):
        assert_production_ready(pg_db, object(), throttle)  # a writer whose failures can't be observed doesn't count
    assert_production_ready(pg_db, RecordingSecurityAudit(), throttle)  # every control in place: starts


def test_dev_and_test_are_not_blocked(pg_db):
    with TestClient(make_app(Settings(env="test"), demo_registry(), database=pg_db)) as c:
        assert c.get("/healthz").status_code == 200
