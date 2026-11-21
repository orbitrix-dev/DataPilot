from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.modules.trust.schemas import DatasetIssue

WorkflowState = Literal["draft", "published", "paused"]
RequestStatus = Literal["pending", "approved", "rejected"]
RunOutcome = Literal["executed", "failed", "running", "rejected"]


class Workflow(BaseModel):
    id: str
    name: str
    state: WorkflowState
    version: int
    # Source dataset checked by the Trust gate before an action runs (None for schedule-only workflows).
    dataset: str | None
    trust_gate: bool
    # Who may approve, by job title. Shown, not enforced yet: approval is gated by the permission matrix.
    approver: Literal["finance", "owner", "ops"]


class ApprovalRequest(BaseModel):
    id: str
    workflow_id: str
    title: str
    detail: str
    queued_at: datetime
    matched: list[str]
    status: RequestStatus
    decided_by: str | None = None
    decided_at: datetime | None = None
    reason: str | None = None
    run_id: str | None = None


class ApprovalRequestOut(ApprovalRequest):
    trust: list[DatasetIssue] = Field(description="Open Trust issues on the workflow's source data, live.")


class Run(BaseModel):
    id: str
    workflow_id: str
    request_id: str | None
    outcome: RunOutcome
    approved_by: str
    at: datetime
    summary: str
    trust_warning: str | None = None


class ApproveIn(BaseModel):
    acknowledge_trust_warning: bool = Field(
        default=False, description="Required when the source data has open Trust issues; recorded in the audit log."
    )


class RejectIn(BaseModel):
    reason: str | None = Field(default=None, max_length=500)
