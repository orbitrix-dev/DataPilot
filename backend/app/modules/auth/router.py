"""Browser authentication endpoints: accept an invitation, sign in, rotate the session, sign out.

Tokens:
- The **access token** (15-minute JWT) is returned in the JSON body; the browser keeps it in memory and sends it as
  ``Authorization: Bearer``. It is never put in a cookie, so it isn't sent ambiently.
- The **refresh token** lives only in the ``__Host-dp_refresh`` cookie: HttpOnly, Secure, SameSite=Strict, Path=/,
  no Domain (the ``__Host-`` prefix makes browsers enforce the last three). It is never in a response body or log.

CSRF: endpoints authenticated by that cookie (refresh, cookie sign-out) require the ``X-CSRF-Token`` header to equal
the ``__Host-dp_csrf`` cookie (double submit) AND an ``Origin`` header listed in ``DP_CORS_ORIGINS``. Sign-in also
requires an allowed Origin (login CSRF). Non-browser clients use API keys, not these endpoints.

MFA (Stage 3B.2): accounts with a confirmed authenticator send ``mfa_code`` (or ``recovery_code``) with the password;
without one the answer is ``401 mfa_required``. Enrolment re-authenticates with the password and is refused once a
factor is confirmed. Rejected sign-ins are recorded by ``SecurityAuditWriter`` (see ``security_events.py``).

Abuse protection (Stage 3B.3): every password and code check is counted in the shared limiter (``throttle.py``)
before it runs: 429 with Retry-After when over a limit, 503 if the limiter is unavailable or not configured.
"""

import secrets
from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, Header, Request, Response, status

from app.core import client_address
from app.core.config import Settings, get_settings
from app.core.db import DbSession
from app.core.errors import Forbidden, Unauthorized
from app.core.security import constant_time_equal

from . import mfa, service
from .schemas import (
    AcceptInvitationIn,
    AccessTokenOut,
    CodeIn,
    ConfirmEnrollmentIn,
    EnrollmentOut,
    LoginIn,
    PasswordReauthIn,
    RecoveryCodesOut,
)
from .security_events import login_failure_hook, record_rejection, throttle_for, writer_for

REFRESH_COOKIE = "__Host-dp_refresh"
CSRF_COOKIE = "__Host-dp_csrf"
CSRF_HEADER = "X-CSRF-Token"

router = APIRouter(prefix="/auth", tags=["auth"])
SettingsDep = Annotated[Settings, Depends(get_settings)]


def _client(request: Request, settings: Settings) -> str:
    return client_address.resolve(
        request.client.host if request.client else None,
        request.headers.getlist("x-forwarded-for"),
        settings.trusted_proxy_networks,
    )


def _require_allowed_origin(origin: str | None, settings: Settings) -> None:
    if not origin or origin not in settings.cors_origins:
        raise Forbidden("Request origin not allowed")


def _require_csrf(request: Request, settings: Settings) -> None:
    _require_allowed_origin(request.headers.get("origin"), settings)
    cookie, header = request.cookies.get(CSRF_COOKIE), request.headers.get(CSRF_HEADER)
    if not cookie or not header or not constant_time_equal(cookie, header):
        raise Forbidden("Missing or invalid CSRF token")


def _set_session_cookies(response: Response, issued: service.IssuedSession, settings: Settings) -> None:
    max_age = settings.refresh_session_ttl_days * 86400
    common = {"secure": True, "samesite": "strict", "path": "/", "max_age": max_age}
    response.set_cookie(REFRESH_COOKIE, issued.refresh_token, httponly=True, **common)
    response.set_cookie(CSRF_COOKIE, secrets.token_urlsafe(32), httponly=False, **common)


def _clear_session_cookies(response: Response) -> None:
    for name in (REFRESH_COOKIE, CSRF_COOKIE):
        response.delete_cookie(name, path="/", secure=True, httponly=name == REFRESH_COOKIE, samesite="strict")


def _token_out(issued: service.IssuedSession, settings: Settings) -> AccessTokenOut:
    return AccessTokenOut(
        access_token=issued.access_token,
        expires_in=settings.access_token_ttl_seconds,
        expires_at=issued.access_expires_at,
        tenant_id=issued.tenant_slug,
        member_id=issued.member_public_id,
    )


@router.post("/invitations/accept", status_code=status.HTTP_204_NO_CONTENT)
def accept_invitation(body: AcceptInvitationIn, request: Request, db: DbSession, settings: SettingsDep) -> None:
    """Sets the first password for an invited (or password-less) member. Single-use token, consumed atomically."""
    service.accept_invitation(db, settings, token=body.token, password=body.password, client=_client(request, settings))


@router.post("/login")
def login(body: LoginIn, request: Request, response: Response, db: DbSession, settings: SettingsDep) -> AccessTokenOut:
    _require_allowed_origin(request.headers.get("origin"), settings)
    client = _client(request, settings)
    issued = service.login(
        db,
        settings,
        email=body.email,
        password=body.password,
        tenant_slug=body.tenant,
        client=client,
        user_agent=request.headers.get("user-agent", ""),
        mfa_code=body.mfa_code,
        recovery_code=body.recovery_code,
        throttle=throttle_for(request),
        on_failure=login_failure_hook(request, client),
    )
    _set_session_cookies(response, issued, settings)
    return _token_out(issued, settings)


