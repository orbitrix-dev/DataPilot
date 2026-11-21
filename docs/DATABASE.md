# Database schema (Stages 2A–2B)

PostgreSQL 16+ (developed on 18), managed only by Alembic (`backend/migrations/`). ORM models live in `backend/app/modules/*/models.py` and must match the migrations; `uv run alembic check` and `tests/test_core_migration.py` enforce it.

**Status (Stage 2B):** the **Tenants module runs on PostgreSQL**: tenants, members, sessions, workspace settings and the permission matrix. Request authentication (dev headers, and API keys' tenants) resolves against it. API contracts, readable IDs (`acme`, `u-elena`, `sess-1`) and error messages are unchanged. **Still in memory:** API keys, Connect, Trust, Automate, Billing, Notifications and the audit log.

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
| `user_sessions` | tenant | `UNIQUE (token_hash)`, exactly 32 bytes; FK `(tenant_id, user_id) → tenant_memberships`; `expires_at > created_at`; revocation needs a reason |

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

- `users.password_hash` accepts only Argon2id strings (`CHECK`), and stays NULL until authentication exists. Repositories have no password setter yet.
- `user_sessions.token_hash` accepts only 32-byte digests (`CHECK`). The repository refuses anything else.
- `ip` is `INET`: invalid values are rejected rather than stored as free text.
- The demo seed creates no passwords and no sessions.

## Migrations

- `0001_core_schema` creates everything above and inserts the permission catalog. The catalog rows are a frozen copy in the migration, because migrations must not import app code; a test checks they match `permissions.py`.
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
