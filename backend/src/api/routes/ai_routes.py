"""AI routes: ask questions, get briefings, activity postmortems."""

import asyncio
import datetime
import json
import logging
from collections.abc import AsyncIterator, Iterator, Sequence
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func, select
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
from src.ai.coach_tools import ToolCallRecord
from src.ai.context_builder import build_plan_context, build_training_context
from src.config import get_settings
from src.db.engine import async_session_factory, get_db_session
from src.db.models import Activity, ActivityLap, ActivityRecord
from src.db.models import ChatMessage as DBChatMessage
from src.db.models import ChatProject as DBChatProject
from src.db.models import ChatSession as DBChatSession
from src.db.owner import get_owner_id

logger = logging.getLogger(__name__)

router = APIRouter()
settings = get_settings()


def _ai_enabled() -> bool:
    """Return True if at least one AI backend is fully configured."""
    st = get_settings()
    compat_ready = st.openai_compat_enabled and bool(st.openai_compat_api_key)
    agentrouter_ready = bool(st.agentrouter_api_key)
    gemini_ready = bool(st.gemini_api_key)
    return compat_ready or agentrouter_ready or gemini_ready


def _active_model() -> str:
    """Return the model identifier for the currently active backend."""
    st = get_settings()
    if bool(st.gemini_api_key):
        return f"gemini:{st.gemini_model}"
    if bool(st.openai_compat_api_key):
        return f"openai_compat:{st.openai_compat_model}"
    if bool(st.agentrouter_api_key):
        return f"agentrouter:{st.agentrouter_model}"
    return f"gemini:{st.gemini_model}"


def _unique_tool_calls(tool_calls: list[ToolCallRecord]) -> list[ToolCallRecord]:
    seen: set[str] = set()
    unique: list[ToolCallRecord] = []
    for tool_call in tool_calls:
        key = json.dumps(tool_call, sort_keys=True, separators=(",", ":"), default=str)
        if key not in seen:
            seen.add(key)
            unique.append(tool_call)
    return unique


def _format_question_with_search_flags(
    question: str,
    force_web_search: bool,
    is_deep_research: bool,
    force_coaching_knowledge: bool,
) -> str:
    instructions: list[str] = []
    if is_deep_research:
        instructions.append(
            "[USER REQUESTED DEEP RESEARCH MODE: Perform a comprehensive, multi-step iterative "
            "research investigation using the `web_search` tool. Search for scientific studies, "
            "official rulebooks, or technical guides, compare facts, and synthesize an exhaustive, "
            "highly detailed deep research report with cited sources.]"
        )
    elif force_web_search:
        instructions.append(
            "[USER REQUESTED REAL-TIME WEB SEARCH: Use the `web_search` tool to look up "
            "current, up-to-date web information for this query before responding]"
        )
    if force_coaching_knowledge:
        instructions.append(
            "[USER REQUESTED COACHING KNOWLEDGE: You MUST call the "
            "`search_coaching_knowledge` tool before responding and use its returned "
            "cited guidance in your answer.]"
        )
    return "\n\n".join([*instructions, question])


async def _display_tool_calls(
    db: AsyncSession, user_id: str, tool_calls: list[ToolCallRecord]
) -> list[ToolCallRecord]:
    activity_ids: set[str] = set()
    for tool_call in tool_calls:
        arguments = tool_call["arguments"]
        activity_id = arguments.get("activity_id")
        if isinstance(activity_id, str):
            try:
                UUID(activity_id)
            except ValueError:
                pass
            else:
                activity_ids.add(activity_id)
        multiple_activity_ids = arguments.get("activity_ids")
        if isinstance(multiple_activity_ids, list):
            for value in multiple_activity_ids:
                if not isinstance(value, str):
                    continue
                try:
                    UUID(value)
                except ValueError:
                    continue
                activity_ids.add(value)
    labels: dict[str, str] = {}
    if activity_ids:
        activities = (
            await db.execute(
                select(Activity).where(Activity.id.in_(activity_ids), Activity.user_id == user_id)
            )
        ).scalars().all()
        labels = {
            activity.id: f"{activity.title or str(activity.sport).replace('_', ' ').title()} · {activity.start_time.date().isoformat()}"
            for activity in activities
        }
    displayed: list[ToolCallRecord] = []
    for tool_call in tool_calls:
        arguments = tool_call["arguments"]
        activity_id = arguments.get("activity_id")
        activity_ids_argument = arguments.get("activity_ids")
        if isinstance(activity_id, str) and activity_id in labels:
            displayed.append({**tool_call, "display_arguments": {"activity": labels[activity_id]}})
        elif isinstance(activity_id, str):
            displayed.append({**tool_call, "display_arguments": {"activity": "Activity unavailable"}})
        elif isinstance(activity_ids_argument, list):
            activity_labels = [
                labels.get(activity_id, "Activity unavailable")
                if isinstance(activity_id, str)
                else "Activity unavailable"
                for activity_id in activity_ids_argument
            ]
            displayed.append(
                {**tool_call, "display_arguments": {"activities": activity_labels}}
                if activity_labels
                else tool_call
            )
        else:
            displayed.append(tool_call)
    return displayed


