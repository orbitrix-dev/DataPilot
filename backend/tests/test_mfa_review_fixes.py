"""Stage 3B.2 review findings (PR #4): recovery-code regeneration under concurrency, auditing sign-ins without the
required MFA code, observable security-audit write failures, and auditing failed regeneration step-ups.

Concurrency and durability tests use real, committed PostgreSQL transactions on separate connections (never SQLite)
and clean up after themselves.
"""

import logging
import threading
import time
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import timedelta

import pyotp
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select, text, update

from app.core import clock
from app.core.config import Settings
from app.main import create_app
from app.modules.audit.models import AuditEventRecord
from app.modules.audit.security_writer import SecurityAuditWriter
from app.modules.auth import mfa
from app.modules.auth import service as auth_service
from app.modules.identity.models import MfaRecoveryCode, MfaTotpFactor, User
from app.modules.tenants.models import TenantSettings
from app.seed import _audit, demo_registry
from app.seed_postgres import seed_demo

from .conftest import TEST_DATABASE_URL, RecordingSecurityAudit
from .factories import remove_demo
from .test_audit_postgres import _remove_global

BASE = "https://testserver/api/v1"
ORIGIN = {"Origin": "http://localhost:5173"}
PASSWORD = "correct horse battery staple"
EMAIL = "review.fix@acme.io"
PLAIN = "plain.member@acme.io"  # a member with a password and no authenticator
DEAD_DB = "postgresql+psycopg://nobody:secret@127.0.0.1:1/nowhere_test"
DEMO_EVENT_IDS = {e.id for e in _audit()}


@dataclass
class Enrolled:
    totp: pyotp.TOTP
    codes: list[str]


def _settings() -> Settings:
    return Settings(env="test")


def _user(s, email: str = EMAIL) -> User:
    return s.scalar(select(User).where(User.email == email))


def _clear_last_step(database, email: str = EMAIL) -> None:
    with database.session() as s:
        s.execute(update(MfaTotpFactor).where(MfaTotpFactor.user_id == _user(s, email).id).values(last_used_step=None))


def _code(totp: pyotp.TOTP, steps: int = 0) -> str:
    return totp.at(clock.now() + timedelta(seconds=30 * steps))


def _active_hashes(database, email: str = EMAIL) -> set[bytes]:
    with database.session() as s:
        return set(
            s.scalars(
                select(MfaRecoveryCode.code_hash).where(
                    MfaRecoveryCode.user_id == _user(s, email).id,
                    MfaRecoveryCode.used_at.is_(None),
                    MfaRecoveryCode.revoked_at.is_(None),
                )
            )
        )


def _hashes(codes: list[str]) -> set[bytes]:
    from app.core.security import token_digest

    return {token_digest(c) for c in codes}


def _usable(database, code: str, email: str = EMAIL) -> bool:
    """Consumes the code in a transaction that is rolled back: tells whether it would work, without using it."""
    with database.engine.connect() as conn, conn.begin() as tx:
        from sqlalchemy.orm import Session

        with Session(bind=conn) as s:
            ok = mfa.consume_recovery_code(s, _user(s, email), code) is not None
        tx.rollback()
    return ok


@pytest.fixture
def committed(migrated, owner_database) -> Iterator[Enrolled]:
    """Committed demo tenant ("Require MFA" off), a member with a password and a confirmed authenticator (EMAIL), and
    a member with a password only (PLAIN). Everything is removed afterwards."""
    settings = _settings()
    started = clock.now()
    try:
        with migrated.session() as s:
            seed_demo(s)
            s.execute(update(TenantSettings).values(require_mfa=False))
            for email in (EMAIL, PLAIN):
                token = auth_service.issue_invitation(
                    s, settings, tenant_slug="acme", email=email, role_key="admin"
                ).token
                auth_service.accept_invitation(s, settings, token=token, password=PASSWORD)
            user = _user(s)
            secret = mfa.start_enrollment(s, settings, user).secret
            codes = mfa.confirm_enrollment(s, settings, user, pyotp.TOTP(secret).now())
        _clear_last_step(migrated)
        yield Enrolled(pyotp.TOTP(secret), codes)
    finally:
        with owner_database.session() as s:
            # Global security events (no tenant) written during the test aren't covered by remove_demo.
            s.execute(text("ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only"))
            s.execute(
                delete(AuditEventRecord).where(
                    AuditEventRecord.tenant_id.is_(None), AuditEventRecord.occurred_at >= started
                )
            )
            s.execute(text("ALTER TABLE audit_events ENABLE TRIGGER audit_events_append_only"))
            remove_demo(s, extra_emails=(EMAIL, PLAIN))


