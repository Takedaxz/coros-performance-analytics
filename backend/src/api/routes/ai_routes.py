"""AI routes: ask questions, get briefings, activity postmortems."""
import asyncio
import datetime
import json
import logging
from collections.abc import AsyncIterator, Iterator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.ai import (
    ask_coach,
    ask_coach_stream,
    generate_briefing,
    generate_postmortem,
    generate_postmortem_stream,
    list_models,
    list_provider_models,
    resolve_model,
)
from src.ai.context_builder import build_plan_context, build_training_context
from src.config import get_settings
from src.db.engine import async_session_factory, get_db_session
from src.db.models import Activity, ActivityLap, ActivityRecord
from src.db.models import ChatMessage as DBChatMessage
from src.db.models import ChatSession as DBChatSession
from src.db.owner import get_owner_id

logger = logging.getLogger(__name__)

router = APIRouter()
settings = get_settings()


def _ai_enabled() -> bool:
    """Return True if at least one AI backend is fully configured."""
    st = get_settings()
    compat_ready = bool(st.openai_compat_api_key)
    gemini_ready = bool(st.gemini_api_key)
    return compat_ready or gemini_ready


def _active_model() -> str:
    """Return the model identifier for the currently active backend."""
    st = get_settings()
    if bool(st.openai_compat_api_key):
        return f"openai_compat:{st.openai_compat_model}"
    if bool(st.gemini_api_key):
        return f"gemini:{st.gemini_model}"
    return st.openai_compat_model


class ChatMessage(BaseModel):
    role: str
    content: str


class AskRequest(BaseModel):
    question: str
    context_days: int = 14
    plan_days_back: int = 7
    plan_days_forward: int = 14
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
        db,
        user_id=get_owner_id(),
        days=req.context_days,
        include_activity_details=True,
    )
    plan_context = await build_plan_context(
        days_back=req.plan_days_back,
        days_forward=req.plan_days_forward,
    )
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
        db,
        user_id=get_owner_id(),
        days=req.context_days,
        include_activity_details=True,
    )
    plan_context: str = await build_plan_context(
        days_back=req.plan_days_back,
        days_forward=req.plan_days_forward,
    )
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
        db, user_id=get_owner_id(), days=7
    )
    plan_context = await build_plan_context(days_back=14, days_forward=30)
    context = context + "\n\n" + plan_context

    # 2. Generate briefing
    briefing = generate_briefing(context)

    return {
        "briefing": briefing,
        "enabled": True,
        "model": _active_model(),
    }


