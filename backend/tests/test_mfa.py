"""Stage 3B.2: TOTP MFA, recovery codes, require_mfa enforcement, step-up for API keys and security events for rejected
requests. Every flow runs through the real app and the runtime database user; codes are real RFC 6238 TOTPs.
"""

import os
import threading
import uuid
from datetime import timedelta

import jwt
import pyotp
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select, text, update
from sqlalchemy.orm import Session

from app.core import clock
from app.core.config import Settings
from app.core.security import (
    Keyring,
    UndecryptableSecret,
    decrypt_mfa_secret,
    encrypt_mfa_secret,
    new_recovery_code,
    normalize_recovery_code,
    parse_keyring,
    token_digest,
)
from app.main import create_app
from app.modules.audit.models import AuditEventRecord
from app.modules.auth import mfa
from app.modules.auth import service as auth_service
from app.modules.auth.router import CSRF_COOKIE, CSRF_HEADER
from app.modules.identity.models import MfaRecoveryCode, MfaTotpFactor, User, UserSession
from app.modules.tenants.models import TenantSettings
from app.seed import _audit, demo_registry
from app.seed_postgres import seed_demo

from .conftest import RecordingSecurityAudit, make_app, mfa_code
from .factories import remove_demo

BASE = "https://testserver/api/v1"
ORIGIN = {"Origin": "http://localhost:5173"}
EMAIL = "mfa.user@acme.io"
PASSWORD = "correct horse battery staple"
DEMO_EVENT_IDS = {e.id for e in _audit()}


def db(conn) -> Session:
    return Session(bind=conn, join_transaction_mode="create_savepoint")


class Browser:
    """An https client (Secure cookies round-trip) with its own security-event recorder."""

    def __init__(self, pg_db, settings: Settings | None = None) -> None:
        self.audit = RecordingSecurityAudit()
        app = make_app(settings or Settings(env="test"), demo_registry(), database=pg_db, security_audit=self.audit)
        self.http = TestClient(app, base_url=BASE)

    def post(self, path: str, body: dict | None = None, **headers):
        return self.http.post(path, json=body, headers={**ORIGIN, **headers})

    def login(self, email: str = EMAIL, password: str = PASSWORD, **extra):
        return self.post("/auth/login", {"email": email, "password": password, **extra})

    def enroll(self, email: str = EMAIL, password: str = PASSWORD) -> pyotp.TOTP:
        r = self.post("/auth/mfa/enrollment", {"email": email, "password": password})
        assert r.status_code == 200, r.text
        return pyotp.TOTP(r.json()["secret"])

    def confirm(self, code: str, email: str = EMAIL, password: str = PASSWORD):
        return self.post("/auth/mfa/enrollment/confirm", {"email": email, "password": password, "code": code})


def set_policy(conn, **values) -> None:
    with db(conn) as s:
        s.execute(update(TenantSettings).values(**values))
        s.commit()


def member(conn, web: Browser, email: str = EMAIL, role: str = "admin") -> None:
    """A member with a password (invitation accepted)."""
    with db(conn) as s:
        token = auth_service.issue_invitation(
            s, Settings(env="test"), tenant_slug="acme", email=email, role_key=role
        ).token
        s.commit()
    assert web.post("/auth/invitations/accept", {"token": token, "password": PASSWORD}).status_code == 204


def enrolled(conn, web: Browser, email: str = EMAIL, role: str = "admin") -> tuple[pyotp.TOTP, list[str]]:
    """A member with a password and a confirmed authenticator. Returns the authenticator and recovery codes."""
    member(conn, web, email, role)
    totp = web.enroll(email)
    r = web.confirm(totp.now(), email)
    assert r.status_code == 200, r.text
    allow_next_code(conn, email)
    return totp, r.json()["recovery_codes"]


def allow_next_code(conn, email: str = EMAIL) -> None:
    """Codes are single use per 30-second step. Tests that need another code within the same step clear the record
    of the last used step (production never does this)."""
    with db(conn) as s:
        user_id = s.scalar(select(User.id).where(User.email == email))
        s.execute(update(MfaTotpFactor).where(MfaTotpFactor.user_id == user_id).values(last_used_step=None))
        s.commit()


