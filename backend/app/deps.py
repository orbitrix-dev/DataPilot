"""Request authentication and authorization, as FastAPI dependencies.

Identity:
- ``Authorization: Bearer dp_live_…`` authenticates an API key (read-only, scope-checked): an indexed lookup of its
  HMAC digest in PostgreSQL; revoked, expired and unknown keys all get the same 401.
- ``Authorization: Bearer <access token>`` authenticates a signed-in user: the JWT is verified (signature, kid,
  issuer, audience, expiry) and the session it names is re-checked in PostgreSQL on every request (not revoked, not
  expired, not idle beyond the tenant's timeout; membership, user and tenant still active). See app/modules/auth.
- In dev/test only, and only when no Authorization header is sent, ``X-DataPilot-Tenant`` / ``X-DataPilot-User`` pick
  a member (defaults: acme / u-elena): a development adapter resolved against PostgreSQL. Production requires one of
  the two credentials above.

Resolution order: tenant first (unknown or deleted → 401, suspended → 403), then the membership (only an active
membership of an active user is accepted; anything else → 401 "Unknown or inactive user").

Persistence boundary (transitional): ``TenantData.tenants`` (members, sessions, API keys, workspace settings,
permission matrix) is PostgreSQL-backed and bound to this request's transaction. Connect, Trust, Automate, Billing,
Notifications stay in the in-memory registry, keyed by tenant slug. The audit log is PostgreSQL-backed and written
in this request's transaction (``PostgresAuditRepository``): an event commits or rolls back with the change.

Client address: ``app/core/client_address.py`` (X-Forwarded-For only from ``DP_TRUSTED_PROXIES``).

Authorization follows the tenant's live permission matrix (Admin → Permissions).
"""

from collections.abc import Callable
from dataclasses import replace
from datetime import timedelta
from typing import Annotated

from fastapi import Depends, Header, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import client_address, clock
from app.core.config import Settings, get_settings
from app.core.context import Principal, RequestContext
from app.core.db import DbSession
from app.core.errors import Forbidden, ServiceUnavailable, Unauthorized
from app.core.security import Keyring, api_key_digest
from app.modules.audit.repository import PostgresAuditRepository
from app.modules.auth import security_events
from app.modules.auth import service as auth_service
from app.modules.tenants import service as tenants
from app.modules.tenants.models import ApiKey, Tenant
from app.modules.tenants.pg_tables import PostgresTenantsRepository
from app.modules.tenants.schemas import CapabilityId
from app.tenant_data import Registry, TenantData


def get_registry(request: Request) -> Registry:
    return request.app.state.registry


def _resolve_tenant(db: Session, slug: str) -> Tenant:
    """Unknown and deleted tenants are indistinguishable (401); a suspended one is refused (403)."""
    return _check_tenant(db.scalar(select(Tenant).where(Tenant.slug == slug)), slug)


def _check_tenant(tenant: Tenant | None, slug: str) -> Tenant:
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
        tenants=PostgresTenantsRepository.bind(db, tenant.id),
        audit=PostgresAuditRepository(db, tenant.id),
    )


API_KEY_LAST_USED_RESOLUTION = timedelta(minutes=1)  # last_used_at is written at most once a minute per key
INVALID_API_KEY = "Invalid or revoked API key"  # the same answer for unknown, revoked and expired keys


def _api_key_keyring(settings: Settings) -> Keyring | None:
    try:
        return Keyring.from_settings(settings.api_key_peppers, settings.api_key_pepper_version, "API key pepper")
    except ServiceUnavailable:
        return None


