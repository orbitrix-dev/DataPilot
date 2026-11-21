"""Stage 2B: the Tenants module on PostgreSQL behaves exactly like the in-memory implementation it replaced.

- Parity: every Tenants read, and a sequence of writes, give the same API output as the in-memory service did on
  the same demo data.
- Request context: dev headers resolve against PostgreSQL; tenant lifecycle and membership states are enforced.
- Isolation: another tenant's members, sessions and matrix can't be read or changed.
- Transactions: rollback on errors; audit events only after a successful commit.
- Restart: writes and matrix changes survive a new application instance.
"""

from collections.abc import Iterator
from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient
from pydantic import BaseModel
from sqlalchemy import event, func, select, update
from sqlalchemy.engine import Connection
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.context import Principal, RequestContext
from app.core.db import Database
from app.core.errors import Conflict
from app.deps import Ctx
from app.main import create_app
from app.modules.audit.models import AuditEventRecord
from app.modules.billing import service as billing
from app.modules.identity.models import User, UserSession
from app.modules.identity.persistence import PostgresSessionRepository, PostgresUserRepository
from app.modules.tenants import service
from app.modules.tenants.models import Tenant, TenantMembership, TenantSettings
from app.modules.tenants.persistence import (
    PostgresMembershipRepository,
    PostgresRoleRepository,
    PostgresTenantRepository,
)
from app.modules.tenants.schemas import InviteIn, RoleChangeIn, SecurityPolicy
from app.seed import _members, demo_registry, demo_tenant
from app.seed_postgres import seed_demo
from app.tenant_data import Registry

from .conftest import as_user, audit_events, mfa_code
from .factories import DEMO_MATRIX, SOON, digest, remove_demo

BASE = "http://testserver/api/v1"
MEMBERS = {m.id: m for m in _members()}


@contextmanager
def db(conn: Connection) -> Iterator[Session]:
    """Writes inside the test's transaction (a savepoint), visible to the app's requests."""
    with Session(bind=conn, join_transaction_mode="create_savepoint") as s:
        yield s
        s.commit()


def memory_ctx(user_id: str = "u-elena", data=None) -> RequestContext:
    """A request context over the in-memory implementation: the behaviour Stage 2B must preserve."""
    m = MEMBERS[user_id]
    principal = Principal(kind="user", id=m.id, name=m.name, role=m.role)
    return RequestContext(tenant_id="acme", principal=principal, data=data or demo_tenant(), ip="testclient")


def dump(value) -> object:
    if isinstance(value, list):
        return [dump(v) for v in value]
    return value.model_dump(mode="json") if isinstance(value, BaseModel) else value


# ====================================================================== parity: reads


@pytest.mark.parametrize("user_id", sorted(MEMBERS))
def test_me_matches_the_in_memory_implementation_for_every_demo_member(client, user_id):
    r = client.get("/me", headers=as_user(user_id))
    assert r.status_code == 200
    assert r.json() == dump(service.me(memory_ctx(user_id)))


def test_tenant_reads_match_the_in_memory_implementation(client):
    ctx = memory_ctx()
    expected = {
        "/members": service.list_members(ctx),
        "/members?role=analyst": service.list_members(ctx, "analyst"),
        "/roles": service.list_roles(ctx),
        "/permissions": service.get_matrix(ctx),
        "/settings/security": service.get_policy(ctx),
        "/settings/organization": service.get_org(ctx),
        "/sessions": service.list_sessions(ctx),
        "/api-keys": service.list_keys(ctx),
        "/billing/usage": billing.usage(ctx),
    }
    for path, value in expected.items():
        r = client.get(path)
        assert r.status_code == 200, path
        assert r.json() == dump(value), path


def test_readable_ids_and_field_formats_are_preserved(client):
    me = client.get("/me").json()
    assert me["tenant_id"] == "acme" and me["member"]["id"] == "u-elena"
    member = next(m for m in client.get("/members").json() if m["id"] == "u-elena")
    assert member == {
        "id": "u-elena",
        "name": "Elena Vance",
        "email": "e.vance@acme.io",
        "title": "Finance Manager",
        "role": "admin",
        "status": "active",
        "mfa": "enabled",
        "last_active_at": "2026-11-20T14:32:00Z",
        "ip": "198.51.100.24",
    }
    assert [s["id"] for s in client.get("/sessions").json()] == ["sess-3", "sess-2", "sess-1", "sess-4"]
    assert client.get("/sessions").json()[0]["signed_in_at"] == "2026-11-20T12:30:00Z"


