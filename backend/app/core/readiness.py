"""Production readiness: conditions under which the application must refuse to start with ``DP_ENV=prod``.

Checked at application startup (lifespan). Each blocker is derived from the actual code, not from a separately
maintained list or a configuration switch:
- audit retention is not enforced (``audit.retention.is_enforced()``);
- an action in the audit registry is production-enabled while its business state is memory-backed / transitional
  (memory-backed actions must stay disabled in production until their module is PostgreSQL-backed).
"""

from collections.abc import Iterable

from app.modules.audit import actions, retention


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
    return blockers


class ProductionNotReady(RuntimeError):
    pass


def assert_production_ready() -> None:
    blockers = production_blockers()
    if blockers:
        raise ProductionNotReady("Refusing to start with DP_ENV=prod:\n- " + "\n- ".join(blockers))
