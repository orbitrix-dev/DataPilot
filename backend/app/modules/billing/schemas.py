from datetime import date
from typing import Literal

from pydantic import BaseModel

PlanId = Literal["team", "growth", "scale"]


class Plan(BaseModel):
    id: PlanId
    name: str
    price_usd: int
    seats: int
    sources: int
    rows: int
    storage_gb: int
    audit_retention_days: int


PLANS: dict[PlanId, Plan] = {
    "team": Plan(
        id="team",
        name="Team",
        price_usd=450,
        seats=10,
        sources=5,
        rows=1_000_000,
        storage_gb=25,
        audit_retention_days=90,
    ),
    "growth": Plan(
        id="growth",
        name="Enterprise Growth",
        price_usd=1250,
        seats=25,
        sources=10,
        rows=5_000_000,
        storage_gb=100,
        audit_retention_days=365,
    ),
    "scale": Plan(
        id="scale",
        name="Enterprise Scale",
        price_usd=2900,
        seats=100,
        sources=25,
        rows=25_000_000,
        storage_gb=500,
        audit_retention_days=730,
    ),
}


class Invoice(BaseModel):
    id: str
    date: date
    amount_usd: int
    status: Literal["paid", "open", "failed"]


class Subscription(BaseModel):
    id: str = "subscription"
    plan: PlanId
    card_last4: str
    # A plan change asked of the Owner by someone without billing rights.
    requested_plan: PlanId | None = None
    # Tracked by metering in production; not measured anywhere in the skeleton.
    storage_gb: float


class Usage(BaseModel):
    plan: Plan
    sources: int
    rows: int
    storage_gb: float
    seats: int


class SubscriptionOut(BaseModel):
    plan: Plan
    card_last4: str
    requested_plan: PlanId | None
    invoices: list[Invoice]


class PlanChangeIn(BaseModel):
    plan: PlanId


class PlanChangeOut(BaseModel):
    status: Literal["changed", "requested"]
    subscription: SubscriptionOut
