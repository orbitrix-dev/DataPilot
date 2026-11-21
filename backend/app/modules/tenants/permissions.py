"""The permission catalog, and the deterministic mapping between stored permission sets and matrix levels.

Roles store *permissions* (``role_permissions``). The Admin → Permissions page and API speak *levels* per
capability ("Full", "Edit Rules", "View Only", …). This module converts between the two:

- level → permissions: a fixed table (``LEVEL_PERMISSIONS``).
- permissions → level: the level whose set equals the role's permissions for that capability *exactly*.
  Anything else is rejected with ``UnsupportedPermissionSet``; nothing is ever rounded to a nearby level.

The tables are validated at import: within a capability every level maps to a distinct set, so the reverse
mapping is a bijection and can't be ambiguous.

The sets preserve today's behaviour exactly: e.g. every Insights and Intelligence route currently needs only a
non-"None" Insights level, so "View Only" includes ``intelligence:query``.
"""

from collections.abc import Iterable, Mapping
from dataclasses import dataclass

from app.core.errors import Conflict

from .schemas import CAPABILITY_LEVELS, ROLE_IDS, CapabilityId, Matrix, RoleId


@dataclass(frozen=True)
class PermissionDef:
    code: str
    module: str
    description: str


# Mirrored, frozen, in migration 0001 (migrations must not import app code). A test keeps them in sync.
CATALOG: tuple[PermissionDef, ...] = (
    PermissionDef("connect:read", "connect", "View data sources, sync history and connection health"),
    PermissionDef("connect:write", "connect", "Add data sources, rotate credentials and trigger syncs"),
    PermissionDef("trust:read", "trust", "View DataTrust incidents, freshness and dataset status"),
    PermissionDef("trust:rules", "trust", "Create and edit DataTrust rules"),
    PermissionDef("trust:write", "trust", "Resolve DataTrust incidents"),
    PermissionDef("insights:read", "insights", "View dashboards, metrics and reports"),
    PermissionDef("insights:export", "insights", "Export raw data and reports"),
    PermissionDef("intelligence:query", "intelligence", "Ask Intelligence questions and view forecasts"),
    PermissionDef("automate:read", "automate", "View workflows, approval requests and runs"),
    PermissionDef("automate:draft", "automate", "Draft workflows"),
    PermissionDef("automate:approve", "automate", "Approve or reject workflow runs"),
    PermissionDef("billing:manage", "billing", "Change the plan and billing details"),
    PermissionDef("workspace:delete", "admin", "Schedule or cancel workspace deletion"),
    PermissionDef("members:manage", "admin", "Invite and remove members and change their roles"),
    PermissionDef("api_keys:manage", "admin", "Create and revoke API keys"),
    PermissionDef("settings:manage", "admin", "Change the security policy and organization settings"),
    PermissionDef("audit:read", "admin", "Read the audit log"),
)
CATALOG_CODES: frozenset[str] = frozenset(p.code for p in CATALOG)


def _set(*codes: str) -> frozenset[str]:
    return frozenset(codes)


LEVEL_PERMISSIONS: dict[CapabilityId, dict[str, frozenset[str]]] = {
    "connect": {
        "Full": _set("connect:read", "connect:write"),
        "Read": _set("connect:read"),
        "None": _set(),
    },
    "trust": {
        "Full": _set("trust:read", "trust:rules", "trust:write"),
        "Edit Rules": _set("trust:read", "trust:rules"),
        "View": _set("trust:read"),
        "None": _set(),
    },
    "insights": {
        "Full": _set("insights:read", "insights:export", "intelligence:query"),
        "View Only": _set("insights:read", "intelligence:query"),
        "None": _set(),
    },
    "automate": {
        "Approve": _set("automate:read", "automate:draft", "automate:approve"),
        "Draft Only": _set("automate:read", "automate:draft"),
        "None": _set(),
    },
    "admin": {
        "Full": _set("billing:manage", "workspace:delete"),
        "None": _set(),
    },
}

# Permissions granted by role, outside the editable matrix. They mirror today's `admins()` rule (Owner and
# Administrator manage users, keys, settings and the audit log). The route checks themselves are unchanged.
_ADMINISTRATION = _set("members:manage", "api_keys:manage", "settings:manage", "audit:read")
ROLE_FIXED_PERMISSIONS: dict[RoleId, frozenset[str]] = {
    "owner": _ADMINISTRATION,
    "admin": _ADMINISTRATION,
    "manager": _set(),
    "analyst": _set(),
    "viewer": _set(),
}

CAPABILITY_PERMISSIONS: dict[CapabilityId, frozenset[str]] = {
    cap: frozenset().union(*levels.values()) for cap, levels in LEVEL_PERMISSIONS.items()
}


class UnsupportedPermissionSet(Conflict):
    """A permission set that no matrix level (or role) represents. Never silently mapped to a level."""


