# Database schema (Stages 2A–3B.1)

PostgreSQL 16+ (developed on 18), managed only by Alembic (`backend/migrations/`). ORM models live in `backend/app/modules/*/models.py` and must match the migrations; `uv run alembic check` and `tests/test_core_migration.py` enforce it.

**Status (Stage 3B.1):**
- **On PostgreSQL:** the Tenants module (tenants, members, sessions, workspace settings, permission matrix, **API keys**), the **audit log**, and **authentication** (passwords, refresh-token families, invitations; see [SECURITY.md](SECURITY.md)). Request authentication resolves against it.
- **Unchanged:** API contracts, readable IDs (`acme`, `u-elena`, `sess-1`) and error messages. The one exception is audit event `id`s, which are now UUIDv7 strings.
- **Still in memory:** Connect, Trust, Automate, Billing and Notifications.
- **The application connects as a least-privilege runtime user**, `datapilot_app`. See [Database roles](#database-roles-stage-3a1).

> **Production is blocked.** The API refuses to start with `DP_ENV=prod` until audit retention, MFA and sign-in abuse protection exist and no tenant has `enforce_sso` set. See [Production blockers](#production-blockers).

## Entity relationships

```mermaid
erDiagram
  tenants ||--o{ roles : "defines (5 system roles each)"
  tenants ||--o{ tenant_memberships : has
  users   ||--o{ tenant_memberships : "belongs to many tenants"
  roles   ||--o{ tenant_memberships : "assigned (same tenant only)"
  roles   ||--o{ role_permissions : grants
  permissions ||--o{ role_permissions : "granted via"
  tenant_memberships ||--o{ user_sessions : "signs in as"

  tenants ||--|| tenant_settings : "has (1:1)"
  tenant_settings {
    uuid tenant_id PK "FK"
    varchar industry
    varchar timezone
    int audit_retention_days "90 | 365"
    bool require_mfa
    bool enforce_sso
    int session_timeout_hours "1 | 8 | 12 | 24"
  }
  tenants {
    uuid id PK
    varchar slug UK "url-safe, permanent; the API's tenant id"
    timestamptz deletion_scheduled_for
    varchar name
    varchar status "active | suspended | deleted"
    timestamptz deleted_at "set iff status = deleted"
    timestamptz created_at
    timestamptz updated_at
  }
  users {
    uuid id PK
    varchar public_id UK "the API's member id: u-elena"
    timestamptz mfa_enrolled_at "Member.mfa = enabled if set"
    varchar email UK "trimmed + lower-cased (enforced)"
    varchar full_name
    varchar password_hash "argon2id only; NULL until auth"
    varchar status "active | disabled"
    timestamptz email_verified_at
    timestamptz created_at
    timestamptz updated_at
  }
  tenant_memberships {
    uuid id PK
    uuid tenant_id FK
    uuid user_id FK
    uuid role_id "FK (tenant_id, role_id)"
    varchar membership_status "invited | active | suspended"
    varchar title
    timestamptz joined_at "NULL iff invited"
    timestamptz last_active_at
    inet last_active_ip
    timestamptz created_at
    timestamptz updated_at
  }
  roles {
    uuid id PK
    uuid tenant_id FK
    varchar key "unique per tenant"
    varchar name
    text description
    bool is_system
    timestamptz created_at
    timestamptz updated_at
  }
  permissions {
    varchar code PK "e.g. connect:read"
    varchar module
    text description
  }
  role_permissions {
    uuid tenant_id "FK (tenant_id, role_id)"
    uuid role_id PK
    varchar permission_code PK "FK"
    timestamptz created_at
  }
  user_sessions {
    uuid id PK
    varchar public_id UK "the API's session id: sess-1"
    uuid tenant_id "FK (tenant_id, user_id)"
    uuid user_id
    bytea token_hash UK "32-byte digest"
    timestamptz created_at
    timestamptz last_seen_at
    timestamptz expires_at
    timestamptz revoked_at
    varchar revoked_reason "set iff revoked"
    varchar device "nullable"
    inet ip "nullable"
    varchar location "nullable"
    varchar user_agent "nullable"
  }
```

## Tables

| Table | Owner | Key constraints |
|---|---|---|
| `tenants` | global | `UNIQUE (slug)`; slug format; non-blank name; status list; `(status = 'deleted') = (deleted_at IS NOT NULL)` |
| `users` | global | `UNIQUE (email)`; `email = lower(btrim(email))`; email format; `password_hash` NULL or Argon2id; status list |
| `permissions` | global catalog | `PRIMARY KEY (code)`; code format. Rows come from migrations |
| `roles` | tenant | `UNIQUE (tenant_id, key)`; `UNIQUE (tenant_id, id)` (target of composite FKs); key format |
| `role_permissions` | tenant | `PRIMARY KEY (role_id, permission_code)`; FK `(tenant_id, role_id) → roles`; FK `permission_code → permissions` |
| `tenant_memberships` | tenant | `UNIQUE (tenant_id, user_id)`; FK `(tenant_id, role_id) → roles (tenant_id, id)`; `(membership_status = 'invited') = (joined_at IS NULL)` |
| `tenant_settings` | tenant (1:1) | `PRIMARY KEY (tenant_id)`, FK → tenants (`RESTRICT`); retention `IN (90, 365)`; timeout `IN (1, 8, 12, 24)`; non-blank industry/timezone (their allowed values are validated by the API) |
| `user_sessions` | tenant | `UNIQUE (token_hash)`, exactly 32 bytes; FK `(tenant_id, user_id) → tenant_memberships`; `expires_at > created_at`; revocation needs a reason. Since 3B.1 a session is a refresh-token family |
| `api_keys` (0005) | tenant | `UNIQUE (public_id)`; `UNIQUE (secret_hash)`, exactly 32 bytes (HMAC-SHA256); `pepper_version`; scopes non-empty and from the five API scopes; `UNIQUE (tenant_id, lower(name)) WHERE revoked_at IS NULL`; FK tenant `RESTRICT`; creator/revoker `SET NULL`; `expires_at > created_at` |
| `refresh_tokens` (0005) | via session | `UNIQUE (token_hash)`, 32 bytes; FK session `CASCADE`; `parent_id` (the token it replaced) `SET NULL`; `UNIQUE (session_id) WHERE used_at IS NULL AND revoked_at IS NULL` (one live token per family); `expires_at > issued_at` |
| `invitation_tokens` (0005) | tenant | `UNIQUE (token_hash)`, 32 bytes; FK `(tenant_id, user_id) → tenant_memberships` `CASCADE`; `UNIQUE (tenant_id, user_id) WHERE used_at IS NULL AND revoked_at IS NULL`; `expires_at > created_at` |

Indexes beyond keys: `tenant_memberships (user_id)` (a user's tenants), `tenant_memberships (tenant_id, role_id)` (members per role; RESTRICT checks), `role_permissions (tenant_id)`, `role_permissions (permission_code)`, `user_sessions (tenant_id) WHERE revoked_at IS NULL` (active sessions), `user_sessions (user_id)`.

### Delete behaviour

| Relationship | Rule | Why |
|---|---|---|
| tenant → roles, memberships | `RESTRICT` | Tenants are soft-deleted (`status = 'deleted'`, `deleted_at`); purging is a deliberate job, never a cascade |
| user → memberships | `RESTRICT` | Removing a person is explicit |
| role → memberships | `RESTRICT` | An assigned role can't be deleted |
| role → role_permissions | `CASCADE` | Grants belong to their role |
| permission → role_permissions | `RESTRICT` | Retire a permission only after revoking it everywhere |
| membership → sessions | `CASCADE` | Losing access ends sessions |

### Conventions

- Primary keys are UUIDv7, generated by the application, which keeps indexes compact. `gen_random_uuid()` is the server default for raw SQL inserts. A UUIDv7 reveals its creation time, so ids are never secrets.
- All timestamps are `timestamptz`.
- Statuses are `varchar` + `CHECK`, not PostgreSQL enums, because enums are awkward to change in migrations.
- Constraint names follow the `Base` naming convention (`pk_`, `fk_`, `uq_`, `ck_`, `ix_` + table + columns).
- `updated_at` is maintained by the ORM. Raw SQL updates must set it themselves.

## Readable IDs (Stage 2B)

Database UUIDs never appear in the API. The readable IDs the API has always used map like this:

| API id | Column | Notes |
|---|---|---|
| tenant `acme` | `tenants.slug` | `RequestContext.tenant_id` stays the slug (secret references and job messages use it); the UUID is `RequestContext.tenant_uuid` |
| member `u-elena` | `users.public_id` | Global, so one person keeps one id across tenants. New invitations get `u-` + 10 hex, as before |
| session `sess-1` | `user_sessions.public_id` | |
| role `admin` | `roles.key` | Unchanged |

Migration `0002` backfilled these for existing rows. The 12 demo users get their known ids from a frozen email map; everyone else gets `u-`/`sess-` + their UUID's 32 hex digits (stable, and unique because the UUID is).

## Tenant settings (Stage 2B)

Exactly what Admin → Organization and Admin → Security edit through the existing API: industry, reporting timezone, audit retention, Require MFA, Enforce SSO, session timeout. The organization name is `tenants.name` and the deletion schedule is `tenants.deletion_scheduled_for`. Every tenant has exactly one row: `PostgresTenantRepository.create` writes it, and migration `0002` backfilled tenants that existed before it with these documented defaults (all valid for the API): `Wholesale & Distribution`, `UTC`, 365 days, MFA off, SSO off, 12 hours.

## Request context and the persistence boundary (Stage 2B)

```
X-DataPilot-Tenant / X-DataPilot-User (dev only)  or  Bearer dp_live_… (API key, matched in memory)
  → tenant by slug:  unknown or deleted → 401 "Unknown tenant '<slug>'";  suspended → 403 "This workspace is suspended"
  → (dev headers) member by public id: only an active membership of an active user; else 401 "Unknown or inactive user"
  → TenantData for this request:
        tenants   = PostgreSQL adapters bound to (request DbSession, tenant UUID)   ← members, sessions, workspace, matrix
        audit     = commit-gated buffer over the in-memory audit log
        the rest  = the in-memory registry entry for the slug (no entry → 401: fail closed)
  → tenants/service.py (unchanged apart from one line), through the same Table interface as before
```

- **One transaction per request.** `get_ctx` and the route share the request's `DbSession`: it commits before the response, and rolls back on any error.
- **Audit events are published only after COMMIT succeeds**, and are dropped on rollback (`CommitGatedAuditRepository`). This orders the two stores; it doesn't make them atomic. A crash between COMMIT and publishing would lose those events. A transactional audit table/outbox is a later stage.
- **Suspended memberships** aren't representable in the API's `Member` model, so they're excluded from member listings, role counts and Billing's seat count, and they can't authenticate. Active and invited members behave exactly as before.
- **Session revocation** (`DELETE /sessions/{id}`) sets `revoked_at` and `revoked_reason`, and keeps the row. **Removing a member** deletes the membership, and its sessions go with it (`ON DELETE CASCADE`, the existing "revoke access and end their sessions" behaviour).

## Roles and permissions

Each tenant has its own copy of the five system roles: Organization Owner, Administrator, Business Manager, Analyst and Viewer. Each tenant can therefore edit its own permission matrix. `permissions` is a global catalog of 17 codes; `role_permissions` holds the grants.

The Admin → Permissions page speaks *levels* per capability. `app/modules/tenants/permissions.py` maps levels to permission sets with a fixed table:

| Capability | Levels → permissions |
|---|---|
| connect | Full = {connect:read, connect:write} · Read = {connect:read} · None = {} |
| trust | Full = {trust:read, trust:rules, trust:write} · Edit Rules = {trust:read, trust:rules} · View = {trust:read} · None = {} |
| insights | Full = {insights:read, insights:export, intelligence:query} · View Only = {insights:read, intelligence:query} · None = {} |
| automate | Approve = {automate:read, automate:draft, automate:approve} · Draft Only = {automate:read, automate:draft} · None = {} |
| admin | Full = {billing:manage, workspace:delete} · None = {} |

- **Deterministic:** a set maps back to the level whose set is *exactly* equal. At import, the module verifies that no two levels share a set, so the reverse mapping is a bijection.
- **Rejecting:** any other combination raises `UnsupportedPermissionSet` and is never rounded to a nearby level. So does a role holding a permission it can't have, or missing a fixed one. Nothing is written when validation fails.
- **Behaviour-preserving:** every Insights and Intelligence route currently needs only a non-"None" Insights level, so View Only includes `intelligence:query`. The demo matrix round-trips exactly (tested).
- **Fixed role permissions:** `members:manage`, `api_keys:manage`, `settings:manage` and `audit:read` belong to Owner and Administrator, mirroring today's `admins()` rule. They aren't editable in the matrix. The `admins()` route checks themselves are unchanged in this stage.

## Tenant isolation

1. **Schema.** Every tenant-owned table carries `tenant_id`. References between tenant-owned rows use composite foreign keys that include it: membership → role, grant → role, session → membership. A row pointing at another tenant's role or membership is rejected by PostgreSQL itself, even from raw SQL (tested).
2. **Repositories** (`app/modules/*/persistence.py`):
   - Tenant-scoped repositories (`PostgresRoleRepository`, `PostgresMembershipRepository`, `PostgresSessionRepository`) are constructed with the tenant id of the authenticated request, never one from client input.
   - Every query filters by it, and every write takes `tenant_id` from it.
   - Another tenant's id raises the same `NotFound` as a missing id, without hinting that the row exists elsewhere, so ids can't be probed (no IDOR).
   - Global repositories (`PostgresTenantRepository`, `PostgresUserRepository`, `PostgresPermissionCatalogRepository`) are separate.
3. **Row-level security: not enabled.** It's evaluated and deferred because:
   - the API connects as the table owner, and owners bypass RLS unless `FORCE ROW LEVEL SECURITY` is set;
   - it needs a per-transaction `SET LOCAL app.tenant_id` from the authenticated context, which doesn't exist until authentication;
   - login (listing a user's tenants) and the seed legitimately cross tenants and need a controlled bypass.

   The schema is ready for it (`tenant_id` on every tenant-owned table, including `role_permissions`). The plan is a least-privilege application role plus forced RLS policies, once authentication provides the tenant context.
4. **Errors.** Expected integrity violations (duplicates, missing parents) become domain errors (`409`, `404`). Database messages and constraint names never reach responses (tested).

## Credentials

- `users.password_hash` accepts only Argon2id strings (`CHECK`). It's NULL until the user accepts an invitation; only `auth.service.accept_invitation` sets it (and sign-in re-hashes it when Argon2 parameters change).
- `user_sessions.token_hash`, `refresh_tokens.token_hash` and `invitation_tokens.token_hash` accept only 32-byte SHA-256 digests; `api_keys.secret_hash` only a 32-byte HMAC-SHA256. No raw token or key is stored.
- `ip` is `INET`: invalid values are rejected rather than stored as free text.
- The demo seed creates no passwords and no sessions.

## Migrations

- `0001_core_schema` creates everything above and inserts the permission catalog. The catalog rows are a frozen copy in the migration, because migrations must not import app code; a test checks they match `permissions.py`.
- `0005_identity_foundation` (Stage 3B.1) creates `api_keys`, `refresh_tokens` and `invitation_tokens` and grants the runtime user `SELECT, INSERT, UPDATE` on them (no `DELETE`: keys are revoked, tokens are marked used/revoked). **Rollback:** its downgrade drops the three tables, which deletes every API key (integrations stop authenticating), every refresh token (everyone is signed out at their next refresh) and every outstanding invitation. Sessions and passwords are in pre-existing tables and survive. Downgrade 0005 only together with the 3B.1 code.
- Downgrade drops every table, which deletes all data. Use it in development and CI only.
- Commands, transaction behaviour and the deployment rule are in [backend/README.md](../backend/README.md#migrations-alembic).

## Demo seed

```bash
cd backend
uv run alembic upgrade head
uv run python -m app.cli seed-demo
```

- **Contents:** Acme Global Corp (`acme`) and its settings, 12 users with their readable ids, MFA state and memberships (titles, last activity), the five roles with today's permission matrix, and the 4 demo sessions. All of it comes from `app/seed.py`.
- **Idempotent; never overwrites edits:**
  - Rows are inserted with `ON CONFLICT DO NOTHING` on natural keys (slug, email, tenant + role key, tenant + user, session id).
  - Columns added in 0002 (MFA, last activity) are filled only where still NULL.
  - Tenant settings are replaced only while they still hold the exact 0002 backfill defaults.
  - Session digests are never replaced.
- **Demo sessions can't authenticate.** Each stores the SHA-256 of a fresh random token that's discarded immediately. They're listed for 30 days after seeding (`expires_at`).
- **The API needs it.** With Tenants on PostgreSQL, the API serves the demo only after `alembic upgrade head` and `seed-demo`. Until then, dev requests get `401 Unknown tenant 'acme'`.
- **Never in production:** the command refuses to run when `DP_ENV=prod`. It isn't part of migrations.


## Audit log (Stage 3A.1)

```mermaid
erDiagram
  tenants |o--o{ audit_events : "records (NULL tenant = global/security event)"
  audit_events {
    uuid id PK "UUIDv7 from the application, no DB default"
    uuid tenant_id FK "NULL for global events; ON DELETE RESTRICT"
    timestamptz occurred_at
    varchar action "e.g. user.invited"
    varchar category "generated: split_part(action, '.', 1)"
    varchar actor_type "user | api_key | system | anonymous"
    varchar actor_id "readable public id, NOT a foreign key"
    varchar actor_label "display-name snapshot"
    varchar resource_type
    varchar resource_id
    text summary
    inet ip_address "validated IPs only"
    varchar client_label "non-IP identifiers, e.g. testclient"
    jsonb metadata "allowlisted per action"
  }
```

- **Indexes:**
  - `(tenant_id, occurred_at DESC, id)` for the list;
  - `(tenant_id, category, occurred_at DESC, id)` for `?type=`;
  - partial `occurred_at DESC WHERE tenant_id IS NULL` for global events.
- **CHECKs:** action format; category among the 8 API types; the actor id is required unless `system`/`anonymous`; a resource id needs a type; never both `ip_address` and `client_label`; metadata is a JSON object of at most 8 KB; no API-key secret in `summary` or `metadata`.
- **API mapping:**
  - `type` is the category, `event` is the action's registry label, `actor` is `actor_label`, `detail` is `summary`, `ip` is the address or client label, `target` is `resource_type[:resource_id]`.
  - The list is newest first, with equal times in insertion order.
  - The API never returns another tenant's events or global events.

### Append-only

| Layer | Protects against |
|---|---|
| Repository has only `append` and `search` | Ordinary code paths |
| `datapilot_app` has only `SELECT, INSERT` on `audit_events` | A compromised or buggy app: `permission denied` for UPDATE, DELETE and TRUNCATE |
| Trigger `audit_events_append_only` / `audit_events_no_truncate` | Everyone, the owner included. Only the owner can deliberately disable it (not covered: that would need off-database or write-once storage) |
| `tenant_id` FK with `ON DELETE RESTRICT` | Tenant deletion silently cascading into, or nulling, audit history |

### Action registry and guarantees

`backend/app/modules/audit/actions.py` lists every action (21) with a label, a metadata allowlist and three declarations:

| Declaration | Values | Meaning |
|---|---|---|
| `business_store` | `postgres` / `memory` | where the state the event describes lives |
| `durability` | `durable` / `transitional` | durable: the change and its event commit or roll back together. Transitional: see below |
| `production_enabled` | true / false | production may perform the action. Memory-backed actions are always false |

**PostgreSQL-backed actions (12 Tenants actions): atomic.** The event is written in the request's own transaction. A rollback or failed commit leaves neither the change nor the event.

**Memory-backed actions (8): transitional. They are not atomic, and their business state is not durable.** They are `api-key.created` and `api-key.revoked` (keys are in memory until 3A.2), `workflow.approved`/`rejected`, `billing.plan_changed`/`plan_change_requested`, `connection.credential_rotated` and `settings.notifications_changed`. Each of them, tested:
1. **No phantom success events:** the event is written after the in-memory change succeeds, and stored only if the request commits.
2. **Events can be missing:** if the request fails after the in-memory change, the change remains without its event.
3. **The change isn't durable:** after a restart the in-memory change is gone; its event remains.

They work in development and testing. In production, recording them is refused, and startup fails if any of them is marked production-enabled. An action becomes `postgres`/`durable`/production-enabled only when its module moves to PostgreSQL and its atomicity tests pass.

**Keeping credentials out of audit records** (`backend/app/modules/audit/sanitize.py`). There are three layers:

1. **Metadata allowlists (primary):** each action names its exact keys and types. Anything else is rejected, not silently dropped. Validation errors name the key and type, never the value.
2. **Redaction (secondary):** applied to every free-text field (summary, resource id, actor label, client label, metadata strings). It keeps the surrounding context.

   | Format | Example result |
   |---|---|
   | PEM private keys (including truncated blocks) | `[REDACTED]` |
   | URLs with a password | `postgresql://app:[REDACTED]@db.internal/prod` (user and host kept) |
   | `password=` / `secret:` / `token=` / `api_key=` / `aws_secret_access_key=`-style pairs | `password=[REDACTED]` (key name kept) |
   | `Bearer …` | `[REDACTED]` |
   | JWTs (`eyJ…`) | `[REDACTED]` |
   | AWS access key ids (`AKIA…`, `ASIA…`, …) | `[REDACTED]` |
   | GitHub / GitLab / Slack / Google / Stripe tokens | `[REDACTED]` |
   | DataPilot API-key secrets, Argon2 hashes, standalone 32+ hex strings | `[REDACTED]` |

   **Deliberately kept:** names, emails, masked key prefixes (`dp_live_••••9f2a`), UUIDs, and readable ids such as `u-<32 hex>` / `sess-<32 hex>`. The long-hex rule ignores hex that is part of an identifier.
3. **Database CHECKs (last line, migration `0004`):** reject API-key secrets, PEM private keys, AWS access key ids, JWTs and unredacted URL passwords in `summary`, `resource_id`, `actor_label`, `client_label` and `metadata`.

**Limits:**
- Regex redaction can't recognise an arbitrary secret with no recognisable shape, such as a password typed into a name field. The allowlists, and keeping raw user input out of audit text, are the real protection.
- A standalone 40-character AWS *secret* key is only caught in `key=value` form.

**Logs:**
- Database engines use `hide_parameters=True`, so bound values never appear in SQLAlchemy errors.
- Database errors are logged as error class, SQLSTATE, constraint, table and code location. PostgreSQL's own message isn't logged, because it can contain the rejected row (`DETAIL: Failing row contains …`).
- Unexpected database errors still return the plain `500 Internal Server Error` they always did.

### Security events that must survive a failed request

`SecurityAuditWriter` (`backend/app/modules/audit/security_writer.py`) writes events such as a rejected API key in an **independent transaction**, on its **own two-connection pool**, and commits immediately. It survives the request's rollback, and it never raises: failures are logged without the event's contents. It's built and tested, but **not wired into any request path yet.** Stage 3B connects it to rejected keys and failed sign-ins together with rate limiting, so unauthenticated floods can't fill the log.

### Client addresses and IP data

- **`X-Forwarded-For`** is honoured only when the direct peer is in `DP_TRUSTED_PROXIES` (empty by default, so it's never trusted).
  - The chain is walked right to left, skipping trusted proxies; the first untrusted address is the client.
  - A malformed chain (non-IP entries, ports, empty entries, more than 32 hops, over 2 KB) is ignored entirely.
  - `Forwarded` and `X-Real-IP` are ignored.
- **Storage:** IPs go in `ip_address` (INET), anything else in `client_label`.
- **IP addresses, names and emails in audit records are personal data.** They're kept until retention is enforced (see below).

### Retention: NOT enforced

Tenants have an `audit_retention_days` setting (90 or 365). **It is stored but not enforced**: nothing purges expired events yet. Purging needs a dedicated owner-run procedure, because the runtime user can't delete audit rows and the trigger blocks deletes for everyone. Until that exists and is tested, production is blocked.

## Database roles (Stage 3A.1)

| | Owner (e.g. `datapilot`) | Runtime (`datapilot_app`) |
|---|---|---|
| Used through | `DP_MIGRATION_DATABASE_URL`: Alembic, test fixtures, test cleanup | `DP_DATABASE_URL`: the API, `seed-demo`, the app side of every test |
| Owns | every table, function and trigger | **nothing** (verified by `0003` and by tests) |
| Attributes | | `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`; `USAGE` on schema `public`, no `CREATE` |

The two must be **different users in every environment.** Migration `0003` refuses a single-user setup.

| Table | SELECT | INSERT | UPDATE | DELETE | Why |
|---|:-:|:-:|:-:|:-:|---|
| `tenants` | ✓ | ✓ | ✓ | | soft delete only |
| `tenant_settings` | ✓ | ✓ | ✓ | | |
| `users` | ✓ | ✓ | ✓ | | no code path deletes users |
| `tenant_memberships` | ✓ | ✓ | ✓ | ✓ | revoking a member deletes the membership |
| `roles` | ✓ | ✓ | ✓ | | |
| `role_permissions` | ✓ | ✓ | | ✓ | matrix edits delete removed grants |
| `permissions` | ✓ | | | | catalog managed by migrations; the seed never writes it |
| `user_sessions` | ✓ | ✓ | ✓ | | revocation sets `revoked_at`; deletes only cascade from memberships |
| `audit_events` | ✓ | ✓ | | | append-only. No TRUNCATE, TRIGGER or REFERENCES |
| `alembic_version` | ✓ | | | | schema-revision reporting |

- **Owner rights for referential actions:** cascades (a membership delete removing its sessions) and foreign-key checks (`role_permissions` → `permissions`) run with the table owner's rights. The runtime user needs neither `DELETE` on `user_sessions` nor `REFERENCES` on `permissions`. Both are tested.
- **No default privileges:** a new table gets nothing until its migration grants it.

### Effective privileges and `PUBLIC` (migration 0004)

The matrix above is the runtime user's complete **effective** access. Migration `0004` makes that true on fresh and existing databases alike, and `python -m app.cli check-db-privileges` verifies it (exit code 1 on any deviation). The command is also covered by tests.

| Check | Expected |
|---|---|
| Role attributes | no SUPERUSER, CREATEROLE, CREATEDB, REPLICATION or BYPASSRLS |
| Role memberships, direct or inherited (`pg_auth_members`, `pg_has_role`), including predefined `pg_*` roles | **none.** `0004` refuses to run otherwise |
| Ownership (tables, functions, schemas, databases) | none |
| Database | `CONNECT` granted explicitly; **no `CREATE` and no `TEMPORARY`** (no temporary tables) |
| Schemas | `USAGE` on `public` only; `CREATE` nowhere |
| Tables | exactly the matrix, checked with `has_table_privilege` for all seven privilege types plus column-level grants; any other table grants nothing |
| Functions | no `EXECUTE` (triggers fire without it) |
| `PUBLIC` | **no privileges** on the database, schema `public`, any table or any function. NULL ACLs are counted as PostgreSQL's built-in defaults |

**What `0004` changed relative to 0003:**
- PostgreSQL's defaults had given `PUBLIC` `CONNECT` and `TEMPORARY` on the database, `USAGE` on `public`, and `EXECUTE` on new functions. As a result, the runtime user could create temporary tables.
- `0003` only ever added grants, so a privilege granted by hand earlier survived it.
- `0004` revokes everything, then re-grants exactly the matrix.

**Operational assumptions:**
- **Database ownership:** the migration user owns the database (or is a superuser), which revoking `PUBLIC` database privileges requires.
- **Other roles:** any other role that used to connect through `PUBLIC` now needs an explicit `GRANT CONNECT`.
- **Role administration:** a runtime user with memberships or elevated attributes must be fixed by whoever administers roles; `0004` stops and says so rather than silently changing roles.

**Recommended for production PostgreSQL:** `log_error_verbosity = terse`, so the server log omits the `DETAIL` lines that can contain row values.

## UUIDv7 everywhere (Stage 3A.1)

- **Application only:** every id is a UUIDv7 generated by the application.
- **No database default:** migration `0003` dropped the `gen_random_uuid()` (UUIDv4) defaults `0001` had put on `tenants`, `users`, `roles`, `tenant_memberships` and `user_sessions`, and `audit_events` never had one. An insert without an id fails instead of silently getting a v4 id (tested).
- **Seed:** demo audit events use **deterministic** UUIDv7s (the event's time + a fixed label), which keeps seeding idempotent.
- **Downgrade:** downgrading `0003` restores the original defaults.

## Production blockers

`backend/app/core/readiness.py` runs at startup with `DP_ENV=prod` and refuses to start while any of these hold. Each is derived from the code itself; there's **no configuration switch** to bypass them:
1. **Audit retention is not enforced** (`audit.retention.is_enforced()` is false).
2. **An action is production-enabled while memory-backed or transitional.**
3. **Sign-in abuse protection is not implemented** (`auth.enforcement.abuse_protection_enforced()`; Stage 3B.3).
4. **An active tenant requires MFA** while MFA is not implemented (`auth.enforcement.mfa_enforced()`; Stage 3B.2). Read from `tenant_settings` at startup.
5. **An active tenant has `enforce_sso` set.** SSO is not implemented; the setting is stored but password sign-in still works, so it must not reach production silently.
