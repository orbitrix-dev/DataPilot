"""Identity flows: invitations, sign-in, refresh-token rotation, sign-out, and access-token validation.

Every function runs inside the caller's database transaction (the request's ``DbSession`` or a CLI unit of work) and
never commits on its own, so a flow's writes and its audit event commit or roll back together.

Security properties (each covered by tests):
- **Invitations** are single-use and expire (``invitation_ttl_hours``, 24 h by default). Only a digest is stored;
  acceptance consumes the token with one conditional UPDATE, so two concurrent acceptances can't both succeed.
- **Sign-in** gives the same answer for an unknown email, a wrong password, an account without a password and a
  disabled account, and spends the same Argon2 work in each case. Hashes are upgraded on sign-in when Argon2
  parameters change.
- **Sessions** are rows in ``user_sessions``; every access token names its session, and every request re-checks the
  session (not revoked, not expired, not idle beyond the tenant's timeout), the membership and the tenant.
- **MFA** (Stage 3B.2): a user with a confirmed TOTP factor must send a valid ``mfa_code`` (or ``recovery_code``)
  with the password; a tenant with ``require_mfa`` refuses members without a factor, and refuses (on every request)
  sessions whose sign-in didn't verify one. Rejected sign-ins are reported through ``on_failure`` so the caller can
  record them in an independent transaction (they'd otherwise roll back with the request).
- **Refresh tokens** rotate on every use. A token that was already used or revoked is replay: the whole family (the
  session and all its tokens) is revoked and a ``login.refresh_reuse_detected`` event is recorded. Rotation locks the
  token row, and at most one live token per session is allowed, so concurrent refreshes can't fork a family.
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core import clock
from app.core.config import Settings
from app.core.errors import Conflict, Forbidden, NotFound, Unauthorized, Unprocessable
from app.core.security import (
    AccessClaims,
    InvalidAccessToken,
    Keyring,
    decode_access_token,
    hash_password,
    issue_access_token,
    new_opaque_token,
    password_needs_rehash,
    token_digest,
    validate_new_password,
    verify_password,
)
from app.modules.audit.repository import PostgresAuditRepository
from app.modules.audit.service import record_event
from app.modules.identity.models import InvitationToken, RefreshToken, User, UserSession
from app.modules.identity.persistence import new_member_public_id, normalize_email, parse_ip
from app.modules.tenants.models import Role, Tenant, TenantMembership, TenantSettings

from . import mfa

INVITATION_PREFIX = "dpi_"
REFRESH_PREFIX = "dpr_"
INVALID_CREDENTIALS = "Invalid email or password"
INVALID_SESSION = "Invalid or expired session"
INVALID_INVITATION = "Invalid or expired invitation"
SESSION_TOUCH_RESOLUTION = timedelta(minutes=1)  # last_seen_at / last activity written at most once a minute


def jwt_keyring(settings: Settings) -> Keyring:
    return Keyring.from_settings(settings.jwt_signing_keys, settings.jwt_active_kid, "Access-token signing key")


def _ip_or_none(client: str):
    try:
        return parse_ip(client) if client else None
    except ValueError:
        return None


_BROWSERS = (("Edg/", "Edge"), ("Firefox/", "Firefox"), ("Chrome/", "Chrome"), ("Safari/", "Safari"))
_SYSTEMS = (
    ("Windows", "Windows"),
    ("iPhone", "iOS"),
    ("iPad", "iOS"),
    ("Android", "Android"),
    ("Mac OS X", "macOS"),
    ("Linux", "Linux"),
)


def describe_device(user_agent: str) -> str | None:
    """A short label for Admin → Sessions ("Chrome on macOS"). Best effort; never trusted for anything."""
    browser = next((name for marker, name in _BROWSERS if marker in user_agent), None)
    system = next((name for marker, name in _SYSTEMS if marker in user_agent), None)
    if browser and system:
        return f"{browser} on {system}"
    return browser or system


# ====================================================================== invitations


@dataclass(frozen=True)
class IssuedInvitation:
    token: str  # shown once to the operator; never stored
    expires_at: datetime
    member_public_id: str
    email: str
    tenant_slug: str


def issue_invitation(
    db: Session,
    settings: Settings,
    *,
    tenant_slug: str,
    email: str,
    role_key: str,
    full_name: str | None = None,
    title: str = "",
    issued_by: str = "Operator CLI",
) -> IssuedInvitation:
    """Creates (or reuses) the user and membership, revokes any outstanding invitation for that membership and
    issues a new single-use token. Refused for users who already have a password."""
    tenant = db.scalar(select(Tenant).where(Tenant.slug == tenant_slug))
    if tenant is None or tenant.status != "active":
        raise NotFound(f"No active tenant {tenant_slug!r}")
    role = db.scalar(select(Role).where(Role.tenant_id == tenant.id, Role.key == role_key))
    if role is None:
        raise NotFound(f"Role {role_key!r} not found in {tenant_slug!r}")
    email = normalize_email(email)
    user = db.scalar(select(User).where(User.email == email))
    if user is None:
        local = re.split(r"[._-]", email.split("@")[0])
        user = User(
            public_id=new_member_public_id(),
            email=email,
            full_name=(full_name or " ".join(w.capitalize() for w in local if w) or email).strip(),
        )
        db.add(user)
        db.flush()
    elif user.password_hash is not None:
        raise Conflict("This user already has a password; invitations only set a first password")
    if user.status != "active":
        raise Conflict("This user is disabled")
    membership = db.scalar(
        select(TenantMembership).where(TenantMembership.tenant_id == tenant.id, TenantMembership.user_id == user.id)
    )
    if membership is None:
        if role_key == "owner" and db.scalar(
            select(TenantMembership.id)
            .join(Role, (Role.tenant_id == TenantMembership.tenant_id) & (Role.id == TenantMembership.role_id))
            .where(TenantMembership.tenant_id == tenant.id, Role.key == "owner")
        ):
            raise Conflict("This workspace already has an Owner")
        membership = TenantMembership(
            tenant_id=tenant.id, user_id=user.id, role_id=role.id, membership_status="invited", title=title.strip()
        )
        db.add(membership)
        db.flush()
    elif membership.membership_status == "suspended":
        raise Conflict("This membership is suspended")
    now = clock.now()
    db.execute(
        update(InvitationToken)
        .where(
            InvitationToken.tenant_id == tenant.id,
            InvitationToken.user_id == user.id,
            InvitationToken.used_at.is_(None),
            InvitationToken.revoked_at.is_(None),
        )
        .values(revoked_at=now)
    )
    token, digest = new_opaque_token(INVITATION_PREFIX)
    expires = now + timedelta(hours=settings.invitation_ttl_hours)
    db.add(
        InvitationToken(
            tenant_id=tenant.id, user_id=user.id, token_hash=digest, issued_by=issued_by[:160], expires_at=expires
        )
    )
    db.flush()
    record_event(
        PostgresAuditRepository(db, tenant.id),
        "user.invitation_issued",
        f"Issued an invitation for {email} as {role.name}",
        actor_type="system",
        actor_id=None,
        actor_label=issued_by,
        resource=("member", user.public_id),
        metadata={"email": email, "role": role_key},
        environment=settings.env,
    )
    return IssuedInvitation(token, expires, user.public_id, email, tenant.slug)


def accept_invitation(db: Session, settings: Settings, *, token: str, password: str, client: str = "") -> None:
    """Sets the user's first password and activates the membership. The token is consumed atomically."""
    digest = token_digest(token)
    now = clock.now()
    found = db.execute(
        select(InvitationToken, User, Tenant, TenantMembership)
        .join(User, User.id == InvitationToken.user_id)
        .join(Tenant, Tenant.id == InvitationToken.tenant_id)
        .join(
            TenantMembership,
            (TenantMembership.tenant_id == InvitationToken.tenant_id)
            & (TenantMembership.user_id == InvitationToken.user_id),
        )
        .where(InvitationToken.token_hash == digest)
    ).first()
    if found is None:
        raise Unauthorized(INVALID_INVITATION)
    invitation, user, tenant, membership = found
    if tenant.status != "active" or user.status != "active" or membership.membership_status == "suspended":
        raise Unauthorized(INVALID_INVITATION)
    try:
        validate_new_password(password, email=user.email)  # checked before anything is consumed
    except ValueError as exc:
        raise Unprocessable(str(exc)) from None
    consumed = db.execute(
        update(InvitationToken)
        .where(
            InvitationToken.id == invitation.id,
            InvitationToken.used_at.is_(None),
            InvitationToken.revoked_at.is_(None),
            InvitationToken.expires_at > now,
        )
        .values(used_at=now)
        .returning(InvitationToken.id)
    ).first()
    if consumed is None:  # used, revoked or expired, possibly by a concurrent request a moment ago
        raise Unauthorized(INVALID_INVITATION)
    user.password_hash = hash_password(password)
    if membership.membership_status == "invited":
        membership.membership_status = "active"
        membership.joined_at = now
    db.flush()
    record_event(
        PostgresAuditRepository(db, tenant.id),
        "user.invitation_accepted",
        f"{user.email} accepted the invitation and set a password",
        actor_type="user",
        actor_id=user.public_id,
        actor_label=user.full_name,
        client=client,
        resource=("member", user.public_id),
        metadata={"email": user.email},
        environment=settings.env,
    )


