"""Stage 3A.1: the PostgreSQL audit log, its action registry, allowlists, production guards, authorization and the
independent SecurityAuditWriter."""

import ast
import logging
import uuid
from collections.abc import Callable
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, event, func, select, text
from sqlalchemy.orm import Session

from app.core import clock
from app.core.config import BACKEND_DIR, Settings
from app.core.context import Principal, RequestContext
from app.core.errors import ServiceUnavailable
from app.core.readiness import ProductionNotReady, production_blockers
from app.db.base import uuid7
from app.main import create_app
from app.modules.audit import actions, retention
from app.modules.audit import service as audit
from app.modules.audit.actions import ACTIONS, AuditAction
from app.modules.audit.models import AuditEventRecord
from app.modules.audit.repository import AuditEntry, InMemoryAuditRepository, PostgresAuditRepository
from app.modules.audit.sanitize import REDACTED, redact
from app.modules.audit.security_writer import SecurityAuditWriter
from app.modules.auth import enforcement
from app.modules.identity.persistence import PostgresUserRepository
from app.modules.tenants.persistence import (
    PostgresMembershipRepository,
    PostgresRoleRepository,
    PostgresTenantRepository,
)
from app.seed import DEMO_AUDIT_ACTIONS, demo_registry, demo_tenant
from app.tenant_data import Registry

from .conftest import TEST_DATABASE_URL, as_user, audit_events, mfa_code
from .factories import DEMO_MATRIX

BASE = "http://testserver/api/v1"
MEMORY_ACTIONS = {a.code for a in ACTIONS.values() if a.business_store == "memory"}


def db(conn):
    s = Session(bind=conn, join_transaction_mode="create_savepoint")
    return s


def count(conn, action: str | None = None) -> int:
    with db(conn) as s:
        query = select(func.count()).select_from(AuditEventRecord)
        if action:
            query = query.where(AuditEventRecord.action == action)
        return s.scalar(query)


# ====================================================================== registry & consistency review


def _call_site_actions() -> list[tuple[str, str]]:
    found = []
    for path in sorted((BACKEND_DIR / "app" / "modules").rglob("service.py")):
        for node in ast.walk(ast.parse(path.read_text())):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr == "record"
                and isinstance(node.func.value, ast.Name)
                and node.func.value.id == "audit"
            ):
                arg = node.args[1]
                assert isinstance(arg, ast.Constant), f"{path}: audit.record action must be a literal code"
                found.append((str(path.relative_to(BACKEND_DIR)), arg.value))
    return found


def test_all_18_audit_call_sites_use_registered_action_codes():
    sites = _call_site_actions()
    assert len(sites) == 18
    unregistered = [(p, a) for p, a in sites if a not in ACTIONS]
    assert unregistered == []


def _record_event_actions() -> list[tuple[str, str]]:
    """Actions recorded with audit.service.record_event (flows without a request context: invitations, sign-in, MFA),
    directly or through mfa._audit_everywhere (which forwards its literal action to record_event)."""
    found = []
    for path in sorted((BACKEND_DIR / "app" / "modules").rglob("*.py")):
        for node in ast.walk(ast.parse(path.read_text())):
            if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)):
                continue
            if node.func.id == "record_event":
                arg = node.args[1]
                if isinstance(arg, ast.Name) and arg.id == "action" and path.name == "mfa.py":
                    continue  # the forwarding call inside _audit_everywhere
            elif node.func.id == "_audit_everywhere":
                arg = node.args[3]
            else:
                continue
            assert isinstance(arg, ast.Constant), f"{path}: the audit action must be a literal code"
            found.append((str(path.relative_to(BACKEND_DIR)), arg.value))
    return found


def test_record_event_call_sites_use_registered_action_codes():
    sites = _record_event_actions()
    assert sorted(a for _, a in sites) == sorted(
        [
            "user.invitation_issued",
            "user.invitation_accepted",
            "login.succeeded",
            "login.refresh_reuse_detected",
            "login.logout",
            "login.recovery_code_used",
            "user.mfa_enrolled",  # through _audit_everywhere (one event per active membership)
            "user.recovery_codes_regenerated",
        ]
    )
    assert all(a in ACTIONS for _, a in sites)


def test_every_registered_action_is_used_by_a_call_site_the_demo_history_or_the_security_writer():
    used = (
        {a for _, a in _call_site_actions()}
        | {a for _, a in _record_event_actions()}
        | set(DEMO_AUDIT_ACTIONS.values())
        | SECURITY_WRITER_ACTIONS
    )
    assert used == set(ACTIONS)


