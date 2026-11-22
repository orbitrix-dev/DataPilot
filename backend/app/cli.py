"""Operational commands. Run from backend/:

uv run python -m app.cli seed-demo            # load the demo tenant into PostgreSQL (idempotent; refused in prod)
uv run python -m app.cli check-db-privileges  # verify the runtime user's effective privileges (exit 1 on problems)
uv run python -m app.cli invite-user --tenant acme --email someone@acme.io --role analyst
                                              # issue a single-use invitation; prints the token ONCE
uv run python -m app.cli purge-auth-throttle  # delete stale abuse-protection counters (as the OWNER; schedule daily)
"""

import argparse
import sys
from datetime import datetime

from app.core.config import Settings
from app.core.db import Database


def seed_demo(settings: Settings) -> int:
    from app.seed_postgres import seed_demo as run

    if settings.env == "prod":
        print("Refusing to load demo data: DP_ENV=prod.", file=sys.stderr)
        return 2
    database = Database.from_settings(settings)
    if database is None:
        print("DP_DATABASE_URL is not set.", file=sys.stderr)
        return 2
    try:
        with database.session() as session:
            report = run(session)
    finally:
        database.dispose()
    created = ", ".join(f"{name} {count}" for name, count in report.created.items())
    state = "nothing new (already seeded)" if report.total_created == 0 else "created"
    print(f"Demo tenant 'acme' ({report.tenant_id}): {state}. Rows created: {created}.")
    return 0


