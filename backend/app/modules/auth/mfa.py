"""Multi-factor authentication: TOTP (RFC 6238) factors, single-use recovery codes and step-up verification.

Every function runs in the caller's transaction and never commits on its own.

Security properties (each covered by tests):
- **Real verification only.** A code is accepted only if it equals the TOTP of the user's decrypted secret for the
  current 30-second step or one step either side (clock drift). A six-digit string is never accepted for its format.
- **No replay.** Each factor stores the last accepted step; a code is accepted only for a *later* step, through one
  conditional ``UPDATE … RETURNING``, so the same code can't be used twice, even concurrently.
- **Encrypted at rest.** The secret is stored only as AES-256-GCM ciphertext bound to the user and key version
  (``core/security.py``). Secrets under an older key version are re-encrypted with the active one when used.
- **Recovery codes** (ten, ~79 bits each) are stored as SHA-256 digests and consumed with one conditional UPDATE.
  Generating a new set revokes every unused code of the old set. Generation (enrolment confirmation, regeneration)
  first locks the user's row (``SELECT … FOR UPDATE``), so concurrent requests for one user run one after the other
  and can never leave two active sets; the step-up check, revocation and insertion share the caller's transaction, so
  a failure leaves the previous set intact.
- **Throttled** (Stage 3B.3): every code check (sign-in, enrolment confirmation, regeneration, step-up) is first
  counted against the user's ``mfa`` (or ``recovery_code``) scope in the shared limiter, and a correct code resets
  it. A wrong or replayed code is a failed attempt. Throttling never touches the row locks or the single-use rules.
- **Enrolment can't replace a factor.** Starting or confirming enrolment is refused once a factor is confirmed, so a
  stolen password alone can't swap in an attacker's authenticator.
"""

from __future__ import annotations

import hmac
import re
import uuid
from dataclasses import dataclass
from datetime import datetime

import pyotp
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core import clock
from app.core.config import Settings
from app.core.errors import Conflict, Forbidden, Unauthorized
from app.core.security import (
    RECOVERY_CODE_COUNT,
    Keyring,
    UndecryptableSecret,
    decrypt_mfa_secret,
    encrypt_mfa_secret,
    new_recovery_code,
    normalize_recovery_code,
    token_digest,
)
from app.core.tenant_scope import tenant_scope
from app.modules.audit.repository import PostgresAuditRepository
from app.modules.audit.service import record_event
from app.modules.identity.models import MfaRecoveryCode, MfaTotpFactor, User
from app.modules.tenants.models import TenantMembership

from .throttle import AuthThrottle, user_subject

TOTP_PERIOD = 30
TOTP_DIGITS = 6
TOTP_DRIFT_STEPS = 1  # accept the previous and next step too
_CODE = re.compile(r"^\d{6}$")


class MfaRequired(Unauthorized):
    """The password was right; a second factor is needed. Only ever said to someone who knows the password."""

    code = "mfa_required"


class InvalidMfaCode(Unauthorized):
    code = "mfa_invalid"


class MfaEnrollmentRequired(Forbidden):
    code = "mfa_enrollment_required"


class StepUpFailed(Forbidden):
    code = "mfa_invalid"


class MfaNotEnabled(Conflict):
    """Same response as before (409 conflict); a distinct type so the refusal can be recorded."""


def mfa_keyring(settings: Settings) -> Keyring:
    return Keyring.from_settings(
        settings.mfa_encryption_keys, settings.mfa_encryption_key_version, "MFA encryption key"
    )


def factor_for(db: Session, user: User, *, confirmed: bool = True) -> MfaTotpFactor | None:
    factor = db.scalar(select(MfaTotpFactor).where(MfaTotpFactor.user_id == user.id))
    if factor is None or (confirmed and factor.confirmed_at is None):
        return None
    return factor


def _secret(keyring: Keyring, factor: MfaTotpFactor, user: User) -> str:
    return decrypt_mfa_secret(keyring, factor.secret_ciphertext, factor.key_version, user_id=user.id.bytes).decode()


def _step(now: datetime) -> int:
    return int(now.timestamp()) // TOTP_PERIOD