# Recorded through SecurityAuditWriter (rejected requests). Each must be named in the code that records it.
SECURITY_WRITER_ACTIONS = {
    "login.failed",
    "login.blocked",
    "api-key.rejected",
    "api-key.step_up_failed",
    "user.recovery_codes_step_up_failed",
}


def test_security_writer_actions_are_registered_and_used():
    sources = "".join(p.read_text() for p in (BACKEND_DIR / "app").rglob("*.py"))
    for action in SECURITY_WRITER_ACTIONS:
        assert action in ACTIONS and ACTIONS[action].production_enabled, action
        assert f'"{action}"' in sources, action


def test_every_action_declares_store_durability_production_and_an_allowlist():
    for a in ACTIONS.values():
        assert a.business_store in ("postgres", "memory"), a.code
        assert a.durability in ("durable", "transitional"), a.code
        assert isinstance(a.production_enabled, bool), a.code
        assert (a.business_store == "memory") == (a.durability == "transitional"), a.code
        assert all(t in ("str", "int", "bool", "list[str]") for t in a.metadata.values()), a.code


def test_memory_backed_actions_are_exactly_the_in_memory_modules_and_never_production_enabled():
    assert {
        "workflow.approved",
        "workflow.rejected",
        "billing.plan_changed",
        "billing.plan_change_requested",
        "connection.credential_rotated",
        "settings.notifications_changed",
    } == MEMORY_ACTIONS
    assert not any(ACTIONS[c].production_enabled for c in MEMORY_ACTIONS)


# ====================================================================== allowlists and redaction


def _ctx(environment: str = "test") -> RequestContext:
    data = demo_tenant()
    principal = Principal(kind="user", id="u-elena", name="Elena Vance", role="admin")
    return RequestContext("acme", principal, data, "198.51.100.24", environment=environment)


@pytest.mark.parametrize(
    ("metadata", "error"),
    [
        ({"email": "a@acme.io", "unexpected": "x"}, "not allowed"),
        ({"email": 5}, "must be a string"),
        ({"email": {"nested": "x"}}, "must be a string"),
        ({"email": "x" * 201}, "longer than 200"),
    ],
)
def test_metadata_outside_the_actions_allowlist_is_rejected(metadata, error):
    with pytest.raises(ValueError, match=error):
        audit.record(_ctx(), "user.invited", "Invited", metadata=metadata)


def test_list_and_bool_metadata_types_are_enforced():
    with pytest.raises(ValueError, match="list of at most"):
        audit.record(_ctx(), "api-key.created", "x", metadata={"scopes": ["a"] * 21})
    with pytest.raises(ValueError, match="must be a boolean"):
        audit.record(_ctx(), "settings.notifications_changed", "x", metadata={"enabled": "yes"})
    with pytest.raises(ValueError, match="Unregistered audit action"):
        audit.record(_ctx(), "user.made_up", "x")


def test_registry_refuses_forbidden_metadata_keys(monkeypatch):
    bad = AuditAction("user.invited", "X", "postgres", "durable", True, actions.MappingProxyType({"api_key": "str"}))
    monkeypatch.setattr(actions, "_ACTIONS", (bad,))
    monkeypatch.setattr(actions, "ACTIONS", actions.MappingProxyType({bad.code: bad}))
    with pytest.raises(RuntimeError, match="forbidden"):
        actions._validate_registry()


@pytest.mark.parametrize(
    "secret",
    [
        "dp_live_0123456789abcdef0123456789abcdef01234567",
        "Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig",
        "$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA",
        "a" * 32 + "0123456789",
    ],
)
def test_secrets_are_redacted_from_summaries_and_metadata(secret):
    entry = audit.record(_ctx(), "user.invited", f"Invited using {secret}", metadata={"email": f"x {secret}"})
    assert secret not in entry.summary and REDACTED in entry.summary
    assert secret not in entry.metadata["email"]


def test_masked_key_prefixes_are_not_redacted():
    assert (
        redact("Created Reader, prefix dp_live_••••9f2a (trust:read)")
        == "Created Reader, prefix dp_live_••••9f2a (trust:read)"
    )


def test_every_real_call_site_produces_secret_free_events(client):
    """Drive the API's audited operations and check every stored summary and metadata value."""
    created = client.post("/api-keys", json={"name": "Reader", "scopes": ["trust:read"], "mfa_code": mfa_code(client)})
    secret = created.json()["secret"]
    client.post(f"/api-keys/{created.json()['key']['id']}/revoke")
    client.put("/connect/connections/amazon-s3-raw-orders/credentials", json={"secret": "AKIA-new-secret-value"})
    for e in audit_events(client, limit=500):
        assert secret not in e["detail"] and "AKIA-new-secret-value" not in e["detail"]


