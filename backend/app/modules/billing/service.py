from app.core.context import RequestContext
from app.core.errors import Conflict
from app.modules.audit import service as audit
from app.modules.tenants import service as tenants

from .schemas import PLANS, Plan, PlanChangeIn, PlanChangeOut, SubscriptionOut, Usage


def _sub(ctx: RequestContext):
    return ctx.data.billing.subscription.get("subscription")


def get_subscription(ctx: RequestContext) -> SubscriptionOut:
    s = _sub(ctx)
    invoices = sorted(ctx.data.billing.invoices.list(), key=lambda i: i.date, reverse=True)
    return SubscriptionOut(
        plan=PLANS[s.plan], card_last4=s.card_last4, requested_plan=s.requested_plan, invoices=invoices
    )


def usage(ctx: RequestContext) -> Usage:
    """Sources and rows from Connect (metering at ingestion in production); seats from members incl. invitations."""
    connections = ctx.data.connect.connections.list()
    return Usage(
        plan=PLANS[_sub(ctx).plan],
        sources=sum(c.kind != "file" for c in connections),
        rows=sum(c.records for c in connections),
        storage_gb=_sub(ctx).storage_gb,
        seats=len(ctx.data.tenants.members.list()),
    )


def over_limits(u: Usage, plan: Plan) -> list[str]:
    out = []
    if u.seats > plan.seats:
        out.append(f"{u.seats} seats in use (plan allows {plan.seats})")
    if u.sources > plan.sources:
        out.append(f"{u.sources} connected sources (plan allows {plan.sources})")
    if u.rows > plan.rows:
        out.append(f"{u.rows:,} rows this cycle (plan allows {plan.rows:,})")
    if u.storage_gb > plan.storage_gb:
        out.append(f"{u.storage_gb} GB stored (plan allows {plan.storage_gb} GB)")
    return out


def change_plan(ctx: RequestContext, body: PlanChangeIn, can_manage_billing: bool) -> PlanChangeOut:
    """Applies the change for roles with billing rights; otherwise records a request to the Owner."""
    s = _sub(ctx)
    current, target = PLANS[s.plan], PLANS[body.plan]
    if target.id == current.id:
        raise Conflict(f"Already on {current.name}")
    if target.price_usd < current.price_usd and (blockers := over_limits(usage(ctx), target)):
        raise Conflict(f"Current usage doesn't fit {target.name}", blockers=blockers)
    if can_manage_billing:
        s.plan, s.requested_plan = target.id, None
        ctx.data.billing.subscription.put(s)
        audit.record(
            ctx,
            "billing.plan_changed",
            f"{current.name} → {target.name} (${target.price_usd:,} / month, prorated)",
            resource=("billing", None),
            metadata={"from_plan": current.id, "to_plan": target.id},
        )
        status = "changed"
    else:
        s.requested_plan = target.id
        ctx.data.billing.subscription.put(s)
        audit.record(
            ctx,
            "billing.plan_change_requested",
            f"Asked {tenants.owner(ctx).name} to move to {target.name}",
            resource=("billing", None),
            metadata={"to_plan": target.id},
        )
        status = "requested"
    return PlanChangeOut(status=status, subscription=get_subscription(ctx))
