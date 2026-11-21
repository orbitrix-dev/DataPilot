from fastapi import APIRouter

from app.core.context import RequestContext
from app.deps import can_read, need, scope

from . import service
from .schemas import ApprovalRequestOut, ApproveIn, RejectIn, RequestStatus, Run, Workflow

router = APIRouter(prefix="/automate", tags=["automate"], dependencies=[scope("automate:read")])


@router.get("/workflows")
def list_workflows(ctx: RequestContext = can_read("automate")) -> list[Workflow]:
    return service.list_workflows(ctx)


@router.get("/approvals")
def list_requests(
    status: RequestStatus | None = None, ctx: RequestContext = can_read("automate")
) -> list[ApprovalRequestOut]:
    return service.list_requests(ctx, status)


@router.post("/approvals/{request_id}/approve")
def approve(request_id: str, body: ApproveIn, ctx: RequestContext = need("automate", "Approve")) -> ApprovalRequestOut:
    """409 with ``details.issues`` while the source data has open Trust issues, unless acknowledged."""
    return service.approve(ctx, request_id, body)


@router.post("/approvals/{request_id}/reject")
def reject(request_id: str, body: RejectIn, ctx: RequestContext = need("automate", "Approve")) -> ApprovalRequestOut:
    return service.reject(ctx, request_id, body)


@router.get("/runs")
def list_runs(ctx: RequestContext = can_read("automate")) -> list[Run]:
    return service.list_runs(ctx)
