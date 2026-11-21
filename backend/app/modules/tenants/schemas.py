import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

RoleId = Literal["owner", "admin", "manager", "analyst", "viewer"]
CapabilityId = Literal["connect", "trust", "insights", "automate", "admin"]
Scope = Literal["insights:read", "trust:read", "connect:read", "automate:read", "intelligence:query"]

ROLE_IDS: tuple[RoleId, ...] = ("owner", "admin", "manager", "analyst", "viewer")


class RoleInfo(BaseModel):
    id: RoleId
    label: str
    description: str


ROLES: list[RoleInfo] = [
    RoleInfo(
        id="owner",
        label="Organization Owner",
        description="Full control over billing, workspace deletion, security policies, and all module approvals.",
    ),
    RoleInfo(
        id="admin",
        label="Administrator",
        description="Manages Connect data sources, Trust rules, user invitations, API keys, and security settings.",
    ),
    RoleInfo(
        id="manager",
        label="Business Manager",
        description="Reviews Insights, asks Intelligence questions, and approves or rejects Automate workflow runs.",
    ),
    RoleInfo(
        id="analyst",
        label="Analyst",
        description="Creates reports, explores metrics, queries Intelligence, and drafts workflows without publishing.",
    ),
    RoleInfo(
        id="viewer",
        label="Viewer",
        description="Read-only access to published dashboards and shared reports. "
        "Cannot export raw data or trigger actions.",
    ),
]
ROLE_LABEL: dict[str, str] = {r.id: r.label for r in ROLES}

# Allowed levels per capability, most permissive first (matches the Permission Matrix page).
CAPABILITY_LEVELS: dict[CapabilityId, tuple[str, ...]] = {
    "connect": ("Full", "Read", "None"),
    "trust": ("Full", "Edit Rules", "View", "None"),
    "insights": ("Full", "View Only", "None"),
    "automate": ("Approve", "Draft Only", "None"),
    "admin": ("Full", "None"),
}
CAPABILITY_LABEL: dict[CapabilityId, str] = {
    "connect": "Connect: Add & rotate credentials",
    "trust": "Trust: Resolve incidents & rules",
    "insights": "Insights & Intelligence: Query & export",
    "automate": "Automate: Approve workflow execution",
    "admin": "Admin: Billing & workspace deletion",
}

Matrix = dict[CapabilityId, dict[RoleId, str]]

EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


class Member(BaseModel):
    id: str
    name: str
    email: str
    title: str
    role: RoleId
    status: Literal["active", "invited"]
    mfa: Literal["enabled", "pending"]
    last_active_at: datetime | None = None
    ip: str | None = None


class InviteIn(BaseModel):
    email: str
    role: RoleId = "analyst"

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        v = v.strip().lower()
        if not EMAIL.match(v):
            raise ValueError("Enter a valid email address")
        return v


class RoleChangeIn(BaseModel):
    role: RoleId


class RoleWithCount(RoleInfo):
    members: int


class MatrixRow(BaseModel):
    capability: CapabilityId
    label: str
    levels: tuple[str, ...]
    values: dict[RoleId, str]


class MatrixUpdate(BaseModel):
    values: Matrix


class Session(BaseModel):
    id: str
    member_id: str
    device: str
    location: str
    ip: str
    signed_in_at: datetime


class ApiKeyRecord(BaseModel):
    """Stored key. Only an HMAC-SHA256 digest (hex) of the secret is kept, under pepper ``pepper_version``."""

    id: str
    name: str
    prefix: str
    scopes: list[Scope]
    created_by: str
    created_at: datetime
    last_used_at: datetime | None = None
    revoked_at: datetime | None = None
    expires_at: datetime | None = None
    secret_hash: str
    pepper_version: str = ""


class ApiKeyOut(BaseModel):
    id: str
    name: str
    prefix: str
    scopes: list[Scope]
    created_by: str
    created_at: datetime
    last_used_at: datetime | None
    revoked_at: datetime | None
    expires_at: datetime | None = None  # NULL = never expires


class ApiKeyCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    scopes: list[Scope] = Field(min_length=1)
    # Optional expiry; omitted/null means the key never expires (as before).
    expires_at: datetime | None = None
    # Step-up verification: a fresh code from the acting user's confirmed authenticator (verified in the router).
    mfa_code: str = Field(pattern=r"^\d{6}$")

    @field_validator("expires_at")
    @classmethod
    def _future(cls, v: datetime | None) -> datetime | None:
        if v is None:
            return None
        if v.tzinfo is None:
            raise ValueError("expires_at must include a time zone")
        if v <= datetime.now(v.tzinfo):
            raise ValueError("expires_at must be in the future")
        return v


class ApiKeyCreated(BaseModel):
    key: ApiKeyOut
    secret: str = Field(description="Shown once. Only the hash is stored.")


Industry = Literal["Wholesale & Distribution", "Manufacturing", "Logistics", "Retail"]
Timezone = Literal["UTC", "America/Los_Angeles", "America/New_York"]
Retention = Literal[90, 365]


class OrgSettings(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    industry: Industry
    timezone: Timezone
    audit_retention_days: Retention


class SecurityPolicy(BaseModel):
    require_mfa: bool
    enforce_sso: bool
    session_timeout_hours: Literal[1, 8, 12, 24]


class Workspace(BaseModel):
    """Per-tenant singleton settings."""

    id: str = "workspace"
    org: OrgSettings
    policy: SecurityPolicy
    matrix: Matrix
    deletion_scheduled_for: datetime | None = None


class Me(BaseModel):
    tenant_id: str
    member: Member
    permissions: dict[CapabilityId, str]
