import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.seed import demo_registry


@pytest.fixture
def registry():
    return demo_registry()


@pytest.fixture
def client(registry) -> TestClient:
    """A fresh app and demo tenant per test. Requests act as Elena Vance (Administrator) unless `as_user` is passed."""
    return TestClient(create_app(Settings(env="test"), registry), base_url="http://testserver/api/v1")


def as_user(user_id: str) -> dict[str, str]:
    return {"X-DataPilot-User": user_id}


def audit_events(client: TestClient, **params) -> list[dict]:
    return client.get("/audit-events", params=params).json()["items"]
