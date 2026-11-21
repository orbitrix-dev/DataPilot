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


class CommitGatedAuditRepository:
    """Holds a request's audit events until its database transaction commits.

    The audit log is still in memory while member, role and settings changes are in PostgreSQL. Appending
    straight away would record "successful" events for changes that are then rolled back (a failed commit, or an
    error later in the request). Instead, ``append`` buffers; ``publish`` (called after COMMIT succeeds) moves the
    events into the real log; a rollback simply drops them with the request.

    This orders the two stores, it does not make them atomic: if the process died between COMMIT and
    ``publish``, committed changes would lack their events. A transactional audit table/outbox closes that gap
    in a later stage.
    """

    def __init__(self, target: AuditRepository) -> None:
        self._target = target
        self._pending: list[AuditEvent] = []

    def append(self, event: AuditEvent) -> None:
        self._pending.append(event.model_copy())

    def list(self) -> list[AuditEvent]:
        # Read-your-writes within the request; other requests only ever see published events.
        return self._target.list() + [e.model_copy() for e in self._pending]

    def publish(self) -> None:
        pending, self._pending = self._pending, []
        for event in pending:
            self._target.append(event)
