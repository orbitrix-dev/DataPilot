from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.seed import demo_registry

from .conftest import as_user


def test_health(client):
    r = TestClient(create_app(Settings(env="test"))).get("/healthz")
    assert r.json() == {"status": "ok", "env": "test"}


def test_me_defaults_to_dev_user(client):
    me = client.get("/me").json()
    assert me["member"]["name"] == "Elena Vance"
    assert me["member"]["role"] == "admin"
    assert me["permissions"]["admin"] == "None"


def test_unknown_user_and_tenant_are_rejected(client):
    assert client.get("/me", headers=as_user("u-nobody")).status_code == 401
    assert client.get("/me", headers={"X-DataPilot-Tenant": "globex"}).status_code == 401


def test_dev_headers_are_ignored_in_prod():
    # Prod requires a database URL; this one is never contacted because /me doesn't use the database yet.
    settings = Settings(env="prod", database_url="postgresql+psycopg://unused@127.0.0.1:1/unused")
    prod = TestClient(create_app(settings, demo_registry()), base_url="http://testserver/api/v1")
    r = prod.get("/me", headers=as_user("u-elena"))
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "unauthorized"


def test_errors_use_one_shape(client):
    r = client.get("/trust/incidents/INC-999")
    assert r.status_code == 404
    assert r.json() == {"error": {"code": "not_found", "message": "Incident 'INC-999' not found"}}
