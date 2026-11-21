"""The persistent, append-only audit log (ORM mapping only).

Append-only is enforced by PostgreSQL, not just by this code (migration 0003):
- the runtime user (``datapilot_app``) is granted only SELECT and INSERT on this table;
- a trigger rejects UPDATE, DELETE and TRUNCATE for every user, the owner included.
Actor ids are deliberately not foreign keys: events must outlive the users and API keys they mention, and an
``ON DELETE SET NULL`` would be an UPDATE the trigger rejects. ``tenant_id`` is a foreign key with RESTRICT.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, Computed, DateTime, ForeignKey, Index, String, Text, text
from sqlalchemy.dialects.postgresql import INET, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, UUIDPrimaryKey, check_in
from app.db.types import IPAddress

from .actions import CATEGORIES

ACTOR_TYPES = ("user", "api_key", "system", "anonymous")
# Credential formats PostgreSQL itself refuses in audit text (migration 0004; the last line after the allowlists and
# app-side redaction, see sanitize.py). A PostgreSQL ARE: DataPilot API-key secrets, PEM private keys, AWS access key
# ids, JWTs, and URLs with an unredacted password ("postgresql://user:[REDACTED]@host" is allowed).
SECRET_IN_TEXT = (
    "dp_live_[0-9a-fA-F]{8,}"
    "|-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----"
    "|(AKIA|ASIA)[A-Z0-9]{16}"
    "|eyJ[A-Za-z0-9_-]{5,}\\.[A-Za-z0-9_-]{5,}\\.[A-Za-z0-9_-]{5,}"
    "|://[^[:space:]:/@]+:(?!\\[REDACTED\\])[^[:space:]@/]+@"
)
SECRET_CHECKED_COLUMNS = ("summary", "resource_id", "actor_label", "client_label", "metadata::text")
TABLE_COMMENT = (
    "Append-only audit log. UPDATE/DELETE/TRUNCATE are rejected by trigger; the runtime user may only SELECT and "
    "INSERT. Retention purging is not implemented yet."
)


class AuditEventRecord(UUIDPrimaryKey, Base):
    __tablename__ = "audit_events"

    # NULL for global/security events that belong to no tenant (e.g. a rejected API key).
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="RESTRICT")
    )
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    action: Mapped[str] = mapped_column(String(64))
    # Kept in sync by PostgreSQL; indexed for the API's ?type= filter.
    category: Mapped[str] = mapped_column(String(20), Computed("split_part(action, '.', 1)", persisted=True))
    actor_type: Mapped[str] = mapped_column(String(10))
    # Readable public id ("u-elena", an API key id). Not a foreign key: survives deletion of the actor.
    actor_id: Mapped[str | None] = mapped_column(String(128))
    actor_label: Mapped[str] = mapped_column(String(160))
    resource_type: Mapped[str | None] = mapped_column(String(40))
    resource_id: Mapped[str | None] = mapped_column(String(128))
    summary: Mapped[str] = mapped_column(Text)
    ip_address: Mapped[IPAddress | None] = mapped_column(INET)
    # Non-IP client identifiers (e.g. "testclient"); never stored in ip_address.
    client_label: Mapped[str | None] = mapped_column(String(64))
    event_metadata: Mapped[dict[str, Any]] = mapped_column("metadata", JSONB, server_default=text("'{}'::jsonb"))

    __table_args__ = (
        CheckConstraint(r"action ~ '^[a-z-]+\.[a-z_]+$'", name="action_format"),
        CheckConstraint(check_in("category", CATEGORIES), name="category_valid"),
        CheckConstraint(check_in("actor_type", ACTOR_TYPES), name="actor_type_valid"),
        CheckConstraint("actor_type IN ('system', 'anonymous') OR actor_id IS NOT NULL", name="actor_id_present"),
        CheckConstraint("resource_id IS NULL OR resource_type IS NOT NULL", name="resource_type_present"),
        CheckConstraint("NOT (ip_address IS NOT NULL AND client_label IS NOT NULL)", name="one_client_identifier"),
        CheckConstraint("jsonb_typeof(metadata) = 'object'", name="metadata_is_object"),
        CheckConstraint("octet_length(metadata::text) <= 8192", name="metadata_size"),
        *(
            CheckConstraint(f"{column} !~ '{SECRET_IN_TEXT}'", name=f"{column.split('::')[0]}_has_no_secret")
            for column in SECRET_CHECKED_COLUMNS
        ),
        Index("ix_audit_events_tenant_id_occurred_at", "tenant_id", text("occurred_at DESC"), "id"),
        Index(
            "ix_audit_events_tenant_id_category_occurred_at", "tenant_id", "category", text("occurred_at DESC"), "id"
        ),
        Index(
            "ix_audit_events_global_occurred_at", text("occurred_at DESC"), postgresql_where=text("tenant_id IS NULL")
        ),
        {"comment": TABLE_COMMENT},
    )
