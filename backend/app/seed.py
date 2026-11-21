"""Demo tenant, matching the front end's mock data (as of Friday Nov 20, 2026, 14:32 UTC)."""

from datetime import date

from app.core.clock import seed_time as t
from app.core.infra import InMemoryQueue, InMemorySecretStore
from app.db.base import deterministic_uuid7
from app.modules.audit.repository import AuditEntry, InMemoryAuditRepository
from app.modules.automate.repository import InMemoryAutomateRepository
from app.modules.automate.schemas import ApprovalRequest, Run, Workflow
from app.modules.billing.repository import InMemoryBillingRepository
from app.modules.billing.schemas import Invoice, Subscription
from app.modules.connect.repository import InMemoryConnectRepository
from app.modules.connect.schemas import Connection, SyncRun
from app.modules.notifications.service import new_repository as new_notifications
from app.modules.tenants.repository import InMemoryTenantsRepository
from app.modules.tenants.schemas import ApiKeyRecord, Member, OrgSettings, SecurityPolicy, Session, Workspace
from app.modules.trust.repository import InMemoryTrustRepository
from app.modules.trust.schemas import Freshness, HistoryEntry, Incident
from app.tenant_data import Registry, TenantData

ELENA_IP = "198.51.100.24"
MARCUS_IP = "198.51.100.12"
PRIYA_IP = "198.51.100.31"

# Hashes of throwaway demo secrets; the real values are not used anywhere.
DEMO_KEY_HASH = "0" * 64


def _members() -> list[Member]:
    rows = [
        ("u-marcus", "Marcus Chen", "m.chen", "Workspace Owner", "owner", "enabled", t(20, 14, 20), MARCUS_IP),
        ("u-elena", "Elena Vance", "e.vance", "Finance Manager", "admin", "enabled", t(20, 14, 32), ELENA_IP),
        (
            "u-jordan",
            "Jordan Blake",
            "j.blake",
            "Data Platform Engineer",
            "admin",
            "enabled",
            t(20, 9, 48),
            "198.51.100.40",
        ),
        ("u-david", "David Park", "d.park", "Sales Director", "manager", "enabled", t(20, 12, 31), "198.51.100.57"),
        ("u-priya", "Priya Raman", "p.raman", "Operations Lead", "manager", "enabled", t(20, 11, 5), PRIYA_IP),
        (
            "u-aisha",
            "Aisha Okafor",
            "a.okafor",
            "Purchasing Manager",
            "manager",
            "enabled",
            t(19, 16, 40),
            "198.51.100.63",
        ),
        ("u-lena", "Lena Fischer", "l.fischer", "FP&A Analyst", "analyst", "enabled", t(20, 10, 12), "198.51.100.71"),
        ("u-ravi", "Ravi Menon", "r.menon", "Sales Analyst", "analyst", "enabled", t(19, 15, 22), "198.51.100.72"),
        ("u-grace", "Grace Liu", "g.liu", "Inventory Analyst", "analyst", "enabled", t(19, 9, 30), "198.51.100.73"),
        ("u-owen", "Owen Brooks", "o.brooks", "BI Developer", "analyst", "enabled", t(19, 11, 2), "198.51.100.74"),
        ("u-nora", "Nora Wilson", "n.wilson", "Regional Sales Lead", "viewer", "enabled", t(19, 8, 47), "203.0.113.9"),
        (
            "u-samir",
            "Samir Gupta",
            "s.gupta",
            "Warehouse Supervisor",
            "viewer",
            "pending",
            t(18, 16, 5),
            "203.0.113.14",
        ),
    ]
    return [
        Member(id=i, name=n, email=f"{e}@acme.io", title=ti, role=r, status="active", mfa=mfa, last_active_at=at, ip=ip)
        for i, n, e, ti, r, mfa, at, ip in rows
    ]


