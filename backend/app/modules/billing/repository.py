from dataclasses import dataclass
from typing import Protocol

from app.core.repository import InMemoryTable, Table

from .schemas import Invoice, Subscription


class BillingRepository(Protocol):
    subscription: Table[Subscription]
    invoices: Table[Invoice]


@dataclass
class InMemoryBillingRepository:
    subscription: InMemoryTable[Subscription]
    invoices: InMemoryTable[Invoice]

    @classmethod
    def seeded(cls, subscription: Subscription, invoices: list[Invoice]):
        return cls(
            subscription=InMemoryTable("Subscription", lambda r: r.id, [subscription]),
            invoices=InMemoryTable("Invoice", lambda r: r.id, invoices),
        )
