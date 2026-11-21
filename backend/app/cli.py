"""Operational commands. Run from backend/:

uv run python -m app.cli seed-demo            # load the demo tenant into PostgreSQL (idempotent; refused in prod)
uv run python -m app.cli check-db-privileges  # verify the runtime user's effective privileges (exit 1 on problems)
uv run python -m app.cli invite-user --tenant acme --email someone@acme.io --role analyst
                                              # issue a single-use invitation; prints the token ONCE
"""

import argparse
import sys

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
    args = parser.parse_args(argv)
    if args.command == "seed-demo":
        return seed_demo(settings or Settings())
    if args.command == "check-db-privileges":
        return check_db_privileges(settings or Settings())
    if args.command == "invite-user":
        return invite_user(settings or Settings(), args)
    return 1  # unreachable: argparse rejects unknown commands


if __name__ == "__main__":
    sys.exit(main())
