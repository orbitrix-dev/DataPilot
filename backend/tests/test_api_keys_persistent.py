"""Stage 3B.1: API keys persisted in PostgreSQL, found by digest, with expiry, revocation and pepper rotation."""

import hashlib
import os
import secrets
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, func, select, update
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.security import api_key_digest, parse_keyring
from app.modules.audit.actions import ACTIONS
from app.modules.audit.models import AuditEventRecord
from app.modules.identity.persistence import PostgresUserRepository
from app.modules.tenants.models import ApiKey
from app.modules.tenants.persistence import (
    PostgresMembershipRepository,
    PostgresRoleRepository,
    PostgresTenantRepository,
)
from app.seed import demo_registry, demo_tenant
from app.tenant_data import Registry

from .conftest import as_user, make_app, mfa_code
from .factories import DEMO_MATRIX

BASE = "http://testserver/api/v1"
INVALID = {"error": {"code": "unauthorized", "message": "Invalid or revoked API key"}}


def db(conn) -> Session:
    return Session(bind=conn, join_transaction_mode="create_savepoint")


def create_key(client, name="Reader", **extra) -> tuple[str, str]:
    r = client.post("/api-keys", json={"name": name, "scopes": ["trust:read"], "mfa_code": mfa_code(client), **extra})
    assert r.status_code == 201, r.text
    return r.json()["key"]["id"], r.json()["secret"]