def _regenerate(database, code: str) -> list[str]:
    with database.session() as s:
        return mfa.regenerate_recovery_codes(s, _settings(), _user(s), code)


def _race(database, codes: list[str]) -> list[object]:
    """Runs one regeneration per code at the same moment, each in its own committed transaction."""
    barrier, results = threading.Barrier(len(codes)), [None] * len(codes)

    def attempt(i: int) -> None:
        barrier.wait()
        try:
            results[i] = _regenerate(database, codes[i])
        except Exception as exc:  # noqa: BLE001
            results[i] = exc

    threads = [threading.Thread(target=attempt, args=(i,)) for i in range(len(codes))]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return results


# ====================================================================== 1. regeneration under concurrency (HIGH)


def test_sequential_regeneration_invalidates_the_previous_set(migrated, committed):
    first = _regenerate(migrated, _code(committed.totp, -1))
    second = _regenerate(migrated, _code(committed.totp, 0))
    assert _active_hashes(migrated) == _hashes(second)
    assert not any(_usable(migrated, c) for c in committed.codes + first)
    assert _usable(migrated, second[0])


def test_regeneration_waits_for_the_users_row_lock(migrated, committed):
    """Deterministic check of the serialization itself: while another transaction holds the user's row lock, a
    regeneration can't start revoking or inserting; it proceeds once the lock is released."""
    done = threading.Event()
    with migrated.session() as holder:
        # FOR NO KEY UPDATE: conflicts with the explicit FOR UPDATE in lock_user, but not with the FOR KEY SHARE that
        # inserting codes (foreign key to users) takes, so this checks the explicit lock itself.
        holder.execute(select(User).where(User.email == EMAIL).with_for_update(key_share=True))
        thread = threading.Thread(target=lambda: (_regenerate(migrated, _code(committed.totp)), done.set()))
        thread.start()
        time.sleep(0.5)
        assert not done.is_set(), "regeneration ran while another transaction held the user's lock"
    thread.join(timeout=10)
    assert done.is_set()


def test_concurrent_regenerations_never_leave_two_active_sets(migrated, committed):
    results = _race(migrated, [_code(committed.totp, -1), _code(committed.totp, 0)])
    sets = [r for r in results if isinstance(r, list)]
    assert sets, results
    active = _active_hashes(migrated)
    assert len(active) == 10 and active in [_hashes(s) for s in sets]
    # Every code of every other set (the old one, and a set that lost the race) is unusable.
    losers = [c for s in sets if _hashes(s) != active for c in s] + committed.codes
    assert not any(_usable(migrated, c) for c in losers)


def test_concurrent_regenerations_with_the_same_code_succeed_once(migrated, committed):
    """The same TOTP step twice at once: replay protection holds; the loser's transaction (and any codes it would
    have created) rolls back, and the original set is replaced exactly once."""
    code = _code(committed.totp)
    results = _race(migrated, [code, code])
    winners = [r for r in results if isinstance(r, list)]
    losers = [r for r in results if not isinstance(r, list)]
    assert len(winners) == 1 and len(losers) == 1 and isinstance(losers[0], mfa.StepUpFailed), results
    assert _active_hashes(migrated) == _hashes(winners[0])
    with migrated.session() as s:
        total = s.scalar(
            select(func.count()).select_from(MfaRecoveryCode).where(MfaRecoveryCode.user_id == _user(s).id)
        )
    assert total == 20  # the original ten (revoked) + the winner's ten; the loser inserted nothing


