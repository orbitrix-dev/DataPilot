"""PostgreSQL-backed implementation of the Tenants module's existing repository interface.

``tenants/service.py`` talks to ``TenantsRepository``: four ``Table``s (``members``, ``sessions``, ``workspace``,
``api_keys``) of the API's own Pydantic models. These adapters implement those Tables on top of the Stage 2A
schema, so the service, routes and response contracts stay as they are:

- ``members``   ⇄ users + tenant_memberships + roles. Member ``id`` is ``users.public_id`` ("u-elena").
- ``sessions``  ⇄ user_sessions. Session ``id`` is ``user_sessions.public_id`` ("sess-1").
- ``workspace`` ⇄ tenants (name, deletion schedule) + tenant_settings + the role_permissions matrix.
- ``api_keys``  stays in memory (API key persistence is a later stage).

Every adapter is bound to one tenant's UUID, resolved from the request context, and one ``Session`` (the
request's unit of work; adapters never commit). Rows of other tenants are invisible: looking one up raises the
same ``NotFound`` as a missing id, with the exact messages the in-memory tables used ("Member 'x' not found").

Suspended memberships are not part of the API's member model (``Member.status`` is "active" | "invited"), so
they are excluded from ``members`` entirely: listings, lookups, role counts and Billing's seat count.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.core import clock
from app.core.errors import NotFound
from app.core.repository import Table
from app.modules.identity.models import User, UserSession
from app.modules.identity.persistence import parse_ip

from .models import Role, Tenant, TenantMembership, TenantSettings
from .persistence import PostgresRoleRepository
from .schemas import ApiKeyRecord, Member, OrgSettings, SecurityPolicy, Session, Workspace

API_STATUSES = ("active", "invited")  # the member statuses the API model can represent


def _not_found(kind: str, key: str) -> NotFound:
    # Same wording as InMemoryTable, so error responses are unchanged.
    return NotFound(f"{kind} {key!r} not found")


# ====================================================================== members


class PostgresMembersTable:
    def __init__(self, session: DbSession, tenant_id: uuid.UUID) -> None:
        self._s = session
        self._tenant_id = tenant_id
        self._roles = PostgresRoleRepository(session, tenant_id)

    def _query(self):
        return (
            select(TenantMembership, User, Role.key)
            .join(User, User.id == TenantMembership.user_id)
            .join(Role, (Role.tenant_id == TenantMembership.tenant_id) & (Role.id == TenantMembership.role_id))
            .where(
                TenantMembership.tenant_id == self._tenant_id,
                TenantMembership.membership_status.in_(API_STATUSES),
            )
        )

    @staticmethod
    def _to_member(m: TenantMembership, u: User, role_key: str) -> Member:
        return Member(
            id=u.public_id,
            name=u.full_name,
            email=u.email,
            title=m.title,
            role=role_key,
            status=m.membership_status,
            mfa="enabled" if u.mfa_enrolled_at is not None else "pending",
            last_active_at=m.last_active_at,
            ip=str(m.last_active_ip) if m.last_active_ip is not None else None,
        )

    def list(self) -> list[Member]:
        # Membership ids are UUIDv7 and monotonic, so this is creation order (as the in-memory table had).
        rows = self._s.execute(self._query().order_by(TenantMembership.id))
        return [self._to_member(*row) for row in rows]

    def find(self, key: str) -> Member | None:
        row = self._s.execute(self._query().where(User.public_id == key)).first()
        return self._to_member(*row) if row else None

    def get(self, key: str) -> Member:
        member = self.find(key)
        if member is None:
            raise _not_found("Member", key)
        return member

    def put(self, row: Member) -> Member:
        """Creates or updates the member. Returns it with its stored id: inviting someone who is already a user
        (e.g. a member of another tenant) reuses that person, and so their existing id."""
        role = self._roles.find_by_key(row.role)
        if role is None:
            raise NotFound(f"Role {row.role!r} not found")
        found = self._s.execute(
            select(TenantMembership, User)
            .join(User, User.id == TenantMembership.user_id)
            .where(TenantMembership.tenant_id == self._tenant_id, User.public_id == row.id)
        ).first()
        if found is not None:
            membership, user = found
        else:
            user = self._s.scalar(select(User).where(User.email == row.email))
            if user is None:
                user = User(public_id=row.id, email=row.email, full_name=row.name)
                self._s.add(user)
                self._s.flush()
            membership = TenantMembership(tenant_id=self._tenant_id, user_id=user.id)
            self._s.add(membership)
        was_invited = membership.membership_status == "invited"
        membership.role_id = role.id
        membership.membership_status = row.status
        membership.title = row.title
        membership.last_active_at = row.last_active_at
        membership.last_active_ip = parse_ip(row.ip)
        if row.status == "invited":
            membership.joined_at = None
        elif membership.joined_at is None or was_invited:
            membership.joined_at = clock.now()
        self._s.flush()
        return self._to_member(membership, user, role.key)

    def delete(self, key: str) -> None:
        """Removes the membership (the person stays, possibly a member elsewhere). Its sessions go with it
        (ON DELETE CASCADE), which is the existing "revoke access and end their sessions" behaviour."""
        membership = self._s.scalar(
            select(TenantMembership)
            .join(User, User.id == TenantMembership.user_id)
            .where(
                TenantMembership.tenant_id == self._tenant_id,
                TenantMembership.membership_status.in_(API_STATUSES),
                User.public_id == key,
            )
        )
        if membership is None:
            raise _not_found("Member", key)
        self._s.delete(membership)
        self._s.flush()

    # ---- used by request authentication (deps), not by the service

    def find_active(self, key: str) -> Member | None:
        """The member only if both the membership and the user are active (invited/suspended/disabled → None)."""
        row = self._s.execute(
            self._query().where(
                User.public_id == key, TenantMembership.membership_status == "active", User.status == "active"
            )
        ).first()
        return self._to_member(*row) if row else None


# ====================================================================== sessions


class PostgresSessionsTable:
    def __init__(self, session: DbSession, tenant_id: uuid.UUID) -> None:
        self._s = session
        self._tenant_id = tenant_id

    def _query(self):
        return (
            select(UserSession, User.public_id)
            .join(User, User.id == UserSession.user_id)
            .where(
                UserSession.tenant_id == self._tenant_id,
                UserSession.revoked_at.is_(None),
                UserSession.expires_at > clock.now(),
            )
        )

    @staticmethod
    def _to_session(s: UserSession, member_public_id: str) -> Session:
        return Session(
            id=s.public_id,
            member_id=member_public_id,
            device=s.device or "",
            location=s.location or "",
            ip=str(s.ip) if s.ip is not None else "",
            signed_in_at=s.created_at,
        )

    def list(self) -> list[Session]:
        return [self._to_session(*row) for row in self._s.execute(self._query().order_by(UserSession.id))]

    def find(self, key: str) -> Session | None:
        row = self._s.execute(self._query().where(UserSession.public_id == key)).first()
        return self._to_session(*row) if row else None

    def get(self, key: str) -> Session:
        found = self.find(key)
        if found is None:
            raise _not_found("Session", key)
        return found

    def put(self, row: Session) -> Session:
        raise NotImplementedError("Sessions are created by sign-in (a later stage), not through this table")

    def delete(self, key: str) -> None:
        """Revokes the session: the row stays, with revoked_at and a reason; it no longer appears or works."""
        found = self._s.scalar(
            select(UserSession).where(
                UserSession.tenant_id == self._tenant_id,
                UserSession.public_id == key,
                UserSession.revoked_at.is_(None),
            )
        )
        if found is None:
            raise _not_found("Session", key)
        found.revoked_at = clock.now()
        found.revoked_reason = "admin_revoked"
        self._s.flush()


# ====================================================================== workspace (tenant + settings + matrix)

WORKSPACE_ID = "workspace"


class PostgresWorkspaceTable:
    def __init__(self, session: DbSession, tenant_id: uuid.UUID) -> None:
        self._s = session
        self._tenant_id = tenant_id
        self._roles = PostgresRoleRepository(session, tenant_id)

    def _load(self) -> tuple[Tenant, TenantSettings]:
        row = self._s.execute(
            select(Tenant, TenantSettings)
            .join(TenantSettings, TenantSettings.tenant_id == Tenant.id)
            .where(Tenant.id == self._tenant_id)
        ).first()
        if row is None:
            raise _not_found("Workspace", WORKSPACE_ID)
        return row

    def list(self) -> list[Workspace]:
        return [self.get(WORKSPACE_ID)]

    def find(self, key: str) -> Workspace | None:
        return self.get(key) if key == WORKSPACE_ID else None

    def get(self, key: str) -> Workspace:
        if key != WORKSPACE_ID:
            raise _not_found("Workspace", key)
        tenant, settings = self._load()
        return Workspace(
            org=OrgSettings(
                name=tenant.name,
                industry=settings.industry,
                timezone=settings.timezone,
                audit_retention_days=settings.audit_retention_days,
            ),
            policy=SecurityPolicy(
                require_mfa=settings.require_mfa,
                enforce_sso=settings.enforce_sso,
                session_timeout_hours=settings.session_timeout_hours,
            ),
            matrix=self._roles.matrix(),
            deletion_scheduled_for=tenant.deletion_scheduled_for,
        )

    def put(self, row: Workspace) -> Workspace:
        if row.id != WORKSPACE_ID:
            raise _not_found("Workspace", row.id)
        tenant, settings = self._load()
        tenant.name = row.org.name
        tenant.deletion_scheduled_for = row.deletion_scheduled_for
        settings.industry = row.org.industry
        settings.timezone = row.org.timezone
        settings.audit_retention_days = row.org.audit_retention_days
        settings.require_mfa = row.policy.require_mfa
        settings.enforce_sso = row.policy.enforce_sso
        settings.session_timeout_hours = row.policy.session_timeout_hours
        if row.matrix != self._roles.matrix():
            self._roles.save_matrix(row.matrix)  # validates; rejects unsupported combinations
        self._s.flush()
        return row

    def delete(self, key: str) -> None:
        raise NotImplementedError("A workspace is deleted through the tenant lifecycle, not this table")


# ====================================================================== the repository


@dataclass
class PostgresTenantsRepository:
    """Satisfies ``TenantsRepository``. API keys stay in the in-memory table they always used."""

    members: PostgresMembersTable
    sessions: PostgresSessionsTable
    api_keys: Table[ApiKeyRecord]
    workspace: PostgresWorkspaceTable

    @classmethod
    def bind(cls, session: DbSession, tenant_id: uuid.UUID, api_keys: Table[ApiKeyRecord]) -> PostgresTenantsRepository:
        return cls(
            members=PostgresMembersTable(session, tenant_id),
            sessions=PostgresSessionsTable(session, tenant_id),
            api_keys=api_keys,
            workspace=PostgresWorkspaceTable(session, tenant_id),
        )
