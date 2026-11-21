from typing import Literal

from pydantic import BaseModel

from app.core.context import RequestContext
from app.core.repository import InMemoryTable, Table
from app.modules.audit import service as audit

Category = Literal["business", "trust", "approvals"]

LABELS: dict[Category, str] = {
    "business": "Business Risk Alerts (Revenue, Overdue, Low Stock)",
    "trust": "DataPilot Trust Incidents & Sync Failures",
    "approvals": "Automate Approval Requests",
}
CHANNELS: dict[Category, str] = {
    "business": "Email + In-App Command Center",
    "trust": "Email + Slack (#ops-alerts)",
    "approvals": "Immediate Email to designated Approver role",
}


class Preferences(BaseModel):
    id: str = "preferences"
    business: bool = True
    trust: bool = True
    approvals: bool = True


class PreferenceOut(BaseModel):
    category: Category
    label: str
    channel: str
    enabled: bool


class PreferenceUpdate(BaseModel):
    enabled: bool


NotificationsRepository = Table[Preferences]


def new_repository() -> InMemoryTable[Preferences]:
    return InMemoryTable("Preferences", lambda r: r.id, [Preferences()])


def list_preferences(ctx: RequestContext) -> list[PreferenceOut]:
    p = ctx.data.notifications.get("preferences")
    return [PreferenceOut(category=c, label=LABELS[c], channel=CHANNELS[c], enabled=getattr(p, c)) for c in LABELS]


def set_preference(ctx: RequestContext, category: Category, enabled: bool) -> list[PreferenceOut]:
    repo = ctx.data.notifications
    p = repo.get("preferences")
    if getattr(p, category) != enabled:
        setattr(p, category, enabled)
        repo.put(p)
        audit.record(
            ctx,
            "settings",
            "Notifications Changed",
            f"{'Enabled' if enabled else 'Disabled'} {LABELS[category]}",
            "notifications",
        )
    return list_preferences(ctx)


def should_deliver(ctx: RequestContext, category: Category) -> bool:
    """Checked by the delivery workers (email / Slack) before sending."""
    return getattr(ctx.data.notifications.get("preferences"), category)