class ChatMessage(BaseModel):
    role: str
    content: str


class AskRequest(BaseModel):
    question: str
    context_days: int = 14
    history: list[ChatMessage] = []
    images: list[str] = []
    user_message_id: UUID | None = None
    assistant_message_id: UUID | None = None
    force_web_search: bool = False
    is_deep_research: bool = False
    force_coaching_knowledge: bool = False


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
            detail="No AI backend is enabled. Enable Gemini, OpenAI-compatible, or AgentRouter AI.",
        )

    # 1. Build the compact default context; calendar details are fetched on demand.
    context = await build_training_context(
        db,
        user_id=get_owner_id(),
        days=min(req.context_days, 2),
        include_activity_details=False,
    )
    # 2. Ask AI coach
    history_dicts = [{"role": msg.role, "content": msg.content} for msg in req.history]
    tool_calls: list[ToolCallRecord] = []
    question_text = _format_question_with_search_flags(
        req.question, req.force_web_search, req.is_deep_research, req.force_coaching_knowledge
    )
    answer = await asyncio.to_thread(
        ask_coach,
        question_text,
        context,
        history_dicts,
        model=None,
        images=req.images,
        user_id=get_owner_id(),
        tool_calls=tool_calls,
        event_loop=asyncio.get_running_loop(),
    )

    return AskResponse(
        answer=answer,
        confidence=None,
        evidence=[{"tool": call["name"], "arguments": call["arguments"]} for call in tool_calls]
        or None,
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
            detail="No AI backend is enabled. Enable Gemini, OpenAI-compatible, or AgentRouter AI.",
        )

    # 1. Build the compact default context; calendar details are fetched on demand.
    context: str = await build_training_context(
        db,
        user_id=get_owner_id(),
        days=min(req.context_days, 2),
        include_activity_details=False,
    )
    # 2. Stream AI coach response
    history_dicts: list[dict[str, str]] = [
        {"role": msg.role, "content": msg.content} for msg in req.history
    ]

    async def event_generator() -> AsyncIterator[str]:
        """Bridge the blocking SDK iterator into an async generator via a queue."""
        queue: asyncio.Queue[str | None] = asyncio.Queue()
        loop = asyncio.get_event_loop()
        tool_calls: list[ToolCallRecord] = []

        def _produce(sync_iter: Iterator[str]) -> None:
            try:
                for chunk in sync_iter:
                    loop.call_soon_threadsafe(queue.put_nowait, chunk)
            except Exception:
                logger.exception("Error streaming response from AI coach")
                loop.call_soon_threadsafe(queue.put_nowait, "Error streaming response.")
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, None)  # sentinel

        question_text = _format_question_with_search_flags(
            req.question, req.force_web_search, req.is_deep_research, req.force_coaching_knowledge
        )
        sync_stream = ask_coach_stream(
            question_text,
            context,
            history_dicts,
            images=req.images,
            user_id=get_owner_id(),
            tool_calls=tool_calls,
            event_loop=loop,
        )
        # Run the blocking SDK iterator in a thread pool concurrently with consumption
        producer = asyncio.create_task(asyncio.to_thread(_produce, sync_stream))

        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                yield f"data: {json.dumps({'text': item})}\n\n"
            for tool_call in await _display_tool_calls(
                db, get_owner_id(), _unique_tool_calls(tool_calls)
            ):
                yield f"data: {json.dumps({'tool': tool_call})}\n\n"
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
    context = await build_training_context(db, user_id=get_owner_id(), days=7)
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


