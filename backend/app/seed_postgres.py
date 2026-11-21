"""Loads the demo tenant into PostgreSQL: tenant, users, the five system roles with their permissions, memberships.

The data comes from ``app/seed.py`` (the in-memory demo the API still serves), so both stay identical: Acme Global
Corp, its 12 members and the current permission matrix.

Behaviour:
- **Idempotent and insert-only.** Every row is inserted with ``ON CONFLICT DO NOTHING`` on its natural key
  (tenant slug, user email, tenant + role key, tenant + user). Re-running creates nothing new and never
  overwrites existing rows, so permission edits made after seeding are preserved. A role's permissions are
  written only when this run created the role.
- **No credentials.** Users get no password (``password_hash`` NULL: they can't sign in) and no sessions are
  created, so the seed never produces anything usable for authentication.
- **Never in production.** ``app.cli seed-demo`` refuses to run when ``DP_ENV=prod``.
- Schema comes from migrations only; the seed requires ``alembic upgrade head`` to have run.

Run it with ``uv run python -m app.cli seed-demo``.
"""

import uuid
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core import clock
from app.db.base import uuid7
from app.modules.identity.models import User
from app.modules.identity.persistence import normalize_email
from app.modules.tenants.models import Role, RolePermission, Tenant, TenantMembership
from app.modules.tenants.permissions import grants_from_matrix
from app.modules.tenants.schemas import ROLES
from app.seed import _members, _workspace

DEMO_TENANT_SLUG = "acme"


@dataclass
class SeedReport:
    tenant_id: uuid.UUID | None = None
    created: dict[str, int] = field(
        default_factory=lambda: {"tenants": 0, "users": 0, "roles": 0, "role_permissions": 0, "memberships": 0}
    )

    @property
    def total_created(self) -> int:
        return sum(self.created.values())


def _insert_ignore(session: Session, model: type, values: dict, conflict: list[str]) -> bool:
    """Inserts one row unless its natural key exists. Returns True if this call created it."""
    stmt = insert(model).values(**values).on_conflict_do_nothing(index_elements=conflict).returning(model.id)
    return session.execute(stmt).first() is not None


def seed_demo(session: Session) -> SeedReport:
    """Runs inside the caller's transaction (it never commits)."""
    report = SeedReport()
    workspace = _workspace()

    if _insert_ignore(session, Tenant, {"id": uuid7(), "slug": DEMO_TENANT_SLUG, "name": workspace.org.name}, ["slug"]):
        report.created["tenants"] += 1
    tenant_id = session.scalar(select(Tenant.id).where(Tenant.slug == DEMO_TENANT_SLUG))
    report.tenant_id = tenant_id

    grants = grants_from_matrix(workspace.matrix)
    role_ids: dict[str, uuid.UUID] = {}
    for info in ROLES:
        values = {
            "id": uuid7(),
            "tenant_id": tenant_id,
            "key": info.id,
            "name": info.label,
            "description": info.description,
            "is_system": True,
        }
        created = _insert_ignore(session, Role, values, ["tenant_id", "key"])
        role_ids[info.id] = session.scalar(select(Role.id).where(Role.tenant_id == tenant_id, Role.key == info.id))
        if created:
            report.created["roles"] += 1
            for code in sorted(grants[info.id]):
                session.add(RolePermission(tenant_id=tenant_id, role_id=role_ids[info.id], permission_code=code))
                report.created["role_permissions"] += 1
    session.flush()

    for member in _members():
        email = normalize_email(member.email)
        if _insert_ignore(session, User, {"id": uuid7(), "email": email, "full_name": member.name}, ["email"]):
            report.created["users"] += 1
        user_id = session.scalar(select(User.id).where(User.email == email))
        membership = {
            "id": uuid7(),
            "tenant_id": tenant_id,
            "user_id": user_id,
            "role_id": role_ids[member.role],
            "membership_status": "invited" if member.status == "invited" else "active",
            "title": member.title,
            "joined_at": None if member.status == "invited" else clock.now(),
        }
        if _insert_ignore(session, TenantMembership, membership, ["tenant_id", "user_id"]):
            report.created["memberships"] += 1
    return report
