from fastapi import APIRouter

from app.core.context import RequestContext
from app.deps import admins, scope

from . import service
from .service import Category, PreferenceOut, PreferenceUpdate

router = APIRouter(prefix="/notifications", tags=["notifications"], dependencies=[scope("admin")])


@router.get("/preferences")
def list_preferences(ctx: RequestContext = admins()) -> list[PreferenceOut]:
    return service.list_preferences(ctx)


@router.put("/preferences/{category}")
def set_preference(category: Category, body: PreferenceUpdate, ctx: RequestContext = admins()) -> list[PreferenceOut]:
    return service.set_preference(ctx, category, body.enabled)
