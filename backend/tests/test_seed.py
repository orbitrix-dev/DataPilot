"""The PostgreSQL demo seed: idempotent, identical to the in-memory demo, never overwriting edits, and free of usable
credentials."""

import hashlib

from sqlalchemy import func, select, update

from app.cli import main
from app.core.config import Settings
from app.modules.audit.models import AuditEventRecord
from app.modules.identity.models import User, UserSession
from app.modules.tenants.models import ApiKey, Role, RolePermission, Tenant, TenantMembership, TenantSettings
from app.modules.tenants.permissions import grants_from_matrix
from app.modules.tenants.persistence import DEFAULT_SETTINGS, PostgresMembershipRepository, PostgresRoleRepository
from app.seed import _members, _sessions, _workspace
from app.seed_postgres import DEMO_TENANT_SLUG, seed_demo

from .factories import remove_demo

DEMO_MATRIX = _workspace().matrix
EXPECTED_GRANTS = sum(len(p) for p in grants_from_matrix(DEMO_MATRIX).values())
FIRST_RUN = {
    "tenants": 1,
    "settings": 1,
    "users": 12,
    "roles": 5,
    "role_permissions": EXPECTED_GRANTS,
    "memberships": 12,
    "sessions": 4,
    "audit_events": 12,
    "api_keys": 2,
}


def counts(s) -> dict[str, int]:
    models = {
        "tenants": Tenant,
        "settings": TenantSettings,
        "users": User,
        "roles": Role,
        "role_permissions": RolePermission,
        "memberships": TenantMembership,
        "sessions": UserSession,
        "audit_events": AuditEventRecord,
        "api_keys": ApiKey,
    }
    return {name: s.scalar(select(func.count()).select_from(model)) for name, model in models.items()}


def digests(s) -> dict[str, bytes]:
    return dict(s.execute(select(UserSession.public_id, UserSession.token_hash)).all())


def test_first_run_creates_the_demo_tenant(db_session):
    report = seed_demo(db_session)
    assert report.created == FIRST_RUN
    assert counts(db_session) == FIRST_RUN


def test_running_it_again_creates_nothing_and_changes_nothing(db_session):
    first = seed_demo(db_session)
    ids_before = set(db_session.scalars(select(User.id))) | set(db_session.scalars(select(Role.id)))
    digests_before = digests(db_session)
    second = seed_demo(db_session)
    assert second.total_created == 0 and second.tenant_id == first.tenant_id
    assert set(db_session.scalars(select(User.id))) | set(db_session.scalars(select(Role.id))) == ids_before
    assert digests(db_session) == digests_before  # session digests are never replaced
    assert counts(db_session) == FIRST_RUN


def test_seeded_data_matches_the_in_memory_demo(db_session):
    tenant_id = seed_demo(db_session).tenant_id
    assert db_session.get(Tenant, tenant_id).name == "Acme Global Corp"
    roles = PostgresRoleRepository(db_session, tenant_id)
    assert roles.matrix() == DEMO_MATRIX
    key_of = {r.id: r.key for r in roles.list()}
    seeded = {}
    for m in PostgresMembershipRepository(db_session, tenant_id).list():
        user = db_session.get(User, m.user_id)
        seeded[user.public_id] = (user.email, key_of[m.role_id], m.title, m.membership_status, m.last_active_at)
    assert seeded == {m.id: (m.email, m.role, m.title, "active", m.last_active_at) for m in _members()}
    mfa = {u.public_id: u.mfa_enrolled_at is not None for u in db_session.scalars(select(User))}
    assert mfa == {m.id: m.mfa == "enabled" for m in _members()}
    settings = db_session.get(TenantSettings, tenant_id)
    ws = _workspace()
    assert (settings.require_mfa, settings.enforce_sso, settings.session_timeout_hours, settings.industry) == (
        ws.policy.require_mfa,
        ws.policy.enforce_sso,
        ws.policy.session_timeout_hours,
        ws.org.industry,
    )
    assert set(digests(db_session)) == {s.id for s in _sessions()}


def test_demo_sessions_can_never_authenticate(db_session):
    seed_demo(db_session)
    assert db_session.scalar(select(func.count()).select_from(User).where(User.password_hash.is_not(None))) == 0
    stored = digests(db_session)
    assert len(set(stored.values())) == 4 and all(len(d) == 32 for d in stored.values())
    # Not derived from anything guessable (the token was random and discarded).
    for public_id, digest in stored.items():
        for guess in (public_id, f"{public_id}-token", DEMO_TENANT_SLUG, ""):
            assert digest != hashlib.sha256(guess.encode()).digest()


