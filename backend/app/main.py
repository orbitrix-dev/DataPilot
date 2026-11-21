from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import Settings, get_settings
from app.core.errors import install_error_handlers
from app.modules.audit.router import router as audit_router
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

ROUTERS = [
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


def create_app(settings: Settings | None = None, registry: Registry | None = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(
        title="DataPilot API",
        version="0.1.0",
        docs_url=f"{settings.api_prefix}/docs",
        openapi_url=f"{settings.api_prefix}/openapi.json",
    )
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
        return {"status": "ok", "env": settings.env}

    for router in ROUTERS:
        app.include_router(router, prefix=settings.api_prefix)
    return app


app = create_app()
