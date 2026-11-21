import pytest


@pytest.fixture
def trust_key(client) -> dict[str, str]:
    r = client.post("/api-keys", json={"name": "Reader", "scopes": ["trust:read"], "mfa_code": "000000"})
    return {"Authorization": f"Bearer {r.json()['secret']}"}


def test_key_reads_its_scope(client, trust_key):
    r = client.get("/trust/incidents", headers=trust_key)
    assert r.status_code == 200 and len(r.json()) == 3


def test_key_is_read_only(client, trust_key):
    r = client.post("/trust/incidents/INC-204/resolve", json={}, headers=trust_key)
    assert r.status_code == 403
    assert r.json()["error"]["message"] == "API keys are read-only"


def test_key_is_limited_to_its_scopes(client, trust_key):
    assert client.get("/connect/connections", headers=trust_key).status_code == 403
    assert client.get("/members", headers=trust_key).status_code == 403
    assert client.get("/audit-events", headers=trust_key).status_code == 403


def test_key_use_is_recorded_and_revocation_is_immediate(client, trust_key):
    client.get("/trust/freshness", headers=trust_key)
    key = next(k for k in client.get("/api-keys").json() if k["name"] == "Reader")
    assert key["last_used_at"] is not None
    client.post(f"/api-keys/{key['id']}/revoke")
    assert client.get("/trust/freshness", headers=trust_key).status_code == 401


def test_bad_key(client):
    assert client.get("/trust/freshness", headers={"Authorization": "Bearer dp_live_nope"}).status_code == 401
