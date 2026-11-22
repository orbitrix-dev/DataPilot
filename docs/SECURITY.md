# Authentication and security (Stages 3B.1–3B.3)

How people and programs prove who they are to the DataPilot API, what is stored, and what is **not** implemented yet. Database details are in [DATABASE.md](DATABASE.md); operator commands in [backend/README.md](../backend/README.md#calling-it).

> **Production is still blocked.** SSO is not implemented (tenants with `enforce_sso` block startup) and audit retention isn't enforced; the API refuses to start with `DP_ENV=prod` while that holds. Abuse protection is implemented since Stage 3B.3 and is itself checked at startup. See [Not implemented](#not-implemented-and-how-that-is-enforced).

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

Events carry the reason, the account and tenant when known, and the client address. They never carry the password, code, token or key presented, nor the email typed for an account that doesn't exist (it's attacker-controlled and is sometimes a mistyped password). Events for unknown accounts and keys have no tenant (global). The rate limits (below) bound how many of these one source can cause: at most the limit per window per address or account, then one `*.throttled` event per block instead of one row per refused attempt. Production also refuses to start without a writer, or with one that exposes no `health()`.

**Write failures are observable.** A write that fails never breaks the request, but it isn't silent either: the writer logs an ERROR (action code and exception class only), the caller logs a WARNING (`Security event NOT persisted: action=… reason=…`), and bounded counters (events written/failed, consecutive failures, last success/failure time) are served by `GET /healthz/security-audit`, which answers **200 only after a successful write with no failure since**: **503 `unknown`** before the first write (a new writer has proven nothing), **503 `degraded`** while the most recent write failed, 503 `not_configured` without a writer. On a quiet system the state stays `unknown` until the first rejected request is recorded. Point monitoring at it. Nothing is queued in memory: an event that failed is lost, and the counters say so. Startup doesn't probe the writer; the endpoint is the runtime signal.

## Abuse protection (Stage 3B.3)

Shared, persistent counters in PostgreSQL (`auth_throttle_buckets`, `app/modules/auth/throttle.py`). Every application instance reads and writes the same rows, and they survive restarts; no process-local counter decides anything.

**How a check works.** Before a password or code is verified, the attempt is counted with one atomic `INSERT … ON CONFLICT (scope, subject_hash) DO UPDATE … RETURNING`, in its own short transaction on the limiter's own pool (3 connections, 1 s wait, 2 s connect and statement timeouts). The upsert takes the row lock, so concurrent attempts, across any number of instances, are serialized by PostgreSQL. No race admits more than the limit (tested with 40 concurrent attempts over 4 limiter instances). A correct password's reset racing with wrong-password attempts is serialized the same way: every admitted attempt sees a distinct count, at most the limit of wrong attempts is admitted, and the correct one is admitted only if it arrived before the limit (tested at the limiter and through real sign-ins). Counting first also caps the Argon2 work an attacker can trigger. Counts commit even though a refused request's own transaction rolls back.

| Scope | Subject | Default | Policy |
|---|---|---|---|
| `login_ip` | client address (IPv6 by /64) | 20 per 10 min | every sign-in or enrolment password check, any outcome; then 429 until the window ends |
| `login_account` | normalized email | 5 | wrong passwords in a row (a correct password resets); then progressive blocks |
| `mfa` | user | 5 | wrong or replayed authenticator codes, at sign-in, enrolment confirmation, recovery-code regeneration and API-key step-up; a correct code resets |
| `recovery_code` | user | 5 | wrong recovery codes at sign-in; a correct one resets |
| `api_key_ip` | client address | 30 per 10 min | **invalid** keys only (unknown, revoked, expired); valid keys are never counted or refused |

**Progressive blocks** last 1 min, then 2, 4, … up to 60 min; the level is forgotten after 24 h without a block. **No account is ever locked permanently.** The worst an attacker can impose on a victim is a rolling block of at most 60 minutes, and only while they keep spending attempts, each also counted against their own address. A legitimate user caught by it waits, or signs in once the block ends. **Unknown and existing accounts are counted identically**, so the responses (401s, then 429 with the same `Retry-After`) reveal nothing. Changing the case of an email or the source address doesn't escape the account counter. Changing the account doesn't escape the address counter.