def _workspace() -> Workspace:
    return Workspace(
        org=OrgSettings(
            name="Acme Global Corp", industry="Wholesale & Distribution", timezone="UTC", audit_retention_days=365
        ),
        policy=SecurityPolicy(require_mfa=True, enforce_sso=True, session_timeout_hours=12),
        matrix={
            "connect": {"owner": "Full", "admin": "Full", "manager": "Read", "analyst": "Read", "viewer": "None"},
            "trust": {"owner": "Full", "admin": "Full", "manager": "View", "analyst": "Edit Rules", "viewer": "View"},
            "insights": {"owner": "Full", "admin": "Full", "manager": "Full", "analyst": "Full", "viewer": "View Only"},
            "automate": {
                "owner": "Approve",
                "admin": "Approve",
                "manager": "Approve",
                "analyst": "Draft Only",
                "viewer": "None",
            },
            "admin": {"owner": "Full", "admin": "None", "manager": "None", "analyst": "None", "viewer": "None"},
        },
    )


def _sessions() -> list[Session]:
    return [
        Session(
            id="sess-1",
            member_id="u-elena",
            device="Chrome on macOS",
            location="San Francisco, US",
            ip=ELENA_IP,
            signed_in_at=t(20, 8, 2),
        ),
        Session(
            id="sess-2",
            member_id="u-marcus",
            device="Safari on macOS",
            location="San Francisco, US",
            ip=MARCUS_IP,
            signed_in_at=t(20, 12, 24),
        ),
        Session(
            id="sess-3",
            member_id="u-david",
            device="Edge on Windows",
            location="Chicago, US",
            ip="198.51.100.57",
            signed_in_at=t(20, 12, 30),
        ),
        Session(
            id="sess-4",
            member_id="u-priya",
            device="Chrome on Windows",
            location="Columbus, US",
            ip=PRIYA_IP,
            signed_in_at=t(20, 7, 58),
        ),
    ]


def _keys() -> list[ApiKeyRecord]:
    return [
        ApiKeyRecord(
            id="key-9f2a",
            name="BI Export Service",
            prefix="dp_live_••••9f2a",
            scopes=["insights:read"],
            created_by="Elena Vance",
            created_at=t(20, 11, 40),
            last_used_at=t(20, 14, 18),
            secret_hash=DEMO_KEY_HASH,
        ),
        ApiKeyRecord(
            id="key-3c81",
            name="Trust Webhook Reader",
            prefix="dp_live_••••3c81",
            scopes=["trust:read"],
            created_by="Marcus Chen",
            created_at=t(2, 10, 15),
            last_used_at=t(19, 22, 5),
            secret_hash=DEMO_KEY_HASH,
        ),
    ]


def _connections() -> list[Connection]:
    return [
        Connection(
            id="postgresql-production-erp",
            name="PostgreSQL — Production ERP",
            endpoint="db-prod-us-east.internal",
            source_type="PostgreSQL",
            kind="database",
            status="healthy",
            records=1_120_400,
            last_sync_at=t(20, 14, 28),
            access_level="Read-only (TLS 1.3)",
            credential_ref="secret://acme/connections/postgresql-production-erp/seed",
            credentials_rotated_at=t(19, 9, 15),
            credentials_rotated_by="Elena Vance",
        ),
        Connection(
            id="mysql-warehouse-inventory",
            name="MySQL — Warehouse Inventory",
            endpoint="inv-replica.internal",
            source_type="MySQL",
            kind="database",
            status="healthy",
            records=214_300,
            last_sync_at=t(20, 14, 15),
            access_level="Read-only (TLS 1.2)",
            credential_ref="secret://acme/connections/mysql-warehouse-inventory/seed",
        ),
        Connection(
            id="databricks-analytics-lakehouse",
            name="Databricks — Analytics Lakehouse",
            endpoint="dbc-workspace-01",
            source_type="Databricks",
            kind="cloud",
            status="latency",
            records=46_000,
            last_sync_at=t(20, 13, 50),
            access_level="Read-only (Unity Catalog)",
            credential_ref="secret://acme/connections/databricks-analytics-lakehouse/seed",
        ),
        Connection(
            id="amazon-s3-raw-orders",
            name="Amazon S3 — Raw Orders",
            endpoint="s3://acme-datapilot-orders",
            source_type="Amazon S3",
            kind="cloud",
            status="failed",
            records=0,
            last_sync_at=t(19, 22, 0),
            access_level="Read-only (IAM GetObject)",
            issue="IAM access key expired at 09:44 UTC. Rotate credentials or retry the connection.",
            credential_ref="secret://acme/connections/amazon-s3-raw-orders/seed",
        ),
        Connection(
            id="q4-regional-sales-export",
            name="Q4 Regional Sales Export",
            endpoint="orders_q4_2026.csv",
            source_type="CSV File",
            kind="file",
            status="verified",
            records=48_210,
            last_sync_at=t(20, 11, 5),
            access_level="Read-only copy",
        ),
    ]


