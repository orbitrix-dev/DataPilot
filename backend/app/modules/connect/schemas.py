from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

ConnectionStatus = Literal["healthy", "latency", "failed", "verified"]
ConnectionKind = Literal["database", "cloud", "file"]


class Connection(BaseModel):
    id: str
    name: str
    endpoint: str
    source_type: str
    kind: ConnectionKind
    status: ConnectionStatus
    records: int
    last_sync_at: datetime
    access_level: str
    issue: str | None = None
    # Reference into the secret store. Never contains the secret itself.
    credential_ref: str | None = None
    credentials_rotated_at: datetime | None = None
    credentials_rotated_by: str | None = None


class ConnectionOut(BaseModel):
    id: str
    name: str
    endpoint: str
    source_type: str
    kind: ConnectionKind
    status: ConnectionStatus
    records: int
    last_sync_at: datetime
    access_level: str
    issue: str | None
    has_credentials: bool
    credentials_rotated_at: datetime | None
    credentials_rotated_by: str | None


class RotateIn(BaseModel):
    secret: str = Field(min_length=1, description="New password, token or secret key. Stored in the secret store only.")


class SyncRun(BaseModel):
    id: str
    connection_id: str
    status: Literal["queued", "succeeded", "failed", "partial"]
    status_label: str | None = None
    records: int
    duration_seconds: int
    at: datetime
    trigger: Literal["Scheduled", "Manual"]


class SyncQueued(BaseModel):
    run: SyncRun
    message_id: str
