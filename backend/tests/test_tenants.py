from .conftest import as_user, audit_events


def test_seed_matches_the_admin_ui(client):
    members = client.get("/members").json()
    assert len(members) == 12
    counts = {r["id"]: r["members"] for r in client.get("/roles").json()}
    assert counts == {"owner": 1, "admin": 2, "manager": 3, "analyst": 4, "viewer": 2}


def test_invite_validates_and_audits(client):
    assert client.post("/members/invitations", json={"email": "not-an-email"}).status_code == 422
    dup = client.post("/members/invitations", json={"email": "E.Vance@acme.io"})
    assert dup.status_code == 409
    assert client.post("/members/invitations", json={"email": "x@acme.io", "role": "owner"}).status_code == 403

    r = client.post("/members/invitations", json={"email": "new.person@acme.io", "role": "analyst"})
    assert r.status_code == 201
    assert r.json() | {"id": None} == {
        "id": None,
        "name": "New Person",
        "email": "new.person@acme.io",
        "title": "Invitation pending",
        "role": "analyst",
        "status": "invited",
        "mfa": "pending",
        "last_active_at": None,
        "ip": None,
    }
    assert audit_events(client)[0]["detail"] == "Invited new.person@acme.io as Analyst"


def test_seat_limit(client):
    for n in range(13):
        assert client.post("/members/invitations", json={"email": f"p{n}@acme.io"}).status_code == 201
    r = client.post("/members/invitations", json={"email": "one.too.many@acme.io"})
    assert r.status_code == 409
    assert "All 25 seats" in r.json()["error"]["message"]


def test_role_changes_are_guarded(client):
    assert client.patch("/members/u-marcus/role", json={"role": "viewer"}).status_code == 403  # the Owner
    assert client.patch("/members/u-elena/role", json={"role": "viewer"}).status_code == 403  # yourself
    r = client.patch("/members/u-david/role", json={"role": "analyst"})
    assert r.json()["role"] == "analyst"
    assert audit_events(client, type="permission")[0]["detail"] == "Updated David Park from Business Manager to Analyst"


def test_only_admins_manage_users(client):
    assert client.get("/members", headers=as_user("u-david")).status_code == 403
    assert (
        client.post("/members/invitations", json={"email": "a@acme.io"}, headers=as_user("u-lena")).status_code == 403
    )


def test_revoke_ends_sessions(client):
    assert client.delete("/members/u-david").status_code == 204
    assert all(s["member_id"] != "u-david" for s in client.get("/sessions").json())
    assert audit_events(client)[0]["event"] == "Access Revoked"


def test_matrix_save_validates_and_logs_each_change(client):
    bad = client.put("/permissions", json={"values": {"trust": {"viewer": "Admin"}}})
    assert bad.status_code == 409
    owner = client.put("/permissions", json={"values": {"admin": {"owner": "None"}}})
    assert owner.status_code == 403

    r = client.put("/permissions", json={"values": {"trust": {"viewer": "None"}, "admin": {"admin": "Full"}}})
    assert r.status_code == 200
    details = [e["detail"] for e in audit_events(client, type="permission")[:2]]
    assert "Viewer · Trust: Resolve incidents & rules: View → None" in details
    assert client.get("/trust/incidents", headers=as_user("u-nora")).status_code == 403


def test_api_key_secret_is_shown_once(client):
    assert client.post("/api-keys", json={"name": "X", "scopes": ["trust:read"], "mfa_code": "12"}).status_code == 422
    r = client.post("/api-keys", json={"name": "Warehouse Sync", "scopes": ["trust:read"], "mfa_code": "123456"})
    assert r.status_code == 201
    secret, key = r.json()["secret"], r.json()["key"]
    assert secret.startswith("dp_live_") and key["prefix"].endswith(secret[-4:])
    listed = next(k for k in client.get("/api-keys").json() if k["id"] == key["id"])
    assert "secret" not in listed and "secret_hash" not in listed


def test_deletion_requires_billing_rights(client):
    r = client.post("/settings/organization/deletion", json={"confirm_name": "Acme Global Corp"})
    assert r.status_code == 403
    assert r.json()["error"]["details"]["current"] == "None"
    owner = as_user("u-marcus")
    assert (
        client.post("/settings/organization/deletion", json={"confirm_name": "acme"}, headers=owner).status_code == 409
    )
    ok = client.post("/settings/organization/deletion", json={"confirm_name": "Acme Global Corp"}, headers=owner)
    assert ok.json()["deletion_scheduled_for"] is not None
    assert client.delete("/settings/organization/deletion", headers=owner).json()["deletion_scheduled_for"] is None


def test_policy_and_org_changes_are_audited(client):
    client.put("/settings/security", json={"require_mfa": False, "enforce_sso": True, "session_timeout_hours": 8})
    client.put(
        "/settings/organization",
        json={"name": "Acme Holdings", "industry": "Retail", "timezone": "UTC", "audit_retention_days": 365},
    )
    details = [e["detail"] for e in audit_events(client, type="settings")]
    assert 'Disabled "Require MFA for all users"' in details
    assert "Session timeout set to 8 hours idle" in details
    assert "Organization name: Acme Global Corp → Acme Holdings" in details
    assert "Primary industry: Wholesale & Distribution → Retail" in details
