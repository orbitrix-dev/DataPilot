import hashlib
import secrets
from datetime import timedelta
from uuid import uuid4

from app.core import clock
from app.core.context import RequestContext
from app.core.errors import Conflict, Forbidden, NotFound
from app.modules.audit import service as audit
from app.modules.billing.schemas import PLANS

from .schemas import (
    CAPABILITY_LABEL,
    CAPABILITY_LEVELS,
    ROLE_IDS,
    ROLE_LABEL,
    ROLES,
    ApiKeyCreated,
    ApiKeyCreateIn,
    ApiKeyOut,
    ApiKeyRecord,
    CapabilityId,
    InviteIn,
    Matrix,
    MatrixRow,
    Me,
    Member,
    OrgSettings,
    RoleChangeIn,
    RoleWithCount,
    SecurityPolicy,
    Session,
    Workspace,
)

# ------------------------------------------------------------------ identity


def workspace(ctx: RequestContext) -> Workspace:
    return ctx.data.tenants.workspace.get("workspace")


def permissions_for(ws: Workspace, role: str) -> dict[CapabilityId, str]:
    return {cap: ws.matrix[cap][role] for cap in CAPABILITY_LEVELS}  # type: ignore[index]


def me(ctx: RequestContext) -> Me:
    if ctx.principal.kind != "user":
        raise Forbidden("API keys have no member profile")
    member = ctx.data.tenants.members.get(ctx.principal.id)
    return Me(tenant_id=ctx.tenant_id, member=member, permissions=permissions_for(workspace(ctx), member.role))


