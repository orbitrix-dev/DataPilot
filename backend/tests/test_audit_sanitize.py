"""Stage 3A.1 hardening: credentials never reach stored audit events (or logs), while legitimate audit information is
kept. Tests check what PostgreSQL actually stores, not just the redaction function."""

import logging
import uuid
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core import clock
from app.core.config import Settings
from app.core.context import Principal, RequestContext
from app.db.base import uuid7
from app.deps import Ctx
from app.main import create_app
from app.modules.audit import service as audit
from app.modules.audit.models import AuditEventRecord
from app.modules.audit.repository import PostgresAuditRepository
from app.modules.audit.sanitize import REDACTED, redact
from app.modules.audit.security_writer import SecurityAuditWriter
from app.seed import demo_tenant

from .conftest import mfa_code

BASE = "http://testserver/api/v1"


def _fake(*parts: str) -> str:
    """Fake credentials are assembled at runtime: no credential-shaped literal sits in the source (secret scanners)."""
    return "".join(parts)


AWS_KEY_ID = _fake("AKIA", "IOSFODNN7", "EXAMPLE")
GITHUB_TOKEN = _fake("ghp", "_", "1234567890abcdefghijklmnopqrstuvwxyzAB")

JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"
SHORT_JWT = "eyJhbGci.eyJzdWIi.c2lnbmF0dXJl"  # still a JWT shape; fits client_label's 64-character limit
SECRETS = {
    "aws-key-id": (f"key {AWS_KEY_ID} used", AWS_KEY_ID),
    "aws-secret-kv": ("aws_secret_access_key=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", "wJalrXUtnFEMI/K7MDENG"),
    "jwt": (f"token {JWT}", JWT),
    "db-url": ("connect postgresql://app:Sup3rS3cret@db.internal:5432/prod", "Sup3rS3cret"),
    "pem": (
        "-----BEGIN RSA PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG\n-----END RSA PRIVATE KEY-----",
        "MIIEvQIBADANBgkqhkiG",
    ),
    "pem-truncated": ("-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkq", "MIIEvQIBADANBgkq"),
    "password-kv": ("retry with password=hunter2, then", "hunter2"),
    "token-kv": ('client_secret: "abc def"', "abc def"),
    "bearer": ("Authorization: Bearer abc.def.ghi", "abc.def.ghi"),
    "github": (GITHUB_TOKEN, GITHUB_TOKEN),
    "slack": (_fake("xox", "b-", "123456789012-abcdefghijkl"), _fake("xox", "b-", "1234567")),
    "stripe": (_fake("sk", "_live_", "0000000000fakefake0000"), _fake("sk", "_live_", "0000")),
    "google": (_fake("ya", "29.", "a0fakefakefakefakefakefake"), _fake("ya", "29.", "a0fake")),
    "datapilot-key": ("dp_live_0123456789abcdef0123456789abcdef01234567", "dp_live_0123456789abcdef"),
    "argon2": ("$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA", "$argon2id$"),
    "raw-hex": ("digest 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08", "9f86d081884c7d65"),
}
KEPT = [
    "Invited e.vance@acme.io as Analyst",
    "Created Reader, prefix dp_live_••••9f2a (trust:read)",
    "member u-0190a1b2c3d4e5f60718293a4b5c6d7e",
    "sess-0190a1b2c3d4e5f60718293a4b5c6d7e",
    "run 0190a1b2-c3d4-7e5f-8071-8293a4b5c6d7",
    "Organization name: Acme Global Corp → Acme Holdings",
    "Rotated the read-only credential on Amazon S3 — Raw Orders",
    "Approved REQ-9040 for RUN-8843 (INC-204, SKU-4410)",
    "connect postgresql://db.internal:5432/prod",
    "commit a1b2c3d",
]


@pytest.mark.parametrize("case", SECRETS.values(), ids=SECRETS.keys())
def test_credential_formats_are_redacted(case):
    text_in, secret = case
    out = redact(text_in)
    assert secret not in out and REDACTED in out


@pytest.mark.parametrize("value", KEPT)
def test_legitimate_audit_information_is_kept(value):
    assert redact(value) == value


