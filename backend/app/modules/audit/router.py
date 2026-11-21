from typing import Annotated

from fastapi import APIRouter, Query

from app.core.context import RequestContext
from app.deps import admins, scope

from . import service
from .schemas import AuditPage, AuditType

router = APIRouter(tags=["audit"], dependencies=[scope("admin")])


@router.get("/audit-events")
def search(
    type: AuditType | None = None,
    q: str | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
    ctx: RequestContext = admins(),
) -> AuditPage:
    """Newest first. Written only by services as a side effect of actions; there is no write endpoint."""
    return service.search(ctx, type, q, limit, offset)
