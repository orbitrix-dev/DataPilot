import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import Settings, get_settings
from app.core.db import Database
from app.core.errors import install_error_handlers
from app.core.readiness import assert_production_ready
from app.modules.audit.router import router as audit_router
from app.modules.audit.security_writer import SecurityAuditWriter
from app.modules.auth.router import router as auth_router
from app.modules.auth.security_events import SecurityAudit
from app.modules.automate.router import router as automate_router
from app.modules.billing.router import router as billing_router
from app.modules.connect.router import router as connect_router
from app.modules.insights.router import router as insights_router
from app.modules.intelligence.router import router as intelligence_router
from app.modules.notifications.router import router as notifications_router
from app.modules.tenants.router import router as tenants_router
from app.modules.trust.router import router as trust_router
from app.seed import demo_registry
from app.tenant_data import Registry

log = logging.getLogger(__name__)

ROUTERS = [
    auth_router,
    tenants_router,
    audit_router,
    connect_router,
    trust_router,
    automate_router,
    billing_router,
    notifications_router,
    insights_router,
    intelligence_router,
]


def create_app(
    settings: Settings | None = None,
    registry: Registry | None = None,
    database: Database | None = None,
    security_audit: SecurityAudit | None = None,
) -> FastAPI:
    """``database`` lets tests inject a shared one; otherwise it's built from settings and owned by the app.

    ``security_audit`` records rejected requests in an independent transaction. When the app owns its database it
    builds a ``SecurityAuditWriter`` on the same URL (its own small pool); production refuses to start without one.
    """
    settings = settings or get_settings()
    owns_database = database is None
    db = Database.from_settings(settings) if owns_database else database
    owns_writer = security_audit is None and owns_database and settings.database_url is not None
    writer = SecurityAuditWriter(settings.database_url.get_secret_value()) if owns_writer else security_audit

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        if settings.env == "prod":
            assert_production_ready(db, writer)  # refuses to start: see app/core/readiness.py
        yield
        if owns_database and db is not None:
            db.dispose()
        if owns_writer:
            writer.dispose()

    app = FastAPI(
        title="DataPilot API",
        version="0.1.0",
        docs_url=f"{settings.api_prefix}/docs",
        openapi_url=f"{settings.api_prefix}/openapi.json",
        lifespan=lifespan,
    )
    app.state.db = db
    app.state.security_audit = writer
    # In-memory storage seeded with the demo tenant. Replace with PostgreSQL-backed repositories.
    app.state.registry = registry or demo_registry()
    app.dependency_overrides[get_settings] = lambda: settings

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    install_error_handlers(app)

    @app.get("/healthz", tags=["ops"])
    def healthz() -> dict[str, str]:
        """Liveness: the process is up. Doesn't touch the database."""
        return {"status": "ok", "env": settings.env}

    @app.get("/healthz/security-audit", tags=["ops"])
    def healthz_security_audit() -> JSONResponse:
        """Whether rejected sign-ins and API keys are being recorded. 503 when no writer is configured or its most
        recent write failed (it recovers with the next successful write). Counters only, never event contents."""
        if writer is None:
            return JSONResponse({"status": "unavailable", "security_audit": "not_configured"}, status_code=503)
        health = writer.health()
        ok = health["healthy"]
        return JSONResponse({"status": "ok" if ok else "degraded", **health}, status_code=200 if ok else 503)

    @app.get("/healthz/db", tags=["ops"])
    def healthz_db() -> JSONResponse:
        """Readiness of PostgreSQL. 503 when unconfigured or unreachable; error details go to the log only."""
        if db is None:
            return JSONResponse({"status": "unavailable", "database": "not_configured"}, status_code=503)
        try:
            latency_ms = db.ping()
        except SQLAlchemyError:
            log.exception("Database health check failed")
            return JSONResponse({"status": "unavailable", "database": "unreachable"}, status_code=503)
        return JSONResponse({"status": "ok", "database": "ok", "latency_ms": round(latency_ms, 2)})

    for router in ROUTERS:
        app.include_router(router, prefix=settings.api_prefix)
    return app


app = create_app()
