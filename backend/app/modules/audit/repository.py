from collections.abc import Iterable
from typing import Protocol

from .schemas import AuditEvent


class AuditRepository(Protocol):
    """Append-only: there is deliberately no update or delete."""

    def append(self, event: AuditEvent) -> None: ...
    def list(self) -> list[AuditEvent]: ...


class InMemoryAuditRepository:
    def __init__(self, events: Iterable[AuditEvent] = ()) -> None:
        self._events: list[AuditEvent] = [e.model_copy() for e in events]

    def append(self, event: AuditEvent) -> None:
        self._events.append(event.model_copy())

    def list(self) -> list[AuditEvent]:
        return [e.model_copy() for e in self._events]