@router.post("/refresh", responses={401: {"description": "Invalid, expired or replayed session"}})
def refresh(
    request: Request,
    response: Response,
    db: DbSession,
    settings: SettingsDep,
    refresh_cookie: Annotated[str | None, Cookie(alias=REFRESH_COOKIE)] = None,
):
    """Rotates the refresh token (cookie) and returns a new access token. Reusing an old refresh token revokes the
    whole session: the revocation is committed even though the answer is 401."""
    _require_csrf(request, settings)
    if not refresh_cookie:
        raise Unauthorized(service.INVALID_SESSION)
    outcome = service.refresh(db, settings, refresh_token=refresh_cookie, client=_client(request, settings))
    if isinstance(outcome, service.ReplayDetected):
        # Returned rather than raised, so the request's transaction commits the revocation and its audit event.
        response.status_code = status.HTTP_401_UNAUTHORIZED
        _clear_session_cookies(response)
        return {"error": {"code": "unauthorized", "message": service.INVALID_SESSION}}
    _set_session_cookies(response, outcome, settings)
    return _token_out(outcome, settings)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    request: Request,
    response: Response,
    db: DbSession,
    settings: SettingsDep,
    authorization: Annotated[str | None, Header()] = None,
    refresh_cookie: Annotated[str | None, Cookie(alias=REFRESH_COOKIE)] = None,
) -> None:
    """Ends the session named by the access token, or (with CSRF protection) by the refresh cookie."""
    client = _client(request, settings)
    if authorization and authorization.startswith("Bearer ") and not authorization.startswith("Bearer dp_live_"):
        authenticated = service.authenticate_access_token(
            db, settings, authorization.removeprefix("Bearer "), client=client
        )
        session = authenticated.session
    else:
        _require_csrf(request, settings)
        session = service.session_for_refresh_token(db, refresh_cookie) if refresh_cookie else None
        if session is None:
            raise Unauthorized(service.INVALID_SESSION)
    service.logout(db, settings, session=session, client=client)
    _clear_session_cookies(response)


# ====================================================================== MFA enrolment and recovery codes


@router.post("/mfa/enrollment")
def start_mfa_enrollment(
    body: PasswordReauthIn, request: Request, db: DbSession, settings: SettingsDep
) -> EnrollmentOut:
    """Starts (or restarts) enrolment: a new TOTP secret to add to an authenticator app. Refused once MFA is on."""
    _require_allowed_origin(request.headers.get("origin"), settings)
    client = _client(request, settings)
    user = service.authenticate_password(
        db,
        email=body.email,
        password=body.password,
        throttle=throttle_for(request),
        client=client,
        on_failure=login_failure_hook(request, client),
    )
    enrollment = mfa.start_enrollment(db, settings, user)
    return EnrollmentOut(secret=enrollment.secret, otpauth_uri=enrollment.otpauth_uri)


@router.post("/mfa/enrollment/confirm")
def confirm_mfa_enrollment(
    body: ConfirmEnrollmentIn, request: Request, db: DbSession, settings: SettingsDep
) -> RecoveryCodesOut:
    """Turns MFA on with a code from the new authenticator; returns ten single-use recovery codes, shown once."""
    _require_allowed_origin(request.headers.get("origin"), settings)
    client = _client(request, settings)
    throttle = throttle_for(request)
    user = service.authenticate_password(
        db,
        email=body.email,
        password=body.password,
        throttle=throttle,
        client=client,
        on_failure=login_failure_hook(request, client),
    )
    codes = mfa.confirm_enrollment(db, settings, user, body.code, throttle=throttle, client=client)
    return RecoveryCodesOut(recovery_codes=codes)


@router.post("/mfa/recovery-codes")
def regenerate_recovery_codes(
    body: CodeIn,
    request: Request,
    db: DbSession,
    settings: SettingsDep,
    authorization: Annotated[str | None, Header()] = None,
) -> RecoveryCodesOut:
    """Replaces the recovery codes (the unused old ones stop working). Needs the access token and a fresh TOTP code."""
    if not authorization or not authorization.startswith("Bearer ") or authorization.startswith("Bearer dp_live_"):
        raise Unauthorized(service.INVALID_SESSION)
    client = _client(request, settings)
    authenticated = service.authenticate_access_token(
        db, settings, authorization.removeprefix("Bearer "), client=client
    )
    try:
        codes = mfa.regenerate_recovery_codes(
            db, settings, authenticated.user, body.code, throttle=throttle_for(request), client=client
        )
    except (mfa.StepUpFailed, mfa.MfaNotEnabled) as exc:
        # The request rolls back (the previous set stays valid); the refusal is recorded independently.
        record_rejection(
            writer_for(request),
            "user.recovery_codes_step_up_failed",
            "recovery_code_regeneration_step_up_failed"
            if isinstance(exc, mfa.StepUpFailed)
            else "recovery_code_regeneration_not_enrolled",
            client=client,
            user=authenticated.user,
            tenant_id=authenticated.tenant.id,
        )
        raise
    return RecoveryCodesOut(recovery_codes=codes)