def test_re_seeding_preserves_edits(db_session):
    tenant_id = seed_demo(db_session).tenant_id
    roles = PostgresRoleRepository(db_session, tenant_id)
    edited = {cap: dict(row) for cap, row in DEMO_MATRIX.items()}
    edited["trust"]["viewer"] = "None"
    roles.save_matrix(edited)
    db_session.execute(update(TenantSettings).values(session_timeout_hours=1, require_mfa=False))
    db_session.execute(update(TenantMembership).values(title="Edited"))
    seed_demo(db_session)
    assert roles.matrix() == edited
    assert db_session.get(TenantSettings, tenant_id).session_timeout_hours == 1
    assert set(db_session.scalars(select(TenantMembership.title))) == {"Edited"}


def test_backfilled_default_settings_are_replaced_once(db_session):
    """A tenant that existed before tenant_settings got DEFAULT_SETTINGS from migration 0002: the seed writes the
    demo settings over exactly those values, once."""
    tenant_id = seed_demo(db_session).tenant_id
    db_session.execute(update(TenantSettings).where(TenantSettings.tenant_id == tenant_id).values(**DEFAULT_SETTINGS))
    report = seed_demo(db_session)
    assert report.created["settings"] == 1
    assert db_session.get(TenantSettings, tenant_id).require_mfa is True  # the demo value
    assert seed_demo(db_session).created["settings"] == 0


def test_columns_added_later_are_filled_only_where_empty(db_session):
    """Data seeded before migration 0002 has NULL activity/MFA columns: the seed fills them, never overwrites."""
    seed_demo(db_session)
    db_session.execute(update(TenantMembership).values(last_active_at=None, last_active_ip=None))
    db_session.execute(update(User).where(User.public_id == "u-elena").values(mfa_enrolled_at=None))
    seed_demo(db_session)
    assert (
        db_session.scalar(
            select(func.count()).select_from(TenantMembership).where(TenantMembership.last_active_at.is_(None))
        )
        == 0
    )
    assert db_session.scalar(select(User.mfa_enrolled_at).where(User.public_id == "u-elena")) is not None


def test_migration_defaults_match_the_code():
    from importlib import import_module

    migration = import_module("migrations.versions.0002_tenants_persistence")
    assert migration.DEFAULT_SETTINGS == DEFAULT_SETTINGS
    assert dict(migration.DEMO_PUBLIC_IDS) == {m.email: m.id for m in _members()}


def test_cli_is_idempotent_end_to_end(migrated, owner_database, capsys):
    """Runs the real command twice against the test database (committing), then removes what it created."""
    settings = Settings(env="test")
    try:
        assert main(["seed-demo"], settings) == 0
        assert "created. Rows created: tenants 1, settings 1, users 12, roles 5" in capsys.readouterr().out
        assert main(["seed-demo"], settings) == 0
        assert "nothing new (already seeded)" in capsys.readouterr().out
        with migrated.session() as s:
            assert counts(s) == FIRST_RUN
    finally:
        with owner_database.session() as s:
            remove_demo(s)
    with migrated.session() as s:
        assert counts(s) == dict.fromkeys(FIRST_RUN, 0)


def test_cli_refuses_to_seed_production(migrated, capsys):
    prod = Settings(env="prod", database_url=Settings().database_url.get_secret_value())
    assert main(["seed-demo"], prod) == 2
    assert "Refusing" in capsys.readouterr().err
    with migrated.session() as s:
        assert counts(s)["tenants"] == 0


def test_seed_runs_entirely_as_the_runtime_user(db_session):
    """db_session connects as datapilot_app: the seed needs only the runtime privileges (no catalog writes)."""
    from sqlalchemy import text

    assert db_session.execute(text("SELECT current_user")).scalar_one() == "datapilot_app"
    assert seed_demo(db_session).created == FIRST_RUN
    assert seed_demo(db_session).total_created == 0


def test_demo_audit_ids_are_deterministic_valid_uuid7(db_session):
    from app.seed import _audit

    seed_demo(db_session)
    stored = dict(db_session.execute(select(AuditEventRecord.id, AuditEventRecord.occurred_at)).all())
    expected = {e.id: e.occurred_at for e in _audit()}
    assert stored == expected  # same ids on every run (deterministic)
    for event_id, occurred_at in stored.items():
        assert event_id.version == 7 and int(event_id.hex[:12], 16) == int(occurred_at.timestamp() * 1000)
