"""Settings routes: user preferences, API config, data management."""

import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import get_settings
from src.db.engine import get_db_session
from src.db.models import User

router = APIRouter()
settings = get_settings()

_DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000000"


class SyncConfig(BaseModel):
    api_enabled: bool
    sync_interval_minutes: int


class UserGoal(BaseModel):
    goal_description: str | None = None
    goal_race_name: str | None = None
    goal_race_date: str | None = None        # ISO date string "YYYY-MM-DD"
    goal_target_time: str | None = None      # e.g. "3:59:00"
    weekly_training_hours: float | None = None


class UserProfile(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    nickname: str | None = None
    birthdate: str | None = None
    height_cm: float | None = None
    weight_kg: float | None = None
    body_fat_pct: float | None = None


@router.get("/sync-config")
async def get_sync_config() -> SyncConfig:
    """Current API sync configuration."""
    return SyncConfig(
        api_enabled=bool(settings.coros_email and settings.coros_password),
        sync_interval_minutes=settings.sync_interval_minutes,
    )


@router.get("/status")
async def app_status() -> dict[str, str | bool]:
    """Application status and feature flags."""
    return {
        "app_env": settings.app_env,
        "gemini_enabled": settings.gemini_enabled,
        "api_enabled": bool(settings.coros_email and settings.coros_password),
    }


@router.get("/profile", response_model=UserProfile)
async def get_profile(db: AsyncSession = Depends(get_db_session)) -> UserProfile:
    """Retrieve the user's biometric profile."""
    res = await db.execute(select(User).where(User.id == _DEFAULT_USER_ID))
    user = res.scalar_one_or_none()
    if not user:
        return UserProfile()
    return UserProfile(
        first_name=user.first_name,
        last_name=user.last_name,
        nickname=user.nickname,
        birthdate=user.birthdate.isoformat() if user.birthdate else None,
        height_cm=user.height_cm,
        weight_kg=user.weight_kg,
        body_fat_pct=user.body_fat_pct,
    )


@router.put("/profile", response_model=UserProfile)
async def update_profile(
    payload: UserProfile,
    db: AsyncSession = Depends(get_db_session),
) -> UserProfile:
    """Save or update the user's biometric profile."""
    res = await db.execute(select(User).where(User.id == _DEFAULT_USER_ID))
    user = res.scalar_one_or_none()
    if not user:
        return UserProfile()

    user.first_name = payload.first_name
    user.last_name = payload.last_name
    user.nickname = payload.nickname
    user.birthdate = (
        datetime.date.fromisoformat(payload.birthdate)
        if payload.birthdate
        else None
    )
    user.height_cm = payload.height_cm
    user.weight_kg = payload.weight_kg
    user.body_fat_pct = payload.body_fat_pct
    user.updated_at = datetime.datetime.utcnow()

    await db.commit()
    await db.refresh(user)

    return UserProfile(
        first_name=user.first_name,
        last_name=user.last_name,
        nickname=user.nickname,
        birthdate=user.birthdate.isoformat() if user.birthdate else None,
        height_cm=user.height_cm,
        weight_kg=user.weight_kg,
        body_fat_pct=user.body_fat_pct,
    )


@router.get("/goal", response_model=UserGoal)
async def get_goal(db: AsyncSession = Depends(get_db_session)) -> UserGoal:
    """Retrieve the user's current training goal."""
    res = await db.execute(select(User).where(User.id == _DEFAULT_USER_ID))
    user = res.scalar_one_or_none()
    if not user:
        return UserGoal()
    return UserGoal(
        goal_description=user.goal_description,
        goal_race_name=user.goal_race_name,
        goal_race_date=user.goal_race_date.isoformat() if user.goal_race_date else None,
        goal_target_time=user.goal_target_time,
        weekly_training_hours=user.weekly_training_hours,
    )


@router.put("/goal", response_model=UserGoal)
async def update_goal(
    payload: UserGoal,
    db: AsyncSession = Depends(get_db_session),
) -> UserGoal:
    """Save or update the user's training goal."""
    res = await db.execute(select(User).where(User.id == _DEFAULT_USER_ID))
    user = res.scalar_one_or_none()
    if not user:
        return UserGoal()

    user.goal_description = payload.goal_description
    user.goal_race_name = payload.goal_race_name
    user.goal_race_date = (
        datetime.date.fromisoformat(payload.goal_race_date)
        if payload.goal_race_date
        else None
    )
    user.goal_target_time = payload.goal_target_time
    user.weekly_training_hours = payload.weekly_training_hours
    user.updated_at = datetime.datetime.utcnow()

    await db.commit()
    await db.refresh(user)

    return UserGoal(
        goal_description=user.goal_description,
        goal_race_name=user.goal_race_name,
        goal_race_date=user.goal_race_date.isoformat() if user.goal_race_date else None,
        goal_target_time=user.goal_target_time,
        weekly_training_hours=user.weekly_training_hours,
    )
