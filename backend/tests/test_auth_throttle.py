"""Stage 3B.3: authentication abuse protection, against real PostgreSQL.

Limiter-level tests drive ``AuthThrottle`` directly (several instances = several application processes sharing one
database). HTTP tests go through the real app with distinct client addresses (``TestClient(client=(ip, port))``).
Counters are committed by design; the autouse fixture in conftest empties the table around every test.
"""

import logging
import secrets
import threading
import time
from datetime import UTC, datetime, timedelta

import pyotp
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text, update
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import TooManyRequests
from app.core.security import Keyring, parse_keyring
from app.modules.auth import service as auth_service
from app.modules.auth.models import AuthThrottleBucket
from app.modules.auth.throttle import (
    AuthThrottle,
    ThrottleUnavailable,
    account_subject,
    address_subject,
    user_subject,
)
from app.modules.identity.models import MfaTotpFactor, User
from app.modules.tenants.models import TenantSettings
from app.seed import demo_registry
from app.seed_postgres import seed_demo

from .conftest import TEST_DATABASE_URL, RecordingSecurityAudit, make_app, mfa_code
from .factories import remove_demo

BASE = "https://testserver/api/v1"
ORIGIN = {"Origin": "http://localhost:5173"}
PASSWORD = "correct horse battery staple"
EMAIL = "throttle.user@acme.io"
DEAD_DB = "postgresql+psycopg://nobody:secret@127.0.0.1:1/nowhere_test"
T0 = datetime(2030, 1, 1, 12, 0, tzinfo=UTC)


def _limiter(keys: str | None = None, active: str | None = None, url: str = TEST_DATABASE_URL, **overrides):
    settings = Settings(env="test", **overrides)
    ring = parse_keyring(keys) if keys else parse_keyring(settings.throttle_keys)
    return AuthThrottle(url, Keyring(ring, active or settings.throttle_key_version), settings)


@pytest.fixture
def make_limiter(migrated):
    created = []

    def factory(*args, **kwargs) -> AuthThrottle:
        limiter = _limiter(*args, **kwargs)
        created.append(limiter)
        return limiter

    yield factory
    for limiter in created:
        limiter.dispose()


def rows(owner_database) -> list[AuthThrottleBucket]:
    with owner_database.session() as s:
        return list(s.scalars(select(AuthThrottleBucket)))


def allowed(limiter: AuthThrottle, scope: str, subject: str, n: int, at=None) -> list[bool]:
    return [limiter.consume(scope, subject, at=at).allowed for _ in range(n)]


# ====================================================================== identifiers and privacy


def test_subjects_are_scoped_hmacs_never_raw_identifiers(make_limiter, owner_database):
    limiter = make_limiter()
    limiter.consume("login_account", account_subject("Someone@Acme.io"))
    limiter.consume("login_ip", address_subject("203.0.113.7"))
    stored = rows(owner_database)
    assert len(stored) == 2 and all(len(r.subject_hash) == 32 for r in stored)
    dump = b"".join(r.subject_hash for r in stored) + str([r.__dict__ for r in stored]).encode()
    assert b"someone" not in dump.lower() and b"203.0.113.7" not in dump
    same = limiter.subject_hash("login_account", account_subject("someone@acme.io"))
    assert same in {r.subject_hash for r in stored}  # case-insensitive, like sign-in
    assert limiter.subject_hash("mfa", "x") != limiter.subject_hash("recovery_code", "x")  # scope is in the input
    assert _limiter(keys=f"t9={'z' * 48}", active="t9").subject_hash("mfa", "x") != limiter.subject_hash("mfa", "x")


def test_address_subjects_group_ipv6_by_64_and_unmap_ipv4():
    assert address_subject("2001:db8:1:2:aaaa::1") == address_subject("2001:db8:1:2:ffff::9")  # same /64
    assert address_subject("2001:db8:1:2::1") != address_subject("2001:db8:1:3::1")
    assert address_subject("::ffff:198.51.100.4") == address_subject("198.51.100.4") == "ip:198.51.100.4"
    assert address_subject("testclient") == "label:testclient"
    assert account_subject("  A@B.co ") == account_subject("a@b.co")
    assert account_subject("not an email") == "raw:not an email"


