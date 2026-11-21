"""PostgreSQL repositories for tenants, roles, permissions and memberships.

Two kinds of repository:
- **Global** (``TenantRepository``, ``PermissionCatalogRepository``): platform-level lookups.
- **Tenant-scoped** (``RoleRepository``, ``MembershipRepository``): constructed with the tenant id resolved from
  the authenticated request, never from client input. Every query filters by that tenant, every write takes its
  ``tenant_id`` from it, and another tenant's id behaves exactly like a missing one (``NotFound``), so ids can't
  be probed across tenants. Composite foreign keys enforce the same boundary in the database.

Repositories never commit: the caller's unit of work (``DbSession`` per request, ``Database.session()`` in
scripts) owns the transaction. Not yet wired into the API, which still runs on the in-memory repositories.
"""

# Postponed evaluation: these classes define a `list()` method, which would otherwise shadow the builtin in
# later annotations such as `list[uuid.UUID]`.
from __future__ import annotations

import re
import uuid
from collections.abc import Iterable
from datetime import datetime
from typing import Protocol

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core import clock
from app.core.errors import Conflict, NotFound
from app.db.integrity import translate_integrity_errors

from .models import (
    MEMBERSHIP_STATUSES,
    SLUG_PATTERN,
    Permission,
    Role,
    RolePermission,
    Tenant,
    TenantMembership,
    TenantSettings,
)
from .permissions import (
    CATALOG_CODES,
    UnsupportedPermissionSet,
    grants_from_matrix,
    levels_for_role,
    matrix_from_grants,
)
from .schemas import ROLE_IDS, ROLES, Matrix

_SLUG = re.compile(SLUG_PATTERN)

# Settings for a tenant created without explicit values (and the values migration 0002 backfilled for tenants that
# existed before tenant_settings). Every value passes the API's validation (OrgSettings / SecurityPolicy).
DEFAULT_SETTINGS = {
    "industry": "Wholesale & Distribution",  # DataPilot's initial market: Indian distributors and wholesalers
    "timezone": "UTC",
    "audit_retention_days": 365,
    "require_mfa": False,
    "enforce_sso": False,
    "session_timeout_hours": 12,
}

# ====================================================================== interfaces


class TenantRepository(Protocol):
    def create(self, slug: str, name: str, *, settings: dict | None = None) -> Tenant: ...
    def get(self, tenant_id: uuid.UUID) -> Tenant: ...
    def find_by_slug(self, slug: str) -> Tenant | None: ...


class PermissionCatalogRepository(Protocol):
    def codes(self) -> frozenset[str]: ...


class RoleRepository(Protocol):
    tenant_id: uuid.UUID

    def create(self, key: str, name: str, description: str = "", *, is_system: bool = False) -> Role: ...
    def create_system_roles(self, matrix: Matrix) -> list[Role]: ...
    def get(self, role_id: uuid.UUID) -> Role: ...
    def find_by_key(self, key: str) -> Role | None: ...
    def list(self) -> list[Role]: ...
    def permissions(self, role_id: uuid.UUID) -> frozenset[str]: ...
    def set_permissions(self, role_id: uuid.UUID, codes: Iterable[str]) -> frozenset[str]: ...
    def matrix(self) -> Matrix: ...
    def save_matrix(self, matrix: Matrix) -> Matrix: ...


class MembershipRepository(Protocol):
    tenant_id: uuid.UUID

    def add(
        self, user_id: uuid.UUID, role_id: uuid.UUID, *, status: str = "active", title: str = ""
    ) -> TenantMembership: ...
    def get(self, membership_id: uuid.UUID) -> TenantMembership: ...
    def find_by_user(self, user_id: uuid.UUID) -> TenantMembership | None: ...
    def list(self, role_key: str | None = None) -> list[TenantMembership]: ...
    def change_role(self, membership_id: uuid.UUID, role_id: uuid.UUID) -> TenantMembership: ...
    def remove(self, membership_id: uuid.UUID) -> None: ...


# ====================================================================== global


