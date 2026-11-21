from dataclasses import dataclass

from app.core.infra import JobQueue, SecretStore
from app.core.repository import Table
from app.modules.audit.repository import AuditRepository
from app.modules.automate.repository import AutomateRepository
from app.modules.billing.repository import BillingRepository
from app.modules.connect.repository import ConnectRepository
from app.modules.notifications.service import Preferences
from app.modules.tenants.repository import TenantsRepository
from app.modules.trust.repository import TrustRepository


@dataclass
class TenantData:
    """One tenant's repositories plus shared infrastructure. Services reach storage only through this."""

    tenants: TenantsRepository
    audit: AuditRepository
    connect: ConnectRepository
    trust: TrustRepository
    automate: AutomateRepository
    billing: BillingRepository
    notifications: Table[Preferences]
    secrets: SecretStore
    queue: JobQueue


class Registry:
    """Maps tenant ids to their data. In production this resolves a tenant's database scope."""

    def __init__(self, tenants: dict[str, TenantData]) -> None:
        self._tenants = tenants

    def get(self, tenant_id: str) -> TenantData | None:
        return self._tenants.get(tenant_id)

    def items(self):
        return self._tenants.items()
