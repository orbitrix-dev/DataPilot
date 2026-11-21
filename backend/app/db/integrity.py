"""Turns expected integrity violations into domain errors, so database details never reach API responses."""

from collections.abc import Callable, Iterator
from contextlib import contextmanager

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import DomainError

UNIQUE_VIOLATION = "23505"
FOREIGN_KEY_VIOLATION = "23503"


def sqlstate(exc: IntegrityError) -> str | None:
    return getattr(exc.orig, "sqlstate", None)


@contextmanager
def translate_integrity_errors(
    session: Session,
    *,
    unique: Callable[[], DomainError] | None = None,
    foreign_key: Callable[[], DomainError] | None = None,
) -> Iterator[None]:
    """Runs the block (and a flush) in a savepoint. A unique / foreign-key violation raises the given domain error
    and leaves the surrounding transaction usable; any other database error propagates unchanged."""
    try:
        with session.begin_nested():
            yield
            session.flush()
    except IntegrityError as exc:
        state = sqlstate(exc)
        if state == UNIQUE_VIOLATION and unique is not None:
            raise unique() from None
        if state == FOREIGN_KEY_VIOLATION and foreign_key is not None:
            raise foreign_key() from None
        raise