def test_a_failed_regeneration_keeps_the_previous_set(migrated, committed, monkeypatch):
    with pytest.raises(mfa.StepUpFailed):
        _regenerate(migrated, f"{(int(_code(committed.totp)) + 1) % 1_000_000:06d}")
    assert _active_hashes(migrated) == _hashes(committed.codes)

    def boom() -> str:  # fails after the old set was revoked inside the transaction
        raise RuntimeError("simulated failure while generating the new set")

    monkeypatch.setattr(mfa, "new_recovery_code", boom)
    with pytest.raises(RuntimeError):
        _regenerate(migrated, _code(committed.totp))
    assert _active_hashes(migrated) == _hashes(committed.codes)  # the revocation rolled back
    assert _usable(migrated, committed.codes[0])


# ====================================================================== 2 + 4. durable events (real writer, committed)


def _events(owner_database, *actions: str) -> list[AuditEventRecord]:
    with owner_database.session() as s:
        rows = s.scalars(select(AuditEventRecord).where(AuditEventRecord.action.in_(actions))).all()
        return [r for r in rows if r.id not in DEMO_EVENT_IDS]


def test_missing_mfa_and_failed_regeneration_step_ups_are_persisted(migrated, owner_database, committed):
    app = create_app(_settings(), demo_registry())  # owns its database and a real SecurityAuditWriter
    with TestClient(app, base_url=BASE) as http:

        def login(email: str, **extra):
            return http.post("/auth/login", json={"email": email, "password": PASSWORD, **extra}, headers=ORIGIN)

        r = login(EMAIL)
        assert (r.status_code, r.json()["error"]["code"]) == (401, "mfa_required")
        assert login(EMAIL, password="hunter2-guess-xyz").status_code == 401
        signed_in = login(EMAIL, mfa_code=(used := committed.totp.now()))
        assert signed_in.status_code == 200
        bearer = {"Authorization": f"Bearer {signed_in.json()['access_token']}"}
        wrong = f"{(int(used) + 1) % 1_000_000:06d}"
        assert http.post("/auth/mfa/recovery-codes", json={"code": wrong}, headers=bearer).status_code == 403
        assert http.post("/auth/mfa/recovery-codes", json={"code": used}, headers=bearer).status_code == 403  # replay
        plain = login(PLAIN).json()["access_token"]
        r = http.post("/auth/mfa/recovery-codes", json={"code": used}, headers={"Authorization": f"Bearer {plain}"})
        assert r.status_code == 409  # unchanged semantics for "MFA is not enabled"
        assert http.get("https://testserver/healthz/security-audit").json()["status"] == "ok"

    failed = _events(owner_database, "login.failed")
    assert sorted(e.event_metadata["reason"] for e in failed) == ["mfa_required", "wrong_password"]
    refused = _events(owner_database, "user.recovery_codes_step_up_failed")
    assert sorted(e.event_metadata["reason"] for e in refused) == [
        "recovery_code_regeneration_not_enrolled",
        "recovery_code_regeneration_step_up_failed",
        "recovery_code_regeneration_step_up_failed",
    ]
    assert all(e.actor_type == "user" for e in failed + refused)
    by_reason = {e.event_metadata["reason"]: e for e in failed}
    assert by_reason["wrong_password"].tenant_id is None  # refused before a workspace is chosen (global event)
    assert by_reason["mfa_required"].tenant_id is not None and all(e.tenant_id is not None for e in refused)
    for e in failed + refused:
        stored = str(e.__dict__)
        assert e.event_metadata.keys() == {"reason"}
        assert PASSWORD not in stored and "hunter2" not in stored and used not in stored and wrong not in stored
        assert not any(c in stored for c in committed.codes)
    assert _active_hashes(migrated) == _hashes(committed.codes)  # refused regenerations changed nothing


