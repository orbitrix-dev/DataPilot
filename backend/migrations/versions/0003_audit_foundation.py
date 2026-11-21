"""Audit foundation: the append-only audit_events table, the least-privilege runtime user's grants, and UUIDv7-only ids.

1. Runtime user checks. The runtime user (the user in DP_DATABASE_URL, e.g. datapilot_app) must exist, must not be
   the user running this migration (the owner), and must own no objects. Single-user setups are refused.
2. audit_events: append-only by trigger (UPDATE/DELETE/TRUNCATE rejected for every user, the owner included) and by
   privilege (the runtime user gets only SELECT and INSERT). Ids are UUIDv7 from the application (no default).
3. UUIDv7 everywhere: drops the gen_random_uuid() (UUIDv4) defaults that 0001 put on tenants, users, roles,
   tenant_memberships and user_sessions, so an insert without an explicit id fails instead of silently getting v4.
4. Grants the runtime user exactly the table privileges the application uses (PRIVILEGES below). Nothing is granted
   by default: a future table gets no access until its migration grants it.

Downgrade revokes the grants, restores the 0001 defaults and DROPS audit_events WITH ITS HISTORY: development and
CI only; in production, fix forward.

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import context, op
from sqlalchemy.dialects import postgresql

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The runtime user's table privileges: exactly what the application's operations need (see docs/DATABASE.md).
PRIVILEGES = {
    "tenants": "SELECT, INSERT, UPDATE",  # tenants are soft-deleted
    "tenant_settings": "SELECT, INSERT, UPDATE",
    "users": "SELECT, INSERT, UPDATE",  # no code path deletes a user
    "tenant_memberships": "SELECT, INSERT, UPDATE, DELETE",  # revoking a member deletes the membership
    "roles": "SELECT, INSERT, UPDATE",
    "role_permissions": "SELECT, INSERT, DELETE",  # matrix edits delete removed grants
    "permissions": "SELECT",  # the catalog is managed by migrations only
    "user_sessions": "SELECT, INSERT, UPDATE",  # revocation sets revoked_at; deletes only cascade from memberships
    "audit_events": "SELECT, INSERT",  # append-only
    "alembic_version": "SELECT",  # schema-revision reporting
}
UUID_DEFAULT_TABLES = ("tenants", "users", "roles", "tenant_memberships", "user_sessions")
TABLE_COMMENT = (
    "Append-only audit log. UPDATE/DELETE/TRUNCATE are rejected by trigger; the runtime user may only SELECT and "
    "INSERT. Retention purging is not implemented yet."
)


def _app_role() -> str:
    role = context.config.attributes.get("app_role")  # validated against ^[a-z_][a-z0-9_]{0,62}$ in env.py
    if role is None:
        raise RuntimeError(
            "Migration 0003 needs a separate runtime user: DP_DATABASE_URL and DP_MIGRATION_DATABASE_URL must use "
            "different users (the runtime user must not own tables). See backend/README.md."
        )
    return role


def _check_app_role(role: str) -> None:
    op.execute(
        f"""
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '{role}') THEN
                RAISE EXCEPTION 'Runtime user "{role}" does not exist. Create it first '
                    '(dev: docker/postgres/initdb/02-create-app-role.sh)';
            END IF;
            IF '{role}' = current_user THEN
                RAISE EXCEPTION 'Runtime user "{role}" is the user running migrations; use a separate owner';
            END IF;
            IF EXISTS (SELECT FROM pg_class WHERE relowner = '{role}'::regrole)
               OR EXISTS (SELECT FROM pg_proc WHERE proowner = '{role}'::regrole)
               OR EXISTS (SELECT FROM pg_namespace WHERE nspowner = '{role}'::regrole) THEN
                RAISE EXCEPTION 'Runtime user "{role}" owns database objects; it must own none';
            END IF;
        END $$
        """
    )


def upgrade() -> None:
    role = _app_role()
    _check_app_role(role)

    # ---- audit_events
    op.create_table(
        "audit_events",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("tenant_id", sa.UUID(), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column(
            "category", sa.String(length=20), sa.Computed("split_part(action, '.', 1)", persisted=True), nullable=False
        ),
        sa.Column("actor_type", sa.String(length=10), nullable=False),
        sa.Column("actor_id", sa.String(length=128), nullable=True),
        sa.Column("actor_label", sa.String(length=160), nullable=False),
        sa.Column("resource_type", sa.String(length=40), nullable=True),
        sa.Column("resource_id", sa.String(length=128), nullable=True),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("ip_address", postgresql.INET(), nullable=True),
        sa.Column("client_label", sa.String(length=64), nullable=True),
        sa.Column(
            "metadata", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False
        ),
        sa.CheckConstraint("action ~ '^[a-z-]+\\.[a-z_]+$'", name=op.f("ck_audit_events_action_format")),
        sa.CheckConstraint(
            "actor_type IN ('system', 'anonymous') OR actor_id IS NOT NULL",
            name=op.f("ck_audit_events_actor_id_present"),
        ),
        sa.CheckConstraint(
            "actor_type IN ('user', 'api_key', 'system', 'anonymous')", name=op.f("ck_audit_events_actor_type_valid")
        ),
        sa.CheckConstraint(
            "category IN ('login', 'permission', 'user', 'api-key', 'connection', 'workflow', 'settings', 'billing')",
            name=op.f("ck_audit_events_category_valid"),
        ),
        sa.CheckConstraint("jsonb_typeof(metadata) = 'object'", name=op.f("ck_audit_events_metadata_is_object")),
        sa.CheckConstraint(
            "metadata::text !~ 'dp_live_[0-9a-fA-F]{8,}'", name=op.f("ck_audit_events_metadata_has_no_secret")
        ),
        sa.CheckConstraint("summary !~ 'dp_live_[0-9a-fA-F]{8,}'", name=op.f("ck_audit_events_summary_has_no_secret")),
        sa.CheckConstraint(
            "NOT (ip_address IS NOT NULL AND client_label IS NOT NULL)",
            name=op.f("ck_audit_events_one_client_identifier"),
        ),
        sa.CheckConstraint("octet_length(metadata::text) <= 8192", name=op.f("ck_audit_events_metadata_size")),
        sa.CheckConstraint(
            "resource_id IS NULL OR resource_type IS NOT NULL", name=op.f("ck_audit_events_resource_type_present")
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id"], ["tenants.id"], name=op.f("fk_audit_events_tenant_id_tenants"), ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_audit_events")),
        comment=TABLE_COMMENT,
    )
    op.create_index(
        "ix_audit_events_tenant_id_occurred_at",
        "audit_events",
        ["tenant_id", sa.literal_column("occurred_at DESC"), "id"],
        unique=False,
    )
    op.create_index(
        "ix_audit_events_tenant_id_category_occurred_at",
        "audit_events",
        ["tenant_id", "category", sa.literal_column("occurred_at DESC"), "id"],
        unique=False,
    )
    op.create_index(
        "ix_audit_events_global_occurred_at",
        "audit_events",
        [sa.literal_column("occurred_at DESC")],
        unique=False,
        postgresql_where=sa.text("tenant_id IS NULL"),
    )

    # ---- append-only for every user (the owner included)
    op.execute(
        """
        CREATE FUNCTION audit_events_reject_change() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'audit_events is append-only: % is not allowed', TG_OP
                USING ERRCODE = 'insufficient_privilege';
        END
        $$
        """
    )
    op.execute(
        "CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events"
        " FOR EACH ROW EXECUTE FUNCTION audit_events_reject_change()"
    )
    op.execute(
        "CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events"
        " FOR EACH STATEMENT EXECUTE FUNCTION audit_events_reject_change()"
    )

    # ---- UUIDv7 only: no silent UUIDv4 default on the 0001 tables
    for table in UUID_DEFAULT_TABLES:
        op.alter_column(table, "id", server_default=None)

    # ---- the runtime user's privileges
    op.execute(f'GRANT USAGE ON SCHEMA public TO "{role}"')
    for table, privileges in PRIVILEGES.items():
        op.execute(f'GRANT {privileges} ON {table} TO "{role}"')


def downgrade() -> None:
    role = _app_role()
    for table in PRIVILEGES:
        op.execute(f'REVOKE ALL ON {table} FROM "{role}"')
    op.execute(f'REVOKE USAGE ON SCHEMA public FROM "{role}"')
    for table in UUID_DEFAULT_TABLES:  # back to exactly what 0001 created
        op.alter_column(table, "id", server_default=sa.text("gen_random_uuid()"))
    op.execute("DROP TRIGGER audit_events_no_truncate ON audit_events")
    op.execute("DROP TRIGGER audit_events_append_only ON audit_events")
    op.execute("DROP FUNCTION audit_events_reject_change()")
    op.drop_index("ix_audit_events_global_occurred_at", table_name="audit_events")
    op.drop_index("ix_audit_events_tenant_id_category_occurred_at", table_name="audit_events")
    op.drop_index("ix_audit_events_tenant_id_occurred_at", table_name="audit_events")
    op.drop_table("audit_events")