def test_redaction_keeps_context_around_secrets():
    assert redact("connect postgresql://app:Sup3rS3cret@db:5432/x") == f"connect postgresql://app:{REDACTED}@db:5432/x"
    assert redact("retry with password=hunter2") == f"retry with password={REDACTED}"
    assert redact(redact("password=hunter2")) == f"password={REDACTED}"  # idempotent


# ====================================================================== what PostgreSQL actually stores


def _stored(conn, **where) -> AuditEventRecord:
    with Session(bind=conn, join_transaction_mode="create_savepoint") as s:
        query = select(AuditEventRecord).order_by(AuditEventRecord.occurred_at.desc(), AuditEventRecord.id.desc())
        for column, value in where.items():
            query = query.where(getattr(AuditEventRecord, column) == value)
        return s.scalars(query.limit(1)).one()


def _row_text(row: AuditEventRecord) -> str:
    return " ".join(
        str(v)
        for v in (row.summary, row.resource_id, row.actor_label, row.client_label, row.ip_address, row.event_metadata)
    )


def test_real_call_sites_store_redacted_summaries_and_metadata(client, pg_conn):
    org = {
        "name": f"Acme {JWT[:60]}",
        "industry": "Wholesale & Distribution",
        "timezone": "UTC",
        "audit_retention_days": 365,
    }
    assert client.put("/settings/organization", json=org).status_code == 200  # only the name changes: one event
    row = _stored(pg_conn, action="settings.organization_updated")
    assert row.event_metadata["field"] == "name"
    assert JWT[:40] not in _row_text(row) and REDACTED in row.summary and REDACTED in row.event_metadata["to_value"]
    assert row.summary.startswith("Organization name: Acme Global Corp → Acme ")  # context kept

    key = client.post(
        "/api-keys", json={"name": "password=hunter2", "scopes": ["trust:read"], "mfa_code": mfa_code(client)}
    )
    assert key.status_code == 201
    row = _stored(pg_conn, action="api-key.created")
    assert "hunter2" not in _row_text(row)
    assert row.event_metadata["prefix"].startswith("dp_live_••••")  # masked prefix kept
    assert key.json()["secret"] not in _row_text(row)


def test_every_free_text_column_is_redacted_when_stored(pg_db, pg_conn, registry):
    app = create_app(Settings(env="test"), registry, database=pg_db)

    @app.post("/api/v1/_probe/audit")
    def probe(ctx: Ctx) -> dict:
        api_key_ctx = replace(
            ctx,
            principal=Principal(kind="api_key", id="key_probe", name=f"API key {SECRETS['github'][0]}"),
            ip="10.1.2.3",
        )
        audit.record(
            api_key_ctx,
            "user.invited",
            f"Invited {SECRETS['db-url'][0]}",
            resource=("member", f"u-x {SECRETS['aws-key-id'][1]}"),
            metadata={"email": f"x@acme.io {SECRETS['password-kv'][0]}", "role": JWT},
        )
        return {}

    assert TestClient(app, base_url=BASE).post("/_probe/audit").status_code == 200
    row = _stored(pg_conn, actor_id="key_probe")
    stored = _row_text(row)
    for leaked in ("Sup3rS3cret", AWS_KEY_ID, "hunter2", JWT, GITHUB_TOKEN):
        assert leaked not in stored, leaked
    assert row.summary == f"Invited connect postgresql://app:{REDACTED}@db.internal:5432/prod"
    assert row.event_metadata["email"].startswith("x@acme.io ")  # the email is kept
    assert str(row.ip_address) == "10.1.2.3"


# ====================================================================== the database backstop


@pytest.mark.parametrize(
    "secret",
    [
        "dp_live_0123456789abcdef0123",
        "-----BEGIN PRIVATE KEY-----",
        AWS_KEY_ID,
        SHORT_JWT,
        "postgresql://app:Sup3rS3cret@db.internal/prod",
    ],
)
@pytest.mark.parametrize("column", ["summary", "resource_id", "actor_label", "client_label", "metadata"])
def test_postgresql_rejects_supported_credential_formats_in_every_text_column(db_session, column, secret):
    """Bypasses the application entirely (raw INSERT as the runtime user): the CHECKs are the last line."""
    values = {"summary": "s", "resource_id": None, "actor_label": "a", "client_label": None, "metadata": "{}"}
    values["resource_type"] = "member" if column == "resource_id" else None
    values[column] = f'{{"v": "{secret}"}}' if column == "metadata" else secret
    with pytest.raises(IntegrityError, match=f"{column}_has_no_secret"), db_session.begin_nested():
        db_session.execute(
            text(
                "INSERT INTO audit_events (id, occurred_at, action, actor_type, actor_label, summary, resource_type,"
                " resource_id, client_label, metadata) VALUES (:id, now(), 'user.invited', 'system', :actor_label,"
                " :summary, :resource_type, :resource_id, :client_label, CAST(:metadata AS jsonb))"
            ),
            {"id": uuid7(), **values},
        )