# ====================================================================== sessions


@dataclass(frozen=True)
class IssuedSession:
    access_token: str
    access_expires_at: datetime
    refresh_token: str  # set as an HttpOnly cookie; never in a response body or log
    refresh_expires_at: datetime
    tenant_slug: str
    member_public_id: str


def _issue_access(settings: Settings, user: User, tenant: Tenant, session: UserSession) -> tuple[str, datetime]:
    return issue_access_token(
        jwt_keyring(settings),
        issuer=settings.jwt_issuer,
        audience=settings.jwt_audience,
        ttl=timedelta(seconds=settings.access_token_ttl_seconds),
        user_public_id=user.public_id,
        tenant_slug=tenant.slug,
        session_public_id=session.public_id,
    )


def _active_memberships(db: Session, user: User) -> list[tuple[TenantMembership, Tenant]]:
    rows = db.execute(
        select(TenantMembership, Tenant)
        .join(Tenant, Tenant.id == TenantMembership.tenant_id)
        .where(
            TenantMembership.user_id == user.id,
            TenantMembership.membership_status == "active",
            Tenant.status != "deleted",
        )
        .order_by(Tenant.slug)
    ).all()
    return [(m, t) for m, t in rows]


# Called with (action, reason, user or None, tenant id or None) just before a sign-in is refused. The attempted email
# of an unknown account is deliberately not passed: it is attacker-controlled and is sometimes a mistyped password.
FailureHook = Callable[[str, str, "User | None", "uuid.UUID | None"], None]


