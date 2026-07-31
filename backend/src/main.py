"""FastAPI application entry point."""

import asyncio
import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.api.routes import (
    activity_router,
    ai_router,
    auth_router,
    dashboard_router,
    settings_router,
    sync_router,
    training_plan_router,
)
from src.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)


async def _scheduled_sync_loop() -> None:
    from src.api.routes.sync_routes import run_scheduled_sync

    interval_seconds = settings.sync_interval_minutes * 60
    while True:
        await asyncio.sleep(interval_seconds)
        try:
            await run_scheduled_sync()
        except Exception:
            logger.exception("scheduled_sync_failed")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application startup and shutdown lifecycle."""
    import os

    from sqlalchemy import text

    from src.db.engine import engine
    from src.db.models import Base

    os.makedirs(settings.raw_file_store_path, exist_ok=True)
    # Create any tables that don't exist yet (idempotent — safe to run every boot)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Upsert (idempotent — เรียกซ้ำแล้วได้ผลลัพธ์เดิม) the owner user row so FK
        # constraints on sync_events and other tables are satisfied.
        await conn.execute(
            text(
                "INSERT INTO users (id, email, timezone, units)"
                " VALUES (:id, :email, :tz, :units)"
                " ON CONFLICT (id) DO NOTHING"
            ),
            {
                "id": str(settings.owner_user_id),
                "email": settings.owner_email,
                "tz": settings.owner_timezone,
                "units": settings.owner_units,
            },
        )
    scheduler_task = asyncio.create_task(_scheduled_sync_loop())
    try:
        yield
    finally:
        scheduler_task.cancel()
        with suppress(asyncio.CancelledError):
            await scheduler_task




app = FastAPI(
    title="COROS Analytics",
    description="Personal COROS health and performance analytics API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sync_router, prefix="/api/sync", tags=["sync"])
app.include_router(dashboard_router, prefix="/api/dashboard", tags=["dashboard"])
app.include_router(activity_router, prefix="/api/activities", tags=["activities"])
app.include_router(ai_router, prefix="/api/ai", tags=["ai"])
app.include_router(settings_router, prefix="/api/settings", tags=["settings"])
app.include_router(training_plan_router, prefix="/api/training-plan", tags=["training-plan"])
app.include_router(auth_router, prefix="/auth", tags=["auth"])


@app.get("/api/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok"}