# ====================================================================== memory-backed actions: transitional guarantees

MemoryCase = tuple[str, str, str, dict, dict, Callable[[object], bool]]
MEMORY_CASES: list[MemoryCase] = [
    (
        "workflow.approved",
        "POST",
        "/automate/approvals/REQ-9041/approve",
        {},
        {},
        lambda reg: reg.get("acme").automate.requests.get("REQ-9041").status == "approved",
    ),
    (
        "workflow.rejected",
        "POST",
        "/automate/approvals/REQ-9038/reject",
        {"reason": "stale"},
        {},
        lambda reg: reg.get("acme").automate.requests.get("REQ-9038").status == "rejected",
    ),
    (
        "billing.plan_change_requested",
        "POST",
        "/billing/plan-change",
        {"plan": "scale"},
        {},
        lambda reg: reg.get("acme").billing.subscription.get("subscription").requested_plan == "scale",
    ),
    (
        "billing.plan_changed",
        "POST",
        "/billing/plan-change",
        {"plan": "scale"},
        as_user("u-marcus"),
        lambda reg: reg.get("acme").billing.subscription.get("subscription").plan == "scale",
    ),
    (
        "connection.credential_rotated",
        "PUT",
        "/connect/connections/amazon-s3-raw-orders/credentials",
        {"secret": "x"},
        {},
        lambda reg: reg.get("acme").connect.connections.get("amazon-s3-raw-orders").status == "healthy",
    ),
    (
        "settings.notifications_changed",
        "PUT",
        "/notifications/preferences/approvals",
        {"enabled": False},
        {},
        lambda reg: reg.get("acme").notifications.get("preferences").approvals is False,
    ),
]


@pytest.mark.parametrize("case", MEMORY_CASES, ids=[c[0] for c in MEMORY_CASES])
def test_memory_action_success_records_one_durable_event(client, registry, pg_conn, case):
    action, method, path, body, headers, changed = case
    before = count(pg_conn, action)
    r = client.request(method, path, json=body, headers=headers)
    assert r.status_code in (200, 201), r.text
    assert changed(registry) and count(pg_conn, action) == before + 1


@pytest.mark.parametrize("case", MEMORY_CASES, ids=[c[0] for c in MEMORY_CASES])
def test_memory_action_commit_failure_loses_the_event_but_not_the_in_memory_change(client, registry, pg_conn, case):
    """Documented transitional behaviour: NOT atomic. The event is missing; the in-memory change remains."""
    action, method, path, body, headers, changed = case
    before = count(pg_conn, action)

    def fail(session):
        raise RuntimeError("simulated commit failure")

    event.listen(Session, "before_commit", fail)
    try:
        r = TestClient(client.app, base_url=BASE, raise_server_exceptions=False).request(
            method, path, json=body, headers=headers
        )
    finally:
        event.remove(Session, "before_commit", fail)
    assert r.status_code == 500
    assert count(pg_conn, action) == before  # no event...
    assert changed(registry)  # ...but the in-memory change happened


def test_memory_actions_never_record_phantom_success_events(client, pg_conn):
    before = count(pg_conn)
    assert client.post("/billing/plan-change", json={"plan": "growth"}).status_code == 409  # already on it
    assert client.post("/automate/approvals/REQ-9040/approve", json={}).status_code == 409  # unacknowledged issue
    assert count(pg_conn) == before


def test_after_a_restart_the_event_survives_but_the_in_memory_change_does_not(pg_db, pg_conn):
    first = TestClient(create_app(Settings(env="test"), demo_registry(), database=pg_db), base_url=BASE)
    assert first.put("/notifications/preferences/approvals", json={"enabled": False}).status_code == 200
    second = TestClient(create_app(Settings(env="test"), demo_registry(), database=pg_db), base_url=BASE)
    prefs = {p["category"]: p["enabled"] for p in second.get("/notifications/preferences").json()}
    assert prefs["approvals"] is True  # the in-memory state is gone
    assert audit_events(second, limit=1)[0]["detail"] == "Disabled Automate Approval Requests"  # the event isn't


# ====================================================================== production guards


def test_production_is_blocked_while_retention_is_not_enforced():
    assert retention.is_enforced() is False
    assert any("retention is not enforced" in b for b in production_blockers())


