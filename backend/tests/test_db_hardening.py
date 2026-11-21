"""Stage 3A.1 hardening: the runtime user's EFFECTIVE privileges (including PUBLIC, memberships, column grants and
defaults), the privilege inspector's ability to detect regressions, and migration 0004 on fresh and existing databases.

Every "as the runtime user" check uses a real datapilot_app connection.
"""

from collections.abc import Iterator
from contextlib import contextmanager

import pytest
from alembic import command
from sqlalchemy import text
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.orm import Session

from app.cli import main
from app.core.config import Settings
from app.db.privileges import RUNTIME_TABLE_PRIVILEGES, TABLE_PRIVILEGE_TYPES, public_problems, runtime_role_problems

from .conftest import alembic_config

ROLE = "datapilot_app"
# Independent of app/db/privileges.py: the approved matrix as written in the design review.
APPROVED = {
    "tenants": {"SELECT", "INSERT", "UPDATE"},
    "tenant_settings": {"SELECT", "INSERT", "UPDATE"},
    "users": {"SELECT", "INSERT", "UPDATE"},
    "tenant_memberships": {"SELECT", "INSERT", "UPDATE", "DELETE"},
    "roles": {"SELECT", "INSERT", "UPDATE"},
    "role_permissions": {"SELECT", "INSERT", "DELETE"},
    "permissions": {"SELECT"},
    "user_sessions": {"SELECT", "INSERT", "UPDATE"},
    "audit_events": {"SELECT", "INSERT"},
    "alembic_version": {"SELECT"},
    "api_keys": {"SELECT", "INSERT", "UPDATE"},
    "refresh_tokens": {"SELECT", "INSERT", "UPDATE"},
    "invitation_tokens": {"SELECT", "INSERT", "UPDATE"},
}


@contextmanager
def denied(s: Session, match: str) -> Iterator[None]:
    with pytest.raises(ProgrammingError, match=match), s.begin_nested():
        yield


# ====================================================================== effective privileges, as the runtime user


def test_the_inspector_finds_nothing_wrong_on_a_migrated_database(db_session):
    assert db_session.execute(text("SELECT current_user")).scalar_one() == ROLE
    assert runtime_role_problems(db_session.connection(), ROLE) == []


def test_inspector_matrix_is_the_approved_matrix():
    assert {t: set(p) for t, p in RUNTIME_TABLE_PRIVILEGES.items()} == APPROVED


def test_effective_table_privileges_equal_the_matrix_for_every_table_and_privilege(db_session):
    tables = db_session.execute(
        text("SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'")
    ).scalars()
    for table in tables:
        for privilege in TABLE_PRIVILEGE_TYPES:
            has = db_session.execute(
                text("SELECT has_table_privilege(current_user, :t, :p)"), {"t": f"public.{table}", "p": privilege}
            ).scalar_one()
            assert has == (privilege in APPROVED.get(table, set())), (table, privilege)


def test_runtime_user_cannot_create_temporary_tables_schemas_or_tables(db_session):
    database = db_session.execute(
        text(
            "SELECT has_database_privilege(current_database(), 'TEMPORARY'),"
            " has_database_privilege(current_database(), 'CREATE'),"
            " has_database_privilege(current_database(), 'CONNECT')"
        )
    ).one()
    assert tuple(database) == (False, False, True)
    with denied(db_session, "permission denied to create temporary tables"):
        db_session.execute(text("CREATE TEMP TABLE sneaky (id int)"))
    with denied(db_session, "permission denied for database"):
        db_session.execute(text("CREATE SCHEMA sneaky"))
    with denied(db_session, "permission denied for schema public"):
        db_session.execute(text("CREATE TABLE sneaky (id int)"))
    with denied(db_session, "must be owner"):
        db_session.execute(text("ALTER TABLE audit_events ADD COLUMN sneaky int"))
    with denied(db_session, "must be owner"):
        db_session.execute(text("DROP TABLE tenants"))


def test_runtime_user_cannot_execute_functions_or_assume_other_roles(db_session):
    assert (
        db_session.execute(
            text("SELECT has_function_privilege('audit_events_reject_change()', 'EXECUTE')")
        ).scalar_one()
        is False
    )
    owner = db_session.execute(text("SELECT tableowner FROM pg_tables WHERE tablename = 'audit_events'")).scalar_one()
    with denied(db_session, "permission denied to set role"):
        db_session.execute(text(f'SET ROLE "{owner}"'))


def test_runtime_user_has_no_role_memberships_direct_or_inherited(db_session):
    direct = db_session.execute(
        text("SELECT count(*) FROM pg_auth_members WHERE member = 'datapilot_app'::regrole")
    ).scalar_one()
    inherited = db_session.execute(
        text("SELECT count(*) FROM pg_roles WHERE rolname <> current_user AND pg_has_role(current_user, oid, 'MEMBER')")
    ).scalar_one()
    assert (direct, inherited) == (0, 0)


def test_public_has_no_privileges_in_the_application_database(db_session):
    assert public_problems(db_session.connection()) == []
    database_acl = db_session.execute(
        text(
            "SELECT count(*) FROM pg_database d, aclexplode(coalesce(d.datacl, acldefault('d', d.datdba))) a"
            " WHERE d.datname = current_database() AND a.grantee = 0"
        )
    ).scalar_one()
    assert database_acl == 0


# ====================================================================== the inspector detects regressions