def factor_of(conn, email: str = EMAIL) -> MfaTotpFactor | None:
    with db(conn) as s:
        return s.scalar(select(MfaTotpFactor).join(User, User.id == MfaTotpFactor.user_id).where(User.email == email))


def events(conn, action: str) -> list[AuditEventRecord]:
    with db(conn) as s:
        rows = s.scalars(select(AuditEventRecord).where(AuditEventRecord.action == action))
        return [e for e in rows if e.id not in DEMO_EVENT_IDS]


def wrong(code: str) -> str:
    return f"{(int(code) + 1) % 1_000_000:06d}"


def at_step_offset(totp: pyotp.TOTP, steps: int) -> str:
    return totp.at(clock.now() + timedelta(seconds=30 * steps))


@pytest.fixture
def web(pg_db, pg_conn) -> Browser:
    set_policy(pg_conn, require_mfa=False)  # tests that need "Require MFA" turn it on explicitly
    return Browser(pg_db)


# ====================================================================== encryption and recovery-code primitives


def _ring(**versions: str) -> Keyring:
    return Keyring({v: s.encode() for v, s in versions.items()}, next(iter(versions)))


def test_secrets_are_encrypted_with_aes_gcm_bound_to_the_user():
    ring = _ring(m1="k" * 48)
    alice, bob = uuid.uuid4().bytes, uuid.uuid4().bytes
    blob, version = encrypt_mfa_secret(ring, b"JBSWY3DPEHPK3PXP", user_id=alice)
    assert version == "m1" and b"JBSWY3DPEHPK3PXP" not in blob and len(blob) == 12 + 16 + 16
    assert decrypt_mfa_secret(ring, blob, "m1", user_id=alice) == b"JBSWY3DPEHPK3PXP"
    assert encrypt_mfa_secret(ring, b"JBSWY3DPEHPK3PXP", user_id=alice)[0] != blob  # fresh nonce every time
    with pytest.raises(UndecryptableSecret):
        decrypt_mfa_secret(ring, blob, "m1", user_id=bob)  # a row copied onto another user doesn't decrypt
    with pytest.raises(UndecryptableSecret):
        decrypt_mfa_secret(ring, blob[:-1] + bytes([blob[-1] ^ 1]), "m1", user_id=alice)  # tampered
    with pytest.raises(UndecryptableSecret):
        decrypt_mfa_secret(_ring(m1="x" * 48), blob, "m1", user_id=alice)  # wrong key
    with pytest.raises(UndecryptableSecret):
        decrypt_mfa_secret(ring, blob, "m9", user_id=alice)  # unknown version


def test_recovery_codes_are_high_entropy_and_normalized():
    codes = {new_recovery_code() for _ in range(200)}
    assert len(codes) == 200
    for code in codes:
        assert len(code) == 19 and code.count("-") == 3 and not set(code) & set("01ilo")
    assert normalize_recovery_code(" ABCD efgh-JKMN pqrs ") == "abcd-efgh-jkmn-pqrs"


def test_mfa_keys_are_required_in_production():
    with pytest.raises(ValueError, match="DP_MFA_ENCRYPTION_KEYS"):
        Settings(env="prod", database_url="postgresql+psycopg://u@h/d", mfa_encryption_keys=None)


# ====================================================================== enrolment