def bearer(secret: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {secret}"}


def stored(conn, public_id: str) -> ApiKey:
    with db(conn) as s:
        return s.scalar(select(ApiKey).where(ApiKey.public_id == public_id))


def active_pepper() -> bytes:
    return parse_keyring(os.environ["DP_API_KEY_PEPPERS"])[os.environ["DP_API_KEY_PEPPER_VERSION"]]


# ====================================================================== storage


def test_only_a_peppered_digest_is_stored(client, pg_conn):
    key_id, secret = create_key(client)
    row = stored(pg_conn, key_id)
    assert len(row.secret_hash) == 32 and row.pepper_version == os.environ["DP_API_KEY_PEPPER_VERSION"]
    assert row.secret_hash == api_key_digest(secret, active_pepper())
    assert row.secret_hash != hashlib.sha256(secret.encode()).digest()  # not an unkeyed hash
    assert secret not in repr(row.__dict__) and secret.encode() not in row.secret_hash
    listed = next(k for k in client.get("/api-keys").json() if k["id"] == key_id)
    assert "secret" not in listed and "secret_hash" not in listed and "pepper_version" not in listed
    assert listed["expires_at"] is None


def test_keys_live_only_in_postgresql(pg_db, client):
    """A brand-new app with a fresh in-memory registry still authenticates the key: nothing lives in process memory."""
    _, secret = create_key(client)
    fresh = TestClient(make_app(Settings(env="test"), demo_registry(), database=pg_db), base_url=BASE)
    assert fresh.get("/trust/incidents", headers=bearer(secret)).status_code == 200


def test_demo_keys_are_listed_but_unusable(client, pg_conn):
    assert {k["id"] for k in client.get("/api-keys").json()} >= {"key-9f2a", "key-3c81"}
    assert stored(pg_conn, "key-9f2a").pepper_version == "seed"  # no pepper version verifies it


# ====================================================================== rejection


def test_revoked_expired_and_unknown_keys_get_the_same_answer(client, pg_conn):
    revoked_id, revoked = create_key(client, "Revoked")
    client.post(f"/api-keys/{revoked_id}/revoke")
    expired_id, expired = create_key(client, "Expired")
    with db(pg_conn) as s:
        s.execute(
            update(ApiKey)
            .where(ApiKey.public_id == expired_id)
            .values(created_at=datetime.now(UTC) - timedelta(days=2), expires_at=datetime.now(UTC) - timedelta(days=1))
        )
        s.commit()
    for secret in (revoked, expired, "dp_live_" + secrets.token_hex(20)):
        r = client.get("/trust/incidents", headers=bearer(secret))
        assert r.status_code == 401 and r.json() == INVALID


def test_unexpired_keys_work_until_their_expiry(client):
    soon = (datetime.now(UTC) + timedelta(hours=1)).isoformat()
    key_id, secret = create_key(client, expires_at=soon)
    assert client.get("/trust/incidents", headers=bearer(secret)).status_code == 200
    listed = next(k for k in client.get("/api-keys").json() if k["id"] == key_id)
    assert listed["expires_at"] is not None


@pytest.mark.parametrize("expires_at", ["2020-01-01T00:00:00Z", "2099-01-01T00:00:00"])  # past / no time zone
def test_invalid_expiry_is_rejected_at_creation(client, expires_at):
    r = client.post(
        "/api-keys", json={"name": "X", "scopes": ["trust:read"], "mfa_code": "123456", "expires_at": expires_at}
    )
    assert r.status_code == 422


def test_a_digest_recorded_under_another_pepper_version_does_not_match(client, pg_conn):
    key_id, secret = create_key(client)
    with db(pg_conn) as s:
        s.execute(update(ApiKey).where(ApiKey.public_id == key_id).values(pepper_version="unknown"))
        s.commit()
    assert client.get("/trust/incidents", headers=bearer(secret)).json() == INVALID


# ====================================================================== pepper rotation


def _app_with_peppers(pg_db, peppers: str, active: str) -> TestClient:
    settings = Settings(env="test", api_key_peppers=peppers, api_key_pepper_version=active)
    return TestClient(make_app(settings, demo_registry(), database=pg_db), base_url=BASE)


def test_pepper_rotation_rehashes_keys_on_use(client, pg_db, pg_conn):
    key_id, secret = create_key(client)
    old_version = os.environ["DP_API_KEY_PEPPER_VERSION"]
    new_pepper = secrets.token_urlsafe(48)
    rotated = _app_with_peppers(pg_db, f"p2={new_pepper},{os.environ['DP_API_KEY_PEPPERS']}", "p2")
    assert rotated.get("/trust/incidents", headers=bearer(secret)).status_code == 200
    row = stored(pg_conn, key_id)
    assert row.pepper_version == "p2" and row.secret_hash == api_key_digest(secret, new_pepper.encode())
    # Once every key has been re-hashed, the old version can be removed; this key keeps working.
    only_new = _app_with_peppers(pg_db, f"p2={new_pepper}", "p2")
    assert only_new.get("/trust/incidents", headers=bearer(secret)).status_code == 200
    assert old_version != "p2"


def test_removing_a_pepper_version_disables_keys_still_hashed_under_it(client, pg_db):
    _, secret = create_key(client)
    without_old = _app_with_peppers(pg_db, f"p2={secrets.token_urlsafe(48)}", "p2")
    assert without_old.get("/trust/incidents", headers=bearer(secret)).json() == INVALID


# ====================================================================== last use, isolation, atomicity


def test_last_used_at_is_written_at_most_once_a_minute(client, pg_conn):
    key_id, secret = create_key(client)
    client.get("/trust/incidents", headers=bearer(secret))
    first = stored(pg_conn, key_id).last_used_at
    client.get("/trust/incidents", headers=bearer(secret))
    assert stored(pg_conn, key_id).last_used_at == first
    with db(pg_conn) as s:
        s.execute(update(ApiKey).where(ApiKey.public_id == key_id).values(last_used_at=first - timedelta(minutes=2)))
        s.commit()
    client.get("/trust/incidents", headers=bearer(secret))
    assert stored(pg_conn, key_id).last_used_at > first - timedelta(minutes=2)


def test_keys_are_scoped_to_their_tenant(pg_db, pg_conn):
    with db(pg_conn) as s:
        t = PostgresTenantRepository(s).create("globex", "Globex")
        PostgresRoleRepository(s, t.id).create_system_roles(DEMO_MATRIX)
        bob = PostgresUserRepository(s).create("bob@globex.io", "Bob", public_id="u-bob")
        PostgresMembershipRepository(s, t.id).add(bob.id, PostgresRoleRepository(s, t.id).find_by_key("admin").id)
        s.commit()
    c = TestClient(
        make_app(Settings(env="test"), Registry({"acme": demo_tenant(), "globex": demo_tenant()}), database=pg_db),
        base_url=BASE,
    )
    globex = {"X-DataPilot-Tenant": "globex", **as_user("u-bob")}
    r = c.post(
        "/api-keys", json={"name": "G", "scopes": ["trust:read"], "mfa_code": mfa_code(c, "u-bob")}, headers=globex
    )
    globex_key = r.json()["key"]["id"]
    assert globex_key not in [k["id"] for k in c.get("/api-keys").json()]  # acme admin can't see it
    assert c.post(f"/api-keys/{globex_key}/revoke").status_code == 404  # nor revoke it
    assert c.post("/api-keys/key-9f2a/revoke", headers=globex).status_code == 404  # nor globex acme's


def test_key_creation_and_its_audit_event_are_atomic(client, pg_conn):
    def fail(session):
        raise RuntimeError("simulated commit failure")

    code = mfa_code(client)  # enrolls Elena's authenticator (an audit event) before counting
    with db(pg_conn) as s:
        keys_before = s.scalar(select(func.count()).select_from(ApiKey))
        events_before = s.scalar(select(func.count()).select_from(AuditEventRecord))
    # Only the request's own sessions fail to commit (the abuse-protection limiter commits on its own pool).
    request_sessions = client.app.state.db._sessions
    event.listen(request_sessions, "before_commit", fail)
    try:
        r = TestClient(client.app, base_url=BASE, raise_server_exceptions=False).post(
            "/api-keys", json={"name": "Never", "scopes": ["trust:read"], "mfa_code": code}
        )
    finally:
        event.remove(request_sessions, "before_commit", fail)
    assert r.status_code == 500
    with db(pg_conn) as s:
        assert s.scalar(select(func.count()).select_from(ApiKey)) == keys_before
        assert s.scalar(select(func.count()).select_from(AuditEventRecord)) == events_before


def test_key_creation_is_production_enabled_now_that_step_up_is_verified():
    assert ACTIONS["api-key.created"].business_store == "postgres"
    assert ACTIONS["api-key.created"].production_enabled is True  # Stage 3B.2: real TOTP step-up (test_mfa.py)
    assert ACTIONS["api-key.revoked"].production_enabled is True
