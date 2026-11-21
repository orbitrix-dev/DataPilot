"""Storage interfaces and the in-memory implementation every module uses for now.

Each module declares its repository as a ``Protocol`` made of ``Table``s (the
interface services depend on). ``InMemoryTable`` implements ``Table``; a
PostgreSQL implementation replaces it without touching the services.
"""

from collections.abc import Callable, Iterable
from typing import Protocol

from pydantic import BaseModel

from .errors import NotFound


class Table[T: BaseModel](Protocol):
    def list(self) -> list[T]: ...
    def find(self, key: str) -> T | None: ...
    def get(self, key: str) -> T: ...
    def put(self, row: T) -> T: ...
    def delete(self, key: str) -> None: ...


class InMemoryTable[T: BaseModel]:
    """Rows are copied in and out, so callers can never mutate stored state by accident."""

    def __init__(self, name: str, key: Callable[[T], str], rows: Iterable[T] = ()) -> None:
        self._name = name
        self._key = key
        self._rows: dict[str, T] = {key(r): r.model_copy(deep=True) for r in rows}

    def list(self) -> list[T]:
        return [r.model_copy(deep=True) for r in self._rows.values()]

    def find(self, key: str) -> T | None:
        row = self._rows.get(key)
        return row.model_copy(deep=True) if row else None

    def get(self, key: str) -> T:
        row = self.find(key)
        if row is None:
            raise NotFound(f"{self._name} {key!r} not found")
        return row

    def put(self, row: T) -> T:
        self._rows[self._key(row)] = row.model_copy(deep=True)
        return row

    def delete(self, key: str) -> None:
        if self._rows.pop(key, None) is None:
            raise NotFound(f"{self._name} {key!r} not found")
