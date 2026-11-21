"""Alembic environment. Connection settings come from app config (``DP_*``), never from alembic.ini.

- URL: ``DP_MIGRATION_DATABASE_URL`` (the schema owner), falling back to ``DP_DATABASE_URL``.
- Runtime user: the user in ``DP_DATABASE_URL`` (e.g. ``datapilot_app``) is handed to migrations as
  ``context.config.attributes["app_role"]`` so they can verify it and grant exactly what the app needs. It's None
  when both URLs use the same user; migration 0003 refuses that (the runtime user must not own tables).
- Target metadata: ``app.db.models.Base.metadata``, which imports every ORM model.
- All pending migrations run in ONE transaction. PostgreSQL DDL is transactional, so if any migration fails,
  the database is left exactly as it was.
- ``lock_timeout`` (``DP_DB_MIGRATION_LOCK_TIMEOUT_MS``) makes a migration give up instead of queueing behind
  long-running transactions and blocking live traffic.
"""

import re
from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool
from sqlalchemy.engine import make_url

from app.core.config import Settings
from app.db.models import Base

config = context.config
if config.config_file_name is not None and config.attributes.get("configure_logger", True):
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata
ROLE_NAME = re.compile(r"^[a-z_][a-z0-9_]{0,62}$")


def _settings() -> tuple[str, int]:
    settings = Settings()
    url = settings.migration_database_url or settings.database_url
    if url is None:
        raise RuntimeError("Set DP_MIGRATION_DATABASE_URL (or DP_DATABASE_URL) to run migrations")
    config.attributes["app_role"] = _app_role(settings, url.get_secret_value())
    return url.get_secret_value(), settings.db_migration_lock_timeout_ms


def _app_role(settings: Settings, migration_url: str) -> str | None:
    if settings.database_url is None:
        return None
    app_user = make_url(settings.database_url.get_secret_value()).username
    if not app_user or app_user == make_url(migration_url).username:
        return None
    if not ROLE_NAME.match(app_user):
        raise RuntimeError(f"Runtime database user {app_user!r} must match {ROLE_NAME.pattern}")
    return app_user


def run_migrations_offline() -> None:
    """``alembic upgrade head --sql``: renders the SQL for review without connecting."""
    url, _ = _settings()
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    url, lock_timeout_ms = _settings()
    engine = create_engine(
        url,
        poolclass=pool.NullPool,
        hide_parameters=True,
        connect_args={
            "application_name": "datapilot-migrations",
            # Set at connect time. Executing `SET` on the connection here would autobegin a transaction that
            # Alembic then treats as externally managed and never commits: migrations would silently roll back.
            "options": f"-c lock_timeout={int(lock_timeout_ms)}",
        },
    )
    try:
        with engine.connect() as connection:
            context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
            with context.begin_transaction():
                context.run_migrations()
    finally:
        engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
