"""Small builders for Stage 2A tests. They go through the real repositories."""

import hashlib
import os
from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.modules.identity.models import User
from app.modules.identity.persistence import PostgresUserRepository
from app.modules.tenants.models import Role, Tenant, TenantMembership
from app.modules.tenants.persistence import (
    PostgresMembershipRepository,
    PostgresRoleRepository,
    PostgresTenantRepository,
)
from app.seed import _workspace

DEMO_MATRIX = _workspace().matrix
SOON = datetime.now(UTC) + timedelta(days=1)


def digest(label: str | None = None) -> bytes:
    """A 32-byte digest standing in for an HMAC of a session token. Random unless a label is given."""
    return hashlib.sha256(label.encode() if label else os.urandom(32)).digest()


def tenant(s: Session, slug: str, *, with_roles: bool = True) -> Tenant:
    t = PostgresTenantRepository(s).create(slug, slug.title())
    if with_roles:
        PostgresRoleRepository(s, t.id).create_system_roles(DEMO_MATRIX)
    return t


def user(s: Session, email: str, name: str = "Test User") -> User:
    return PostgresUserRepository(s).create(email, name)


def role(s: Session, t: Tenant, key: str = "analyst") -> Role:
    found = PostgresRoleRepository(s, t.id).find_by_key(key)
    assert found is not None
    return found


def member(s: Session, t: Tenant, u: User, key: str = "analyst", **kw) -> TenantMembership:
    return PostgresMembershipRepository(s, t.id).add(u.id, role(s, t, key).id, **kw)


def remove_demo(s: Session, extra_emails: tuple[str, ...] = ()) -> None:
    """Deletes the demo tenant, its users and its audit events (for tests that commit to the shared test database).

    Must run as the OWNER: audit events are append-only, so this temporarily disables the trigger inside the
    transaction, which only the table owner can do (the runtime user can't, and can't DELETE audit rows at all).
    """
    from sqlalchemy import delete, select, text

    from app.modules.audit.models import AuditEventRecord
    from app.modules.tenants.models import Role, TenantSettings
    from app.seed import _members

    tenant_id = s.scalar(select(Tenant.id).where(Tenant.slug == "acme"))
    if tenant_id is not None:
        s.execute(text("ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only"))
        s.execute(delete(AuditEventRecord).where(AuditEventRecord.tenant_id == tenant_id))
        s.execute(text("ALTER TABLE audit_events ENABLE TRIGGER audit_events_append_only"))
        s.execute(delete(TenantMembership).where(TenantMembership.tenant_id == tenant_id))  # cascades to sessions
        s.execute(delete(Role).where(Role.tenant_id == tenant_id))  # cascades to role_permissions
        s.execute(delete(TenantSettings).where(TenantSettings.tenant_id == tenant_id))
        s.execute(delete(Tenant).where(Tenant.id == tenant_id))
    s.execute(delete(User).where(User.email.in_([m.email for m in _members()] + list(extra_emails))))
