"""AI routes: ask questions, get briefings, activity postmortems."""
import asyncio
import json
import logging
from collections.abc import AsyncIterator, Iterator
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.ai import ask_coach, ask_coach_stream, generate_briefing, generate_postmortem
from src.ai.context_builder import build_plan_context, build_training_context
from src.config import get_settings
from src.db.engine import get_db_session
from src.db.models import Activity

logger = logging.getLogger(__name__)

router = APIRouter()
settings = get_settings()


def _ai_enabled() -> bool:
    """Return True if at least one AI backend is fully configured."""
    compat_ready = settings.openai_compat_enabled and bool(settings.openai_compat_api_key)
    gemini_ready = settings.gemini_enabled and bool(settings.gemini_api_key)
    return compat_ready or gemini_ready


def _active_model() -> str:
    """Return the model identifier for the currently active backend."""
    if settings.openai_compat_enabled and settings.openai_compat_api_key:
        return settings.openai_compat_model
    return settings.gemini_model


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
    if not _ai_enabled():
        raise HTTPException(
            status_code=400,
            detail="No AI backend is enabled. Set OPENAI_COMPAT_ENABLED=true or GEMINI_ENABLED=true.",
        )

    # 1. Build context from DB + training plan
    context = await build_training_context(
        db, user_id="00000000-0000-0000-0000-000000000000", days=req.context_days
    )
    plan_context = await build_plan_context(days_back=7, days_forward=30)
    context = context + "\n\n" + plan_context

    # 2. Ask AI coach
    history_dicts = [{"role": msg.role, "content": msg.content} for msg in req.history]
    answer = ask_coach(req.question, context, history_dicts)

    return AskResponse(
        answer=answer,
        confidence=None,
        evidence=None,
        model=_active_model(),
    )


@router.post("/ask/stream")
async def ask_ai_stream(
    req: AskRequest,
    db: AsyncSession = Depends(get_db_session),
) -> StreamingResponse:
    """Ask a natural-language question about your training data and stream the response."""
    if not _ai_enabled():
        raise HTTPException(
            status_code=400,
            detail="No AI backend is enabled. Set OPENAI_COMPAT_ENABLED=true or GEMINI_ENABLED=true.",
        )

    # 1. Build context from DB + training plan
    context: str = await build_training_context(
        db, user_id="00000000-0000-0000-0000-000000000000", days=req.context_days
    )
    plan_context: str = await build_plan_context(days_back=7, days_forward=30)
    context = context + "\n\n" + plan_context

    # 2. Stream AI coach response
    history_dicts: list[dict[str, str]] = [
        {"role": msg.role, "content": msg.content} for msg in req.history
    ]

    async def event_generator() -> AsyncIterator[str]:
        """Bridge the blocking SDK iterator into an async generator via a queue."""
        queue: asyncio.Queue[str | None] = asyncio.Queue()
        loop = asyncio.get_event_loop()

        def _produce(sync_iter: Iterator[str]) -> None:
            try:
                for chunk in sync_iter:
                    loop.call_soon_threadsafe(queue.put_nowait, chunk)
            except Exception:
                logger.exception("Error streaming response from AI coach")
                loop.call_soon_threadsafe(queue.put_nowait, "Error streaming response.")
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, None)  # sentinel

        sync_stream = ask_coach_stream(req.question, context, history_dicts)
        # Run the blocking SDK iterator in a thread pool concurrently with consumption
        producer = asyncio.create_task(asyncio.to_thread(_produce, sync_stream))

        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                yield f"data: {json.dumps({'text': item})}\n\n"
        finally:
            await producer

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/briefing")
async def weekly_briefing(
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Auto-generated weekly training briefing."""
    if not _ai_enabled():
        return {
            "briefing": "AI briefing requires an AI backend to be enabled.",
            "enabled": False,
        }

    # 1. Build context from DB + training plan
    context = await build_training_context(
        db, user_id="00000000-0000-0000-0000-000000000000", days=7
    )
    plan_context = await build_plan_context(days_back=7, days_forward=30)
    context = context + "\n\n" + plan_context

    # 2. Generate briefing
    briefing = generate_briefing(context)

    return {
        "briefing": briefing,
        "enabled": True,
        "model": _active_model(),
    }


@router.get("/postmortem/{activity_id}")
async def activity_postmortem(
    activity_id: str,
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """AI-generated postmortem analysis for a specific activity."""
    if not _ai_enabled():
        return {
            "analysis": "AI analysis requires an AI backend to be enabled.",
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

    # 3. Generate postmortem
    analysis = generate_postmortem(context, activity_str)

    return {
        "activity_id": activity_id,
        "analysis": analysis,
        "enabled": True,
    }
