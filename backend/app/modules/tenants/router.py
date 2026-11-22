from typing import Annotated

from fastapi import APIRouter, Depends, Request, status
from pydantic import BaseModel

from app.core.config import Settings, get_settings
from app.core.context import RequestContext
from app.core.db import DbSession
from app.deps import Ctx, admins, need, scope
from app.modules.auth import mfa, security_events

from . import service
from .schemas import (
    ApiKeyCreated,
    ApiKeyCreateIn,
    ApiKeyOut,
    InviteIn,
    MatrixRow,
    MatrixUpdate,
    Me,
    Member,
    OrgSettings,
    RoleChangeIn,
    RoleId,
    RoleWithCount,
    SecurityPolicy,
    Session,
    Workspace,
)

# No API key scope covers tenant administration, so keys are refused on every route here.
router = APIRouter(tags=["tenants"], dependencies=[scope("admin")])


@router.get("/me")
def get_me(ctx: Ctx) -> Me:
    return service.me(ctx)


@router.get("/members")
def list_members(role: RoleId | None = None, ctx: RequestContext = admins()) -> list[Member]:
    return service.list_members(ctx, role)


@router.post("/members/invitations", status_code=status.HTTP_201_CREATED)
def invite(body: InviteIn, ctx: RequestContext = admins()) -> Member:
    return service.invite(ctx, body)


@router.patch("/members/{member_id}/role")
def change_role(member_id: str, body: RoleChangeIn, ctx: RequestContext = admins()) -> Member:
    return service.change_role(ctx, member_id, body)


@router.delete("/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke(member_id: str, ctx: RequestContext = admins()) -> None:
    service.revoke(ctx, member_id)


@router.get("/roles")
def list_roles(ctx: Ctx) -> list[RoleWithCount]:
    return service.list_roles(ctx)


@router.get("/permissions")
def get_permissions(ctx: Ctx) -> list[MatrixRow]:
    return service.get_matrix(ctx)


@router.put("/permissions")
def save_permissions(body: MatrixUpdate, ctx: RequestContext = admins()) -> list[MatrixRow]:
    return service.save_matrix(ctx, body.values)


@router.get("/settings/security")
def get_security(ctx: RequestContext = admins()) -> SecurityPolicy:
    return service.get_policy(ctx)


@router.put("/settings/security")
def set_security(body: SecurityPolicy, ctx: RequestContext = admins()) -> SecurityPolicy:
    return service.set_policy(ctx, body)


@router.get("/sessions")
def list_sessions(ctx: RequestContext = admins()) -> list[Session]:
    return service.list_sessions(ctx)


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_session(session_id: str, ctx: RequestContext = admins()) -> None:
    service.revoke_session(ctx, session_id)


@router.get("/api-keys")
def list_keys(ctx: RequestContext = admins()) -> list[ApiKeyOut]:
    return service.list_keys(ctx)


@router.post("/api-keys", status_code=status.HTTP_201_CREATED)
def create_key(
    body: ApiKeyCreateIn,
    request: Request,
    db: DbSession,
    settings: Annotated[Settings, Depends(get_settings)],
    ctx: RequestContext = admins(),
) -> ApiKeyCreated:
    """Step-up: ``mfa_code`` must be a fresh code from the acting user's confirmed authenticator. Failed attempts are
    recorded by SecurityAuditWriter (the request rolls back)."""
    try:
        mfa.require_step_up(
            db,
            settings,
            ctx.principal.id,
            body.mfa_code,
            throttle=security_events.throttle_for(request),
            client=ctx.ip,
            tenant_id=ctx.tenant_uuid,
        )
    except (mfa.StepUpFailed, mfa.MfaEnrollmentRequired) as exc:
        security_events.record_rejection(
            security_events.writer_for(request),
            "api-key.step_up_failed",
            "step_up_invalid" if isinstance(exc, mfa.StepUpFailed) else "step_up_not_enrolled",
            client=ctx.ip,
            actor_id=ctx.principal.id,
            actor_label=ctx.principal.name,
            tenant_id=ctx.tenant_uuid,
        )
        raise
    return service.create_key(ctx, body)


@router.post("/api-keys/{key_id}/revoke")
def revoke_key(key_id: str, ctx: RequestContext = admins()) -> ApiKeyOut:
    return service.revoke_key(ctx, key_id)


@router.get("/settings/organization")
def get_org(ctx: Ctx) -> OrgSettings:
    return service.get_org(ctx)


@router.put("/settings/organization")
def save_org(body: OrgSettings, ctx: RequestContext = admins()) -> OrgSettings:
    return service.save_org(ctx, body)


class DeletionIn(BaseModel):
    confirm_name: str


@router.post("/settings/organization/deletion")
def schedule_deletion(body: DeletionIn, ctx: RequestContext = need("admin", "Full")) -> Workspace:
    return service.schedule_deletion(ctx, body.confirm_name)


@router.delete("/settings/organization/deletion")
def cancel_deletion(ctx: RequestContext = need("admin", "Full")) -> Workspace:
    return service.cancel_deletion(ctx)
