"""The single place that imports every ORM model, so ``Base.metadata`` is complete.

Alembic's ``migrations/env.py`` imports ``Base`` from here. Add each new models module below.
"""

from app.db.base import Base
from app.modules.identity.models import User, UserSession
from app.modules.tenants.models import Permission, Role, RolePermission, Tenant, TenantMembership

__all__ = ["Base", "Permission", "Role", "RolePermission", "Tenant", "TenantMembership", "User", "UserSession"]
