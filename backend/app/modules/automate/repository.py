from dataclasses import dataclass
from typing import Protocol

from app.core.repository import InMemoryTable, Table

from .schemas import ApprovalRequest, Run, Workflow


class AutomateRepository(Protocol):
    workflows: Table[Workflow]
    requests: Table[ApprovalRequest]
    runs: Table[Run]


@dataclass
class InMemoryAutomateRepository:
    workflows: InMemoryTable[Workflow]
    requests: InMemoryTable[ApprovalRequest]
    runs: InMemoryTable[Run]

    @classmethod
    def seeded(cls, workflows: list[Workflow], requests: list[ApprovalRequest], runs: list[Run]):
        return cls(
            workflows=InMemoryTable("Workflow", lambda r: r.id, workflows),
            requests=InMemoryTable("Approval request", lambda r: r.id, requests),
            runs=InMemoryTable("Run", lambda r: r.id, runs),
        )