def verify_totp(db: Session, settings: Settings, user: User, factor: MfaTotpFactor, code: str) -> bool:
    """True if ``code`` is a valid, not-yet-used TOTP for ``factor``; records its step so it can't be reused."""
    if not _CODE.match(code or ""):
        return False
    keyring = mfa_keyring(settings)
    try:
        secret = _secret(keyring, factor, user)
    except UndecryptableSecret:
        return False  # e.g. its key version was removed: the factor no longer works (documented)
    totp = pyotp.TOTP(secret, digits=TOTP_DIGITS, interval=TOTP_PERIOD)
    current = _step(clock.now())
    matched = None
    for step in range(current - TOTP_DRIFT_STEPS, current + TOTP_DRIFT_STEPS + 1):
        if hmac.compare_digest(totp.generate_otp(step), code):
            matched = step
    if matched is None or (factor.last_used_step is not None and matched <= factor.last_used_step):
        return False
    accepted = db.execute(
        update(MfaTotpFactor)
        .where(
            MfaTotpFactor.id == factor.id,
            (MfaTotpFactor.last_used_step.is_(None)) | (MfaTotpFactor.last_used_step < matched),
        )
        .values(last_used_step=matched)
        .returning(MfaTotpFactor.id)
    ).first()
    if accepted is None:  # a concurrent request used this step (or a later one) first
        return False
    db.refresh(factor)
    if factor.key_version != keyring.active:  # key rotation: re-encrypt while we hold the plaintext
        factor.secret_ciphertext, factor.key_version = encrypt_mfa_secret(
            keyring, secret.encode(), user_id=user.id.bytes
        )
        db.flush()
    return True


def consume_recovery_code(db: Session, user: User, code: str) -> int | None:
    """Uses one recovery code. Returns how many unused codes remain, or None if the code isn't valid."""
    digest = token_digest(normalize_recovery_code(code or ""))
    now = clock.now()
    used = db.execute(
        update(MfaRecoveryCode)
        .where(
            MfaRecoveryCode.user_id == user.id,
            MfaRecoveryCode.code_hash == digest,
            MfaRecoveryCode.used_at.is_(None),
            MfaRecoveryCode.revoked_at.is_(None),
        )
        .values(used_at=now)
        .returning(MfaRecoveryCode.id)
    ).first()
    if used is None:
        return None
    return len(_unused_codes(db, user))


def _unused_codes(db: Session, user: User) -> list[MfaRecoveryCode]:
    return list(
        db.scalars(
            select(MfaRecoveryCode).where(
                MfaRecoveryCode.user_id == user.id,
                MfaRecoveryCode.used_at.is_(None),
                MfaRecoveryCode.revoked_at.is_(None),
            )
        )
    )


def lock_user(db: Session, user: User) -> User:
    """Serializes per-user MFA changes: a concurrent caller waits here until this transaction ends, then reads the
    committed state (READ COMMITTED re-reads after the wait)."""
    return db.execute(
        select(User).where(User.id == user.id).with_for_update().execution_options(populate_existing=True)
    ).scalar_one()


def _new_recovery_codes(db: Session, user: User) -> list[str]:
    """Revokes the unused codes and inserts a new set. Callers hold the user's row lock (``lock_user``)."""
    now = clock.now()
    db.execute(
        update(MfaRecoveryCode)
        .where(
            MfaRecoveryCode.user_id == user.id,
            MfaRecoveryCode.used_at.is_(None),
            MfaRecoveryCode.revoked_at.is_(None),
        )
        .values(revoked_at=now)
    )
    codes = [new_recovery_code() for _ in range(RECOVERY_CODE_COUNT)]
    for code in codes:
        db.add(MfaRecoveryCode(user_id=user.id, code_hash=token_digest(code), created_at=now))
    db.flush()
    return codes


def _checked_totp(
    db: Session,
    settings: Settings,
    user: User,
    factor: MfaTotpFactor,
    code: str,
    *,
    throttle: AuthThrottle,
    client: str,
    tenant_id: uuid.UUID | None = None,
) -> bool:
    """verify_totp behind the user's ``mfa`` throttle: the attempt is counted first (429 once over the limit, 503 if
    the limiter can't decide) and a correct code resets the count."""
    subject = user_subject(user)
    throttle.enforce("mfa", subject, client=client, user=user, tenant_id=tenant_id)
    if not verify_totp(db, settings, user, factor, code):
        return False
    throttle.reset("mfa", subject)
    return True


@dataclass(frozen=True)
class SecondFactor:
    method: str  # "totp" | "recovery_code"
    recovery_codes_left: int | None = None


def verify_second_factor(
    db: Session,
    settings: Settings,
    user: User,
    factor: MfaTotpFactor,
    *,
    code: str | None,
    recovery_code: str | None,
    throttle: AuthThrottle,
    client: str,
    tenant_id: uuid.UUID | None = None,
) -> SecondFactor | None:
    if code:
        ok = _checked_totp(db, settings, user, factor, code, throttle=throttle, client=client, tenant_id=tenant_id)
        return SecondFactor("totp") if ok else None
    if recovery_code:
        subject = user_subject(user)
        throttle.enforce("recovery_code", subject, client=client, user=user, tenant_id=tenant_id)
        left = consume_recovery_code(db, user, recovery_code)
        if left is None:
            return None
        throttle.reset("recovery_code", subject)
        return SecondFactor("recovery_code", left)
    return None


# ====================================================================== enrolment


