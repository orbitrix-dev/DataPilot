from datetime import datetime
from typing import Literal

from pydantic import BaseModel

AuditType = Literal["login", "permission", "user", "api-key", "connection", "workflow", "settings", "billing"]


class AuditEvent(BaseModel):
    """One immutable audit entry. Written by the service that performed the action."""

    id: str
    type: AuditType
    event: str
    actor: str
    detail: str
    ip: str
    at: datetime
    target: str | None = None


class AuditPage(BaseModel):
    items: list[AuditEvent]
    total: int
