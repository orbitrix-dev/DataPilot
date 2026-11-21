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
    PrimaryKeyConstraint,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, Timestamps, UUIDPrimaryKey, check_in

TENANT_STATUSES = ("active", "suspended", "deleted")
MEMBERSHIP_STATUSES = ("invited", "active", "suspended")
SLUG_PATTERN = r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$"


class Tenant(UUIDPrimaryKey, Timestamps, Base):
    """An organisation. Plan/billing data is owned by the Billing module and deliberately not stored here."""

    __tablename__ = "tenants"

    # Human-readable, URL-safe and permanent: it stays reserved after soft deletion.
    slug: Mapped[str] = mapped_column(String(63), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(20), server_default="active")
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

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

    __table_args__ = (
        UniqueConstraint("tenant_id", "user_id"),
        # The role must belong to the same tenant as the membership.
        ForeignKeyConstraint(["tenant_id", "role_id"], ["roles.tenant_id", "roles.id"], ondelete="RESTRICT"),
        CheckConstraint(check_in("membership_status", MEMBERSHIP_STATUSES), name="membership_status_valid"),
        CheckConstraint("(membership_status = 'invited') = (joined_at IS NULL)", name="joined_at_matches_status"),
        Index(None, "user_id"),
        Index(None, "tenant_id", "role_id"),
    )
