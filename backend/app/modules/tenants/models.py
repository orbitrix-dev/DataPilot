"""Tenants, their roles and permissions, and memberships (ORM mappings only; no business logic).

Tenant-owned tables carry ``tenant_id``, and references between them use composite foreign keys that include
``tenant_id``, so the database itself rejects cross-tenant links (e.g. a membership with another tenant's role).

Delete behaviour:
- tenant → roles / memberships: RESTRICT. Tenants are soft-deleted; purging is a deliberate, separate job.
- user → memberships: RESTRICT. Removing a person is explicit.
- role → memberships: RESTRICT. An assigned role can't be deleted.
- role → role_permissions: CASCADE. Grants belong to their role.
- permission → role_permissions: RESTRICT. A permission is retired only after it's revoked everywhere.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    LargeBinary,
    PrimaryKeyConstraint,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, INET, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, Timestamps, UUIDPrimaryKey, check_in
from app.db.types import IPAddress

TENANT_STATUSES = ("active", "suspended", "deleted")
MEMBERSHIP_STATUSES = ("invited", "active", "suspended")
RETENTION_DAYS = (90, 365)
SESSION_TIMEOUT_HOURS = (1, 8, 12, 24)
SLUG_PATTERN = r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$"


class Tenant(UUIDPrimaryKey, Timestamps, Base):
    """An organisation. Plan/billing data is owned by the Billing module and deliberately not stored here."""

    __tablename__ = "tenants"

    # Human-readable, URL-safe and permanent: it stays reserved after soft deletion.
    slug: Mapped[str] = mapped_column(String(63), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(20), server_default="active")
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Set by "Schedule deletion" (Admin → Organization). The workspace stays usable until then; status is unchanged.
    deletion_scheduled_for: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        CheckConstraint(f"slug ~ '{SLUG_PATTERN}'", name="slug_format"),
        CheckConstraint("length(btrim(name)) > 0", name="name_not_blank"),
        CheckConstraint(check_in("status", TENANT_STATUSES), name="status_valid"),
        CheckConstraint("(status = 'deleted') = (deleted_at IS NOT NULL)", name="deleted_at_matches_status"),
    )


class Permission(Base):
    """The global permission catalog (not tenant-owned). Rows are managed by migrations, never by tenants."""

    __tablename__ = "permissions"

    # The code is the key: stable, readable, and grants need no lookup join.
    code: Mapped[str] = mapped_column(String(64), primary_key=True)
    module: Mapped[str] = mapped_column(String(32))
    description: Mapped[str] = mapped_column(Text)

    __table_args__ = (CheckConstraint(r"code ~ '^[a-z_]+(:[a-z_]+)+$'", name="code_format"),)


class Role(UUIDPrimaryKey, Timestamps, Base):
    """A tenant's role. Each tenant gets its own copy of the five system roles, so each can edit its matrix."""

    __tablename__ = "roles"

    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="RESTRICT"))
    key: Mapped[str] = mapped_column(String(40))
    name: Mapped[str] = mapped_column(String(80))
    description: Mapped[str] = mapped_column(Text, server_default="")
    is_system: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))

    __table_args__ = (
        UniqueConstraint("tenant_id", "key"),
        # Target of the composite foreign keys that keep role references inside one tenant.
        UniqueConstraint("tenant_id", "id"),
        CheckConstraint(r"key ~ '^[a-z][a-z0-9_-]{1,39}$'", name="key_format"),
        CheckConstraint("length(btrim(name)) > 0", name="name_not_blank"),
    )


class RolePermission(Base):
    """A permission granted to a role.

    ``tenant_id`` is derivable from the role but stored on purpose: the composite foreign key on
    (tenant_id, role_id) is what proves the role belongs to the tenant, and it allows tenant-scoped queries
    (and a future row-level-security policy) without joins.
    """

    __tablename__ = "role_permissions"

    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    role_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    permission_code: Mapped[str] = mapped_column(
        String(64), ForeignKey("permissions.code", ondelete="RESTRICT", onupdate="CASCADE")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        PrimaryKeyConstraint("role_id", "permission_code"),
        ForeignKeyConstraint(["tenant_id", "role_id"], ["roles.tenant_id", "roles.id"], ondelete="CASCADE"),
        Index(None, "tenant_id"),
        Index(None, "permission_code"),
    )