def _format_pace(speed_mps: float) -> str:
    if not speed_mps or speed_mps <= 0:
        return "--"
    sec_per_km = 1000 / speed_mps
    m = int(sec_per_km // 60)
    s = int(sec_per_km % 60)
    return f"{m}:{s:02d}/km"


async def _build_laps_with_km_breakdown(
    db: AsyncSession, activity_id: str, laps: list[ActivityLap]
) -> list[str]:
    records_res = await db.execute(
        select(ActivityRecord)
        .where(ActivityRecord.activity_id == activity_id)
        .order_by(ActivityRecord.timestamp.asc())
    )
    records = records_res.scalars().all()

    lines = []
    if laps:
        lines.append("Splits & Per-Kilometer Breakdown:")
        overall_km_counter = 1

        for lap in laps:
            lap_start = lap.start_time
            lap_end = lap.start_time + datetime.timedelta(seconds=lap.elapsed_s)

            dist_km = (lap.distance_m / 1000) if lap.distance_m else 0
            dur_min = (lap.elapsed_s / 60) if lap.elapsed_s else 0
            pace_str = _format_pace(lap.avg_speed_mps or 0)
            hr_str = f"{lap.avg_hr_bpm} bpm" if lap.avg_hr_bpm else "--"
            power_str = f"{lap.avg_power_w} W" if lap.avg_power_w else ""
            cadence_str = f"{lap.avg_cadence} spm" if lap.avg_cadence else ""
            extra = ", ".join(filter(None, [power_str, cadence_str]))
            extra_str = f" ({extra})" if extra else ""

            lines.append(
                f"- Lap {lap.lap_index + 1}: {dist_km:.2f} km in {dur_min:.2f} min | Pace: {pace_str} | Avg HR: {hr_str}{extra_str}"
            )

            # Filter time-series records for this lap to compute per-km splits inside the lap
            lap_recs = [
                r for r in records
                if lap_start <= r.timestamp <= lap_end and r.distance_m is not None
            ] if records else []

            if not lap_recs:
                continue

            start_rec = lap_recs[0]
            accum_hrs = []
            accum_powers = []

            for i, r in enumerate(lap_recs):
                if r.heart_rate_bpm: accum_hrs.append(r.heart_rate_bpm)
                if r.power_w: accum_powers.append(r.power_w)

                dist_covered = (r.distance_m or 0) - (start_rec.distance_m or 0)
                is_last = (i == len(lap_recs) - 1)

                if dist_covered >= 1000.0 or (is_last and dist_covered > 50):
                    time_diff_s = (r.timestamp - start_rec.timestamp).total_seconds()
                    if time_diff_s > 0:
                        avg_speed = dist_covered / time_diff_s
                        avg_hr = round(sum(accum_hrs) / len(accum_hrs)) if accum_hrs else None
                        avg_pwr = round(sum(accum_powers) / len(accum_powers)) if accum_powers else None

                        sub_pace = _format_pace(avg_speed)
                        sub_hr = f"Avg HR: {avg_hr} bpm" if avg_hr else ""
                        sub_pwr = f" ({avg_pwr} W)" if avg_pwr else ""

                        dist_desc = f"{dist_covered/1000:.2f} km" if is_last and dist_covered < 950 else "1.00 km"
                        lines.append(
                            f"    • Km {overall_km_counter} ({dist_desc}): Pace {sub_pace} | {sub_hr}{sub_pwr}"
                        )

                        overall_km_counter += 1
                        start_rec = r
                        accum_hrs = []
                        accum_powers = []

    return lines


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

    # 1. Fetch activity & laps
    act_res = await db.execute(select(Activity).where(Activity.id == activity_id))
    activity = act_res.scalar_one_or_none()
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found.")

    laps_res = await db.execute(
        select(ActivityLap)
        .where(ActivityLap.activity_id == activity_id)
        .order_by(ActivityLap.lap_index.asc())
    )
    laps = laps_res.scalars().all()

    # 2. Build context
    context = await build_training_context(
        db, user_id=get_owner_id(), days=7
    )

    lap_lines = await _build_laps_with_km_breakdown(db, activity_id, laps)

    activity_str = (
        f"Title: {activity.title}\n"
        f"Sport: {activity.sport.value if activity.sport else '--'}\n"
        f"Date: {activity.start_time}\n"
        f"Distance: {activity.distance_m / 1000 if activity.distance_m else 0:.2f} km\n"
        f"Duration: {activity.elapsed_time_s / 60 if activity.elapsed_time_s else 0:.1f} mins\n"
        f"Training Load: {activity.training_load_vendor}\n"
        f"Avg HR: {activity.avg_hr_bpm}\n"
    )
    if lap_lines:
        activity_str += "\n" + "\n".join(lap_lines) + "\n"

    # 3. Generate postmortem
    analysis = generate_postmortem(context, activity_str)

    return {
        "activity_id": activity_id,
        "analysis": analysis,
        "enabled": True,
    }


@router.get("/postmortem/{activity_id}/stream")
async def activity_postmortem_stream(
    activity_id: str,
    db: AsyncSession = Depends(get_db_session),
) -> StreamingResponse:
    """Stream AI-generated postmortem analysis for a specific activity in real-time."""
    if not _ai_enabled():
        raise HTTPException(
            status_code=400,
            detail="No AI backend is enabled. Set OPENAI_COMPAT_ENABLED=true or GEMINI_ENABLED=true.",
        )

    act_res = await db.execute(select(Activity).where(Activity.id == activity_id))
    activity = act_res.scalar_one_or_none()
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found.")

    laps_res = await db.execute(
        select(ActivityLap)
        .where(ActivityLap.activity_id == activity_id)
        .order_by(ActivityLap.lap_index.asc())
    )
    laps = laps_res.scalars().all()

    context = await build_training_context(db, user_id=get_owner_id(), days=7)
    lap_lines = await _build_laps_with_km_breakdown(db, activity_id, laps)

    activity_str = (
        f"Title: {activity.title}\n"
        f"Sport: {activity.sport.value if activity.sport else '--'}\n"
        f"Date: {activity.start_time}\n"
        f"Distance: {activity.distance_m / 1000 if activity.distance_m else 0:.2f} km\n"
        f"Duration: {activity.elapsed_time_s / 60 if activity.elapsed_time_s else 0:.1f} mins\n"
        f"Training Load: {activity.training_load_vendor}\n"
        f"Avg HR: {activity.avg_hr_bpm}\n"
    )
    if lap_lines:
        activity_str += "\n" + "\n".join(lap_lines) + "\n"

    async def event_generator() -> AsyncIterator[str]:
        queue: asyncio.Queue[str | None] = asyncio.Queue()
        loop = asyncio.get_event_loop()
        accumulated: list[str] = []

        def _produce(sync_iter: Iterator[str]) -> None:
            try:
                for chunk in sync_iter:
                    accumulated.append(chunk)
                    loop.call_soon_threadsafe(queue.put_nowait, chunk)
            except Exception:
                logger.exception("Error streaming postmortem analysis")
                loop.call_soon_threadsafe(queue.put_nowait, "Error generating postmortem.")
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, None)

        sync_stream = generate_postmortem_stream(context, activity_str)
        producer = asyncio.create_task(asyncio.to_thread(_produce, sync_stream))

        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                yield f"data: {json.dumps({'text': item})}\n\n"
        finally:
            await producer
            await _persist_postmortem(activity_id, accumulated)

    async def _persist_postmortem(
        persisted_activity_id: str,
        accumulated: list[str],
    ) -> None:
        analysis = "".join(accumulated)
        if not analysis:
            return
        async with async_session_factory() as persist_db:
            result = await persist_db.execute(
                select(Activity).where(Activity.id == persisted_activity_id)
            )
            persisted_activity = result.scalar_one_or_none()
            if persisted_activity is None:
                return
            persisted_activity.postmortem = analysis
            await persist_db.commit()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ---------------------------------------------------------------------------