def _runs() -> list[SyncRun]:
    return [
        SyncRun(
            id="sync_98421",
            connection_id="postgresql-production-erp",
            status="succeeded",
            records=14_820,
            duration_seconds=42,
            at=t(20, 14, 28),
            trigger="Scheduled",
        ),
        SyncRun(
            id="sync_98420",
            connection_id="amazon-s3-raw-orders",
            status="failed",
            status_label="Failed (403)",
            records=0,
            duration_seconds=2,
            at=t(20, 9, 44),
            trigger="Scheduled",
        ),
    ]


def _incidents() -> list[Incident]:
    return [
        Incident(
            id="INC-204",
            title="Duplicate invoice numbers detected",
            severity="critical",
            status="investigating",
            dataset="public.invoices",
            first_detected_at=t(20, 9, 44),
            summary="May overstate daily revenue in Receivables report",
            business_cause="14 invoices from the morning ERP batch were imported twice after a temporary network "
            "retry. Until deduplicated, total billed revenue in Receivables reports may appear "
            "$18,450 higher than actuals.",
            history=[HistoryEntry(at=t(20, 9, 44), text="DataTrust Duplicate Check failed (14 rows)")],
        ),
        Incident(
            id="INC-203",
            title="Warehouse stock feed delayed 3 hours",
            severity="warning",
            status="acknowledged",
            dataset="warehouse.stock_levels",
            first_detected_at=t(20, 11, 10),
            summary="Stock counts reflect 09:00 UTC snapshot",
            business_cause="The hourly stock export from the warehouse system stopped after the 09:00 UTC run. "
            "Reorder alerts are still firing, but they use stock counts that are more than 3 "
            "hours old.",
            history=[
                HistoryEntry(at=t(20, 11, 10), text="DataTrust Freshness Check missed SLA (1h)"),
                HistoryEntry(at=t(20, 11, 11), text="Alert dispatched to Operations Lead"),
                HistoryEntry(at=t(20, 11, 25), text="Status set to Acknowledged"),
            ],
        ),
        Incident(
            id="INC-199",
            title="Missing currency code on EU orders",
            severity="warning",
            status="resolved",
            dataset="public.orders",
            first_detected_at=t(19, 16, 20),
            summary="EU order totals excluded from currency conversion",
            business_cause="312 EU orders arrived without a currency code after a storefront release. They were "
            "left out of currency conversion, so EU revenue was understated by about €9,800 "
            "until the fix was backfilled.",
            history=[
                HistoryEntry(at=t(19, 16, 20), text="DataTrust Null Check failed (312 rows)"),
                HistoryEntry(at=t(19, 16, 48), text="Status set to Investigating"),
                HistoryEntry(at=t(19, 19, 5), text="Backfill completed; null check passing"),
                HistoryEntry(at=t(19, 19, 10), text="Marked resolved and verified fixed"),
            ],
        ),
    ]


def _freshness() -> list[Freshness]:
    return [
        Freshness(dataset="public.orders", sla_minutes=15, last_updated_at=t(20, 14, 28), status="on-time"),
        Freshness(dataset="warehouse.stock_levels", sla_minutes=60, last_updated_at=t(20, 11, 14), status="stale"),
        Freshness(
            dataset="s3.raw_orders",
            sla_minutes=240,
            last_updated_at=t(19, 22, 0),
            status="breached",
            connection_id="amazon-s3-raw-orders",
        ),
    ]