# ====================================================================== parity: writes


def _normalise_members(rows: list[dict]) -> list[dict]:
    return [{**m, "id": "<generated>"} if m["id"] not in MEMBERS else m for m in rows]


def test_a_sequence_of_writes_gives_the_same_results_as_in_memory(client):
    mem = demo_tenant()
    elena, marcus = memory_ctx("u-elena", mem), memory_ctx("u-marcus", mem)
    edited = {cap: dict(row) for cap, row in DEMO_MATRIX.items()}
    edited["trust"]["viewer"] = "None"
    edited["admin"]["admin"] = "Full"
    policy = {"require_mfa": False, "enforce_sso": True, "session_timeout_hours": 8}
    org = {"name": "Acme Holdings", "industry": "Retail", "timezone": "UTC", "audit_retention_days": 90}

    service.invite(elena, InviteIn(email="new.person@acme.io", role="analyst"))
    assert (
        client.post("/members/invitations", json={"email": "new.person@acme.io", "role": "analyst"}).status_code == 201
    )
    service.change_role(elena, "u-david", RoleChangeIn(role="analyst"))
    assert client.patch("/members/u-david/role", json={"role": "analyst"}).status_code == 200
    service.revoke(elena, "u-lena")
    assert client.delete("/members/u-lena").status_code == 204
    service.revoke_session(elena, "sess-3")
    assert client.delete("/sessions/sess-3").status_code == 204
    service.save_matrix(elena, edited)
    assert client.put("/permissions", json={"values": edited}).status_code == 200
    service.set_policy(elena, SecurityPolicy(**policy))
    assert client.put("/settings/security", json=policy).status_code == 200
    service.save_org(elena, service.OrgSettings(**org))
    assert client.put("/settings/organization", json=org).status_code == 200
    service.schedule_deletion(marcus, "Acme Holdings")
    scheduled = client.post(
        "/settings/organization/deletion", json={"confirm_name": "Acme Holdings"}, headers=as_user("u-marcus")
    )
    assert scheduled.status_code == 200 and scheduled.json()["deletion_scheduled_for"] is not None

    assert _normalise_members(client.get("/members").json()) == _normalise_members(dump(service.list_members(elena)))
    for path, value in {
        "/roles": service.list_roles(elena),
        "/permissions": service.get_matrix(elena),
        "/settings/security": service.get_policy(elena),
        "/settings/organization": service.get_org(elena),
        "/sessions": service.list_sessions(elena),
    }.items():
        assert client.get(path).json() == dump(value), path
    # The audit trail of the same operations reads the same (ids and timestamps aside).
    trail = [(e["type"], e["event"], e["detail"]) for e in audit_events(client, limit=50)]
    memory_trail = [(e.type, e.event, e.detail) for e in mem.audit.search(None, None, 50, 0).items]
    assert [t for t in trail if "new.person" not in t[2]] == [t for t in memory_trail if "new.person" not in t[2]]


def test_invited_members_get_the_existing_id_format_and_persist(client, pg_conn):
    r = client.post("/members/invitations", json={"email": "new.person@acme.io", "role": "analyst"})
    new_id = r.json()["id"]
    assert new_id.startswith("u-") and len(new_id) == 12
    with db(pg_conn) as s:
        user = s.scalar(select(User).where(User.public_id == new_id))
        assert user.email == "new.person@acme.io" and user.password_hash is None
        membership = s.scalar(select(TenantMembership).where(TenantMembership.user_id == user.id))
        assert membership.membership_status == "invited" and membership.joined_at is None


def test_permission_updates_round_trip_and_reject_unsupported_levels(client):
    edited = {cap: dict(row) for cap, row in DEMO_MATRIX.items()}
    edited["connect"]["viewer"] = "Read"
    assert client.put("/permissions", json={"values": edited}).status_code == 200
    rows = {r["capability"]: r["values"] for r in client.get("/permissions").json()}
    assert rows == edited
    bad = client.put("/permissions", json={"values": {"trust": {"viewer": "Admin"}}})
    assert bad.status_code == 409 and bad.json()["error"]["details"]["allowed"] == [
        "Full",
        "Edit Rules",
        "View",
        "None",
    ]
    assert {r["capability"]: r["values"] for r in client.get("/permissions").json()} == edited