def _postmortem_focus(sport: str) -> str:
    focuses = {
        "run": "Pacing, split consistency, and heart-rate response.",
        "trail_run": "Effort, pacing, elevation, and heart-rate response.",
        "ride": "Power, pacing, elevation, and heart-rate response.",
        "swim": "Intervals, pace, stroke/cadence, and heart-rate response when available.",
        "walk": "Pacing, duration, and heart-rate response.",
        "hike": "Duration, elevation, effort, and heart-rate response.",
        "strength": (
            "Session structure, work-rest pattern, training load, and exercise modifications."
        ),
        "hyrox": "Station execution, work-rest pattern, training load, and heart-rate response.",
        "multisport": "Each discipline's execution and the transitions between them.",
        "other": "Session structure, effort, training load, and available telemetry.",
    }
    return focuses.get(sport, focuses["other"])


def _postmortem_sport(activity: Activity) -> str:
    title = (activity.title or "").casefold()
    if "strength" in title:
        return "strength"
    if "hyrox" in title:
        return "hyrox"
    return str(activity.sport)


async def _build_laps_with_km_breakdown(
    db: AsyncSession, activity: Activity, laps: Sequence[ActivityLap]
) -> list[str]:
    if _postmortem_sport(activity) not in {"run", "trail_run", "ride", "walk", "hike"}:
        return []

    records_res = await db.execute(
        select(ActivityRecord)
        .where(ActivityRecord.activity_id == activity.id)
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
            lap_recs = (
                [
                    r
                    for r in records
                    if lap_start <= r.timestamp <= lap_end and r.distance_m is not None
                ]
                if records
                else []
            )

            if not lap_recs:
                continue

            start_rec = lap_recs[0]
            accum_hrs = []
            accum_powers = []
            accum_cadences = []

            for i, r in enumerate(lap_recs):
                if r.heart_rate_bpm:
                    accum_hrs.append(r.heart_rate_bpm)
                if r.power_w:
                    accum_powers.append(r.power_w)
                if r.cadence:
                    accum_cadences.append(r.cadence)

                dist_covered = (r.distance_m or 0) - (start_rec.distance_m or 0)
                is_last = i == len(lap_recs) - 1

                if dist_covered >= 1000.0 or (is_last and dist_covered > 50):
                    time_diff_s = (r.timestamp - start_rec.timestamp).total_seconds()
                    if time_diff_s > 0:
                        avg_speed = dist_covered / time_diff_s
                        avg_hr = round(sum(accum_hrs) / len(accum_hrs)) if accum_hrs else None
                        avg_pwr = (
                            round(sum(accum_powers) / len(accum_powers)) if accum_powers else None
                        )
                        avg_cad = (
                            round(sum(accum_cadences) / len(accum_cadences))
                            if accum_cadences
                            else None
                        )

                        elev_delta = None
                        if r.altitude_m is not None and start_rec.altitude_m is not None:
                            elev_delta = round(r.altitude_m - start_rec.altitude_m)

                        sub_pace = _format_pace(avg_speed)
                        sub_hr = f"Avg HR: {avg_hr} bpm" if avg_hr else ""
                        sub_cad = f"Cadence: {avg_cad} spm" if avg_cad else ""
                        sub_elev = (
                            f"Elev: {'+' if elev_delta > 0 else ''}{elev_delta}m"
                            if elev_delta is not None and elev_delta != 0
                            else ""
                        )
                        sub_pwr = f" ({avg_pwr} W)" if avg_pwr else ""

                        dist_desc = (
                            f"{dist_covered / 1000:.2f} km"
                            if is_last and dist_covered < 950
                            else "1.00 km"
                        )
                        metrics_str = " | ".join(
                            filter(None, [f"Pace {sub_pace}", sub_hr, sub_cad, sub_elev])
                        )
                        lines.append(
                            f"    • Km {overall_km_counter} ({dist_desc}): {metrics_str}{sub_pwr}"
                        )

                        overall_km_counter += 1
                        start_rec = r
                        accum_hrs = []
                        accum_powers = []
                        accum_cadences = []

    return lines


def _build_activity_summary_string(activity: Activity, lap_lines: list[str]) -> str:
    summary_parts = [
        f"Title: {activity.title}",
        f"Sport: {activity.sport.value if activity.sport else '--'}",
        f"Analysis Focus: {_postmortem_focus(_postmortem_sport(activity))}",
        f"Date: {activity.start_time}",
        f"Distance: {activity.distance_m / 1000 if activity.distance_m else 0:.2f} km",
        f"Duration: {activity.elapsed_time_s / 60 if activity.elapsed_time_s else 0:.1f} mins",
        f"Training Load: {activity.training_load_vendor or '--'}",
        f"Avg HR: {activity.avg_hr_bpm or '--'} bpm",
    ]
    if activity.max_hr_bpm:
        summary_parts.append(f"Max HR: {activity.max_hr_bpm} bpm")
    if activity.max_power_w:
        summary_parts.append(f"Max Power: {activity.max_power_w} W")
    if activity.cardiac_drift_pct_app is not None:
        summary_parts.append(f"Cardiac Drift: {activity.cardiac_drift_pct_app:.1f}%")
    if activity.efficiency_factor_app is not None:
        summary_parts.append(f"Efficiency Factor: {activity.efficiency_factor_app:.2f}")
    if (
        activity.training_effect_aerobic_vendor is not None
        or activity.training_effect_anaerobic_vendor is not None
    ):
        summary_parts.append(
            f"Training Effect: Aerobic {activity.training_effect_aerobic_vendor or 0:.1f} / Anaerobic {activity.training_effect_anaerobic_vendor or 0:.1f}"
        )
    if activity.activity_note:
        summary_parts.append(f"Athlete Note: {activity.activity_note}")

    res = "\n".join(summary_parts)
    if lap_lines:
        res += "\n\n" + "\n".join(lap_lines) + "\n"
    return res


@router.get("/postmortem/{activity_id}")
async def activity_postmortem(
    activity_id: str,
    model: str | None = None,
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
    context = await build_training_context(db, user_id=get_owner_id(), days=7)
    lap_lines = await _build_laps_with_km_breakdown(db, activity, laps)
    activity_str = _build_activity_summary_string(activity, lap_lines)

    # 3. Generate postmortem
    analysis = generate_postmortem(context, activity_str, model=model)

    return {
        "activity_id": activity_id,
        "analysis": analysis,
        "enabled": True,
    }


@router.get("/postmortem/{activity_id}/stream")
async def activity_postmortem_stream(
    activity_id: str,
    model: str | None = None,
    db: AsyncSession = Depends(get_db_session),
) -> StreamingResponse:
    """Stream AI-generated postmortem analysis for a specific activity in real-time."""
    if not _ai_enabled():
        raise HTTPException(
            status_code=400,
            detail="No AI backend is enabled. Enable Gemini, OpenAI-compatible, or AgentRouter AI.",
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
    lap_lines = await _build_laps_with_km_breakdown(db, activity, laps)
    activity_str = _build_activity_summary_string(activity, lap_lines)

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

        sync_stream = generate_postmortem_stream(context, activity_str, model=model)
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
    project_id: str | None
    model_name: str
    created_at: str
    updated_at: str


class SessionListItem(BaseModel):
    id: str
    title: str
    is_pinned: bool
    project_id: str | None
    model_name: str
    created_at: str
    updated_at: str


class SessionCreateRequest(BaseModel):
    model_name: str | None = None
    project_name: str | None = None
    project_id: str | None = None


class SessionUpdateRequest(BaseModel):
    title: str | None = None
    is_pinned: bool | None = None
    model_name: str | None = None
    # Folder to move the session into. A blank name moves it back out to ungrouped;
    # an unknown name creates the project.
    project_name: str | None = None


class ProjectItem(BaseModel):
    id: str
    name: str
    icon: str | None = None
    highlight_color: str | None = None


class ProjectNameRequest(BaseModel):
    name: str


class ProjectUpdateRequest(BaseModel):
    name: str
    icon: str | None = None
    highlight_color: str | None = None


PROJECT_ICON_KEYS = frozenset({
    "run", "treadmill", "trail_run", "ride", "swim", "hike", "walk",
    "strength", "hyrox", "climbing", "skiing", "hybrid", "cardio",
    "multisport", "yoga", "badminton", "soda_water", "bread", "pizza",
    "healthy_eating", "books", "heart_pulse", "pill", "other",
})
PROJECT_HIGHLIGHT_COLORS = frozenset({
    "#21E6A5", "#2D9BF0", "#F0D348", "#FF4D62", "#9364F0", "#F08C3C",
    "#E06CBA", "#A5AFB4",
})


def _validate_project_customization(req: ProjectUpdateRequest) -> tuple[str, str | None, str | None]:
    name = req.name.strip()[:100]
    if not name:
        raise HTTPException(status_code=400, detail="Project name cannot be empty.")
    if req.icon is not None and req.icon not in PROJECT_ICON_KEYS:
        raise HTTPException(status_code=400, detail="Unsupported project icon.")
    if req.highlight_color is not None and req.highlight_color not in PROJECT_HIGHLIGHT_COLORS:
        raise HTTPException(status_code=400, detail="Unsupported project highlight color.")
    return name, req.icon, req.highlight_color


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
    images: list[str] | None = None
    tool_calls: list[ToolCallRecord | str] | None = None
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


def _capitalize_title(val: str | None) -> str:
    if not val:
        return "New Chat"
    s = val.strip()
    return (s[0].upper() + s[1:]) if s else "New Chat"


async def _resolve_project_id(db: AsyncSession, name: str) -> str | None:
    """Return the id of the owner's project called `name`, creating it when new.

    A blank name resolves to None, which moves the session out of every folder.
    Matching is case-insensitive so the sidebar typeahead cannot create "cardio"
    alongside "Cardio".
    """
    clean = name.strip()[:100]
    if not clean:
        return None
    res = await db.execute(
        select(DBChatProject).where(
            DBChatProject.user_id == get_owner_id(),
            func.lower(DBChatProject.name) == clean.lower(),
        )
    )
    existing = res.scalar_one_or_none()
    if existing:
        return existing.id
    project = DBChatProject(user_id=get_owner_id(), name=clean)
    db.add(project)
    await db.flush()
    return project.id


@router.get("/projects", response_model=list[ProjectItem])
async def list_projects(db: AsyncSession = Depends(get_db_session)) -> list[ProjectItem]:
    """Return the owner's chat projects, alphabetically."""
    res = await db.execute(
        select(DBChatProject)
        .where(DBChatProject.user_id == get_owner_id())
        .order_by(func.lower(DBChatProject.name))
    )
    return [
        ProjectItem(id=p.id, name=p.name, icon=p.icon, highlight_color=p.highlight_color)
        for p in res.scalars().all()
    ]


@router.post("/projects", response_model=ProjectItem, status_code=201)
async def create_project(
    req: ProjectNameRequest,
    db: AsyncSession = Depends(get_db_session),
) -> ProjectItem:
    """Create an empty chat project. An existing name resolves to that project."""
    project_id = await _resolve_project_id(db, req.name)
    if not project_id:
        raise HTTPException(status_code=400, detail="Project name cannot be empty.")
    await db.commit()
    project = await db.get(DBChatProject, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")
    return ProjectItem(
        id=project.id,
        name=project.name,
        icon=project.icon,
        highlight_color=project.highlight_color,
    )


@router.put("/projects/{project_id}", response_model=ProjectItem)
async def update_project(
    project_id: str,
    req: ProjectUpdateRequest,
    db: AsyncSession = Depends(get_db_session),
) -> ProjectItem:
    """Rename a chat project."""
    name, icon, highlight_color = _validate_project_customization(req)

    res = await db.execute(
        select(DBChatProject).where(
            DBChatProject.id == project_id, DBChatProject.user_id == get_owner_id()
        )
    )
    project = res.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")

    clash = await db.execute(
        select(DBChatProject).where(
            DBChatProject.user_id == get_owner_id(),
            DBChatProject.id != project_id,
            func.lower(DBChatProject.name) == name.lower(),
        )
    )
    if clash.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="A project with that name already exists.")

    project.name = name
    project.icon = icon
    project.highlight_color = highlight_color
    await db.commit()
    return ProjectItem(
        id=project.id,
        name=project.name,
        icon=project.icon,
        highlight_color=project.highlight_color,
    )


@router.delete("/projects/{project_id}", status_code=204)
async def delete_project(
    project_id: str,
    db: AsyncSession = Depends(get_db_session),
) -> None:
    """Delete a chat project. Its sessions stay, moving back out to ungrouped."""
    res = await db.execute(
        select(DBChatProject).where(
            DBChatProject.id == project_id, DBChatProject.user_id == get_owner_id()
        )
    )
    project = res.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")
    await db.delete(project)
    await db.commit()


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
            title=_capitalize_title(s.title),
            is_pinned=s.is_pinned,
            project_id=s.project_id,
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
    project_id = None
    if req:
        if req.project_id:
            res_p = await db.execute(
                select(DBChatProject).where(
                    DBChatProject.id == req.project_id, DBChatProject.user_id == get_owner_id()
                )
            )
            if res_p.scalar_one_or_none():
                project_id = req.project_id
        elif req.project_name:
            project_id = await _resolve_project_id(db, req.project_name)

    session = DBChatSession(user_id=get_owner_id(), model_name=model_name, project_id=project_id)
    db.add(session)
    await db.flush()
    return SessionCreateResponse(
        id=session.id,
        title=session.title,
        is_pinned=session.is_pinned,
        project_id=session.project_id,
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
    """Update a chat session (title, pinned status, model, project)."""
    res = await db.execute(
        select(DBChatSession).where(
            DBChatSession.id == session_id, DBChatSession.user_id == get_owner_id()
        )
    )
    session = res.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")

    if req.title is not None:
        session.title = _capitalize_title(req.title)
    if req.is_pinned is not None:
        session.is_pinned = req.is_pinned
    if req.model_name is not None:
        session.model_name = await _validated_model(req.model_name)
    if req.project_name is not None:
        session.project_id = await _resolve_project_id(db, req.project_name)
    if req.title is not None or req.is_pinned is not None or req.model_name is not None:
        session.updated_at = datetime.datetime.utcnow()

    await db.commit()
    return SessionListItem(
        id=session.id,
        title=_capitalize_title(session.title),
        is_pinned=session.is_pinned,
        project_id=session.project_id,
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
    tool_calls_by_message = {
        message.id: await _display_tool_calls(
            db,
            get_owner_id(),
            [tool_call for tool_call in (message.tool_calls or []) if isinstance(tool_call, dict)],
        )
        for message in msgs
    }
    return [
        MessageItem(
            id=message.id,
            role=message.role,
            content=message.content,
            images=message.images,
            tool_calls=tool_calls_by_message.get(message.id) or message.tool_calls,
            created_at=message.created_at.replace(tzinfo=datetime.UTC).isoformat(),
        )
        for message in msgs
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

    history_rows = (
        (
            await db.execute(
                select(DBChatMessage)
                .where(DBChatMessage.session_id == session_id)
                .order_by(DBChatMessage.created_at.asc())
            )
        )
        .scalars()
        .all()
    )
    history_dicts = [
        {"role": message.role, "content": message.content} for message in history_rows[-12:]
    ]

    # Persist user message
    user_msg = DBChatMessage(
        session_id=session_id, role="user", content=req.question, images=req.images or None
    )
    if req.user_message_id:
        user_msg.id = str(req.user_message_id)
    db.add(user_msg)

    # Auto-title from first message (truncated to 60 chars)
    if session.title == "New Chat":
        session.title = _capitalize_title(req.question[:60])

    # Commit immediately so the user message + title are durable before streaming starts.
    # get_db_session commits on exit, but for StreamingResponse that exit is delayed until
    # the stream closes — and a client disconnect raises CancelledError (BaseException),
    # which bypasses the except Exception handler and rolls the transaction back.
    await db.commit()

    # Build context
    context: str = await build_training_context(
        db,
        user_id=get_owner_id(),
        days=min(req.context_days, 2),
        include_activity_details=False,
    )
    async def event_generator() -> AsyncIterator[str]:
        queue: asyncio.Queue[str | None] = asyncio.Queue()
        loop = asyncio.get_event_loop()
        accumulated: list[str] = []
        tool_calls: list[ToolCallRecord] = []

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

        question_text = _format_question_with_search_flags(
            req.question, req.force_web_search, req.is_deep_research, req.force_coaching_knowledge
        )
        sync_stream = ask_coach_stream(
            question_text,
            context,
            history_dicts,
            model=session.model_name or _active_model(),
            images=req.images,
            user_id=get_owner_id(),
            tool_calls=tool_calls,
            event_loop=loop,
        )
        producer = asyncio.create_task(asyncio.to_thread(_produce, sync_stream))

        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                yield f"data: {json.dumps({'text': item})}\n\n"
            for tool_call in await _display_tool_calls(
                db, get_owner_id(), _unique_tool_calls(tool_calls)
            ):
                yield f"data: {json.dumps({'tool': tool_call})}\n\n"
        finally:
            # Keep the stream open until the response is durable so message actions cannot
            # race a pending assistant-message write.
            await _persist_ai_response(
                session_id, req.question, accumulated, producer, tool_calls
            )

    async def _persist_ai_response(
        sid: str,
        question: str,
        accumulated: list[str],
        producer: asyncio.Task,
        tool_calls: list[ToolCallRecord],
    ) -> None:
        await producer
        full_response = "".join(accumulated) or "Error communicating with AI."
        async with async_session_factory() as persist_db:
            from datetime import datetime

            ai_msg = DBChatMessage(
                session_id=sid,
                role="assistant",
                content=full_response,
                tool_calls=_unique_tool_calls(tool_calls),
            )
            if req.assistant_message_id:
                ai_msg.id = str(req.assistant_message_id)
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


class DeleteExchangeResponse(BaseModel):
    session_deleted: bool
    title: str | None


@router.delete(
    "/sessions/{session_id}/exchanges/{user_message_id}",
    response_model=DeleteExchangeResponse,
)
async def delete_exchange(
    session_id: str,
    user_message_id: str,
    db: AsyncSession = Depends(get_db_session),
) -> DeleteExchangeResponse:
    """Delete one user message and its immediately following assistant response."""
    session_res = await db.execute(
        select(DBChatSession).where(
            DBChatSession.id == session_id, DBChatSession.user_id == get_owner_id()
        )
    )
    session = session_res.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")

    message_res = await db.execute(
        select(DBChatMessage)
        .where(DBChatMessage.session_id == session_id)
        .order_by(DBChatMessage.created_at.asc())
    )
    messages = list(message_res.scalars().all())
    user_index = next(
        (
            index
            for index, message in enumerate(messages)
            if message.id == user_message_id and message.role == "user"
        ),
        None,
    )
    if user_index is None:
        raise HTTPException(status_code=404, detail="Message not found.")

    delete_indexes = {user_index}
    if user_index + 1 < len(messages) and messages[user_index + 1].role == "assistant":
        delete_indexes.add(user_index + 1)
    remaining_messages = [
        message for index, message in enumerate(messages) if index not in delete_indexes
    ]

    if not remaining_messages:
        await db.delete(session)
        await db.commit()
        return DeleteExchangeResponse(session_deleted=True, title=None)

    for index in sorted(delete_indexes):
        await db.delete(messages[index])
    first_user_index = next(
        (index for index, message in enumerate(messages) if message.role == "user"), None
    )
    if user_index == first_user_index:
        first_user_message = next(
            (message for message in remaining_messages if message.role == "user"), None
        )
        if first_user_message:
            session.title = _capitalize_title(first_user_message.content[:60])
    await db.commit()
    return DeleteExchangeResponse(session_deleted=False, title=session.title)


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
    await db.commit()
