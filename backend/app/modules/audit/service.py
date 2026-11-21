from typing import Any

from app.core import clock
from app.core.context import RequestContext
from app.core.errors import ServiceUnavailable
from app.db.base import uuid7

from . import actions
from .repository import AuditEntry
from .sanitize import clean_metadata, redact
from .schemas import AuditPage, AuditType


def record(
    ctx: RequestContext,
    action: str,
    summary: str,
    *,
    resource: tuple[str, str | None] | None = None,
    metadata: dict[str, Any] | None = None,
) -> AuditEntry:
    """Records ``action`` for the current request. Called by services after the state change they describe.

    The actor, tenant and client address come from the authenticated request context, never from client input.
    With a PostgreSQL-backed context the event is written in the request's own transaction: it commits or rolls back
    with the change. Metadata must match the action's allowlist (ValueError otherwise); text is redacted.
    """
    definition = actions.get(action)
    if ctx.environment == "prod" and not definition.production_enabled:
        raise ServiceUnavailable(
            f"{definition.label} is not available in production yet", action=action, reason="not production-enabled"
        )
    resource_type, resource_id = resource if resource is not None else (None, None)
    entry = AuditEntry(
        id=uuid7(),
        occurred_at=clock.now(),
        action=definition.code,
        actor_type=ctx.principal.kind,
        actor_id=ctx.principal.id,
        actor_label=ctx.principal.name,
        summary=redact(summary),
        resource_type=resource_type,
        resource_id=redact(resource_id) if resource_id is not None else None,
        client=ctx.ip,
        metadata=clean_metadata(definition, metadata),
    )
    ctx.data.audit.append(entry)
    return entry


def search(ctx: RequestContext, type: AuditType | None, q: str | None, limit: int, offset: int) -> AuditPage:
    """Newest first, for the request's tenant only (global events are never included)."""
    return ctx.data.audit.search(type, q, limit, offset)
