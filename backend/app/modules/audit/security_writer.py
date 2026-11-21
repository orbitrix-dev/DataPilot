"""Security events that must be recorded even when the request that triggered them fails.

A rejected API key or a failed sign-in ends in an error response, so the request's own transaction rolls back and
would take an in-transaction audit event with it. ``SecurityAuditWriter`` writes such events in an **independent
transaction** on its **own small connection pool** (so it can't deadlock waiting for a connection the request
holds) and commits immediately. It never raises: if the database is unavailable the failure is logged (without
the event's contents) and the caller's response is unaffected.

Wired into request paths in Stage 3B.2 (``app/modules/auth/security_events.py``).

**Failures are observable, never silent.** ``record`` returns False on failure, logs an ERROR (action code and
exception class only), and updates bounded counters exposed by ``health()``: total writes and failures, consecutive
failures, and when the last success and failure happened. ``health()["state"]`` is ``unknown`` until the first write
(never having persisted anything proves nothing), ``degraded`` while the most recent write failed, and ``healthy``
only after a successful write with no failure since. ``GET /healthz/security-audit`` answers 200 only when healthy,
503 otherwise, so monitoring can alert on it. The health check itself never touches the database. Nothing is queued
or retried in memory: an event that failed to persist is lost, and the counters say so.
"""

import logging
import threading
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core import clock
from app.db.base import uuid7

from . import actions
from .repository import AuditEntry, to_record
from .sanitize import clean_metadata, redact

log = logging.getLogger(__name__)


class SecurityAuditWriter:
    def __init__(self, url: str, *, pool_size: int = 2, timeout_seconds: float = 2) -> None:
        self._engine = create_engine(
            url,
            pool_size=pool_size,
            max_overflow=0,
            pool_timeout=timeout_seconds,
            pool_pre_ping=True,
            hide_parameters=True,  # never echo bound values (event contents) into exception messages or logs
            connect_args={
                "application_name": "datapilot-security-audit",
                "connect_timeout": max(1, int(timeout_seconds)),
                "options": f"-c statement_timeout={int(timeout_seconds * 1000)} -c TimeZone=UTC",
            },
        )
        self._sessions = sessionmaker(self._engine, expire_on_commit=False)
        self._lock = threading.Lock()  # requests run in a thread pool
        self._written = 0
        self._failed = 0
        self._consecutive_failures = 0
        self._last_success_at: datetime | None = None
        self._last_failure_at: datetime | None = None

    def record(
        self,
        action: str,
        summary: str,
        *,
        tenant_id: uuid.UUID | None = None,
        actor_type: str = "anonymous",
        actor_id: str | None = None,
        actor_label: str = "Anonymous",
        client: str = "",
        resource: tuple[str, str | None] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> bool:
        """Writes and commits one event in its own transaction. Returns False (and logs) instead of raising."""
        definition = actions.get(action)  # programming errors (unknown action, bad metadata) still raise
        resource_type, resource_id = resource if resource is not None else (None, None)
        entry = AuditEntry(
            id=uuid7(),
            occurred_at=clock.now(),
            action=definition.code,
            actor_type=actor_type,
            actor_id=actor_id,
            actor_label=redact(actor_label),
            summary=redact(summary),
            resource_type=resource_type,
            resource_id=redact(resource_id) if resource_id is not None else None,
            client=redact(client),
            metadata=clean_metadata(definition, metadata),
        )
        try:
            with self._sessions() as session, session.begin():
                session.add(to_record(entry, tenant_id))
        except Exception as exc:  # noqa: BLE001 - security logging must never break the caller
            with self._lock:
                self._failed += 1
                self._consecutive_failures += 1
                self._last_failure_at = clock.now()
                consecutive = self._consecutive_failures
            log.error(
                "Could not write security audit event %s (%s); consecutive failures: %d",
                definition.code,
                type(exc).__name__,
                consecutive,
            )
            return False
        with self._lock:
            self._written += 1
            self._consecutive_failures = 0
            self._last_success_at = clock.now()
        return True

    def health(self) -> dict[str, Any]:
        """Counters for monitoring, read under the lock so they are consistent with each other.

        ``state``: ``degraded`` while the most recent write failed; ``unknown`` before any write (no evidence either
        way); ``healthy`` once a write succeeded with no failure since. ``healthy`` is ``state == "healthy"``."""
        with self._lock:
            if self._consecutive_failures > 0:
                state = "degraded"
            elif self._written == 0:
                state = "unknown"
            else:
                state = "healthy"
            return {
                "healthy": state == "healthy",
                "state": state,
                "events_written": self._written,
                "events_failed": self._failed,
                "consecutive_failures": self._consecutive_failures,
                "last_success_at": self._last_success_at.isoformat() if self._last_success_at else None,
                "last_failure_at": self._last_failure_at.isoformat() if self._last_failure_at else None,
            }

    def dispose(self) -> None:
        self._engine.dispose()
