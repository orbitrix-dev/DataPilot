"""Intelligence Service: contract only. Port the logic from src/features/intelligence/ next."""

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.core.context import RequestContext
from app.core.errors import NotImplementedYet
from app.deps import can_read, scope

router = APIRouter(
    prefix="/intelligence", tags=["intelligence"], dependencies=[scope("intelligence:query", methods=("GET", "POST"))]
)

PENDING = "Intelligence is not implemented in the backend yet; the front end still uses its mock answers"


class QuestionIn(BaseModel):
    question: str = Field(min_length=1, max_length=1000)


@router.post("/questions")
def ask(body: QuestionIn, ctx: RequestContext = can_read("insights")) -> None:
    """Will return a grounded answer with evidence and its Trust status, or an explicit "no grounded answer"."""
    raise NotImplementedYet(PENDING)


@router.get("/history")
def history(ctx: RequestContext = can_read("insights")) -> None:
    raise NotImplementedYet(PENDING)


@router.get("/forecast")
def forecast(horizon_days: int = 30, ctx: RequestContext = can_read("insights")) -> None:
    raise NotImplementedYet(PENDING)
