from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Literal

if TYPE_CHECKING:
    from app.modules.tenants.schemas import RoleId
    from app.tenant_data import TenantData


@dataclass(frozen=True)
class Principal:
    """Who is calling: a workspace member, or an API key acting for the tenant."""

    kind: Literal["user", "api_key"]
    id: str
    name: str
    role: RoleId | None = None
    scopes: frozenset[str] = field(default_factory=frozenset)


@dataclass(frozen=True)
class RequestContext:
    """Everything a service needs about the current request. Services never read globals."""

    tenant_id: str
    principal: Principal
    data: TenantData
    ip: str
