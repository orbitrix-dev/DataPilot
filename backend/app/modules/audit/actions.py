"""The audit action registry: every action that can be recorded, in one place.

Each action declares:
- ``label``: the display title the API returns as ``event`` (e.g. "User Invited").
- ``business_store``: where the business state the event describes lives. ``postgres``: the change and its event
  are written in the same transaction (atomic). ``memory``: the change lives in an in-memory module; the event is
  stored durably, but the change is not, and the two are NOT atomic (see ``durability``).
- ``durability``: ``durable`` (event and business state both persist, atomically) or ``transitional`` (memory-backed:
  no phantom success events, but an event can be missing if the request fails after the in-memory change, and the
  change itself is lost on restart).
- ``production_enabled``: whether production may record (and so perform) this action. Production startup fails if
  a production-enabled action is memory-backed or transitional (``app/core/readiness.py``), and ``record()`` refuses
  actions that aren't production-enabled when running in production.
- ``metadata``: the exact metadata keys the action may carry and their types. Anything else is rejected.

An action moves to ``postgres`` / ``durable`` / ``production_enabled=True`` when its module is PostgreSQL-backed and
its atomicity tests pass.
"""

from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Literal

# Allowed metadata value types: short strings, integers, booleans, and short lists of short strings.
MetaType = Literal["str", "int", "bool", "list[str]"]

CATEGORIES = ("login", "permission", "user", "api-key", "connection", "workflow", "settings", "billing")


@dataclass(frozen=True)
class AuditAction:
    code: str
    label: str
    business_store: Literal["postgres", "memory"]
    durability: Literal["durable", "transitional"]
    production_enabled: bool
    metadata: MappingProxyType = field(default_factory=lambda: MappingProxyType({}))

    @property
    def category(self) -> str:
        return self.code.split(".", 1)[0]


def _a(code: str, label: str, store: str, durability: str, prod: bool, **meta: MetaType) -> AuditAction:
    return AuditAction(code, label, store, durability, prod, MappingProxyType(meta))  # type: ignore[arg-type]


_PG = ("postgres", "durable", True)
_MEMORY = ("memory", "transitional", False)  # transitional until the module is PostgreSQL-backed

_ACTIONS = (
    # ---- Tenants module (PostgreSQL)
    _a("user.invited", "User Invited", *_PG, email="str", role="str"),
    _a("user.invitation_cancelled", "Invitation Cancelled", *_PG, email="str"),
    _a("user.access_revoked", "Access Revoked", *_PG, role="str"),
    _a("permission.role_changed", "Role Changed", *_PG, from_role="str", to_role="str"),
    _a(
        "permission.matrix_changed",
        "Permission Changed",
        *_PG,
        role="str",
        capability="str",
        from_level="str",
        to_level="str",
    ),
    _a("settings.security_policy_changed", "Security Policy Changed", *_PG, setting="str", value="str"),
    _a("settings.organization_updated", "Organization Updated", *_PG, field="str", from_value="str", to_value="str"),
    _a("settings.deletion_scheduled", "Deletion Scheduled", *_PG, scheduled_for="str"),
    _a("settings.deletion_cancelled", "Deletion Cancelled", *_PG),
    _a("login.session_revoked", "Session Revoked", *_PG, session_id="str", device="str"),
    # ---- API keys: still in memory until Stage 3A.2
    _a("api-key.created", "API Key Created", *_MEMORY, name="str", prefix="str", scopes="list[str]"),
    _a("api-key.revoked", "API Key Revoked", *_MEMORY, name="str", prefix="str"),
    # ---- In-memory modules (Automate, Billing, Connect, Notifications)
    _a(
        "workflow.approved",
        "Workflow Approved",
        *_MEMORY,
        request_id="str",
        run_id="str",
        acknowledged_issues="list[str]",
    ),
    _a("workflow.rejected", "Workflow Rejected", *_MEMORY, request_id="str", reason="str"),
    _a("billing.plan_changed", "Plan Changed", *_MEMORY, from_plan="str", to_plan="str"),
    _a("billing.plan_change_requested", "Plan Change Requested", *_MEMORY, to_plan="str"),
    _a("connection.credential_rotated", "Credential Rotated", *_MEMORY, connection_id="str"),
    _a("settings.notifications_changed", "Notifications Changed", *_MEMORY, category="str", enabled="bool"),
    # ---- Sign-in. Present only in demo history until Stage 3B implements sign-in.
    _a("login.succeeded", "Login", "postgres", "durable", False, method="str"),
    _a("login.blocked", "Login Blocked", "postgres", "durable", False, reason="str"),
    # ---- Security events written by SecurityAuditWriter (independent transaction). Wired in Stage 3B.
    _a("api-key.rejected", "API Key Rejected", "postgres", "durable", False, reason="str"),
)

ACTIONS: MappingProxyType = MappingProxyType({a.code: a for a in _ACTIONS})

# Never allowed as metadata keys, whatever an action declares (defence in depth for the allowlists above).
FORBIDDEN_METADATA_KEYS = (
    "password",
    "secret",
    "token",
    "api_key",
    "authorization",
    "cookie",
    "credential",
    "mfa",
    "otp",
)


def get(code: str) -> AuditAction:
    try:
        return ACTIONS[code]
    except KeyError:
        raise ValueError(f"Unregistered audit action {code!r}") from None


def labels_matching(needle: str) -> list[str]:
    """Action codes whose label contains ``needle`` (case-insensitive): search on the API's ``event`` field."""
    needle = needle.lower()
    return [a.code for a in _ACTIONS if needle in a.label.lower()]


def _validate_registry() -> None:
    if len(ACTIONS) != len(_ACTIONS):
        raise RuntimeError("Duplicate audit action code")
    for a in _ACTIONS:
        if a.category not in CATEGORIES:
            raise RuntimeError(f"{a.code}: category {a.category!r} is not one of {CATEGORIES}")
        if (a.business_store == "memory") != (a.durability == "transitional"):
            raise RuntimeError(f"{a.code}: memory-backed actions are transitional, PostgreSQL-backed ones durable")
        for key in a.metadata:
            if any(word in key.lower() for word in FORBIDDEN_METADATA_KEYS):
                raise RuntimeError(f"{a.code}: metadata key {key!r} is forbidden")


_validate_registry()
