"""PostgreSQL repositories: CRUD behaviour, tenant scoping (cross-tenant access denial) and transaction rollback."""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.config import Settings
from app.core.db import DbSession
from app.core.errors import Conflict, NotFound
from app.db.base import uuid7
from app.main import create_app
from app.modules.identity.models import User, UserSession
from app.modules.identity.persistence import (
    PostgresSessionRepository,
    PostgresUserRepository,
    normalize_email,
)
from app.modules.tenants.models import Tenant
from app.modules.tenants.permissions import UnsupportedPermissionSet, grants_from_matrix
from app.modules.tenants.persistence import (
    PostgresMembershipRepository,
    PostgresPermissionCatalogRepository,
    PostgresRoleRepository,
    PostgresTenantRepository,
)
from app.modules.tenants.schemas import ROLE_IDS

from .factories import DEMO_MATRIX, SOON, digest, member, role, tenant, user

# ------------------------------------------------------------------ 1-2. tenants and users


def test_tenant_creation_and_retrieval(db_session):
    repo = PostgresTenantRepository(db_session)
    created = repo.create("acme", "  Acme Global Corp ")
    assert repo.get(created.id).name == "Acme Global Corp"
    assert repo.find_by_slug("acme").id == created.id
    assert repo.find_by_slug("nope") is None
    with pytest.raises(NotFound):
        repo.get(uuid7())
    with pytest.raises(Conflict, match="already taken"):
        repo.create("acme", "Again")
    with pytest.raises(ValueError, match="Invalid tenant slug"):
        repo.create("Not A Slug", "X")


def test_user_creation_and_retrieval_with_email_normalization(db_session):
    repo = PostgresUserRepository(db_session)
    created = repo.create("  E.Vance@ACME.io ", "Elena Vance")
    assert created.email == "e.vance@acme.io"
    assert repo.get(created.id).full_name == "Elena Vance"
    assert repo.find_by_email("E.VANCE@acme.IO").id == created.id
    assert repo.find_by_email("not an email") is None
    assert created.password_hash is None  # no password until authentication exists
    with pytest.raises(Conflict, match="already exists"):
        repo.create("e.vance@acme.io", "Someone Else")
    with pytest.raises(ValueError):
        normalize_email("missing-at-sign")


def test_a_user_can_belong_to_several_tenants(db_session):
    u = user(db_session, "e.vance@acme.io")
    acme, globex = tenant(db_session, "acme"), tenant(db_session, "globex")
    member(db_session, acme, u, "admin")
    member(db_session, globex, u, "viewer")
    assert (
        PostgresMembershipRepository(db_session, acme.id).find_by_user(u.id).role_id
        == role(db_session, acme, "admin").id
    )
    assert (
        PostgresMembershipRepository(db_session, globex.id).find_by_user(u.id).role_id
        == role(db_session, globex, "viewer").id
    )


# ------------------------------------------------------------------ 3-4. memberships


def test_membership_creation_and_listing(db_session):
    acme = tenant(db_session, "acme")
    repo = PostgresMembershipRepository(db_session, acme.id)
    active = member(db_session, acme, user(db_session, "a@acme.io"), "analyst", title=" FP&A Analyst ")
    invited = member(db_session, acme, user(db_session, "b@acme.io"), "viewer", status="invited")
    assert active.membership_status == "active" and active.joined_at is not None and active.title == "FP&A Analyst"
    assert invited.joined_at is None
    assert {m.id for m in repo.list()} == {active.id, invited.id}
    assert [m.id for m in repo.list(role_key="viewer")] == [invited.id]


def test_duplicate_membership_is_rejected(db_session):
    acme = tenant(db_session, "acme")
    u = user(db_session, "a@acme.io")
    member(db_session, acme, u)
    with pytest.raises(Conflict, match="already a member"):
        member(db_session, acme, u, "viewer")
    # The surrounding transaction is still usable after the rejected insert.
    assert len(PostgresMembershipRepository(db_session, acme.id).list()) == 1