def test_session_revocation_keeps_the_row(client, pg_conn):
    assert client.delete("/sessions/sess-3").status_code == 204
    with db(pg_conn) as s:
        row = s.scalar(select(UserSession).where(UserSession.public_id == "sess-3"))
        assert row is not None and row.revoked_at is not None and row.revoked_reason == "admin_revoked"
    assert client.delete("/sessions/sess-3").json() == {
        "error": {"code": "not_found", "message": "Session 'sess-3' not found"}
    }


# ====================================================================== request context (dev headers)


def test_dev_headers_resolve_tenant_and_member_from_postgres(client, pg_conn):
    with db(pg_conn) as s:
        s.execute(update(User).where(User.public_id == "u-nora").values(full_name="Nora Renamed"))
    assert client.get("/me", headers=as_user("u-nora")).json()["member"]["name"] == "Nora Renamed"
    assert (
        client.get("/me", headers={"X-DataPilot-Tenant": "acme", **as_user("u-marcus")}).json()["member"]["role"]
        == "owner"
    )


def test_unknown_users_and_tenants_are_rejected_with_the_existing_errors(client):
    r = client.get("/me", headers=as_user("u-nobody"))
    assert r.status_code == 401 and r.json()["error"]["message"] == "Unknown or inactive user"
    r = client.get("/me", headers={"X-DataPilot-Tenant": "globex"})
    assert r.status_code == 401 and r.json()["error"]["message"] == "Unknown tenant 'globex'"


def _set_tenant_status(conn, status: str) -> None:
    with db(conn) as s:
        values = {"status": status, "deleted_at": SOON if status == "deleted" else None}
        s.execute(update(Tenant).where(Tenant.slug == "acme").values(**values))


def test_deleted_tenant_is_indistinguishable_from_an_unknown_one(client, pg_conn):
    _set_tenant_status(pg_conn, "deleted")
    r = client.get("/me")
    assert r.status_code == 401 and r.json() == {"error": {"code": "unauthorized", "message": "Unknown tenant 'acme'"}}


def test_suspended_tenant_is_refused_before_membership_is_checked(client, pg_conn):
    _set_tenant_status(pg_conn, "suspended")
    for headers in ({}, as_user("u-nobody")):  # same answer whether or not the member exists
        r = client.get("/me", headers=headers)
        assert r.status_code == 403
        assert r.json() == {"error": {"code": "forbidden", "message": "This workspace is suspended"}}


def test_suspended_tenant_also_refuses_api_keys(client, pg_conn):
    created = client.post("/api-keys", json={"name": "Reader", "scopes": ["trust:read"], "mfa_code": mfa_code(client)})
    key = {"Authorization": f"Bearer {created.json()['secret']}"}
    assert client.get("/trust/incidents", headers=key).status_code == 200
    _set_tenant_status(pg_conn, "suspended")
    assert client.get("/trust/incidents", headers=key).status_code == 403


@pytest.mark.parametrize(
    "change",
    [
        lambda s: s.execute(update(TenantMembership).values(membership_status="suspended")),
        lambda s: s.execute(update(TenantMembership).values(membership_status="invited", joined_at=None)),
        lambda s: s.execute(update(User).where(User.public_id == "u-elena").values(status="disabled")),
    ],
    ids=["suspended-membership", "invited-membership", "disabled-user"],
)
def test_only_active_memberships_of_active_users_authenticate(client, pg_conn, change):
    with db(pg_conn) as s:
        change(s)
    r = client.get("/me")
    assert r.status_code == 401 and r.json()["error"]["message"] == "Unknown or inactive user"


def test_a_tenant_without_in_memory_module_data_fails_closed(pg_db, pg_conn):
    with db(pg_conn) as s:
        PostgresTenantRepository(s).create("initech", "Initech")
    app = create_app(Settings(env="test"), demo_registry(), database=pg_db)  # registry has only "acme"
    r = TestClient(app, base_url=BASE).get("/me", headers={"X-DataPilot-Tenant": "initech"})
    assert r.status_code == 401 and r.json()["error"]["message"] == "Unknown tenant 'initech'"


