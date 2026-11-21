"""Identity: users (global) and their sessions (per tenant membership). ORM mappings only.

No plaintext credential can be stored: ``CHECK`` constraints require ``password_hash`` to be an Argon2id PHC
string and ``token_hash`` to be a 32-byte digest. Hashing itself belongs to the authentication stage.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    LargeBinary,
    String,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import INET, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, Timestamps, UUIDPrimaryKey, check_in
from app.db.types import IPAddress

USER_STATUSES = ("active", "disabled")
EMAIL_PATTERN = r"^[^\s@]+@[^\s@]+\.[^\s@]+$"
# The readable ids the API exposes ("u-elena", "sess-1"). Database UUIDs stay internal.
PUBLIC_ID_PATTERN = r"^[a-z0-9][a-z0-9_-]{1,39}$"


class User(UUIDPrimaryKey, Timestamps, Base):
    """A person, global across tenants. Tenant access comes only from ``TenantMembership``."""

    __tablename__ = "users"

    # The member id the API exposes (e.g. "u-elena"); global, so a person keeps one id across tenants.
    public_id: Mapped[str] = mapped_column(String(40), unique=True)
    # Normalised (trimmed, lower-cased) before storage and enforced by CHECK, so uniqueness is case-insensitive.
    email: Mapped[str] = mapped_column(String(254), unique=True)
    full_name: Mapped[str] = mapped_column(String(120))
    # NULL until authentication sets one; such users cannot sign in.
    password_hash: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(20), server_default="active")
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # MFA enrolment state shown in Admin → Users ("enabled" when set, "pending" when NULL). No MFA logic yet.
    mfa_enrolled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        CheckConstraint(f"public_id ~ '{PUBLIC_ID_PATTERN}'", name="public_id_format"),
        CheckConstraint("email = lower(btrim(email))", name="email_normalized"),
        CheckConstraint(f"email ~ '{EMAIL_PATTERN}'", name="email_format"),
        CheckConstraint("length(btrim(full_name)) > 0", name="full_name_not_blank"),
        CheckConstraint(
            "password_hash IS NULL OR starts_with(password_hash, '$argon2id$')", name="password_hash_is_argon2id"
        ),
        CheckConstraint(check_in("status", USER_STATUSES), name="status_valid"),
    )


class UserSession(UUIDPrimaryKey, Base):
    """A signed-in session for one tenant membership. Only a digest of the session token is stored."""

    __tablename__ = "user_sessions"

    # The session id the API exposes (e.g. "sess-1").
    public_id: Mapped[str] = mapped_column(String(40), unique=True)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    # HMAC-SHA256 digest of the session/refresh token (32 bytes). Never the token itself.
    token_hash: Mapped[bytes] = mapped_column(LargeBinary, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # logout | admin_revoked | membership_removed | expired | ...
    revoked_reason: Mapped[str | None] = mapped_column(String(40))
    # Shown in Admin → Security → Sessions. Optional: not every client provides them.
    device: Mapped[str | None] = mapped_column(String(120))
    ip: Mapped[IPAddress | None] = mapped_column(INET)
    location: Mapped[str | None] = mapped_column(String(120))
    user_agent: Mapped[str | None] = mapped_column(String(512))

    __table_args__ = (
        # A session exists only for a membership of that tenant; removing the membership ends its sessions.
        ForeignKeyConstraint(
            ["tenant_id", "user_id"],
            ["tenant_memberships.tenant_id", "tenant_memberships.user_id"],
            ondelete="CASCADE",
        ),
        CheckConstraint(f"public_id ~ '{PUBLIC_ID_PATTERN}'", name="public_id_format"),
        CheckConstraint("octet_length(token_hash) = 32", name="token_hash_is_digest"),
        CheckConstraint("expires_at > created_at", name="expires_after_creation"),
        CheckConstraint("(revoked_at IS NULL) = (revoked_reason IS NULL)", name="revocation_has_reason"),
        Index("ix_user_sessions_tenant_id_active", "tenant_id", postgresql_where=text("revoked_at IS NULL")),
        Index(None, "user_id"),
    )


class RefreshToken(UUIDPrimaryKey, Base):
    """One link in a session's refresh-token family (the family is the session). Rotation marks the presented token
    used and issues its child. Presenting a used or revoked token is replay: the whole family (session) is revoked."""

    __tablename__ = "refresh_tokens"

    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("user_sessions.id", ondelete="CASCADE")
    )
    token_hash: Mapped[bytes] = mapped_column(LargeBinary, unique=True)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("refresh_tokens.id", ondelete="SET NULL")
    )
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        CheckConstraint("octet_length(token_hash) = 32", name="token_hash_is_digest"),
        CheckConstraint("expires_at > issued_at", name="expires_after_issue"),
        # At most one live token per family: two concurrent rotations can't both succeed.
        Index(
            "uq_refresh_tokens_session_id_live",
            "session_id",
            unique=True,
            postgresql_where=text("used_at IS NULL AND revoked_at IS NULL"),
        ),
        Index(None, "session_id"),
    )


class InvitationToken(UUIDPrimaryKey, Base):
    """A single-use, expiring invitation to set a password for a membership. Only the digest is stored; the token is
    shown once to the operator who issued it. Acceptance consumes it atomically."""

    __tablename__ = "invitation_tokens"

    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    token_hash: Mapped[bytes] = mapped_column(LargeBinary, unique=True)
    issued_by: Mapped[str] = mapped_column(String(160))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        ForeignKeyConstraint(
            ["tenant_id", "user_id"],
            ["tenant_memberships.tenant_id", "tenant_memberships.user_id"],
            ondelete="CASCADE",
        ),
        CheckConstraint("octet_length(token_hash) = 32", name="token_hash_is_digest"),
        CheckConstraint("expires_at > created_at", name="expires_after_creation"),
        # One outstanding invitation per membership: issuing a new one revokes the previous.
        Index(
            "uq_invitation_tokens_tenant_id_user_id_live",
            "tenant_id",
            "user_id",
            unique=True,
            postgresql_where=text("used_at IS NULL AND revoked_at IS NULL"),
        ),
    )
