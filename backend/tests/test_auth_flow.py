"""Stage 3B.1: invitation → password → sign-in → access token → refresh rotation → sign-out, against PostgreSQL.

Every request goes through the real app and the runtime database user. The browser is simulated by an https
TestClient (so ``Secure`` cookies round-trip) sending ``Origin: http://localhost:5173`` (in DP_CORS_ORIGINS).
"""

import os
import threading
import time
from datetime import UTC, datetime, timedelta

import jwt
import pytest
from argon2 import PasswordHasher
from fastapi.testclient import TestClient
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.security import parse_keyring, token_digest
from app.main import create_app
from app.modules.audit.models import AuditEventRecord
from app.modules.auth import service as auth_service
from app.modules.auth.router import CSRF_COOKIE, CSRF_HEADER, REFRESH_COOKIE
from app.modules.identity.models import InvitationToken, RefreshToken, User, UserSession
from app.modules.identity.persistence import PostgresUserRepository
from app.modules.tenants.models import Tenant, TenantMembership
from app.modules.tenants.persistence import (
    PostgresMembershipRepository,
    PostgresRoleRepository,
    PostgresTenantRepository,
)
from app.seed import _audit, demo_registry, demo_tenant
from app.seed_postgres import seed_demo
from app.tenant_data import Registry

from .conftest import TEST_JWT_KID
from .factories import DEMO_MATRIX, remove_demo

BASE = "https://testserver/api/v1"
ORIGIN = {"Origin": "http://localhost:5173"}
PASSWORD = "correct horse battery staple"
INVALID_CREDENTIALS = {"error": {"code": "unauthorized", "message": "Invalid email or password"}}
INVALID_SESSION = {"error": {"code": "unauthorized", "message": "Invalid or expired session"}}
INVALID_INVITATION = {"error": {"code": "unauthorized", "message": "Invalid or expired invitation"}}


def db(conn) -> Session:
    return Session(bind=conn, join_transaction_mode="create_savepoint")


def browser(pg_db, settings: Settings | None = None, registry: Registry | None = None) -> TestClient:
    app = create_app(settings or Settings(env="test"), registry or demo_registry(), database=pg_db)
    return TestClient(app, base_url=BASE)


@pytest.fixture
def web(pg_db) -> TestClient:
    return browser(pg_db)


def invite(conn, email: str, role: str = "analyst", tenant: str = "acme") -> str:
    with db(conn) as s:
        issued = auth_service.issue_invitation(s, Settings(env="test"), tenant_slug=tenant, email=email, role_key=role)
        s.commit()
    return issued.token


def accept(web: TestClient, token: str, password: str = PASSWORD):
    return web.post("/auth/invitations/accept", json={"token": token, "password": password})


def login(web: TestClient, email: str, password: str = PASSWORD, **extra):
    return web.post("/auth/login", json={"email": email, "password": password, **extra}, headers=ORIGIN)


def signed_up(web: TestClient, conn, email: str = "new.analyst@acme.io", role: str = "analyst") -> str:
    """Invites, accepts and signs in; returns the access token (refresh + CSRF cookies are in ``web``)."""
    assert accept(web, invite(conn, email, role)).status_code == 204
    r = login(web, email)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def csrf(web: TestClient) -> dict[str, str]:
    return {**ORIGIN, CSRF_HEADER: web.cookies.get(CSRF_COOKIE)}


def refresh(web: TestClient):
    return web.post("/auth/refresh", headers=csrf(web))


DEMO_EVENT_IDS = {e.id for e in _audit()}


def events(conn, action: str) -> list[AuditEventRecord]:
    """Events recorded by the test (the demo seed's history excluded)."""
    with db(conn) as s:
        rows = s.scalars(select(AuditEventRecord).where(AuditEventRecord.action == action))
        return [e for e in rows if e.id not in DEMO_EVENT_IDS]