class TenantMembership(UUIDPrimaryKey, Timestamps, Base):
    """A user's membership of a tenant, with exactly one role from that same tenant."""

    __tablename__ = "tenant_memberships"

    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="RESTRICT"))
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"))
    role_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    membership_status: Mapped[str] = mapped_column(String(20))
    # Job title shown in Admin → Users (per tenant: the same person can hold different titles in different tenants).
    title: Mapped[str] = mapped_column(String(120), server_default="")
    # NULL while invited; set when the user joins.
    joined_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Last activity in this tenant, shown in Admin → Users ("Last active", IP). NULL until the member is active.
    last_active_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_active_ip: Mapped[IPAddress | None] = mapped_column(INET)

    __table_args__ = (
        UniqueConstraint("tenant_id", "user_id"),
        # The role must belong to the same tenant as the membership.
        ForeignKeyConstraint(["tenant_id", "role_id"], ["roles.tenant_id", "roles.id"], ondelete="RESTRICT"),
        CheckConstraint(check_in("membership_status", MEMBERSHIP_STATUSES), name="membership_status_valid"),
        CheckConstraint("(membership_status = 'invited') = (joined_at IS NULL)", name="joined_at_matches_status"),
        Index(None, "user_id"),
        Index(None, "tenant_id", "role_id"),
    )


class TenantSettings(Timestamps, Base):
    """Per-tenant settings edited in Admin → Organization and Admin → Security (one row per tenant).

    Only what the existing API and Admin pages expose. The tenant's display name is ``tenants.name``.
    ``industry`` and ``timezone`` are validated against the API's allowed values (Pydantic); the database only
    requires them to be non-blank, so offering a new value doesn't need a migration.
    """

    __tablename__ = "tenant_settings"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="RESTRICT"), primary_key=True
    )
    industry: Mapped[str] = mapped_column(String(80))
    timezone: Mapped[str] = mapped_column(String(64), server_default="UTC")
    audit_retention_days: Mapped[int] = mapped_column(Integer, server_default="365")
    require_mfa: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    enforce_sso: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    session_timeout_hours: Mapped[int] = mapped_column(Integer, server_default="12")

    __table_args__ = (
        CheckConstraint("length(btrim(industry)) > 0", name="industry_not_blank"),
        CheckConstraint("length(btrim(timezone)) > 0", name="timezone_not_blank"),
        CheckConstraint(
            f"audit_retention_days IN ({', '.join(map(str, RETENTION_DAYS))})", name="audit_retention_days_valid"
        ),
        CheckConstraint(
            f"session_timeout_hours IN ({', '.join(map(str, SESSION_TIMEOUT_HOURS))})",
            name="session_timeout_hours_valid",
        ),
    )


API_KEY_SCOPES = ("insights:read", "trust:read", "connect:read", "automate:read", "intelligence:query")


class ApiKey(UUIDPrimaryKey, Timestamps, Base):
    """A tenant API key for non-browser clients. Only an HMAC-SHA256 digest of the secret is stored, under the
    server-side pepper version recorded in ``pepper_version``; the secret itself is shown once, at creation."""

    __tablename__ = "api_keys"

    # The id the API exposes ("key-9f2a" for the demo keys, "key_<12 hex>" for new ones).
    public_id: Mapped[str] = mapped_column(String(40), unique=True)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="RESTRICT"))
    name: Mapped[str] = mapped_column(String(80))
    # Display-only hint ("dp_live_••••9f2a"): never enough to reconstruct the secret.
    prefix: Mapped[str] = mapped_column(String(32))
    secret_hash: Mapped[bytes] = mapped_column(LargeBinary, unique=True)
    pepper_version: Mapped[str] = mapped_column(String(32))
    scopes: Mapped[list[str]] = mapped_column(ARRAY(String(40)))
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    created_by_name: Mapped[str] = mapped_column(String(120))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )

    __table_args__ = (
        CheckConstraint(r"public_id ~ '^[a-z0-9][a-z0-9_-]{1,39}$'", name="public_id_format"),
        CheckConstraint("octet_length(secret_hash) = 32", name="secret_hash_is_digest"),
        CheckConstraint("cardinality(scopes) >= 1", name="has_scopes"),
        CheckConstraint(
            "scopes <@ ARRAY[" + ", ".join(f"'{s}'" for s in API_KEY_SCOPES) + "]::varchar[]", name="scopes_known"
        ),
        CheckConstraint("length(btrim(name)) > 0", name="name_not_blank"),
        CheckConstraint("expires_at IS NULL OR expires_at > created_at", name="expires_after_creation"),
        # One active key per name per tenant (the existing "An active key already has this name" rule).
        Index(
            "uq_api_keys_tenant_id_active_name",
            "tenant_id",
            func.lower(text("name")),
            unique=True,
            postgresql_where=text("revoked_at IS NULL"),
        ),
        Index(None, "tenant_id", "created_at"),
    )
