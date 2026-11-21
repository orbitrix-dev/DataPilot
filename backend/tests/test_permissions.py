"""The deterministic mapping between permission sets and matrix levels (pure code, no database)."""

import pytest

from app.modules.tenants.permissions import (
    CAPABILITY_PERMISSIONS,
    CATALOG_CODES,
    LEVEL_PERMISSIONS,
    ROLE_FIXED_PERMISSIONS,
    UnsupportedPermissionSet,
    grants_from_matrix,
    level_for,
    levels_for_role,
    matrix_from_grants,
    permissions_for_level,
)
from app.modules.tenants.schemas import CAPABILITY_LEVELS, ROLE_IDS

from .factories import DEMO_MATRIX


def test_the_demo_matrix_round_trips_exactly():
    assert matrix_from_grants(grants_from_matrix(DEMO_MATRIX)) == DEMO_MATRIX


def test_every_level_round_trips_and_levels_are_distinct():
    for cap, levels in CAPABILITY_LEVELS.items():
        sets = [permissions_for_level(cap, level) for level in levels]
        assert len(set(sets)) == len(levels)  # no two levels share a set: the reverse mapping is unambiguous
        for level in levels:
            assert level_for(cap, permissions_for_level(cap, level)) == level


def test_every_matrix_combination_for_every_role_round_trips():
    """Exhaustive over each capability × level × role, since every combination is a valid matrix cell."""
    for role in ROLE_IDS:
        for cap, levels in CAPABILITY_LEVELS.items():
            for level in levels:
                row = {c: ("None" if c != cap else level) for c in CAPABILITY_LEVELS}
                granted = permissions_for_level(cap, level) | ROLE_FIXED_PERMISSIONS[role]
                assert levels_for_role(role, granted) == row


def test_current_behaviour_is_preserved_by_the_level_sets():
    # Every Insights/Intelligence route needs only a non-"None" insights level today.
    assert "intelligence:query" in permissions_for_level("insights", "View Only")
    assert "insights:export" not in permissions_for_level("insights", "View Only")
    # Resolving incidents needs Trust "Full"; rotating credentials needs Connect "Full"; approving needs "Approve".
    assert "trust:write" in permissions_for_level("trust", "Full")
    assert "trust:write" not in permissions_for_level("trust", "Edit Rules")
    assert permissions_for_level("connect", "Read") == {"connect:read"}
    assert "automate:approve" not in permissions_for_level("automate", "Draft Only")


@pytest.mark.parametrize(
    ("cap", "granted"),
    [
        ("trust", {"trust:write"}),  # resolve without read: no level means that
        ("trust", {"trust:read", "trust:write"}),  # between "View" and "Full"
        ("insights", {"insights:read", "insights:export"}),  # export without query
        ("automate", {"automate:approve"}),
        ("connect", {"connect:write"}),
        ("admin", {"billing:manage"}),  # half of "Full"
    ],
)
def test_unsupported_combinations_are_rejected_not_rounded(cap, granted):
    with pytest.raises(UnsupportedPermissionSet, match=f"any {cap} level"):
        level_for(cap, granted)


def test_roles_reject_permissions_they_cannot_hold_or_missing_fixed_ones():
    analyst = grants_from_matrix(DEMO_MATRIX)["analyst"]
    with pytest.raises(UnsupportedPermissionSet, match="can't hold"):
        levels_for_role("analyst", analyst | {"members:manage"})
    owner = grants_from_matrix(DEMO_MATRIX)["owner"]
    with pytest.raises(UnsupportedPermissionSet, match="must hold"):
        levels_for_role("owner", owner - {"audit:read"})
    with pytest.raises(UnsupportedPermissionSet, match="Unknown permissions"):
        levels_for_role("viewer", {"made:up"})


def test_incomplete_matrices_and_unknown_levels_are_rejected():
    partial = {cap: dict(row) for cap, row in DEMO_MATRIX.items()}
    del partial["trust"]["viewer"]
    with pytest.raises(UnsupportedPermissionSet, match="every role on trust"):
        grants_from_matrix(partial)
    bad = {cap: dict(row) for cap, row in DEMO_MATRIX.items()}
    bad["connect"]["viewer"] = "Admin"
    with pytest.raises(UnsupportedPermissionSet, match="not a level of connect"):
        grants_from_matrix(bad)


def test_tables_are_consistent_with_the_catalog():
    mapped = frozenset().union(*CAPABILITY_PERMISSIONS.values(), *ROLE_FIXED_PERMISSIONS.values())
    assert mapped == CATALOG_CODES  # every catalog permission is reachable, and nothing outside it is used
    assert set(LEVEL_PERMISSIONS) == set(CAPABILITY_LEVELS)
