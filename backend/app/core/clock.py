from datetime import UTC, datetime


def now() -> datetime:
    """Current time in UTC. Patched in tests that need a fixed clock."""
    return datetime.now(UTC)


def seed_time(day: int, hour: int, minute: int = 0, month: int = 11) -> datetime:
    """Timestamps for seed data. The front end's mock data is "as of" Friday Nov 20, 2026, 14:32 UTC."""
    return datetime(2026, month, day, hour, minute, tzinfo=UTC)
