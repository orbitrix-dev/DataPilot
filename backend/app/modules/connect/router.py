from fastapi import APIRouter, status

from app.core.context import RequestContext
from app.deps import can_read, need, scope

from . import service
from .schemas import ConnectionOut, RotateIn, SyncQueued, SyncRun

router = APIRouter(prefix="/connect", tags=["connect"], dependencies=[scope("connect:read")])


@router.get("/connections")
def list_connections(ctx: RequestContext = can_read("connect")) -> list[ConnectionOut]:
    return service.list_connections(ctx)


@router.get("/connections/{connection_id}")
def get_connection(connection_id: str, ctx: RequestContext = can_read("connect")) -> ConnectionOut:
    return service.get_connection(ctx, connection_id)


@router.put("/connections/{connection_id}/credentials")
def rotate_credentials(
    connection_id: str, body: RotateIn, ctx: RequestContext = need("connect", "Full")
) -> ConnectionOut:
    return service.rotate_credentials(ctx, connection_id, body)


@router.post("/connections/{connection_id}/sync", status_code=status.HTTP_202_ACCEPTED)
def request_sync(connection_id: str, ctx: RequestContext = need("connect", "Full")) -> SyncQueued:
    return service.request_sync(ctx, connection_id)


@router.get("/sync-runs")
def list_runs(connection_id: str | None = None, ctx: RequestContext = can_read("connect")) -> list[SyncRun]:
    return service.list_runs(ctx, connection_id)