# ====================================================================== windows, blocks, scopes


def test_fixed_window_admits_exactly_the_limit_and_says_when_to_retry(make_limiter):
    limiter = make_limiter()
    ip = address_subject("198.51.100.1")
    assert allowed(limiter, "login_ip", ip, 20, at=T0) == [True] * 20
    refused = limiter.consume("login_ip", ip, at=T0 + timedelta(seconds=100))
    assert not refused.allowed and refused.newly_blocked and refused.retry_after == 500
    again = limiter.consume("login_ip", ip, at=T0 + timedelta(seconds=101))
    assert not again.allowed and not again.newly_blocked  # audited once per window


def test_the_window_boundary_is_deterministic(make_limiter):
    limiter = make_limiter()
    ip = address_subject("198.51.100.2")
    allowed(limiter, "login_ip", ip, 21, at=T0)
    assert not limiter.consume("login_ip", ip, at=T0 + timedelta(seconds=599, microseconds=999_999)).allowed
    assert limiter.consume("login_ip", ip, at=T0 + timedelta(seconds=600)).allowed  # window_start + window: new window
    assert allowed(limiter, "login_ip", ip, 19, at=T0 + timedelta(seconds=600)) == [True] * 19
    assert not limiter.consume("login_ip", ip, at=T0 + timedelta(seconds=600)).allowed


def test_progressive_blocks_double_up_to_the_cap_and_never_lock_permanently(make_limiter):
    limiter = make_limiter()
    subject = account_subject("victim@acme.io")
    at = T0
    durations = []
    for _ in range(8):
        assert allowed(limiter, "login_account", subject, 5, at=at) == [True] * 5
        decision = limiter.consume("login_account", subject, at=at)
        assert not decision.allowed and decision.newly_blocked
        durations.append(decision.retry_after)
        during = limiter.consume("login_account", subject, at=at + timedelta(seconds=decision.retry_after - 1))
        assert not during.allowed and not during.newly_blocked and during.retry_after == 1
        at += timedelta(seconds=decision.retry_after)  # the block always ends
    assert durations == [60, 120, 240, 480, 960, 1920, 3600, 3600]


def test_block_levels_are_forgotten_after_the_memory_period_and_reset_by_success(make_limiter):
    limiter = make_limiter()
    subject = account_subject("someone@acme.io")
    allowed(limiter, "login_account", subject, 6, at=T0)  # blocked 60 s (level 1)
    later = T0 + timedelta(seconds=60)
    allowed(limiter, "login_account", subject, 5, at=later)
    assert limiter.consume("login_account", subject, at=later).retry_after == 120  # level 2
    much_later = later + timedelta(seconds=120) + timedelta(hours=24)
    allowed(limiter, "login_account", subject, 5, at=much_later)
    assert limiter.consume("login_account", subject, at=much_later).retry_after == 60  # forgotten
    limiter.reset("login_account", subject, at=much_later)
    assert limiter.consume("login_account", subject, at=much_later).allowed  # a correct password lifts the block


def test_scopes_are_independent(make_limiter):
    limiter = make_limiter()
    allowed(limiter, "mfa", "user:1", 6, at=T0)
    assert not limiter.consume("mfa", "user:1", at=T0).allowed
    assert limiter.consume("recovery_code", "user:1", at=T0).allowed
    assert limiter.consume("login_account", "user:1", at=T0).allowed


# ====================================================================== shared state, concurrency, restarts


def test_two_instances_share_one_counter(make_limiter):
    a, b = make_limiter(), make_limiter()
    ip = address_subject("198.51.100.3")
    assert allowed(a, "login_ip", ip, 10, at=T0) == [True] * 10
    assert allowed(b, "login_ip", ip, 10, at=T0) == [True] * 10
    assert not a.consume("login_ip", ip, at=T0).allowed and not b.consume("login_ip", ip, at=T0).allowed