def _workflows() -> list[Workflow]:
    return [
        Workflow(
            id="WF-104",
            name="Notify owner when customer invoice becomes overdue",
            state="published",
            version=3,
            dataset="public.invoices",
            trust_gate=True,
            approver="finance",
        ),
        Workflow(
            id="WF-105",
            name="Alert purchasing team on low inventory threshold",
            state="published",
            version=2,
            dataset="warehouse.stock_levels",
            trust_gate=False,
            approver="ops",
        ),
        Workflow(
            id="WF-106",
            name="Generate and send weekly sales report after approval",
            state="published",
            version=1,
            dataset=None,
            trust_gate=True,
            approver="owner",
        ),
        Workflow(
            id="WF-107",
            name="Page ops when a connector sync fails",
            state="paused",
            version=1,
            dataset="connect.sync_runs",
            trust_gate=False,
            approver="ops",
        ),
        Workflow(
            id="WF-108",
            name="Create collections follow-up task for overdue accounts",
            state="draft",
            version=0,
            dataset="public.invoices",
            trust_gate=True,
            approver="finance",
        ),
    ]


def _requests() -> list[ApprovalRequest]:
    return [
        ApprovalRequest(
            id="REQ-9041",
            workflow_id="WF-106",
            title="Generate and send weekly sales report",
            detail="Ad-hoc run requested by Marcus Chen for Monday’s board pack. Will email the PDF "
            "summary (week 4 revenue $824,420) to 14 executive recipients.",
            queued_at=t(20, 14, 20),
            matched=[],
            status="pending",
        ),
        ApprovalRequest(
            id="REQ-9040",
            workflow_id="WF-104",
            title="Notify owner of 2 overdue invoices ($18,400)",
            detail="Great Lakes Builders Co. ($11,200 · 22d overdue) and Summit Contractors Supply "
            "($7,200 · 18d overdue). Will email owner@acme.io.",
            queued_at=t(20, 7, 0),
            matched=["INV-4021", "INV-4034"],
            status="pending",
        ),
        ApprovalRequest(
            id="REQ-9038",
            workflow_id="WF-105",
            title="Alert purchasing team on low stock (SKU-4410, SKU-2108)",
            detail="Stainless Fasteners has 5 days of cover against a 7.5-day lead time; Hydraulic Valve "
            "24V has 11 against 12.4. Will post a reorder alert to #purchasing-ops.",
            queued_at=t(20, 12, 0),
            matched=["SKU-4410", "SKU-2108"],
            status="pending",
        ),
    ]


def _automate_runs() -> list[Run]:
    return [
        Run(
            id="RUN-8842",
            workflow_id="WF-104",
            request_id="REQ-9036",
            outcome="failed",
            approved_by="Elena Vance",
            at=t(20, 8, 15),
            summary="Overdue invoice digest (delivery failed after 3 retries)",
        ),
        Run(
            id="RUN-8841",
            workflow_id="WF-104",
            request_id="REQ-9033",
            outcome="executed",
            approved_by="Elena Vance",
            at=t(19, 8, 2),
            summary="Overdue invoice digest emailed to owner@acme.io",
        ),
        Run(
            id="RUN-8840",
            workflow_id="WF-105",
            request_id="REQ-9034",
            outcome="executed",
            approved_by="Priya Raman",
            at=t(19, 12, 40),
            summary="Low-stock alert posted to #purchasing-ops",
        ),
    ]


# The demo history's (type, label) pairs as registered audit actions.
DEMO_AUDIT_ACTIONS = {
    ("login", "Login"): "login.succeeded",
    ("login", "Login Blocked"): "login.blocked",
    ("api-key", "API Key Created"): "api-key.created",
    ("workflow", "Workflow Approved"): "workflow.approved",
    ("permission", "Role Changed"): "permission.role_changed",
    ("connection", "Credential Rotated"): "connection.credential_rotated",
    ("user", "User Invited"): "user.invited",
}


