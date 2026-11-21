"""Client address resolution: X-Forwarded-For is trusted only from configured proxies and fails safe when malformed."""

import pytest
from pydantic import ValidationError

from app.core.client_address import MAX_HOPS, parse_trusted_proxies, resolve
from app.core.config import Settings

PROXIES = parse_trusted_proxies("10.0.0.0/8, 192.168.1.5, 2001:db8::/32")


def test_without_trusted_proxies_forwarded_headers_are_ignored():
    assert resolve("203.0.113.9", ["198.51.100.1"], ()) == "203.0.113.9"


def test_an_untrusted_peer_cannot_spoof_its_address():
    assert resolve("203.0.113.9", ["198.51.100.1"], PROXIES) == "203.0.113.9"


def test_a_trusted_proxy_chain_yields_the_right_most_untrusted_address():
    # client 198.51.100.7 → (spoofed entry prepended by the client) → proxies 10.1.1.1 → 10.0.0.2 (peer)
    assert resolve("10.0.0.2", ["1.2.3.4, 198.51.100.7, 10.1.1.1"], PROXIES) == "198.51.100.7"


def test_multiple_forwarded_headers_are_joined_in_order():
    assert resolve("10.0.0.2", ["198.51.100.7", "10.1.1.1"], PROXIES) == "198.51.100.7"


def test_ipv6_chains_work():
    assert resolve("2001:db8::1", ["2001:db8:ffff::9, 2400:cb00::1"], PROXIES) == "2400:cb00::1"


def test_all_trusted_hops_fall_back_to_the_left_most():
    assert resolve("10.0.0.2", ["10.9.9.9, 10.1.1.1"], PROXIES) == "10.9.9.9"


@pytest.mark.parametrize(
    "header",
    [
        "198.51.100.7, not-an-ip",
        "198.51.100.7:4711",  # ports are not accepted
        "198.51.100.7,,10.1.1.1",  # empty entry
        "",  # empty header
        ", ".join(["198.51.100.7"] * (MAX_HOPS + 1)),  # too many hops
        "1" * 2049,  # too long
        "[2001:db8::1]",  # bracketed form
    ],
)
def test_malformed_chains_are_ignored_entirely(header):
    assert resolve("10.0.0.2", [header], PROXIES) == "10.0.0.2"


def test_non_ip_peers_and_missing_peers():
    assert resolve("testclient", ["198.51.100.7"], PROXIES) == "testclient"
    assert resolve(None, [], PROXIES) == "unknown"


def test_invalid_trusted_proxy_configuration_stops_startup():
    with pytest.raises(ValidationError, match="does not appear to be an IPv4 or IPv6 network"):
        Settings(trusted_proxies="10.0.0.0/8, nonsense")
    assert Settings(trusted_proxies="").trusted_proxy_networks == ()


def test_the_api_records_the_resolved_address_and_ignores_spoofed_headers_by_default(client):
    client.post("/members/invitations", json={"email": "spoof@acme.io"}, headers={"X-Forwarded-For": "1.2.3.4"})
    newest = client.get("/audit-events", params={"limit": 1}).json()["items"][0]
    assert newest["detail"] == "Invited spoof@acme.io as Analyst"
    assert newest["ip"] == "testclient"  # the direct peer (a label, stored in client_label), not the header