def test_enrolment_stores_only_ciphertext_and_needs_a_real_code(web, pg_conn):
    member(pg_conn, web)
    r = web.post("/auth/mfa/enrollment", {"email": EMAIL, "password": PASSWORD})
    secret, uri = r.json()["secret"], r.json()["otpauth_uri"]
    assert len(secret) == 32 and uri.startswith("otpauth://totp/DataPilot:mfa.user%40acme.io?")
    row = factor_of(pg_conn)
    assert row.confirmed_at is None and secret.encode() not in row.secret_ciphertext
    assert row.key_version == os.environ["DP_MFA_ENCRYPTION_KEY_VERSION"]
    totp = pyotp.TOTP(secret)
    for bogus in ("000000", "123456", wrong(totp.now()), "12345a", ""):
        assert web.confirm(bogus).status_code in (401, 422), bogus  # never accepted for its format
    assert factor_of(pg_conn).confirmed_at is None
    r = web.confirm(totp.now())
    assert r.status_code == 200
    codes = r.json()["recovery_codes"]
    assert len(codes) == 10 == len(set(codes))
    with db(pg_conn) as s:
        user = s.scalar(select(User).where(User.email == EMAIL))
        stored = {c.code_hash for c in s.scalars(select(MfaRecoveryCode).where(MfaRecoveryCode.user_id == user.id))}
    assert stored == {token_digest(c) for c in codes} and user.mfa_enrolled_at is not None
    [event] = events(pg_conn, "user.mfa_enrolled")
    assert secret not in str(event.__dict__) and not any(c in str(event.__dict__) for c in codes)


def test_a_confirmed_factor_cannot_be_replaced_with_only_the_password(web, pg_conn):
    """Otherwise a stolen password would let an attacker swap in their own authenticator."""
    enrolled(pg_conn, web)
    before = factor_of(pg_conn).secret_ciphertext
    assert web.post("/auth/mfa/enrollment", {"email": EMAIL, "password": PASSWORD}).status_code == 409
    assert web.confirm("123456").status_code == 409
    assert factor_of(pg_conn).secret_ciphertext == before


def test_restarting_an_unconfirmed_enrolment_replaces_the_secret(web, pg_conn):
    member(pg_conn, web)
    first = web.enroll()
    second = web.enroll()
    assert first.secret != second.secret
    assert web.confirm(first.now()).status_code == 401  # the abandoned secret no longer works
    assert web.confirm(second.now()).status_code == 200


def test_enrolment_requires_the_password(web, pg_conn):
    member(pg_conn, web)
    r = web.post("/auth/mfa/enrollment", {"email": EMAIL, "password": "not the password"})
    assert r.status_code == 401 and r.json()["error"]["message"] == "Invalid email or password"
    assert web.audit.actions() == ["login.failed"]
    assert (
        web.post(
            "/auth/mfa/enrollment", {"email": EMAIL, "password": PASSWORD}, Origin="https://evil.example"
        ).status_code
        == 403
    )


# ====================================================================== sign-in with a second factor


def test_sign_in_requires_the_second_factor_once_enrolled(web, pg_conn):
    totp, _ = enrolled(pg_conn, web)
    r = web.login()
    assert r.status_code == 401 and r.json()["error"]["code"] == "mfa_required"
    assert [e["metadata"] for e in web.audit.events] == [{"reason": "mfa_required"}]  # recorded (review finding 2)
    r = web.login(mfa_code=wrong(totp.now()))
    assert r.status_code == 401 and r.json()["error"]["code"] == "mfa_invalid"
    assert web.audit.actions() == ["login.failed"] * 2 and web.audit.events[1]["metadata"] == {"reason": "mfa_invalid"}
    r = web.login(mfa_code=totp.now())
    assert r.status_code == 200
    sid = jwt.decode(r.json()["access_token"], options={"verify_signature": False})["sid"]
    with db(pg_conn) as s:
        assert s.scalar(select(UserSession.mfa_verified_at).where(UserSession.public_id == sid)) is not None
    assert [e.event_metadata for e in events(pg_conn, "login.succeeded")] == [{"method": "password+totp"}]


def test_the_password_is_checked_before_mfa_is_mentioned(web, pg_conn):
    totp, _ = enrolled(pg_conn, web)
    r = web.login(password="wrong password!!", mfa_code=totp.now())
    assert r.status_code == 401 and r.json()["error"] == {
        "code": "unauthorized",
        "message": "Invalid email or password",
    }


