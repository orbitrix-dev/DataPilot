"""Security hardening: exact runtime privileges, no PUBLIC access, and wider credential CHECKs on audit text.

Findings this corrects (Stage 3A.1 review):
- PUBLIC keeps PostgreSQL's default CONNECT and TEMPORARY on the database, so the runtime user (like any role) could
  create TEMPORARY tables; PUBLIC also had USAGE on schema public and EXECUTE on audit_events_reject_change().
- 0003 only ever GRANTed: on an existing database, privileges granted earlier (to the runtime user or PUBLIC) survived,
  and role memberships (e.g. pg_write_all_data) were never checked.
- The audit CHECKs covered only DataPilot API-key secrets, and only in summary and metadata.

Upgrade (idempotent: safe to run against a database in any 0003 state):
1. Refuse if the runtime user is unsafe in ways a schema owner can't fix: SUPERUSER/CREATEROLE/CREATEDB/REPLICATION/
   BYPASSRLS, or any role membership. Fix those with your role administration, then rerun.
2. Reset the runtime user's table privileges to exactly PRIVILEGES (revoke everything, then grant), and revoke all
   table, sequence and function privileges from PUBLIC in schema public. Future functions created by the migration
   user no longer grant EXECUTE to PUBLIC by default.
3. Schema public: no privileges for PUBLIC; explicit USAGE for the runtime user.
4. Database: explicit CONNECT for the runtime user; no CONNECT/TEMPORARY for PUBLIC. Requires the migration user to
   own the database (or be a superuser); other roles that relied on PUBLIC CONNECT need an explicit grant.
5. Replace the audit secret CHECKs with ones covering more formats and more columns. Each is added NOT VALID (enforced
   for every new row at once) and then VALIDATEd against existing rows. If an existing row already matches, it can't
   be fixed (audit rows are append-only), so that constraint stays NOT VALID, still enforced for new rows, and a
   WARNING names it for investigation; the upgrade does not fail.

Downgrade restores PostgreSQL's defaults for PUBLIC and 0003's two CHECKs. The runtime user keeps 0003's matrix.

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-22
"""

from collections.abc import Sequence

from alembic import context, op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Frozen copy of the approved matrix at this revision (migrations never import app code).
PRIVILEGES = {
    "tenants": "SELECT, INSERT, UPDATE",
    "tenant_settings": "SELECT, INSERT, UPDATE",
    "users": "SELECT, INSERT, UPDATE",
    "tenant_memberships": "SELECT, INSERT, UPDATE, DELETE",
    "roles": "SELECT, INSERT, UPDATE",
    "role_permissions": "SELECT, INSERT, DELETE",
    "permissions": "SELECT",
    "user_sessions": "SELECT, INSERT, UPDATE",
    "audit_events": "SELECT, INSERT",
    "alembic_version": "SELECT",
}

SECRET_IN_TEXT = (
    "dp_live_[0-9a-fA-F]{8,}"
    "|-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----"
    "|(AKIA|ASIA)[A-Z0-9]{16}"
    "|eyJ[A-Za-z0-9_-]{5,}\\.[A-Za-z0-9_-]{5,}\\.[A-Za-z0-9_-]{5,}"
    "|://[^[:space:]:/@]+:(?!\\[REDACTED\\])[^[:space:]@/]+@"
)
SECRET_CHECKED_COLUMNS = ("summary", "resource_id", "actor_label", "client_label", "metadata::text")
OLD_SECRET_IN_TEXT = "dp_live_[0-9a-fA-F]{8,}"
OLD_SECRET_CHECKED_COLUMNS = ("summary", "metadata::text")


def _app_role() -> str:
    role = context.config.attributes.get("app_role")  # validated against ^[a-z_][a-z0-9_]{0,62}$ in env.py
    if role is None:
        raise RuntimeError("Migration 0004 needs the separate runtime user configured in DP_DATABASE_URL")
    return role


def _constraint_name(column: str) -> str:
    return f"ck_audit_events_{column.split('::')[0]}_has_no_secret"


