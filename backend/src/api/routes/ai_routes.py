"""AI routes: ask questions, get briefings, activity postmortems."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.ai.context_builder import build_plan_context, build_training_context
from src.ai.gemini_client import ask_coach, generate_briefing, generate_postmortem
from src.config import get_settings
from src.db.engine import get_db_session
from src.db.models import Activity

router = APIRouter()
settings = get_settings()


class ChatMessage(BaseModel):
    role: str
    content: str


class AskRequest(BaseModel):
    question: str
    context_days: int = 14
    history: list[ChatMessage] = []


class AskResponse(BaseModel):
    answer: str
    confidence: float | None = None
    evidence: list[dict] | None = None
    model: str = ""


@router.post("/ask", response_model=AskResponse)
async def ask_ai(
    req: AskRequest,
    db: AsyncSession = Depends(get_db_session),
) -> AskResponse:
    """Ask a natural-language question about your training data."""
    if not settings.gemini_enabled:
        raise HTTPException(
            status_code=400,
            detail="Gemini AI is not enabled. Set GEMINI_ENABLED=true and provide GEMINI_API_KEY.",
        )

    # 1. Build context from DB + training plan
    context = await build_training_context(
        db, user_id="00000000-0000-0000-0000-000000000000", days=req.context_days
    )
    plan_context = await build_plan_context(days_back=7, days_forward=30)
    context = context + "\n\n" + plan_context

    # 2. Call Gemini
    history_dicts = [{"role": msg.role, "content": msg.content} for msg in req.history]
    answer = ask_coach(req.question, context, history_dicts)

    return AskResponse(
        answer=answer,
        confidence=None,
        evidence=None,
        model=settings.gemini_model,
    )


@router.get("/briefing")
async def weekly_briefing(
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Auto-generated weekly training briefing."""
    if not settings.gemini_enabled:
        return {
            "briefing": "AI briefing requires Gemini to be enabled.",
            "enabled": False,
        }

    # 1. Build context from DB + training plan
    context = await build_training_context(
        db, user_id="00000000-0000-0000-0000-000000000000", days=7
    )
    plan_context = await build_plan_context(days_back=7, days_forward=30)
    context = context + "\n\n" + plan_context

    # 2. Call Gemini
    briefing = generate_briefing(context)

    return {
        "briefing": briefing,
        "enabled": True,
        "model": settings.gemini_model,
    }


@router.get("/postmortem/{activity_id}")
async def activity_postmortem(
    activity_id: str,
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """AI-generated postmortem analysis for a specific activity."""
    if not settings.gemini_enabled:
        return {
            "analysis": "AI analysis requires Gemini to be enabled.",
            "enabled": False,
        }

    # 1. Fetch activity
    act_res = await db.execute(select(Activity).where(Activity.id == activity_id))
    activity = act_res.scalar_one_or_none()
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found.")

    # 2. Build context
    context = await build_training_context(
        db, user_id="00000000-0000-0000-0000-000000000000", days=7
    )

    activity_str = (
        f"Title: {activity.title}\n"
        f"Sport: {activity.sport.value if activity.sport else '--'}\n"
        f"Date: {activity.start_time}\n"
        f"Distance: {activity.distance_m / 1000 if activity.distance_m else 0:.2f} km\n"
        f"Duration: {activity.elapsed_time_s / 60 if activity.elapsed_time_s else 0:.1f} mins\n"
        f"Training Load: {activity.training_load_vendor}\n"
        f"Avg HR: {activity.avg_hr_bpm}\n"
    )

    # 3. Call Gemini
    analysis = generate_postmortem(context, activity_str)

    return {
        "activity_id": activity_id,
        "analysis": analysis,
        "enabled": True,
    }
