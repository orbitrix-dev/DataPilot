from uuid import uuid4

from app.core import clock
from app.core.context import RequestContext
from app.core.errors import Conflict
from app.modules.audit import service as audit

from .schemas import Connection, ConnectionOut, RotateIn, SyncQueued, SyncRun

SYNC_TOPIC = "connect.sync-jobs"


def _out(c: Connection) -> ConnectionOut:
    return ConnectionOut(**c.model_dump(exclude={"credential_ref"}), has_credentials=c.credential_ref is not None)


def list_connections(ctx: RequestContext) -> list[ConnectionOut]:
    return [_out(c) for c in ctx.data.connect.connections.list()]


def get_connection(ctx: RequestContext, connection_id: str) -> ConnectionOut:
    return _out(ctx.data.connect.connections.get(connection_id))


def rotate_credentials(ctx: RequestContext, connection_id: str, body: RotateIn) -> ConnectionOut:
    repo = ctx.data.connect
    c = repo.connections.get(connection_id)
    if c.kind == "file":
        raise Conflict("File uploads have no credentials to rotate")
    c.credential_ref = ctx.data.secrets.put(ctx.tenant_id, f"connections/{c.id}", body.secret)
    c.credentials_rotated_at = clock.now()
    c.credentials_rotated_by = ctx.principal.name
    if c.status == "failed":
        # In production the connector framework re-tests access before clearing the failure.
        c.status, c.issue = "healthy", None
    repo.connections.put(c)
    audit.record(
        ctx, "connection", "Credential Rotated", f"Rotated the read-only credential on {c.name}", f"connection:{c.id}"
    )
    return _out(c)


def request_sync(ctx: RequestContext, connection_id: str) -> SyncQueued:
    """Queues a manual sync for the ingestion workers (SQS in production)."""
    repo = ctx.data.connect
    c = repo.connections.get(connection_id)
    if c.kind == "file":
        raise Conflict("File uploads are imported once and can't be re-synced")
    run = SyncRun(
        id=f"sync_{uuid4().hex[:10]}",
        connection_id=c.id,
        status="queued",
        records=0,
        duration_seconds=0,
        at=clock.now(),
        trigger="Manual",
    )
    repo.runs.put(run)
    msg = ctx.data.queue.publish(SYNC_TOPIC, ctx.tenant_id, {"connection_id": c.id, "run_id": run.id})
    return SyncQueued(run=run, message_id=msg.id)


def list_runs(ctx: RequestContext, connection_id: str | None = None) -> list[SyncRun]:
    runs = [r for r in ctx.data.connect.runs.list() if connection_id is None or r.connection_id == connection_id]
    return sorted(runs, key=lambda r: r.at, reverse=True)