**Responses.** `429 {"error": {"code": "too_many_requests", "message": "Too many attempts. Try again later."}}` with `Retry-After` in seconds; no counters, identifiers or account hints. A refused attempt never reaches the password or code check, so even the right password gets 429 during a block. Requests that aren't throttled behave exactly as before.

**Identifiers.** `subject_hash = HMAC-SHA256(DP_THROTTLE_KEYS[version], "datapilot/throttle/v1" ‖ scope ‖ identifier)`. The key is separate from the JWT, pepper and MFA keys. Emails are normalized exactly like sign-in does. Raw addresses, emails, keys and codes are never stored or logged, and neither are the HMACs. Each row records the version it was signed under (`key_version`). `DP_THROTTLE_KEYS` and `DP_THROTTLE_KEY_VERSION` are required with `DP_ENV=prod`. Rotation: [below](#rotating-the-throttle-key-dp_throttle_keys).

**Failure policy: fail closed.** If the limiter can't reach its database, sign-in, enrolment and code checks answer **503** and the password or code is never checked. Throttling is never silently skipped. For the next 5 s (`DP_THROTTLE_FAILURE_COOLDOWN_SECONDS`) every check is refused immediately without contacting the database, so an outage doesn't turn the endpoint into a stream of connection attempts. One error is logged per outage, not per request. **Invalid API keys during an outage get 503** (`Authentication is temporarily unavailable`), not an ordinary 401. The attempt couldn't be counted, so it is neither answered as a normal rejection nor recorded per request, which would be an unbounded write path while the limiter is down. **Valid keys keep working:** they never touch the limiter. An app without a limiter refuses sign-in and invalid keys the same way (503), and production refuses to start without one.

**Audit (bounded).** One `login.throttled` or `api-key.throttled` event (metadata: `scope`, `retry_after_seconds`) when a subject *becomes* blocked, never one per refused request. An invalid API key is counted *before* anything is recorded. `api-key.rejected` is written only for attempts that were counted and admitted, so at most 30 per address per window, and never for attempts refused by a block (429) or by an outage (503). Sign-in works the same way: refused attempts write no `login.failed`. If the security audit writer fails, throttling is unaffected.

**Readiness.** Production startup checks the actual limiter: it is configured, it covers every scope, its active key version is in the keyring, and `auth_throttle_buckets` exists with the runtime user's `SELECT/INSERT/UPDATE` (catalog queries at startup). There is no switch to turn protection off.

**Housekeeping.** Rows are reused per subject, so the table grows with distinct subjects, not requests. The runtime user can't delete. Schedule `python -m app.cli purge-auth-throttle` daily. It runs as the owner (`DP_MIGRATION_DATABASE_URL`) and deletes, in batches of 10 000, rows of any key version whose `updated_at` is older than `DP_THROTTLE_BLOCK_MEMORY_HOURS` (default 24; `--older-than-hours` overrides it) and that aren't blocked right now (`blocked_until` is NULL or in the past). A row with an active block is never deleted. The cutoff runs from the row's last touch, not from the end of its last block. So a subject that went quiet during a block can lose its block level up to `DP_THROTTLE_BLOCK_MAX_SECONDS` earlier than the *memory* period promises. A subject that keeps sending attempts keeps its row fresh.

### Rotating the throttle key (`DP_THROTTLE_KEYS`)

**How rows move.** An instance that lists both versions re-keys a subject's row to its own active version the first time it touches that subject (an attempt or a reset), so counters, blocks and block levels carry over (tested). A subject that isn't touched keeps its old-version row, and only an instance that still lists the old key can find it. While more than one version is listed, every operation on a subject first takes a transaction-scoped advisory lock. The lock is derived from the subject's HMAC under the lowest-named version, so every instance that lists the same versions computes the same lock, whichever version it has active. Re-keying and counting are therefore serialized across instances, even while some sign with the old version and others with the new. A counter can't split into two rows (tested with 40 concurrent attempts over instances with different active versions). With a single version no extra lock is taken.

**Procedure.** Below, `old` and `new` are version names, and *memory* is the production value of `DP_THROTTLE_BLOCK_MEMORY_HOURS`. It is 24 h by default, but the configured value is what counts.

1. **Add.** Deploy `DP_THROTTLE_KEYS=new=…,old=…` to every instance, keeping `DP_THROTTLE_KEY_VERSION=old`.
2. **Verify that every instance knows both.** Use your deployment tooling: every running process (all replicas, all workers) runs with the new keyring, and nothing started before step 1 is still serving. The application doesn't report its keyring.
3. **Switch.** Deploy `DP_THROTTLE_KEY_VERSION=new` everywhere, keyring unchanged. During this rollout old-active and new-active instances coexist. That is safe because both list the same versions, so they take the same lock. A row may be re-keyed back and forth between versions while both kinds are running.
4. **Verify that no old-active instance remains.** Use your deployment tooling, and note the time **T** at which the last old-active instance stopped. From then on, nothing writes old-version rows: an instance re-keys every row it touches to `new`. In the [query below](#verifying-the-rotation), the old version's `latest_update` must not be later than T. If it is, an old-active instance is still running.
5. **Retain.** Keep the old key listed for at least *memory* hours after T. If `DP_THROTTLE_BLOCK_MAX_SECONDS` or `DP_THROTTLE_WINDOW_SECONDS` is configured longer than that, wait for the longest of the three. One hour is not enough: a block level is remembered for *memory* hours after the block ends, so a subject blocked shortly before T still carries its level on an old-version row.
6. **Purge.** Run `python -m app.cli purge-auth-throttle` as the owner with its default cutoff, *memory*. Don't pass a smaller `--older-than-hours` to speed this up. Purging doesn't depend on the key version, and it never deletes a row that is blocked right now.
7. **Verify, then remove.** Run the [query](#verifying-the-rotation). Remove the old version only when it has no rows left. Then deploy `DP_THROTTLE_KEYS=new=…` (with `DP_THROTTLE_KEY_VERSION=new`) to every instance.

**Removing the old key too early.** Every row still under the old version becomes unreachable. Its subject starts afresh: its count, any active block and its progressive block level are lost (the fresh allowance is tested). An attacker who was blocked gets a new allowance at the first block level. The orphaned rows stay until a purge deletes them. If an instance still *signs* with the old version when other instances no longer list it, the two groups keep separate counters for the same subject, so each enforces only part of the limit. Skipping step 1 (switching an instance to a version that other instances don't know) has the same effect during that rollout.

#### Verifying the rotation

Aggregates only: no `subject_hash`, emails, addresses, account ids or keys. Run it as the owner (`DP_MIGRATION_DATABASE_URL`, the user that runs the purge) or as a read-only role granted only `SELECT` on `auth_throttle_buckets`. The runtime user also has `SELECT`, but keep its credentials for the application. Replace `24` in the first line with the production `DP_THROTTLE_BLOCK_MEMORY_HOURS`.

```sql
WITH cfg AS (SELECT make_interval(hours => 24) AS memory)  -- = DP_THROTTLE_BLOCK_MEMORY_HOURS
SELECT b.key_version,
       count(*)                                                        AS total_rows,
       count(*) FILTER (WHERE b.blocked_until > now())                 AS blocked_now,
       count(*) FILTER (WHERE b.blocked_until > now() - cfg.memory)    AS level_remembered,
       count(*) FILTER (WHERE b.updated_at < now() - cfg.memory
                          AND (b.blocked_until IS NULL OR b.blocked_until < now())) AS purgeable,
       max(b.updated_at)                                               AS latest_update,
       max(b.blocked_until)                                            AS latest_block_end
  FROM auth_throttle_buckets b CROSS JOIN cfg
 GROUP BY b.key_version
 ORDER BY b.key_version;
```

`purgeable` uses exactly the purge command's condition with its default cutoff. Before step 7:

- **No row for the old version:** safe to remove it.
- **`latest_update` later than T:** an old-active instance is still running. Go back to step 4.
- **`blocked_now` > 0:** those blocks are still active. The purge keeps them, and removing the key would lift them. Wait until `latest_block_end` has passed, then purge again. This happens only when blocks can outlast *memory*, that is, when `DP_THROTTLE_BLOCK_MAX_SECONDS` is longer than *memory* hours.
- **`purgeable` > 0:** the purge hasn't run since those rows became eligible. Run it again.
- **Rows remain, none of the above:** they were touched less than *memory* hours ago, so you are still inside step 5. Wait.

`level_remembered` is for information only: these are rows whose last block ended less than *memory* hours ago. The new version's figures are live traffic and need no action.

**Deliberately not done.** No global emergency limit: one attacker could use it to lock everyone out, and the per-address and per-account layers already bound the work per source. No Redis. No quotas for valid API keys. Invitation acceptance isn't throttled, because its tokens carry 256 random bits and can't be guessed.

## API keys

Unchanged contract, now persisted in PostgreSQL (`api_keys`). The secret is shown once; only `HMAC-SHA256(pepper[version], secret)` and the `pepper_version` are stored. Lookup is an indexed match on the digest under each configured pepper version, and the matching version must equal the recorded one. Revoked, expired and unknown keys get the same 401. `last_used_at` is written at most once a minute.

**Key creation requires step-up MFA** (see above), so `api-key.created` is production-enabled since Stage 3B.2.

## Key management

| Setting | Format | Rotation |
|---|---|---|
| `DP_JWT_SIGNING_KEYS` + `DP_JWT_ACTIVE_KID` | `kid=secret,kid=secret` (secrets ≥ 32 chars) | Add the new key, make it active (new tokens use it, old ones still verify); after 15 minutes remove the old key. Removing a key invalidates its tokens immediately (tested) |
| `DP_API_KEY_PEPPERS` + `DP_API_KEY_PEPPER_VERSION` | `version=secret,…` | Add a new version and make it active. Each key is re-hashed under it on its next use; once no key uses the old version, remove it. Keys not used in the meantime stop working (tested) |
| `DP_MFA_ENCRYPTION_KEYS` + `DP_MFA_ENCRYPTION_KEY_VERSION` | `version=secret,…` | Same pattern: a factor is re-encrypted under the active version the next time its code is verified. Removing a version disables the factors still encrypted under it (tested); check `SELECT key_version, count(*) FROM mfa_totp_factors GROUP BY 1` first |
| `DP_THROTTLE_KEYS` + `DP_THROTTLE_KEY_VERSION` | `version=secret,…` | Add, verify, switch, verify, then keep the old version for at least `DP_THROTTLE_BLOCK_MEMORY_HOURS` (default 24), purge, verify, and only then remove it. See [Rotating the throttle key](#rotating-the-throttle-key-dp_throttle_keys) |

All four are required with `DP_ENV=prod`, and validation errors never echo the values (`hide_input_in_errors`). Generate secrets with `python -c "import secrets; print(secrets.token_urlsafe(48))"`. Tests generate fresh random keys per run.

## Not implemented, and how that is enforced

Each gap is a production blocker in `app/core/readiness.py`, derived from code (`app/modules/auth/enforcement.py`) or from the database, with no configuration switch:

| Gap | Planned | Blocker |
|---|---|---|
| Quotas for *valid* API keys (request rate per key) | later | none: valid keys are not throttled by 3B.3 |
| SSO | not scheduled | any active tenant with `enforce_sso = true`: the setting is stored but password sign-in still works, so it must not reach production silently |
| MFA reset / authenticator replacement | later | none: users are locked out of MFA sign-in, not exposed |

The demo tenant has `enforce_sso` set, so it blocks production; it only runs in dev/test (the demo seed is refused in production anyway). `require_mfa` no longer blocks: it is enforced since Stage 3B.2 (`enforcement.mfa_enforced()` is true; the tenant check stays, in case it ever regresses).

Also out of scope for 3B: self-service registration, password reset and email delivery. A forgotten password currently needs an operator (a new user record or a later reset flow).
