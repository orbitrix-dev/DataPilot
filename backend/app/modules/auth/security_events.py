"""Security events for rejected requests, written through ``SecurityAuditWriter`` (an independent transaction), so
they survive the error response that rolls the request back.

What is recorded: the action, a reason code, the account when it is known, the tenant when it is known, and the
client address. What is never recorded: the presented password, code, token or API key, or the email address typed
for an account that doesn't exist (attacker-controlled, and sometimes a mistyped password).

Volume: until Stage 3B.3 adds rate limiting, an unauthenticated flood writes one row per attempt. Production stays
blocked until then (``app/core/readiness.py``).
"""

import logging
import uuid
from typing import Any, Protocol

from fastapi import Request

from app.modules.identity.models import User

from .service import FailureHook

log = logging.getLogger(__name__)

_SUMMARIES = {
    "unknown_account": "Sign-in failed: unknown account",
    "no_password": "Sign-in failed: the account has no password yet",
    "wrong_password": "Sign-in failed: wrong password",
    "account_disabled": "Sign-in failed: the account is disabled",
    "no_active_membership": "Sign-in failed: no active membership in the requested workspace",
    "mfa_required": "Sign-in refused: correct password, but no authenticator or recovery code",
    "mfa_invalid": "Sign-in failed: invalid authenticator code",
    "recovery_code_invalid": "Sign-in failed: invalid recovery code",
    "tenant_suspended": "Sign-in blocked: the workspace is suspended",
    "mfa_enrollment_required": "MFA enrollment required before sign-in",
    "invalid_key": "Rejected an unknown, revoked or expired API key",
    "step_up_invalid": "API key creation refused: invalid verification code",
    "step_up_not_enrolled": "API key creation refused: MFA is not enabled",
    "recovery_code_regeneration_step_up_failed": "Recovery code regeneration refused: invalid or reused code",
    "recovery_code_regeneration_not_enrolled": "Recovery code regeneration refused: MFA is not enabled",
}


class SecurityAudit(Protocol):
    def record(
        self,
        action: str,
        summary: str,
        *,
        tenant_id: uuid.UUID | None = None,
        actor_type: str = "anonymous",
        actor_id: str | None = None,
        actor_label: str = "Anonymous",
        client: str = "",
        resource: tuple[str, str | None] | None = None,
        metadata: dict | None = None,
    ) -> bool: ...

    def health(self) -> dict[str, Any]: ...


def writer_for(request: Request) -> SecurityAudit | None:
    return getattr(request.app.state, "security_audit", None)


def record_rejection(
    writer: SecurityAudit | None,
    action: str,
    reason: str,
    *,
    client: str,
    user: User | None = None,
    actor_type: str = "user",
    actor_id: str | None = None,
    actor_label: str | None = None,
    tenant_id: uuid.UUID | None = None,
) -> bool:
    """Records the rejection. Returns False (and logs a WARNING with the action and reason only) if it could not be
    persisted; the caller's response is never affected."""
    if writer is None:
        return False
    persisted = writer.record(
        action,
        _SUMMARIES[reason],
        tenant_id=tenant_id,
        actor_type=actor_type if (user is not None or actor_id) else "anonymous",
        actor_id=user.public_id if user is not None else actor_id,
        actor_label=user.full_name if user is not None else (actor_label or "Anonymous"),
        client=client,
        metadata={"reason": reason},
    )
    if not persisted:
        log.warning("Security event NOT persisted: action=%s reason=%s", action, reason)
    return persisted


def login_failure_hook(request: Request, client: str) -> FailureHook:
    writer = writer_for(request)

    def hook(action: str, reason: str, user: User | None, tenant_id: uuid.UUID | None) -> None:
        record_rejection(writer, action, reason, client=client, user=user, tenant_id=tenant_id)

    return hook
