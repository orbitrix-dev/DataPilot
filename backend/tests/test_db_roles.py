"""The least-privilege runtime user, verified on real connections as that user (not as an administrator)."""

from collections.abc import Iterator
from contextlib import contextmanager

import pytest
from sqlalchemy import delete, select, text, update
from sqlalchemy.exc import DBAPIError, IntegrityError, ProgrammingError
from sqlalchemy.orm import Session

from app.core import clock
from app.db.base import uuid7
from app.modules.audit.models import AuditEventRecord
from app.modules.identity.models import UserSession
from app.modules.identity.persistence import PostgresSessionRepository
from app.modules.tenants.models import Permission, Role, RolePermission, Tenant, TenantMembership
from app.modules.tenants.persistence import PostgresMembershipRepository

from .factories import SOON, digest, member, role, tenant, user

# The privilege matrix from the approved design, written out independently of migration 0003.
EXPECTED_GRANTS = {
    "alembic_version": {"SELECT"},
    "audit_events": {"SELECT", "INSERT"},
    "permissions": {"SELECT"},
    "role_permissions": {"SELECT", "INSERT", "DELETE"},
    "roles": {"SELECT", "INSERT", "UPDATE"},
    "tenant_memberships": {"SELECT", "INSERT", "UPDATE", "DELETE"},
    "tenant_settings": {"SELECT", "INSERT", "UPDATE"},
    "tenants": {"SELECT", "INSERT", "UPDATE"},
    "user_sessions": {"SELECT", "INSERT", "UPDATE"},
    "users": {"SELECT", "INSERT", "UPDATE"},
    "api_keys": {"SELECT", "INSERT", "UPDATE"},
    "refresh_tokens": {"SELECT", "INSERT", "UPDATE"},
    "invitation_tokens": {"SELECT", "INSERT", "UPDATE"},
}


@contextmanager
def denied(s: Session, match: str, exc: type[Exception] = ProgrammingError) -> Iterator[None]:
    """The block must be refused by PostgreSQL. Runs in a savepoint so the test can continue."""
    with pytest.raises(exc, match=match), s.begin_nested():
        yield
        s.flush()


def audit_row(tenant_id, **kw) -> AuditEventRecord:
    return AuditEventRecord(
        id=uuid7(),
        tenant_id=tenant_id,
        occurred_at=clock.now(),
        action=kw.pop("action", "user.invited"),
        actor_type="system",
        actor_label="DataPilot",
        summary=kw.pop("summary", "Invited someone"),
        **kw,
    )


# ------------------------------------------------------------------ who is connected


def test_the_app_side_of_the_tests_really_connects_as_the_runtime_user(db_session, owner_session):
    assert db_session.execute(text("SELECT current_user")).scalar_one() == "datapilot_app"
    assert owner_session.execute(text("SELECT current_user")).scalar_one() != "datapilot_app"


def test_runtime_user_attributes(db_session):
    row = db_session.execute(
        text(
            "SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls"
            " FROM pg_roles WHERE rolname = current_user"
        )
    ).one()
    assert tuple(row) == (False, False, False, False, False)


# ------------------------------------------------------------------ ownership and DDL


def test_grants_match_the_privilege_matrix_exactly(db_session):
    rows = db_session.execute(
        text(
            "SELECT table_name, privilege_type FROM information_schema.role_table_grants"
            " WHERE grantee = 'datapilot_app' AND table_schema = 'public'"
        )
    ).all()
    actual: dict[str, set[str]] = {}
    for table, privilege in rows:
        actual.setdefault(table, set()).add(privilege)
    assert actual == EXPECTED_GRANTS


def test_runtime_user_owns_no_database_objects(db_session):
    owned = db_session.execute(
        text(
            "SELECT (SELECT count(*) FROM pg_class WHERE relowner = 'datapilot_app'::regrole)"
            " + (SELECT count(*) FROM pg_proc WHERE proowner = 'datapilot_app'::regrole)"
            " + (SELECT count(*) FROM pg_namespace WHERE nspowner = 'datapilot_app'::regrole)"
            " + (SELECT count(*) FROM pg_type WHERE typowner = 'datapilot_app'::regrole)"
        )
    ).scalar_one()
    assert owned == 0


def test_runtime_user_has_no_ddl_rights(db_session):
    assert db_session.execute(text("SELECT has_schema_privilege('public', 'CREATE')")).scalar_one() is False
    with denied(db_session, "permission denied for schema public"):
        db_session.execute(text("CREATE TABLE sneaky (id int)"))
    with denied(db_session, "must be owner"):
        db_session.execute(text("ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only"))
    with denied(db_session, "must be owner"):
        db_session.execute(text("ALTER TABLE tenants ADD COLUMN sneaky int"))
    with denied(db_session, "must be owner"):
        db_session.execute(text("DROP TABLE audit_events"))
    with denied(db_session, "must be owner"):
        db_session.execute(text("DROP FUNCTION audit_events_reject_change()"))


# ------------------------------------------------------------------ audit: append-only


def test_runtime_user_can_insert_and_read_audit_events(db_session):
    t = tenant(db_session, "acme", with_roles=False)
    row = audit_row(t.id)
    db_session.add(row)
    db_session.flush()
    assert db_session.get(AuditEventRecord, row.id).summary == "Invited someone"


def test_runtime_user_cannot_update_delete_or_truncate_audit_events(db_session):
    t = tenant(db_session, "acme", with_roles=False)
    row = audit_row(t.id)
    db_session.add(row)
    db_session.flush()
    with denied(db_session, "permission denied for table audit_events"):
        db_session.execute(update(AuditEventRecord).where(AuditEventRecord.id == row.id).values(summary="tampered"))
    with denied(db_session, "permission denied for table audit_events"):
        db_session.execute(delete(AuditEventRecord).where(AuditEventRecord.id == row.id))
    with denied(db_session, "permission denied for table audit_events"):
        db_session.execute(text("TRUNCATE audit_events"))
    assert db_session.get(AuditEventRecord, row.id).summary == "Invited someone"


