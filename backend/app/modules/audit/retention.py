"""Audit retention enforcement: NOT IMPLEMENTED.

Tenants have an ``audit_retention_days`` setting (90 or 365), but nothing deletes expired events yet: purging needs
a dedicated, owner-run procedure because the runtime user can't delete audit rows (by design) and a trigger blocks
deletes for everyone. Until that procedure exists and is tested, the setting is stored but **not enforced**, and
production startup is refused (``app/core/readiness.py``).

There is intentionally no configuration switch to bypass this: the only way to lift the production block is to
implement enforcement here and make ``is_enforced`` reflect it.
"""


def is_enforced() -> bool:
    return False