@dataclass(frozen=True)
class Enrollment:
    secret: str  # base32, shown once so the user can add it to an authenticator app
    otpauth_uri: str


def start_enrollment(db: Session, settings: Settings, user: User) -> Enrollment:
    """Creates (or replaces) the user's unconfirmed factor with a fresh 160-bit secret."""
    keyring = mfa_keyring(settings)
    existing = factor_for(db, user, confirmed=False)
    if existing is not None and existing.confirmed_at is not None:
        raise Conflict("MFA is already enabled for this account")
    secret = pyotp.random_base32(32)  # 32 base32 characters = 160 bits (RFC 4226's recommended length)
    blob, version = encrypt_mfa_secret(keyring, secret.encode(), user_id=user.id.bytes)
    now = clock.now()
    if existing is None:
        db.add(MfaTotpFactor(user_id=user.id, secret_ciphertext=blob, key_version=version, created_at=now))
    else:
        existing.secret_ciphertext, existing.key_version = blob, version
        existing.created_at, existing.last_used_step = now, None
    db.flush()
    uri = pyotp.TOTP(secret, digits=TOTP_DIGITS, interval=TOTP_PERIOD).provisioning_uri(
        name=user.email, issuer_name=settings.mfa_issuer
    )
    return Enrollment(secret, uri)


def _audit_everywhere(
    db: Session, settings: Settings, user: User, action: str, summary: str, client: str, **metadata
) -> None:
    """Records a user-level event in every tenant where the user is an active member (admins see it there)."""
    tenant_ids = db.scalars(
        select(TenantMembership.tenant_id).where(
            TenantMembership.user_id == user.id, TenantMembership.membership_status == "active"
        )
    ).all()

    def record(tenant_id: uuid.UUID | None) -> None:
        record_event(
            PostgresAuditRepository(db, tenant_id),
            action,
            summary,
            actor_type="user",
            actor_id=user.public_id,
            actor_label=user.full_name,
            client=client,
            resource=("member", user.public_id),
            metadata=metadata or None,
            environment=settings.env,
        )

    if not tenant_ids:
        record(None)  # a global event: no tenant to bind
    for tenant_id in tenant_ids:
        with tenant_scope(db, tenant_id):  # each event is written as its own tenant; the caller's context comes back
            record(tenant_id)


def confirm_enrollment(
    db: Session, settings: Settings, user: User, code: str, *, throttle: AuthThrottle, client: str = ""
) -> list[str]:
    """Proves the authenticator works, enables MFA and returns ten recovery codes (shown once)."""
    user = lock_user(db, user)
    factor = factor_for(db, user, confirmed=False)
    if factor is None:
        raise Conflict("Start MFA enrolment first")
    if factor.confirmed_at is not None:
        raise Conflict("MFA is already enabled for this account")
    if not _checked_totp(db, settings, user, factor, code, throttle=throttle, client=client):
        raise InvalidMfaCode("Invalid verification code")
    now = clock.now()
    factor.confirmed_at = now
    user.mfa_enrolled_at = now
    codes = _new_recovery_codes(db, user)
    _audit_everywhere(db, settings, user, "user.mfa_enrolled", "Enabled multi-factor authentication", client)
    return codes


def regenerate_recovery_codes(
    db: Session, settings: Settings, user: User, code: str, *, throttle: AuthThrottle, client: str = ""
) -> list[str]:
    """Replaces the set after a fresh TOTP check, all under the user's row lock and in the caller's transaction."""
    user = lock_user(db, user)
    factor = factor_for(db, user)
    if factor is not None:
        db.refresh(factor)  # the state committed by whoever held the lock before us
    if factor is None:
        raise MfaNotEnabled("MFA is not enabled for this account")
    if not _checked_totp(db, settings, user, factor, code, throttle=throttle, client=client):
        raise StepUpFailed("Invalid verification code")
    codes = _new_recovery_codes(db, user)
    _audit_everywhere(db, settings, user, "user.recovery_codes_regenerated", "Generated new recovery codes", client)
    return codes


# ====================================================================== step-up


def require_step_up(
    db: Session,
    settings: Settings,
    user_public_id: str,
    code: str,
    *,
    throttle: AuthThrottle,
    client: str,
    tenant_id: uuid.UUID | None = None,
) -> None:
    """Sensitive actions (creating an API key) need a fresh TOTP code from the acting user's confirmed factor."""
    user = db.scalar(select(User).where(User.public_id == user_public_id))
    factor = factor_for(db, user) if user is not None else None
    if user is None or factor is None:
        raise MfaEnrollmentRequired("Enable multi-factor authentication to perform this action")
    if not _checked_totp(db, settings, user, factor, code, throttle=throttle, client=client, tenant_id=tenant_id):
        raise StepUpFailed("Invalid verification code")
