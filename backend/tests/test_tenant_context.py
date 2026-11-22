"""Stage 4A.1: the transaction's tenant context (app/core/tenant_scope.py), on real PostgreSQL as the runtime user.

Nothing reads the context yet (row-level security arrives in 4A.4), so these tests pin down the mechanism itself: it is
transaction-local and never leaks across pooled connections, scoped switches restore the caller's tenant, writes are
sent under the context they were made in, and every path binds before it touches tenant-owned rows (the suite-wide
guard in tests/tenant_context_guard.py, itself tested here).
"""

import pytest
from sqlalchemy import event, inspect, text, update
from sqlalchemy.orm import Session

from app.core.db import Database
from app.core.tenant_scope import bind_tenant, clear_tenant, current_tenant, tenant_scope
from app.db.base import uuid7
from app.modules.audit.security_writer import SecurityAuditWriter
from app.modules.auth import service as auth_service
from app.modules.tenants.models import Tenant, TenantSettings

from .conftest import TEST_DATABASE_URL
from .tenant_context_guard import ALLOWED, GUARD, Unbound, is_violation, tenant_tables
from .test_auth_flow import (
    INVALID_SESSION,
    _claims,
    accept,
    bearer,
    browser,
    csrf,
    forge,
    invite,
    login,
    signed_up,
)


@pytest.fixture
def password_only(pg_conn) -> None:
    """The demo tenant requires MFA; these flows are about the tenant context, so turn it off (MFA: test_mfa.py)."""
    with Session(bind=pg_conn, join_transaction_mode="create_savepoint") as s:
        s.execute(update(TenantSettings).values(require_mfa=False))
        s.commit()


def _backend_pid(s: Session) -> int:
    return s.connection().execute(text("SELECT pg_backend_pid()")).scalar_one()


# ====================================================================== the mechanism


def test_a_transaction_starts_unbound_and_binds_switches_and_clears(db_session):
    a, b = uuid7(), uuid7()
    assert current_tenant(db_session) is None
    bind_tenant(db_session, a)
    assert current_tenant(db_session) == a
    bind_tenant(db_session, b)
    assert current_tenant(db_session) == b
    clear_tenant(db_session)
    assert current_tenant(db_session) is None


@pytest.mark.parametrize("value", ["acme", None, "0190c7f2-0000-7000-8000-000000000000"])
def test_only_a_tenant_uuid_can_be_bound(db_session, value):
    """Never a slug, a client-supplied string or None: the context comes from an authenticated lookup."""
    with pytest.raises(TypeError):
        bind_tenant(db_session, value)
    assert current_tenant(db_session) is None


def test_pending_writes_are_sent_before_the_context_changes(db_session):
    """A write is always sent under the context in which it was made, never under the next one."""
    row = Tenant(slug="flush-co", name="Flush Co")
    db_session.add(row)
    bind_tenant(db_session, uuid7())
    assert row not in db_session.new and inspect(row).persistent


def test_the_context_never_outlives_its_transaction_on_a_pooled_connection(migrated):
    """One pooled connection serving one transaction after another: a commit and a rollback both discard the
    context, so the next unit of work (the next request) can't inherit the previous one's tenant."""
    db = Database(TEST_DATABASE_URL, pool_size=1, max_overflow=0)
    try:
        a, b = uuid7(), uuid7()
        with db.session() as s:
            pid = _backend_pid(s)
            bind_tenant(s, a)
            assert current_tenant(s) == a
        with db.session() as s:  # after COMMIT
            assert _backend_pid(s) == pid
            assert current_tenant(s) is None
        with pytest.raises(RuntimeError), db.session() as s:
            bind_tenant(s, b)
            raise RuntimeError("the request failed")
        with db.session() as s:  # after ROLLBACK
            assert _backend_pid(s) == pid
            assert current_tenant(s) is None
    finally:
        db.dispose()


def test_the_test_harness_clears_the_context_between_units_of_work(pg_db):
    """Test requests are savepoints in one outer transaction, and releasing a savepoint would keep the context. The
    harness clears it, so tests can't pass because an earlier request of the same test happened to bind the tenant."""
    with pg_db.session() as s:
        bind_tenant(s, uuid7())
    with pg_db.session() as s:
        assert current_tenant(s) is None


# ====================================================================== scoped switches


def test_a_scope_restores_the_previous_tenant(db_session):
    a, b = uuid7(), uuid7()
    bind_tenant(db_session, a)
    with tenant_scope(db_session, b):
        assert current_tenant(db_session) == b
    assert current_tenant(db_session) == a


def test_a_scope_restores_no_tenant(db_session):
    with tenant_scope(db_session, uuid7()):
        pass
    assert current_tenant(db_session) is None


def test_a_scope_restores_the_previous_tenant_when_its_block_raises(db_session):
    a = uuid7()
    bind_tenant(db_session, a)
    with pytest.raises(ValueError, match="inside"), tenant_scope(db_session, uuid7()):
        raise ValueError("inside")
    assert current_tenant(db_session) == a


def test_a_scope_sends_its_writes_before_restoring(db_session):
    with tenant_scope(db_session, uuid7()):
        row = Tenant(slug="scoped-co", name="Scoped Co")
        db_session.add(row)
    assert row not in db_session.new and inspect(row).persistent


def test_creating_a_tenant_leaves_the_callers_context_unchanged(db_session):
    from app.modules.tenants.persistence import PostgresTenantRepository

    a = uuid7()
    bind_tenant(db_session, a)
    PostgresTenantRepository(db_session).create("newco", "NewCo")
    assert current_tenant(db_session) == a


