"""PostgreSQL repositories for users (global) and sessions (tenant-scoped).

``SessionRepository`` follows the same tenant-scoping rules as the tenants module: constructed with the tenant
resolved from the authenticated request; another tenant's session behaves exactly like a missing one.

Hashing passwords and tokens belongs to the authentication stage. These repositories accept only what may be
stored: a 32-byte token digest, never a raw token, and no password setter at all yet.
"""

# Postponed evaluation: these classes define a `list()` method, which would otherwise shadow the builtin in
# later annotations such as `list[uuid.UUID]`.
from __future__ import annotations

import ipaddress
import re
import uuid
from datetime import datetime
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import clock
from app.core.errors import Conflict, NotFound
from app.db.integrity import translate_integrity_errors
from app.modules.tenants.models import TenantMembership

from .models import EMAIL_PATTERN, USER_STATUSES, IPAddress, User, UserSession

_EMAIL = re.compile(EMAIL_PATTERN)
TOKEN_DIGEST_BYTES = 32


def normalize_email(email: str) -> str:
    """The one normalisation used everywhere: trimmed and lower-cased (the database CHECK enforces the same)."""
    normalized = email.strip().lower()
    if not _EMAIL.match(normalized) or len(normalized) > 254:
        raise ValueError("Invalid email address")
    return normalized


def parse_ip(value: str | None) -> IPAddress | None:
    """Validates an IP for the INET column. Raises ValueError for anything that isn't an IP address."""
    return None if value is None else ipaddress.ip_address(value)


# ====================================================================== interfaces


class UserRepository(Protocol):
    def create(self, email: str, full_name: str, *, status: str = "active") -> User: ...
    def get(self, user_id: uuid.UUID) -> User: ...
    def find_by_email(self, email: str) -> User | None: ...


class SessionRepository(Protocol):
    tenant_id: uuid.UUID

    def create(
        self,
        user_id: uuid.UUID,
        token_hash: bytes,
        expires_at: datetime,
        *,
        device: str | None = None,
        ip: str | None = None,
        location: str | None = None,
        user_agent: str | None = None,
    ) -> UserSession: ...
    def get(self, session_id: uuid.UUID) -> UserSession: ...
    def list_active(self) -> list[UserSession]: ...
    def revoke(self, session_id: uuid.UUID, reason: str) -> UserSession: ...


# ====================================================================== implementations


class PostgresUserRepository:
    def __init__(self, session: Session) -> None:
        self._s = session

    def create(self, email: str, full_name: str, *, status: str = "active") -> User:
        if status not in USER_STATUSES:
            raise ValueError(f"Invalid user status {status!r}")
        user = User(email=normalize_email(email), full_name=full_name.strip(), status=status)
        with translate_integrity_errors(self._s, unique=lambda: Conflict("A user with this email already exists")):
            self._s.add(user)
        return user

    def get(self, user_id: uuid.UUID) -> User:
        user = self._s.get(User, user_id)
        if user is None:
            raise NotFound("User not found")
        return user

    def find_by_email(self, email: str) -> User | None:
        try:
            normalized = normalize_email(email)
        except ValueError:
            return None
        return self._s.scalar(select(User).where(User.email == normalized))


class PostgresSessionRepository:
    def __init__(self, session: Session, tenant_id: uuid.UUID) -> None:
        self._s = session
        self.tenant_id = tenant_id

    def create(
        self,
        user_id: uuid.UUID,
        token_hash: bytes,
        expires_at: datetime,
        *,
        device: str | None = None,
        ip: str | None = None,
        location: str | None = None,
        user_agent: str | None = None,
    ) -> UserSession:
        if len(token_hash) != TOKEN_DIGEST_BYTES:
            raise ValueError("token_hash must be a 32-byte digest, never a raw token")
        membership = self._s.scalar(
            select(TenantMembership).where(
                TenantMembership.tenant_id == self.tenant_id, TenantMembership.user_id == user_id
            )
        )
        if membership is None:
            raise NotFound("Membership not found")
        if membership.membership_status != "active":
            raise Conflict("Only active members can have sessions")
        session = UserSession(
            tenant_id=self.tenant_id,
            user_id=user_id,
            token_hash=token_hash,
            expires_at=expires_at,
            device=device,
            ip=parse_ip(ip),
            location=location,
            user_agent=user_agent,
        )
        with translate_integrity_errors(self._s, unique=lambda: Conflict("Session token collision")):
            self._s.add(session)
        return session

    def get(self, session_id: uuid.UUID) -> UserSession:
        found = self._s.scalar(
            select(UserSession).where(UserSession.tenant_id == self.tenant_id, UserSession.id == session_id)
        )
        if found is None:
            raise NotFound("Session not found")
        return found

    def list_active(self) -> list[UserSession]:
        """Unrevoked, unexpired sessions, newest first."""
        return list(
            self._s.scalars(
                select(UserSession)
                .where(
                    UserSession.tenant_id == self.tenant_id,
                    UserSession.revoked_at.is_(None),
                    UserSession.expires_at > clock.now(),
                )
                .order_by(UserSession.created_at.desc(), UserSession.id.desc())
            )
        )

    def revoke(self, session_id: uuid.UUID, reason: str) -> UserSession:
        """Idempotent: revoking an already-revoked session keeps the original time and reason."""
        if not reason.strip():
            raise ValueError("A revocation reason is required")
        found = self.get(session_id)
        if found.revoked_at is None:
            found.revoked_at = clock.now()
            found.revoked_reason = reason.strip()
            self._s.flush()
        return found