# Session management endpoints
# ---------------------------------------------------------------------------



class SessionCreateResponse(BaseModel):
    id: str
    title: str
    is_pinned: bool
    model_name: str
    created_at: str
    updated_at: str


class SessionListItem(BaseModel):
    id: str
    title: str
    is_pinned: bool
    model_name: str
    created_at: str
    updated_at: str


class SessionCreateRequest(BaseModel):
    model_name: str | None = None


class SessionUpdateRequest(BaseModel):
    title: str | None = None
    is_pinned: bool | None = None
    model_name: str | None = None


class ModelItem(BaseModel):
    id: str
    name: str


class ProviderGroup(BaseModel):
    id: str
    name: str
    models: list[ModelItem]


class ModelsResponse(BaseModel):
    models: list[str]
    providers: list[ProviderGroup] = []
    default_model: str


class MessageItem(BaseModel):
    id: str
    role: str
    content: str
    created_at: str


async def _validated_model(model_name: str | None) -> str:
    model = model_name or _active_model()
    available_models = await asyncio.to_thread(list_models)
    if model in available_models:
        return model
    _, clean_model = resolve_model(model)
    if any(m.endswith(f":{clean_model}") or m == clean_model for m in available_models):
        return model
    raise HTTPException(status_code=400, detail="Model is not available from the AI provider.")