# ====================================================================== entry points


def test_the_security_writer_writes_a_tenants_event_as_that_tenant(migrated):
    """Seen at the INSERT itself. The tenant doesn't exist, so the foreign key refuses the row and nothing commits."""
    writer = SecurityAuditWriter(TEST_DATABASE_URL)
    seen: list[str] = []

    def probe(conn, cursor, statement, parameters, context, executemany):
        if statement.startswith("INSERT INTO audit_events"):
            with cursor.connection.cursor() as c:
                c.execute("SELECT current_setting('app.tenant_id', true)")
                seen.append(c.fetchone()[0])

    event.listen(writer._engine, "before_cursor_execute", probe)
    try:
        tenant = uuid7()
        recorded = writer.record("api-key.rejected", "Rejected", tenant_id=tenant, metadata={"reason": "invalid_key"})
        assert recorded is False
    finally:
        writer.dispose()
    assert seen == [str(tenant)]


def test_an_access_token_is_resolved_within_the_tenant_it_names(pg_db, pg_conn, password_only):
    """The session is looked up inside the token's tenant; a validly signed token naming an unknown tenant is the
    same 401 as any other invalid token."""
    web = browser(pg_db)
    token = signed_up(web, pg_conn)
    assert web.get("/me", headers=bearer(token)).status_code == 200
    r = web.get("/me", headers=bearer(forge({**_claims(token), "ten": "no-such-tenant"})))
    assert (r.status_code, r.json()) == (401, INVALID_SESSION)


def test_the_sign_in_lifecycle_binds_its_tenant_after_each_lookup(pg_db, pg_conn, password_only):
    """Invitation, sign-in, refresh and sign-out by cookie, end to end. The guard (active for this test) fails it if
    anything else runs unbound, and records which documented lookups ran, proving it saw these requests."""
    web = browser(pg_db)
    assert accept(web, invite(pg_conn, "ctx.analyst@acme.io")).status_code == 204
    token = login(web, "ctx.analyst@acme.io").json()["access_token"]
    assert web.get("/members", headers=bearer(token)).status_code in (200, 403)
    assert web.post("/auth/refresh", headers=csrf(web)).status_code == 200
    assert web.post("/auth/logout", headers=csrf(web)).status_code == 204
    assert {
        "app/modules/auth/service.py:accept_invitation",
        "app/modules/auth/service.py:_active_memberships",
        "app/modules/auth/service.py:refresh",
        "app/modules/auth/service.py:session_for_refresh_token",
    } <= GUARD.allowed_seen
    assert GUARD.violations == []


# ====================================================================== the guard


def test_the_guard_finds_tenant_owned_tables_in_statements():
    assert tenant_tables("SELECT roles.id FROM roles JOIN tenant_memberships ON …") == ("roles", "tenant_memberships")
    assert tenant_tables("INSERT INTO audit_events (id) VALUES (%(id)s)") == ("audit_events",)
    assert tenant_tables("UPDATE user_sessions SET last_seen_at=…") == ("user_sessions",)
    assert tenant_tables("SELECT users.id FROM users JOIN tenants ON …") == ()
    assert tenant_tables("SELECT 1 FROM auth_throttle_buckets") == ()


REPO = "app/modules/tenants/persistence.py"


@pytest.mark.parametrize(
    ("unbound", "params", "violation"),
    [
        pytest.param(Unbound("app/x.py:f", "app/modules/x/router.py:r", "SELECT", ("roles",)), {}, True, id="service"),
        pytest.param(
            Unbound(REPO + ":get", REPO + ":get", "SELECT", ("roles",)),
            {},
            False,
            id="repository tested directly",
        ),
        pytest.param(
            Unbound("app/deps.py:_authenticate_api_key", "app/deps.py:get_ctx", "SELECT", ("api_keys",)),
            {},
            False,
            id="documented lookup",
        ),
        pytest.param(
            Unbound("app/deps.py:_authenticate_api_key", "app/deps.py:get_ctx", "UPDATE", ("api_keys",)),
            {},
            True,
            id="documented lookup may only read",
        ),
        pytest.param(
            Unbound("app/modules/audit/security_writer.py:record", "app/deps.py:get_ctx", "INSERT", ("audit_events",)),
            {"tenant_id": None},
            False,
            id="global security event",
        ),
        pytest.param(
            Unbound("app/modules/audit/security_writer.py:record", "app/deps.py:get_ctx", "INSERT", ("audit_events",)),
            {"tenant_id": uuid7()},
            True,
            id="tenant security event unbound",
        ),
    ],
)
def test_the_guard_classifies_unbound_statements(unbound, params, violation):
    assert is_violation(unbound, params) is violation


def test_every_documented_lookup_says_why_it_is_unbound():
    assert ALLOWED and all(reason.strip() for reason in ALLOWED.values())


@pytest.mark.no_tenant_guard
def test_the_guard_reports_an_unbound_query_from_application_code(db_session):
    """The same function, unbound then bound: only the unbound call is reported."""
    GUARD.reset()
    GUARD.enabled = True
    try:
        auth_service._tenant_requires_mfa(db_session, uuid7())
        bind_tenant(db_session, uuid7())
        auth_service._tenant_requires_mfa(db_session, uuid7())
    finally:
        GUARD.enabled = False
    found = [(v.sender, v.verb, v.tables) for v in GUARD.violations]
    GUARD.reset()
    assert found == [("app/modules/auth/service.py:_tenant_requires_mfa", "SELECT", ("tenant_settings",))]
