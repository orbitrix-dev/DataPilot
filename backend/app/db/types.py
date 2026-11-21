"""Shared column value types."""

import ipaddress

# What psycopg returns for PostgreSQL INET host addresses.
IPAddress = ipaddress.IPv4Address | ipaddress.IPv6Address