def _require(condition: bool, message: str) -> None:
    # Explicit raise, not `assert`: this check must also run under `python -O`.
    if not condition:
        raise RuntimeError(f"Invalid permission tables: {message}")


def _validate_tables() -> None:
    _require(set(LEVEL_PERMISSIONS) == set(CAPABILITY_LEVELS), "every capability needs a level table")
    seen: set[str] = set()
    for cap, levels in LEVEL_PERMISSIONS.items():
        _require(tuple(levels) == CAPABILITY_LEVELS[cap], f"{cap}: levels must match CAPABILITY_LEVELS exactly")
        _require(len(set(levels.values())) == len(levels), f"{cap}: two levels share a permission set (ambiguous)")
        _require(not (CAPABILITY_PERMISSIONS[cap] & seen), f"{cap}: permissions overlap another capability")
        seen |= CAPABILITY_PERMISSIONS[cap]
    fixed = frozenset().union(*ROLE_FIXED_PERMISSIONS.values())
    _require(not (fixed & seen), "fixed role permissions must not be matrix permissions")
    _require(seen | fixed <= CATALOG_CODES, "every mapped permission must be in the catalog")
    _require(set(ROLE_FIXED_PERMISSIONS) == set(ROLE_IDS), "every system role needs a fixed-permission entry")


_validate_tables()


# ------------------------------------------------------------------ level → permissions


def permissions_for_level(capability: CapabilityId, level: str) -> frozenset[str]:
    try:
        return LEVEL_PERMISSIONS[capability][level]
    except KeyError:
        raise UnsupportedPermissionSet(
            f"{level!r} is not a level of {capability}", capability=capability, allowed=list(CAPABILITY_LEVELS)
        ) from None


def permissions_for_role(role: RoleId, levels: Mapping[CapabilityId, str]) -> frozenset[str]:
    """Every permission a system role holds for the given matrix row (one level per capability)."""
    missing = set(CAPABILITY_LEVELS) - set(levels)
    if missing:
        raise UnsupportedPermissionSet(f"No level given for {', '.join(sorted(missing))}", role=role)
    granted = frozenset().union(*(permissions_for_level(cap, levels[cap]) for cap in CAPABILITY_LEVELS))
    return granted | ROLE_FIXED_PERMISSIONS[role]


# ------------------------------------------------------------------ permissions → level


def level_for(capability: CapabilityId, granted: Iterable[str]) -> str:
    """The level whose permission set equals ``granted`` (restricted to this capability). Rejects anything else."""
    subset = frozenset(granted) & CAPABILITY_PERMISSIONS[capability]
    for level, perms in LEVEL_PERMISSIONS[capability].items():
        if perms == subset:
            return level
    raise UnsupportedPermissionSet(
        f"Permissions {sorted(subset)} don't correspond to any {capability} level",
        capability=capability,
        permissions=sorted(subset),
    )


def levels_for_role(role: RoleId, granted: Iterable[str]) -> dict[CapabilityId, str]:
    """A system role's matrix row. Rejects permissions the role can't hold and missing fixed permissions."""
    granted = frozenset(granted)
    unknown = granted - CATALOG_CODES
    if unknown:
        raise UnsupportedPermissionSet(f"Unknown permissions {sorted(unknown)}", role=role)
    fixed = ROLE_FIXED_PERMISSIONS[role]
    stray = granted - fixed - frozenset().union(*CAPABILITY_PERMISSIONS.values())
    if stray:
        raise UnsupportedPermissionSet(f"The {role} role can't hold {sorted(stray)}", role=role)
    if not fixed <= granted:
        raise UnsupportedPermissionSet(f"The {role} role must hold {sorted(fixed - granted)}", role=role)
    return {cap: level_for(cap, granted) for cap in CAPABILITY_LEVELS}


# ------------------------------------------------------------------ whole matrix


def grants_from_matrix(matrix: Matrix) -> dict[RoleId, frozenset[str]]:
    """Permissions per system role for a complete matrix (every capability × every role)."""
    for cap in CAPABILITY_LEVELS:
        if set(matrix.get(cap, {})) != set(ROLE_IDS):
            raise UnsupportedPermissionSet(f"The matrix must give a level for every role on {cap}", capability=cap)
    rows = {role: {cap: matrix[cap][role] for cap in CAPABILITY_LEVELS} for role in ROLE_IDS}
    return {role: permissions_for_role(role, rows[role]) for role in ROLE_IDS}


def matrix_from_grants(grants: Mapping[RoleId, Iterable[str]]) -> Matrix:
    """The matrix for the five system roles. Every role must be present and representable."""
    if set(grants) != set(ROLE_IDS):
        raise UnsupportedPermissionSet("Grants must cover exactly the system roles", roles=sorted(grants))
    rows = {role: levels_for_role(role, grants[role]) for role in ROLE_IDS}
    return {cap: {role: rows[role][cap] for role in ROLE_IDS} for cap in CAPABILITY_LEVELS}
