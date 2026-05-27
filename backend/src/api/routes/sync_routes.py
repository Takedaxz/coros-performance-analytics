"""Sync routes: trigger API sync, stream progress via SSE, check sync history."""

import asyncio
from collections.abc import AsyncGenerator
from datetime import datetime

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from src.config import get_settings
from src.db.engine import get_db_session
from src.db.models import SyncEvent

router = APIRouter()
settings = get_settings()

# In-memory sync state for SSE broadcasting.
# Production would use Redis pub/sub; this works for single-user MVP.
_sync_events: dict[str, list[dict[str, str]]] = {}


def _push_sync_event(job_id: str, event_type: str, data: str) -> None:
    """Append an event to the in-memory sync stream."""
    if job_id not in _sync_events:
        _sync_events[job_id] = []
    _sync_events[job_id].append({"event": event_type, "data": data})


@router.post("/now")
async def trigger_sync(
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, str]:
    """Trigger an immediate API sync. Returns a job_id for SSE tracking."""
    if not settings.coros_email or not settings.coros_password:
        raise HTTPException(
            status_code=400, detail="COROS API credentials missing in configuration."
        )

    # Create sync event record
    sync_event = SyncEvent(
        user_id="00000000-0000-0000-0000-000000000000",
        source_type="api_official",
        status="started",
        started_at=datetime.utcnow(),
    )
    db.add(sync_event)
    await db.flush()

    job_id = sync_event.id
    _sync_events[job_id] = []

    async def _do_sync(job_id_val: str) -> None:
        from src.db.engine import get_db_session
        from src.sync.sync_manager import run_sync

        def _on_event(evt_type: str, evt_data: str) -> None:
            _push_sync_event(job_id_val, evt_type, evt_data)

        redis_client = aioredis.from_url(settings.redis_url, decode_responses=False)
        try:
            async for session in get_db_session():
                try:
                    await run_sync(
                        session,
                        "00000000-0000-0000-0000-000000000000",
                        days=14,
                        on_event=_on_event,
                        redis=redis_client,
                    )
                    await session.commit()
                except Exception as e:
                    await session.rollback()
                    _push_sync_event(job_id_val, "error", f'{{"message": "Sync failed: {e}"}}')
        finally:
            await redis_client.aclose()

    # dispatch in background
    asyncio.create_task(_do_sync(job_id))

    return {"status": "accepted", "job_id": job_id}


@router.get("/stream")
async def sync_stream(job_id: str) -> EventSourceResponse:
    """SSE stream for real-time sync progress updates."""

    async def event_generator() -> AsyncGenerator[dict[str, str], None]:
        sent_count = 0
        max_wait_s = 120
        waited_s = 0.0
        while waited_s < max_wait_s:
            events = _sync_events.get(job_id, [])
            while sent_count < len(events):
                evt = events[sent_count]
                sent_count += 1
                yield evt
                if evt["event"] == "complete":
                    return
            await asyncio.sleep(0.3)
            waited_s += 0.3
        yield {"event": "timeout", "data": '{"message": "Sync stream timed out"}'}

    return EventSourceResponse(event_generator())


@router.get("/status")
async def sync_status(
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, str | bool]:
    """Current sync configuration and last sync time."""
    result = await db.execute(
        select(SyncEvent)
        .where(SyncEvent.status.in_(["completed", "failed"]))
        .order_by(SyncEvent.completed_at.desc())
        .limit(1)
    )
    last = result.scalar_one_or_none()
    return {
        "api_enabled": bool(settings.coros_email and settings.coros_password),
        "sync_interval_minutes": str(settings.sync_interval_minutes),
        "last_sync_at": last.completed_at.isoformat() if last and last.completed_at else "never",
        "last_sync_status": last.status if last else "none",
    }


@router.get("/events")
async def list_sync_events(
    db: AsyncSession = Depends(get_db_session),
) -> list[dict[str, str | int | None]]:
    """List recent sync events for audit trail."""
    result = await db.execute(select(SyncEvent).order_by(SyncEvent.started_at.desc()).limit(20))
    events = result.scalars().all()
    return [
        {
            "id": e.id,
            "source_type": e.source_type,
            "status": e.status,
            "records_upserted": e.records_upserted,
            "error_message": e.error_message,
            "started_at": e.started_at.isoformat() if e.started_at else None,
            "completed_at": e.completed_at.isoformat() if e.completed_at else None,
        }
        for e in events
    ]
