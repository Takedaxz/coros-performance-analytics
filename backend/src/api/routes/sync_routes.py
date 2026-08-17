"""Sync routes: trigger API sync, stream progress via SSE, check sync history."""

import asyncio
import logging
from collections.abc import AsyncGenerator, Callable
from datetime import UTC, datetime
from uuid import uuid4

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from src.config import get_settings
from src.db.credential_store import load_coros_credentials
from src.db.engine import async_session_factory, get_db_session
from src.db.models import SyncEvent
from src.db.owner import get_owner_id

router = APIRouter()
settings = get_settings()
logger = logging.getLogger(__name__)

# In-memory sync state for SSE broadcasting.
# Production would use Redis pub/sub; this works for single-user MVP.
_sync_events: dict[str, list[dict[str, str]]] = {}
# ponytail: process-local lock; replace with Redis only if multiple API workers are added.
_sync_lock = asyncio.Lock()
_active_sync_job_id: str | None = None


def _push_sync_event(job_id: str, event_type: str, data: str) -> None:
    """Append an event to the in-memory sync stream."""
    if job_id not in _sync_events:
        _sync_events[job_id] = []
    _sync_events[job_id].append({"event": event_type, "data": data})


async def _run_sync_job(
    job_id: str,
    days: int | None,
    on_event: Callable[[str, str], None] | None,
) -> None:
    global _active_sync_job_id

    from src.sync.sync_manager import run_sync

    redis_client = aioredis.from_url(settings.redis_url, decode_responses=False)
    try:
        async for session in get_db_session():
            try:
                await run_sync(
                    session,
                    get_owner_id(),
                    days=days,
                    on_event=on_event,
                    redis=redis_client,
                    sync_event_id=job_id,
                )
                await session.commit()
            except Exception as exc:
                await session.rollback()
                logger.exception("sync_job_failed: job_id=%s", job_id)
                if on_event is not None:
                    on_event("error", f'{{"message": "Sync failed: {exc}"}}')
    finally:
        try:
            await redis_client.aclose()
        finally:
            if _active_sync_job_id == job_id:
                _active_sync_job_id = None
            _sync_lock.release()


async def run_scheduled_sync() -> bool:
    """Run one scheduled sync, or skip when unavailable or already running."""
    if _sync_lock.locked():
        logger.info("scheduled_sync_skipped: sync already running")
        return False

    async with async_session_factory() as db:
        creds = await load_coros_credentials(db, settings.app_secret_key)
    if not (creds or (settings.coros_email and settings.coros_password)):
        logger.info("scheduled_sync_skipped: COROS credentials not configured")
        return False

    if _sync_lock.locked():
        logger.info("scheduled_sync_skipped: sync started while checking credentials")
        return False
    await _sync_lock.acquire()
    await _run_sync_job(str(uuid4()), None, None)
    return True


def _utc_iso(value: datetime) -> str:
    """Serialize naive database timestamps as explicit UTC."""
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat()


@router.post("/now")
async def trigger_sync(
    days: int | None = Query(
        default=None,
        ge=1,
        le=3650,
        description="Activity days override; omit for an automatic incremental sync",
    ),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, str]:
    """Trigger an immediate API sync. Returns a job_id for SSE tracking."""
    creds = await load_coros_credentials(db, settings.app_secret_key)
    has_creds = bool(creds or (settings.coros_email and settings.coros_password))
    if not has_creds:
        raise HTTPException(
            status_code=400,
            detail="COROS API credentials not configured. Please configure them in Settings.",
        )

    if _sync_lock.locked():
        raise HTTPException(status_code=409, detail="A sync is already running.")
    await _sync_lock.acquire()

    global _active_sync_job_id

    job_id = str(uuid4())
    _active_sync_job_id = job_id
    _sync_events[job_id] = []

    def _on_event(evt_type: str, evt_data: str) -> None:
        _push_sync_event(job_id, evt_type, evt_data)

    # dispatch in background
    asyncio.create_task(_run_sync_job(job_id, days, _on_event))

    return {"status": "accepted", "job_id": job_id}


@router.get("/stream")
async def sync_stream(
    job_id: str,
    db: AsyncSession = Depends(get_db_session),
) -> EventSourceResponse:
    """SSE stream for real-time sync progress updates."""

    async def event_generator() -> AsyncGenerator[dict[str, str], None]:
        sent_count = 0
        max_wait_s = 600  # 10 minutes timeout for large initial syncs
        waited_s = 0.0
        ping_counter = 0

        while waited_s < max_wait_s:
            events = _sync_events.get(job_id, [])
            while sent_count < len(events):
                evt = events[sent_count]
                sent_count += 1
                yield evt
                if evt["event"] in ("complete", "error"):
                    return

            # Fallback: check DB status in case of stream disconnect or reloads
            if waited_s >= 2.0:
                res = await db.execute(select(SyncEvent).where(SyncEvent.id == job_id))
                se = res.scalar_one_or_none()
                if se and se.status == "completed":
                    yield {
                        "event": "complete",
                        "data": f'{{"message": "Sync complete", "total_upserted": {se.records_upserted}}}',
                    }
                    return
                elif se and se.status == "failed":
                    yield {
                        "event": "error",
                        "data": f'{{"message": "Sync failed: {se.error_message or "Unknown error"}"}}',
                    }
                    return

            await asyncio.sleep(0.5)
            waited_s += 0.5
            ping_counter += 1

            # Send heartbeat ping every 10 seconds to prevent connection drops
            if ping_counter >= 20:
                ping_counter = 0
                yield {"event": "ping", "data": '{"ping": true}'}

        yield {"event": "error", "data": '{"message": "Sync stream timeout"}'}

    return EventSourceResponse(event_generator())


@router.get("/status")
async def sync_status(
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, str | bool | None]:
    """Current sync configuration and last sync time."""
    result = await db.execute(
        select(SyncEvent)
        .where(SyncEvent.status.in_(["completed", "failed"]))
        .order_by(SyncEvent.completed_at.desc())
        .limit(1)
    )
    last = result.scalar_one_or_none()
    creds = await load_coros_credentials(db, settings.app_secret_key)
    api_enabled = bool(creds or (settings.coros_email and settings.coros_password))
    return {
        "api_enabled": api_enabled,
        "is_syncing": _sync_lock.locked(),
        "active_job_id": _active_sync_job_id,
        "sync_interval_minutes": str(settings.sync_interval_minutes),
        "last_sync_at": _utc_iso(last.completed_at) if last and last.completed_at else "never",
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