def with_cookies(pg_db, refresh_token: str | None, csrf_token: str) -> dict[str, str]:
    """Headers for a request from a fresh client carrying exactly these cookies (no cookie jar involved)."""
    jar = f"{CSRF_COOKIE}={csrf_token}" + (f"; {REFRESH_COOKIE}={refresh_token}" if refresh_token else "")
    return {**ORIGIN, CSRF_HEADER: csrf_token, "Cookie": jar}


def session_of(conn, access_token: str) -> UserSession:
    sid = jwt.decode(access_token, options={"verify_signature": False})["sid"]
    with db(conn) as s:
        return s.scalar(select(UserSession).where(UserSession.public_id == sid))


def signing_key() -> bytes:
    return parse_keyring(os.environ["DP_JWT_SIGNING_KEYS"])[TEST_JWT_KID]


def forge(claims: dict, key: bytes | None = None, kid: str = TEST_JWT_KID, alg: str = "HS256") -> str:
    return jwt.encode(claims, key or signing_key(), algorithm=alg, headers={"kid": kid})


def add_globex(conn, *emails: str) -> None:
    """A second tenant, with an admin role, and the given existing users as active admins of it."""
    with db(conn) as s:
        t = PostgresTenantRepository(s).create("globex", "Globex")
        roles = PostgresRoleRepository(s, t.id)
        roles.create_system_roles(DEMO_MATRIX)
        for email in emails:
            user = s.scalar(select(User).where(User.email == email)) or PostgresUserRepository(s).create(
                email, "Globex User"
            )
            PostgresMembershipRepository(s, t.id).add(user.id, roles.find_by_key("admin").id)
        s.commit()


def two_tenant_registry() -> Registry:
    return Registry({"acme": demo_tenant(), "globex": demo_tenant()})


# ====================================================================== invitations


def test_invitation_stores_only_a_digest_and_expires_in_24_hours(pg_conn):
    token = invite(pg_conn, "new.analyst@acme.io")
    assert token.startswith("dpi_")
    with db(pg_conn) as s:
        row = s.scalar(select(InvitationToken).order_by(InvitationToken.created_at.desc()))
        assert row.token_hash == token_digest(token) and token.encode() not in row.token_hash
        assert timedelta(hours=23, minutes=59) < row.expires_at - row.created_at <= timedelta(hours=24, seconds=1)
        user = s.scalar(select(User).where(User.email == "new.analyst@acme.io"))
        assert user.password_hash is None
        membership = s.scalar(select(TenantMembership).where(TenantMembership.user_id == user.id))
        assert membership.membership_status == "invited"
    [issued] = events(pg_conn, "user.invitation_issued")
    assert issued.event_metadata == {"email": "new.analyst@acme.io", "role": "analyst"}
    assert token not in str(issued.__dict__)


def test_accepting_sets_an_argon2id_password_and_activates_the_membership(web, pg_conn):
    token = invite(pg_conn, "new.analyst@acme.io")
    assert accept(web, token).status_code == 204
    with db(pg_conn) as s:
        user = s.scalar(select(User).where(User.email == "new.analyst@acme.io"))
        assert user.password_hash.startswith("$argon2id$") and PASSWORD not in user.password_hash
        membership = s.scalar(select(TenantMembership).where(TenantMembership.user_id == user.id))
        assert membership.membership_status == "active" and membership.joined_at is not None
    [accepted] = events(pg_conn, "user.invitation_accepted")
    assert PASSWORD not in str(accepted.__dict__) and token not in str(accepted.__dict__)


def test_an_invitation_works_only_once(web, pg_conn):
    token = invite(pg_conn, "new.analyst@acme.io")
    assert accept(web, token).status_code == 204
    r = accept(web, token, "another long password")
    assert r.status_code == 401 and r.json() == INVALID_INVITATION
    assert login(web, "new.analyst@acme.io", "another long password").status_code == 401


