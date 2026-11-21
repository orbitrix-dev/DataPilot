"""Authentication controls that are NOT IMPLEMENTED yet, as code the production guard reads.

- **MFA** (Stage 3B.2): sign-in does not ask for a second factor, so a tenant's ``require_mfa`` setting is stored but
  not enforced. Production startup is refused while any active tenant requires MFA.
- **SSO**: not implemented and not planned for Stage 3B. A tenant's ``enforce_sso`` setting is stored but not
  enforced (password sign-in still works for its members). Production startup is refused while any active tenant has
  ``enforce_sso`` set. The demo tenant has it set, so the demo keeps working in dev/test only.
- **Abuse protection** (Stage 3B.3): no sign-in throttling or rate limits yet. Production startup is refused.

There is intentionally no configuration switch: the only way to lift a block is to implement the control and make the
function below reflect it (SSO has no function: implementing it means replacing the tenant check altogether).
"""


def mfa_enforced() -> bool:
    return False


def abuse_protection_enforced() -> bool:
    return False