def test_suspended_members_are_excluded_from_listings_role_counts_and_seats(client, pg_conn):
    with db(pg_conn) as s:
        nora = s.scalar(select(User.id).where(User.public_id == "u-nora"))
        s.execute(
            update(TenantMembership).where(TenantMembership.user_id == nora).values(membership_status="suspended")
        )
    assert "u-nora" not in [m["id"] for m in client.get("/members").json()]
    assert {r["id"]: r["members"] for r in client.get("/roles").json()}["viewer"] == 1
    assert client.get("/billing/usage").json()["seats"] == 11
    assert client.get("/members/u-nora/role").status_code == 405  # (no such route; contract unchanged)
    assert client.patch("/members/u-nora/role", json={"role": "analyst"}).json()["error"]["message"] == (
        "Member 'u-nora' not found"
    )


# ====================================================================== tenant isolation


@pytest.fixture
def globex(pg_conn) -> dict:
    """A second tenant with its own member (u-bob), roles, matrix and session."""
    with db(pg_conn) as s:
        t = PostgresTenantRepository(s).create("globex", "Globex")
        PostgresRoleRepository(s, t.id).create_system_roles(DEMO_MATRIX)
        bob = PostgresUserRepository(s).create("bob@globex.io", "Bob Globex", public_id="u-bob")
        PostgresMembershipRepository(s, t.id).add(bob.id, PostgresRoleRepository(s, t.id).find_by_key("admin").id)
        PostgresSessionRepository(s, t.id).create(bob.id, digest(), SOON, public_id="sess-globex", ip="203.0.113.50")
        return {"id": t.id}


@pytest.fixture
def two_tenant_client(pg_db, globex) -> TestClient:
    registry = Registry({"acme": demo_tenant(), "globex": demo_tenant()})
    return TestClient(create_app(Settings(env="test"), registry, database=pg_db), base_url=BASE)


def test_each_tenant_sees_only_its_own_members_and_sessions(two_tenant_client):
    c = two_tenant_client
    globex_admin = {"X-DataPilot-Tenant": "globex", **as_user("u-bob")}
    assert [m["id"] for m in c.get("/members", headers=globex_admin).json()] == ["u-bob"]
    assert [s["id"] for s in c.get("/sessions", headers=globex_admin).json()] == ["sess-globex"]
    assert "u-bob" not in [m["id"] for m in c.get("/members").json()]
    assert "sess-globex" not in [s["id"] for s in c.get("/sessions").json()]


def test_cross_tenant_member_and_session_operations_look_like_missing_resources(two_tenant_client, pg_conn):
    c = two_tenant_client
    responses = {
        "role change": c.patch("/members/u-bob/role", json={"role": "viewer"}),
        "revoke member": c.delete("/members/u-bob"),
        "revoke session": c.delete("/sessions/sess-globex"),
        "missing member": c.patch("/members/u-ghost/role", json={"role": "viewer"}),
    }
    for name, r in responses.items():
        assert r.status_code == 404, name
    assert responses["role change"].json()["error"]["message"] == "Member 'u-bob' not found"
    assert responses["missing member"].json()["error"]["message"] == "Member 'u-ghost' not found"
    globex_admin = {"X-DataPilot-Tenant": "globex", **as_user("u-bob")}
    assert c.get("/me", headers=globex_admin).json()["member"]["role"] == "admin"  # unchanged
    assert [s["id"] for s in c.get("/sessions", headers=globex_admin).json()] == ["sess-globex"]


def test_a_member_of_one_tenant_cannot_act_in_another(two_tenant_client):
    r = two_tenant_client.get("/me", headers={"X-DataPilot-Tenant": "globex", **as_user("u-elena")})
    assert r.status_code == 401 and r.json()["error"]["message"] == "Unknown or inactive user"


def test_permission_changes_stay_inside_the_tenant(two_tenant_client):
    c = two_tenant_client
    edited = {cap: dict(row) for cap, row in DEMO_MATRIX.items()}
    edited["trust"]["viewer"] = "None"
    assert c.put("/permissions", json={"values": edited}).status_code == 200
    globex_admin = {"X-DataPilot-Tenant": "globex", **as_user("u-bob")}
    globex_rows = {r["capability"]: r["values"] for r in c.get("/permissions", headers=globex_admin).json()}
    assert globex_rows == DEMO_MATRIX
    assert c.get("/settings/organization", headers=globex_admin).json()["name"] == "Globex"


def test_inviting_someone_who_belongs_to_another_tenant_reuses_their_identity(two_tenant_client):
    r = two_tenant_client.post("/members/invitations", json={"email": "bob@globex.io", "role": "viewer"})
    assert r.status_code == 201 and r.json()["id"] == "u-bob"  # one person, one id, two memberships
    globex_admin = {"X-DataPilot-Tenant": "globex", **as_user("u-bob")}
    assert two_tenant_client.get("/me", headers=globex_admin).json()["member"]["role"] == "admin"


