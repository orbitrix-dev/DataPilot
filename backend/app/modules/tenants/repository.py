from dataclasses import dataclass
from typing import Protocol

from app.core.repository import InMemoryTable, Table

from .schemas import ApiKeyRecord, Member, Session, Workspace


class TenantsRepository(Protocol):
    members: Table[Member]
    sessions: Table[Session]
    api_keys: Table[ApiKeyRecord]
    workspace: Table[Workspace]


@dataclass
class InMemoryTenantsRepository:
    members: InMemoryTable[Member]
    sessions: InMemoryTable[Session]
    api_keys: InMemoryTable[ApiKeyRecord]
    workspace: InMemoryTable[Workspace]

    @classmethod
    def seeded(cls, members: list[Member], sessions: list[Session], keys: list[ApiKeyRecord], workspace: Workspace):
        return cls(
            members=InMemoryTable("Member", lambda r: r.id, members),
            sessions=InMemoryTable("Session", lambda r: r.id, sessions),
            api_keys=InMemoryTable("API key", lambda r: r.id, keys),
            workspace=InMemoryTable("Workspace", lambda r: r.id, [workspace]),
        )
