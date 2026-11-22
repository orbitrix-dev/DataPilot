"""Test-suite guard: application code must bind the tenant before it touches tenant-owned rows (Stage 4A).

Before every statement that reads or writes a tenant-owned table, the guard asks PostgreSQL, on the same connection,
whether ``app.tenant_id`` is set (``app/core/tenant_scope.py``). A statement sent by application code without it is
a violation, and the test that caused it fails, unless it is one of the documented lookups in ``ALLOWED``.

Why this matters beyond Stage 4A.1: once row-level security is on (4A.4), an unbound query doesn't fail, it silently
sees no rows. A production check reading every tenant (``readiness.tenant_blockers``) would then pass for the wrong
reason. This guard keeps such a path from being added unnoticed.

What counts as application code: the statement's call stack is walked outwards from the database driver. Its
*innermost* frame in ``app/`` names the code that sent it; the *outermost* frame in ``app/`` (before control returns
to test code) names the entry point. Statements whose entry point is a repository module are tests exercising that
repository directly with no unit of work around it; they are not checked here. Requests, services, the CLI and the
seed are.
"""

from __future__ import annotations

import re
import sys
import threading
from dataclasses import dataclass

# Tenant-owned tables (row-level security candidates, docs/DATABASE.md). refresh_tokens belongs to a tenant through its
# session; Stage 4A.2 gives it its own tenant_id.
TENANT_TABLES = (
    "roles",
    "role_permissions",
    "tenant_memberships",
    "tenant_settings",
    "user_sessions",
    "refresh_tokens",
    "api_keys",
    "invitation_tokens",
    "audit_events",
)
_TABLE_REF = re.compile(rf"\b(?:FROM|JOIN|INTO|UPDATE)\s+({'|'.join(TENANT_TABLES)})\b", re.IGNORECASE)

# Entry points that are repositories: called directly by repository tests (see module docstring).
_REPOSITORY_MODULES = ("app/modules/tenants/persistence.py", "app/modules/identity/persistence.py", "app/db/")

# Unbound reads that are unavoidable today: each finds the row that tells us the tenant. Stage 4A.3 replaces them with
# narrow SECURITY DEFINER lookups, and this list shrinks accordingly. Keyed by the function sending the statement.
ALLOWED: dict[str, str] = {
    "app/deps.py:_authenticate_api_key": "API key by digest: its tenant is what the lookup finds",
    "app/modules/auth/service.py:_active_memberships": "sign-in: the user's tenants, before one is chosen",
    "app/modules/auth/service.py:accept_invitation": "invitation by token digest: its tenant is what the lookup finds",
    "app/modules/auth/service.py:refresh": "refresh token by digest: its tenant is what the lookup finds",
    "app/modules/auth/service.py:session_for_refresh_token": "sign-out by refresh cookie: as above",
    "app/modules/auth/mfa.py:_audit_everywhere": "the user's tenants, to record a user-level event in each",
    "app/core/readiness.py:tenant_blockers": "production check over every tenant's settings (must not go blind)",
}
# Global security events (no tenant) are written by the security writer with no tenant bound, by design.
_GLOBAL_EVENT_WRITER = "app/modules/audit/security_writer.py:record"


@dataclass(frozen=True)
class Unbound:
    sender: str  # innermost app frame: the code that sent the statement
    entry: str  # outermost app frame: the entry point
    verb: str
    tables: tuple[str, ...]


def tenant_tables(statement: str) -> tuple[str, ...]:
    return tuple(sorted({t.lower() for t in _TABLE_REF.findall(statement)}))


def call_site(frame) -> tuple[str, str] | None:
    """(sender, entry point) in ``app/``, or None when no application code is on the stack."""
    sender = entry = None
    while frame is not None:
        filename = frame.f_code.co_filename
        if "/backend/tests/" in filename:
            break
        if "/backend/app/" in filename:
            name = f"app/{filename.split('/backend/app/', 1)[1]}:{frame.f_code.co_name}"
            sender = sender or name
            entry = name
        frame = frame.f_back
    return (sender, entry) if sender else None


def is_violation(unbound: Unbound, params: object) -> bool:
    """Whether an unbound statement breaks the rule (pure: unit-tested without a database)."""
    if unbound.entry.startswith(_REPOSITORY_MODULES):
        return False
    if unbound.sender in ALLOWED and unbound.verb == "SELECT":
        return False
    if unbound.sender == _GLOBAL_EVENT_WRITER and unbound.tables == ("audit_events",) and unbound.verb == "INSERT":
        return not (isinstance(params, dict) and params.get("tenant_id") is None)
    return True


class TenantContextGuard:
    def __init__(self) -> None:
        self.enabled = False
        self._lock = threading.Lock()
        self.violations: list[Unbound] = []
        self.allowed_seen: set[str] = set()

    def reset(self) -> None:
        with self._lock:
            self.violations.clear()
            self.allowed_seen.clear()

    def before_cursor_execute(self, conn, cursor, statement, parameters, context, executemany) -> None:
        if not self.enabled:
            return
        tables = tenant_tables(statement)
        if not tables:
            return
        site = call_site(sys._getframe(1))
        if site is None:
            return
        try:
            with cursor.connection.cursor() as probe:
                probe.execute("SELECT current_setting('app.tenant_id', true)")
                bound = probe.fetchone()[0]
        except Exception:  # noqa: BLE001 - an aborted transaction can't answer; the statement itself will fail
            return
        if bound:
            return
        unbound = Unbound(site[0], site[1], statement.split(None, 1)[0].upper(), tables)
        with self._lock:
            if is_violation(unbound, parameters):
                self.violations.append(unbound)
            elif unbound.sender in ALLOWED:
                self.allowed_seen.add(unbound.sender)

    def report(self) -> str:
        lines = sorted({f"{u.verb} {','.join(u.tables)} from {u.sender} (entry: {u.entry})" for u in self.violations})
        return "Tenant-owned rows touched with no tenant bound (app/core/tenant_scope.py):\n- " + "\n- ".join(lines)


GUARD = TenantContextGuard()