def test_a_restart_does_not_reset_counters(make_limiter):
    before = make_limiter()
    allowed(before, "login_account", account_subject("x@acme.io"), 5, at=T0)
    before.dispose()
    after = make_limiter()  # a new process
    assert not after.consume("login_account", account_subject("x@acme.io"), at=T0).allowed


@pytest.mark.parametrize(("scope", "limit"), [("login_ip", 20), ("login_account", 5)])
def test_concurrent_attempts_across_instances_never_exceed_the_limit(make_limiter, scope, limit):
    instances = [make_limiter() for _ in range(4)]
    subject = f"race:{secrets.token_hex(4)}"
    barrier, results = threading.Barrier(40), []
    lock = threading.Lock()

    def attempt(i: int) -> None:
        barrier.wait()
        decision = instances[i % 4].consume(scope, subject, at=T0)
        with lock:
            results.append(decision.allowed)

    threads = [threading.Thread(target=attempt, args=(i,)) for i in range(40)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert results.count(True) == limit and results.count(False) == 40 - limit


# ====================================================================== key rotation


def test_key_rotation_keeps_counters(make_limiter, owner_database):
    old = f"t1={'o' * 48}"
    new = f"t2={'n' * 48}"
    before = make_limiter(keys=old, active="t1")
    subject = account_subject("rotate@acme.io")
    allowed(before, "login_account", subject, 4, at=T0)
    rotating = make_limiter(keys=f"{new},{old}", active="t2")
    assert rotating.consume("login_account", subject, at=T0).allowed  # 5th: carried over, not reset
    [row] = rows(owner_database)
    assert row.key_version == "t2" and row.attempt_count == 5
    after = make_limiter(keys=new, active="t2")  # old version retired
    assert not after.consume("login_account", subject, at=T0).allowed


def test_removing_a_version_before_rows_moved_starts_those_subjects_afresh(make_limiter):
    """Documented trade-off: keep the old version listed for at least one window and block period after rotating."""
    before = make_limiter(keys=f"t1={'o' * 48}", active="t1")
    allowed(before, "login_account", account_subject("r@acme.io"), 5, at=T0)
    jumped = make_limiter(keys=f"t2={'n' * 48}", active="t2")
    assert jumped.consume("login_account", account_subject("r@acme.io"), at=T0).allowed


# ====================================================================== failure policy


def test_an_unreachable_database_fails_closed_with_a_bounded_cooldown(make_limiter, caplog):
    limiter = make_limiter(url=DEAD_DB, throttle_failure_cooldown_seconds=30)
    connects = []
    from sqlalchemy import event

    event.listen(limiter._engine, "do_connect", lambda *a, **k: connects.append(1))
    with caplog.at_level(logging.ERROR):
        with pytest.raises(ThrottleUnavailable):
            limiter.enforce("login_account", account_subject("victim@acme.io"), client="198.51.100.9")
        started = time.monotonic()
        for _ in range(20):
            with pytest.raises(ThrottleUnavailable):
                limiter.enforce("login_ip", address_subject("198.51.100.9"), client="198.51.100.9")
    assert time.monotonic() - started < 0.5 and len(connects) == 1  # no reconnect storm during the cooldown
    assert caplog.text.count("Auth throttle unavailable") == 1  # one line per outage, not per request
    assert "victim" not in caplog.text and "198.51.100.9" not in caplog.text


def test_failure_during_the_update_refuses_instead_of_allowing(make_limiter, monkeypatch):
    limiter = make_limiter(throttle_failure_cooldown_seconds=0)
    from app.modules.auth import throttle as module

    monkeypatch.setattr(module, "_CONSUME", text("SELECT pg_sleep(5)"))  # exceeds the 2 s statement timeout
    with pytest.raises(ThrottleUnavailable):
        limiter.consume("login_ip", address_subject("198.51.100.10"))


# ====================================================================== HTTP: sign-in


def _browser(pg_db, throttle, ip: str = "198.51.100.20", security_audit=None, **settings) -> TestClient:
    app = make_app(
        Settings(env="test", **settings),
        demo_registry(),
        database=pg_db,
        rate_limiter=throttle,
        security_audit=security_audit,
    )
    return TestClient(app, base_url=BASE, client=(ip, 50000))


def _member(conn, email: str = EMAIL) -> None:
    with Session(bind=conn, join_transaction_mode="create_savepoint") as s:
        s.execute(update(TenantSettings).values(require_mfa=False))
        settings = Settings(env="test")
        token = auth_service.issue_invitation(s, settings, tenant_slug="acme", email=email, role_key="admin").token
        auth_service.accept_invitation(s, settings, token=token, password=PASSWORD)
        s.commit()


def _login(http: TestClient, email: str = EMAIL, password: str = PASSWORD, **extra):
    return http.post("/auth/login", json={"email": email, "password": password, **extra}, headers=ORIGIN)


def test_the_account_limit_follows_the_account_across_addresses(pg_db, pg_conn, throttle):
    _member(pg_conn)
    for i in range(5):
        assert _login(_browser(pg_db, throttle, f"198.51.100.{30 + i}"), password="wrong password!!").status_code == 401
    r = _login(_browser(pg_db, throttle, "198.51.100.99"))  # a new address, and even the right password
    assert r.status_code == 429 and r.headers["Retry-After"] == "60"
    assert r.json() == {"error": {"code": "too_many_requests", "message": "Too many attempts. Try again later."}}


def test_the_address_limit_spans_accounts(pg_db, pg_conn, throttle):
    http = _browser(pg_db, throttle)
    codes = [_login(http, f"user{i}@acme.io", "guess guess guess").status_code for i in range(21)]
    assert codes == [401] * 20 + [429]


def test_unknown_and_existing_accounts_are_throttled_identically(pg_db, pg_conn, throttle):
    _member(pg_conn)
    existing = [_login(_browser(pg_db, throttle, "198.51.100.40"), password="wrong password!!") for _ in range(7)]
    unknown = [_login(_browser(pg_db, throttle, "198.51.100.41"), "ghost@acme.io") for _ in range(7)]
    shape = [(r.status_code, r.json(), r.headers.get("Retry-After")) for r in existing]
    assert shape == [(r.status_code, r.json(), r.headers.get("Retry-After")) for r in unknown]
    assert [s for s, _, _ in shape] == [401] * 5 + [429, 429]


def test_a_correct_password_resets_the_account_count(pg_db, pg_conn, throttle):
    _member(pg_conn)
    http = _browser(pg_db, throttle)
    for _ in range(4):
        assert _login(http, password="wrong password!!").status_code == 401
    assert _login(http).status_code == 200
    for _ in range(4):
        assert _login(http, password="wrong password!!").status_code == 401  # still not throttled
    assert _login(http, "Throttle.User@ACME.io", "wrong password!!").status_code == 401  # case: same counter, 5th
    assert _login(http, password="wrong password!!").status_code == 429


def test_throttling_is_audited_once_and_failures_stop_being_recorded(pg_db, pg_conn, throttle, security_audit):
    _member(pg_conn)
    http = _browser(pg_db, throttle, security_audit=security_audit)
    for _ in range(9):
        _login(http, password="hunter2-guess-xyz")
    actions = [e["action"] for e in security_audit.events]
    assert actions.count("login.failed") == 5 and actions.count("login.throttled") == 1
    [event] = [e for e in security_audit.events if e["action"] == "login.throttled"]
    assert event["metadata"] == {"scope": "login_account", "retry_after_seconds": 60}
    assert EMAIL not in str(security_audit.events) and "hunter2" not in str(security_audit.events)


def test_enrolment_password_checks_share_the_sign_in_limits(pg_db, pg_conn, throttle):
    _member(pg_conn)
    http = _browser(pg_db, throttle)
    for _ in range(5):
        r = http.post("/auth/mfa/enrollment", json={"email": EMAIL, "password": "nope nope nope"}, headers=ORIGIN)
        assert r.status_code == 401
    assert _login(http).status_code == 429  # the enrolment endpoint is not a side door


# ====================================================================== HTTP: MFA and recovery codes


def _enrolled(pg_conn, http: TestClient, throttle) -> tuple[pyotp.TOTP, list[str]]:
    _member(pg_conn)
    r = http.post("/auth/mfa/enrollment", json={"email": EMAIL, "password": PASSWORD}, headers=ORIGIN)
    totp = pyotp.TOTP(r.json()["secret"])
    r = http.post(
        "/auth/mfa/enrollment/confirm", json={"email": EMAIL, "password": PASSWORD, "code": totp.now()}, headers=ORIGIN
    )
    with Session(bind=pg_conn, join_transaction_mode="create_savepoint") as s:
        s.execute(update(MfaTotpFactor).values(last_used_step=None))
        s.commit()
    return totp, r.json()["recovery_codes"]


def _wrong(code: str) -> str:
    return f"{(int(code) + 1) % 1_000_000:06d}"


def test_invalid_and_replayed_codes_count_and_the_sixth_is_refused(pg_db, pg_conn, throttle):
    http = _browser(pg_db, throttle)
    totp, _ = _enrolled(pg_conn, http, throttle)
    code = totp.now()
    assert _login(http, mfa_code=code).status_code == 200  # success resets the mfa count
    statuses = [_login(http, mfa_code=code).status_code]  # replay: a failed attempt
    statuses += [_login(http, mfa_code=_wrong(code)).status_code for _ in range(4)]
    statuses.append(_login(http, mfa_code=_wrong(code)).status_code)
    assert statuses == [401] * 5 + [429]
    with Session(bind=pg_conn, join_transaction_mode="create_savepoint") as s:
        s.execute(update(MfaTotpFactor).values(last_used_step=None))
        s.commit()
    assert _login(http, mfa_code=totp.now()).status_code == 429  # blocked even with a valid code


def test_recovery_codes_have_their_own_limit(pg_db, pg_conn, throttle):
    http = _browser(pg_db, throttle)
    _, codes = _enrolled(pg_conn, http, throttle)
    statuses = [_login(http, recovery_code="aaaa-bbbb-cccc-dddd").status_code for _ in range(6)]
    assert statuses == [401] * 5 + [429]
    assert _login(http, recovery_code=codes[0]).status_code == 429  # a valid code waits for the block too


def test_step_up_guesses_share_the_users_mfa_limit(client, throttle):
    code = mfa_code(client)  # enrols Elena
    for _ in range(5):
        body = {"name": "K", "scopes": ["trust:read"], "mfa_code": _wrong(code)}
        assert client.post("/api-keys", json=body).status_code == 403
    r = client.post("/api-keys", json={"name": "K", "scopes": ["trust:read"], "mfa_code": code})
    assert r.status_code == 429 and "Retry-After" in r.headers


# ====================================================================== HTTP: API keys


def test_invalid_api_keys_are_throttled_per_address_and_valid_keys_keep_working(client, pg_db, throttle):
    created = client.post("/api-keys", json={"name": "Reader", "scopes": ["trust:read"], "mfa_code": mfa_code(client)})
    valid = created.json()["secret"]
    bot = TestClient(client.app, base_url="http://testserver/api/v1", client=("203.0.113.50", 1))
    statuses = [
        bot.get("/trust/incidents", headers={"Authorization": f"Bearer dp_live_{secrets.token_hex(20)}"}).status_code
        for _ in range(31)
    ]
    assert statuses == [401] * 30 + [429]
    assert bot.get("/trust/incidents", headers={"Authorization": f"Bearer {valid}"}).status_code == 200
    with Session(bind=pg_db._sessions.kw["bind"]) as s:
        dump = str([r.__dict__ for r in s.scalars(select(AuthThrottleBucket))])
    assert valid not in dump and "dp_live_" not in dump


def test_revoked_keys_count_as_invalid(client, throttle):
    created = client.post("/api-keys", json={"name": "Old", "scopes": ["trust:read"], "mfa_code": mfa_code(client)})
    client.post(f"/api-keys/{created.json()['key']['id']}/revoke")
    bot = TestClient(client.app, base_url="http://testserver/api/v1", client=("203.0.113.51", 1))
    secret = created.json()["secret"]
    statuses = [
        bot.get("/trust/incidents", headers={"Authorization": f"Bearer {secret}"}).status_code for _ in range(31)
    ]
    assert statuses == [401] * 30 + [429]


def test_api_key_throttling_is_audited_once_and_blocked_attempts_write_no_rejections(client, throttle, security_audit):
    bot = TestClient(client.app, base_url="http://testserver/api/v1", client=("203.0.113.52", 1))
    for _ in range(30):
        assert bot.get("/trust/incidents", headers={"Authorization": "Bearer dp_live_nope"}).status_code == 401
    assert [e["action"] for e in security_audit.events] == ["api-key.rejected"] * 30
    for _ in range(25):  # the address is blocked from here on
        assert bot.get("/trust/incidents", headers={"Authorization": "Bearer dp_live_nope"}).status_code == 429
    after = [e["action"] for e in security_audit.events[30:]]
    assert after == ["api-key.throttled"]  # one event for the block, no per-attempt rejections
    [throttled] = security_audit.events[30:]
    assert set(throttled["metadata"]) == {"scope", "retry_after_seconds"}
    assert throttled["metadata"]["scope"] == "api_key_ip" and throttled["metadata"]["retry_after_seconds"] > 0
    assert "dp_live_nope" not in str(security_audit.events)


# ====================================================================== HTTP: failure policy


def test_sign_in_fails_closed_when_the_limiter_is_down(pg_db, pg_conn, make_limiter):
    _member(pg_conn)
    audit = RecordingSecurityAudit()
    down = make_limiter(url=DEAD_DB)
    app = make_app(Settings(env="test"), demo_registry(), database=pg_db, rate_limiter=down, security_audit=audit)
    http = TestClient(app, base_url=BASE)
    r = _login(http)
    assert r.status_code == 503 and r.json()["error"]["code"] == "service_unavailable"
    assert audit.events == []  # the password was never checked


def test_without_a_limiter_sign_in_is_refused(pg_db, pg_conn):
    _member(pg_conn)
    app = make_app(Settings(env="test"), demo_registry(), database=pg_db, rate_limiter=None)
    assert _login(TestClient(app, base_url=BASE)).status_code == 503


def test_api_key_outage_policy_is_explicit_503_without_per_request_events(client, pg_db, make_limiter):
    """Limiter down: an invalid key can't be counted, so it gets 503 (not an ordinary 401) and no api-key.rejected
    event per request (an unbounded write path); valid keys never consult the limiter and keep working."""
    secret = client.post(
        "/api-keys", json={"name": "R", "scopes": ["trust:read"], "mfa_code": mfa_code(client)}
    ).json()["secret"]
    audit = RecordingSecurityAudit()
    down = make_limiter(url=DEAD_DB)
    app = make_app(Settings(env="test"), demo_registry(), database=pg_db, rate_limiter=down, security_audit=audit)
    http = TestClient(app, base_url="http://testserver/api/v1")
    for _ in range(10):
        r = http.get("/trust/incidents", headers={"Authorization": "Bearer dp_live_nope"})
        assert r.status_code == 503 and r.json()["error"] == {
            "code": "service_unavailable",
            "message": "Authentication is temporarily unavailable",
        }
    assert audit.events == []
    assert http.get("/trust/incidents", headers={"Authorization": f"Bearer {secret}"}).status_code == 200


def test_without_a_limiter_invalid_keys_get_503_and_valid_keys_work(client, pg_db):
    secret = client.post(
        "/api-keys", json={"name": "R", "scopes": ["trust:read"], "mfa_code": mfa_code(client)}
    ).json()["secret"]
    app = make_app(Settings(env="test"), demo_registry(), database=pg_db, rate_limiter=None)
    http = TestClient(app, base_url="http://testserver/api/v1")
    assert http.get("/trust/incidents", headers={"Authorization": "Bearer dp_live_nope"}).status_code == 503
    assert http.get("/trust/incidents", headers={"Authorization": f"Bearer {secret}"}).status_code == 200


def test_too_many_requests_carries_retry_after_and_nothing_else():
    exc = TooManyRequests(0.2)
    assert exc.retry_after == 1 and exc.status_code == 429 and "attempt" in exc.message.lower()


# ====================================================================== purge (owner)


def test_the_owner_purge_removes_only_stale_unblocked_rows(make_limiter, owner_database, migrated):
    from app import cli

    limiter = make_limiter()
    old = datetime.now(UTC) - timedelta(hours=48)
    for name in ("stale", "fresh", "still-blocked"):
        limiter.consume("login_account", name)
    with owner_database.session() as s:
        stale = limiter.subject_hash("login_account", "stale")
        blocked = limiter.subject_hash("login_account", "still-blocked")
        s.execute(
            update(AuthThrottleBucket)
            .where(AuthThrottleBucket.subject_hash.in_([stale, blocked]))
            .values(created_at=old, updated_at=old, window_start=old)
        )
        s.execute(
            update(AuthThrottleBucket)
            .where(AuthThrottleBucket.subject_hash == blocked)
            .values(blocked_until=datetime.now(UTC) + timedelta(hours=1), block_level=1)
        )
    assert cli.main(["purge-auth-throttle"]) == 0
    remaining = {r.subject_hash for r in rows(owner_database)}
    assert stale not in remaining and blocked in remaining
    assert limiter.subject_hash("login_account", "fresh") in remaining


def test_the_runtime_user_cannot_delete_counters(db_session):
    from sqlalchemy.exc import ProgrammingError

    with pytest.raises(ProgrammingError, match="permission denied"):
        db_session.execute(text("DELETE FROM auth_throttle_buckets"))


def test_user_subjects_use_the_internal_id(pg_conn):
    with Session(bind=pg_conn) as s:
        user = s.scalar(select(User).where(User.public_id == "u-elena"))
        assert user_subject(user) == f"user:{user.id}"


# ====================================================================== review: reset racing with failures (PostgreSQL)


def _run_together(*callables) -> list:
    barrier, results, lock = threading.Barrier(len(callables)), [None] * len(callables), threading.Lock()

    def run(i: int) -> None:
        barrier.wait()
        try:
            outcome = callables[i]()
        except Exception as exc:  # noqa: BLE001
            outcome = exc
        with lock:
            results[i] = outcome

    threads = [threading.Thread(target=run, args=(i,)) for i in range(len(callables))]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return results


@pytest.mark.parametrize("round_", range(5))
def test_a_success_reset_racing_with_failures_never_admits_more_than_the_limit(make_limiter, round_):
    """Account at 4 of 5 wrong passwords. One correct sign-in (consume, then reset) races twelve wrong ones across four
    instances. Whatever the interleaving: at most 5 wrong attempts are admitted, every admitted attempt saw a distinct
    count (no lost update), and the correct one is admitted only if it got there before the limit."""
    instances = [make_limiter() for _ in range(4)]
    subject = account_subject(f"race{round_}.{secrets.token_hex(3)}@acme.io")
    assert allowed(instances[0], "login_account", subject, 4) == [True] * 4

    def correct():
        decision = instances[0].consume("login_account", subject)
        if decision.allowed:
            instances[0].reset("login_account", subject)
        return ("correct", decision)

    def wrong(i: int):
        return lambda: ("wrong", instances[i % 4].consume("login_account", subject))

    results = _run_together(correct, *[wrong(i) for i in range(12)])
    assert not [r for r in results if isinstance(r, Exception)], results
    correct_decision = next(d for kind, d in results if kind == "correct")
    admitted_wrong = [d for kind, d in results if kind == "wrong" and d.allowed]
    assert len(admitted_wrong) <= 5
    counts = [d.attempts for d in admitted_wrong]
    assert len(counts) == len(set(counts)) and all(1 <= c <= 5 for c in counts)  # serialized, no lost update
    if correct_decision.allowed:
        assert correct_decision.attempts == 5  # it came before the limit; its reset then started a fresh window
    else:
        assert len(admitted_wrong) == 1 and counts == [5]  # a wrong attempt used the last slot; correct was refused
    # Afterwards the counter is consistent: within the limit, or blocked (never negative, never split).
    after = instances[1].consume("login_account", subject)
    assert after.attempts <= 6


def test_correct_and_wrong_passwords_race_through_the_real_sign_in(migrated, owner_database, make_limiter):
    """The same race through authenticate_password (real Argon2 checks, committed user, one limiter per thread)."""
    settings = Settings(env="test")
    email = "race.reset@acme.io"
    try:
        with migrated.session() as s:
            seed_demo(s)
            token = auth_service.issue_invitation(s, settings, tenant_slug="acme", email=email, role_key="viewer").token
            auth_service.accept_invitation(s, settings, token=token, password=PASSWORD)
        warmup = make_limiter()
        assert allowed(warmup, "login_account", account_subject(email), 4) == [True] * 4

        def attempt(password: str):
            limiter = make_limiter()
            with migrated.session() as s:
                return auth_service.authenticate_password(
                    s, email=email, password=password, throttle=limiter, client="198.51.100.77"
                )

        results = _run_together(lambda: attempt(PASSWORD), *[(lambda: attempt("wrong password!!")) for _ in range(5)])
        correct, wrongs = results[0], results[1:]
        assert all(type(r).__name__ in ("Unauthorized", "TooManyRequests") for r in wrongs), wrongs
        admitted_wrong = sum(type(r).__name__ == "Unauthorized" for r in wrongs)
        assert admitted_wrong <= 5
        if isinstance(correct, User):
            assert correct.email == email
        else:
            assert type(correct).__name__ == "TooManyRequests" and admitted_wrong == 1
    finally:
        with owner_database.session() as s:
            remove_demo(s, extra_emails=(email,))


# ====================================================================== review: concurrent re-keying (PostgreSQL)


OLD_KEY = f"t1={'o' * 48}"
NEW_KEY = f"t2={'n' * 48}"


def _single_row(owner_database) -> AuthThrottleBucket:
    stored = rows(owner_database)
    assert len(stored) == 1, f"the counter split into {len(stored)} rows"
    return stored[0]


def test_concurrent_rekeying_and_consumption_keep_one_counter(make_limiter, owner_database):
    """A counter at 10/20 under the old key; 40 attempts race on four instances that just made the new key active.
    Exactly 10 more are admitted, and one row remains, under the new key."""
    subject = address_subject("198.51.100.60")
    assert allowed(make_limiter(keys=OLD_KEY, active="t1"), "login_ip", subject, 10) == [True] * 10
    instances = [make_limiter(keys=f"{NEW_KEY},{OLD_KEY}", active="t2") for _ in range(4)]
    results = _run_together(*[(lambda i=i: instances[i % 4].consume("login_ip", subject)) for i in range(40)])
    assert sum(d.allowed for d in results) == 10
    row = _single_row(owner_database)
    assert row.key_version == "t2" and row.attempt_count == 10 + 40  # every attempt counted exactly once


@pytest.mark.parametrize("existing", [False, True])
def test_instances_with_different_active_versions_never_split_a_counter(make_limiter, owner_database, existing):
    """A rolling switch of the active version: half the instances still sign with t1, half already with t2 (both list
    both). 40 concurrent attempts admit exactly the limit, and exactly one row remains."""
    subject = account_subject(f"rolling.{secrets.token_hex(3)}@acme.io")
    if existing:
        make_limiter(keys=f"{OLD_KEY},{NEW_KEY}", active="t1").consume("login_ip", subject)
    old_active = [make_limiter(keys=f"{OLD_KEY},{NEW_KEY}", active="t1") for _ in range(2)]
    new_active = [make_limiter(keys=f"{NEW_KEY},{OLD_KEY}", active="t2") for _ in range(2)]
    instances = old_active + new_active
    results = _run_together(*[(lambda i=i: instances[i % 4].consume("login_ip", subject)) for i in range(40)])
    assert sum(d.allowed for d in results) == 20 - (1 if existing else 0)
    _single_row(owner_database)
