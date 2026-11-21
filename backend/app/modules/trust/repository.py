from dataclasses import dataclass
from typing import Protocol

from app.core.repository import InMemoryTable, Table

from .schemas import Freshness, Incident


class TrustRepository(Protocol):
    """Read model over the DataTrust engine's results (PostgreSQL in production)."""

    incidents: Table[Incident]
    freshness: Table[Freshness]


@dataclass
class InMemoryTrustRepository:
    incidents: InMemoryTable[Incident]
    freshness: InMemoryTable[Freshness]

    @classmethod
    def seeded(cls, incidents: list[Incident], freshness: list[Freshness]):
        return cls(
            incidents=InMemoryTable("Incident", lambda r: r.id, incidents),
            freshness=InMemoryTable("Dataset", lambda r: r.dataset, freshness),
        )
