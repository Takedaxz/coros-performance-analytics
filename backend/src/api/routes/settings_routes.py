"""Settings routes: user preferences, API config, data management."""

import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import get_settings
from src.db.engine import get_db_session
from src.db.models import Goal, User

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


class GoalResponse(BaseModel):
    id: str
    goal_description: str | None = None
    goal_race_name: str | None = None
    goal_race_date: datetime.date | None = None
    goal_target_time: str | None = None
    weekly_training_hours: float | None = None
    is_active: bool
    created_at: datetime.datetime
    updated_at: datetime.datetime

    class Config:
        from_attributes = True


class GoalCreate(BaseModel):
    goal_description: str | None = None
    goal_race_name: str | None = None
    goal_race_date: datetime.date | None = None
    goal_target_time: str | None = None
    weekly_training_hours: float | None = None
    is_active: bool = True


class GoalUpdate(BaseModel):
    goal_description: str | None = None
    goal_race_name: str | None = None
    goal_race_date: datetime.date | None = None
    goal_target_time: str | None = None
    weekly_training_hours: float | None = None
    is_active: bool | None = None


class UserProfile(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    nickname: str | None = None
    birthdate: str | None = None
    height_cm: float | None = None
    weight_kg: float | None = None
    body_fat_pct: float | None = None
    training_notes: str | None = None


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
        training_notes=user.training_notes,
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
    user.training_notes = payload.training_notes
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
        training_notes=user.training_notes,
    )


@router.get("/goal", response_model=UserGoal)
async def get_goal(db: AsyncSession = Depends(get_db_session)) -> UserGoal:
    """Retrieve the user's current active training goal (backwards-compatibility)."""
    res = await db.execute(
        select(Goal)
        .where(Goal.user_id == _DEFAULT_USER_ID, Goal.is_active)
        .order_by(Goal.updated_at.desc())
    )
    goal = res.scalars().first()
    if not goal:
        return UserGoal()
    return UserGoal(
        goal_description=goal.goal_description,
        goal_race_name=goal.goal_race_name,
        goal_race_date=goal.goal_race_date.isoformat() if goal.goal_race_date else None,
        goal_target_time=goal.goal_target_time,
        weekly_training_hours=goal.weekly_training_hours,
    )


@router.put("/goal", response_model=UserGoal)
async def update_goal(
    payload: UserGoal,
    db: AsyncSession = Depends(get_db_session),
) -> UserGoal:
    """Save or update the user's active training goal (backwards-compatibility)."""
    res = await db.execute(
        select(Goal)
        .where(Goal.user_id == _DEFAULT_USER_ID, Goal.is_active)
        .order_by(Goal.updated_at.desc())
    )
    goal = res.scalars().first()
    if not goal:
        goal = Goal(user_id=_DEFAULT_USER_ID, is_active=True)
        db.add(goal)

    goal.goal_description = payload.goal_description
    goal.goal_race_name = payload.goal_race_name
    goal.goal_race_date = (
        datetime.date.fromisoformat(payload.goal_race_date)
        if payload.goal_race_date
        else None
    )
    goal.goal_target_time = payload.goal_target_time
    goal.weekly_training_hours = payload.weekly_training_hours
    goal.updated_at = datetime.datetime.utcnow()

    await db.commit()
    await db.refresh(goal)

    return UserGoal(
        goal_description=goal.goal_description,
        goal_race_name=goal.goal_race_name,
        goal_race_date=goal.goal_race_date.isoformat() if goal.goal_race_date else None,
        goal_target_time=goal.goal_target_time,
        weekly_training_hours=goal.weekly_training_hours,
    )


@router.get("/goals", response_model=list[GoalResponse])
async def get_goals(db: AsyncSession = Depends(get_db_session)) -> list[Goal]:
    """Retrieve all training goals for the user, ordered by active status and creation date."""
    res = await db.execute(
        select(Goal)
        .where(Goal.user_id == _DEFAULT_USER_ID)
        .order_by(Goal.is_active.desc(), Goal.created_at.desc())
    )
    return list(res.scalars().all())


@router.post("/goals", response_model=GoalResponse)
async def create_goal(
    payload: GoalCreate,
    db: AsyncSession = Depends(get_db_session),
) -> Goal:
    """Create a new training goal."""
    goal = Goal(
        user_id=_DEFAULT_USER_ID,
        goal_description=payload.goal_description,
        goal_race_name=payload.goal_race_name,
        goal_race_date=payload.goal_race_date,
        goal_target_time=payload.goal_target_time,
        weekly_training_hours=payload.weekly_training_hours,
        is_active=payload.is_active,
    )
    db.add(goal)
    await db.commit()
    await db.refresh(goal)
    return goal


@router.put("/goals/{goal_id}", response_model=GoalResponse)
async def update_user_goal(
    goal_id: str,
    payload: GoalUpdate,
    db: AsyncSession = Depends(get_db_session),
) -> Goal:
    """Update an existing training goal."""
    res = await db.execute(
        select(Goal).where(Goal.id == goal_id, Goal.user_id == _DEFAULT_USER_ID)
    )
    goal = res.scalar_one_or_none()
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")

    update_data = payload.model_dump(exclude_unset=True)
    if "goal_description" in update_data:
        goal.goal_description = payload.goal_description
    if "goal_race_name" in update_data:
        goal.goal_race_name = payload.goal_race_name
    if "goal_race_date" in update_data:
        goal.goal_race_date = payload.goal_race_date
    if "goal_target_time" in update_data:
        goal.goal_target_time = payload.goal_target_time
    if "weekly_training_hours" in update_data:
        goal.weekly_training_hours = payload.weekly_training_hours
    if "is_active" in update_data:
        goal.is_active = payload.is_active

    goal.updated_at = datetime.datetime.utcnow()

    await db.commit()
    await db.refresh(goal)
    return goal


@router.delete("/goals/{goal_id}")
async def delete_goal(
    goal_id: str,
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, str]:
    """Delete a training goal."""
    res = await db.execute(
        select(Goal).where(Goal.id == goal_id, Goal.user_id == _DEFAULT_USER_ID)
    )
    goal = res.scalar_one_or_none()
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")

    await db.delete(goal)
    await db.commit()
    return {"status": "success", "message": "Goal deleted"}


@router.put("/goals/{goal_id}/toggle-active", response_model=GoalResponse)
async def toggle_goal_active(
    goal_id: str,
    db: AsyncSession = Depends(get_db_session),
) -> Goal:
    """Toggle a goal's active/inactive state."""
    res = await db.execute(
        select(Goal).where(Goal.id == goal_id, Goal.user_id == _DEFAULT_USER_ID)
    )
    goal = res.scalar_one_or_none()
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")

    goal.is_active = not goal.is_active
    goal.updated_at = datetime.datetime.utcnow()

    await db.commit()
    await db.refresh(goal)
    return goal