def _authenticate_api_key(
    db: Session, keyring: Keyring, secret: str, on_reject: Callable[[ApiKey | None, Tenant | None], None]
) -> tuple[ApiKey, Tenant]:
    """Indexed lookup by digest under every configured pepper version. The digest must match the version recorded on
    the key. Revoked, expired and unknown keys are indistinguishable to the caller. ``on_reject`` is called (with the
    key and tenant when known) before refusing, so the rejection can be recorded outside the request transaction."""
    digests = {api_key_digest(secret, pepper): version for version, pepper in keyring.keys.items()}
    row = db.execute(
        select(ApiKey, Tenant).join(Tenant, Tenant.id == ApiKey.tenant_id).where(ApiKey.secret_hash.in_(digests))
    ).first()
    if row is None:
        on_reject(None, None)
        raise Unauthorized(INVALID_API_KEY)
    key, tenant = row
    now = clock.now()
    if (
        digests[key.secret_hash] != key.pepper_version
        or key.revoked_at is not None
        or (key.expires_at is not None and key.expires_at <= now)
    ):
        on_reject(key, tenant)
        raise Unauthorized(INVALID_API_KEY)
    _check_tenant(tenant, tenant.slug)
    if key.pepper_version != keyring.active:  # pepper rotation: re-hash under the active version while we have it
        key.secret_hash = api_key_digest(secret, keyring.active_secret)
        key.pepper_version = keyring.active
    if key.last_used_at is None or now - key.last_used_at >= API_KEY_LAST_USED_RESOLUTION:
        key.last_used_at = now
    return key, tenant


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

    keyring = _api_key_keyring(settings)
    if authorization and authorization.startswith("Bearer dp_live_"):
        if keyring is None:
            raise ServiceUnavailable("API keys are not configured")
        # Rejected keys are recorded by SecurityAuditWriter (an independent transaction); 3B.3 rate-limits them.
        writer = security_events.writer_for(request)

        def on_reject(key: ApiKey | None, tenant: Tenant | None) -> None:
            security_events.record_rejection(
                writer,
                "api-key.rejected",
                "invalid_key",
                client=ip,
                actor_type="api_key",
                actor_id=key.public_id if key is not None else None,
                actor_label=f"API key {key.name}" if key is not None else None,
                tenant_id=tenant.id if tenant is not None else None,
            )

        key, tenant = _authenticate_api_key(db, keyring, authorization.removeprefix("Bearer "), on_reject)
        principal = Principal(
            kind="api_key", id=key.public_id, name=f"API key {key.name}", scopes=frozenset(key.scopes)
        )
        return RequestContext(
            tenant_id=tenant.slug,
            principal=principal,
            data=_request_data(db, registry, tenant.slug, tenant),
            ip=ip,
            tenant_uuid=tenant.id,
            environment=settings.env,
            api_key_keyring=keyring,
        )

    if authorization:
        # A session access token (JWT). With an Authorization header present, dev headers are never consulted.
        if not authorization.startswith("Bearer "):
            raise Unauthorized("Unsupported authorization scheme")
        authenticated = auth_service.authenticate_access_token(
            db, settings, authorization.removeprefix("Bearer "), client=ip
        )
        tenant = authenticated.tenant
        principal = Principal(
            kind="user",
            id=authenticated.user.public_id,
            name=authenticated.user.full_name,
            role=authenticated.role_key,
        )
        return RequestContext(
            tenant_id=tenant.slug,
            principal=principal,
            data=_request_data(db, registry, tenant.slug, tenant),
            ip=ip,
            tenant_uuid=tenant.id,
            environment=settings.env,
            api_key_keyring=keyring,
        )

    if not settings.dev_auth_enabled:
        raise Unauthorized("Authentication required")

    slug = x_datapilot_tenant or settings.default_dev_tenant
    tenant = _resolve_tenant(db, slug)  # tenant status is checked before any membership lookup
    data = _request_data(db, registry, slug, tenant)
    member = data.tenants.members.find_active(x_datapilot_user or settings.default_dev_user)
    if member is None:
        raise Unauthorized("Unknown or inactive user")
    principal = Principal(kind="user", id=member.id, name=member.name, role=member.role)
    return RequestContext(
        tenant_id=slug,
        principal=principal,
        data=data,
        ip=ip,
        tenant_uuid=tenant.id,
        environment=settings.env,
        api_key_keyring=keyring,
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
