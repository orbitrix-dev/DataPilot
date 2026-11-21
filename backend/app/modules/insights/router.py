"""Insights and Reports: contract only. Port the logic from src/features/insights/data.ts next."""

from fastapi import APIRouter

from app.core.context import RequestContext
from app.core.errors import NotImplementedYet
from app.deps import can_read, scope

router = APIRouter(prefix="/insights", tags=["insights"], dependencies=[scope("insights:read")])

PENDING = "Insights is not implemented in the backend yet; the front end still uses its mock data"


@router.get("/dashboard")
def dashboard(ctx: RequestContext = can_read("insights")) -> None:
    raise NotImplementedYet(PENDING)


@router.get("/metrics/{metric}")
def metric(metric: str, by: str | None = None, ctx: RequestContext = can_read("insights")) -> None:
    raise NotImplementedYet(PENDING)


@router.get("/reports")
def reports(ctx: RequestContext = can_read("insights")) -> None:
    raise NotImplementedYet(PENDING)


@router.get("/reports/{report_id}")
def report(report_id: str, ctx: RequestContext = can_read("insights")) -> None:
    raise NotImplementedYet(PENDING)