@router.get("/models", response_model=ModelsResponse)
async def get_models() -> ModelsResponse:
    """Return models available from the active AI provider."""
    provider_groups = await asyncio.to_thread(list_provider_models)
    flat_models = await asyncio.to_thread(list_models)
    return ModelsResponse(
        models=flat_models,
        providers=[ProviderGroup(**g) for g in provider_groups],
        default_model=_active_model(),
    )


@router.get("/sessions", response_model=list[SessionListItem])
async def list_sessions(db: AsyncSession = Depends(get_db_session)) -> list[SessionListItem]:
    """Return all chat sessions for the user, newest first."""
    res = await db.execute(
        select(DBChatSession)
        .where(DBChatSession.user_id == get_owner_id())
        .order_by(DBChatSession.is_pinned.desc(), DBChatSession.updated_at.desc())
    )
    sessions = res.scalars().all()
    return [
        SessionListItem(
            id=s.id,
            title=s.title,
            is_pinned=s.is_pinned,
            model_name=s.model_name or _active_model(),
            created_at=s.created_at.isoformat(),
            updated_at=s.updated_at.isoformat(),
        )
        for s in sessions
    ]


@router.post("/sessions", response_model=SessionCreateResponse, status_code=201)
async def create_session(
    req: SessionCreateRequest | None = None,
    db: AsyncSession = Depends(get_db_session),
) -> SessionCreateResponse:
    """Create a new empty chat session."""
    model_name = await _validated_model(req.model_name if req else None)
    session = DBChatSession(user_id=get_owner_id(), model_name=model_name)
    db.add(session)
    await db.flush()
    return SessionCreateResponse(
        id=session.id,
        title=session.title,
        is_pinned=session.is_pinned,
        model_name=model_name,
        created_at=session.created_at.isoformat(),
        updated_at=session.updated_at.isoformat(),
    )


@router.put("/sessions/{session_id}", response_model=SessionListItem)
async def update_session(
    session_id: str,
    req: SessionUpdateRequest,
    db: AsyncSession = Depends(get_db_session),
) -> SessionListItem:
    """Update a chat session (title, pinned status)."""
    res = await db.execute(
        select(DBChatSession).where(
            DBChatSession.id == session_id, DBChatSession.user_id == get_owner_id()
        )
    )
    session = res.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")

    if req.title is not None:
        session.title = req.title
    if req.is_pinned is not None:
        session.is_pinned = req.is_pinned
    if req.model_name is not None:
        session.model_name = await _validated_model(req.model_name)

    await db.commit()
    return SessionListItem(
        id=session.id,
        title=session.title,
        is_pinned=session.is_pinned,
        model_name=session.model_name or _active_model(),
        created_at=session.created_at.isoformat(),
        updated_at=session.updated_at.isoformat(),
    )


@router.get("/sessions/{session_id}/messages", response_model=list[MessageItem])
async def get_session_messages(
    session_id: str,
    db: AsyncSession = Depends(get_db_session),
) -> list[MessageItem]:
    """Return all messages in a session ordered oldest first."""
    res = await db.execute(
        select(DBChatSession).where(
            DBChatSession.id == session_id, DBChatSession.user_id == get_owner_id()
        )
    )
    if not res.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Session not found.")

    msg_res = await db.execute(
        select(DBChatMessage)
        .where(DBChatMessage.session_id == session_id)
        .order_by(DBChatMessage.created_at.asc())
    )
    msgs = msg_res.scalars().all()
    return [
        MessageItem(id=m.id, role=m.role, content=m.content, created_at=m.created_at.isoformat())
        for m in msgs
    ]


