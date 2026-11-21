"""PostgreSQL connection management (synchronous SQLAlchemy 2.x).

- One ``Database`` (engine + connection pool) per application, created by ``create_app``.
- One ``Session`` and one transaction per request, through the ``DbSession`` dependency: the
  transaction commits when the route returns and rolls back if anything raises, including
  ``DomainError``s. Commit happens *before* the response is sent, so a client never sees success
  for a write that later failed to commit.
- Scripts and workers use ``Database.session()`` directly for the same unit-of-work behaviour.
"""

import time
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from .config import Settings
from .errors import ServiceUnavailable


class Database:
    def __init__(
        self,
        url: str,
        *,
        pool_size: int = 5,
        max_overflow: int = 10,
        pool_timeout: float = 10,
        pool_recycle: int = 1800,
        connect_timeout: int = 5,
        statement_timeout_ms: int = 15_000,
        echo: bool = False,
    ) -> None:
        self.engine: Engine = create_engine(
            url,
            pool_size=pool_size,
            max_overflow=max_overflow,
            pool_timeout=pool_timeout,
            pool_recycle=pool_recycle,
            # Detects connections dropped by the server or a proxy before handing them out.
            pool_pre_ping=True,
            echo=echo,
            connect_args={
                "application_name": "datapilot-api",
                "connect_timeout": connect_timeout,
                "options": f"-c statement_timeout={statement_timeout_ms}",
            },
        )
        # expire_on_commit=False: objects stay readable after commit (the response is built after it).
        self._sessions = sessionmaker(self.engine, expire_on_commit=False)

    @classmethod
    def from_settings(cls, settings: Settings) -> "Database | None":
        if settings.database_url is None:
            return None
        return cls(
            settings.database_url.get_secret_value(),
            pool_size=settings.db_pool_size,
            max_overflow=settings.db_max_overflow,
            pool_timeout=settings.db_pool_timeout_seconds,
            pool_recycle=settings.db_pool_recycle_seconds,
            connect_timeout=settings.db_connect_timeout_seconds,
            statement_timeout_ms=settings.db_statement_timeout_ms,
            echo=settings.db_echo,
        )

    @contextmanager
    def session(self) -> Iterator[Session]:
        """A unit of work: commits if the block completes, rolls back if it raises."""
        with self._sessions() as session, session.begin():
            yield session

    def ping(self) -> float:
        """Round-trips ``SELECT 1`` and returns the latency in milliseconds. Raises if unreachable."""
        start = time.perf_counter()
        with self.engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return (time.perf_counter() - start) * 1000

    def dispose(self) -> None:
        self.engine.dispose()


def get_database(request: Request) -> Database:
    db: Database | None = request.app.state.db
    if db is None:
        raise ServiceUnavailable("The database is not configured (set DP_DATABASE_URL)")
    return db


def _request_session(db: Annotated[Database, Depends(get_database)]) -> Iterator[Session]:
    with db.session() as session:
        yield session


# scope="function": the transaction ends when the route returns, before the response is sent.
DbSession = Annotated[Session, Depends(_request_session, scope="function")]
