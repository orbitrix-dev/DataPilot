"""Interfaces for the infrastructure in docs/ARCHITECTURE.md, with in-memory stand-ins.

- ``SecretStore``: Secrets Manager / KMS. Credentials go in, a reference comes out; nothing reads them back to clients.
- ``JobQueue``: Amazon SQS. Connector sync jobs and dataset events are published here for ingestion workers.
"""

from dataclasses import dataclass, field
from typing import Any, Protocol
from uuid import uuid4

from . import clock


class SecretStore(Protocol):
    def put(self, tenant_id: str, name: str, value: str) -> str: ...
    def exists(self, ref: str) -> bool: ...


class InMemorySecretStore:
    def __init__(self) -> None:
        self._secrets: dict[str, str] = {}

    def put(self, tenant_id: str, name: str, value: str) -> str:
        ref = f"secret://{tenant_id}/{name}/{uuid4().hex[:8]}"
        self._secrets[ref] = value
        return ref

    def exists(self, ref: str) -> bool:
        return ref in self._secrets


@dataclass
class Message:
    id: str
    topic: str
    tenant_id: str
    body: dict[str, Any]
    enqueued_at: Any = field(default_factory=clock.now)


class JobQueue(Protocol):
    def publish(self, topic: str, tenant_id: str, body: dict[str, Any]) -> Message: ...


class InMemoryQueue:
    """Keeps published messages so tests (and a future local worker) can inspect them."""

    def __init__(self) -> None:
        self.messages: list[Message] = []

    def publish(self, topic: str, tenant_id: str, body: dict[str, Any]) -> Message:
        msg = Message(id=f"msg_{uuid4().hex[:12]}", topic=topic, tenant_id=tenant_id, body=body)
        self.messages.append(msg)
        return msg
