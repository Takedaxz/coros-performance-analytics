"""FastAPI application entry point."""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.api.routes import (
    activity_router,
    ai_router,
    dashboard_router,
    import_router,
    settings_router,
    sync_router,
    training_plan_router,
)
from src.config import get_settings

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application startup and shutdown lifecycle."""
    # Startup: ensure raw file store directory exists
    import os

    os.makedirs(settings.raw_file_store_path, exist_ok=True)
    yield
    # Shutdown: nothing to clean up for now


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

app.include_router(import_router, prefix="/api/import", tags=["import"])
app.include_router(sync_router, prefix="/api/sync", tags=["sync"])
app.include_router(dashboard_router, prefix="/api/dashboard", tags=["dashboard"])
app.include_router(activity_router, prefix="/api/activities", tags=["activities"])
app.include_router(ai_router, prefix="/api/ai", tags=["ai"])
app.include_router(settings_router, prefix="/api/settings", tags=["settings"])
app.include_router(training_plan_router, prefix="/api/training-plan", tags=["training-plan"])


@app.get("/api/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok"}