# ====================================================================== transactions and audit


def test_a_domain_error_rolls_back_writes_and_their_audit_events(registry, pg_db, pg_conn):
    app = create_app(Settings(env="test"), registry, database=pg_db)

    @app.post("/api/v1/_probe/invite-then-fail")
    def invite_then_fail(ctx: Ctx) -> None:
        service.invite(ctx, InviteIn(email="rolled.back@acme.io", role="analyst"))  # writes + records an event
        raise Conflict("Something is in the way")

    c = TestClient(app, base_url=BASE)
    before = audit_events(c)
    assert c.post("/_probe/invite-then-fail").status_code == 409
    assert audit_events(c) == before
    with db(pg_conn) as s:
        assert s.scalar(select(User).where(User.email == "rolled.back@acme.io")) is None


def _audit_count(conn) -> int:
    with db(conn) as s:
        return s.scalar(select(func.count()).select_from(AuditEventRecord))


def test_no_audit_event_is_recorded_when_the_commit_fails(client, pg_conn):
    """The event is written in the request's transaction: a failed COMMIT leaves neither the change nor the event."""
    before = _audit_count(pg_conn)

    def fail(session):
        raise RuntimeError("simulated commit failure")

    event.listen(Session, "before_commit", fail)
    try:
        r = TestClient(client.app, base_url=BASE, raise_server_exceptions=False).post(
            "/members/invitations", json={"email": "never.saved@acme.io"}
        )
    finally:
        event.remove(Session, "before_commit", fail)
    assert r.status_code == 500
    assert _audit_count(pg_conn) == before
    with db(pg_conn) as s:
        assert s.scalar(select(User).where(User.email == "never.saved@acme.io")) is None


def test_a_committed_change_and_its_audit_event_are_stored_together(client, pg_conn):
    before = _audit_count(pg_conn)
    assert client.post("/members/invitations", json={"email": "x@acme.io"}).status_code == 201
    assert _audit_count(pg_conn) == before + 1
    assert audit_events(client, limit=1)[0]["detail"] == "Invited x@acme.io as Analyst"


# ====================================================================== restart persistence (committed)


def test_writes_and_matrix_changes_survive_an_application_restart(migrated, owner_database):
    url = Settings().database_url.get_secret_value()
    edited = {cap: dict(row) for cap, row in DEMO_MATRIX.items()}
    edited["trust"]["viewer"] = "None"
    try:
        with migrated.session() as s:
            seed_demo(s)
        first = create_app(Settings(env="test"), demo_registry(), database=Database(url))
        with TestClient(first, base_url=BASE) as c:
            invited = c.post("/members/invitations", json={"email": "restart.test@acme.io", "role": "viewer"}).json()
            assert c.patch("/members/u-david/role", json={"role": "analyst"}).status_code == 200
            assert c.put("/permissions", json={"values": edited}).status_code == 200
            assert (
                c.put(
                    "/settings/security", json={"require_mfa": False, "enforce_sso": False, "session_timeout_hours": 1}
                ).status_code
                == 200
            )
            assert c.delete("/sessions/sess-3").status_code == 204
        # A brand-new app: new engine, new (empty) in-memory registry. Only PostgreSQL carries the state over.
        second = create_app(Settings(env="test"), demo_registry(), database=Database(url))
        with TestClient(second, base_url=BASE) as c:
            members = {m["id"]: m for m in c.get("/members").json()}
            assert members[invited["id"]]["status"] == "invited" and members["u-david"]["role"] == "analyst"
            assert {r["capability"]: r["values"] for r in c.get("/permissions").json()} == edited
            assert c.get("/settings/security").json()["session_timeout_hours"] == 1
            assert "sess-3" not in [x["id"] for x in c.get("/sessions").json()]
            assert (
                c.get("/trust/incidents", headers=as_user("u-nora")).status_code == 403
            )  # the persisted matrix applies
    finally:
        with owner_database.session() as s:
            remove_demo(s, extra_emails=("restart.test@acme.io",))
    with migrated.session() as s:
        assert s.scalar(select(Tenant).where(Tenant.slug == "acme")) is None
        assert s.scalar(select(TenantSettings)) is None
