# DataPilot API

The FastAPI application backend from [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md). This is the skeleton: the structure, auth and permission model, and the product services the front end needs first. Storage is in memory, seeded with the same demo tenant the front end's mock data shows (Acme Global Corp, as of Fri Nov 20, 2026 14:32 UTC).

## Run it

Needs [uv](https://docs.astral.sh/uv/) (it installs Python 3.12 for you) and Docker (for PostgreSQL).

```bash
cp .env.example .env                      # at the repo root; change POSTGRES_PASSWORD and both DP_*_URLs to match
docker compose up -d --wait postgres      # PostgreSQL 18 on 127.0.0.1:5432, data in the datapilot-pgdata volume
cd backend
uv sync                                   # create .venv and install
uv run uvicorn app.main:app --reload --port 8000
```

- API: `http://localhost:8000/api/v1`
- Interactive docs: `http://localhost:8000/api/v1/docs`
- Liveness: `http://localhost:8000/healthz` (never touches the database)
- Database readiness: `http://localhost:8000/healthz/db` (`200` with latency, or `503` with `not_configured` / `unreachable`)

```bash
uv run pytest        # tests (need the postgres container running)
uv run ruff check .  # lint
uv run ruff format . # format
```

### Configuration

Read from `DP_*` environment variables, then the repo-root `.env` (shared with Docker Compose), then `backend/.env`. See `.env.example` for every variable. `.env` files are git-ignored; never commit real credentials.

| Variable | Default | Notes |
|---|---|---|
| `DP_ENV` | `dev` | `dev` \| `test` \| `prod` |
| `DP_DATABASE_URL` | none | `postgresql+psycopg://user:pass@host:5432/db`. **Required in prod.** Never printed: it's a `SecretStr` |
| `DP_DB_POOL_SIZE` / `DP_DB_MAX_OVERFLOW` | `5` / `10` | Per process. Keep `pool_size + max_overflow` × processes under the server's `max_connections` |
| `DP_DB_POOL_TIMEOUT_SECONDS` | `10` | Wait for a free pooled connection before failing with 503 |
| `DP_DB_POOL_RECYCLE_SECONDS` | `1800` | Replace connections older than this |
| `DP_DB_CONNECT_TIMEOUT_SECONDS` | `5` | |
| `DP_DB_STATEMENT_TIMEOUT_MS` | `15000` | Server-side cap per statement; `0` disables |
| `DP_CORS_ORIGINS`, `DP_API_PREFIX` | | |

### Database and transactions

`app/core/db.py` owns the engine (one connection pool per process, `pool_pre_ping` on) and gives each request one transaction through the `DbSession` dependency. **The transaction commits when the route returns, before the response is sent, and rolls back on any exception, including `DomainError`s.** A client is never told a write succeeded when its commit failed. Connection failures and timeouts become `503 {"error": {"code": "service_unavailable", …}}`, with details logged but never returned.

### Tests and the test database

Tests use a separate database, `DP_TEST_DATABASE_URL` (`datapilot_test`, created by `docker/postgres/initdb` the first time the container starts). The suite refuses any database whose name doesn't end in `_test`. While it runs, it points `DP_DATABASE_URL` at the test database, so a test can never reach your development data. If the test database isn't configured or reachable, the database tests **fail** with instructions rather than being skipped.

The init script only runs on an empty volume. If you created the volume before this script existed, create the test database once with `docker compose exec postgres sh -c 'createdb -U "$POSTGRES_USER" "$POSTGRES_TEST_DB"'`. `docker compose down -v` deletes all local database data.

## Calling it

**In dev**, requests act as a seeded member. By default that's Elena Vance (Administrator) in tenant `acme`. Pick someone else with headers:

```bash
curl localhost:8000/api/v1/me
curl -H 'X-DataPilot-User: u-marcus' localhost:8000/api/v1/me     # Organization Owner
curl -H 'X-DataPilot-User: u-lena'   localhost:8000/api/v1/me     # Analyst
```

These headers are refused when `DP_ENV=prod`. There is no user sign-in yet (SSO/JWT is the next step), so outside dev only API keys work.

**API keys** are created at `POST /api/v1/api-keys` (the secret is returned once) and sent as `Authorization: Bearer dp_live_…`. Keys are read-only and limited to their scopes (`trust:read`, `connect:read`, …). `intelligence:query` may also POST questions.

Errors always look like `{"error": {"code": "forbidden", "message": "…", "details": {…}}}`.

## Layout

```
app/
  main.py            app factory, CORS, routers
  deps.py            authentication and permission dependencies
  tenant_data.py     one tenant's repositories + infrastructure
  seed.py            demo tenant
  core/              config, errors, clock, request context,
                     Table/InMemoryTable, SecretStore and JobQueue interfaces
  modules/<service>/
    schemas.py       Pydantic models (the API contract)
    repository.py    Protocol the service depends on + in-memory implementation
    service.py       business rules; writes audit events
    router.py        HTTP routes and their permission requirements
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
2. Real sign-in (SSO/JWT) to replace the dev headers, plus session tracking and login audit events.
3. Port Insights and Intelligence, then switch the front end's mock stores to this API module by module.
4. Workers: ingestion (sync jobs), action execution and notification delivery, consuming the job queue.