def upgrade() -> None:
    role = _app_role()

    # ---- 1. refuse what a schema owner can't (and shouldn't silently) fix
    op.execute(
        f"""
        DO $$
        DECLARE
            unsafe text;
        BEGIN
            SELECT string_agg(attr, ', ') INTO unsafe FROM (
                SELECT 'SUPERUSER' AS attr FROM pg_roles WHERE rolname = '{role}' AND rolsuper
                UNION ALL SELECT 'CREATEROLE' FROM pg_roles WHERE rolname = '{role}' AND rolcreaterole
                UNION ALL SELECT 'CREATEDB' FROM pg_roles WHERE rolname = '{role}' AND rolcreatedb
                UNION ALL SELECT 'REPLICATION' FROM pg_roles WHERE rolname = '{role}' AND rolreplication
                UNION ALL SELECT 'BYPASSRLS' FROM pg_roles WHERE rolname = '{role}' AND rolbypassrls
                UNION ALL SELECT 'member of ' || g.rolname FROM pg_auth_members m
                    JOIN pg_roles g ON g.oid = m.roleid JOIN pg_roles u ON u.oid = m.member
                    WHERE u.rolname = '{role}'
            ) problems;
            IF unsafe IS NOT NULL THEN
                RAISE EXCEPTION 'Runtime user "{role}" is not least-privilege (%). Fix the role, then rerun.', unsafe;
            END IF;
        END $$
        """
    )

    # ---- 2. exact table privileges; nothing for PUBLIC
    op.execute(f'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM "{role}"')
    op.execute(f'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM "{role}"')
    op.execute(f'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM "{role}"')
    for table, privileges in PRIVILEGES.items():
        op.execute(f'GRANT {privileges} ON {table} TO "{role}"')
    op.execute("REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC")
    op.execute("REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC")
    op.execute("REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC")
    # Global (not per-schema) default: per-schema defaults can't take away globally granted privileges.
    op.execute("ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC")

    # ---- 3. schema public
    op.execute("REVOKE ALL ON SCHEMA public FROM PUBLIC")
    op.execute(f'GRANT USAGE ON SCHEMA public TO "{role}"')

    # ---- 4. database: explicit CONNECT for the runtime user, nothing for PUBLIC
    op.execute(
        f"""
        DO $$
        BEGIN
            IF NOT (pg_has_role(current_user, (SELECT datdba FROM pg_database WHERE datname = current_database()),
                                'MEMBER')
                    OR (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)) THEN
                RAISE EXCEPTION 'Migration 0004 must run as the owner of database % (or a superuser)',
                    current_database();
            END IF;
            EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), '{role}');
            EXECUTE format('REVOKE CONNECT, TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
        END $$
        """
    )

    # ---- 5. wider credential CHECKs on audit text
    for column in OLD_SECRET_CHECKED_COLUMNS:
        op.execute(f"ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS {_constraint_name(column)}")
    for column in SECRET_CHECKED_COLUMNS:
        op.execute(f"ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS {_constraint_name(column)}")
        name = _constraint_name(column)
        op.execute(f"ALTER TABLE audit_events ADD CONSTRAINT {name} CHECK ({column} !~ '{SECRET_IN_TEXT}') NOT VALID")
        op.execute(
            f"""
            DO $$
            BEGIN
                ALTER TABLE audit_events VALIDATE CONSTRAINT {name};
            EXCEPTION WHEN check_violation THEN
                RAISE WARNING 'Existing audit rows match the credential check {name}: it stays NOT VALID (enforced for '
                    'new rows only). Investigate those rows; they cannot be modified.';
            END $$
            """
        )


def downgrade() -> None:
    role = _app_role()
    for column in SECRET_CHECKED_COLUMNS:
        op.execute(f"ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS {_constraint_name(column)}")
    for column in OLD_SECRET_CHECKED_COLUMNS:
        name = _constraint_name(column)
        op.execute(f"ALTER TABLE audit_events ADD CONSTRAINT {name} CHECK ({column} !~ '{OLD_SECRET_IN_TEXT}')")
    # PostgreSQL's defaults for PUBLIC, as they were before this revision.
    op.execute(
        "DO $$ BEGIN EXECUTE format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO PUBLIC', current_database()); END $$"
    )
    op.execute("GRANT USAGE ON SCHEMA public TO PUBLIC")
    op.execute("ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO PUBLIC")
    op.execute("GRANT EXECUTE ON FUNCTION audit_events_reject_change() TO PUBLIC")
    # The runtime user keeps 0003's matrix (identical to PRIVILEGES) and its explicit CONNECT/USAGE.
    op.execute(f'GRANT USAGE ON SCHEMA public TO "{role}"')
