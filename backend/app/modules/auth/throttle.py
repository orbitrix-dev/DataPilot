"""Shared, persistent abuse protection for authentication (Stage 3B.3).

**Authoritative state is PostgreSQL** (``auth_throttle_buckets``): every application instance reads and writes the
same counters, and they survive restarts. Nothing in process memory decides whether a request is allowed; the only
process-local state is a short failure cooldown (below), which can only *refuse* requests, never allow them.

**Algorithm: fixed windows, counted before the credential is checked.** Each attempt is one atomic
``INSERT … ON CONFLICT (scope, subject_hash) DO UPDATE … RETURNING`` in its own short transaction on the limiter's
own connection pool. The upsert takes the row lock, so concurrent attempts are serialized by PostgreSQL and each sees
the count including every earlier attempt: no race can admit more than ``limit`` attempts per window. Counting
*before* verification also caps the expensive work (Argon2 at 64 MiB per password check) an attacker can trigger.
The counts commit independently of the request, so a 401 (whose request transaction rolls back) still counts.

Scopes (limits from settings; ``docs/SECURITY.md``):

=================  ==================  =========================================================================
scope              subject             policy
=================  ==================  =========================================================================
``login_ip``       client address      fixed window: N attempts (any outcome) per window, then 429 until it ends
``login_account``  normalized email    progressive: N attempts, reset by a correct password; then blocks
``mfa``            user                progressive: N codes, reset by a correct code (sign-in and step-up)
``recovery_code``  user                progressive: N codes, reset by a correct code
``api_key_ip``     client address      fixed window: N *invalid* keys per window (valid keys are never counted)
=================  ==================  =========================================================================

Progressive blocks last ``base × 2^(level-1)`` seconds, capped at ``max``; the level is forgotten after
``block_memory`` without a block. Accounts are never locked permanently: the worst case an attacker can impose on a
victim is a rolling block of at most ``max`` seconds, and only while they keep spending attempts (each also counted
against their own address). Unknown and existing accounts are counted identically, so throttling reveals nothing.

IPv6 addresses are keyed by their /64 (one subscriber's allocation), so rotating within it doesn't help.

**Identifiers are never stored in clear.** ``subject_hash = HMAC-SHA256(key[version], "datapilot/throttle/v1" ‖
scope ‖ identifier)``, under ``DP_THROTTLE_KEYS`` (separate from every other secret). During key rotation the row
under another listed version is re-keyed to the active version on first use, so rotation doesn't reset anyone's
counters. While more than one version is listed, every operation on a subject first takes a transaction-scoped
advisory lock derived from the subject's HMAC under the lowest-named version (known to every instance that lists the
same versions). That serializes re-keying with consumption across instances, including instances whose *active*
versions differ during a rolling switch, so a counter can never split into two rows. With one version (normal
operation) no extra lock is taken.

**Failure policy: fail closed, bounded.** If the limiter's database is unreachable or slow (2 s connect and statement
timeouts, a 3-connection pool with a 1 s wait), ``enforce`` raises ``ThrottleUnavailable`` (503): sign-in, enrolment
and MFA verification are refused rather than run unthrottled, and an *invalid* API key is answered 503 rather than
401 (it could not be counted, so it is neither counted nor recorded). Valid API keys never consult the limiter and
keep working. For ``failure_cooldown`` seconds after a failure every call is refused immediately without touching the
database, so an outage doesn't turn an endpoint into a stream of connection attempts.

**Audit, bounded.** One ``login.throttled`` / ``api-key.throttled`` security event when a subject *becomes* blocked
(the first refusal of a window or block), never one per refused request.
"""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import logging
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import TYPE_CHECKING

from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import ServiceUnavailable, TooManyRequests
from app.core.security import Keyring
from app.db.base import uuid7

from .models import THROTTLE_SCOPES

if TYPE_CHECKING:
    from app.modules.identity.models import User

    from .security_events import SecurityAudit

log = logging.getLogger(__name__)

_DOMAIN = b"datapilot/throttle/v1"


class ThrottleUnavailable(ServiceUnavailable):
    """The limiter can't reach its database. Callers must refuse the attempt (fail closed)."""


