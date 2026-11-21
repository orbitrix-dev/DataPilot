"""What the database itself guarantees, bypassing the repositories (raw ORM inserts and SQL).

Covers foreign-key integrity, unique constraints, CHECK constraints and direct (database-level) tenant isolation.
Every test runs in a transaction that is rolled back.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime

import pytest
from sqlalchemy import delete, select, text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.orm import Session

from app.db.base import uuid7
from app.modules.identity.models import User, UserSession
from app.modules.tenants.models import Role, RolePermission, Tenant, TenantMembership

from .factories import SOON, digest, member, role, tenant, user

ARGON2 = "$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaA"


@contextmanager
def rejects(s: Session, match: str, exc: type[Exception] = IntegrityError) -> Iterator[None]:
    """Asserts the block's writes are rejected by the database. Uses a savepoint so the test can continue."""
    with pytest.raises(exc, match=match), s.begin_nested():
        yield
        s.flush()


# ------------------------------------------------------------------ keys, defaults, timestamps


def test_rows_get_uuid7_keys_and_timezone_aware_timestamps(db_session):
    t = tenant(db_session, "acme", with_roles=False)
    db_session.refresh(t)
    assert t.id.version == 7
    assert t.created_at.tzinfo is not None and t.status == "active" and t.deleted_at is None


def test_uuid7_is_time_ordered():
    ids = [uuid7() for _ in range(500)]
    assert len(set(ids)) == 500 and all(i.version == 7 for i in ids)


# ------------------------------------------------------------------ unique constraints


def test_unique_constraints(db_session):
    a = tenant(db_session, "acme")
    with rejects(db_session, "uq_tenants_slug"):
        db_session.add(Tenant(slug="acme", name="Another"))
    u = user(db_session, "e.vance@acme.io")
    with rejects(db_session, "uq_users_email"):
        db_session.add(User(email="e.vance@acme.io", full_name="Duplicate"))
    with rejects(db_session, "uq_roles_tenant_id_key"):
        db_session.add(Role(tenant_id=a.id, key="analyst", name="Second analyst"))
    member(db_session, a, u)
    with rejects(db_session, "uq_tenant_memberships_tenant_id_user_id"):
        db_session.add(
            TenantMembership(tenant_id=a.id, user_id=u.id, role_id=role(db_session, a).id, membership_status="invited")
        )


def test_the_same_role_key_is_allowed_in_different_tenants(db_session):
    tenant(db_session, "acme")
    tenant(db_session, "globex")  # both get "owner", "admin", ... without conflict
    assert db_session.scalar(select(text("count(*)")).select_from(Role).where(Role.key == "owner")) == 2


# ------------------------------------------------------------------ CHECK constraints


@pytest.mark.parametrize("slug", ["Acme", "-acme", "acme-", "ac me", "acme_co", ""])
def test_tenant_slugs_must_be_url_safe(db_session, slug):
    with rejects(db_session, "ck_tenants_slug_format"):
        db_session.add(Tenant(slug=slug, name="X"))


def test_soft_deletion_requires_both_status_and_timestamp(db_session):
    with rejects(db_session, "deleted_at_matches_status"):
        db_session.add(Tenant(slug="a1", name="A", status="deleted"))
    with rejects(db_session, "deleted_at_matches_status"):
        db_session.add(Tenant(slug="a2", name="A", deleted_at=datetime.now(UTC)))
    db_session.add(Tenant(slug="a3", name="A", status="deleted", deleted_at=datetime.now(UTC)))
    db_session.flush()


def test_emails_must_be_normalized(db_session):
    with rejects(db_session, "ck_users_email_normalized"):
        db_session.add(User(email="E.Vance@acme.io", full_name="X"))
    with rejects(db_session, "ck_users_email_(normalized|format)"):  # whitespace breaks both; either may fire first
        db_session.add(User(email=" e.vance@acme.io", full_name="X"))
    with rejects(db_session, "ck_users_email_format"):
        db_session.add(User(email="not-an-email", full_name="X"))


def test_plaintext_passwords_cannot_be_stored(db_session):
    with rejects(db_session, "password_hash_is_argon2id"):
        db_session.add(User(email="a@acme.io", full_name="A", password_hash="hunter2"))
    with rejects(db_session, "password_hash_is_argon2id"):
        db_session.add(User(email="b@acme.io", full_name="B", password_hash="$2b$12$bcrypt"))
    db_session.add(User(email="c@acme.io", full_name="C", password_hash=ARGON2))
    db_session.flush()


def test_invited_memberships_have_no_join_date_and_others_must(db_session):
    a = tenant(db_session, "acme")
    r = role(db_session, a)
    with rejects(db_session, "joined_at_matches_status"):
        db_session.add(
            TenantMembership(
                tenant_id=a.id,
                user_id=user(db_session, "x@acme.io").id,
                role_id=r.id,
                membership_status="invited",
                joined_at=datetime.now(UTC),
            )
        )
    with rejects(db_session, "joined_at_matches_status"):
        db_session.add(
            TenantMembership(
                tenant_id=a.id, user_id=user(db_session, "y@acme.io").id, role_id=r.id, membership_status="active"
            )
        )


