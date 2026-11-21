"""Verifies the runtime database user's EFFECTIVE privileges against the approved least-privilege matrix.

"Effective" means what PostgreSQL would actually allow, including privileges that come from ``PUBLIC``, from role
memberships (direct or inherited), from column-level grants, and from defaults (a NULL ACL means the built-in
defaults, e.g. EXECUTE on functions and CONNECT/TEMPORARY on databases for PUBLIC). It uses the
``has_*_privilege`` functions plus the catalogs (``pg_roles``, ``pg_auth_members``, ACL columns), not only the
grants a migration intended.

Used by the tests and by ``python -m app.cli check-db-privileges``.
"""

from sqlalchemy import text
from sqlalchemy.engine import Connection

TABLE_PRIVILEGE_TYPES = ("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER")
COLUMN_PRIVILEGE_TYPES = ("SELECT", "INSERT", "UPDATE", "REFERENCES")

# The approved matrix (docs/DATABASE.md). Any table not listed must grant the runtime user nothing.
RUNTIME_TABLE_PRIVILEGES: dict[str, frozenset[str]] = {
    "tenants": frozenset({"SELECT", "INSERT", "UPDATE"}),
    "tenant_settings": frozenset({"SELECT", "INSERT", "UPDATE"}),
    "users": frozenset({"SELECT", "INSERT", "UPDATE"}),
    "tenant_memberships": frozenset({"SELECT", "INSERT", "UPDATE", "DELETE"}),
    "roles": frozenset({"SELECT", "INSERT", "UPDATE"}),
    "role_permissions": frozenset({"SELECT", "INSERT", "DELETE"}),
    "permissions": frozenset({"SELECT"}),
    "user_sessions": frozenset({"SELECT", "INSERT", "UPDATE"}),
    "audit_events": frozenset({"SELECT", "INSERT"}),
    "alembic_version": frozenset({"SELECT"}),
    "api_keys": frozenset({"SELECT", "INSERT", "UPDATE"}),  # revocation and last_used_at are updates; no deletes
    "refresh_tokens": frozenset({"SELECT", "INSERT", "UPDATE"}),  # rotation marks used / revoked; no deletes
    "invitation_tokens": frozenset({"SELECT", "INSERT", "UPDATE"}),  # acceptance marks used; no deletes
}


def _rows(conn: Connection, sql: str, **params):
    return conn.execute(text(sql), params).all()