@dataclass(frozen=True)
class Policy:
    limit: int
    progressive: bool


@dataclass(frozen=True)
class Decision:
    allowed: bool
    retry_after: int = 0  # seconds, when refused
    newly_blocked: bool = False  # this attempt is the one that started the refusal (audit once)
    attempts: int = 0  # the window's count after this attempt (diagnostics and tests; never returned to clients)


def policies(settings: Settings) -> dict[str, Policy]:
    return {
        "login_ip": Policy(settings.throttle_login_ip_limit, progressive=False),
        "login_account": Policy(settings.throttle_login_account_limit, progressive=True),
        "mfa": Policy(settings.throttle_mfa_limit, progressive=True),
        "recovery_code": Policy(settings.throttle_recovery_code_limit, progressive=True),
        "api_key_ip": Policy(settings.throttle_api_key_ip_limit, progressive=False),
    }


def address_subject(client: str) -> str:
    """The throttling subject for a client address: IPv4 as is, IPv6 by its /64; non-IP labels as given."""
    try:
        ip = ipaddress.ip_address(client)
    except ValueError:
        return f"label:{client}"
    if isinstance(ip, ipaddress.IPv6Address):
        if ip.ipv4_mapped is not None:  # ::ffff:a.b.c.d is the IPv4 client a.b.c.d
            return f"ip:{ip.ipv4_mapped}"
        return f"ip6:{ipaddress.IPv6Network((ip, 64), strict=False).network_address}/64"
    return f"ip:{ip}"


def account_subject(email: str) -> str:
    """Normalized exactly like sign-in does, so case and surrounding spaces can't create new counters. A value that
    isn't a valid email is still counted (lower-cased and stripped)."""
    from app.modules.identity.persistence import normalize_email

    try:
        return f"email:{normalize_email(email)}"
    except ValueError:
        return f"raw:{email.strip().lower()}"


def user_subject(user: User) -> str:
    return f"user:{user.id}"


_CONSUME = text(
    """
    INSERT INTO auth_throttle_buckets AS b
        (id, scope, subject_hash, key_version, window_start, attempt_count, block_level, blocked_until,
         created_at, updated_at)
    VALUES (:id, :scope, :subject, :version, :now, 1, 0, NULL, :now, :now)
    ON CONFLICT (scope, subject_hash) DO UPDATE SET
        attempt_count = CASE
            WHEN b.blocked_until > :now THEN b.attempt_count
            WHEN b.window_start <= :now - make_interval(secs => CAST(:window AS double precision)) THEN 1
            ELSE LEAST(b.attempt_count + 1, 1000000)
        END,
        window_start = CASE
            WHEN b.blocked_until > :now THEN b.window_start
            WHEN b.window_start <= :now - make_interval(secs => CAST(:window AS double precision)) THEN :now
            ELSE b.window_start
        END,
        block_level = CASE
            WHEN b.blocked_until IS NOT NULL
             AND b.blocked_until <= :now - make_interval(hours => CAST(:memory AS integer)) THEN 0
            ELSE b.block_level
        END,
        updated_at = GREATEST(b.updated_at, :now)
    RETURNING attempt_count, window_start, block_level, blocked_until
    """
)

_BLOCK = text(
    """
    UPDATE auth_throttle_buckets
       SET blocked_until = :until, block_level = :level, attempt_count = 0, window_start = :now,
           updated_at = GREATEST(updated_at, :now)
     WHERE scope = :scope AND subject_hash = :subject
    """
)

_RESET = text(
    """
    UPDATE auth_throttle_buckets
       SET attempt_count = 0, block_level = 0, blocked_until = NULL, window_start = :now,
           updated_at = GREATEST(updated_at, :now)
     WHERE scope = :scope AND subject_hash = :subject
    """
)

_REKEY = text(
    """
    UPDATE auth_throttle_buckets
       SET subject_hash = :subject, key_version = :version
     WHERE scope = :scope AND subject_hash = ANY(:old)
       AND NOT EXISTS (SELECT 1 FROM auth_throttle_buckets WHERE scope = :scope AND subject_hash = :subject)
    """
)