def test_postgresql_accepts_redacted_forms(db_session):
    db_session.add(
        AuditEventRecord(
            id=uuid7(),
            occurred_at=clock.now(),
            action="user.invited",
            actor_type="system",
            actor_label="DataPilot",
            summary=f"connect postgresql://app:{REDACTED}@db.internal/prod and {REDACTED}",
        )
    )
    db_session.flush()


# ====================================================================== nothing sensitive in errors or logs


def test_metadata_validation_errors_never_contain_the_offending_value():
    ctx = RequestContext("acme", Principal(kind="user", id="u-elena", name="Elena"), demo_tenant(), "1.2.3.4")
    for metadata in (
        {"email": "x" * 190 + SECRETS["datapilot-key"][0]},  # too long (over 200 characters)
        {"unexpected": SECRETS["datapilot-key"][0]},  # not allowlisted
        {"email": [SECRETS["datapilot-key"][0]]},  # wrong type
        {"email": {"nested": SECRETS["datapilot-key"][0]}},  # nested
    ):
        with pytest.raises(ValueError) as caught:
            audit.record(ctx, "user.invited", "x", metadata=metadata)
        assert "dp_live_" not in str(caught.value)


def test_a_rejected_row_does_not_put_the_credential_in_logs_or_the_response(pg_db, registry, caplog):
    """If a credential ever got past redaction, the CHECK rejects it; the 500 and the log line must not repeat it."""
    app = create_app(Settings(env="test"), registry, database=pg_db)
    secret = "dp_live_0123456789abcdef0123"

    @app.post("/api/v1/_probe/raw-leak")
    def raw_leak(ctx: Ctx) -> dict:
        tenant_id = ctx.tenant_uuid
        repo = ctx.data.audit
        assert isinstance(repo, PostgresAuditRepository)
        repo._s.execute(
            text(
                "INSERT INTO audit_events (id, tenant_id, occurred_at, action, actor_type, actor_label, summary)"
                " VALUES (:id, :t, now(), 'user.invited', 'system', 'x', :s)"
            ),
            {"id": uuid.uuid4(), "t": tenant_id, "s": f"bypassing redaction {secret}"},
        )
        return {}

    with caplog.at_level(logging.DEBUG):
        r = TestClient(app, base_url=BASE, raise_server_exceptions=False).post("/_probe/raw-leak")
    assert r.status_code == 500 and r.text == "Internal Server Error"  # the same response unhandled errors always had
    assert secret not in caplog.text and secret not in r.text
    assert "constraint=ck_audit_events_summary_has_no_secret" in caplog.text  # still diagnosable


def test_security_writer_redacts_actor_and_client_labels(migrated, owner_database):
    writer = SecurityAuditWriter(migrated.engine.url.render_as_string(hide_password=False))
    marker = f"probe-{uuid.uuid4().hex[:8]}"
    try:
        assert writer.record(
            "api-key.rejected",
            marker,
            actor_label=f"API key {SECRETS['github'][0]}",
            client=SECRETS["password-kv"][0],
            metadata={"reason": "unknown"},
        )
        with owner_database.engine.connect() as conn:
            row = conn.execute(
                text("SELECT actor_label, client_label FROM audit_events WHERE summary = :m"), {"m": marker}
            ).one()
        assert GITHUB_TOKEN not in row.actor_label and "hunter2" not in (row.client_label or "")
    finally:
        writer.dispose()
        with owner_database.session() as s:
            s.execute(text("ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only"))
            s.execute(text("DELETE FROM audit_events WHERE summary = :m"), {"m": marker})
            s.execute(text("ALTER TABLE audit_events ENABLE TRIGGER audit_events_append_only"))