def _ignore_failure(action: str, reason: str, user: User | None, tenant_id: uuid.UUID | None) -> None:
    pass


def authenticate_password(db: Session, *, email: str, password: str, on_failure: FailureHook = _ignore_failure) -> User:
    """The user whose password this is, or the uniform 401. Spends one Argon2 verification in every case."""
    try:
        normalized = normalize_email(email)
    except ValueError:
        normalized = None
    user = db.scalar(select(User).where(User.email == normalized)) if normalized else None
    password_ok = verify_password(user.password_hash if user else None, password)
    if user is None or not password_ok or user.status != "active":
        if user is None:
            reason = "unknown_account"
        elif user.password_hash is None:
            reason = "no_password"
        elif not password_ok:
            reason = "wrong_password"
        else:
            reason = "account_disabled"
        on_failure("login.failed", reason, user, None)
        raise Unauthorized(INVALID_CREDENTIALS)
    return user


def login(
    db: Session,
    settings: Settings,
    *,
    email: str,
    password: str,
    tenant_slug: str | None,
    client: str,
    user_agent: str,
    mfa_code: str | None = None,
    recovery_code: str | None = None,
    on_failure: FailureHook = _ignore_failure,
) -> IssuedSession:
    jwt_keyring(settings)  # fail before any work if signing isn't configured
    user = authenticate_password(db, email=email, password=password, on_failure=on_failure)
    memberships = _active_memberships(db, user)
    if tenant_slug is not None:
        memberships = [(m, t) for m, t in memberships if t.slug == tenant_slug]
    if not memberships:
        on_failure("login.failed", "no_active_membership", user, None)
        raise Unauthorized(INVALID_CREDENTIALS)
    if len(memberships) > 1:
        raise Conflict("Choose a workspace to sign in to", tenants=[t.slug for _, t in memberships])
    membership, tenant = memberships[0]
    if tenant.status == "suspended":
        on_failure("login.blocked", "tenant_suspended", user, tenant.id)
        raise Forbidden("This workspace is suspended")
    second = None
    factor = mfa.factor_for(db, user)
    if factor is not None:
        if not mfa_code and not recovery_code:
            raise mfa.MfaRequired("Enter the code from your authenticator app")
        second = mfa.verify_second_factor(db, settings, user, factor, code=mfa_code, recovery_code=recovery_code)
        if second is None:
            on_failure("login.failed", "mfa_invalid" if mfa_code else "recovery_code_invalid", user, tenant.id)
            raise mfa.InvalidMfaCode("Invalid verification code")
    elif _tenant_requires_mfa(db, tenant.id):
        on_failure("login.blocked", "mfa_enrollment_required", user, tenant.id)
        raise mfa.MfaEnrollmentRequired("This workspace requires multi-factor authentication. Enable it, then sign in.")
    if password_needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)
    now = clock.now()
    refresh, refresh_digest = new_opaque_token(REFRESH_PREFIX)
    expires = now + timedelta(days=settings.refresh_session_ttl_days)
    session = UserSession(
        public_id=f"sess-{uuid.uuid4().hex[:12]}",
        tenant_id=tenant.id,
        user_id=user.id,
        token_hash=refresh_digest,  # digest of the family's first refresh token (rotated away immediately on use)
        created_at=now,
        last_seen_at=now,
        expires_at=expires,
        device=describe_device(user_agent),
        ip=_ip_or_none(client),
        user_agent=user_agent[:512] or None,
        mfa_verified_at=now if second is not None else None,
    )
    db.add(session)
    db.flush()
    db.add(RefreshToken(session_id=session.id, token_hash=refresh_digest, issued_at=now, expires_at=expires))
    membership.last_active_at = now
    membership.last_active_ip = _ip_or_none(client)
    db.flush()
    method = "password" if second is None else f"password+{second.method}"
    via = {"password": "a password", "password+totp": "a password and an authenticator code"}.get(
        method, "a password and a recovery code"
    )
    record_event(
        PostgresAuditRepository(db, tenant.id),
        "login.succeeded",
        f"Signed in with {via}{f' · {session.device}' if session.device else ''}",
        actor_type="user",
        actor_id=user.public_id,
        actor_label=user.full_name,
        client=client,
        metadata={"method": method},
        environment=settings.env,
    )
    if second is not None and second.method == "recovery_code":
        record_event(
            PostgresAuditRepository(db, tenant.id),
            "login.recovery_code_used",
            f"Used a recovery code to sign in ({second.recovery_codes_left} left)",
            actor_type="user",
            actor_id=user.public_id,
            actor_label=user.full_name,
            client=client,
            metadata={"remaining": second.recovery_codes_left},
            environment=settings.env,
        )
    access, access_expires = _issue_access(settings, user, tenant, session)
    return IssuedSession(access, access_expires, refresh, expires, tenant.slug, user.public_id)