def check_db_privileges(settings: Settings) -> int:
    """Connects with DP_DATABASE_URL and reports every deviation of that user from the least-privilege matrix."""
    from sqlalchemy.engine import make_url

    from app.db.privileges import runtime_role_problems

    database = Database.from_settings(settings)
    if database is None:
        print("DP_DATABASE_URL is not set.", file=sys.stderr)
        return 2
    role = make_url(settings.database_url.get_secret_value()).username
    try:
        with database.engine.connect() as conn:
            problems = runtime_role_problems(conn, role)
    finally:
        database.dispose()
    if problems:
        print(f"Runtime user {role!r} is NOT least-privilege:", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        return 1
    print(f"Runtime user {role!r}: effective privileges match the least-privilege matrix.")
    return 0


def invite_user(settings: Settings, args: argparse.Namespace) -> int:
    """Issues an invitation token for a new or password-less member. The token is printed once, to this terminal
    only; only its digest is stored. No password ever passes through the command line."""
    from app.core.errors import DomainError
    from app.modules.auth.service import issue_invitation

    database = Database.from_settings(settings)
    if database is None:
        print("DP_DATABASE_URL is not set.", file=sys.stderr)
        return 2
    try:
        with database.session() as session:
            issued = issue_invitation(
                session,
                settings,
                tenant_slug=args.tenant,
                email=args.email,
                role_key=args.role,
                full_name=args.name,
                title=args.title or "",
                issued_by=f"Operator CLI ({args.issued_by})" if args.issued_by else "Operator CLI",
            )
    except (DomainError, ValueError) as exc:
        print(f"Could not issue the invitation: {getattr(exc, 'message', exc)}", file=sys.stderr)
        return 1
    finally:
        database.dispose()
    print(f"Invitation for {issued.email} (member {issued.member_public_id}) in {issued.tenant_slug!r}.")
    print(f"Expires: {issued.expires_at:%Y-%m-%d %H:%M} UTC. Single use. Shown only once; it is not stored.")
    print("Give it to the user through a secure channel.")
    print("They choose their password with POST /api/v1/auth/invitations/accept.")
    print()
    print(issued.token)
    return 0


PURGE_BATCH = 10_000

# A row is deleted only when AuthThrottle.consume could no longer derive any state from it, using consume's own
# boundaries (app/modules/auth/throttle.py, _CONSUME):
#   - window over:        consume restarts the count when window_start <= now - window
#   - level forgotten:    consume resets block_level when blocked_until <= now - memory (which also means no block is
#                         active: consume refuses only while blocked_until > now)
#   - idle:               untouched for the cutoff (default: the memory period)
_PURGE = """
    DELETE FROM auth_throttle_buckets WHERE id IN (
        SELECT id FROM auth_throttle_buckets
         WHERE updated_at < CAST(:now AS timestamptz) - make_interval(hours => CAST(:idle_hours AS integer))
           AND window_start <= CAST(:now AS timestamptz) - make_interval(secs => CAST(:window AS double precision))
           AND (blocked_until IS NULL
                OR blocked_until <= CAST(:now AS timestamptz) - make_interval(hours => CAST(:memory AS integer)))
         ORDER BY updated_at
         LIMIT :batch)
"""


def purge_throttle_rows(database: Database, settings: Settings, *, idle_hours: int, at: datetime | None = None) -> int:
    """Deletes, in batches, the rows that carry no limiter state (see ``_PURGE``). Every batch uses the same reference
    time: ``at`` (tests of the exact boundaries) or the database clock read once at the start."""
    from sqlalchemy import text

    deleted = 0
    with database.session() as session:
        now = at or session.execute(text("SELECT statement_timestamp()")).scalar_one()
    params = {
        "now": now,
        "idle_hours": idle_hours,
        "window": settings.throttle_window_seconds,
        "memory": settings.throttle_block_memory_hours,
        "batch": PURGE_BATCH,
    }
    while True:
        with database.session() as session:
            batch = session.execute(text(_PURGE), params).rowcount
        deleted += batch
        if batch < PURGE_BATCH:
            return deleted


def purge_auth_throttle(settings: Settings, args: argparse.Namespace) -> int:
    """Deletes abuse-protection counters that carry no state the limiter would still use: the counting window has
    ended, and there was no block or its level is forgotten (DP_THROTTLE_WINDOW_SECONDS and
    DP_THROTTLE_BLOCK_MEMORY_HOURS, the boundaries ``AuthThrottle.consume`` uses), and the row is idle for
    ``--older-than-hours`` (default DP_THROTTLE_BLOCK_MEMORY_HOURS). The cutoff can only hold rows back: whatever its
    value, a count still in its window, an active block or a remembered block level is never deleted.
    Runs as the OWNER (DP_MIGRATION_DATABASE_URL): the runtime user has no DELETE on the table, by design. In batches,
    so it never holds long locks. Schedule it (e.g. daily); the table otherwise grows with distinct subjects."""
    if settings.migration_database_url is None:
        print("DP_MIGRATION_DATABASE_URL (the owner) is not set.", file=sys.stderr)
        return 2
    hours = settings.throttle_block_memory_hours if args.older_than_hours is None else args.older_than_hours
    if hours < 1:
        print("--older-than-hours must be at least 1.", file=sys.stderr)
        return 2
    database = Database(settings.migration_database_url.get_secret_value())
    try:
        deleted = purge_throttle_rows(database, settings, idle_hours=hours)
    finally:
        database.dispose()
    print(f"Deleted {deleted} abuse-protection counters idle for more than {hours} h and carrying no state.")
    return 0


def main(argv: list[str] | None = None, settings: Settings | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli", description="DataPilot operational commands")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("seed-demo", help="Load the demo tenant into PostgreSQL (idempotent; refused in prod)")
    commands.add_parser("check-db-privileges", help="Verify the runtime user's effective database privileges")
    invite = commands.add_parser("invite-user", help="Issue a single-use invitation to set a first password")
    invite.add_argument("--tenant", required=True, help="tenant slug, e.g. acme")
    invite.add_argument("--email", required=True)
    invite.add_argument("--role", required=True, choices=["owner", "admin", "manager", "analyst", "viewer"])
    invite.add_argument("--name", help="full name for a new user (defaults to one derived from the email)")
    invite.add_argument("--title", help="job title shown in Admin → Users")
    invite.add_argument("--issued-by", help="operator name, recorded in the audit event")
    purge = commands.add_parser("purge-auth-throttle", help="Delete stale abuse-protection counters (owner)")
    purge.add_argument("--older-than-hours", type=int, help="default: DP_THROTTLE_BLOCK_MEMORY_HOURS (24)")
    args = parser.parse_args(argv)
    if args.command == "seed-demo":
        return seed_demo(settings or Settings())
    if args.command == "check-db-privileges":
        return check_db_privileges(settings or Settings())
    if args.command == "invite-user":
        return invite_user(settings or Settings(), args)
    if args.command == "purge-auth-throttle":
        return purge_auth_throttle(settings or Settings(), args)
    return 1  # unreachable: argparse rejects unknown commands


if __name__ == "__main__":
    sys.exit(main())