def test_expired_unknown_and_superseded_invitations_are_refused_alike(web, pg_conn):
    expired = invite(pg_conn, "late@acme.io")
    with db(pg_conn) as s:
        s.execute(
            update(InvitationToken)
            .where(InvitationToken.token_hash == token_digest(expired))
            .values(created_at=datetime.now(UTC) - timedelta(days=2), expires_at=datetime.now(UTC) - timedelta(days=1))
        )
        s.commit()
    first = invite(pg_conn, "twice@acme.io")
    invite(pg_conn, "twice@acme.io")  # re-issuing revokes the first token
    for token in (expired, first, "dpi_" + "x" * 43):
        r = accept(web, token)
        assert r.status_code == 401 and r.json() == INVALID_INVITATION


def test_a_rejected_password_does_not_consume_the_invitation(web, pg_conn):
    token = invite(pg_conn, "new.analyst@acme.io")
    assert accept(web, token, "short").status_code == 422
    assert accept(web, token, "new.analyst@acme.io").status_code == 422  # the email isn't a password
    assert accept(web, token).status_code == 204


def test_invitations_only_set_a_first_password(web, pg_conn):
    signed_up(web, pg_conn)
    with db(pg_conn) as s, pytest.raises(Exception, match="already has a password"):
        auth_service.issue_invitation(
            s, Settings(env="test"), tenant_slug="acme", email="new.analyst@acme.io", role_key="analyst"
        )


def test_a_second_owner_cannot_be_invited(pg_conn):
    with db(pg_conn) as s, pytest.raises(Exception, match="already has an Owner"):
        auth_service.issue_invitation(s, Settings(env="test"), tenant_slug="acme", email="x@acme.io", role_key="owner")


def test_invite_user_cli_prints_the_token_once_and_takes_no_password(pg_db, monkeypatch, capsys):
    from app import cli

    monkeypatch.setattr(cli.Database, "from_settings", classmethod(lambda cls, s: pg_db))
    code = cli.main(["invite-user", "--tenant", "acme", "--email", "cli.user@acme.io", "--role", "viewer"])
    out = capsys.readouterr().out
    assert code == 0
    token = out.strip().splitlines()[-1]
    assert token.startswith("dpi_") and out.count(token) == 1
    with pytest.raises(SystemExit):  # there is no way to pass a password on the command line
        cli.main(["invite-user", "--tenant", "acme", "--email", "a@acme.io", "--role", "viewer", "--password", "x"])
    assert cli.main(["invite-user", "--tenant", "nope", "--email", "a@acme.io", "--role", "viewer"]) == 1