@pytest.mark.parametrize(
    ("change", "expected"),
    [
        (f"GRANT pg_read_all_data TO {ROLE}", ["role is a member of 'pg_read_all_data'"]),
        (f"ALTER ROLE {ROLE} CREATEDB", ["role has CREATEDB"]),
        (
            "GRANT UPDATE ON audit_events TO PUBLIC",
            ["audit_events: UPDATE is granted", "PUBLIC has UPDATE on audit_events"],
        ),
        (f"GRANT UPDATE (summary) ON audit_events TO {ROLE}", ["audit_events: column-level UPDATE is granted"]),
        (f"GRANT TRUNCATE ON audit_events TO {ROLE}", ["audit_events: TRUNCATE is granted"]),
        (
            "DO $$ BEGIN EXECUTE format('GRANT TEMPORARY ON DATABASE %I TO PUBLIC', current_database()); END $$",
            ["role can create TEMPORARY tables", "PUBLIC has TEMPORARY on the database"],
        ),
        (
            "GRANT CREATE ON SCHEMA public TO PUBLIC",
            ["role can CREATE in schema 'public'", "PUBLIC has CREATE on schema public"],
        ),
        (
            "GRANT EXECUTE ON FUNCTION audit_events_reject_change() TO PUBLIC",
            [
                "function audit_events_reject_change: EXECUTE is granted",
                "PUBLIC has EXECUTE on function audit_events_reject_change",
            ],
        ),
        ("CREATE TABLE unlisted (id int); GRANT SELECT ON unlisted TO datapilot_app", ["unlisted: SELECT is granted"]),
    ],
    ids=[
        "membership",
        "createdb",
        "public-update",
        "column-grant",
        "truncate",
        "temp",
        "schema-create",
        "execute",
        "new-table",
    ],
)
def test_inspector_detects_unsafe_privileges(owner_session, change, expected):
    """Each regression is introduced inside the owner's transaction (rolled back afterwards) and must be reported."""
    owner_session.execute(text(change))
    problems = runtime_role_problems(owner_session.connection(), ROLE)
    for message in expected:
        assert message in problems, (message, problems)


# ====================================================================== migration 0004


def test_0003_alone_left_public_and_temp_access_and_0004_fixes_an_existing_database(migrated, owner_database):
    """An existing Stage 3A.1 database (at 0003), including a stray grant made by hand, is fully corrected by 0004,
    and its data is preserved."""
    cfg = alembic_config()
    try:
        command.downgrade(cfg, "0003")
        with owner_database.session() as s:
            s.execute(text(f"GRANT UPDATE ON audit_events TO {ROLE}"))  # stray privilege from manual maintenance
            s.execute(text("GRANT SELECT ON users TO PUBLIC"))
            s.execute(text("CREATE TABLE IF NOT EXISTS data_probe (id int)"))
            s.execute(text("INSERT INTO data_probe VALUES (1), (2)"))
        with owner_database.engine.connect() as conn:
            before = runtime_role_problems(conn, ROLE)
        assert "role can create TEMPORARY tables" in before
        assert "audit_events: UPDATE is granted" in before and "PUBLIC has SELECT on users" in before
        command.upgrade(cfg, "head")
        with owner_database.engine.connect() as conn:
            after = runtime_role_problems(conn, ROLE)
            assert conn.execute(text("SELECT count(*) FROM data_probe")).scalar_one() == 2
        assert after == []  # data_probe isn't granted to anyone, so it isn't a problem either
    finally:
        with owner_database.session() as s:
            s.execute(text("DROP TABLE IF EXISTS data_probe"))
        command.upgrade(cfg, "head")


def test_0004_refuses_a_runtime_user_with_role_memberships(migrated, owner_database):
    cfg = alembic_config()
    try:
        command.downgrade(cfg, "0003")
        with owner_database.session() as s:
            s.execute(text(f"GRANT pg_write_all_data TO {ROLE}"))
        with pytest.raises(Exception, match="is not least-privilege .member of pg_write_all_data"):
            command.upgrade(cfg, "head")
    finally:
        with owner_database.session() as s:
            s.execute(text(f"REVOKE pg_write_all_data FROM {ROLE}"))
        command.upgrade(cfg, "head")
    with owner_database.engine.connect() as conn:
        assert runtime_role_problems(conn, ROLE) == []


def test_downgrading_0004_restores_postgresql_defaults_and_the_original_checks(migrated, owner_database):
    cfg = alembic_config()
    try:
        command.downgrade(cfg, "0003")
        with owner_database.engine.connect() as conn:
            problems = runtime_role_problems(conn, ROLE)
            checks = set(
                conn.execute(text("SELECT conname FROM pg_constraint WHERE conname LIKE '%has_no_secret'")).scalars()
            )
        assert "PUBLIC has TEMPORARY on the database" in problems and "PUBLIC has CONNECT on the database" in problems
        assert checks == {"ck_audit_events_summary_has_no_secret", "ck_audit_events_metadata_has_no_secret"}
    finally:
        command.upgrade(cfg, "head")
    with owner_database.engine.connect() as conn:
        assert runtime_role_problems(conn, ROLE) == []
        validated = conn.execute(
            text("SELECT bool_and(convalidated), count(*) FROM pg_constraint WHERE conname LIKE '%has_no_secret'")
        ).one()
    assert tuple(validated) == (True, 5)


def test_cli_check_reports_compliance(migrated, capsys):
    assert main(["check-db-privileges"], Settings(env="test")) == 0
    assert "match the least-privilege matrix" in capsys.readouterr().out
