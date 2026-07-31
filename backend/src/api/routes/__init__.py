"""API route definitions."""

from src.api.routes.activity_routes import router as activity_router
from src.api.routes.ai_routes import router as ai_router
from src.api.routes.auth_routes import router as auth_router
from src.api.routes.dashboard_routes import router as dashboard_router
from src.api.routes.settings_routes import router as settings_router
from src.api.routes.sync_routes import router as sync_router
from src.api.routes.training_plan_routes import router as training_plan_router

__all__ = [
    "auth_router",
    "sync_router",
    "dashboard_router",
    "activity_router",
    "ai_router",
    "settings_router",
    "training_plan_router",
]
