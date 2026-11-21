"""Credential primitives: password hashing, opaque tokens, API-key digests and access tokens (JWT).

Nothing here stores or logs a secret. Storage only ever receives:
- an **Argon2id** PHC string for passwords (salted, memory-hard; parameters from argon2-cffi's RFC 9106 profile);
- a **SHA-256 digest** for opaque tokens (refresh and invitation tokens are 256-bit random values, so a fast digest
  is the standard choice: there is nothing to brute-force);
- an **HMAC-SHA256 digest under a versioned server-side pepper** for API keys, so a stolen database dump alone can't
  be used to check guesses, and the pepper can be rotated (``pepper_version`` is stored with each digest).

Access tokens are short-lived HS256 JWTs signed with a versioned key (``kid`` header). Validation checks signature,
algorithm, ``kid``, issuer, audience, expiry and required claims; the session id inside lets every request check
revocation in the database.
"""

import functools
import hashlib
import hmac
import re
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from pydantic import SecretStr

from app.core import clock
from app.core.errors import ServiceUnavailable

KID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,32}$")
MIN_SECRET_LENGTH = 32
PASSWORD_MIN, PASSWORD_MAX = 12, 256

# ====================================================================== keyrings


def parse_keyring(value: SecretStr | str | None) -> dict[str, bytes]:
    """``"v2=<secret>,v1=<secret>"`` → {version: secret}. Raises ValueError on malformed entries or short secrets
    (the message never includes a secret)."""
    raw = value.get_secret_value() if isinstance(value, SecretStr) else (value or "")
    keys: dict[str, bytes] = {}
    for entry in (e.strip() for e in raw.split(",")):
        if not entry:
            continue
        version, sep, secret = entry.partition("=")
        if not sep or not KID_PATTERN.match(version):
            raise ValueError("Keyring entries must look like <version>=<secret>, version [A-Za-z0-9_-]{1,32}")
        if len(secret) < MIN_SECRET_LENGTH:
            raise ValueError(f"Keyring secret for version {version!r} must be at least {MIN_SECRET_LENGTH} characters")
        if version in keys:
            raise ValueError(f"Keyring version {version!r} appears twice")
        keys[version] = secret.encode()
    return keys


@dataclass(frozen=True)
class Keyring:
    keys: dict[str, bytes]
    active: str

    @classmethod
    def from_settings(cls, keys: SecretStr | None, active: str | None, what: str) -> "Keyring":
        parsed = parse_keyring(keys)
        if not parsed or not active:
            raise ServiceUnavailable(f"{what} is not configured", setting=what)
        if active not in parsed:
            raise ServiceUnavailable(f"{what}: the active version is not in the keyring", setting=what)
        return cls(parsed, active)

    @property
    def active_secret(self) -> bytes:
        return self.keys[self.active]


# ====================================================================== passwords

_hasher = PasswordHasher()  # Argon2id, RFC 9106 low-memory profile (t=3, m=64 MiB, p=4)


@functools.cache
def _dummy_hash() -> str:
    return _hasher.hash(secrets.token_urlsafe(32))


def validate_new_password(password: str, *, email: str | None = None) -> str:
    """Length-based policy (NIST SP 800-63B): 12-256 characters, not blank, not the email address."""
    if len(password) < PASSWORD_MIN:
        raise ValueError(f"Password must be at least {PASSWORD_MIN} characters")
    if len(password) > PASSWORD_MAX:
        raise ValueError(f"Password must be at most {PASSWORD_MAX} characters")
    if not password.strip():
        raise ValueError("Password must not be blank")
    if email and password.strip().lower() == email.strip().lower():
        raise ValueError("Password must not be your email address")
    return password


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    """Constant-work check. With no hash (unknown user, no password yet) a dummy hash is verified anyway, so timing
    doesn't reveal whether the account exists."""
    try:
        return _hasher.verify(password_hash or _dummy_hash(), password) and password_hash is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def password_needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


# ====================================================================== opaque tokens


def new_opaque_token(prefix: str) -> tuple[str, bytes]:
    """(token shown once to its owner, SHA-256 digest to store). 256 bits of entropy."""
    token = f"{prefix}{secrets.token_urlsafe(32)}"
    return token, token_digest(token)


def token_digest(token: str) -> bytes:
    return hashlib.sha256(token.encode()).digest()


def constant_time_equal(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())


# ====================================================================== API keys


def api_key_digest(secret: str, pepper: bytes) -> bytes:
    return hmac.new(pepper, secret.encode(), hashlib.sha256).digest()


# ====================================================================== access tokens (JWT)

ALGORITHM = "HS256"
REQUIRED_CLAIMS = ["exp", "iat", "nbf", "iss", "aud", "sub", "sid", "ten", "jti"]


class InvalidAccessToken(Exception):
    """Any reason an access token isn't acceptable. The reason is for logs and tests, never for clients."""


@dataclass(frozen=True)
class AccessClaims:
    user_public_id: str
    tenant_slug: str
    session_public_id: str
    expires_at: datetime


def issue_access_token(
    keyring: Keyring,
    *,
    issuer: str,
    audience: str,
    ttl: timedelta,
    user_public_id: str,
    tenant_slug: str,
    session_public_id: str,
) -> tuple[str, datetime]:
    now = clock.now()
    expires = now + ttl
    claims = {
        "iss": issuer,
        "aud": audience,
        "sub": user_public_id,
        "ten": tenant_slug,
        "sid": session_public_id,
        "iat": int(now.timestamp()),
        "nbf": int(now.timestamp()),
        "exp": int(expires.timestamp()),
        "jti": secrets.token_urlsafe(16),
    }
    token = jwt.encode(claims, keyring.active_secret, algorithm=ALGORITHM, headers={"kid": keyring.active})
    return token, expires


def decode_access_token(keyring: Keyring, token: str, *, issuer: str, audience: str) -> AccessClaims:
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError as exc:
        raise InvalidAccessToken("malformed") from exc
    if header.get("alg") != ALGORITHM:
        raise InvalidAccessToken("unexpected algorithm")
    kid = header.get("kid")
    if not isinstance(kid, str) or kid not in keyring.keys:
        raise InvalidAccessToken("unknown signing key version")
    try:
        claims = jwt.decode(
            token,
            keyring.keys[kid],
            algorithms=[ALGORITHM],
            issuer=issuer,
            audience=audience,
            options={"require": REQUIRED_CLAIMS},
            leeway=5,
        )
    except jwt.PyJWTError as exc:
        raise InvalidAccessToken(type(exc).__name__) from exc
    for claim in ("sub", "sid", "ten"):
        if not isinstance(claims.get(claim), str) or not claims[claim]:
            raise InvalidAccessToken(f"bad {claim}")
    return AccessClaims(
        user_public_id=claims["sub"],
        tenant_slug=claims["ten"],
        session_public_id=claims["sid"],
        expires_at=datetime.fromtimestamp(claims["exp"], tz=clock.now().tzinfo),
    )