@router.post("/sessions/{session_id}/ask/stream")
async def session_ask_stream(
    session_id: str,
    req: AskRequest,
    db: AsyncSession = Depends(get_db_session),
) -> StreamingResponse:
    """Stream an AI response for a session and persist both messages to the DB."""
    if not _ai_enabled():
        raise HTTPException(status_code=400, detail="No AI backend is enabled.")

    # Verify session belongs to this user
    res = await db.execute(
        select(DBChatSession).where(
            DBChatSession.id == session_id, DBChatSession.user_id == get_owner_id()
        )
    )
    session = res.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")

    # Persist user message
    user_msg = DBChatMessage(session_id=session_id, role="user", content=req.question)
    db.add(user_msg)

    # Auto-title from first message (truncated to 60 chars)
    if session.title == "New Chat":
        session.title = req.question[:60]

    # Commit immediately so the user message + title are durable before streaming starts.
    # get_db_session commits on exit, but for StreamingResponse that exit is delayed until
    # the stream closes — and a client disconnect raises CancelledError (BaseException),
    # which bypasses the except Exception handler and rolls the transaction back.
    await db.commit()

    # Build context
    context: str = await build_training_context(
        db,
        user_id=get_owner_id(),
        days=req.context_days,
        include_activity_details=True,
    )
    plan_context: str = await build_plan_context(
        days_back=req.plan_days_back,
        days_forward=req.plan_days_forward,
    )
    context = context + "\n\n" + plan_context

    history_dicts: list[dict[str, str]] = [
        {"role": msg.role, "content": msg.content} for msg in req.history
    ]

    async def event_generator() -> AsyncIterator[str]:
        queue: asyncio.Queue[str | None] = asyncio.Queue()
        loop = asyncio.get_event_loop()
        accumulated: list[str] = []

        def _produce(sync_iter: Iterator[str]) -> None:
            try:
                for chunk in sync_iter:
                    accumulated.append(chunk)
                    loop.call_soon_threadsafe(queue.put_nowait, chunk)
            except Exception:
                logger.exception("Error streaming session response from AI coach")
                loop.call_soon_threadsafe(queue.put_nowait, "Error streaming response.")
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, None)

        sync_stream = ask_coach_stream(
            req.question,
            context,
            history_dicts,
            model=session.model_name or _active_model(),
        )
        producer = asyncio.create_task(asyncio.to_thread(_produce, sync_stream))

        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                yield f"data: {json.dumps({'text': item})}\n\n"
        finally:
            # Fire the DB persist as a background task so the generator exits immediately.
            # This closes the SSE stream for the client (reader.read() returns done=True)
            # without waiting for the DB write. The task runs independently on the event
            # loop and is NOT cancelled by client disconnect.
            asyncio.create_task(_persist_ai_response(session_id, req.question, accumulated, producer))

    async def _persist_ai_response(
        sid: str,
        question: str,
        accumulated: list[str],
        producer: asyncio.Task,
    ) -> None:
        await producer
        full_response = "".join(accumulated)
        if not full_response:
            return
        async with async_session_factory() as persist_db:
            from datetime import datetime
            ai_msg = DBChatMessage(session_id=sid, role="assistant", content=full_response)
            sess_res = await persist_db.execute(
                select(DBChatSession).where(DBChatSession.id == sid)
            )
            s = sess_res.scalar_one_or_none()
            if s:
                s.updated_at = datetime.utcnow()
                if s.title == "New Chat":
                    s.title = question[:60]
            persist_db.add(ai_msg)
            await persist_db.commit()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.delete("/sessions/{session_id}", status_code=204)
async def delete_session(
    session_id: str,
    db: AsyncSession = Depends(get_db_session),
) -> None:
    """Delete a chat session and all its messages."""
    res = await db.execute(
        select(DBChatSession).where(
            DBChatSession.id == session_id, DBChatSession.user_id == get_owner_id()
        )
    )
    session = res.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")
    await db.delete(session)