def test_a_code_works_only_once(web, pg_conn):
    totp, _ = enrolled(pg_conn, web)
    code = totp.now()
    assert web.login(mfa_code=code).status_code == 200
    r = web.login(mfa_code=code)  # replayed within its own 30-second window
    assert r.status_code == 401 and r.json()["error"]["code"] == "mfa_invalid"


def test_one_step_of_clock_drift_is_tolerated_and_no_more(web, pg_conn):
    totp, _ = enrolled(pg_conn, web)
    assert web.login(mfa_code=at_step_offset(totp, -1)).status_code == 200
    allow_next_code(pg_conn)
    assert web.login(mfa_code=at_step_offset(totp, -2)).status_code == 401
    assert web.login(mfa_code=at_step_offset(totp, 2)).status_code == 401


def test_an_older_step_is_refused_after_a_newer_one_was_used(web, pg_conn):
    totp, _ = enrolled(pg_conn, web)
    assert web.login(mfa_code=at_step_offset(totp, 1)).status_code == 200
    assert web.login(mfa_code=totp.now()).status_code == 401  # earlier step than the last accepted one


def test_concurrent_use_of_one_code_succeeds_once(migrated, owner_database, throttle):
    """Two committed verifications of the same code race on separate connections; only one can record the step."""
    settings = Settings(env="test")
    email = "mfa.race@acme.io"
    try:
        with migrated.session() as s:
            seed_demo(s)
            user = s.scalar(select(User).where(User.public_id == "u-lena"))
            secret = mfa.start_enrollment(s, settings, user).secret
            earlier = pyotp.TOTP(secret).at(clock.now() - timedelta(seconds=30))
            mfa.confirm_enrollment(s, settings, user, earlier, throttle=throttle)
        code = pyotp.TOTP(secret).now()
        barrier, results = threading.Barrier(2), []

        def attempt() -> None:
            barrier.wait()
            with migrated.session() as s:
                u = s.scalar(select(User).where(User.public_id == "u-lena"))
                results.append(mfa.verify_totp(s, settings, u, mfa.factor_for(s, u), code))

        threads = [threading.Thread(target=attempt) for _ in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert sorted(results) == [False, True]
    finally:
        with owner_database.session() as s:
            remove_demo(s, extra_emails=(email,))


# ====================================================================== recovery codes


def test_a_recovery_code_signs_in_once(web, pg_conn):
    _, codes = enrolled(pg_conn, web)
    r = web.login(recovery_code=codes[0].upper().replace("-", " "))  # typed loosely
    assert r.status_code == 200
    [used] = events(pg_conn, "login.recovery_code_used")
    assert used.event_metadata == {"remaining": 9} and codes[0] not in str(used.__dict__)
    assert [e.event_metadata for e in events(pg_conn, "login.succeeded")] == [{"method": "password+recovery_code"}]
    r = web.login(recovery_code=codes[0])
    assert r.status_code == 401 and r.json()["error"]["code"] == "mfa_invalid"
    assert web.audit.events[-1]["metadata"] == {"reason": "recovery_code_invalid"}


def test_recovery_codes_are_per_user(web, pg_conn):
    _, codes = enrolled(pg_conn, web)
    enrolled(pg_conn, web, "other.admin@acme.io")
    assert web.login("other.admin@acme.io", recovery_code=codes[0]).status_code == 401


def test_regenerating_recovery_codes_revokes_the_old_set(web, pg_conn):
    totp, old = enrolled(pg_conn, web)
    access = web.login(mfa_code=totp.now()).json()["access_token"]
    allow_next_code(pg_conn)
    bearer = {"Authorization": f"Bearer {access}"}
    assert web.post("/auth/mfa/recovery-codes", {"code": wrong(totp.now())}, **bearer).status_code == 403
    assert web.post("/auth/mfa/recovery-codes", {"code": totp.now()}).status_code == 401  # needs a session
    r = web.post("/auth/mfa/recovery-codes", {"code": totp.now()}, **bearer)
    assert r.status_code == 200
    new = r.json()["recovery_codes"]
    assert len(new) == 10 and not set(new) & set(old)
    assert web.login(recovery_code=old[1]).status_code == 401
    assert web.login(recovery_code=new[1]).status_code == 200
    assert len(events(pg_conn, "user.recovery_codes_regenerated")) == 1


# ====================================================================== require_mfa


def test_a_workspace_requiring_mfa_refuses_members_without_a_factor(web, pg_conn):
    member(pg_conn, web)
    set_policy(pg_conn, require_mfa=True)
    r = web.login()
    assert r.status_code == 403 and r.json()["error"]["code"] == "mfa_enrollment_required"
    assert web.audit.events[0]["action"] == "login.blocked"
    assert web.audit.events[0]["metadata"] == {"reason": "mfa_enrollment_required"}
    # The member can still enrol (password re-authentication), then sign in with a code.
    totp = web.enroll()
    assert web.confirm(totp.now()).status_code == 200
    allow_next_code(pg_conn)
    assert web.login(mfa_code=totp.now()).status_code == 200


def test_turning_on_require_mfa_ends_password_only_sessions_immediately(web, pg_conn):
    member(pg_conn, web)
    access = web.login().json()["access_token"]
    bearer = {"Authorization": f"Bearer {access}"}
    assert web.http.get("/me", headers=bearer).status_code == 200
    set_policy(pg_conn, require_mfa=True)
    assert web.http.get("/me", headers=bearer).status_code == 401
    csrf = {CSRF_HEADER: web.http.cookies.get(CSRF_COOKIE)}
    assert web.post("/auth/refresh", **csrf).status_code == 401


def test_sessions_that_verified_mfa_survive_turning_on_require_mfa(web, pg_conn):
    totp, _ = enrolled(pg_conn, web)
    access = web.login(mfa_code=totp.now()).json()["access_token"]
    set_policy(pg_conn, require_mfa=True)
    assert web.http.get("/me", headers={"Authorization": f"Bearer {access}"}).status_code == 200
    csrf = {CSRF_HEADER: web.http.cookies.get(CSRF_COOKIE)}
    rotated = web.post("/auth/refresh", **csrf)
    assert rotated.status_code == 200  # the family keeps its MFA verification across rotation
    assert web.http.get("/me", headers={"Authorization": f"Bearer {rotated.json()['access_token']}"}).status_code == 200


# ====================================================================== step-up for API keys


def create_key(client, code: str, **headers):
    return client.post(
        "/api-keys", json={"name": "Reader", "scopes": ["trust:read"], "mfa_code": code}, headers=headers
    )


def test_api_key_creation_needs_an_enrolled_authenticator(client, security_audit):
    r = create_key(client, "123456")  # Elena (dev headers) has no factor yet
    assert r.status_code == 403 and r.json()["error"]["code"] == "mfa_enrollment_required"
    assert security_audit.actions() == ["api-key.step_up_failed"]
    assert security_audit.events[0]["metadata"] == {"reason": "step_up_not_enrolled"}


def test_api_key_creation_rejects_wrong_arbitrary_and_replayed_codes(client, pg_conn, security_audit):
    code = mfa_code(client)  # enrols Elena and gives a fresh code
    for bogus in (wrong(code), "000000", "123456"):
        if bogus == code:
            continue
        r = create_key(client, bogus)
        assert r.status_code == 403 and r.json()["error"]["code"] == "mfa_invalid", bogus
    assert create_key(client, code).status_code == 201
    r = create_key(client, code)  # the same code again
    assert r.status_code == 403
    assert set(security_audit.actions()) == {"api-key.step_up_failed"}
    assert all(code not in str(e) for e in security_audit.events)


def test_a_signed_in_admin_creates_a_key_with_a_fresh_code(web, pg_conn):
    totp, _ = enrolled(pg_conn, web, "keys.admin@acme.io")
    access = web.login("keys.admin@acme.io", mfa_code=totp.now()).json()["access_token"]
    bearer = {"Authorization": f"Bearer {access}"}
    body = {"name": "CI", "scopes": ["trust:read"], "mfa_code": totp.now()}
    assert web.http.post("/api-keys", json=body, headers=bearer).status_code == 403  # used for sign-in already
    allow_next_code(pg_conn, "keys.admin@acme.io")
    assert web.http.post("/api-keys", json=body, headers=bearer).status_code == 201


# ====================================================================== key rotation


def test_mfa_key_rotation_reencrypts_on_use_and_removed_versions_stop_working(pg_db, pg_conn):
    old_ring = os.environ["DP_MFA_ENCRYPTION_KEYS"]
    web = Browser(pg_db)
    set_policy(pg_conn, require_mfa=False)
    totp, _ = enrolled(pg_conn, web)
    new = f"m2={'n' * 48}"
    rotated = Browser(
        pg_db, Settings(env="test", mfa_encryption_keys=f"{new},{old_ring}", mfa_encryption_key_version="m2")
    )
    assert rotated.login(mfa_code=totp.now()).status_code == 200
    row = factor_of(pg_conn)
    assert row.key_version == "m2"
    assert (
        decrypt_mfa_secret(
            Keyring(parse_keyring(new), "m2"), row.secret_ciphertext, "m2", user_id=row.user_id.bytes
        ).decode()
        == totp.secret
    )
    allow_next_code(pg_conn)
    only_old = Browser(pg_db, Settings(env="test", mfa_encryption_keys=old_ring, mfa_encryption_key_version="m1"))
    assert only_old.login(mfa_code=totp.now()).status_code == 401  # m2 removed: the factor can't be verified


# ====================================================================== security events, end to end (committed)


def test_rejected_requests_are_persisted_although_the_request_rolls_back(migrated, owner_database):
    """A real SecurityAuditWriter in an app that owns its database: the 401 rolls the request back, the security
    events stay. Uses committed data, cleaned up afterwards."""
    marker = f"198.51.100.{uuid.uuid4().int % 200 + 1}"
    settings = Settings(env="test")
    try:
        with migrated.session() as s:
            seed_demo(s)
        app = create_app(settings, demo_registry())
        with TestClient(app, base_url=BASE, client=(marker, 1)) as http:
            assert (
                http.post(
                    "/auth/login", json={"email": "nobody@acme.io", "password": "guess guess guess"}, headers=ORIGIN
                ).status_code
                == 401
            )
            assert http.get("/trust/incidents", headers={"Authorization": "Bearer dp_live_guess"}).status_code == 401
        with owner_database.session() as s:
            rows = s.scalars(select(AuditEventRecord).where(func.host(AuditEventRecord.ip_address) == marker)).all()
            assert sorted((r.action, r.event_metadata["reason"]) for r in rows) == [
                ("api-key.rejected", "invalid_key"),
                ("login.failed", "unknown_account"),
            ]
            assert all(r.tenant_id is None and r.actor_type == "anonymous" for r in rows)
            assert not any("nobody@acme.io" in str(r.__dict__) or "guess" in str(r.__dict__) for r in rows)
    finally:
        with owner_database.session() as s:
            s.execute(text("ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only"))
            s.execute(delete(AuditEventRecord).where(func.host(AuditEventRecord.ip_address) == marker))
            s.execute(text("ALTER TABLE audit_events ENABLE TRIGGER audit_events_append_only"))
            remove_demo(s)


def test_failed_sign_ins_are_recorded_with_a_reason_and_never_the_attempted_email(web, pg_conn):
    member(pg_conn, web)
    web.login(password="hunter2-guess-xyz")
    web.login(email="ghost@acme.io")
    reasons = [(e["action"], e["metadata"]["reason"], e["actor_type"]) for e in web.audit.events]
    assert reasons == [("login.failed", "wrong_password", "user"), ("login.failed", "unknown_account", "anonymous")]
    assert "ghost@acme.io" not in str(web.audit.events) and "hunter2-guess-xyz" not in str(web.audit.events)