def _tenant_requires_mfa(db: Session, tenant_id: uuid.UUID) -> bool:
    return bool(db.scalar(select(TenantSettings.require_mfa).where(TenantSettings.tenant_id == tenant_id)))


def _session_problem(db: Session, session: UserSession, now: datetime) -> str | None:
    """Why ``session`` can't be used (None if it can): revoked, expired, idle too long, signed in without MFA in a
    tenant that requires it, or its membership, user or tenant is no longer active."""
    if session.revoked_at is not None:
        return "revoked"
    if session.expires_at <= now:
        return "expired"
    policy = db.execute(
        select(TenantSettings.session_timeout_hours, TenantSettings.require_mfa).where(
            TenantSettings.tenant_id == session.tenant_id
        )
    ).first()
    if policy is not None and session.last_seen_at + timedelta(hours=policy.session_timeout_hours) <= now:
        return "idle timeout"
    if policy is not None and policy.require_mfa and session.mfa_verified_at is None:
        return "mfa required"
    row = db.execute(
        select(TenantMembership.membership_status, User.status, Tenant.status)
        .join(User, User.id == TenantMembership.user_id)
        .join(Tenant, Tenant.id == TenantMembership.tenant_id)
        .where(TenantMembership.tenant_id == session.tenant_id, TenantMembership.user_id == session.user_id)
    ).first()
    if row is None or row[0] != "active" or row[1] != "active" or row[2] == "deleted":
        return "membership"
    return None


def _revoke_family(db: Session, session: UserSession, reason: str, now: datetime) -> None:
    if session.revoked_at is None:
        session.revoked_at, session.revoked_reason = now, reason
    db.execute(
        update(RefreshToken)
        .where(RefreshToken.session_id == session.id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=now)
    )
    db.flush()


@dataclass(frozen=True)
class ReplayDetected:
    """Returned (not raised) so the caller commits the family revocation and its audit event, then answers 401."""

    session_public_id: str


