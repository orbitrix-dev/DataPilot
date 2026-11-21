from .conftest import as_user, audit_events


def test_connections_never_expose_credentials(client):
    rows = client.get("/connect/connections").json()
    assert len(rows) == 5
    assert all("credential_ref" not in r for r in rows)
    assert next(r for r in rows if r["id"] == "amazon-s3-raw-orders")["status"] == "failed"


def test_rotating_credentials_uses_the_secret_store(client, registry):
    r = client.put("/connect/connections/amazon-s3-raw-orders/credentials", json={"secret": "AKIA-new"})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "healthy" and body["issue"] is None and body["credentials_rotated_by"] == "Elena Vance"
    stored = registry.get("acme").connect.connections.get("amazon-s3-raw-orders")
    assert registry.get("acme").secrets.exists(stored.credential_ref)
    assert "AKIA-new" not in r.text
    assert audit_events(client, type="connection")[0]["detail"] == (
        "Rotated the read-only credential on Amazon S3 — Raw Orders"
    )


def test_rotation_needs_full_connect_access(client):
    r = client.put(
        "/connect/connections/amazon-s3-raw-orders/credentials", json={"secret": "x"}, headers=as_user("u-david")
    )
    assert r.status_code == 403
    assert r.json()["error"]["details"]["current"] == "Read"


def test_manual_sync_is_queued(client, registry):
    r = client.post("/connect/connections/postgresql-production-erp/sync")
    assert r.status_code == 202
    msg = registry.get("acme").queue.messages[-1]
    assert msg.topic == "connect.sync-jobs" and msg.body["run_id"] == r.json()["run"]["id"]
    assert client.post("/connect/connections/q4-regional-sales-export/sync").status_code == 409


def test_trust_gate_holds_approvals_until_acknowledged(client):
    pending = {r["id"]: r for r in client.get("/automate/approvals", params={"status": "pending"}).json()}
    assert [i["reference"] for i in pending["REQ-9040"]["trust"]] == ["INC-204"]
    assert {i["kind"] for i in pending["REQ-9038"]["trust"]} == {"incident", "freshness"}
    assert pending["REQ-9041"]["trust"] == []

    held = client.post("/automate/approvals/REQ-9040/approve", json={})
    assert held.status_code == 409
    assert held.json()["error"]["details"]["issues"][0]["reference"] == "INC-204"

    ok = client.post("/automate/approvals/REQ-9040/approve", json={"acknowledge_trust_warning": True})
    assert ok.json()["status"] == "approved" and ok.json()["run_id"] == "RUN-8843"
    detail = audit_events(client, type="workflow")[0]["detail"]
    assert detail.startswith("Approved REQ-9040 for RUN-8843") and "INC-204" in detail
    assert client.post("/automate/approvals/REQ-9040/approve", json={}).status_code == 409


def test_resolving_the_incident_clears_the_gate(client):
    assert client.post("/trust/incidents/INC-204/resolve", json={"note": "deduplicated"}).status_code == 200
    assert client.get("/trust/datasets/public.invoices/status").json() == {
        "dataset": "public.invoices",
        "verified": True,
        "issues": [],
    }
    assert client.post("/automate/approvals/REQ-9040/approve", json={}).status_code == 200


def test_analysts_cannot_approve(client):
    r = client.post("/automate/approvals/REQ-9041/approve", json={}, headers=as_user("u-lena"))
    assert r.status_code == 403


def test_reject_is_audited(client):
    r = client.post("/automate/approvals/REQ-9038/reject", json={"reason": "Feed is stale"})
    assert r.json()["status"] == "rejected"
    assert audit_events(client, type="workflow")[0]["detail"] == (
        "Rejected REQ-9038 (Alert purchasing team on low inventory threshold): “Feed is stale”"
    )


def test_usage_reads_connect_and_members(client):
    u = client.get("/billing/usage").json()
    assert (u["sources"], u["rows"], u["seats"], u["storage_gb"]) == (4, 1_428_910, 12, 18.4)


def test_plan_change_follows_the_matrix(client):
    # Elena (Administrator) has no billing rights: the change becomes a request to the Owner.
    r = client.post("/billing/plan-change", json={"plan": "scale"})
    assert r.json()["status"] == "requested"
    assert audit_events(client, type="billing")[0]["detail"] == "Asked Marcus Chen to move to Enterprise Scale"
    # Downgrades are blocked while usage exceeds the smaller plan.
    down = client.post("/billing/plan-change", json={"plan": "team"}, headers=as_user("u-marcus"))
    assert down.status_code == 409
    assert len(down.json()["error"]["details"]["blockers"]) == 2
    up = client.post("/billing/plan-change", json={"plan": "scale"}, headers=as_user("u-marcus"))
    assert up.json()["status"] == "changed" and up.json()["subscription"]["plan"]["id"] == "scale"


def test_notification_preferences(client):
    prefs = client.put("/notifications/preferences/approvals", json={"enabled": False}).json()
    assert next(p for p in prefs if p["category"] == "approvals")["enabled"] is False
    assert audit_events(client)[0]["detail"] == "Disabled Automate Approval Requests"


def test_insights_and_intelligence_are_explicitly_unimplemented(client):
    assert client.get("/insights/dashboard").status_code == 501
    assert client.post("/intelligence/questions", json={"question": "Who is overdue?"}).status_code == 501


def test_audit_search_and_paging(client):
    page = client.get("/audit-events", params={"limit": 3}).json()
    assert page["total"] == 12 and len(page["items"]) == 3
    assert page["items"][0]["detail"] == "SAML SSO (Okta) · Safari on macOS"
    found = client.get("/audit-events", params={"q": "run-8842"}).json()["items"]
    assert [e["target"] for e in found] == ["run:RUN-8842"]