def hash_secret(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


# ------------------------------------------------------------------- members


def list_members(ctx: RequestContext, role: str | None = None) -> list[Member]:
    members = ctx.data.tenants.members.list()
    return [m for m in members if role is None or m.role == role]


def _label(m: Member) -> str:
    return m.email if m.status == "invited" else m.name


def invite(ctx: RequestContext, body: InviteIn) -> Member:
    repo = ctx.data.tenants
    members = repo.members.list()
    if body.role == "owner":
        raise Forbidden("Ownership can only be transferred by the current Owner")
    if any(m.email == body.email for m in members):
        raise Conflict(f"{body.email} is already a member or has a pending invitation")
    plan = PLANS[ctx.data.billing.subscription.get("subscription").plan]
    if len(members) >= plan.seats:
        raise Conflict(f"All {plan.seats} seats on {plan.name} are in use", seats=plan.seats)
    name = " ".join(
        w.capitalize() for w in body.email.split("@")[0].replace("_", ".").replace("-", ".").split(".") if w
    )
    member = Member(
        id=f"u-{uuid4().hex[:10]}",
        name=name,
        email=body.email,
        title="Invitation pending",
        role=body.role,
        status="invited",
        mfa="pending",
    )
    # The stored member: an existing user (e.g. a member of another tenant) keeps their own id.
    member = repo.members.put(member)
    audit.record(
        ctx,
        "user.invited",
        f"Invited {body.email} as {ROLE_LABEL[body.role]}",
        resource=("member", member.id),
        metadata={"email": body.email, "role": body.role},
    )
    return member


def _editable(ctx: RequestContext, member_id: str) -> Member:
    m = ctx.data.tenants.members.get(member_id)
    if m.role == "owner":
        raise Forbidden("The Organization Owner's access can't be changed here")
    if m.id == ctx.principal.id:
        raise Forbidden("You can't change your own access; ask the Owner")
    return m


def change_role(ctx: RequestContext, member_id: str, body: RoleChangeIn) -> Member:
    m = _editable(ctx, member_id)
    if body.role == "owner":
        raise Forbidden("Ownership can only be transferred by the current Owner")
    if body.role == m.role:
        return m
    before = m.role
    m.role = body.role
    ctx.data.tenants.members.put(m)
    audit.record(
        ctx,
        "permission.role_changed",
        f"Updated {_label(m)} from {ROLE_LABEL[before]} to {ROLE_LABEL[body.role]}",
        resource=("member", m.id),
        metadata={"from_role": before, "to_role": body.role},
    )
    return m


def revoke(ctx: RequestContext, member_id: str) -> None:
    m = _editable(ctx, member_id)
    repo = ctx.data.tenants
    repo.members.delete(m.id)
    for s in repo.sessions.list():
        if s.member_id == m.id:
            repo.sessions.delete(s.id)
    if m.status == "invited":
        audit.record(
            ctx, "user.invitation_cancelled", f"Cancelled the invitation for {m.email}", metadata={"email": m.email}
        )
    else:
        audit.record(
            ctx,
            "user.access_revoked",
            f"Revoked {m.name}'s access ({ROLE_LABEL[m.role]}) and ended their sessions",
            metadata={"role": m.role},
        )


# -------------------------------------------------------- roles & permissions


def list_roles(ctx: RequestContext) -> list[RoleWithCount]:
    members = ctx.data.tenants.members.list()
    return [RoleWithCount(**r.model_dump(), members=sum(m.role == r.id for m in members)) for r in ROLES]


def get_matrix(ctx: RequestContext) -> list[MatrixRow]:
    ws = workspace(ctx)
    return [
        MatrixRow(capability=cap, label=CAPABILITY_LABEL[cap], levels=levels, values=ws.matrix[cap])
        for cap, levels in CAPABILITY_LEVELS.items()
    ]


def save_matrix(ctx: RequestContext, values: Matrix) -> list[MatrixRow]:
    ws = workspace(ctx)
    changes: list[tuple[str, dict[str, str]]] = []
    for cap, levels in CAPABILITY_LEVELS.items():
        row = values.get(cap, {})
        for role in ROLE_IDS:
            after = row.get(role, ws.matrix[cap][role])
            if after not in levels:
                raise Conflict(f"{after!r} is not a valid level for {CAPABILITY_LABEL[cap]}", allowed=list(levels))
            before = ws.matrix[cap][role]
            if role == "owner" and after != before:
                raise Forbidden("The Organization Owner always keeps full access")
            if after != before:
                ws.matrix[cap][role] = after
                changes.append(
                    (
                        f"{ROLE_LABEL[role]} · {CAPABILITY_LABEL[cap]}: {before} → {after}",
                        {"role": role, "capability": cap, "from_level": before, "to_level": after},
                    )
                )
    if changes:
        ctx.data.tenants.workspace.put(ws)
        for summary, detail in changes:
            audit.record(ctx, "permission.matrix_changed", summary, resource=("permissions", None), metadata=detail)
    return get_matrix(ctx)


# ------------------------------------------------------------------ security


def get_policy(ctx: RequestContext) -> SecurityPolicy:
    return workspace(ctx).policy


def set_policy(ctx: RequestContext, body: SecurityPolicy) -> SecurityPolicy:
    ws = workspace(ctx)
    before = ws.policy
    labels = {
        "require_mfa": lambda v: f'{"Enabled" if v else "Disabled"} "Require MFA for all users"',
        "enforce_sso": lambda v: f'{"Enabled" if v else "Disabled"} "Enforce SAML SSO (Okta)"',
        "session_timeout_hours": lambda v: f"Session timeout set to {v} hours idle",
    }
    changed = [k for k in labels if getattr(before, k) != getattr(body, k)]
    ws.policy = body
    ctx.data.tenants.workspace.put(ws)
    for k in changed:
        audit.record(
            ctx,
            "settings.security_policy_changed",
            labels[k](getattr(body, k)),
            resource=("security", None),
            metadata={"setting": k, "value": str(getattr(body, k))},
        )
    return body


def list_sessions(ctx: RequestContext) -> list[Session]:
    return sorted(ctx.data.tenants.sessions.list(), key=lambda s: s.signed_in_at, reverse=True)


def revoke_session(ctx: RequestContext, session_id: str) -> None:
    repo = ctx.data.tenants
    s = repo.sessions.get(session_id)
    if s.member_id == ctx.principal.id:
        raise Forbidden("Sign out instead of revoking your own session")
    who = repo.members.find(s.member_id)
    repo.sessions.delete(s.id)
    audit.record(
        ctx,
        "login.session_revoked",
        f"Ended {who.name if who else s.member_id}'s session ({s.device}, {s.ip})",
        resource=("security", None),
        metadata={"session_id": s.id, "device": s.device},
    )


# ------------------------------------------------------------------ API keys


def _out(k: ApiKeyRecord) -> ApiKeyOut:
    return ApiKeyOut(**k.model_dump(exclude={"secret_hash"}))


def list_keys(ctx: RequestContext) -> list[ApiKeyOut]:
    return [_out(k) for k in sorted(ctx.data.tenants.api_keys.list(), key=lambda k: k.created_at, reverse=True)]


def create_key(ctx: RequestContext, body: ApiKeyCreateIn) -> ApiKeyCreated:
    repo = ctx.data.tenants
    name = body.name.strip()
    if any(k.name.lower() == name.lower() and not k.revoked_at for k in repo.api_keys.list()):
        raise Conflict("An active key already has this name")
    secret = f"dp_live_{secrets.token_hex(20)}"
    key = ApiKeyRecord(
        id=f"key_{uuid4().hex[:12]}",
        name=name,
        prefix=f"dp_live_••••{secret[-4:]}",
        scopes=sorted(set(body.scopes)),
        created_by=ctx.principal.name,
        created_at=clock.now(),
        secret_hash=hash_secret(secret),
    )
    repo.api_keys.put(key)
    audit.record(
        ctx,
        "api-key.created",
        f"Created {name}, prefix {key.prefix} ({', '.join(key.scopes)})",
        resource=("api-key", key.id),
        metadata={"name": name, "prefix": key.prefix, "scopes": list(key.scopes)},
    )
    return ApiKeyCreated(key=_out(key), secret=secret)


def revoke_key(ctx: RequestContext, key_id: str) -> ApiKeyOut:
    repo = ctx.data.tenants
    k = repo.api_keys.get(key_id)
    if k.revoked_at:
        return _out(k)
    k.revoked_at = clock.now()
    repo.api_keys.put(k)
    audit.record(
        ctx,
        "api-key.revoked",
        f"Revoked {k.name} ({k.prefix})",
        resource=("api-key", k.id),
        metadata={"name": k.name, "prefix": k.prefix},
    )
    return _out(k)


def find_key_by_secret(repo_keys: list[ApiKeyRecord], secret: str) -> ApiKeyRecord | None:
    digest = hash_secret(secret)
    for k in repo_keys:
        if secrets.compare_digest(k.secret_hash, digest) and not k.revoked_at:
            return k
    return None


# -------------------------------------------------------------- organization


def get_org(ctx: RequestContext) -> OrgSettings:
    return workspace(ctx).org


def save_org(ctx: RequestContext, body: OrgSettings) -> OrgSettings:
    ws = workspace(ctx)
    labels = {
        "name": "Organization name",
        "industry": "Primary industry",
        "timezone": "Reporting timezone",
        "audit_retention_days": "Audit log retention (days)",
    }
    changed = [(k, getattr(ws.org, k), getattr(body, k)) for k in labels if getattr(ws.org, k) != getattr(body, k)]
    ws.org = body
    ctx.data.tenants.workspace.put(ws)
    for k, before, after in changed:
        audit.record(
            ctx,
            "settings.organization_updated",
            f"{labels[k]}: {before} → {after}",
            resource=("organization", None),
            metadata={"field": k, "from_value": str(before), "to_value": str(after)},
        )
    return body


def owner(ctx: RequestContext) -> Member:
    for m in ctx.data.tenants.members.list():
        if m.role == "owner":
            return m
    raise NotFound("This workspace has no Owner")


def schedule_deletion(ctx: RequestContext, confirm_name: str) -> Workspace:
    ws = workspace(ctx)
    if confirm_name != ws.org.name:
        raise Conflict("Type the organization name exactly to confirm")
    if ws.deletion_scheduled_for is None:
        ws.deletion_scheduled_for = clock.now() + timedelta(days=7)
        ctx.data.tenants.workspace.put(ws)
        audit.record(
            ctx,
            "settings.deletion_scheduled",
            f"Scheduled {ws.org.name} for permanent deletion on {ws.deletion_scheduled_for:%b %d, %Y}",
            resource=("organization", None),
            metadata={"scheduled_for": ws.deletion_scheduled_for.isoformat()},
        )
    return ws


def cancel_deletion(ctx: RequestContext) -> Workspace:
    ws = workspace(ctx)
    if ws.deletion_scheduled_for is not None:
        ws.deletion_scheduled_for = None
        ctx.data.tenants.workspace.put(ws)
        audit.record(
            ctx,
            "settings.deletion_cancelled",
            f"Cancelled the scheduled deletion of {ws.org.name}",
            resource=("organization", None),
        )
    return ws
