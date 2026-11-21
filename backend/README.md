# DataPilot API

The FastAPI application backend from [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md). This is the skeleton: the structure, auth and permission model, and the product services the front end needs first. Storage is in memory, seeded with the same demo tenant the front end's mock data shows (Acme Global Corp, as of Fri Nov 20, 2026 14:32 UTC).

## Run it

### Prerequisites

- [uv](https://docs.astral.sh/uv/) 0.5+ (it installs Python 3.12 for you)
- Docker with Compose v2.17+ (for `--wait`), with the Docker daemon running (on macOS, open Docker Desktop)

### First-time setup

From the repository root:

```bash
cp .env.example .env
# Edit .env: replace "change-me-owner-local-only" (owner) and "change-me-app-local-only" (runtime user) everywhere.
docker compose up -d --wait postgres     # PostgreSQL 18 on 127.0.0.1:5432; returns once the health check passes
cd backend
uv sync --locked                         # creates .venv with exactly the versions in uv.lock
uv run alembic upgrade head              # creates/updates the schema (tenants, users, roles, permissions, …)
uv run python -m app.cli seed-demo       # loads the demo tenant into PostgreSQL (idempotent); the API needs it
uv run uvicorn app.main:app --reload --port 8000
```

- API: `http://localhost:8000/api/v1`
- Interactive docs: `http://localhost:8000/api/v1/docs`
- Liveness: `http://localhost:8000/healthz` (never touches the database)
- **Two database users:** migrations run as the owner (`DP_MIGRATION_DATABASE_URL`), and the API connects as the least-privilege `datapilot_app` (`DP_DATABASE_URL`). That user owns nothing and has no DDL rights. See [docs/DATABASE.md](../docs/DATABASE.md#database-roles-stage-3a1).
- **Upgrading a volume created before Stage 3A.1:** add `POSTGRES_APP_USER`, `POSTGRES_APP_PASSWORD` and the new URLs from `.env.example` to `.env`. Then run `docker compose up -d postgres` and `docker compose exec postgres /docker-entrypoint-initdb.d/02-create-app-role.sh` once, before `alembic upgrade head`.
- **Production is blocked:** with `DP_ENV=prod` the API refuses to start until audit retention is enforced. See [Production blockers](../docs/DATABASE.md#production-blockers).
- Database readiness: `http://localhost:8000/healthz/db`, which returns `200 {"status":"ok","database":"ok","latency_ms":…}`, or `503` with `"database": "not_configured"` or `"unreachable"`

Day to day: `docker compose up -d --wait postgres`, then the `uvicorn` line. `docker compose down` stops PostgreSQL and keeps the data; `docker compose down -v` **deletes all local database data**.

### Verifying database privileges

```bash
uv run python -m app.cli check-db-privileges   # exit 0: the runtime user has exactly the approved privileges
```

It reports every deviation: role attributes, memberships, ownership, temporary tables, schema `CREATE`, table and column privileges, function `EXECUTE`, and anything granted to `PUBLIC`. Run it after provisioning a database or changing roles.

### Tests, lint and format

From `backend/`, with the postgres container running:

```bash
uv run pytest                  # all tests, including the database tests
uv run ruff check .            # lint
uv run ruff format --check .   # formatting check (uv run ruff format . to fix)
```

### Configuration

Read from `DP_*` environment variables, then the repo-root `.env` (shared with Docker Compose), then `backend/.env`. Real environment variables win. See `.env.example` for every variable. `.env` files are git-ignored; never commit real credentials.

| Variable | Default | Notes |
|---|---|---|
| `DP_ENV` | `dev` | `dev` \| `test` \| `prod` |
| `DP_DATABASE_URL` | none | `postgresql+psycopg://user:pass@host:5432/db`. **Required in prod.** Never printed: it's a `SecretStr`. Empty means unset |
| `DP_MIGRATION_DATABASE_URL` | none | **The owner**, used only by Alembic. Must be a different user from `DP_DATABASE_URL` (migration `0003` refuses otherwise) |
| `DP_TEST_DATABASE_URL` / `DP_TEST_MIGRATION_DATABASE_URL` | none | Test suite only: the runtime user and the owner. Database names must end in `_test` |
| `DP_TRUSTED_PROXIES` | empty | Comma-separated IPs/CIDRs of reverse proxies whose `X-Forwarded-For` is trusted. Empty = never trust forwarded headers. An invalid value stops startup |
| `DP_DB_POOL_SIZE` / `DP_DB_MAX_OVERFLOW` | `5` / `10` | Per process. Keep (`pool_size` + `max_overflow`) × processes under the server's `max_connections` |
| `DP_DB_POOL_TIMEOUT_SECONDS` | `10` | Wait for a free pooled connection before failing with 503 |
| `DP_DB_POOL_RECYCLE_SECONDS` | `1800` | Replace connections older than this |
| `DP_DB_CONNECT_TIMEOUT_SECONDS` | `5` | |
| `DP_DB_STATEMENT_TIMEOUT_MS` | `15000` | Server-side cap per statement; `0` disables |
| `DP_DB_MIGRATION_LOCK_TIMEOUT_MS` | `10000` | Migrations give up rather than queue behind long transactions |
| `DP_CORS_ORIGINS`, `DP_API_PREFIX` | | `DP_CORS_ORIGINS` is also the allow-list for the `Origin` check on sign-in, refresh and cookie sign-out |
| `DP_JWT_SIGNING_KEYS` / `DP_JWT_ACTIVE_KID` | none | `kid=secret,…` (≥ 32-char secrets) and the kid that signs new access tokens. **Required in prod.** Sign-in answers 503 without them |
| `DP_JWT_ISSUER` / `DP_JWT_AUDIENCE` | `datapilot` / `datapilot-api` | Checked on every access token |
| `DP_ACCESS_TOKEN_TTL_SECONDS` | `900` | 60–900 |
| `DP_REFRESH_SESSION_TTL_DAYS` | `30` | Absolute session lifetime, 1–90. The tenant's idle timeout applies too |
| `DP_INVITATION_TTL_HOURS` | `24` | 1–72 |
| `DP_MFA_ENCRYPTION_KEYS` / `DP_MFA_ENCRYPTION_KEY_VERSION` | none | `version=secret,…`: TOTP secrets are AES-256-GCM encrypted under a key derived from the active version. **Required in prod.** MFA endpoints answer 503 without them |
| `DP_MFA_ISSUER` | `DataPilot` | The account issuer authenticator apps display |
| `DP_API_KEY_PEPPERS` / `DP_API_KEY_PEPPER_VERSION` | none | `version=secret,…` and the active version. **Required in prod.** Rotation: [docs/SECURITY.md](../docs/SECURITY.md#key-management) |

### Database and transactions

`app/core/db.py` owns the engine (one connection pool per process, `pool_pre_ping` on) and gives each request one transaction through the `DbSession` dependency:

```python
from app.core.db import DbSession


@router.post("/things")
def create_thing(body: ThingIn, db: DbSession) -> ThingOut:
    thing = Thing(**body.model_dump())
    db.add(thing)  # no commit(): the dependency commits when the route returns
    return ThingOut.model_validate(thing, from_attributes=True)
```

- **The transaction commits when the route returns, before the response is sent.** It rolls back on any exception, including `DomainError`s, so a 4xx never leaves partial writes. If the commit itself fails, the client gets an error, never a `200`.
- This relies on `Depends(..., scope="function")`, which needs **FastAPI ≥ 0.121**. That's the floor in `pyproject.toml`; the locked version is in `uv.lock`. With FastAPI's default request scope, cleanup would run *after* the response is sent.
- Connection failures and timeouts become `503 {"error": {"code": "service_unavailable", …}}`, with details logged but never returned.
- Scripts and workers use `with database.session() as s: ...` for the same commit/rollback behaviour.

**The Tenants module runs on PostgreSQL** (members, sessions, workspace settings, permission matrix), and so does request authentication. API keys, Connect, Trust, Automate, Billing, Notifications and the audit log are still in memory. IDs and responses are unchanged. Audit events are published only after the request's transaction commits. Schema, identifier mapping, request flow, tenant isolation and seed details are in [docs/DATABASE.md](../docs/DATABASE.md).

### Demo data in PostgreSQL

`uv run python -m app.cli seed-demo` loads the demo tenant (Acme Global Corp, 12 users, the five system roles with the current permission matrix) into the database at `DP_DATABASE_URL`:

- It's idempotent and insert-only, so re-running it creates nothing and never overwrites edits.
- It creates **no passwords and no sessions**.
- It refuses to run when `DP_ENV=prod`.

Run `alembic upgrade head` first. **The API needs this data:** until it's seeded, dev requests get `401 Unknown tenant 'acme'`. Demo sessions hold digests of discarded random tokens and can never authenticate.

### Migrations (Alembic)

Configuration: [`alembic.ini`](alembic.ini) and [`migrations/env.py`](migrations/env.py). The database URL comes from `DP_MIGRATION_DATABASE_URL`, falling back to `DP_DATABASE_URL`, and is never stored in `alembic.ini`. Autogenerate compares against `app.db.models.Base.metadata`. Every models module must be imported in [`app/db/models.py`](app/db/models.py) or Alembic won't see it.

Run from `backend/`:

```bash
uv run alembic upgrade head                                    # apply all pending migrations
uv run alembic current                                         # the database's current revision
uv run alembic history                                         # all revisions
uv run alembic downgrade -1                                    # roll back the latest migration
uv run alembic downgrade base                                  # roll back everything (dev/CI only)
uv run alembic check                                           # fails if the models have changes with no migration
uv run alembic revision --autogenerate --rev-id 0002 -m "..."  # create a migration: review and edit it before committing
uv run alembic upgrade head --sql                              # print the SQL instead of running it (for review)
```

How migrations run:

- All pending migrations run in **one transaction**. PostgreSQL DDL is transactional, so if any migration fails, the database is left exactly as it was.
- A `lock_timeout` (10 s by default) makes a migration fail rather than block live traffic while waiting for locks.
- In production, run `alembic upgrade head` as its own deploy step *before* starting new API processes. The application never creates or alters tables itself.
- Write migrations that can run while the previous API version is still serving (add, backfill, then switch, then remove), and give every migration a working `downgrade()`.

### Tests and the test database

- Tests use a separate database, `datapilot_test`, created by `docker/postgres/initdb/01-create-test-database.sh` the first time the container starts.
- The suite refuses any database whose name doesn't end in `_test`. While it runs, it points `DP_DATABASE_URL` and `DP_MIGRATION_DATABASE_URL` at the test database, so neither the app nor Alembic can reach your development data.
- Migration tests write throwaway revisions to a temp directory and clean up after themselves.
- If the test database isn't configured or reachable, the database tests **fail** with instructions; they are never silently skipped.

### Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `Cannot connect to the Docker daemon` / `failed to connect to the docker API` | Docker isn't running. Start Docker Desktop and retry. |
| `required variable POSTGRES_USER is missing a value` | No `.env` at the repo root. `cp .env.example .env` and set the password. |
| `Bind for 127.0.0.1:5432 failed: port is already allocated` | Another PostgreSQL is using 5432. Set `POSTGRES_PORT=5433` in `.env` and change the port in every `DP_*_URL` to match. |
| `password authentication failed for user "datapilot"` | The password in `.env` changed after the volume was created; PostgreSQL keeps the original. Restore the old password, or reset with `docker compose down -v` (deletes local data) and `docker compose up -d --wait postgres`. |
| Tests fail with `database "datapilot_test" does not exist` | The volume predates the init script. Run `docker compose exec postgres sh -c 'createdb -U "$POSTGRES_USER" "$POSTGRES_TEST_DB"'`. |
| Tests fail with `DP_TEST_DATABASE_URL is not set` / `Test database is unreachable` | Add `DP_TEST_DATABASE_URL` to `.env` (see `.env.example`) and make sure the container is up: `docker compose ps` should show `healthy`. |
| `/healthz/db` returns `{"database": "not_configured"}` | `DP_DATABASE_URL` is empty or missing in `.env`. |
| `uv sync --locked` fails with `The lockfile needs to be updated` | `pyproject.toml` changed without updating `uv.lock`. Run `uv lock`, review the diff, and commit both. |
| Every request returns `401 Unknown tenant 'acme'` | The database has no demo tenant. Run `uv run alembic upgrade head` and `uv run python -m app.cli seed-demo`. |
| `Migration 0003 needs a separate runtime user` / `Runtime user "datapilot_app" does not exist` | `.env` still has one user for everything. Add the app user and URLs from `.env.example` and run `02-create-app-role.sh` (see Run it). |
| Tests fail with `permission denied for table …` in your own new test | The app side of the tests runs as `datapilot_app`, by design. Use the `owner_session`/`owner_database` fixtures only for migration and constraint tests and cleanup. |
| `Can't locate revision identified by '…'` | The database was migrated from another branch whose migration files aren't in your checkout. Switch back and `alembic downgrade base`, or, for disposable dev data, `docker compose down -v`. |
| A migration fails with `canceling statement due to lock timeout` | Another transaction holds a lock on the table. Retry when it finishes, or raise `DP_DB_MIGRATION_LOCK_TIMEOUT_MS` for that run. |

## Calling it

**In dev**, requests act as a seeded member. By default that's Elena Vance (Administrator) in tenant `acme`. Pick someone else with headers:

```bash
curl localhost:8000/api/v1/me
curl -H 'X-DataPilot-User: u-marcus' localhost:8000/api/v1/me     # Organization Owner
curl -H 'X-DataPilot-User: u-lena'   localhost:8000/api/v1/me     # Analyst
```

These headers are only honoured in dev/test and only when no `Authorization` header is sent. In production a request needs an access token or an API key.

**Signing in (Stage 3B.1).** There's no self-service registration. An operator issues an invitation; the token is printed once and only its digest is stored:

```bash
uv run python -m app.cli invite-user --tenant acme --email jordan.lee@acme.io --role manager [--name "Jordan Lee"] [--title "Ops Lead"]
```

The person then sets a password and signs in (the browser does this; with curl, `Origin` must be in `DP_CORS_ORIGINS` and the refresh cookie needs https):

```bash
curl -X POST localhost:8000/api/v1/auth/invitations/accept -H 'Content-Type: application/json' \
     -d '{"token": "dpi_…", "password": "a long passphrase"}'                     # 204
curl -X POST localhost:8000/api/v1/auth/login -H 'Origin: http://localhost:5173' -H 'Content-Type: application/json' \
     -d '{"email": "jordan.lee@acme.io", "password": "a long passphrase"}'        # {"access_token": …, "expires_in": 900, …}
curl -H 'Authorization: Bearer <access_token>' localhost:8000/api/v1/me
```

`POST /auth/refresh` (refresh cookie + `X-CSRF-Token` + `Origin`) rotates the session; `POST /auth/logout` ends it.

**MFA (Stage 3B.2).** `POST /auth/mfa/enrollment` (email + password) returns a TOTP secret and `otpauth://` URI; `POST /auth/mfa/enrollment/confirm` (email + password + code) turns MFA on and returns ten recovery codes. From then on sign-in needs `"mfa_code"` (or `"recovery_code"`) too, and creating an API key needs a fresh `mfa_code`. In dev, the demo tenant requires MFA, so a newly invited member enrols before their first sign-in. Tokens, cookies, CSRF, rotation, reuse detection and key rotation are described in [docs/SECURITY.md](../docs/SECURITY.md).

**API keys** (for non-browser clients) are created at `POST /api/v1/api-keys` (the secret is returned once; stored as a peppered HMAC in PostgreSQL) and sent as `Authorization: Bearer dp_live_…`. Keys are read-only and limited to their scopes (`trust:read`, `connect:read`, …). `intelligence:query` may also POST questions.

Errors always look like `{"error": {"code": "forbidden", "message": "…", "details": {…}}}`.

## Layout

```
app/
  main.py            app factory, CORS, routers
  deps.py            authentication and permission dependencies
  tenant_data.py     one tenant's repositories + infrastructure
  seed.py            demo tenant
  core/              config, errors, clock, request context, db (engine, sessions, DbSession),
                     Table/InMemoryTable, SecretStore and JobQueue interfaces
  db/
    base.py          SQLAlchemy declarative Base + constraint naming convention
    models.py        imports every ORM model, so Base.metadata is complete for Alembic
    integrity.py     unique/foreign-key violations → domain errors (no DB details in responses)
  modules/<service>/
    schemas.py       Pydantic models (the API contract)
    repository.py    Protocol the service depends on + in-memory implementation
    service.py       business rules; writes audit events
    router.py        HTTP routes and their permission requirements
    models.py        ORM models (tenants, identity)
    persistence.py   PostgreSQL repositories (tenants, identity)
  modules/tenants/pg_tables.py     the Tenants service's Table interface on PostgreSQL (members, sessions, workspace)
  modules/tenants/permissions.py   permission catalog + deterministic level ↔ permission-set mapping
  modules/auth/      invitations, sign-in, refresh rotation, sign-out, access-token validation (service.py, router.py)
  core/security.py   Argon2id, opaque tokens, API-key HMAC, JWT issue/verify, keyrings
  core/readiness.py  production blockers checked at startup
  seed_postgres.py   demo tenant for PostgreSQL;  cli.py: seed-demo, check-db-privileges, invite-user
migrations/
  env.py             Alembic environment (URL from DP_* settings, one transaction, lock_timeout)
  versions/          migration scripts (0001_core_schema.py, 0002_tenants_persistence.py)
alembic.ini          Alembic configuration (no credentials)
```

Services receive a `RequestContext` (tenant, principal, repositories, IP) and never touch globals. That's what lets in-memory repositories be swapped for PostgreSQL ones without changing services or routes.

## What's implemented

| Service | Routes | Notes |
|---|---|---|
| Tenants | `/me`, `/members`, `/roles`, `/permissions`, `/sessions`, `/api-keys`, `/settings/security`, `/settings/organization` | Same rules as the Admin pages: no editing the Owner or yourself, seat limit from the plan, API key secrets hashed and shown once |
| Audit | `GET /audit-events?type=&q=&limit=&offset=` | Append-only, with no write endpoint. Every service records its own events |
| Connect | `/connect/connections`, `/connect/sync-runs` | Credentials go to the secret store and are never returned. Manual syncs are published to the job queue |
| Trust | `/trust/incidents`, `/trust/freshness`, `/trust/datasets/{dataset}/status` | The dataset status endpoint is the Trust gate other services use |
| Automate | `/automate/workflows`, `/automate/approvals`, `/automate/runs` | Approving returns 409 with the open Trust issues until `acknowledge_trust_warning` is sent; the acknowledgement is audited. Actions are queued for workers, never run in the API |
| Billing | `/billing/subscription`, `/billing/usage`, `/billing/plan-change` | Usage is read from Connect and the member list. Without billing rights a plan change becomes a request to the Owner |
| Notifications | `/notifications/preferences` | Preferences only; delivery workers aren't built yet |
| Insights, Intelligence | `/insights/*`, `/intelligence/*` | **Contract only: they return 501.** Port the logic from `src/features/insights` and `src/features/intelligence` next |

### Permissions

The tenant's permission matrix (Admin → Permissions) is enforced on every route:

- Reads need any level except "None" for the module.
- Writes need a specific level: "Full" to rotate credentials or resolve incidents, "Approve" to approve workflows, "Full" on *Billing & workspace deletion* to change plans or delete the workspace.
- User, key, security and settings management needs the Owner or Administrator role.

Approver job titles on workflows ("Finance Manager", "Operations Lead") are not enforced yet.

## Next steps

1. PostgreSQL repositories (SQLAlchemy + Alembic) behind the existing `Protocol`s, with tenant isolation.
2. Stage 3B.3: sign-in throttling and rate limits (shared, atomic counters in PostgreSQL). Later: MFA reset by an operator.
3. Port Insights and Intelligence, then switch the front end's mock stores to this API module by module.
4. Workers: ingestion (sync jobs), action execution and notification delivery, consuming the job queue.
