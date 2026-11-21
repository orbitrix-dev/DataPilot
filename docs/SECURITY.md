# Authentication and security (Stage 3B.1)

How people and programs prove who they are to the DataPilot API, what is stored, and what is **not** implemented yet. Database details are in [DATABASE.md](DATABASE.md); operator commands in [backend/README.md](../backend/README.md#calling-it).

> **Production is still blocked.** MFA (Stage 3B.2), sign-in abuse protection (Stage 3B.3) and SSO are not implemented, and the API refuses to start with `DP_ENV=prod` while that matters. See [Not implemented](#not-implemented-and-how-that-is-enforced).

## Credentials at a glance

| Credential | Who uses it | Format | Stored as | Lifetime |
|---|---|---|---|---|
| Password | people (browser) | 12–256 characters, not the email address | Argon2id hash (`argon2-cffi` defaults: t=3, m=64 MiB, p=4), re-hashed on sign-in when parameters change | until changed |
| Invitation token | a person setting their first password | `dpi_` + 256 random bits | SHA-256 digest | 24 h (`DP_INVITATION_TTL_HOURS`, max 72), single use |
| Access token | the browser, per request | HS256 JWT with `kid` | not stored | 15 min (`DP_ACCESS_TOKEN_TTL_SECONDS`, max 900) |
| Refresh token | the browser, to renew the access token | `dpr_` + 256 random bits | SHA-256 digest | rotates on every use; session ends after 30 days (`DP_REFRESH_SESSION_TTL_DAYS`) or the tenant's idle timeout |
| API key | scripts and integrations (non-browser) | `dp_live_` + random | HMAC-SHA256 with a versioned server-side pepper | until revoked or its optional `expires_at` |

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

## API keys

Unchanged contract, now persisted in PostgreSQL (`api_keys`). The secret is shown once; only `HMAC-SHA256(pepper[version], secret)` and the `pepper_version` are stored. Lookup is an indexed match on the digest under each configured pepper version, and the matching version must equal the recorded one. Revoked, expired and unknown keys get the same 401. `last_used_at` is written at most once a minute.

**Key creation stays production-disabled** (`api-key.created` is not production-enabled in the audit registry) until Stage 3B.2 adds MFA step-up: the `mfa_code` field is still accepted but **not verified**.

## Key management

| Setting | Format | Rotation |
|---|---|---|
| `DP_JWT_SIGNING_KEYS` + `DP_JWT_ACTIVE_KID` | `kid=secret,kid=secret` (secrets ≥ 32 chars) | Add the new key, make it active (new tokens use it, old ones still verify); after 15 minutes remove the old key. Removing a key invalidates its tokens immediately (tested) |
| `DP_API_KEY_PEPPERS` + `DP_API_KEY_PEPPER_VERSION` | `version=secret,…` | Add a new version and make it active. Each key is re-hashed under it on its next use; once no key uses the old version, remove it. Keys not used in the meantime stop working (tested) |

Both are required with `DP_ENV=prod`, and validation errors never echo the values (`hide_input_in_errors`). Generate secrets with `python -c "import secrets; print(secrets.token_urlsafe(48))"`. Tests generate fresh random keys per run.

## Not implemented, and how that is enforced

Each gap is a production blocker in `app/core/readiness.py`, derived from code (`app/modules/auth/enforcement.py`) or from the database, with no configuration switch:

| Gap | Planned | Blocker |
|---|---|---|
| MFA (TOTP, recovery codes, `require_mfa` enforcement, step-up for key creation) | 3B.2 | any active tenant with `require_mfa = true` |
| Sign-in throttling and rate limits for login and invalid API keys | 3B.3 | always, until implemented |
| SSO | not scheduled | any active tenant with `enforce_sso = true`: the setting is stored but password sign-in still works, so it must not reach production silently |
| Security events for *rejected* requests (failed sign-ins, invalid keys) in an independent transaction | 3B.2 (`SecurityAuditWriter`) | covered by the abuse-protection blocker |

The demo tenant has `require_mfa` and `enforce_sso` set, so it blocks production; it only runs in dev/test (the demo seed is refused in production anyway).

Also out of scope for 3B: self-service registration, password reset and email delivery. A forgotten password currently needs an operator (a new user record or a later reset flow).
