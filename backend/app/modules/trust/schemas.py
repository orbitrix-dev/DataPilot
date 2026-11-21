from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Severity = Literal["critical", "warning"]
IncidentStatus = Literal["investigating", "acknowledged", "resolved"]
FreshnessStatus = Literal["on-time", "stale", "breached"]


class HistoryEntry(BaseModel):
    at: datetime
    text: str


class Incident(BaseModel):
    id: str
    title: str
    severity: Severity
    status: IncidentStatus
    dataset: str
    first_detected_at: datetime
    summary: str
    business_cause: str
    history: list[HistoryEntry]


class ResolveIn(BaseModel):
    note: str | None = Field(default=None, max_length=500)


class Freshness(BaseModel):
    """Written by the quality engine; the API only reads it."""

    dataset: str
    sla_minutes: int
    last_updated_at: datetime
    status: FreshnessStatus
    connection_id: str | None = None


class DatasetIssue(BaseModel):
    dataset: str
    kind: Literal["incident", "freshness"]
    reference: str
    message: str


class DatasetStatus(BaseModel):
    dataset: str
    verified: bool
    issues: list[DatasetIssue]
