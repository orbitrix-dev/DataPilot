"""Request authentication and authorization, as FastAPI dependencies.

Identity:
- ``Authorization: Bearer dp_live_…`` authenticates an API key (read-only, scope-checked). Keys are still kept in
  memory; the key's tenant is then resolved in PostgreSQL like any other.
- In dev/test only, ``X-DataPilot-Tenant`` / ``X-DataPilot-User`` pick a member (defaults: acme / u-elena). This is a
  development adapter, now resolved against PostgreSQL. Production has no user sign-in yet, so every
  non-API-key request is rejected outside dev.

Resolution order: tenant first (unknown or deleted → 401, suspended → 403), then the membership (only an active
membership of an active user is accepted; anything else → 401 "Unknown or inactive user").

Persistence boundary (transitional): ``TenantData.tenants`` (members, sessions, workspace settings, permission
matrix) is PostgreSQL-backed and bound to this request's transaction. API keys, Connect, Trust, Automate, Billing,
Notifications stay in the in-memory registry, keyed by tenant slug. The audit log is PostgreSQL-backed and written
in this request's transaction (``PostgresAuditRepository``): an event commits or rolls back with the change.

Client address: ``app/core/client_address.py`` (X-Forwarded-For only from ``DP_TRUSTED_PROXIES``).

Authorization follows the tenant's live permission matrix (Admin → Permissions).
"""

from dataclasses import replace
from typing import Annotated

from fastapi import Depends, Header, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import client_address, clock
from app.core.config import Settings, get_settings
from app.core.context import Principal, RequestContext
from app.core.db import DbSession
from app.core.errors import Forbidden, Unauthorized
from app.modules.audit.repository import PostgresAuditRepository
from app.modules.tenants import service as tenants
from app.modules.tenants.models import Tenant
from app.modules.tenants.pg_tables import PostgresTenantsRepository
from app.modules.tenants.schemas import CapabilityId
from app.tenant_data import Registry, TenantData


def get_registry(request: Request) -> Registry:
    return request.app.state.registry


def _resolve_tenant(db: Session, slug: str) -> Tenant:
    """Unknown and deleted tenants are indistinguishable (401); a suspended one is refused (403)."""
    tenant = db.scalar(select(Tenant).where(Tenant.slug == slug))
    if tenant is None or tenant.status == "deleted":
        raise Unauthorized(f"Unknown tenant {slug!r}")
    if tenant.status == "suspended":
        raise Forbidden("This workspace is suspended")
    return tenant


def _request_data(db: Session, registry: Registry, slug: str, tenant: Tenant) -> TenantData:
    """This request's view of the tenant: PostgreSQL-backed Tenants, everything else from the in-memory registry."""
    memory = registry.get(slug)
    if memory is None:
        # A tenant in the database without in-memory module data can't be served yet. Fail closed.
        raise Unauthorized(f"Unknown tenant {slug!r}")
    return replace(
        memory,
        tenants=PostgresTenantsRepository.bind(db, tenant.id, api_keys=memory.tenants.api_keys),
        audit=PostgresAuditRepository(db, tenant.id),
    )


def get_ctx(
    request: Request,
    db: DbSession,
    registry: Annotated[Registry, Depends(get_registry)],
    settings: Annotated[Settings, Depends(get_settings)],
    authorization: Annotated[str | None, Header()] = None,
    x_datapilot_tenant: Annotated[str | None, Header()] = None,
    x_datapilot_user: Annotated[str | None, Header()] = None,
) -> RequestContext:
    ip = client_address.resolve(
        request.client.host if request.client else None,
        request.headers.getlist("x-forwarded-for"),
        settings.trusted_proxy_networks,
    )

    if authorization and authorization.startswith("Bearer dp_live_"):
        secret = authorization.removeprefix("Bearer ")
        # Production: look the hash up in an indexed key table instead of scanning tenants.
        for slug, memory in registry.items():
            key = tenants.find_key_by_secret(memory.tenants.api_keys.list(), secret)
            if key:
                tenant = _resolve_tenant(db, slug)
                key.last_used_at = clock.now()
                memory.tenants.api_keys.put(key)
                principal = Principal(
                    kind="api_key", id=key.id, name=f"API key {key.name}", scopes=frozenset(key.scopes)
                )
                data = _request_data(db, registry, slug, tenant)
                return RequestContext(
                    tenant_id=slug,
                    principal=principal,
                    data=data,
                    ip=ip,
                    tenant_uuid=tenant.id,
                    environment=settings.env,
                )
        # Stage 3B records this with SecurityAuditWriter (an independent transaction), once rate limiting exists.
        raise Unauthorized("Invalid or revoked API key")

    if not settings.dev_auth_enabled:
        raise Unauthorized("Sign-in is not available yet: only API keys are accepted outside dev")

    slug = x_datapilot_tenant or settings.default_dev_tenant
    tenant = _resolve_tenant(db, slug)  # tenant status is checked before any membership lookup
    data = _request_data(db, registry, slug, tenant)
    member = data.tenants.members.find_active(x_datapilot_user or settings.default_dev_user)
    if member is None:
        raise Unauthorized("Unknown or inactive user")
    principal = Principal(kind="user", id=member.id, name=member.name, role=member.role)
    return RequestContext(
        tenant_id=slug, principal=principal, data=data, ip=ip, tenant_uuid=tenant.id, environment=settings.env
    )


Ctx = Annotated[RequestContext, Depends(get_ctx)]


def _level(ctx: RequestContext, cap: CapabilityId) -> str:
    assert ctx.principal.role is not None
    return tenants.workspace(ctx).matrix[cap][ctx.principal.role]


def scope(required: str, methods: tuple[str, ...] = ("GET",)):
    """Router-level gate. API keys may only call ``methods`` on modules their scopes cover."""

    def dep(request: Request, ctx: Ctx) -> None:
        if ctx.principal.kind != "api_key":
            return
        if request.method not in methods:
            raise Forbidden("API keys are read-only")
        if required not in ctx.principal.scopes:
            raise Forbidden(f"This API key lacks the {required} scope")

    return Depends(dep)


def can_read(cap: CapabilityId):
    """Any level except "None" may read. API keys were already checked by ``scope``."""

    def dep(ctx: Ctx) -> RequestContext:
        if ctx.principal.kind == "user" and _level(ctx, cap) == "None":
            raise Forbidden(f"Your role has no access to {cap}", capability=cap)
        return ctx

    return Depends(dep)


def need(cap: CapabilityId, *levels: str):
    """Requires one of ``levels`` for ``cap`` in the permission matrix."""

    def dep(ctx: Ctx) -> RequestContext:
        if ctx.principal.kind != "user":
            raise Forbidden("API keys are read-only")
        have = _level(ctx, cap)
        if have not in levels:
            raise Forbidden(
                f"Requires {' or '.join(levels)} on {cap}; your role has {have}",
                capability=cap,
                required=list(levels),
                current=have,
            )
        return ctx

    return Depends(dep)


def admins():
    """User, key, security and settings management: Organization Owner and Administrators."""

    def dep(ctx: Ctx) -> RequestContext:
        if ctx.principal.kind != "user" or ctx.principal.role not in ("owner", "admin"):
            raise Forbidden("Requires the Organization Owner or Administrator role")
        return ctx

    return Depends(dep)


def can_manage_billing(ctx: RequestContext) -> bool:
    return ctx.principal.kind == "user" and _level(ctx, "admin") == "Full"