def test_production_is_blocked_if_a_memory_backed_action_is_production_enabled(monkeypatch):
    monkeypatch.setattr(retention, "is_enforced", lambda: True)
    monkeypatch.setattr(enforcement, "abuse_protection_enforced", lambda: True)
    good = [a for a in ACTIONS.values() if a.business_store == "postgres"]
    assert production_blockers(good) == []
    sneaky = AuditAction("billing.plan_changed", "Plan Changed", "memory", "transitional", True)
    assert production_blockers([*good, sneaky]) == [
        "Audit action 'billing.plan_changed' is production-enabled but its business state is memory/transitional"
    ]


def test_the_real_registry_currently_passes_the_action_check(monkeypatch):
    monkeypatch.setattr(retention, "is_enforced", lambda: True)
    monkeypatch.setattr(enforcement, "abuse_protection_enforced", lambda: True)
    assert production_blockers() == []


def test_production_startup_refuses_to_run(migrated):
    app = create_app(Settings(env="prod", database_url=TEST_DATABASE_URL), demo_registry())
    with pytest.raises(ProductionNotReady, match="retention is not enforced"), TestClient(app):
        pass
    with TestClient(create_app(Settings(env="test"), demo_registry())) as c:  # dev/test start normally
        assert c.get("/healthz").status_code == 200


def test_there_is_no_configuration_switch_to_bypass_the_guards():
    assert not [f for f in Settings.model_fields if "retention" in f or "enforce" in f or "readiness" in f]


def test_production_refuses_actions_that_are_not_production_enabled():
    with pytest.raises(ServiceUnavailable, match="not available in production"):
        audit.record(_ctx("prod"), "settings.notifications_changed", "x")
    entry = audit.record(_ctx("prod"), "user.invited", "Invited x", metadata={"email": "x@acme.io"})
    assert entry.action == "user.invited"


# ====================================================================== authorization and isolation


@pytest.mark.parametrize("user_id", ["u-david", "u-lena", "u-nora"])
def test_only_owners_and_administrators_can_read_audit_events(client, user_id):
    assert client.get("/audit-events", headers=as_user(user_id)).status_code == 403
    assert client.get("/audit-events", headers=as_user("u-marcus")).status_code == 200


def test_api_keys_cannot_read_audit_events_whatever_their_scopes(client):
    all_scopes = ["insights:read", "trust:read", "connect:read", "automate:read", "intelligence:query"]
    created = client.post("/api-keys", json={"name": "Everything", "scopes": all_scopes, "mfa_code": mfa_code(client)})
    r = client.get("/audit-events", headers={"Authorization": f"Bearer {created.json()['secret']}"})
    assert r.status_code == 403


@pytest.fixture
def globex_client(pg_db, pg_conn) -> TestClient:
    """A second tenant (globex, admin u-bob) with one event of its own, plus one global security event."""
    with db(pg_conn) as s:
        t = PostgresTenantRepository(s).create("globex", "Globex")
        PostgresRoleRepository(s, t.id).create_system_roles(DEMO_MATRIX)
        bob = PostgresUserRepository(s).create("bob@globex.io", "Bob Globex", public_id="u-bob")
        PostgresMembershipRepository(s, t.id).add(bob.id, PostgresRoleRepository(s, t.id).find_by_key("admin").id)
        principal = Principal(kind="user", id="u-bob", name="Bob Globex", role="admin")
        data = replace(demo_tenant(), audit=PostgresAuditRepository(s, t.id))
        ctx = RequestContext("globex", principal, data, "203.0.113.50")
        audit.record(ctx, "user.invited", "GLOBEX-ONLY invitation", metadata={"email": "x@globex.io"})
        s.add(
            AuditEventRecord(
                id=uuid7(),
                tenant_id=None,
                occurred_at=clock.now(),
                action="api-key.rejected",
                actor_type="anonymous",
                actor_label="Anonymous",
                summary="GLOBAL-SECURITY rejected key",
            )
        )
        s.commit()
    registry = Registry({"acme": demo_tenant(), "globex": demo_tenant()})
    return TestClient(create_app(Settings(env="test"), registry, database=pg_db), base_url=BASE)


def test_a_tenant_never_sees_another_tenants_events_or_global_events(globex_client):
    c = globex_client
    acme = c.get("/audit-events", params={"limit": 500}).json()
    assert acme["total"] == 12
    assert not [e for e in acme["items"] if "GLOBEX-ONLY" in e["detail"] or "GLOBAL-SECURITY" in e["detail"]]
    globex = c.get("/audit-events", headers={"X-DataPilot-Tenant": "globex", **as_user("u-bob")}).json()
    assert [e["detail"] for e in globex["items"]] == ["GLOBEX-ONLY invitation"]