def refresh(db: Session, settings: Settings, *, refresh_token: str, client: str) -> IssuedSession | ReplayDetected:
    jwt_keyring(settings)
    now = clock.now()
    found = db.execute(
        select(RefreshToken, UserSession)
        .join(UserSession, UserSession.id == RefreshToken.session_id)
        .where(RefreshToken.token_hash == token_digest(refresh_token))
        .with_for_update(of=RefreshToken)
    ).first()
    if found is None:
        raise Unauthorized(INVALID_SESSION)
    token, session = found
    if token.used_at is not None or token.revoked_at is not None:
        _revoke_family(db, session, "refresh_token_reuse", now)
        user = db.get(User, session.user_id)
        record_event(
            PostgresAuditRepository(db, session.tenant_id),
            "login.refresh_reuse_detected",
            "A refresh token was reused; the session and all its tokens were revoked",
            actor_type="user",
            actor_id=user.public_id if user else None,
            actor_label=user.full_name if user else "Unknown",
            client=client,
            resource=("session", session.public_id),
            metadata={"session_id": session.public_id},
            environment=settings.env,
        )
        return ReplayDetected(session.public_id)
    if token.expires_at <= now or _session_problem(db, session, now) is not None:
        raise Unauthorized(INVALID_SESSION)
    tenant = db.get(Tenant, session.tenant_id)
    if tenant.status == "suspended":
        raise Forbidden("This workspace is suspended")
    user = db.get(User, session.user_id)
    token.used_at = now
    db.flush()  # the live-token partial unique index now admits exactly one child
    new_refresh, new_digest = new_opaque_token(REFRESH_PREFIX)
    db.add(
        RefreshToken(
            session_id=session.id,
            token_hash=new_digest,
            parent_id=token.id,
            issued_at=now,
            expires_at=session.expires_at,
        )
    )
    session.last_seen_at = now
    db.flush()
    access, access_expires = _issue_access(settings, user, tenant, session)
    return IssuedSession(access, access_expires, new_refresh, session.expires_at, tenant.slug, user.public_id)


def logout(db: Session, settings: Settings, *, session: UserSession, client: str) -> None:
    now = clock.now()
    already = session.revoked_at is not None
    _revoke_family(db, session, "logout", now)
    if already:
        return
    user = db.get(User, session.user_id)
    record_event(
        PostgresAuditRepository(db, session.tenant_id),
        "login.logout",
        "Signed out",
        actor_type="user",
        actor_id=user.public_id,
        actor_label=user.full_name,
        client=client,
        resource=("session", session.public_id),
        metadata={"session_id": session.public_id},
        environment=settings.env,
    )


def session_for_refresh_token(db: Session, refresh_token: str) -> UserSession | None:
    return db.scalar(
        select(UserSession)
        .join(RefreshToken, RefreshToken.session_id == UserSession.id)
        .where(RefreshToken.token_hash == token_digest(refresh_token))
    )


# ====================================================================== access tokens on each request


@dataclass(frozen=True)
class AuthenticatedSession:
    session: UserSession
    user: User
    tenant: Tenant
    role_key: str


def authenticate_access_token(db: Session, settings: Settings, token: str, *, client: str) -> AuthenticatedSession:
    """Validates the JWT, then the session it names, in the database. Any failure is the same 401 to the client."""
    try:
        claims: AccessClaims = decode_access_token(
            jwt_keyring(settings), token, issuer=settings.jwt_issuer, audience=settings.jwt_audience
        )
    except InvalidAccessToken:
        raise Unauthorized(INVALID_SESSION) from None
    row = db.execute(
        select(UserSession, User, Tenant)
        .join(User, User.id == UserSession.user_id)
        .join(Tenant, Tenant.id == UserSession.tenant_id)
        .where(UserSession.public_id == claims.session_public_id)
    ).first()
    if row is None:
        raise Unauthorized(INVALID_SESSION)
    session, user, tenant = row
    if user.public_id != claims.user_public_id or tenant.slug != claims.tenant_slug:
        raise Unauthorized(INVALID_SESSION)
    now = clock.now()
    if _session_problem(db, session, now) is not None:
        raise Unauthorized(INVALID_SESSION)
    if tenant.status == "suspended":
        raise Forbidden("This workspace is suspended")
    role_key = db.scalar(
        select(Role.key)
        .join(TenantMembership, (TenantMembership.tenant_id == Role.tenant_id) & (TenantMembership.role_id == Role.id))
        .where(TenantMembership.tenant_id == tenant.id, TenantMembership.user_id == user.id)
    )
    if now - session.last_seen_at >= SESSION_TOUCH_RESOLUTION:
        session.last_seen_at = now
        db.execute(
            update(TenantMembership)
            .where(TenantMembership.tenant_id == tenant.id, TenantMembership.user_id == user.id)
            .values(last_active_at=now, last_active_ip=_ip_or_none(client))
        )
    return AuthenticatedSession(session, user, tenant, role_key)
