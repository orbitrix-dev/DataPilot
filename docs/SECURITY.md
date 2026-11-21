# Authentication and security (Stages 3B.1–3B.2)

How people and programs prove who they are to the DataPilot API, what is stored, and what is **not** implemented yet. Database details are in [DATABASE.md](DATABASE.md); operator commands in [backend/README.md](../backend/README.md#calling-it).

> **Production is still blocked.** Sign-in abuse protection (Stage 3B.3) and SSO are not implemented, and the API refuses to start with `DP_ENV=prod` while that matters. See [Not implemented](#not-implemented-and-how-that-is-enforced).

## Credentials at a glance

| Credential | Who uses it | Format | Stored as | Lifetime |
|---|---|---|---|---|
| Password | people (browser) | 12–256 characters, not the email address | Argon2id hash (`argon2-cffi` defaults: t=3, m=64 MiB, p=4), re-hashed on sign-in when parameters change | until changed |
| Invitation token | a person setting their first password | `dpi_` + 256 random bits | SHA-256 digest | 24 h (`DP_INVITATION_TTL_HOURS`, max 72), single use |
| Access token | the browser, per request | HS256 JWT with `kid` | not stored | 15 min (`DP_ACCESS_TOKEN_TTL_SECONDS`, max 900) |
| Refresh token | the browser, to renew the access token | `dpr_` + 256 random bits | SHA-256 digest | rotates on every use; session ends after 30 days (`DP_REFRESH_SESSION_TTL_DAYS`) or the tenant's idle timeout |
| API key | scripts and integrations (non-browser) | `dp_live_` + random | HMAC-SHA256 with a versioned server-side pepper | until revoked or its optional `expires_at` |
| TOTP secret | the user's authenticator app | 160 random bits (base32) | AES-256-GCM ciphertext, key derived (HKDF-SHA256) from a versioned secret, user id + key version as associated data | until the factor is replaced (not yet possible: see below) |
| Recovery code | a user who lost their authenticator | `xxxx-xxxx-xxxx-xxxx`, ~79 random bits | SHA-256 digest | single use; ten per set; a new set revokes the old |

No raw password, token or key is ever stored, logged or put in an audit event (tests assert this for each flow).

## Invitations (no self-service registration, no email)

1. An operator runs `uv run python -m app.cli invite-user --tenant acme --email someone@acme.io --role analyst`. It creates the user and an `invited` membership if needed, revokes any outstanding invitation for that membership, and prints the token **once**. The command has no password option, so no password reaches the shell history.
2. The operator hands the token over through a secure channel.
3. The person calls `POST /api/v1/auth/invitations/accept` with `{token, password}`. The token is consumed by one conditional `UPDATE … WHERE used_at IS NULL AND revoked_at IS NULL AND expires_at > now() RETURNING`, so two concurrent acceptances can't both succeed (tested with real concurrent transactions). A password that fails the policy is rejected (422) *before* the token is consumed.
4. The password is hashed with Argon2id; the membership becomes `active`.

Unknown, used, revoked (superseded) and expired tokens all get the same `401 Invalid or expired invitation`. Invitations only set a *first* password: they are refused for users who already have one, disabled users and suspended memberships. Issuance (`user.invitation_issued`) and acceptance (`user.invitation_accepted`) are audited in the same transaction as the change.

## Browser sessions

`POST /api/v1/auth/login` with `{email, password, tenant?}`:
- **Uniform failures.** Unknown email, wrong password, an account without a password, a disabled user and a membership that isn't active all return `401 Invalid email or password`, and each spends one Argon2 verification (a dummy hash stands in for missing users).
- **Several workspaces.** A user active in more than one tenant gets `409` with `details.tenants` and repeats the request with `tenant`. A suspended tenant answers `403`.
- **Result.** A `user_sessions` row (the session = the refresh-token family), its first refresh token, a `login.succeeded` audit event, and:
  - the **access token** in the JSON body. The browser keeps it in memory and sends `Authorization: Bearer …`. It is never a cookie, so it is never sent ambiently.
  - the **refresh token** in `__Host-dp_refresh`: `HttpOnly; Secure; SameSite=Strict; Path=/`, no `Domain`. It is never in a response body.
  - a **CSRF token** in `__Host-dp_csrf` (same attributes, readable by JavaScript).

### Access tokens

Claims: `iss`, `aud`, `sub` (member id), `ten` (tenant slug), `sid` (session id), `iat`, `nbf`, `exp`, `jti`; header `kid`. Validation requires the HS256 algorithm (no `none`, no algorithm switching), a `kid` present in the keyring, the right issuer and audience, every claim above, and an unexpired token (5 s leeway).

**Every request re-checks the session in PostgreSQL**: it exists, is not revoked or expired, has not been idle longer than the tenant's `session_timeout_hours`, its `sub` and `ten` match the session's user and tenant (so a token can't be re-pointed at another tenant even with a valid signature), and the membership, user and tenant are still active. Revoking a session in Admin → Sessions, removing a member, suspending them or disabling the user takes effect on the very next request, not when the token expires. `last_seen_at` is written at most once a minute.

When an `Authorization` header is present, the development headers (`X-DataPilot-User`/`-Tenant`) are never consulted. In production they're refused outright: a request needs an access token or an API key.

### Refresh-token rotation and reuse detection

`POST /api/v1/auth/refresh` (cookie-authenticated, CSRF-protected) locks the presented token's row (`SELECT … FOR UPDATE`), marks it used, issues a child token (`parent_id`) and a new access token for the same session. A partial unique index allows only one live token per session, so a family can't fork.

Presenting a token that was **already used or revoked** is treated as theft: the whole family (the session and every token in it) is revoked with reason `refresh_token_reuse` and a `login.refresh_reuse_detected` event is recorded. The endpoint *returns* the 401 rather than raising it, so the revocation and the event commit. Consequence, by design: two tabs refreshing with the same token at the same instant sign the user out (tested); the front end should serialise refreshes.

### CSRF and origins

Cookie-authenticated endpoints (`/auth/refresh`, cookie-based `/auth/logout`) require **both** an `Origin` header listed in `DP_CORS_ORIGINS` **and** `X-CSRF-Token` equal to the `__Host-dp_csrf` cookie (constant-time comparison). `/auth/login` requires an allowed `Origin` (login CSRF). Endpoints authenticated by `Authorization: Bearer` are not ambient and need neither.

### Sign-out

`POST /api/v1/auth/logout` with the access token, or with the refresh cookie plus CSRF. Revokes the family, clears both cookies and records `login.logout`.

## Multi-factor authentication (Stage 3B.2)

TOTP (RFC 6238: SHA-1, 6 digits, 30-second steps) with any authenticator app.

**Enrolment** re-authenticates with the password, so it also works before a first sign-in (for members of a workspace that requires MFA):
1. `POST /auth/mfa/enrollment {email, password}` → `{secret, otpauth_uri}` (render the URI as a QR code). Starting again replaces an unconfirmed secret.
2. `POST /auth/mfa/enrollment/confirm {email, password, code}` → `{recovery_codes}` (ten, shown once). MFA is on from here; `user.mfa_enrolled` is audited in every workspace the user is active in.

Both are refused (`409`) once a factor is confirmed: a stolen password alone can't swap in another authenticator. Both require an allowed `Origin`.

**Sign-in.** Once enrolled, `POST /auth/login` needs `mfa_code` (or `recovery_code`) with the password. The password is always checked first, and `401 mfa_required` is only said to someone who got it right. A wrong code is `401 mfa_invalid`. The session records `mfa_verified_at`; `login.succeeded` records the method (`password`, `password+totp`, `password+recovery_code`).

**Verification** (`app/modules/auth/mfa.py`):
- a code is accepted only if it equals the TOTP of the decrypted secret for the current step or one step either side. A six-digit string is never accepted for its format (tested with `000000`, `123456` and neighbouring codes);
- **no replay**: each factor stores the last accepted step and a code must be for a *later* step, enforced by one conditional `UPDATE … RETURNING` (two concurrent uses of one code: exactly one succeeds, tested). A side effect: at most one successful verification per user per 30 seconds;
- a recovery code is consumed by one conditional UPDATE and reported with the number left (`login.recovery_code_used`). `POST /auth/mfa/recovery-codes {code}` with the access token and a fresh TOTP issues a new set and revokes the old one;
- generating a set (enrolment confirmation, regeneration) first locks the user's row with `SELECT … FOR UPDATE`, so concurrent requests for one user are serialized and can never leave two active sets; the TOTP check, revocation and insertion share one transaction, so a failure leaves the previous set usable (concurrency-tested on PostgreSQL).

**`require_mfa`** (Admin → Security) is enforced in two places: sign-in refuses a member without a factor (`403 mfa_enrollment_required`, recorded as `login.blocked`), and **every request** refuses a session whose sign-in didn't verify MFA, so turning the setting on ends password-only sessions immediately. Sessions that did verify MFA keep working, across refresh-token rotation.

**Step-up.** Creating an API key requires `mfa_code`: a fresh TOTP from the acting user's confirmed factor (`403 mfa_enrollment_required` without one, `403 mfa_invalid` for a wrong or reused code; both recorded as `api-key.step_up_failed`). The code is consumed, so the code just used to sign in can't be reused for it.

**Not in this stage:** disabling MFA or replacing a lost authenticator (an operator flow is needed; a user without codes or authenticator is locked out of MFA-protected sign-in until then), WebAuthn/passkeys, and remembering trusted devices.

**Demo data:** seeded demo users show "MFA enabled" in Admin → Users (`users.mfa_enrolled_at`), but none has a factor or a password. Enforcement always looks at the confirmed factor, never at that display column.

## Security events for rejected requests

A rejected request rolls its transaction back, so its audit event would vanish with it. These go through `SecurityAuditWriter` instead: an independent transaction on its own two-connection pool that commits immediately and never raises (`app/modules/auth/security_events.py`):

| Action | When | Reasons |
|---|---|---|
| `login.failed` | sign-in or enrolment re-authentication refused | `unknown_account`, `no_password`, `wrong_password`, `account_disabled`, `no_active_membership`, `mfa_required` (right password, no code sent), `mfa_invalid`, `recovery_code_invalid` |
| `login.blocked` | right credentials, but sign-in isn't allowed | `tenant_suspended`, `mfa_enrollment_required` |
| `api-key.rejected` | unknown, revoked or expired API key | `invalid_key` (the key id and tenant when the key exists) |
| `api-key.step_up_failed` | key creation refused | `step_up_invalid`, `step_up_not_enrolled` |
| `user.recovery_codes_step_up_failed` | recovery-code regeneration refused (403 wrong/reused code, 409 MFA not enabled) | `recovery_code_regeneration_step_up_failed`, `recovery_code_regeneration_not_enrolled` |

Events carry the reason, the account and tenant when known, and the client address. They never carry the password, code, token or key presented, nor the email typed for an account that doesn't exist (it's attacker-controlled and is sometimes a mistyped password). Events for unknown accounts and keys have no tenant (global). Until 3B.3 adds rate limiting, a flood writes one row per attempt; that is one reason production stays blocked. Production also refuses to start without a writer, or with one that exposes no `health()`.

**Write failures are observable.** A write that fails never breaks the request, but it isn't silent either: the writer logs an ERROR (action code and exception class only), the caller logs a WARNING (`Security event NOT persisted: action=… reason=…`), and bounded counters (events written/failed, consecutive failures, last success/failure time) are served by `GET /healthz/security-audit`, which answers **200 only after a successful write with no failure since**: **503 `unknown`** before the first write (a new writer has proven nothing), **503 `degraded`** while the most recent write failed, 503 `not_configured` without a writer. On a quiet system the state stays `unknown` until the first rejected request is recorded. Point monitoring at it. Nothing is queued in memory: an event that failed is lost, and the counters say so. Startup doesn't probe the writer; the endpoint is the runtime signal.

## API keys

Unchanged contract, now persisted in PostgreSQL (`api_keys`). The secret is shown once; only `HMAC-SHA256(pepper[version], secret)` and the `pepper_version` are stored. Lookup is an indexed match on the digest under each configured pepper version, and the matching version must equal the recorded one. Revoked, expired and unknown keys get the same 401. `last_used_at` is written at most once a minute.

**Key creation requires step-up MFA** (see above), so `api-key.created` is production-enabled since Stage 3B.2.

## Key management

| Setting | Format | Rotation |
|---|---|---|
| `DP_JWT_SIGNING_KEYS` + `DP_JWT_ACTIVE_KID` | `kid=secret,kid=secret` (secrets ≥ 32 chars) | Add the new key, make it active (new tokens use it, old ones still verify); after 15 minutes remove the old key. Removing a key invalidates its tokens immediately (tested) |
| `DP_API_KEY_PEPPERS` + `DP_API_KEY_PEPPER_VERSION` | `version=secret,…` | Add a new version and make it active. Each key is re-hashed under it on its next use; once no key uses the old version, remove it. Keys not used in the meantime stop working (tested) |
| `DP_MFA_ENCRYPTION_KEYS` + `DP_MFA_ENCRYPTION_KEY_VERSION` | `version=secret,…` | Same pattern: a factor is re-encrypted under the active version the next time its code is verified. Removing a version disables the factors still encrypted under it (tested); check `SELECT key_version, count(*) FROM mfa_totp_factors GROUP BY 1` first |

Both are required with `DP_ENV=prod`, and validation errors never echo the values (`hide_input_in_errors`). Generate secrets with `python -c "import secrets; print(secrets.token_urlsafe(48))"`. Tests generate fresh random keys per run.

## Not implemented, and how that is enforced

Each gap is a production blocker in `app/core/readiness.py`, derived from code (`app/modules/auth/enforcement.py`) or from the database, with no configuration switch:

| Gap | Planned | Blocker |
|---|---|---|
| Sign-in throttling and rate limits for login and invalid API keys | 3B.3 | always, until implemented |
| SSO | not scheduled | any active tenant with `enforce_sso = true`: the setting is stored but password sign-in still works, so it must not reach production silently |
| MFA reset / authenticator replacement | later | none: users are locked out of MFA sign-in, not exposed |

The demo tenant has `enforce_sso` set, so it blocks production; it only runs in dev/test (the demo seed is refused in production anyway). `require_mfa` no longer blocks: it is enforced since Stage 3B.2 (`enforcement.mfa_enforced()` is true; the tenant check stays, in case it ever regresses).

Also out of scope for 3B: self-service registration, password reset and email delivery. A forgotten password currently needs an operator (a new user record or a later reset flow).