def test_query_parameters_cannot_widen_the_scope(globex_client):
    c = globex_client
    for params in (
        {"q": "GLOBEX-ONLY"},
        {"q": "GLOBAL-SECURITY"},
        {"type": "api-key", "q": "rejected"},
        {"tenant_id": "globex", "limit": 500},
        {"tenant": "globex", "offset": 0, "limit": 500},
    ):
        items = c.get("/audit-events", params=params).json()["items"]
        assert not [e for e in items if "GLOBEX" in e["detail"] or "GLOBAL" in e["detail"]], params
    # Switching tenants needs a membership there.
    assert c.get("/audit-events", headers={"X-DataPilot-Tenant": "globex"}).status_code == 401


def test_api_ids_are_uuid7_strings(client):
    for e in audit_events(client, limit=500):
        assert uuid.UUID(e["id"]).version == 7


# ====================================================================== SecurityAuditWriter (built, not wired)


def _remove_global(owner_database, summary: str) -> None:
    with owner_database.session() as s:
        s.execute(text("ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only"))
        s.execute(delete(AuditEventRecord).where(AuditEventRecord.summary == summary))
        s.execute(text("ALTER TABLE audit_events ENABLE TRIGGER audit_events_append_only"))


def test_security_events_survive_the_callers_rollback(migrated, owner_database):
    writer = SecurityAuditWriter(TEST_DATABASE_URL)
    summary = f"rejected key probe {uuid.uuid4().hex[:8]}"
    try:
        with pytest.raises(RuntimeError), migrated.session():
            assert writer.record("api-key.rejected", summary, client="198.51.100.9", metadata={"reason": "unknown"})
            raise RuntimeError("the request fails after recording")
        with owner_database.session() as s:
            row = s.scalar(select(AuditEventRecord).where(AuditEventRecord.summary == summary))
            assert row.tenant_id is None and row.actor_type == "anonymous" and str(row.ip_address) == "198.51.100.9"
            assert row.id.version == 7
    finally:
        writer.dispose()
        _remove_global(owner_database, summary)


def test_security_writer_never_raises_when_the_database_is_down(caplog):
    writer = SecurityAuditWriter("postgresql+psycopg://nobody:secret@127.0.0.1:1/nowhere_test", timeout_seconds=1)
    with caplog.at_level(logging.ERROR):
        assert writer.record("api-key.rejected", "very sensitive summary", metadata={"reason": "unknown"}) is False
    assert "Could not write security audit event api-key.rejected" in caplog.text
    assert "very sensitive summary" not in caplog.text and "secret" not in caplog.text
    writer.dispose()


def test_security_writer_stays_within_its_own_pool(migrated):
    writer = SecurityAuditWriter(TEST_DATABASE_URL, pool_size=1, timeout_seconds=1)
    held = writer._engine.connect()  # exhaust its single connection
    try:
        assert writer.record("api-key.rejected", "pool probe", metadata={"reason": "unknown"}) is False
    finally:
        held.close()
        writer.dispose()


def test_security_writer_still_validates_actions_and_metadata():
    writer = SecurityAuditWriter("postgresql+psycopg://nobody@127.0.0.1:1/nowhere_test")
    with pytest.raises(ValueError, match="not allowed"):
        writer.record("api-key.rejected", "x", metadata={"key": "dp_live_whatever"})
    writer.dispose()


def test_rejected_api_keys_are_recorded_outside_the_request_transaction(client, pg_conn, security_audit):
    """The request rolls back (401), so nothing is written in its transaction; the rejection goes to the writer."""
    before = count(pg_conn)
    assert client.get("/trust/incidents", headers={"Authorization": "Bearer dp_live_nope"}).status_code == 401
    assert count(pg_conn) == before
    [event] = security_audit.events
    assert event["action"] == "api-key.rejected" and event["metadata"] == {"reason": "invalid_key"}
    assert event["tenant_id"] is None and "dp_live_nope" not in str(event)


def test_in_memory_repository_matches_the_api_shape():
    repo = InMemoryAuditRepository()
    repo.append(
        AuditEntry(
            id=uuid.UUID(int=1),
            occurred_at=clock.now(),
            action="user.invited",
            actor_type="system",
            actor_id=None,
            actor_label="DataPilot",
            summary="x",
            resource_type="member",
            resource_id="u-x",
            client="testclient",
        )
    )
    item = repo.search(None, None, 10, 0).items[0]
    assert (item.type, item.event, item.target, item.ip) == ("user", "User Invited", "member:u-x", "testclient")