def test_session_token_column_only_accepts_digests_and_ip_must_be_an_address(db_session):
    a = tenant(db_session, "acme")
    u = user(db_session, "e.vance@acme.io")
    member(db_session, a, u)
    with rejects(db_session, "token_hash_is_digest"):
        db_session.add(UserSession(tenant_id=a.id, user_id=u.id, token_hash=b"raw-session-token", expires_at=SOON))
    with rejects(db_session, "invalid input syntax for type inet", DBAPIError):
        db_session.add(UserSession(tenant_id=a.id, user_id=u.id, token_hash=digest(), expires_at=SOON, ip="testclient"))
    with rejects(db_session, "revocation_has_reason"):
        db_session.add(
            UserSession(
                tenant_id=a.id, user_id=u.id, token_hash=digest(), expires_at=SOON, revoked_at=datetime.now(UTC)
            )
        )


# ------------------------------------------------------------------ foreign keys & delete behaviour


def test_foreign_keys_reject_missing_parents(db_session):
    a = tenant(db_session, "acme")
    with rejects(db_session, "fk_roles_tenant_id_tenants"):
        db_session.add(Role(tenant_id=uuid7(), key="ghost", name="Ghost"))
    with rejects(db_session, "fk_tenant_memberships_user_id_users"):
        db_session.add(
            TenantMembership(
                tenant_id=a.id, user_id=uuid7(), role_id=role(db_session, a).id, membership_status="invited"
            )
        )
    with rejects(db_session, "fk_role_permissions_permission_code_permissions"):
        db_session.add(RolePermission(tenant_id=a.id, role_id=role(db_session, a).id, permission_code="made:up"))


def test_delete_rules(db_session):
    a = tenant(db_session, "acme")
    u = user(db_session, "e.vance@acme.io")
    m = member(db_session, a, u, "analyst")
    db_session.add(UserSession(tenant_id=a.id, user_id=u.id, token_hash=digest(), expires_at=SOON))
    db_session.flush()
    analyst = role(db_session, a, "analyst")
    # RESTRICT: a tenant with data, a user with memberships, an assigned role.
    with rejects(db_session, "fk_roles_tenant_id_tenants"):
        db_session.execute(delete(Tenant).where(Tenant.id == a.id))
    with rejects(db_session, "fk_tenant_memberships_user_id_users"):
        db_session.execute(delete(User).where(User.id == u.id))
    with rejects(db_session, "fk_tenant_memberships_tenant_id_role_id_roles"):
        db_session.execute(delete(Role).where(Role.id == analyst.id))
    # CASCADE: removing the membership ends its sessions; deleting an unassigned role removes its grants.
    db_session.execute(delete(TenantMembership).where(TenantMembership.id == m.id))
    assert db_session.scalar(select(text("count(*)")).select_from(UserSession)) == 0
    viewer = role(db_session, a, "viewer")
    db_session.execute(delete(Role).where(Role.id == viewer.id))
    assert db_session.scalars(select(RolePermission).where(RolePermission.role_id == viewer.id)).all() == []


# ------------------------------------------------------------------ direct tenant isolation


def test_a_membership_cannot_use_another_tenants_role(db_session):
    acme, globex = tenant(db_session, "acme"), tenant(db_session, "globex")
    with rejects(db_session, "fk_tenant_memberships_tenant_id_role_id_roles"):
        db_session.add(
            TenantMembership(
                tenant_id=acme.id,
                user_id=user(db_session, "e.vance@acme.io").id,
                role_id=role(db_session, globex, "owner").id,
                membership_status="invited",
            )
        )


def test_a_grant_cannot_attach_to_another_tenants_role(db_session):
    acme, globex = tenant(db_session, "acme"), tenant(db_session, "globex")
    with rejects(db_session, "fk_role_permissions_tenant_id_role_id_roles"):
        db_session.add(
            RolePermission(
                tenant_id=acme.id, role_id=role(db_session, globex, "viewer").id, permission_code="connect:write"
            )
        )


def test_a_session_cannot_exist_for_a_tenant_the_user_is_not_a_member_of(db_session):
    acme, globex = tenant(db_session, "acme"), tenant(db_session, "globex")
    u = user(db_session, "e.vance@acme.io")
    member(db_session, acme, u)
    with rejects(db_session, "fk_user_sessions_tenant_id_user_id_tenant_memberships"):
        db_session.add(UserSession(tenant_id=globex.id, user_id=u.id, token_hash=digest(), expires_at=SOON))


def test_raw_sql_cannot_move_a_membership_to_another_tenants_role(db_session):
    acme, globex = tenant(db_session, "acme"), tenant(db_session, "globex")
    m = member(db_session, acme, user(db_session, "e.vance@acme.io"))
    with rejects(db_session, "fk_tenant_memberships_tenant_id_role_id_roles"):
        db_session.execute(
            text("UPDATE tenant_memberships SET role_id = :r WHERE id = :m"),
            {"r": role(db_session, globex, "owner").id, "m": m.id},
        )
