"""The PostgreSQL demo seed: idempotent, identical to the in-memory demo, and free of usable credentials."""

from sqlalchemy import delete, func, select

from app.cli import main
from app.core.config import Settings
from app.modules.identity.models import User, UserSession
from app.modules.tenants.models import Role, RolePermission, Tenant, TenantMembership
from app.modules.tenants.permissions import grants_from_matrix
from app.modules.tenants.persistence import PostgresMembershipRepository, PostgresRoleRepository
from app.seed import _members, _workspace
from app.seed_postgres import DEMO_TENANT_SLUG, seed_demo

DEMO_MATRIX = _workspace().matrix
EXPECTED_GRANTS = sum(len(p) for p in grants_from_matrix(DEMO_MATRIX).values())


def counts(s) -> dict[str, int]:
    return {
        "tenants": s.scalar(select(func.count()).select_from(Tenant)),
        "users": s.scalar(select(func.count()).select_from(User)),
        "roles": s.scalar(select(func.count()).select_from(Role)),
        "role_permissions": s.scalar(select(func.count()).select_from(RolePermission)),
        "memberships": s.scalar(select(func.count()).select_from(TenantMembership)),
        "sessions": s.scalar(select(func.count()).select_from(UserSession)),
    }


def test_first_run_creates_the_demo_tenant(db_session):
    report = seed_demo(db_session)
    assert report.created == {
        "tenants": 1,
        "users": 12,
        "roles": 5,
        "role_permissions": EXPECTED_GRANTS,
        "memberships": 12,
    }
    assert counts(db_session) == {**report.created, "sessions": 0}


def test_running_it_again_creates_nothing_and_keeps_ids(db_session):
    first = seed_demo(db_session)
    ids_before = set(db_session.scalars(select(User.id))) | set(db_session.scalars(select(Role.id)))
    second = seed_demo(db_session)
    assert second.total_created == 0 and second.tenant_id == first.tenant_id
    assert set(db_session.scalars(select(User.id))) | set(db_session.scalars(select(Role.id))) == ids_before
    assert counts(db_session)["role_permissions"] == EXPECTED_GRANTS


def test_seeded_data_matches_the_in_memory_demo(db_session):
    tenant_id = seed_demo(db_session).tenant_id
    assert db_session.get(Tenant, tenant_id).name == "Acme Global Corp"
    roles = PostgresRoleRepository(db_session, tenant_id)
    assert roles.matrix() == DEMO_MATRIX  # the five roles with exactly today's permission matrix
    key_of = {r.id: r.key for r in roles.list()}
    seeded = {
        db_session.get(User, m.user_id).email: (key_of[m.role_id], m.title, m.membership_status)
        for m in PostgresMembershipRepository(db_session, tenant_id).list()
    }
    assert seeded == {m.email: (m.role, m.title, "active") for m in _members()}
    assert {u.full_name for u in db_session.scalars(select(User))} == {m.name for m in _members()}


def test_seed_creates_no_usable_credentials(db_session):
    seed_demo(db_session)
    assert db_session.scalar(select(func.count()).select_from(User).where(User.password_hash.is_not(None))) == 0
    assert counts(db_session)["sessions"] == 0


def test_re_seeding_preserves_permission_edits(db_session):
    tenant_id = seed_demo(db_session).tenant_id
    roles = PostgresRoleRepository(db_session, tenant_id)
    edited = {cap: dict(row) for cap, row in DEMO_MATRIX.items()}
    edited["trust"]["viewer"] = "None"
    roles.save_matrix(edited)
    seed_demo(db_session)
    assert roles.matrix() == edited  # insert-only: existing rows are never overwritten


def test_cli_is_idempotent_end_to_end(migrated, capsys):
    """Runs the real command twice against the test database (committing), then removes what it created."""
    settings = Settings(env="test")
    try:
        assert main(["seed-demo"], settings) == 0
        assert "created. Rows created: tenants 1, users 12, roles 5" in capsys.readouterr().out
        assert main(["seed-demo"], settings) == 0
        assert "nothing new (already seeded)" in capsys.readouterr().out
        with migrated.session() as s:
            assert counts(s) == {
                "tenants": 1,
                "users": 12,
                "roles": 5,
                "role_permissions": EXPECTED_GRANTS,
                "memberships": 12,
                "sessions": 0,
            }
    finally:
        with migrated.session() as s:
            tenant_id = s.scalar(select(Tenant.id).where(Tenant.slug == DEMO_TENANT_SLUG))
            if tenant_id is not None:
                s.execute(delete(TenantMembership).where(TenantMembership.tenant_id == tenant_id))
                s.execute(delete(Role).where(Role.tenant_id == tenant_id))  # cascades to role_permissions
                s.execute(delete(Tenant).where(Tenant.id == tenant_id))
            s.execute(delete(User).where(User.email.in_([m.email for m in _members()])))
    with migrated.session() as s:
        assert counts(s) == dict.fromkeys(counts(s), 0)


def test_cli_refuses_to_seed_production(migrated, capsys):
    prod = Settings(env="prod", database_url=Settings().database_url.get_secret_value())
    assert main(["seed-demo"], prod) == 2
    assert "Refusing" in capsys.readouterr().err
    with migrated.session() as s:
        assert counts(s)["tenants"] == 0
