"""Browser authentication endpoints: accept an invitation, sign in, rotate the session, sign out.

Tokens:
- The **access token** (15-minute JWT) is returned in the JSON body; the browser keeps it in memory and sends it as
  ``Authorization: Bearer``. It is never put in a cookie, so it isn't sent ambiently.
- The **refresh token** lives only in the ``__Host-dp_refresh`` cookie: HttpOnly, Secure, SameSite=Strict, Path=/,
  no Domain (the ``__Host-`` prefix makes browsers enforce the last three). It is never in a response body or log.

CSRF: endpoints authenticated by that cookie (refresh, cookie sign-out) require the ``X-CSRF-Token`` header to equal
the ``__Host-dp_csrf`` cookie (double submit) AND an ``Origin`` header listed in ``DP_CORS_ORIGINS``. Sign-in also
requires an allowed Origin (login CSRF). Non-browser clients use API keys, not these endpoints.
"""

import secrets
from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, Header, Request, Response, status

from app.core import client_address
from app.core.config import Settings, get_settings
from app.core.db import DbSession
from app.core.errors import Forbidden, Unauthorized
from app.core.security import constant_time_equal

from . import service
from .schemas import AcceptInvitationIn, AccessTokenOut, LoginIn

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
    issued = service.login(
        db,
        settings,
        email=body.email,
        password=body.password,
        tenant_slug=body.tenant,
        client=_client(request, settings),
        user_agent=request.headers.get("user-agent", ""),
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
