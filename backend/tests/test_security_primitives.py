"""Stage 3B.1 credential primitives: Argon2id, opaque tokens, API-key digests, JWT access tokens, keyrings."""

import time
from datetime import timedelta

import jwt
import pytest
from pydantic import ValidationError

from app.core import security as sec
from app.core.config import Settings

ISS, AUD = "datapilot", "datapilot-api"


def ring(active: str = "k2", **extra: str) -> sec.Keyring:
    keys = {"k2": "a" * 40, "k1": "b" * 40, **extra}
    return sec.Keyring({k: v.encode() for k, v in keys.items()}, active)


def token(keyring: sec.Keyring, ttl: int = 900, **overrides) -> str:
    raw, _ = sec.issue_access_token(
        keyring,
        issuer=ISS,
        audience=AUD,
        ttl=timedelta(seconds=ttl),
        user_public_id="u-elena",
        tenant_slug="acme",
        session_public_id="sess-1",
    )
    if not overrides:
        return raw
    claims = jwt.decode(raw, options={"verify_signature": False})
    claims.update(overrides)
    return jwt.encode(claims, keyring.active_secret, algorithm="HS256", headers={"kid": keyring.active})


# ====================================================================== passwords


def test_passwords_are_argon2id_salted_and_verified():
    h1, h2 = sec.hash_password("correct horse battery"), sec.hash_password("correct horse battery")
    assert h1.startswith("$argon2id$") and h1 != h2  # salted
    assert sec.verify_password(h1, "correct horse battery")
    assert not sec.verify_password(h1, "Correct horse battery")
    assert not sec.verify_password("not-a-hash", "x")
    assert not sec.verify_password(None, "anything")  # unknown user / no password yet


def test_outdated_hash_parameters_are_detected_for_rehash():
    from argon2 import PasswordHasher

    weak = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1).hash("correct horse battery")
    assert sec.verify_password(weak, "correct horse battery") and sec.password_needs_rehash(weak)
    assert not sec.password_needs_rehash(sec.hash_password("correct horse battery"))


@pytest.mark.parametrize(
    ("password", "error"),
    [("short", "at least 12"), ("x" * 257, "at most 256"), (" " * 12, "blank"), ("e.vance@acme.io", "email")],
)
def test_password_policy(password, error):
    with pytest.raises(ValueError, match=error):
        sec.validate_new_password(password, email="e.vance@acme.io")


# ====================================================================== tokens and digests


def test_opaque_tokens_are_random_and_only_their_digest_is_kept():
    (t1, d1), (t2, d2) = sec.new_opaque_token("dpr_"), sec.new_opaque_token("dpr_")
    assert t1.startswith("dpr_") and len(t1) >= 40 and t1 != t2
    assert d1 == sec.token_digest(t1) and len(d1) == 32 and d1 != d2


def test_api_key_digest_depends_on_the_pepper():
    assert sec.api_key_digest("dp_live_x", b"p" * 40) != sec.api_key_digest("dp_live_x", b"q" * 40)
    assert len(sec.api_key_digest("dp_live_x", b"p" * 40)) == 32


# ====================================================================== JWT access tokens


def test_access_tokens_round_trip_with_kid_issuer_audience_and_session():
    claims = sec.decode_access_token(ring(), token(ring()), issuer=ISS, audience=AUD)
    assert (claims.user_public_id, claims.tenant_slug, claims.session_public_id) == ("u-elena", "acme", "sess-1")
    assert jwt.get_unverified_header(token(ring()))["kid"] == "k2"


def test_tokens_signed_with_an_older_listed_key_still_verify_and_removed_keys_do_not():
    old = token(ring(active="k1"))
    assert sec.decode_access_token(ring(active="k2"), old, issuer=ISS, audience=AUD).user_public_id == "u-elena"
    without_k1 = sec.Keyring({"k2": b"a" * 40}, "k2")
    with pytest.raises(sec.InvalidAccessToken, match="unknown signing key"):
        sec.decode_access_token(without_k1, old, issuer=ISS, audience=AUD)


@pytest.mark.parametrize(
    ("overrides", "reason"),
    [({"iss": "evil"}, "InvalidIssuer"), ({"aud": "other"}, "InvalidAudience"), ({"sid": ""}, "bad sid")],
)
def test_wrong_issuer_audience_or_claims_are_rejected(overrides, reason):
    with pytest.raises(sec.InvalidAccessToken, match=reason):
        sec.decode_access_token(ring(), token(ring(), **overrides), issuer=ISS, audience=AUD)


def test_expired_tampered_unsigned_and_foreign_tokens_are_rejected():
    expired = token(ring(), exp=int(time.time()) - 60)
    with pytest.raises(sec.InvalidAccessToken, match="ExpiredSignature"):
        sec.decode_access_token(ring(), expired, issuer=ISS, audience=AUD)
    header, payload, signature = token(ring()).split(".")
    tampered = f"{header}.{payload}.{signature[:-2]}AA"
    with pytest.raises(sec.InvalidAccessToken):
        sec.decode_access_token(ring(), tampered, issuer=ISS, audience=AUD)
    unsigned = jwt.encode({"sub": "u-elena"}, key=None, algorithm="none", headers={"kid": "k2"})
    with pytest.raises(sec.InvalidAccessToken, match="unexpected algorithm"):
        sec.decode_access_token(ring(), unsigned, issuer=ISS, audience=AUD)
    foreign = jwt.encode({"sub": "x"}, "c" * 40, algorithm="HS256", headers={"kid": "k2"})
    with pytest.raises(sec.InvalidAccessToken):
        sec.decode_access_token(ring(), foreign, issuer=ISS, audience=AUD)
    with pytest.raises(sec.InvalidAccessToken, match="malformed"):
        sec.decode_access_token(ring(), "not.a.jwt", issuer=ISS, audience=AUD)


def test_missing_required_claims_are_rejected():
    claims = {"iss": ISS, "aud": AUD, "sub": "u", "exp": int(time.time()) + 60}  # no sid/ten/jti/nbf/iat
    raw = jwt.encode(claims, b"a" * 40, algorithm="HS256", headers={"kid": "k2"})
    with pytest.raises(sec.InvalidAccessToken, match="MissingRequiredClaim"):
        sec.decode_access_token(ring(), raw, issuer=ISS, audience=AUD)


# ====================================================================== keyrings and configuration


@pytest.mark.parametrize(
    ("value", "error"),
    [
        ("v1=tooshort", "at least 32"),
        ("no-separator", "<version>=<secret>"),
        ("bad kid!=" + "x" * 40, "<version>=<secret>"),
        ("v1=" + "x" * 40 + ",v1=" + "y" * 40, "twice"),
    ],
)
def test_malformed_keyrings_are_rejected_without_echoing_secrets(value, error):
    with pytest.raises(ValueError, match=error) as caught:
        sec.parse_keyring(value)
    assert "x" * 10 not in str(caught.value) and "tooshort" not in str(caught.value)


def test_settings_reject_bad_keys_without_leaking_them():
    with pytest.raises(ValidationError) as caught:
        Settings(api_key_peppers="p1=supersecretbutshort", api_key_pepper_version="p1")
    assert "supersecretbutshort" not in str(caught.value)
    with pytest.raises(ValidationError, match="active version is not in the keyring"):
        Settings(jwt_signing_keys="k1=" + "x" * 40, jwt_active_kid="k9")


def test_production_requires_both_keyrings():
    with pytest.raises(ValidationError, match="must both be set when DP_ENV=prod"):
        Settings(env="prod", database_url="postgresql+psycopg://u@h/d", jwt_signing_keys=None, jwt_active_kid=None)