class PostgresTenantRepository:
    def __init__(self, session: Session) -> None:
        self._s = session

    def create(self, slug: str, name: str, *, settings: dict | None = None) -> Tenant:
        """Creates the tenant and its settings row (every tenant has exactly one)."""
        if not _SLUG.match(slug):
            raise ValueError(f"Invalid tenant slug {slug!r}")
        tenant = Tenant(slug=slug, name=name.strip())
        with translate_integrity_errors(self._s, unique=lambda: Conflict(f"The slug {slug!r} is already taken")):
            self._s.add(tenant)
        self._s.add(TenantSettings(tenant_id=tenant.id, **{**DEFAULT_SETTINGS, **(settings or {})}))
        self._s.flush()
        self._s.refresh(tenant)  # server defaults (status, timestamps)
        return tenant

    def get(self, tenant_id: uuid.UUID) -> Tenant:
        tenant = self._s.get(Tenant, tenant_id)
        if tenant is None:
            raise NotFound("Tenant not found")
        return tenant

    def find_by_slug(self, slug: str) -> Tenant | None:
        return self._s.scalar(select(Tenant).where(Tenant.slug == slug))


class PostgresPermissionCatalogRepository:
    def __init__(self, session: Session) -> None:
        self._s = session

    def codes(self) -> frozenset[str]:
        return frozenset(self._s.scalars(select(Permission.code)))


# ====================================================================== tenant-scoped


class PostgresRoleRepository:
    def __init__(self, session: Session, tenant_id: uuid.UUID) -> None:
        self._s = session
        self.tenant_id = tenant_id

    def create(self, key: str, name: str, description: str = "", *, is_system: bool = False) -> Role:
        role = Role(tenant_id=self.tenant_id, key=key, name=name, description=description, is_system=is_system)
        with translate_integrity_errors(
            self._s,
            unique=lambda: Conflict(f"This tenant already has a role {key!r}"),
            foreign_key=lambda: NotFound("Tenant not found"),
        ):
            self._s.add(role)
        return role

    def create_system_roles(self, matrix: Matrix) -> list[Role]:
        """The five built-in roles with the permissions the matrix gives them (e.g. for a new tenant)."""
        grants = grants_from_matrix(matrix)
        roles = []
        for info in ROLES:
            role = self.create(info.id, info.label, info.description, is_system=True)
            self._write_grants(role, grants[info.id])
            roles.append(role)
        return roles

    def get(self, role_id: uuid.UUID) -> Role:
        role = self._s.scalar(select(Role).where(Role.tenant_id == self.tenant_id, Role.id == role_id))
        if role is None:
            raise NotFound("Role not found")
        return role

    def find_by_key(self, key: str) -> Role | None:
        return self._s.scalar(select(Role).where(Role.tenant_id == self.tenant_id, Role.key == key))

    def list(self) -> list[Role]:
        roles = list(self._s.scalars(select(Role).where(Role.tenant_id == self.tenant_id)))
        order = {key: i for i, key in enumerate(ROLE_IDS)}
        return sorted(roles, key=lambda r: (order.get(r.key, len(order)), r.key))

    def permissions(self, role_id: uuid.UUID) -> frozenset[str]:
        self.get(role_id)  # NotFound for another tenant's role
        return self._grants_of([role_id])[role_id]

    def set_permissions(self, role_id: uuid.UUID, codes: Iterable[str]) -> frozenset[str]:
        """Replaces a role's permissions. System roles only accept sets the matrix can represent."""
        role = self.get(role_id)
        codes = frozenset(codes)
        unknown = codes - CATALOG_CODES
        if unknown:
            raise UnsupportedPermissionSet(f"Unknown permissions {sorted(unknown)}")
        if role.is_system:
            levels_for_role(role.key, codes)  # raises UnsupportedPermissionSet for anything unrepresentable
        self._write_grants(role, codes)
        return codes

    def matrix(self) -> Matrix:
        roles = {r.key: r for r in self.list() if r.is_system}
        if set(roles) != set(ROLE_IDS):
            raise NotFound("This tenant's system roles are incomplete")
        grants = self._grants_of([r.id for r in roles.values()])
        return matrix_from_grants({key: grants[role.id] for key, role in roles.items()})

    def save_matrix(self, matrix: Matrix) -> Matrix:
        grants = grants_from_matrix(matrix)  # validates the whole matrix before writing anything
        for key in ROLE_IDS:
            role = self.find_by_key(key)
            if role is None:
                raise NotFound(f"System role {key!r} not found")
            self._write_grants(role, grants[key])
        return self.matrix()

    # ------------------------------------------------------------------ internals

    def _grants_of(self, role_ids: list[uuid.UUID]) -> dict[uuid.UUID, frozenset[str]]:
        rows = self._s.execute(
            select(RolePermission.role_id, RolePermission.permission_code).where(
                RolePermission.tenant_id == self.tenant_id, RolePermission.role_id.in_(role_ids)
            )
        )
        found: dict[uuid.UUID, set[str]] = {rid: set() for rid in role_ids}
        for role_id, code in rows:
            found[role_id].add(code)
        return {rid: frozenset(codes) for rid, codes in found.items()}

    def _write_grants(self, role: Role, codes: frozenset[str]) -> None:
        current = self._grants_of([role.id])[role.id]
        removed, added = current - codes, codes - current
        if removed:
            self._s.execute(
                delete(RolePermission).where(
                    RolePermission.tenant_id == self.tenant_id,
                    RolePermission.role_id == role.id,
                    RolePermission.permission_code.in_(removed),
                )
            )
        with translate_integrity_errors(self._s, foreign_key=lambda: UnsupportedPermissionSet("Unknown permission")):
            self._s.add_all(
                RolePermission(tenant_id=self.tenant_id, role_id=role.id, permission_code=c) for c in sorted(added)
            )


