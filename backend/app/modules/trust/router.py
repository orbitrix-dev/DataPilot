from fastapi import APIRouter

from app.core.context import RequestContext
from app.deps import can_read, need, scope

from . import service
from .schemas import DatasetStatus, Freshness, Incident, IncidentStatus, ResolveIn

router = APIRouter(prefix="/trust", tags=["trust"], dependencies=[scope("trust:read")])


@router.get("/incidents")
def list_incidents(status: IncidentStatus | None = None, ctx: RequestContext = can_read("trust")) -> list[Incident]:
    return service.list_incidents(ctx, status)


@router.get("/incidents/{incident_id}")
def get_incident(incident_id: str, ctx: RequestContext = can_read("trust")) -> Incident:
    return service.get_incident(ctx, incident_id)


@router.post("/incidents/{incident_id}/resolve")
def resolve_incident(incident_id: str, body: ResolveIn, ctx: RequestContext = need("trust", "Full")) -> Incident:
    return service.resolve_incident(ctx, incident_id, body)


@router.get("/freshness")
def list_freshness(ctx: RequestContext = can_read("trust")) -> list[Freshness]:
    return service.list_freshness(ctx)


@router.get("/datasets/{dataset}/status")
def dataset_status(dataset: str, ctx: RequestContext = can_read("trust")) -> DatasetStatus:
    """The Trust gate other services call before acting on a dataset."""
    return service.dataset_status(ctx, dataset)