def runtime_role_problems(conn: Connection, role: str) -> list[str]:
    """Every way ``role`` deviates from least privilege in the current database. Empty means compliant."""
    problems: list[str] = []
    attrs = _rows(
        conn,
        "SELECT rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = :r",
        r=role,
    )
    if not attrs:
        return [f"role {role!r} does not exist"]
    for name, value in zip(("SUPERUSER", "CREATEROLE", "CREATEDB", "REPLICATION", "BYPASSRLS"), attrs[0], strict=True):
        if value:
            problems.append(f"role has {name}")

    # Memberships: direct ones, and every role whose privileges it can use (inherited, including predefined pg_*).
    for (granted,) in _rows(
        conn,
        "SELECT g.rolname FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid "
        "JOIN pg_roles u ON u.oid = m.member WHERE u.rolname = :r ORDER BY 1",
        r=role,
    ):
        problems.append(f"role is a member of {granted!r}")
    for (other,) in _rows(
        conn,
        "SELECT rolname FROM pg_roles WHERE rolname <> :r AND rolname <> 'public' "
        "AND pg_has_role(:r, oid, 'MEMBER') ORDER BY 1",
        r=role,
    ):
        problems.append(f"role can use the privileges of {other!r}")

    # Ownership of anything.
    owned = _rows(
        conn,
        "SELECT 'table ' || relname FROM pg_class WHERE relowner = CAST(:r AS regrole) "
        "UNION ALL SELECT 'function ' || proname FROM pg_proc WHERE proowner = CAST(:r AS regrole) "
        "UNION ALL SELECT 'schema ' || nspname FROM pg_namespace WHERE nspowner = CAST(:r AS regrole) "
        "UNION ALL SELECT 'database ' || datname FROM pg_database WHERE datdba = CAST(:r AS regrole)",
        r=role,
    )
    problems += [f"role owns {what}" for (what,) in owned]

    # Database: must be able to connect, must not create schemas or temporary tables.
    db = _rows(
        conn,
        "SELECT has_database_privilege(:r, current_database(), 'CONNECT'), "
        "has_database_privilege(:r, current_database(), 'CREATE'), "
        "has_database_privilege(:r, current_database(), 'TEMPORARY')",
        r=role,
    )[0]
    if not db[0]:
        problems.append("role cannot CONNECT to the database")
    if db[1]:
        problems.append("role can CREATE schemas in the database")
    if db[2]:
        problems.append("role can create TEMPORARY tables")

    # Schemas: no CREATE anywhere; USAGE on public.
    for (schema,) in _rows(
        conn,
        "SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema' "
        "AND has_schema_privilege(:r, oid, 'CREATE') ORDER BY 1",
        r=role,
    ):
        problems.append(f"role can CREATE in schema {schema!r}")
    if not _rows(conn, "SELECT has_schema_privilege(:r, 'public', 'USAGE')", r=role)[0][0]:
        problems.append("role lacks USAGE on schema public")

    # Tables (and views/sequences) in public: effective table-level and column-level privileges vs the matrix.
    for (table,) in _rows(
        conn,
        "SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r','p','v','m')",
    ):
        expected = RUNTIME_TABLE_PRIVILEGES.get(table, frozenset())
        for privilege in TABLE_PRIVILEGE_TYPES:
            has = _rows(conn, "SELECT has_table_privilege(:r, :t, :p)", r=role, t=f"public.{table}", p=privilege)[0][0]
            if has != (privilege in expected):
                problems.append(f"{table}: {privilege} is {'granted' if has else 'missing'}")
        for privilege in COLUMN_PRIVILEGE_TYPES:
            if privilege in expected:
                continue
            if _rows(conn, "SELECT has_any_column_privilege(:r, :t, :p)", r=role, t=f"public.{table}", p=privilege)[0][
                0
            ]:
                problems.append(f"{table}: column-level {privilege} is granted")
    for (seq,) in _rows(
        conn,
        "SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'S' "
        "AND (has_sequence_privilege(:r, oid, 'USAGE') OR has_sequence_privilege(:r, oid, 'UPDATE'))",
        r=role,
    ):
        problems.append(f"sequence {seq}: usable")

    # Functions in public: none should be executable by the runtime user (triggers fire without EXECUTE).
    for (fn,) in _rows(
        conn,
        "SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace "
        "AND has_function_privilege(:r, oid, 'EXECUTE') ORDER BY 1",
        r=role,
    ):
        problems.append(f"function {fn}: EXECUTE is granted")

    return problems + public_problems(conn)


def public_problems(conn: Connection) -> list[str]:
    """Privileges granted to PUBLIC (every role, present and future) in the current database. NULL ACLs are expanded
    to PostgreSQL's built-in defaults, so default grants count too."""
    problems = []
    for (privilege,) in _rows(
        conn,
        "SELECT a.privilege_type FROM pg_database d, aclexplode(coalesce(d.datacl, acldefault('d', d.datdba))) a "
        "WHERE d.datname = current_database() AND a.grantee = 0 ORDER BY 1",
    ):
        problems.append(f"PUBLIC has {privilege} on the database")
    for (privilege,) in _rows(
        conn,
        "SELECT a.privilege_type FROM pg_namespace n, aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a "
        "WHERE n.nspname = 'public' AND a.grantee = 0 ORDER BY 1",
    ):
        problems.append(f"PUBLIC has {privilege} on schema public")
    for table, privilege in _rows(
        conn,
        "SELECT table_name, privilege_type FROM information_schema.table_privileges "
        "WHERE grantee = 'PUBLIC' AND table_schema = 'public' ORDER BY 1, 2",
    ):
        problems.append(f"PUBLIC has {privilege} on {table}")
    for (fn,) in _rows(
        conn,
        "SELECT p.proname FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a "
        "WHERE p.pronamespace = 'public'::regnamespace AND a.grantee = 0 AND a.privilege_type = 'EXECUTE' ORDER BY 1",
    ):
        problems.append(f"PUBLIC has EXECUTE on function {fn}")
    return problems
