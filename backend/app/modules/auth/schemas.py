from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.core.security import PASSWORD_MAX, validate_new_password


class AcceptInvitationIn(BaseModel):
    token: str = Field(min_length=10, max_length=200)
    password: str = Field(max_length=PASSWORD_MAX)

    @field_validator("password")
    @classmethod
    def _policy(cls, v: str) -> str:
        return validate_new_password(v)  # the "not your email" rule is checked once the invitation is found


class LoginIn(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=PASSWORD_MAX)
    # Required only for users who belong to several workspaces.
    tenant: str | None = Field(default=None, max_length=63)


class AccessTokenOut(BaseModel):
    access_token: str
    token_type: Literal["Bearer"] = "Bearer"
    expires_in: int
    expires_at: datetime
    tenant_id: str
    member_id: str
