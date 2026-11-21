"""Which address a request came from, without trusting what clients claim.

Rules:
- ``X-Forwarded-For`` is used only when the direct peer (the TCP connection) is one of ``DP_TRUSTED_PROXIES``.
  With the default (no trusted proxies) it is always ignored, so a client can't spoof its address.
- With a trusted peer, all X-Forwarded-For values are joined in order and walked right to left; trusted proxies are
  skipped and the first untrusted address is the client. If every hop is trusted, the left-most is used.
- Malformed chains are never half-parsed: an entry that isn't a bare IPv4/IPv6 address (including entries with a
  port), empty entries, more than ``MAX_HOPS`` entries or more than ``MAX_HEADER_BYTES`` in total → the header is
  ignored and the direct peer is used. Nothing here raises.
- Only X-Forwarded-For is read; ``Forwarded`` and ``X-Real-IP`` are ignored.

The result is a string: an IP address, or a non-IP label for the peer (e.g. ``testclient`` under the test client)
or ``unknown``. Audit storage puts IPs in an INET column and labels in a separate text column.
"""

import ipaddress
from collections.abc import Iterable, Sequence

IPNetwork = ipaddress.IPv4Network | ipaddress.IPv6Network

MAX_HOPS = 32
MAX_HEADER_BYTES = 2048


def parse_trusted_proxies(value: str) -> tuple[IPNetwork, ...]:
    """Comma-separated IPs/CIDRs. Raises ValueError on any invalid entry (so misconfiguration stops startup)."""
    networks = []
    for item in (part.strip() for part in value.split(",")):
        if item:
            networks.append(ipaddress.ip_network(item, strict=False))
    return tuple(networks)


def _ip(value: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    try:
        return ipaddress.ip_address(value)
    except ValueError:
        return None


def _trusted(address: ipaddress.IPv4Address | ipaddress.IPv6Address, proxies: Sequence[IPNetwork]) -> bool:
    return any(address.version == net.version and address in net for net in proxies)


def resolve(peer: str | None, forwarded_for: Iterable[str], proxies: Sequence[IPNetwork]) -> str:
    if not peer:
        return "unknown"
    peer_ip = _ip(peer)
    if peer_ip is None or not proxies or not _trusted(peer_ip, proxies):
        return peer
    values = list(forwarded_for)
    joined = ",".join(values)
    if not values or len(joined.encode()) > MAX_HEADER_BYTES:
        return peer
    hops = [h.strip() for h in joined.split(",")]
    if len(hops) > MAX_HOPS or any(not h for h in hops):
        return peer
    addresses = [_ip(h) for h in hops]
    if any(a is None for a in addresses):
        return peer
    for address in reversed(addresses):
        if not _trusted(address, proxies):
            return str(address)
    return str(addresses[0])
