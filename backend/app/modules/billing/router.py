from fastapi import APIRouter

from app.core.context import RequestContext
from app.deps import admins, can_manage_billing, scope

from . import service
from .schemas import PlanChangeIn, PlanChangeOut, SubscriptionOut, Usage

router = APIRouter(prefix="/billing", tags=["billing"], dependencies=[scope("admin")])


@router.get("/subscription")
def get_subscription(ctx: RequestContext = admins()) -> SubscriptionOut:
    return service.get_subscription(ctx)


@router.get("/usage")
def get_usage(ctx: RequestContext = admins()) -> Usage:
    return service.usage(ctx)


@router.post("/plan-change")
def change_plan(body: PlanChangeIn, ctx: RequestContext = admins()) -> PlanChangeOut:
    """Applied for roles with "Full" on Billing & workspace deletion; otherwise sent to the Owner as a request."""
    return service.change_plan(ctx, body, can_manage_billing(ctx))
