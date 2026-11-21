"""The single place that imports every ORM model, so ``Base.metadata`` is complete.

Alembic's ``migrations/env.py`` imports ``Base`` from here. Add each new models module below, e.g.
``from app.modules.tenants import models as _tenants  # noqa: F401``.
"""

from app.db.base import Base

__all__ = ["Base"]
