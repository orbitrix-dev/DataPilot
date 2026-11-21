"""Migrations 0001-0002: build the core schema from an empty database, reverses cleanly and matches the models."""

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.runtime.migration import MigrationContext
from sqlalchemy import inspect, text

from app.db.models import Base
from app.modules.tenants.permissions import CATALOG

from .conftest import alembic_config

CORE_TABLES = {
    "tenants",
    "users",
    "roles",
    "permissions",
    "role_permissions",
    "tenant_memberships",
    "user_sessions",
    "tenant_settings",
}


def tables(db) -> set[str]:
    return set(inspect(db.engine).get_table_names()) - {"alembic_version"}


def revision(db) -> str | None:
    with db.engine.connect() as conn:
        return MigrationContext.configure(conn).get_current_revision()


def test_upgrade_from_an_empty_database_builds_the_core_schema(migrated):
    # `migrated` ran `downgrade base` then `upgrade head` at the start of the session.
    assert revision(migrated) == "0002"
    assert tables(migrated) == CORE_TABLES


def test_the_migrated_permission_catalog_matches_the_code(migrated):
    with migrated.engine.connect() as conn:
        rows = set(conn.execute(text("SELECT code, module, description FROM permissions")))
    assert rows == {(p.code, p.module, p.description) for p in CATALOG}


def test_downgrade_removes_everything_and_re_upgrade_restores_it(migrated):
    cfg = alembic_config()
    try:
        command.downgrade(cfg, "base")
        assert revision(migrated) is None
        assert tables(migrated) == set()
    finally:
        command.upgrade(cfg, "head")
    assert revision(migrated) == "0002"
    assert tables(migrated) == CORE_TABLES
    with migrated.engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM permissions")).scalar_one() == len(CATALOG)


def test_models_and_migration_have_not_drifted(migrated):
    with migrated.engine.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn, opts={"compare_type": True}), Base.metadata)
    assert diff == []


def test_expected_constraints_and_indexes_exist(migrated):
    insp = inspect(migrated.engine)
    fks = {fk["name"]: fk for t in CORE_TABLES for fk in insp.get_foreign_keys(t)}
    assert fks["fk_tenant_memberships_tenant_id_role_id_roles"]["constrained_columns"] == ["tenant_id", "role_id"]
    assert fks["fk_role_permissions_tenant_id_role_id_roles"]["options"]["ondelete"] == "CASCADE"
    assert fks["fk_user_sessions_tenant_id_user_id_tenant_memberships"]["options"]["ondelete"] == "CASCADE"
    assert fks["fk_tenant_memberships_user_id_users"]["options"]["ondelete"] == "RESTRICT"
    uniques = {u["name"] for t in CORE_TABLES for u in insp.get_unique_constraints(t)}
    assert {
        "uq_tenants_slug",
        "uq_users_email",
        "uq_roles_tenant_id_key",
        "uq_roles_tenant_id_id",
        "uq_tenant_memberships_tenant_id_user_id",
        "uq_user_sessions_token_hash",
    } <= uniques
    indexes = {i["name"] for t in CORE_TABLES for i in insp.get_indexes(t)}
    assert {"ix_tenant_memberships_user_id", "ix_user_sessions_tenant_id_active", "ix_role_permissions_tenant_id"} <= (
        indexes
    )
    session_columns = {c["name"]: c for c in insp.get_columns("user_sessions")}
    assert type(session_columns["ip"]["type"]).__name__ == "INET"
    assert all(session_columns[c]["nullable"] for c in ("device", "ip", "location", "user_agent"))


def test_0002_backfills_existing_0001_data_and_its_downgrade_preserves_it(migrated):
    """Rows created at 0001 (before public ids and settings existed) get the known demo id or a derived one and
    default settings; downgrading 0002 removes only its additions."""
    cfg = alembic_config()
    tenant_id, other_id = "01900000-0000-7000-8000-000000000001", "01900000-0000-7000-8000-0000000000aa"
    try:
        command.downgrade(cfg, "0001")
        with migrated.session() as s:
            s.execute(
                text("INSERT INTO tenants (id, slug, name) VALUES (:id, 'legacy', 'Legacy Co')"), {"id": tenant_id}
            )
            s.execute(
                text(
                    "INSERT INTO users (id, email, full_name) VALUES"
                    " (gen_random_uuid(), 'e.vance@acme.io', 'Elena Vance'), (:other, 'someone@legacy.io', 'Someone')"
                ),
                {"other": other_id},
            )
        command.upgrade(cfg, "head")
        with migrated.session() as s:
            ids = dict(s.execute(text("SELECT email, public_id FROM users")).all())
            assert ids == {"e.vance@acme.io": "u-elena", "someone@legacy.io": "u-" + other_id.replace("-", "")}
            settings = s.execute(text("SELECT * FROM tenant_settings WHERE tenant_id = :t"), {"t": tenant_id}).one()
            assert (settings.industry, settings.timezone, settings.audit_retention_days) == (
                "Wholesale & Distribution",
                "UTC",
                365,
            )
            assert (settings.require_mfa, settings.enforce_sso, settings.session_timeout_hours) == (False, False, 12)
        command.downgrade(cfg, "0001")
        with migrated.session() as s:
            assert s.execute(text("SELECT count(*) FROM users")).scalar_one() == 2
            assert (
                s.execute(text("SELECT name FROM tenants WHERE id = :t"), {"t": tenant_id}).scalar_one() == "Legacy Co"
            )
    finally:
        with migrated.session() as s:
            if s.execute(text("SELECT to_regclass('tenant_settings')")).scalar_one() is not None:
                s.execute(text("DELETE FROM tenant_settings"))
            s.execute(text("DELETE FROM users"))
            s.execute(text("DELETE FROM tenants"))
        command.upgrade(cfg, "head")
    assert revision(migrated) == "0002"