def _audit() -> list[AuditEntry]:
    rows = [
        ("login", "Login", "Marcus Chen", "SAML SSO (Okta) · Safari on macOS", MARCUS_IP, t(20, 12, 24), None),
        (
            "api-key",
            "API Key Created",
            "Elena Vance",
            "Created BI Export Service, prefix dp_live_••••9f2a (insights:read)",
            ELENA_IP,
            t(20, 11, 40),
            "api-key:key-9f2a",
        ),
        (
            "workflow",
            "Workflow Approved",
            "Elena Vance",
            "Approved REQ-9036 for RUN-8842 (Notify owner when customer invoice becomes overdue)",
            ELENA_IP,
            t(20, 8, 15),
            "run:RUN-8842",
        ),
        ("login", "Login", "Elena Vance", "SAML SSO (Okta) · Chrome on macOS", ELENA_IP, t(20, 8, 2), None),
        ("login", "Login", "Priya Raman", "SAML SSO (Okta) · Chrome on Windows", PRIYA_IP, t(20, 7, 58), None),
        (
            "permission",
            "Role Changed",
            "Marcus Chen",
            "Updated David Park from Analyst to Business Manager",
            MARCUS_IP,
            t(19, 17, 2),
            "member:u-david",
        ),
        (
            "workflow",
            "Workflow Approved",
            "Priya Raman",
            "Approved REQ-9034 for RUN-8840 (Alert purchasing team on low inventory threshold)",
            PRIYA_IP,
            t(19, 12, 40),
            "run:RUN-8840",
        ),
        (
            "connection",
            "Credential Rotated",
            "Elena Vance",
            "Rotated the read-only credential on PostgreSQL — Production ERP",
            ELENA_IP,
            t(19, 9, 15),
            "connection:postgresql-production-erp",
        ),
        (
            "workflow",
            "Workflow Approved",
            "Elena Vance",
            "Approved REQ-9033 for RUN-8841 (Notify owner when customer invoice becomes overdue)",
            ELENA_IP,
            t(19, 8, 2),
            "run:RUN-8841",
        ),
        (
            "login",
            "Login Blocked",
            "Samir Gupta",
            "MFA enrollment required before sign-in",
            "203.0.113.14",
            t(19, 7, 12),
            None,
        ),
        (
            "user",
            "User Invited",
            "Elena Vance",
            "Invited s.gupta@acme.io as Viewer",
            ELENA_IP,
            t(18, 15, 40),
            "member:u-samir",
        ),
        (
            "api-key",
            "API Key Created",
            "Marcus Chen",
            "Created Trust Webhook Reader, prefix dp_live_••••3c81 (trust:read)",
            MARCUS_IP,
            t(2, 10, 15),
            "api-key:key-3c81",
        ),
    ]
    member_ids = {m.name: m.id for m in _members()}
    entries = []
    for n, (ty, label, actor, detail, ip, at, target) in enumerate(rows, 1):
        resource_type, _, resource_id = (target or "").partition(":")
        entries.append(
            AuditEntry(
                # Deterministic UUIDv7: the same id on every run, so seeding is idempotent; its time is the event's.
                id=deterministic_uuid7(at, f"datapilot-demo-audit:{n:03d}"),
                occurred_at=at,
                action=DEMO_AUDIT_ACTIONS[(ty, label)],
                actor_type="user",
                actor_id=member_ids[actor],
                actor_label=actor,
                summary=detail,
                resource_type=resource_type or None,
                resource_id=resource_id or None,
                client=ip,
            )
        )
    return entries


def demo_tenant() -> TenantData:
    return TenantData(
        tenants=InMemoryTenantsRepository.seeded(_members(), _sessions(), _keys(), _workspace()),
        audit=InMemoryAuditRepository(_audit()),
        connect=InMemoryConnectRepository.seeded(_connections(), _runs()),
        trust=InMemoryTrustRepository.seeded(_incidents(), _freshness()),
        automate=InMemoryAutomateRepository.seeded(_workflows(), _requests(), _automate_runs()),
        billing=InMemoryBillingRepository.seeded(
            Subscription(plan="growth", card_last4="4242", storage_gb=18.4),
            [
                Invoice(id=f"INV-2026-{m:02d}", date=date(2026, m, 1), amount_usd=1250, status="paid")
                for m in (11, 10, 9, 8)
            ],
        ),
        notifications=new_notifications(),
        secrets=InMemorySecretStore(),
        queue=InMemoryQueue(),
    )


def demo_registry() -> Registry:
    return Registry({"acme": demo_tenant()})
