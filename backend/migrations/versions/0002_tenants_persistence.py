"""Tenants persistence: readable public ids, MFA state, member activity, deletion schedule and tenant settings.

Additive and data-preserving. Order matters for existing rows (e.g. a database seeded at 0001):
1. add the new columns as NULLable;
2. backfill:
   - users.public_id: the known demo ids by email (frozen map below, e.g. e.vance@acme.io → u-elena), then
     "u-" + the user's UUID hex (32 chars, so unique because the UUID is) for everyone else;
   - user_sessions.public_id: "sess-" + the session's UUID hex;
   - tenant_settings: one row per existing tenant with DEFAULT_SETTINGS (values valid for the API);
3. only then enforce NOT NULL, uniqueness and the format CHECKs.
Activity, MFA and deletion-schedule columns stay NULLable. The demo seed later writes the real demo values.

Downgrade removes exactly what this revision adds; all 0001 data is preserved.

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-21 17:24:52.911617+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

PUBLIC_ID_CHECK = "public_id ~ '^[a-z0-9][a-z0-9_-]{1,39}$'"

# Frozen at this revision (migrations never import app code): the readable member ids of the demo users, as the
# API has always returned them. Users seeded at 0001 get these back instead of derived ids.
DEMO_PUBLIC_IDS = [
    ("m.chen@acme.io", "u-marcus"),
    ("e.vance@acme.io", "u-elena"),
    ("j.blake@acme.io", "u-jordan"),
    ("d.park@acme.io", "u-david"),
    ("p.raman@acme.io", "u-priya"),
    ("a.okafor@acme.io", "u-aisha"),
    ("l.fischer@acme.io", "u-lena"),
    ("r.menon@acme.io", "u-ravi"),
    ("g.liu@acme.io", "u-grace"),
    ("o.brooks@acme.io", "u-owen"),
    ("n.wilson@acme.io", "u-nora"),
    ("s.gupta@acme.io", "u-samir"),
]

# Settings backfilled for tenants that existed before this revision. Must match
# app.modules.tenants.persistence.DEFAULT_SETTINGS (a test checks it) and pass the API's validation.
DEFAULT_SETTINGS = {
    "industry": "Wholesale & Distribution",
    "timezone": "UTC",
    "audit_retention_days": 365,
    "require_mfa": False,
    "enforce_sso": False,
    "session_timeout_hours": 12,
}


def upgrade() -> None:
    # ---- tenant_settings (one row per tenant)
    op.create_table(
        "tenant_settings",
        sa.Column("tenant_id", sa.UUID(), nullable=False),
        sa.Column("industry", sa.String(length=80), nullable=False),
        sa.Column("timezone", sa.String(length=64), server_default="UTC", nullable=False),
        sa.Column("audit_retention_days", sa.Integer(), server_default="365", nullable=False),
        sa.Column("require_mfa", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("enforce_sso", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("session_timeout_hours", sa.Integer(), server_default="12", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint(
            "audit_retention_days IN (90, 365)", name=op.f("ck_tenant_settings_audit_retention_days_valid")
        ),
        sa.CheckConstraint("length(btrim(industry)) > 0", name=op.f("ck_tenant_settings_industry_not_blank")),
        sa.CheckConstraint("length(btrim(timezone)) > 0", name=op.f("ck_tenant_settings_timezone_not_blank")),
        sa.CheckConstraint(
            "session_timeout_hours IN (1, 8, 12, 24)", name=op.f("ck_tenant_settings_session_timeout_hours_valid")
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id"], ["tenants.id"], name=op.f("fk_tenant_settings_tenant_id_tenants"), ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("tenant_id", name=op.f("pk_tenant_settings")),
    )
    op.execute(
        sa.text(
            "INSERT INTO tenant_settings (tenant_id, industry, timezone, audit_retention_days, require_mfa,"
            " enforce_sso, session_timeout_hours)"
            " SELECT id, :industry, :timezone, :audit_retention_days, :require_mfa, :enforce_sso,"
            " :session_timeout_hours FROM tenants"
        ).bindparams(**DEFAULT_SETTINGS)
    )

    # ---- nullable additions
    op.add_column("tenants", sa.Column("deletion_scheduled_for", sa.DateTime(timezone=True), nullable=True))
    op.add_column("tenant_memberships", sa.Column("last_active_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("tenant_memberships", sa.Column("last_active_ip", postgresql.INET(), nullable=True))
    op.add_column("users", sa.Column("mfa_enrolled_at", sa.DateTime(timezone=True), nullable=True))

    # ---- users.public_id: add, backfill, then enforce
    op.add_column("users", sa.Column("public_id", sa.String(length=40), nullable=True))
    op.execute(_update_demo_ids_sql())
    op.execute("UPDATE users SET public_id = 'u-' || replace(id::text, '-', '') WHERE public_id IS NULL")
    op.alter_column("users", "public_id", nullable=False)
    op.create_unique_constraint(op.f("uq_users_public_id"), "users", ["public_id"])
    op.create_check_constraint(op.f("ck_users_public_id_format"), "users", PUBLIC_ID_CHECK)

    # ---- user_sessions.public_id: add, backfill, then enforce
    op.add_column("user_sessions", sa.Column("public_id", sa.String(length=40), nullable=True))
    op.execute("UPDATE user_sessions SET public_id = 'sess-' || replace(id::text, '-', '') WHERE public_id IS NULL")
    op.alter_column("user_sessions", "public_id", nullable=False)
    op.create_unique_constraint(op.f("uq_user_sessions_public_id"), "user_sessions", ["public_id"])
    op.create_check_constraint(op.f("ck_user_sessions_public_id_format"), "user_sessions", PUBLIC_ID_CHECK)


def _update_demo_ids_sql() -> sa.TextClause:
    rows = ", ".join(f"(:e{i}, :p{i})" for i in range(len(DEMO_PUBLIC_IDS)))
    params = {}
    for i, (email, public_id) in enumerate(DEMO_PUBLIC_IDS):
        params[f"e{i}"], params[f"p{i}"] = email, public_id
    return sa.text(
        f"UPDATE users SET public_id = demo.public_id FROM (VALUES {rows}) AS demo (email, public_id)"
        " WHERE users.email = demo.email"
    ).bindparams(**params)


def downgrade() -> None:
    """Removes exactly what upgrade() added. Rows from 0001 (tenants, users, memberships, …) are untouched."""
    op.drop_constraint(op.f("ck_user_sessions_public_id_format"), "user_sessions", type_="check")
    op.drop_constraint(op.f("uq_user_sessions_public_id"), "user_sessions", type_="unique")
    op.drop_column("user_sessions", "public_id")
    op.drop_constraint(op.f("ck_users_public_id_format"), "users", type_="check")
    op.drop_constraint(op.f("uq_users_public_id"), "users", type_="unique")
    op.drop_column("users", "public_id")
    op.drop_column("users", "mfa_enrolled_at")
    op.drop_column("tenant_memberships", "last_active_ip")
    op.drop_column("tenant_memberships", "last_active_at")
    op.drop_column("tenants", "deletion_scheduled_for")
    op.drop_table("tenant_settings")
