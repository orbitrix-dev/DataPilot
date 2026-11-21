import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import OperationalError

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
    return JSONResponse(status_code=exc.status_code, content={"error": body})


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(DomainError)
    async def _domain_error(_: Request, exc: DomainError) -> JSONResponse:
        return _error_response(exc)

    @app.exception_handler(OperationalError)
    async def _database_error(_: Request, exc: OperationalError) -> JSONResponse:
        # Connection failures, timeouts, cancelled statements. Details (hosts, SQL) are logged, never returned.
        log.error("Database operation failed", exc_info=exc)
        return _error_response(ServiceUnavailable("The database is temporarily unavailable"))
