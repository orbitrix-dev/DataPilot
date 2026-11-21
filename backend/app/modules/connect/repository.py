from dataclasses import dataclass
from typing import Protocol

from app.core.repository import InMemoryTable, Table

from .schemas import Connection, SyncRun


class ConnectRepository(Protocol):
    connections: Table[Connection]
    runs: Table[SyncRun]


@dataclass
class InMemoryConnectRepository:
    connections: InMemoryTable[Connection]
    runs: InMemoryTable[SyncRun]

    @classmethod
    def seeded(cls, connections: list[Connection], runs: list[SyncRun]):
        return cls(
            connections=InMemoryTable("Connection", lambda r: r.id, connections),
            runs=InMemoryTable("Sync run", lambda r: r.id, runs),
        )
