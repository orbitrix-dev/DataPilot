from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Literal

if TYPE_CHECKING:
    from app.core.security import Keyring
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
    """Everything a service needs about the current request. Services never read globals.

    ``tenant_id`` is the tenant's readable slug ("acme"): it's what the API, secret references and job messages
    have always used. ``tenant_uuid`` is the internal database id, resolved during authentication; it's None only
    for contexts built without a database (e.g. comparing against the in-memory implementation in tests).
    """

    tenant_id: str
    principal: Principal
    data: TenantData
    ip: str  # resolved client address (app/core/client_address.py): an IP, or a label such as "testclient"
    tenant_uuid: uuid.UUID | None = None
    environment: str = "dev"  # DP_ENV; production refuses audit actions that aren't production-enabled
    api_key_keyring: Keyring | None = None  # the API-key pepper keyring (None in contexts without configuration)
