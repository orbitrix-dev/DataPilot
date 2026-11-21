from app.core import clock
from app.core.context import RequestContext
from app.core.errors import Conflict
from app.modules.audit import service as audit
from app.modules.trust import service as trust
from app.modules.trust.schemas import DatasetIssue

from .schemas import ApprovalRequest, ApprovalRequestOut, ApproveIn, RejectIn, RequestStatus, Run, Workflow

ACTION_TOPIC = "automate.actions"


def list_workflows(ctx: RequestContext) -> list[Workflow]:
    return ctx.data.automate.workflows.list()


def _trust_issues(ctx: RequestContext, wf: Workflow) -> list[DatasetIssue]:
    if not wf.dataset:
        return []
    return trust.dataset_status(ctx, wf.dataset).issues


def _out(ctx: RequestContext, r: ApprovalRequest) -> ApprovalRequestOut:
    wf = ctx.data.automate.workflows.get(r.workflow_id)
    issues = _trust_issues(ctx, wf) if r.status == "pending" else []
    return ApprovalRequestOut(**r.model_dump(), trust=issues)


def list_requests(ctx: RequestContext, status: RequestStatus | None = None) -> list[ApprovalRequestOut]:
    rows = [r for r in ctx.data.automate.requests.list() if status is None or r.status == status]
    return [_out(ctx, r) for r in sorted(rows, key=lambda r: r.queued_at, reverse=True)]


def _pending(ctx: RequestContext, request_id: str) -> ApprovalRequest:
    r = ctx.data.automate.requests.get(request_id)
    if r.status != "pending":
        raise Conflict(f"{r.id} was already {r.status}")
    return r


def _next_run_id(ctx: RequestContext) -> str:
    ids = [int(r.id.split("-")[1]) for r in ctx.data.automate.runs.list() if r.id.startswith("RUN-")]
    return f"RUN-{max(ids, default=8800) + 1}"


def approve(ctx: RequestContext, request_id: str, body: ApproveIn) -> ApprovalRequestOut:
    repo = ctx.data.automate
    r = _pending(ctx, request_id)
    wf = repo.workflows.get(r.workflow_id)
    issues = _trust_issues(ctx, wf)
    if issues and not body.acknowledge_trust_warning:
        raise Conflict(
            "The source data has open Trust issues. Review them, then approve with acknowledge_trust_warning=true.",
            issues=[i.model_dump() for i in issues],
        )
    warning = "; ".join(i.message for i in issues) or None
    now = clock.now()
    run = Run(
        id=_next_run_id(ctx),
        workflow_id=wf.id,
        request_id=r.id,
        outcome="running",
        approved_by=ctx.principal.name,
        at=now,
        summary=r.title,
        trust_warning=warning,
    )
    repo.runs.put(run)
    r.status, r.decided_by, r.decided_at, r.run_id = "approved", ctx.principal.name, now, run.id
    repo.requests.put(r)
    # Workers execute the action (email, Slack, task) and report back; nothing runs inside the API.
    ctx.data.queue.publish(ACTION_TOPIC, ctx.tenant_id, {"run_id": run.id, "request_id": r.id, "workflow_id": wf.id})
    detail = f"Approved {r.id} for {run.id} ({wf.name})" + (
        f". Trust warning acknowledged: {warning}" if warning else ""
    )
    audit.record(
        ctx,
        "workflow.approved",
        detail,
        resource=("run", run.id),
        metadata={"request_id": r.id, "run_id": run.id, "acknowledged_issues": [i.reference for i in issues]},
    )
    return _out(ctx, r)


def reject(ctx: RequestContext, request_id: str, body: RejectIn) -> ApprovalRequestOut:
    repo = ctx.data.automate
    r = _pending(ctx, request_id)
    wf = repo.workflows.get(r.workflow_id)
    reason = (body.reason or "").strip() or None
    r.status, r.decided_by, r.decided_at, r.reason = "rejected", ctx.principal.name, clock.now(), reason
    repo.requests.put(r)
    audit.record(
        ctx,
        "workflow.rejected",
        f"Rejected {r.id} ({wf.name})" + (f": “{reason}”" if reason else ""),
        resource=("request", r.id),
        metadata={"request_id": r.id, "reason": reason or ""},
    )
    return _out(ctx, r)


def list_runs(ctx: RequestContext) -> list[Run]:
    return sorted(ctx.data.automate.runs.list(), key=lambda r: r.at, reverse=True)
