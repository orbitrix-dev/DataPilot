"""Request authentication and authorization, as FastAPI dependencies.

Identity:
- ``Authorization: Bearer dp_live_…`` authenticates an API key (read-only, scope-checked).
- In dev/test only, ``X-DataPilot-Tenant`` / ``X-DataPilot-User`` pick a seeded member
  (defaults: acme / u-elena). Production has no user login yet: SSO/JWT is the next step,
  and until then every non-API-key request is rejected outside dev.

Authorization follows the tenant's live permission matrix (Admin → Permissions).
"""

from typing import Annotated

from fastapi import Depends, Header, Request

from app.core import clock
from app.core.config import Settings, get_settings
from app.core.context import Principal, RequestContext
from app.core.errors import Forbidden, Unauthorized
from app.modules.tenants import service as tenants
from app.modules.tenants.schemas import CapabilityId
from app.tenant_data import Registry


def get_registry(request: Request) -> Registry:
    return request.app.state.registry


def get_ctx(
    request: Request,
    registry: Annotated[Registry, Depends(get_registry)],
    settings: Annotated[Settings, Depends(get_settings)],
    authorization: Annotated[str | None, Header()] = None,
    x_datapilot_tenant: Annotated[str | None, Header()] = None,
    x_datapilot_user: Annotated[str | None, Header()] = None,
) -> RequestContext:
    ip = request.client.host if request.client else "unknown"

    if authorization and authorization.startswith("Bearer dp_live_"):
        secret = authorization.removeprefix("Bearer ")
        # Production: look the hash up in an indexed key table instead of scanning tenants.
        for tenant_id, data in registry.items():
            key = tenants.find_key_by_secret(data.tenants.api_keys.list(), secret)
            if key:
                key.last_used_at = clock.now()
                data.tenants.api_keys.put(key)
                principal = Principal(
                    kind="api_key", id=key.id, name=f"API key {key.name}", scopes=frozenset(key.scopes)
                )
                return RequestContext(tenant_id=tenant_id, principal=principal, data=data, ip=ip)
        raise Unauthorized("Invalid or revoked API key")

    if not settings.dev_auth_enabled:
        raise Unauthorized("Sign-in is not available yet: only API keys are accepted outside dev")

    tenant_id = x_datapilot_tenant or settings.default_dev_tenant
    data = registry.get(tenant_id)
    if data is None:
        raise Unauthorized(f"Unknown tenant {tenant_id!r}")
    member = data.tenants.members.find(x_datapilot_user or settings.default_dev_user)
    if member is None or member.status != "active":
        raise Unauthorized("Unknown or inactive user")
    principal = Principal(kind="user", id=member.id, name=member.name, role=member.role)
    return RequestContext(tenant_id=tenant_id, principal=principal, data=data, ip=ip)


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
