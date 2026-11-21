import logging
import traceback

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, PlainTextResponse
from sqlalchemy.exc import DBAPIError, OperationalError

log = logging.getLogger(__name__)


class DomainError(Exception):
    """An expected failure, returned to the client as ``{"error": {"code", "message", ...}}``."""

    status_code = 400
    code = "bad_request"

    def __init__(self, message: str, **details: object) -> None:
        super().__init__(message)
        self.message = message
        self.details = details


class Unauthorized(DomainError):
    status_code = 401
    code = "unauthorized"


class Forbidden(DomainError):
    status_code = 403
    code = "forbidden"


class NotFound(DomainError):
    status_code = 404
    code = "not_found"


class Conflict(DomainError):
    status_code = 409
    code = "conflict"


class Unprocessable(DomainError):
    """A well-formed request the service rejects on business rules (e.g. a password equal to the email address)."""

    status_code = 422
    code = "unprocessable"


class TooManyRequests(DomainError):
    """Throttled. The body is deliberately generic (no counters, no hint whether an account exists); ``retry_after``
    (seconds) becomes the Retry-After header."""

    status_code = 429
    code = "too_many_requests"

    def __init__(self, retry_after: int) -> None:
        super().__init__("Too many attempts. Try again later.")
        self.retry_after = max(1, int(retry_after))


class NotImplementedYet(DomainError):
    status_code = 501
    code = "not_implemented"


class ServiceUnavailable(DomainError):
    status_code = 503
    code = "service_unavailable"


def _error_response(exc: DomainError) -> JSONResponse:
    body: dict[str, object] = {"code": exc.code, "message": exc.message}
    if exc.details:
        body["details"] = exc.details
    headers = {"Retry-After": str(exc.retry_after)} if isinstance(exc, TooManyRequests) else None
    return JSONResponse(status_code=exc.status_code, content={"error": body}, headers=headers)


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(DomainError)
    async def _domain_error(_: Request, exc: DomainError) -> JSONResponse:
        return _error_response(exc)

    @app.exception_handler(OperationalError)
    async def _database_unavailable(_: Request, exc: OperationalError) -> JSONResponse:
        # Connection failures, timeouts, cancelled statements.
        log.error("Database operation failed: %s", describe_database_error(exc))
        return _error_response(ServiceUnavailable("The database is temporarily unavailable"))

    @app.exception_handler(DBAPIError)
    async def _database_error(_: Request, exc: DBAPIError) -> PlainTextResponse:
        # Any other database error (e.g. a CHECK rejecting a row). Same response as an unhandled error always gave.
        log.error("Database error: %s", describe_database_error(exc))
        return PlainTextResponse("Internal Server Error", status_code=500)


def describe_database_error(exc: DBAPIError) -> str:
    """A loggable description of a database error WITHOUT its message.

    PostgreSQL error messages can contain row values ("DETAIL: Failing row contains (...)", "Key (email)=(...)"), so a
    rejected credential would otherwise be copied into logs. Logged: error class, SQLSTATE, constraint, and where in our
    code it happened.
    """
    orig = getattr(exc, "orig", None)
    diag = getattr(orig, "diag", None)
    frames = [f for f in traceback.extract_tb(exc.__traceback__) if "/app/" in f.filename][-3:]
    location = " <- ".join(f"{f.filename.rsplit('/app/', 1)[-1]}:{f.lineno}" for f in reversed(frames)) or "unknown"
    return (
        f"{type(orig).__name__ if orig is not None else type(exc).__name__}"
        f" sqlstate={getattr(orig, 'sqlstate', None)}"
        f" constraint={getattr(diag, 'constraint_name', None)}"
        f" table={getattr(diag, 'table_name', None)}"
        f" at {location}"
    )