def test_concurrent_acceptances_consume_the_invitation_exactly_once(migrated, owner_database):
    """Real, committed transactions on separate connections: only one acceptance can win."""
    settings = Settings(env="test")
    email = "race@acme.io"
    try:
        with migrated.session() as s:
            seed_demo(s)
            token = auth_service.issue_invitation(s, settings, tenant_slug="acme", email=email, role_key="viewer").token
        barrier, results = threading.Barrier(4), []

        def attempt(i: int) -> None:
            barrier.wait()
            try:
                with migrated.session() as s:
                    auth_service.accept_invitation(s, settings, token=token, password=f"{PASSWORD} {i}")
                results.append("ok")
            except Exception as exc:  # noqa: BLE001
                results.append(type(exc).__name__)

        threads = [threading.Thread(target=attempt, args=(i,)) for i in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert sorted(results) == ["Unauthorized"] * 3 + ["ok"]
        with migrated.session() as s:
            assert (
                s.scalar(
                    select(func.count())
                    .select_from(AuditEventRecord)
                    .where(AuditEventRecord.action == "user.invitation_accepted")
                )
                == 1
            )
    finally:
        with owner_database.session() as s:
            remove_demo(s, extra_emails=(email,))


# ====================================================================== sign-in


def test_sign_in_returns_an_access_token_and_sets_hardened_cookies(web, pg_conn):
    accept(web, invite(pg_conn, "new.analyst@acme.io"))
    r = login(web, "  New.Analyst@ACME.io ")  # identifiers are normalized
    assert r.status_code == 200
    body = r.json()
    assert body["token_type"] == "Bearer" and body["expires_in"] == 900 and body["tenant_id"] == "acme"
    assert "refresh" not in str(body)
    cookies = {c.split("=", 1)[0]: c.lower() for c in r.headers.get_list("set-cookie")}
    for name in (REFRESH_COOKIE, CSRF_COOKIE):
        assert "secure" in cookies[name] and "samesite=strict" in cookies[name] and "path=/" in cookies[name]
        assert "domain" not in cookies[name]
    assert "httponly" in cookies[REFRESH_COOKIE] and "httponly" not in cookies[CSRF_COOKIE]
    assert web.cookies.get(REFRESH_COOKIE).startswith("dpr_")
    header = jwt.get_unverified_header(body["access_token"])
    claims = jwt.decode(body["access_token"], options={"verify_signature": False})
    assert header == {"alg": "HS256", "kid": TEST_JWT_KID, "typ": "JWT"}
    assert claims["iss"] == "datapilot" and claims["aud"] == "datapilot-api" and claims["ten"] == "acme"
    assert claims["exp"] - claims["iat"] == 900 and claims["sid"].startswith("sess-")
    [event] = events(pg_conn, "login.succeeded")
    assert event.event_metadata == {"method": "password"} and PASSWORD not in str(event.__dict__)


def test_the_session_is_stored_with_only_token_digests(web, pg_conn):
    token = signed_up(web, pg_conn)
    session = session_of(pg_conn, token)
    refresh_token = web.cookies.get(REFRESH_COOKIE)
    with db(pg_conn) as s:
        [row] = s.scalars(select(RefreshToken).where(RefreshToken.session_id == session.id))
    assert row.token_hash == token_digest(refresh_token) and refresh_token.encode() not in row.token_hash
    assert session.expires_at - session.created_at == timedelta(days=30)


def test_failed_sign_ins_are_indistinguishable(web, pg_conn):
    signed_up(web, pg_conn, "active@acme.io")
    signed_up(web, pg_conn, "disabled@acme.io")
    with db(pg_conn) as s:
        s.execute(update(User).where(User.email == "disabled@acme.io").values(status="disabled"))
        s.commit()
    invite(pg_conn, "pending@acme.io")  # invited, no password yet
    cases = [
        ("nobody@acme.io", PASSWORD),  # unknown
        ("active@acme.io", "wrong password!!"),  # wrong password
        ("marcus.thorne@acmeglobal.com", PASSWORD),  # demo user without a password
        ("disabled@acme.io", PASSWORD),  # disabled user, right password
        ("pending@acme.io", PASSWORD),  # invited membership
        ("not-an-email", PASSWORD),
    ]
    for email, password in cases:
        r = login(web, email, password)
        assert (r.status_code, r.json()) == (401, INVALID_CREDENTIALS), email


def test_a_suspended_membership_cannot_sign_in(web, pg_conn):
    signed_up(web, pg_conn)
    with db(pg_conn) as s:
        user_id = s.scalar(select(User.id).where(User.email == "new.analyst@acme.io"))
        s.execute(
            update(TenantMembership).where(TenantMembership.user_id == user_id).values(membership_status="suspended")
        )
        s.commit()
    assert login(web, "new.analyst@acme.io").json() == INVALID_CREDENTIALS


def test_a_suspended_workspace_refuses_sign_in(web, pg_conn):
    signed_up(web, pg_conn)
    with db(pg_conn) as s:
        s.execute(update(Tenant).where(Tenant.slug == "acme").values(status="suspended"))
        s.commit()
    r = login(web, "new.analyst@acme.io")
    assert r.status_code == 403


def test_users_of_several_workspaces_must_choose_one(pg_db, pg_conn):
    web = browser(pg_db, registry=two_tenant_registry())
    signed_up(web, pg_conn, "both@acme.io")
    add_globex(pg_conn, "both@acme.io")
    r = login(web, "both@acme.io")
    assert r.status_code == 409 and r.json()["error"]["details"] == {"tenants": ["acme", "globex"]}
    r = login(web, "both@acme.io", tenant="globex")
    assert r.status_code == 200 and r.json()["tenant_id"] == "globex"
    assert login(web, "both@acme.io", tenant="initech").json() == INVALID_CREDENTIALS


def test_sign_in_requires_an_allowed_origin(web, pg_conn):
    accept(web, invite(pg_conn, "new.analyst@acme.io"))
    body = {"email": "new.analyst@acme.io", "password": PASSWORD}
    assert web.post("/auth/login", json=body).status_code == 403
    assert web.post("/auth/login", json=body, headers={"Origin": "https://evil.example"}).status_code == 403


def test_outdated_password_hashes_are_upgraded_on_sign_in(web, pg_conn):
    signed_up(web, pg_conn)
    weak = PasswordHasher(time_cost=1, memory_cost=8192, parallelism=1).hash(PASSWORD)
    with db(pg_conn) as s:
        s.execute(update(User).where(User.email == "new.analyst@acme.io").values(password_hash=weak))
        s.commit()
    assert login(web, "new.analyst@acme.io").status_code == 200
    with db(pg_conn) as s:
        upgraded = s.scalar(select(User.password_hash).where(User.email == "new.analyst@acme.io"))
    assert upgraded != weak and "m=65536,t=3,p=4" in upgraded


# ====================================================================== access tokens


def test_the_access_token_authenticates_the_member(web, pg_conn):
    token = signed_up(web, pg_conn)
    r = web.get("/me", headers=bearer(token))
    assert r.status_code == 200 and r.json()["member"]["email"] == "new.analyst@acme.io"
    assert r.json()["member"]["role"] == "analyst"


def test_dev_headers_are_ignored_when_an_access_token_is_sent(web, pg_conn):
    token = signed_up(web, pg_conn)
    r = web.get("/me", headers={**bearer(token), "X-DataPilot-User": "u-elena", "X-DataPilot-Tenant": "globex"})
    assert r.json()["member"]["email"] == "new.analyst@acme.io"


def test_production_accepts_access_tokens_and_nothing_else(pg_db, pg_conn):
    from .conftest import TEST_DATABASE_URL

    prod = browser(pg_db, Settings(env="prod", database_url=TEST_DATABASE_URL))
    token = signed_up(prod, pg_conn)
    assert prod.get("/me", headers=bearer(token)).status_code == 200
    r = prod.get("/me", headers={"X-DataPilot-User": "u-elena"})
    assert r.status_code == 401 and r.json()["error"]["message"] == "Authentication required"


def _claims(token: str) -> dict:
    return jwt.decode(token, options={"verify_signature": False})


@pytest.mark.parametrize(
    "tamper",
    [
        pytest.param(lambda c: forge(c, key=b"x" * 48), id="wrong signature"),
        pytest.param(lambda c: forge(c, kid="test-k9"), id="unknown kid"),
        pytest.param(lambda c: forge({**c, "iss": "someone-else"}), id="wrong issuer"),
        pytest.param(lambda c: forge({**c, "aud": "other-api"}), id="wrong audience"),
        pytest.param(lambda c: forge({**c, "exp": int(time.time()) - 60, "iat": int(time.time()) - 960}), id="expired"),
        pytest.param(lambda c: forge({k: v for k, v in c.items() if k != "sid"}), id="no session id"),
        pytest.param(lambda c: forge(c, alg="HS512"), id="other algorithm"),
        pytest.param(lambda c: jwt.encode(c, None, algorithm="none", headers={"kid": TEST_JWT_KID}), id="unsigned"),
        pytest.param(lambda c: forge({**c, "sid": "sess-000000000000"}), id="unknown session"),
        pytest.param(lambda c: forge({**c, "sub": "u-elena"}), id="session of another user"),
    ],
)
def test_invalid_access_tokens_are_rejected(web, pg_conn, tamper):
    claims = _claims(signed_up(web, pg_conn))
    r = web.get("/me", headers=bearer(tamper(claims)))
    assert (r.status_code, r.json()) == (401, INVALID_SESSION)


def test_a_token_cannot_be_moved_to_another_tenant(pg_db, pg_conn):
    """A validly signed token whose session belongs to acme but whose tenant claim says globex is refused, because
    the session row (tenant, user) is the authority, not the claim."""
    web = browser(pg_db, registry=two_tenant_registry())
    token = signed_up(web, pg_conn, "both@acme.io")
    add_globex(pg_conn, "both@acme.io")
    r = web.get("/me", headers=bearer(forge({**_claims(token), "ten": "globex"})))
    assert (r.status_code, r.json()) == (401, INVALID_SESSION)
    globex = login(web, "both@acme.io", tenant="globex").json()["access_token"]
    assert web.get("/members", headers={**bearer(globex), "X-DataPilot-Tenant": "acme"}).status_code == 200
    member_ids = {m["email"] for m in web.get("/members", headers=bearer(globex)).json()}
    assert "elena.vance@acmeglobal.com" not in member_ids  # globex's admin sees globex's members only


def test_a_revoked_session_stops_working_immediately(web, pg_conn):
    token = signed_up(web, pg_conn)
    sid = session_of(pg_conn, token).public_id
    assert web.delete(f"/sessions/{sid}").status_code == 204  # Elena (dev admin) revokes it in Admin → Sessions
    assert web.get("/me", headers=bearer(token)).json() == INVALID_SESSION
    assert refresh(web).json() == INVALID_SESSION


def test_removing_the_membership_ends_access(web, pg_conn):
    token = signed_up(web, pg_conn)
    member_id = _claims(token)["sub"]
    assert web.delete(f"/members/{member_id}").status_code == 204
    assert web.get("/me", headers=bearer(token)).status_code == 401


def test_an_idle_session_times_out_per_tenant_policy(web, pg_conn):
    token = signed_up(web, pg_conn)
    old = datetime.now(UTC) - timedelta(hours=13)  # acme: session_timeout_hours = 12
    with db(pg_conn) as s:
        s.execute(
            update(UserSession)
            .where(UserSession.public_id == _claims(token)["sid"])
            .values(created_at=old, last_seen_at=old)
        )
        s.commit()
    assert web.get("/me", headers=bearer(token)).json() == INVALID_SESSION
    assert refresh(web).json() == INVALID_SESSION


def test_signing_key_rotation(pg_db, pg_conn):
    old_ring = os.environ["DP_JWT_SIGNING_KEYS"]
    web = browser(pg_db)
    old_token = signed_up(web, pg_conn)
    new_key = "k2=" + "n" * 48
    rotated = browser(pg_db, Settings(env="test", jwt_signing_keys=f"{new_key},{old_ring}", jwt_active_kid="k2"))
    assert rotated.get("/me", headers=bearer(old_token)).status_code == 200  # still verifiable during rotation
    new_token = login(rotated, "new.analyst@acme.io").json()["access_token"]
    assert jwt.get_unverified_header(new_token)["kid"] == "k2"
    retired = browser(pg_db, Settings(env="test", jwt_signing_keys=new_key, jwt_active_kid="k2"))
    assert retired.get("/me", headers=bearer(old_token)).status_code == 401  # old kid removed
    assert retired.get("/me", headers=bearer(new_token)).status_code == 200


# ====================================================================== refresh rotation


def test_refresh_rotates_the_token_and_keeps_the_session(web, pg_conn):
    token = signed_up(web, pg_conn)
    first = web.cookies.get(REFRESH_COOKIE)
    r = refresh(web)
    assert r.status_code == 200
    second = web.cookies.get(REFRESH_COOKIE)
    assert second != first and r.json()["access_token"] != token
    assert _claims(r.json()["access_token"])["sid"] == _claims(token)["sid"]
    assert web.get("/me", headers=bearer(r.json()["access_token"])).status_code == 200
    with db(pg_conn) as s:
        rows = {t.token_hash: t for t in s.scalars(select(RefreshToken))}
    old, new = rows[token_digest(first)], rows[token_digest(second)]
    assert old.used_at is not None and new.parent_id == old.id and new.used_at is None


def test_reusing_a_refresh_token_revokes_the_whole_family(web, pg_db, pg_conn):
    token = signed_up(web, pg_conn)
    stolen = web.cookies.get(REFRESH_COOKIE)
    stolen_csrf = web.cookies.get(CSRF_COOKIE)
    assert refresh(web).status_code == 200  # the legitimate client rotates
    legit_access = refresh(web).json()["access_token"]

    r = browser(pg_db).post("/auth/refresh", headers=with_cookies(pg_db, stolen, stolen_csrf))
    assert (r.status_code, r.json()) == (401, INVALID_SESSION)

    session = session_of(pg_conn, token)
    assert session.revoked_reason == "refresh_token_reuse"
    with db(pg_conn) as s:
        live = s.scalars(
            select(RefreshToken).where(RefreshToken.session_id == session.id, RefreshToken.revoked_at.is_(None))
        ).all()
    assert live == []  # every token of the family is revoked, including the legitimate client's current one
    [event] = events(pg_conn, "login.refresh_reuse_detected")  # committed despite the 401
    assert event.event_metadata == {"session_id": session.public_id} and stolen not in str(event.__dict__)
    assert event.resource_type == "session" and event.resource_id == session.public_id
    # The legitimate client is signed out too; its now-revoked token is itself a replay and is recorded again.
    assert refresh(web).json() == INVALID_SESSION
    assert web.get("/me", headers=bearer(legit_access)).json() == INVALID_SESSION
    assert len(events(pg_conn, "login.refresh_reuse_detected")) == 2


def test_refresh_requires_the_csrf_token_and_an_allowed_origin(web, pg_conn):
    signed_up(web, pg_conn)
    token = web.cookies.get(CSRF_COOKIE)
    for headers in (
        ORIGIN,  # no CSRF header
        {**ORIGIN, CSRF_HEADER: "forged"},  # mismatched
        {CSRF_HEADER: token},  # no Origin
        {"Origin": "https://evil.example", CSRF_HEADER: token},
    ):
        assert web.post("/auth/refresh", headers=headers).status_code == 403
    assert refresh(web).status_code == 200  # none of the refused attempts consumed the token


def test_refresh_without_a_cookie_or_with_an_unknown_or_expired_token(web, pg_db, pg_conn):
    access = signed_up(web, pg_conn)
    current, csrf_token = web.cookies.get(REFRESH_COOKIE), web.cookies.get(CSRF_COOKIE)
    fresh = browser(pg_db)
    for refresh_token in (None, "dpr_" + "x" * 43):
        r = fresh.post("/auth/refresh", headers=with_cookies(pg_db, refresh_token, csrf_token))
        assert (r.status_code, r.json()) == (401, INVALID_SESSION)
    with db(pg_conn) as s:
        past = datetime.now(UTC) - timedelta(days=1)
        s.execute(
            update(RefreshToken)
            .where(RefreshToken.token_hash == token_digest(current))
            .values(issued_at=past - timedelta(days=1), expires_at=past)
        )
        s.commit()
    r = fresh.post("/auth/refresh", headers=with_cookies(pg_db, current, csrf_token))
    assert (r.status_code, r.json()) == (401, INVALID_SESSION)
    assert session_of(pg_conn, access).revoked_at is None  # an expired or unknown token is not replay


def test_concurrent_refreshes_cannot_fork_the_family(migrated, owner_database):
    """Two committed refreshes of the same token race: one rotates, the other is treated as replay. The family never
    has two live tokens. (A double refresh from two tabs therefore signs the user out: the safe failure.)"""
    settings = Settings(env="test")
    email = "race@acme.io"
    try:
        with migrated.session() as s:
            seed_demo(s)
            token = auth_service.issue_invitation(s, settings, tenant_slug="acme", email=email, role_key="viewer").token
        with migrated.session() as s:
            auth_service.accept_invitation(s, settings, token=token, password=PASSWORD)
        with migrated.session() as s:
            issued = auth_service.login(
                s, settings, email=email, password=PASSWORD, tenant_slug=None, client="", user_agent=""
            )
        barrier, results = threading.Barrier(2), []

        def attempt() -> None:
            barrier.wait()
            with migrated.session() as s:
                outcome = auth_service.refresh(s, settings, refresh_token=issued.refresh_token, client="")
            results.append(type(outcome).__name__)

        threads = [threading.Thread(target=attempt) for _ in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert sorted(results) == ["IssuedSession", "ReplayDetected"]
        with migrated.session() as s:
            session = s.scalar(
                select(UserSession).join(User, User.id == UserSession.user_id).where(User.email == email)
            )
            live = s.scalar(
                select(func.count())
                .select_from(RefreshToken)
                .where(RefreshToken.session_id == session.id, RefreshToken.revoked_at.is_(None))
            )
            assert session.revoked_reason == "refresh_token_reuse" and live == 0
    finally:
        with owner_database.session() as s:
            remove_demo(s, extra_emails=(email,))


# ====================================================================== sign-out


def test_sign_out_with_the_access_token(web, pg_conn):
    token = signed_up(web, pg_conn)
    r = web.post("/auth/logout", headers=bearer(token))
    assert r.status_code == 204
    assert web.get("/me", headers=bearer(token)).json() == INVALID_SESSION
    assert session_of(pg_conn, token).revoked_reason == "logout"
    assert len(events(pg_conn, "login.logout")) == 1


def test_sign_out_with_the_refresh_cookie_requires_csrf(web, pg_conn):
    token = signed_up(web, pg_conn)
    assert web.post("/auth/logout", headers=ORIGIN).status_code == 403
    r = web.post("/auth/logout", headers=csrf(web))
    assert r.status_code == 204
    assert web.get("/me", headers=bearer(token)).json() == INVALID_SESSION
    assert REFRESH_COOKIE not in web.cookies  # cleared


def test_after_sign_out_the_refresh_token_is_dead(web, pg_db, pg_conn):
    token = signed_up(web, pg_conn)
    refresh_token, csrf_token = web.cookies.get(REFRESH_COOKIE), web.cookies.get(CSRF_COOKIE)
    assert web.post("/auth/logout", headers=bearer(token)).status_code == 204
    r = browser(pg_db).post("/auth/refresh", headers=with_cookies(pg_db, refresh_token, csrf_token))
    assert (r.status_code, r.json()) == (401, INVALID_SESSION)


# ====================================================================== the full definition of done


def test_end_to_end_invitation_to_sign_out(web, pg_conn):
    token = invite(pg_conn, "jordan.lee@acme.io", "manager")
    assert accept(web, token).status_code == 204
    access = login(web, "jordan.lee@acme.io").json()["access_token"]
    assert web.get("/me", headers=bearer(access)).json()["member"]["role"] == "manager"
    rotated = refresh(web).json()["access_token"]
    assert web.get("/me", headers=bearer(rotated)).status_code == 200
    assert web.post("/auth/logout", headers=bearer(rotated)).status_code == 204
    assert web.get("/me", headers=bearer(rotated)).status_code == 401
    actions = [e.action for e in events(pg_conn, "user.invitation_issued")]
    actions += [e.action for e in events(pg_conn, "user.invitation_accepted")]
    actions += [e.action for e in events(pg_conn, "login.succeeded")]
    actions += [e.action for e in events(pg_conn, "login.logout")]
    assert len(actions) == 4
