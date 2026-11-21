"""Loads the demo tenant into PostgreSQL, matching the in-memory demo in ``app/seed.py`` exactly.

Acme Global Corp: tenant settings, 12 users (with their readable ids, e.g. "u-elena"), the five system roles with the
current permission matrix, memberships (title, last activity), the four demo sessions, the two demo API keys and the
12 demo audit events.

Behaviour:
- **Idempotent; never overwrites edits.** Rows are inserted with ``ON CONFLICT DO NOTHING`` on their natural keys
  (tenant slug, user email, tenant + role key, tenant + user, session public id). Columns added after a row may have
  been seeded (MFA enrolment, last activity) are only filled where still NULL. A role's permissions are written
  only when this run created the role.
- **Tenant settings.** Written on first seed. If the row holds exactly the defaults migration 0002 backfilled
  (``DEFAULT_SETTINGS``, i.e. a tenant seeded before settings existed), it's replaced with the demo settings once;
  any other values are left alone.
- **No usable credentials.** Users get no password. Each demo session gets the digest of a fresh random token that
  is discarded immediately: no one ever holds a token that matches, so these sessions can't authenticate.
  Re-running never replaces a digest or recreates a session.
- **IDs.** Every inserted row gets an explicit UUIDv7. Demo audit events use *deterministic* UUIDv7s (their
  timestamp + a fixed label), so ``ON CONFLICT (id) DO NOTHING`` makes them idempotent too.
- **Runs as the runtime user.** It needs only the runtime privileges (INSERT/SELECT, UPDATE where it fills NULLs);
  it never writes the permission catalog, and ``ON CONFLICT DO NOTHING`` needs no UPDATE on audit events.
- **Never in production.** ``app.cli seed-demo`` refuses to run when ``DP_ENV=prod``. Requires
  ``alembic upgrade head``.

Run it with ``uv run python -m app.cli seed-demo``.
"""

import hashlib
import secrets
import uuid
from dataclasses import dataclass, field
from datetime import timedelta

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core import clock
from app.db.base import uuid7
from app.modules.audit.models import AuditEventRecord
from app.modules.audit.repository import split_client
from app.modules.identity.models import User, UserSession
from app.modules.identity.persistence import normalize_email, parse_ip
from app.modules.tenants.models import ApiKey, Role, RolePermission, Tenant, TenantMembership, TenantSettings
from app.modules.tenants.permissions import grants_from_matrix
from app.modules.tenants.persistence import DEFAULT_SETTINGS
from app.modules.tenants.schemas import ROLES
from app.seed import _audit, _keys, _members, _sessions, _workspace

DEMO_TENANT_SLUG = "acme"
# Demo sessions disappear from Admin → Sessions this long after seeding (they're listed only while unexpired).
DEMO_SESSION_LIFETIME = timedelta(days=30)


@dataclass
class SeedReport:
    tenant_id: uuid.UUID | None = None
    created: dict[str, int] = field(
        default_factory=lambda: {
            "tenants": 0,
            "settings": 0,
            "users": 0,
            "roles": 0,
            "role_permissions": 0,
            "memberships": 0,
            "sessions": 0,
            "audit_events": 0,
            "api_keys": 0,
        }
    )

    @property
    def total_created(self) -> int:
        return sum(self.created.values())


def _insert_ignore(session: Session, model: type, values: dict, conflict: list[str]) -> bool:
    """Inserts one row unless its natural key exists. Returns True if this call created it."""
    returning = model.tenant_id if model is TenantSettings else model.id
    stmt = insert(model).values(**values).on_conflict_do_nothing(index_elements=conflict).returning(returning)
    return session.execute(stmt).first() is not None


def _unusable_token_digest() -> bytes:
    """The digest of a random token nobody keeps: valid for the column, useless for authentication."""
    return hashlib.sha256(secrets.token_bytes(32)).digest()