class AuthThrottle:
    def __init__(
        self,
        url: str,
        keyring: Keyring,
        settings: Settings,
        *,
        security_audit: SecurityAudit | None = None,
        pool_size: int = 3,
        timeout_seconds: float = 2,
    ) -> None:
        self.keyring = keyring
        self.policies = policies(settings)
        self.window = settings.throttle_window_seconds
        self.block_base = settings.throttle_block_base_seconds
        self.block_max = settings.throttle_block_max_seconds
        self.block_memory_hours = settings.throttle_block_memory_hours
        self.cooldown = settings.throttle_failure_cooldown_seconds
        self.security_audit = security_audit
        self._engine = create_engine(
            url,
            pool_size=pool_size,
            max_overflow=0,
            pool_timeout=1,
            pool_pre_ping=True,
            hide_parameters=True,  # bound values (HMAC subjects) never reach exception messages or logs
            connect_args={
                "application_name": "datapilot-auth-throttle",
                "connect_timeout": max(1, int(timeout_seconds)),
                "options": f"-c statement_timeout={int(timeout_seconds * 1000)} -c TimeZone=UTC",
            },
        )
        self._lock = threading.Lock()
        self._down_until = 0.0  # monotonic; only ever causes refusals

    @classmethod
    def from_settings(cls, settings: Settings, *, security_audit: SecurityAudit | None = None) -> AuthThrottle | None:
        """None when the database or the throttle key isn't configured (production refuses to start then)."""
        if settings.database_url is None or settings.throttle_keys is None or settings.throttle_key_version is None:
            return None
        keyring = Keyring.from_settings(settings.throttle_keys, settings.throttle_key_version, "Throttle key")
        return cls(settings.database_url.get_secret_value(), keyring, settings, security_audit=security_audit)

    # ------------------------------------------------------------------ identifiers

    def _digest(self, version: str, scope: str, identifier: str) -> bytes:
        message = _DOMAIN + b"\x00" + scope.encode() + b"\x00" + identifier.encode()
        return hmac.new(self.keyring.keys[version], message, hashlib.sha256).digest()

    def subject_hash(self, scope: str, identifier: str) -> bytes:
        return self._digest(self.keyring.active, scope, identifier)

    # ------------------------------------------------------------------ database access, failing closed

    def _run(self, work):
        with self._lock:
            if time.monotonic() < self._down_until:
                raise ThrottleUnavailable("Authentication is temporarily unavailable")
        try:
            with Session(self._engine) as session, session.begin():
                return work(session)
        except ThrottleUnavailable:
            raise
        except Exception as exc:  # noqa: BLE001 - any database failure: refuse, never allow
            with self._lock:
                first = time.monotonic() >= self._down_until
                self._down_until = time.monotonic() + self.cooldown
            if first:  # one log line per outage episode, not per request
                log.error("Auth throttle unavailable (%s); refusing attempts", type(exc).__name__)
            raise ThrottleUnavailable("Authentication is temporarily unavailable") from None

    def _serialize_during_rotation(self, session: Session, scope: str, identifier: str) -> None:
        """While several key versions are listed, one advisory lock per subject (same id on every instance that lists
        the same versions, whichever is active) makes re-key + upsert atomic across instances."""
        if len(self.keyring.keys) < 2:
            return
        anchor = self._digest(min(self.keyring.keys), scope, identifier)
        session.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": int.from_bytes(anchor[:8], "big", signed=True)})

    def _rekey(self, session: Session, scope: str, identifier: str, subject: bytes) -> None:
        old = [self._digest(v, scope, identifier) for v in self.keyring.keys if v != self.keyring.active]
        if not old:
            return
        try:
            with session.begin_nested():
                session.execute(
                    _REKEY, {"subject": subject, "version": self.keyring.active, "scope": scope, "old": old}
                )
        except IntegrityError:  # a concurrent request re-keyed or created the active row first: use that one
            pass

    # ------------------------------------------------------------------ the operations

    def consume(self, scope: str, identifier: str, *, at: datetime | None = None) -> Decision:
        """Counts one attempt and decides. ``at`` overrides the database clock (tests of window boundaries)."""
        policy = self.policies[scope]
        subject = self.subject_hash(scope, identifier)

        def work(session: Session) -> Decision:
            self._serialize_during_rotation(session, scope, identifier)
            now = at or session.execute(text("SELECT statement_timestamp()")).scalar_one()
            self._rekey(session, scope, identifier, subject)
            row = session.execute(
                _CONSUME,
                {
                    "id": uuid7(),
                    "scope": scope,
                    "subject": subject,
                    "version": self.keyring.active,
                    "now": now,
                    "window": self.window,
                    "memory": self.block_memory_hours,
                },
            ).one()
            count = row.attempt_count
            if row.blocked_until is not None and row.blocked_until > now:
                return Decision(False, _seconds(row.blocked_until - now), attempts=count)
            if count <= policy.limit:
                return Decision(True, attempts=count)
            if not policy.progressive:
                window_end = row.window_start + timedelta(seconds=self.window)
                return Decision(
                    False, _seconds(window_end - now), newly_blocked=count == policy.limit + 1, attempts=count
                )
            level = min(row.block_level + 1, 30)
            duration = min(self.block_max, self.block_base * 2 ** (level - 1))
            session.execute(
                _BLOCK,
                {
                    "until": now + timedelta(seconds=duration),
                    "level": level,
                    "now": now,
                    "scope": scope,
                    "subject": subject,
                },
            )
            return Decision(False, duration, newly_blocked=True, attempts=count)

        return self._run(work)

    def reset(self, scope: str, identifier: str, *, at: datetime | None = None) -> None:
        """After a successful verification: the subject starts afresh (progressive scopes)."""
        subject = self.subject_hash(scope, identifier)

        def work(session: Session) -> None:
            self._serialize_during_rotation(session, scope, identifier)
            now = at or session.execute(text("SELECT statement_timestamp()")).scalar_one()
            self._rekey(session, scope, identifier, subject)
            session.execute(_RESET, {"now": now, "scope": scope, "subject": subject})

        self._run(work)

    def enforce(
        self,
        scope: str,
        identifier: str,
        *,
        client: str,
        user: User | None = None,
        tenant_id: uuid.UUID | None = None,
    ) -> None:
        """Counts the attempt; raises ``TooManyRequests`` (429) when refused, ``ThrottleUnavailable`` (503) when the
        limiter can't decide. Records one security event when the subject becomes blocked."""
        decision = self.consume(scope, identifier)
        if decision.allowed:
            return
        if decision.newly_blocked and self.security_audit is not None:
            from .security_events import record_throttle

            record_throttle(
                self.security_audit,
                scope,
                decision.retry_after,
                client=client,
                user=user,
                tenant_id=tenant_id,
            )
        raise TooManyRequests(decision.retry_after)

    # ------------------------------------------------------------------ readiness

    def problems(self, session: Session) -> list[str]:
        """Why this limiter can't protect production (empty when it can). Checked at startup as the runtime user."""
        problems = []
        if set(self.policies) != set(THROTTLE_SCOPES):
            problems.append("Abuse protection does not cover every scope")
        if self.keyring.active not in self.keyring.keys:
            problems.append("Abuse protection: the active throttle key version is not in the keyring")
        exists = session.execute(text("SELECT to_regclass('public.auth_throttle_buckets') IS NOT NULL")).scalar_one()
        if not exists:
            return [*problems, "Abuse protection: table auth_throttle_buckets is missing (run alembic upgrade head)"]
        for privilege in ("SELECT", "INSERT", "UPDATE"):
            granted = session.execute(
                text("SELECT has_table_privilege(current_user, 'public.auth_throttle_buckets', :p)"), {"p": privilege}
            ).scalar_one()
            if not granted:
                problems.append(f"Abuse protection: the runtime user lacks {privilege} on auth_throttle_buckets")
        return problems

    def dispose(self) -> None:
        self._engine.dispose()


def _seconds(delta: timedelta) -> int:
    return max(1, int(delta.total_seconds() + 0.999))
