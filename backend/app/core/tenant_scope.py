"""The transaction's tenant, as PostgreSQL sees it: the context row-level security will check (Stage 4A).

Once the tenant of a unit of work is known (the authenticated request's tenant, the tenant a sign-in chose, the
tenant an invitation or a refresh token belongs to), it is bound to the database transaction with

    SELECT set_config('app.tenant_id', '<uuid>', true)

``true`` makes it **transaction-local**: PostgreSQL discards it at COMMIT or ROLLBACK (and when rolling back to a
savepoint taken before it), so it can never leak to the next transaction on a pooled connection. Nothing outside
this module writes the setting.

Stage 4A.1 only binds the context; nothing reads it yet. Stage 4A.4 adds row-level security policies that restrict
the runtime user to rows whose ``tenant_id`` equals it, and that see nothing at all when it is unset (fail closed).

Rules:
- **Bind before touching tenant-owned rows.** Pending ORM writes are flushed *before* the context changes, so a write
  is always sent under the context in which it was made.
- **Switching tenants inside one transaction** (recording a user-level event in each of the user's tenants) goes
  through ``tenant_scope``, which restores the previous context afterwards.
- **What this does not protect against:** code running as the runtime user can call ``set_config`` itself. Row-level
  security on this setting guards against a query that forgets its tenant filter (and against IDOR through such a
  query), not against SQL injection or arbitrary code. Those remain the job of parameterized queries and review.
"""

import uuid
from collections.abc import Iterator
from contextlib import contextmanager, suppress

from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

SETTING = "app.tenant_id"

_SET = text(f"SELECT set_config('{SETTING}', :tenant_id, true)")
_GET = text(f"SELECT current_setting('{SETTING}', true)")


def _set(session: Session, value: str) -> None:
    # Through the connection, not session.execute: no autoflush, so nothing is sent under the new context by accident.
    session.connection().execute(_SET, {"tenant_id": value})


def bind_tenant(session: Session, tenant_id: uuid.UUID) -> None:
    """Makes ``tenant_id`` the transaction's tenant. Pending writes are flushed first, under the previous context."""
    if not isinstance(tenant_id, uuid.UUID):  # never a slug, a string from a client, or None
        raise TypeError(f"bind_tenant needs the tenant's UUID, got {type(tenant_id).__name__}")
    session.flush()
    _set(session, str(tenant_id))


def clear_tenant(session: Session) -> None:
    """Unbinds the transaction's tenant (pending writes are flushed first). Row-level security then sees no rows."""
    session.flush()
    _set(session, "")


def current_tenant(session: Session) -> uuid.UUID | None:
    """The tenant bound to this transaction, or None. Once set in a connection, PostgreSQL reports an unset
    placeholder setting as '' rather than NULL, so both mean "no tenant"."""
    value = session.connection().execute(_GET).scalar()
    return uuid.UUID(value) if value else None


@contextmanager
def tenant_scope(session: Session, tenant_id: uuid.UUID) -> Iterator[None]:
    """Binds ``tenant_id`` for the block, then restores the previous context (or none).

    If the block raises, the previous context is still restored, without flushing (the block's pending writes belong
    to the abandoned work). If the transaction itself is already aborted, it can't run anything, and it discards the
    setting when it ends anyway; the original exception propagates."""
    previous = current_tenant(session)
    bind_tenant(session, tenant_id)
    try:
        yield
    except BaseException:
        with suppress(DBAPIError):  # aborted transaction: it will roll back, and the setting with it
            _set(session, str(previous) if previous else "")
        raise
    if previous is None:
        clear_tenant(session)
    else:
        bind_tenant(session, previous)
