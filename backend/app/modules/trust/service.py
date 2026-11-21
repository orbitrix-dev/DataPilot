from app.core import clock
from app.core.context import RequestContext
from app.core.errors import Conflict

from .schemas import DatasetIssue, DatasetStatus, Freshness, HistoryEntry, Incident, IncidentStatus, ResolveIn


def list_incidents(ctx: RequestContext, status: IncidentStatus | None = None) -> list[Incident]:
    rows = [i for i in ctx.data.trust.incidents.list() if status is None or i.status == status]
    return sorted(rows, key=lambda i: i.first_detected_at, reverse=True)


def get_incident(ctx: RequestContext, incident_id: str) -> Incident:
    return ctx.data.trust.incidents.get(incident_id)


def resolve_incident(ctx: RequestContext, incident_id: str, body: ResolveIn) -> Incident:
    repo = ctx.data.trust
    inc = repo.incidents.get(incident_id)
    if inc.status == "resolved":
        raise Conflict(f"{inc.id} is already resolved")
    inc.status = "resolved"
    text = f"Marked resolved by {ctx.principal.name}" + (f": {body.note}" if body.note else "")
    inc.history.append(HistoryEntry(at=clock.now(), text=text))
    repo.incidents.put(inc)
    return inc


def list_freshness(ctx: RequestContext) -> list[Freshness]:
    return ctx.data.trust.freshness.list()


def dataset_status(ctx: RequestContext, dataset: str) -> DatasetStatus:
    """The Trust gate used by Automate, Insights and Intelligence: is this dataset safe to act on?"""
    issues = [
        DatasetIssue(dataset=dataset, kind="incident", reference=i.id, message=f"{i.id}: {i.title}")
        for i in ctx.data.trust.incidents.list()
        if i.dataset == dataset and i.status != "resolved"
    ]
    f = ctx.data.trust.freshness.find(dataset)
    if f and f.status != "on-time":
        issues.append(
            DatasetIssue(
                dataset=dataset,
                kind="freshness",
                reference=dataset,
                message=f"{dataset} is {f.status} (SLA every {f.sla_minutes} min)",
            )
        )
    return DatasetStatus(dataset=dataset, verified=not issues, issues=issues)
