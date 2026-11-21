"""The single place that imports every ORM model, so ``Base.metadata`` is complete.

Alembic's ``migrations/env.py`` imports ``Base`` from here. Add each new models module below.
"""

from app.db.base import Base
from app.modules.audit.models import AuditEventRecord
from app.modules.identity.models import InvitationToken, RefreshToken, User, UserSession
from app.modules.tenants.models import (
    ApiKey,
    Permission,
    Role,
    RolePermission,
    Tenant,
    TenantMembership,
    TenantSettings,
)

__all__ = [
    "ApiKey",
    "AuditEventRecord",
    "InvitationToken",
    "RefreshToken",
    "Base",
    "Permission",
    "Role",
    "RolePermission",
    "Tenant",
    "TenantMembership",
    "TenantSettings",
    "User",
    "UserSession",
]
