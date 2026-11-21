"""Audit storage: the interface services use, an in-memory implementation and the PostgreSQL implementation.

Append-only by design: there is ``append`` and ``search``, and deliberately nothing that updates or deletes.
(PostgreSQL enforces the same independently: see ``models.py``.)
"""

from __future__ import annotations

import ipaddress
import uuid
from collections.abc import Iterable
from dataclasses import dataclass, field, replace
from datetime import datetime
from typing import Any, Protocol

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from . import actions
from .models import AuditEventRecord
from .schemas import AuditEvent, AuditPage


@dataclass(frozen=True)
class AuditEntry:
    """One event to append, already validated and sanitised by ``service.record``."""

    id: uuid.UUID
    occurred_at: datetime
    action: str
    actor_type: str
    actor_id: str | None
    actor_label: str
    summary: str
    resource_type: str | None = None
    resource_id: str | None = None
    client: str = ""  # an IP address or a client label ("testclient"); split into ip_address/client_label on save
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_api(self) -> AuditEvent:
        definition = actions.get(self.action)
        target = self.resource_type if self.resource_id is None else f"{self.resource_type}:{self.resource_id}"
        return AuditEvent(
            id=str(self.id),
            type=definition.category,
            event=definition.label,
            actor=self.actor_label,
            detail=self.summary,
            ip=self.client,
            at=self.occurred_at,
            target=target,
        )


def split_client(client: str) -> tuple[ipaddress.IPv4Address | ipaddress.IPv6Address | None, str | None]:
    """(ip_address, client_label): a parseable IP goes to the INET column, anything else to the label."""
    if not client:
        return None, None
    try:
        return ipaddress.ip_address(client), None
    except ValueError:
        return None, client[:64]


class AuditRepository(Protocol):
    def append(self, entry: AuditEntry) -> None: ...
    def search(self, type: str | None, q: str | None, limit: int, offset: int) -> AuditPage: ...


def _matches(entry: AuditEntry, type: str | None, needle: str) -> bool:
    if type is not None and actions.get(entry.action).category != type:
        return False
    if not needle:
        return True
    label = actions.get(entry.action).label
    return any(needle in f.lower() for f in (entry.actor_label, label, entry.summary, entry.client))


class InMemoryAuditRepository:
    """For contexts without a database (e.g. comparing against the in-memory implementation in tests)."""

    def __init__(self, entries: Iterable[AuditEntry] = ()) -> None:
        self._entries: list[AuditEntry] = [replace(e) for e in entries]

    def append(self, entry: AuditEntry) -> None:
        self._entries.append(replace(entry))

    def search(self, type: str | None, q: str | None, limit: int, offset: int) -> AuditPage:
        needle = (q or "").strip().lower()
        rows = [e for e in self._entries if _matches(e, type, needle)]
        rows.sort(key=lambda e: e.occurred_at, reverse=True)  # stable: equal times keep insertion order
        return AuditPage(items=[e.to_api() for e in rows[offset : offset + limit]], total=len(rows))


def _like(needle: str) -> str:
    escaped = needle.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


class PostgresAuditRepository:
    """Bound to the request's session (so appends commit or roll back with the business change) and to one tenant
    (so searches can never return another tenant's events, nor global events)."""

    def __init__(self, session: Session, tenant_id: uuid.UUID) -> None:
        self._s = session
        self._tenant_id = tenant_id

    def append(self, entry: AuditEntry) -> None:
        self._s.add(to_record(entry, self._tenant_id))

    def search(self, type: str | None, q: str | None, limit: int, offset: int) -> AuditPage:
        query = select(AuditEventRecord).where(AuditEventRecord.tenant_id == self._tenant_id)
        if type is not None:
            query = query.where(AuditEventRecord.category == type)
        needle = (q or "").strip()
        if needle:
            pattern = _like(needle)
            conditions = [
                AuditEventRecord.actor_label.ilike(pattern, escape="\\"),
                AuditEventRecord.summary.ilike(pattern, escape="\\"),
                func.host(AuditEventRecord.ip_address).ilike(pattern, escape="\\"),
                AuditEventRecord.client_label.ilike(pattern, escape="\\"),
            ]
            matching_labels = actions.labels_matching(needle)
            if matching_labels:
                conditions.append(AuditEventRecord.action.in_(matching_labels))
            query = query.where(or_(*conditions))
        total = self._s.scalar(select(func.count()).select_from(query.subquery()))
        # Newest first; equal times in insertion order (ids are monotonic UUIDv7), as the in-memory log sorted.
        rows = self._s.scalars(
            query.order_by(AuditEventRecord.occurred_at.desc(), AuditEventRecord.id).limit(limit).offset(offset)
        )
        return AuditPage(items=[from_record(r).to_api() for r in rows], total=total or 0)


def to_record(entry: AuditEntry, tenant_id: uuid.UUID | None) -> AuditEventRecord:
    ip, label = split_client(entry.client)
    return AuditEventRecord(
        id=entry.id,
        tenant_id=tenant_id,
        occurred_at=entry.occurred_at,
        action=entry.action,
        actor_type=entry.actor_type,
        actor_id=entry.actor_id,
        actor_label=entry.actor_label,
        resource_type=entry.resource_type,
        resource_id=entry.resource_id,
        summary=entry.summary,
        ip_address=ip,
        client_label=label,
        event_metadata=entry.metadata,
    )


def from_record(r: AuditEventRecord) -> AuditEntry:
    return AuditEntry(
        id=r.id,
        occurred_at=r.occurred_at,
        action=r.action,
        actor_type=r.actor_type,
        actor_id=r.actor_id,
        actor_label=r.actor_label,
        summary=r.summary,
        resource_type=r.resource_type,
        resource_id=r.resource_id,
        client=str(r.ip_address) if r.ip_address is not None else (r.client_label or ""),
        metadata=dict(r.event_metadata or {}),
    )
