"""Authentication controls the production guard reads: which are implemented, and which are NOT yet.

- **MFA**: implemented in Stage 3B.2 (``app/modules/auth/mfa.py``): ``require_mfa`` is enforced at sign-in and on
  every request, so ``mfa_enforced()`` is true and tenants requiring MFA no longer block production.
- **SSO**: not implemented and not planned for Stage 3B. A tenant's ``enforce_sso`` setting is stored but not
  enforced (password sign-in still works for its members). Production startup is refused while any active tenant has
  ``enforce_sso`` set. The demo tenant has it set, so the demo keeps working in dev/test only.
- **Abuse protection** (Stage 3B.3): no sign-in throttling or rate limits yet. Production startup is refused.

There is intentionally no configuration switch: the only way to lift a block is to implement the control and make the
function below reflect it (SSO has no function: implementing it means replacing the tenant check altogether).
"""


def mfa_enforced() -> bool:
    return True


def abuse_protection_enforced() -> bool:
    return False
