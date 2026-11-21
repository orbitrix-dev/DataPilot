"""Operational commands. Run from backend/:

uv run python -m app.cli seed-demo     # load the demo tenant into PostgreSQL (idempotent; refused in prod)
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


def main(argv: list[str] | None = None, settings: Settings | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli", description="DataPilot operational commands")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("seed-demo", help="Load the demo tenant into PostgreSQL (idempotent; refused in prod)")
    args = parser.parse_args(argv)
    if args.command == "seed-demo":
        return seed_demo(settings or Settings())
    return 1  # unreachable: argparse rejects unknown commands


if __name__ == "__main__":
    sys.exit(main())