def test_membership_requires_an_existing_user(db_session):
    acme = tenant(db_session, "acme")
    with pytest.raises(NotFound, match="User not found"):
        PostgresMembershipRepository(db_session, acme.id).add(uuid7(), role(db_session, acme).id)


def test_change_role_and_remove(db_session):
    acme = tenant(db_session, "acme")
    repo = PostgresMembershipRepository(db_session, acme.id)
    m = member(db_session, acme, user(db_session, "a@acme.io"), "analyst")
    assert repo.change_role(m.id, role(db_session, acme, "manager").id).role_id == role(db_session, acme, "manager").id
    repo.remove(m.id)
    with pytest.raises(NotFound):
        repo.get(m.id)


# ------------------------------------------------------------------ 5. roles and permissions


def test_new_tenants_get_the_five_system_roles_with_the_matrix(db_session):
    acme = tenant(db_session, "acme")
    roles = PostgresRoleRepository(db_session, acme.id)
    assert [r.key for r in roles.list()] == list(ROLE_IDS)
    assert [r.name for r in roles.list()] == [
        "Organization Owner",
        "Administrator",
        "Business Manager",
        "Analyst",
        "Viewer",
    ]
    assert roles.matrix() == DEMO_MATRIX
    assert (
        roles.permissions(role(db_session, acme, "owner").id) == PostgresPermissionCatalogRepository(db_session).codes()
    )


def test_role_permission_assignment(db_session):
    acme = tenant(db_session, "acme")
    roles = PostgresRoleRepository(db_session, acme.id)
    viewer = role(db_session, acme, "viewer")
    upgraded = grants_from_matrix(DEMO_MATRIX)["viewer"] | {"connect:read"}  # Connect: None → Read
    roles.set_permissions(viewer.id, upgraded)
    assert roles.permissions(viewer.id) == upgraded
    assert roles.matrix()["connect"]["viewer"] == "Read"


def test_saving_the_matrix_writes_permissions_and_reads_back_identically(db_session):
    acme = tenant(db_session, "acme")
    roles = PostgresRoleRepository(db_session, acme.id)
    edited = {cap: dict(row) for cap, row in DEMO_MATRIX.items()}
    edited["trust"]["viewer"] = "None"
    edited["admin"]["admin"] = "Full"
    assert roles.save_matrix(edited) == edited
    assert "trust:read" not in roles.permissions(role(db_session, acme, "viewer").id)


def test_unsupported_permission_combinations_are_rejected_and_nothing_is_written(db_session):
    acme = tenant(db_session, "acme")
    roles = PostgresRoleRepository(db_session, acme.id)
    viewer = role(db_session, acme, "viewer")
    before = roles.permissions(viewer.id)
    with pytest.raises(UnsupportedPermissionSet):
        roles.set_permissions(viewer.id, before | {"trust:write"})  # resolve without "Edit Rules": no such level
    with pytest.raises(UnsupportedPermissionSet):
        roles.set_permissions(viewer.id, before | {"members:manage"})  # viewers can't hold admin permissions
    with pytest.raises(UnsupportedPermissionSet):
        roles.set_permissions(viewer.id, {"made:up"})
    assert roles.permissions(viewer.id) == before


def test_custom_role_creation_and_duplicate_key(db_session):
    acme = tenant(db_session, "acme")
    roles = PostgresRoleRepository(db_session, acme.id)
    custom = roles.create("auditor", "Auditor", "Reads the audit log")
    roles.set_permissions(custom.id, {"audit:read"})  # custom roles aren't tied to the system matrix
    assert roles.permissions(custom.id) == {"audit:read"}
    with pytest.raises(Conflict, match="already has a role"):
        roles.create("auditor", "Another")


# ------------------------------------------------------------------ 6. sessions


