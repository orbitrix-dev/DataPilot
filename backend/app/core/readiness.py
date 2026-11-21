"""Production readiness: conditions under which the application must refuse to start with ``DP_ENV=prod``.

Checked at application startup (lifespan). Each blocker is derived from the actual code, not from a separately
maintained list or a configuration switch:
- audit retention is not enforced (``audit.retention.is_enforced()``);
- an action in the audit registry is production-enabled while its business state is memory-backed / transitional
  (memory-backed actions must stay disabled in production until their module is PostgreSQL-backed);
- sign-in abuse protection is not implemented (``auth.enforcement.abuse_protection_enforced()``);
- and, from the database: an active tenant requires MFA while MFA is not implemented
  (``auth.enforcement.mfa_enforced()``), or has ``enforce_sso`` set (SSO is not implemented). A stored security
  setting the code would silently ignore is a blocker, never a warning.
"""

from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import Database
from app.modules.audit import actions, retention
from app.modules.auth import enforcement
from app.modules.tenants.models import Tenant, TenantSettings


def production_blockers(registry: Iterable[actions.AuditAction] | None = None) -> list[str]:
    blockers = []
    if not retention.is_enforced():
        blockers.append(
            "Audit retention is not enforced: tenants' 90/365-day retention setting is stored but nothing purges "
            "expired events yet"
        )
    for action in registry if registry is not None else actions.ACTIONS.values():
        if action.production_enabled and (action.business_store != "postgres" or action.durability != "durable"):
            blockers.append(
                f"Audit action {action.code!r} is production-enabled but its business state is "
                f"{action.business_store}/{action.durability}"
            )
    if not enforcement.abuse_protection_enforced():
        blockers.append("Sign-in abuse protection (throttling, rate limits) is not implemented")
    return blockers


def tenant_blockers(session: Session) -> list[str]:
    """Blockers from tenants' stored security settings that the code can't honour yet."""
    rows = session.execute(
        select(Tenant.slug, TenantSettings.require_mfa, TenantSettings.enforce_sso)
        .join(TenantSettings, TenantSettings.tenant_id == Tenant.id)
        .where(Tenant.status != "deleted")
        .order_by(Tenant.slug)
    ).all()
    blockers = []
    for slug, require_mfa, enforce_sso in rows:
        if require_mfa and not enforcement.mfa_enforced():
            blockers.append(f"Tenant {slug!r} requires MFA, but MFA is not implemented")
        if enforce_sso:
            blockers.append(f"Tenant {slug!r} has enforce_sso set, but SSO is not implemented")
    return blockers


class ProductionNotReady(RuntimeError):
    pass


def assert_production_ready(database: Database | None, security_audit: object | None = None) -> None:
    blockers = production_blockers()
    if security_audit is None:
        blockers.append("No security audit writer: rejected sign-ins and API keys would not be recorded")
    if database is None:
        blockers.append("No database configured")
    else:
        with database.session() as session:
            blockers += tenant_blockers(session)
    if blockers:
        raise ProductionNotReady("Refusing to start with DP_ENV=prod:\n- " + "\n- ".join(blockers))