def test_the_trigger_blocks_changes_even_for_the_owner(owner_session):
    t = tenant(owner_session, "acme", with_roles=False)
    row = audit_row(t.id)
    owner_session.add(row)
    owner_session.flush()
    with denied(owner_session, "append-only: UPDATE", DBAPIError):
        owner_session.execute(update(AuditEventRecord).where(AuditEventRecord.id == row.id).values(summary="x"))
    with denied(owner_session, "append-only: DELETE", DBAPIError):
        owner_session.execute(delete(AuditEventRecord).where(AuditEventRecord.id == row.id))
    with denied(owner_session, "append-only: TRUNCATE", DBAPIError):
        owner_session.execute(text("TRUNCATE audit_events"))


def test_deleting_a_tenant_never_cascades_into_its_audit_history(owner_session):
    t = tenant(owner_session, "acme", with_roles=False)
    owner_session.add(audit_row(t.id))
    owner_session.flush()
    owner_session.execute(text("DELETE FROM tenant_settings WHERE tenant_id = :t"), {"t": t.id})
    with denied(owner_session, "fk_audit_events_tenant_id_tenants", IntegrityError):
        owner_session.execute(delete(Tenant).where(Tenant.id == t.id))


def test_the_database_rejects_api_key_secrets_even_if_the_app_did_not_redact_them(db_session):
    t = tenant(db_session, "acme", with_roles=False)
    with denied(db_session, "summary_has_no_secret", IntegrityError):
        db_session.add(audit_row(t.id, summary="leaked dp_live_0123456789abcdef0123"))
    with denied(db_session, "metadata_has_no_secret", IntegrityError):
        db_session.add(audit_row(t.id, event_metadata={"name": "dp_live_deadbeefcafe0123"}))


# ------------------------------------------------------------------ the rest of the matrix


def test_runtime_user_cannot_write_the_permission_catalog(db_session):
    with denied(db_session, "permission denied for table permissions"):
        db_session.add(Permission(code="evil:grant", module="evil", description="x"))
    with denied(db_session, "permission denied for table permissions"):
        db_session.execute(update(Permission).values(description="x"))
    with denied(db_session, "permission denied for table permissions"):
        db_session.execute(delete(Permission).where(Permission.code == "audit:read"))


def test_runtime_user_cannot_delete_tenants_users_or_roles_or_change_the_schema_revision(db_session):
    t = tenant(db_session, "acme")
    u = user(db_session, "a@acme.io")
    with denied(db_session, "permission denied for table tenants"):
        db_session.execute(delete(Tenant).where(Tenant.id == t.id))
    with denied(db_session, "permission denied for table users"):
        db_session.execute(text("DELETE FROM users WHERE id = :u"), {"u": u.id})
    with denied(db_session, "permission denied for table roles"):
        db_session.execute(delete(Role).where(Role.tenant_id == t.id))
    assert db_session.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == "0005"
    with denied(db_session, "permission denied for table alembic_version"):
        db_session.execute(text("UPDATE alembic_version SET version_num = 'x'"))


def test_removing_a_member_cascades_to_sessions_without_delete_rights_on_sessions(db_session):
    """Referential actions run with the table owner's rights: the runtime user has no DELETE on user_sessions."""
    assert db_session.execute(text("SELECT has_table_privilege('user_sessions', 'DELETE')")).scalar_one() is False
    t = tenant(db_session, "acme")
    u = user(db_session, "a@acme.io")
    m = member(db_session, t, u)
    s = PostgresSessionRepository(db_session, t.id).create(u.id, digest(), SOON)
    PostgresMembershipRepository(db_session, t.id).remove(m.id)
    assert db_session.scalar(select(UserSession).where(UserSession.id == s.id)) is None


def test_grants_can_reference_the_catalog_without_references_privilege(db_session):
    assert db_session.execute(text("SELECT has_table_privilege('permissions', 'REFERENCES')")).scalar_one() is False
    t = tenant(db_session, "acme")
    viewer = role(db_session, t, "viewer")
    db_session.add(RolePermission(tenant_id=t.id, role_id=viewer.id, permission_code="connect:read"))
    db_session.flush()  # the foreign-key check succeeds as the runtime user


# ------------------------------------------------------------------ UUIDv7 only


@pytest.mark.parametrize(
    ("table", "columns", "values"),
    [
        ("tenants", "slug, name", "'raw-insert', 'Raw'"),
        ("users", "public_id, email, full_name", "'u-raw', 'raw@acme.io', 'Raw'"),
        (
            "audit_events",
            "occurred_at, action, actor_type, actor_label, summary",
            "now(), 'user.invited', 'system', 'x', 'x'",
        ),
    ],
)
def test_an_insert_without_an_id_fails_instead_of_getting_a_uuid4(db_session, table, columns, values):
    with denied(db_session, 'null value in column "id"', IntegrityError):
        db_session.execute(text(f"INSERT INTO {table} ({columns}) VALUES ({values})"))


def test_ids_written_by_the_application_are_uuid7(db_session):
    t = tenant(db_session, "acme")
    u = user(db_session, "a@acme.io")
    m = member(db_session, t, u)
    s = PostgresSessionRepository(db_session, t.id).create(u.id, digest(), SOON)
    for row in (t, u, m, s, role(db_session, t, "owner")):
        assert row.id.version == 7, type(row).__name__
    assert db_session.scalar(select(TenantMembership.id).where(TenantMembership.id == m.id)).version == 7