def test_session_creation_listing_and_revocation(db_session):
    acme = tenant(db_session, "acme")
    u = user(db_session, "e.vance@acme.io")
    member(db_session, acme, u)
    sessions = PostgresSessionRepository(db_session, acme.id)
    s = sessions.create(
        u.id, digest(), SOON, device="Chrome on macOS", ip="198.51.100.24", location="San Francisco, US"
    )
    assert str(sessions.get(s.id).ip) == "198.51.100.24"
    assert [x.id for x in sessions.list_active()] == [s.id]
    revoked = sessions.revoke(s.id, "logout")
    assert revoked.revoked_at is not None and revoked.revoked_reason == "logout"
    first_time = revoked.revoked_at
    assert sessions.revoke(s.id, "admin_revoked").revoked_at == first_time  # idempotent, reason preserved
    assert sessions.list_active() == []


def test_sessions_never_accept_raw_tokens_or_invalid_ips(db_session):
    acme = tenant(db_session, "acme")
    u = user(db_session, "e.vance@acme.io")
    member(db_session, acme, u)
    sessions = PostgresSessionRepository(db_session, acme.id)
    with pytest.raises(ValueError, match="32-byte digest"):
        sessions.create(u.id, b"dp_session_raw_token", SOON)
    with pytest.raises(ValueError):
        sessions.create(u.id, digest(), SOON, ip="testclient")
    sessions.create(u.id, digest(), SOON, ip="2001:db8::1")  # IPv6 is fine


def test_only_active_members_can_have_sessions_and_expired_ones_are_not_listed(db_session):
    acme = tenant(db_session, "acme")
    invited = user(db_session, "i@acme.io")
    member(db_session, acme, invited, status="invited")
    sessions = PostgresSessionRepository(db_session, acme.id)
    with pytest.raises(Conflict, match="Only active members"):
        sessions.create(invited.id, digest(), SOON)
    active = user(db_session, "a@acme.io")
    member(db_session, acme, active)
    live = sessions.create(active.id, digest(), SOON)
    now = datetime.now(UTC)
    db_session.add(  # an already-expired session, inserted directly (the repository only creates future expiries)
        UserSession(
            tenant_id=acme.id,
            user_id=active.id,
            token_hash=digest(),
            created_at=now - timedelta(hours=2),
            expires_at=now - timedelta(hours=1),
        )
    )
    db_session.flush()
    assert [s.id for s in sessions.list_active()] == [live.id]


# ------------------------------------------------------------------ 9-10. tenant isolation / cross-tenant denial


@pytest.fixture
def two_tenants(db_session):
    acme, globex = tenant(db_session, "acme"), tenant(db_session, "globex")
    alice, bob = user(db_session, "alice@acme.io"), user(db_session, "bob@globex.io")
    m_alice = member(db_session, acme, alice, "admin")
    m_bob = member(db_session, globex, bob, "admin")
    s_bob = PostgresSessionRepository(db_session, globex.id).create(bob.id, digest(), SOON)
    return {
        "acme": acme,
        "globex": globex,
        "alice": alice,
        "bob": bob,
        "m_bob": m_bob,
        "m_alice": m_alice,
        "s_bob": s_bob,
    }


def test_scoped_lists_only_contain_the_tenants_own_rows(db_session, two_tenants):
    acme = two_tenants["acme"]
    assert [m.id for m in PostgresMembershipRepository(db_session, acme.id).list()] == [two_tenants["m_alice"].id]
    assert {r.tenant_id for r in PostgresRoleRepository(db_session, acme.id).list()} == {acme.id}
    assert PostgresSessionRepository(db_session, acme.id).list_active() == []