def seed_demo(session: Session) -> SeedReport:
    """Runs inside the caller's transaction (it never commits)."""
    report = SeedReport()
    workspace = _workspace()
    now = clock.now()

    # ---- tenant and its settings
    if _insert_ignore(session, Tenant, {"id": uuid7(), "slug": DEMO_TENANT_SLUG, "name": workspace.org.name}, ["slug"]):
        report.created["tenants"] += 1
    tenant_id = session.scalar(select(Tenant.id).where(Tenant.slug == DEMO_TENANT_SLUG))
    report.tenant_id = tenant_id

    demo_settings = {
        "industry": workspace.org.industry,
        "timezone": workspace.org.timezone,
        "audit_retention_days": workspace.org.audit_retention_days,
        "require_mfa": workspace.policy.require_mfa,
        "enforce_sso": workspace.policy.enforce_sso,
        "session_timeout_hours": workspace.policy.session_timeout_hours,
    }
    if _insert_ignore(session, TenantSettings, {"tenant_id": tenant_id, **demo_settings}, ["tenant_id"]):
        report.created["settings"] += 1
    else:
        backfilled = [getattr(TenantSettings, k) == v for k, v in DEFAULT_SETTINGS.items()]
        replaced = session.execute(
            update(TenantSettings).where(TenantSettings.tenant_id == tenant_id, *backfilled).values(**demo_settings)
        )
        report.created["settings"] += replaced.rowcount

    # ---- roles and their permissions
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

    # ---- users and memberships (in the demo's order, so listings match it)
    user_ids: dict[str, uuid.UUID] = {}
    for member in _members():
        email = normalize_email(member.email)
        user = {"id": uuid7(), "public_id": member.id, "email": email, "full_name": member.name}
        if _insert_ignore(session, User, user, ["email"]):
            report.created["users"] += 1
        user_id = session.scalar(select(User.id).where(User.email == email))
        user_ids[member.id] = user_id
        if member.mfa == "enabled":
            session.execute(
                update(User).where(User.id == user_id, User.mfa_enrolled_at.is_(None)).values(mfa_enrolled_at=now)
            )
        membership = {
            "id": uuid7(),
            "tenant_id": tenant_id,
            "user_id": user_id,
            "role_id": role_ids[member.role],
            "membership_status": "invited" if member.status == "invited" else "active",
            "title": member.title,
            "joined_at": None if member.status == "invited" else now,
            "last_active_at": member.last_active_at,
            "last_active_ip": parse_ip(member.ip),
        }
        if _insert_ignore(session, TenantMembership, membership, ["tenant_id", "user_id"]):
            report.created["memberships"] += 1
        else:  # seeded before activity columns existed: fill them once, never overwrite
            session.execute(
                update(TenantMembership)
                .where(
                    TenantMembership.tenant_id == tenant_id,
                    TenantMembership.user_id == user_id,
                    TenantMembership.last_active_at.is_(None),
                )
                .values(last_active_at=member.last_active_at, last_active_ip=parse_ip(member.ip))
            )

    # ---- demo sessions (unusable: see module docstring)
    for demo in _sessions():
        values = {
            "id": uuid7(),
            "public_id": demo.id,
            "tenant_id": tenant_id,
            "user_id": user_ids[demo.member_id],
            "token_hash": _unusable_token_digest(),
            "created_at": demo.signed_in_at,
            "last_seen_at": demo.signed_in_at,
            "expires_at": now + DEMO_SESSION_LIFETIME,
            "device": demo.device,
            "ip": parse_ip(demo.ip),
            "location": demo.location,
        }
        if _insert_ignore(session, UserSession, values, ["public_id"]):
            report.created["sessions"] += 1

    # ---- demo API keys: unusable, like the demo sessions (digest of a discarded random secret)
    member_ids = {m.name: user_ids[m.id] for m in _members()}
    for demo_key in _keys():
        values = {
            "id": uuid7(),
            "public_id": demo_key.id,
            "tenant_id": tenant_id,
            "name": demo_key.name,
            "prefix": demo_key.prefix,
            "secret_hash": _unusable_token_digest(),
            "pepper_version": "seed",
            "scopes": list(demo_key.scopes),
            "created_by_user_id": member_ids.get(demo_key.created_by),
            "created_by_name": demo_key.created_by,
            "created_at": demo_key.created_at,
            "last_used_at": demo_key.last_used_at,
        }
        if _insert_ignore(session, ApiKey, values, ["public_id"]):
            report.created["api_keys"] += 1

    # ---- demo audit history (deterministic UUIDv7 ids)
    for entry in _audit():
        ip, label = split_client(entry.client)
        values = {
            "id": entry.id,
            "tenant_id": tenant_id,
            "occurred_at": entry.occurred_at,
            "action": entry.action,
            "actor_type": entry.actor_type,
            "actor_id": entry.actor_id,
            "actor_label": entry.actor_label,
            "resource_type": entry.resource_type,
            "resource_id": entry.resource_id,
            "summary": entry.summary,
            "ip_address": ip,
            "client_label": label,
            "event_metadata": entry.metadata,
        }
        if _insert_ignore(session, AuditEventRecord, values, ["id"]):
            report.created["audit_events"] += 1
    return report