def test_a_valid_code_regenerates_and_is_not_recorded_as_a_failure(migrated, owner_database, committed):
    app = create_app(_settings(), demo_registry())
    with TestClient(app, base_url=BASE) as http:
        token = http.post(
            "/auth/login",
            json={"email": EMAIL, "password": PASSWORD, "mfa_code": _code(committed.totp, -1)},
            headers=ORIGIN,
        ).json()["access_token"]
        r = http.post(
            "/auth/mfa/recovery-codes",
            json={"code": _code(committed.totp)},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200 and len(r.json()["recovery_codes"]) == 10
    assert _events(owner_database, "user.recovery_codes_step_up_failed") == []
    assert len(_events(owner_database, "user.recovery_codes_regenerated")) == 1


def test_unknown_accounts_are_recorded_without_the_submitted_email(web_with_recorder):
    web, audit = web_with_recorder
    r = web.post("/auth/login", json={"email": "ghost.person@acme.io", "password": "x" * 14}, headers=ORIGIN)
    assert r.status_code == 401
    assert [(e["action"], e["metadata"]) for e in audit.events] == [("login.failed", {"reason": "unknown_account"})]
    assert "ghost.person" not in str(audit.events)


@pytest.fixture
def web_with_recorder(pg_db) -> tuple[TestClient, RecordingSecurityAudit]:
    audit = RecordingSecurityAudit()
    app = create_app(_settings(), demo_registry(), database=pg_db, security_audit=audit)
    return TestClient(app, base_url=BASE), audit


# ====================================================================== 3. observable writer failures (HIGH)


def test_a_successful_write_returns_true_and_is_counted(migrated, owner_database):
    writer = SecurityAuditWriter(TEST_DATABASE_URL)
    try:
        assert writer.record("login.failed", "health probe", metadata={"reason": "unknown_account"}) is True
        health = writer.health()
        assert health["healthy"] and health["events_written"] == 1 and health["events_failed"] == 0
        assert health["last_success_at"] is not None
    finally:
        writer.dispose()
        _remove_global(owner_database, "health probe")  # a global event: removed as the owner


def test_a_failed_write_returns_false_logs_safely_and_marks_the_writer_unhealthy(caplog):
    writer = SecurityAuditWriter(DEAD_DB, timeout_seconds=1)
    try:
        with caplog.at_level(logging.ERROR):
            ok = writer.record(
                "login.failed", "Sign-in failed: wrong password", actor_label="Elena", metadata={"reason": "x"}
            )
        assert ok is False
        health = writer.health()
        assert not health["healthy"] and health["events_failed"] == 1 and health["consecutive_failures"] == 1
        assert "Could not write security audit event login.failed" in caplog.text
        assert "secret" not in caplog.text and "Elena" not in caplog.text and "wrong password" not in caplog.text
    finally:
        writer.dispose()


def test_authentication_answers_are_unchanged_when_the_writer_fails(pg_db, pg_conn, caplog):
    """A writer whose database is down: the sign-in still gets its normal 401, the failure is logged (action and
    reason only) and the health endpoint reports it."""
    writer = SecurityAuditWriter(DEAD_DB, timeout_seconds=1)
    try:
        app = create_app(_settings(), demo_registry(), database=pg_db, security_audit=writer)
        http = TestClient(app, base_url=BASE)
        with caplog.at_level(logging.WARNING):
            r = http.post(
                "/auth/login", json={"email": "nobody@acme.io", "password": "hunter2-guess-xyz"}, headers=ORIGIN
            )
        assert r.status_code == 401
        assert r.json() == {"error": {"code": "unauthorized", "message": "Invalid email or password"}}
        assert "Security event NOT persisted: action=login.failed reason=unknown_account" in caplog.text
        assert "hunter2" not in caplog.text and "nobody@acme.io" not in caplog.text
        health = http.get("https://testserver/healthz/security-audit")
        assert health.status_code == 503 and health.json()["status"] == "degraded"
        assert health.json()["consecutive_failures"] == 1 and "hunter2" not in health.text
    finally:
        writer.dispose()


def test_the_health_endpoint_reports_a_working_and_a_missing_writer(pg_db, migrated):
    writer = SecurityAuditWriter(TEST_DATABASE_URL)
    try:
        ok = TestClient(create_app(_settings(), demo_registry(), database=pg_db, security_audit=writer))
        r = ok.get("/healthz/security-audit")
        assert r.status_code == 200 and r.json()["status"] == "ok" and r.json()["events_failed"] == 0
    finally:
        writer.dispose()
    missing = TestClient(create_app(_settings(), demo_registry(), database=pg_db))
    r = missing.get("/healthz/security-audit")
    assert r.status_code == 503 and r.json() == {"status": "unavailable", "security_audit": "not_configured"}
