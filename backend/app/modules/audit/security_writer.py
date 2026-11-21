"""Security events that must be recorded even when the request that triggered them fails.

A rejected API key or a failed sign-in ends in an error response, so the request's own transaction rolls back and
would take an in-transaction audit event with it. ``SecurityAuditWriter`` writes such events in an **independent
transaction** on its **own small connection pool** (so it can't deadlock waiting for a connection the request
holds) and commits immediately. It never raises: if the database is unavailable the failure is logged (without
the event's contents) and the caller's response is unaffected.

Built and tested in Stage 3A.1 but deliberately **not wired into any request path**: Stage 3B connects it to
rejected API keys and failed sign-ins, together with rate limiting, so unauthenticated floods can't fill the log.
"""

import logging
import uuid
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
            connect_args={
                "application_name": "datapilot-security-audit",
                "connect_timeout": max(1, int(timeout_seconds)),
                "options": f"-c statement_timeout={int(timeout_seconds * 1000)} -c TimeZone=UTC",
            },
        )
        self._sessions = sessionmaker(self._engine, expire_on_commit=False)

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
            actor_label=actor_label,
            summary=redact(summary),
            resource_type=resource_type,
            resource_id=redact(resource_id) if resource_id is not None else None,
            client=client,
            metadata=clean_metadata(definition, metadata),
        )
        try:
            with self._sessions() as session, session.begin():
                session.add(to_record(entry, tenant_id))
        except Exception as exc:  # noqa: BLE001 - security logging must never break the caller
            log.error("Could not write security audit event %s (%s)", definition.code, type(exc).__name__)
            return False
        return True

    def dispose(self) -> None:
        self._engine.dispose()
