from uuid import uuid4

from app.core import clock
from app.core.context import RequestContext

from .schemas import AuditEvent, AuditPage, AuditType


def record(ctx: RequestContext, type: AuditType, event: str, detail: str, target: str | None = None) -> AuditEvent:
    """Called by every service after a state change. The actor and IP come from the request."""
    e = AuditEvent(
        id=f"evt_{uuid4().hex[:16]}",
        type=type,
        event=event,
        actor=ctx.principal.name,
        detail=detail,
        ip=ctx.ip,
        at=clock.now(),
        target=target,
    )
    ctx.data.audit.append(e)
    return e


def search(ctx: RequestContext, type: AuditType | None, q: str | None, limit: int, offset: int) -> AuditPage:
    needle = (q or "").strip().lower()
    rows = [
        e
        for e in ctx.data.audit.list()
        if (type is None or e.type == type)
        and (not needle or any(needle in f.lower() for f in (e.actor, e.event, e.detail, e.ip)))
    ]
    rows.sort(key=lambda e: e.at, reverse=True)
    return AuditPage(items=rows[offset : offset + limit], total=len(rows))