def test_another_tenants_ids_behave_exactly_like_missing_ones(db_session, two_tenants):
    acme, t = two_tenants["acme"], two_tenants
    memberships = PostgresMembershipRepository(db_session, acme.id)
    sessions = PostgresSessionRepository(db_session, acme.id)
    roles = PostgresRoleRepository(db_session, acme.id)
    globex_owner = role(db_session, t["globex"], "owner")
    for call in (
        lambda: memberships.get(t["m_bob"].id),
        lambda: memberships.change_role(t["m_bob"].id, role(db_session, acme, "viewer").id),
        lambda: memberships.remove(t["m_bob"].id),
        lambda: sessions.get(t["s_bob"].id),
        lambda: sessions.revoke(t["s_bob"].id, "admin_revoked"),
        lambda: roles.get(globex_owner.id),
        lambda: roles.permissions(globex_owner.id),
        lambda: roles.set_permissions(globex_owner.id, set()),
    ):
        with pytest.raises(NotFound) as caught:
            call()
        assert "globex" not in str(caught.value.message).lower()  # no hint that the row exists elsewhere
    assert memberships.find_by_user(t["bob"].id) is None
    # Nothing in globex changed.
    assert PostgresSessionRepository(db_session, t["globex"].id).get(t["s_bob"].id).revoked_at is None
    assert (
        PostgresMembershipRepository(db_session, t["globex"].id).get(t["m_bob"].id).role_id
        == role(db_session, t["globex"], "admin").id
    )


def test_cannot_assign_another_tenants_role_or_open_a_session_there(db_session, two_tenants):
    acme, t = two_tenants["acme"], two_tenants
    memberships = PostgresMembershipRepository(db_session, acme.id)
    with pytest.raises(NotFound, match="Role not found"):
        memberships.add(t["bob"].id, role(db_session, t["globex"], "owner").id)
    with pytest.raises(NotFound, match="Role not found"):
        memberships.change_role(t["m_alice"].id, role(db_session, t["globex"], "owner").id)
    with pytest.raises(NotFound, match="Membership not found"):
        PostgresSessionRepository(db_session, acme.id).create(t["bob"].id, digest(), SOON)  # bob isn't in acme


# ------------------------------------------------------------------ 11. transaction rollback


def test_repository_work_rolls_back_with_the_unit_of_work(migrated):
    slug = f"rollback-{uuid7().hex[:8]}"
    with pytest.raises(RuntimeError), migrated.session() as s:
        t = tenant(s, slug)
        member(s, t, user(s, f"{slug}@example.com"))
        raise RuntimeError("boom after writing a tenant, its roles, a user and a membership")
    with migrated.session() as s:
        assert s.scalar(select(Tenant).where(Tenant.slug == slug)) is None
        assert s.scalar(select(User).where(User.email == f"{slug}@example.com")) is None


def test_request_transaction_rolls_back_repository_writes_on_a_domain_error(migrated):
    slug = f"req-{uuid7().hex[:8]}"
    app = create_app(Settings(env="test"), database=migrated)

    @app.post("/_probe/tenant")
    def create_then_fail(db: DbSession) -> dict:
        PostgresTenantRepository(db).create(slug, "Probe")
        raise Conflict("Something is in the way")

    r = TestClient(app).post("/_probe/tenant")
    assert r.status_code == 409 and r.json()["error"]["code"] == "conflict"
    with migrated.session() as s:
        assert s.scalar(select(Tenant).where(Tenant.slug == slug)) is None


def test_constraint_errors_reach_clients_as_domain_errors_not_database_details(migrated):
    slug = f"dup-{uuid7().hex[:8]}"
    app = create_app(Settings(env="test"), database=migrated)

    @app.post("/_probe/duplicate")
    def duplicate(db: DbSession) -> dict:
        repo = PostgresTenantRepository(db)
        repo.create(slug, "One")
        repo.create(slug, "Two")
        return {}

    r = TestClient(app).post("/_probe/duplicate")
    assert r.status_code == 409
    assert r.json() == {"error": {"code": "conflict", "message": f"The slug {slug!r} is already taken"}}
    assert "uq_tenants_slug" not in r.text and "psycopg" not in r.text
    with migrated.session() as s:
        assert s.scalar(select(Tenant).where(Tenant.slug == slug)) is None  # the first insert rolled back too
