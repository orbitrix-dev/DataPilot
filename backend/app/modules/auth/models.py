"""Abuse-protection state (Stage 3B.3). ORM mapping only; the logic is in ``throttle.py``."""

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Index, Integer, LargeBinary, SmallInteger, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, UUIDPrimaryKey, check_in

THROTTLE_SCOPES = ("login_ip", "login_account", "mfa", "recovery_code", "api_key_ip")


class AuthThrottleBucket(UUIDPrimaryKey, Base):
    """One counter per (scope, subject). The subject (a client address, an email address, a user id) is stored only as
    HMAC-SHA256 under a versioned key (``key_version``): never in clear. Rows are reused: a new window resets the
    count in place, so the table grows with distinct subjects, not with requests. Expired rows are purged by the owner
    (``python -m app.cli purge-auth-throttle``); the runtime user can't delete."""

    __tablename__ = "auth_throttle_buckets"

    scope: Mapped[str] = mapped_column(String(24))
    subject_hash: Mapped[bytes] = mapped_column(LargeBinary)
    key_version: Mapped[str] = mapped_column(String(32))
    window_start: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    attempt_count: Mapped[int] = mapped_column(Integer)
    # Progressive scopes: how many blocks in a row (each doubles the next); 0 for fixed-window scopes.
    block_level: Mapped[int] = mapped_column(SmallInteger)
    blocked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        UniqueConstraint("scope", "subject_hash"),
        CheckConstraint(check_in("scope", THROTTLE_SCOPES), name="scope_valid"),
        CheckConstraint("octet_length(subject_hash) = 32", name="subject_is_hmac"),
        CheckConstraint("attempt_count >= 0", name="attempt_count_non_negative"),
        CheckConstraint("block_level BETWEEN 0 AND 30", name="block_level_range"),
        CheckConstraint("updated_at >= created_at", name="updated_after_created"),
        Index(None, "updated_at"),  # purge of stale rows
    )