class PostgresMembershipRepository:
    def __init__(self, session: Session, tenant_id: uuid.UUID) -> None:
        self._s = session
        self.tenant_id = tenant_id
        self._roles = PostgresRoleRepository(session, tenant_id)

    def add(
        self, user_id: uuid.UUID, role_id: uuid.UUID, *, status: str = "active", title: str = ""
    ) -> TenantMembership:
        if status not in MEMBERSHIP_STATUSES:
            raise ValueError(f"Invalid membership status {status!r}")
        self._roles.get(role_id)  # the role must belong to this tenant (also enforced by a composite FK)
        joined_at: datetime | None = None if status == "invited" else clock.now()
        membership = TenantMembership(
            tenant_id=self.tenant_id,
            user_id=user_id,
            role_id=role_id,
            membership_status=status,
            title=title.strip(),
            joined_at=joined_at,
        )
        with translate_integrity_errors(
            self._s,
            unique=lambda: Conflict("This user is already a member of the tenant"),
            foreign_key=lambda: NotFound("User not found"),
        ):
            self._s.add(membership)
        return membership

    def get(self, membership_id: uuid.UUID) -> TenantMembership:
        membership = self._s.scalar(
            select(TenantMembership).where(
                TenantMembership.tenant_id == self.tenant_id, TenantMembership.id == membership_id
            )
        )
        if membership is None:
            raise NotFound("Membership not found")
        return membership

    def find_by_user(self, user_id: uuid.UUID) -> TenantMembership | None:
        return self._s.scalar(
            select(TenantMembership).where(
                TenantMembership.tenant_id == self.tenant_id, TenantMembership.user_id == user_id
            )
        )

    def list(self, role_key: str | None = None) -> list[TenantMembership]:
        query = select(TenantMembership).where(TenantMembership.tenant_id == self.tenant_id)
        if role_key is not None:
            query = query.join(
                Role, (Role.tenant_id == TenantMembership.tenant_id) & (Role.id == TenantMembership.role_id)
            ).where(Role.key == role_key)
        return list(self._s.scalars(query.order_by(TenantMembership.created_at, TenantMembership.id)))

    def change_role(self, membership_id: uuid.UUID, role_id: uuid.UUID) -> TenantMembership:
        membership = self.get(membership_id)
        self._roles.get(role_id)
        membership.role_id = role_id
        self._s.flush()
        return membership

    def remove(self, membership_id: uuid.UUID) -> None:
        """Deletes the membership; its sessions are removed with it (ON DELETE CASCADE)."""
        self._s.delete(self.get(membership_id))
        self._s.flush()
