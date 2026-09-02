"""Settings routes: user preferences, API config, data management."""

import datetime
import os
import secrets
import tempfile
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import get_settings
from src.db.credential_store import (
    clear_coros_credentials,
    load_coros_credentials,
    save_coros_credentials,
)
from src.db.engine import get_db_session
from src.db.models import DailyHealth, Document, FitnessEstimate, Goal, User
from src.db.owner import get_owner_id

router = APIRouter()
settings = get_settings()
MAX_DOCUMENT_BYTES = 20 * 1024 * 1024


async def _api_enabled(db: AsyncSession) -> bool:
    """Return True when COROS credentials are available (DB or env fallback)."""
    creds = await load_coros_credentials(db, settings.app_secret_key)
    if creds is not None:
        return True
    return bool(settings.coros_email and settings.coros_password)

class SyncConfig(BaseModel):
    api_enabled: bool
    sync_interval_minutes: int


class UserGoal(BaseModel):
    goal_description: str | None = None
    goal_race_name: str | None = None
    goal_race_date: str | None = None        # ISO date string "YYYY-MM-DD"
    goal_target_time: str | None = None      # e.g. "3:59:00"
    goal_result_time: str | None = None
    goal_race_note: str | None = None
    goal_race_tier: Literal["A", "B", "C", "D", "E"] | None = None
    weekly_training_hours: float | None = None


class GoalResponse(BaseModel):
    id: str
    goal_description: str | None = None
    goal_race_name: str | None = None
    goal_race_date: datetime.date | None = None
    goal_target_time: str | None = None
    goal_result_time: str | None = None
    goal_race_note: str | None = None
    goal_race_tier: Literal["A", "B", "C", "D", "E"] | None = None
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
    goal_result_time: str | None = None
    goal_race_note: str | None = None
    goal_race_tier: Literal["A", "B", "C", "D", "E"] | None = None
    weekly_training_hours: float | None = None
    is_active: bool = True


class GoalUpdate(BaseModel):
    goal_description: str | None = None
    goal_race_name: str | None = None
    goal_race_date: datetime.date | None = None
    goal_target_time: str | None = None
    goal_result_time: str | None = None
    goal_race_note: str | None = None
    goal_race_tier: Literal["A", "B", "C", "D", "E"] | None = None
    weekly_training_hours: float | None = None
    is_active: bool | None = None


class DocumentResponse(BaseModel):
    id: str
    goal_id: str | None
    original_filename: str
    content_type: str
    size_bytes: int
    created_at: datetime.datetime

    class Config:
        from_attributes = True


GymEquipment = Literal["machines", "barbell_rack", "dumbbells", "cable", "kettlebells", "bodyweight"]
StrengthEquipmentPreference = Literal["balanced", "machines_first", "free_weights_first"]
_GYM_EQUIPMENT = {"machines", "barbell_rack", "dumbbells", "cable", "kettlebells", "bodyweight"}
_STRENGTH_EQUIPMENT_PREFERENCES = {"balanced", "machines_first", "free_weights_first"}


class UserProfile(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    nickname: str | None = None
    birthdate: str | None = None
    sex: Literal["female", "male"] | None = None
    height_cm: float | None = None
    weight_kg: float | None = None
    body_fat_pct: float | None = None
    training_notes: str | None = None
    gym_equipment: list[GymEquipment] = Field(default_factory=list)
    strength_equipment_preference: StrengthEquipmentPreference = "balanced"
    pool_length_m: float | None = Field(default=None, ge=10, le=100)
    max_hr_bpm: int | None = None
    resting_hr_bpm: int | None = None
    heart_rate_reserve_bpm: int | None = None
    threshold_hr_bpm: int | None = None


@router.get("/sync-config")
async def get_sync_config(
    db: AsyncSession = Depends(get_db_session),
) -> SyncConfig:
    """Current API sync configuration."""
    return SyncConfig(
        api_enabled=await _api_enabled(db),
        sync_interval_minutes=settings.sync_interval_minutes,
    )


@router.get("/status")
async def app_status(
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, str | bool]:
    """Application status and feature flags."""
    return {
        "app_env": settings.app_env,
        "gemini_enabled": settings.gemini_enabled,
        "api_enabled": await _api_enabled(db),
    }


class CorosCredentialPayload(BaseModel):
    email: str
    password: str


@router.post("/coros-credentials", status_code=200)
async def set_coros_credentials(
    payload: CorosCredentialPayload,
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, str | bool]:
    """Save COROS API credentials (encrypted in DB). Password is never returned."""
    if not payload.email.strip() or not payload.password:
        raise HTTPException(status_code=400, detail="Email and password are required.")
    await save_coros_credentials(db, payload.email, payload.password, settings.app_secret_key)
    return {"configured": True, "email": payload.email.strip()}


@router.get("/coros-credentials")
async def get_coros_credentials(
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, str | bool | None]:
    """Return credential status. Password is never included in the response."""
    creds = await load_coros_credentials(db, settings.app_secret_key)
    if creds:
        return {"configured": True, "email": creds[0], "source": "db"}
    if settings.coros_email and settings.coros_password:
        return {"configured": True, "email": settings.coros_email, "source": "env"}
    return {"configured": False, "email": None, "source": None}


@router.delete("/coros-credentials", status_code=200)
async def delete_coros_credentials(
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, bool]:
    """Remove stored COROS credentials from the database."""
    await clear_coros_credentials(db)
    return {"configured": False}


@router.get("/profile", response_model=UserProfile)
async def get_profile(db: AsyncSession = Depends(get_db_session)) -> UserProfile:
    """Retrieve the user's biometric profile."""
    res = await db.execute(select(User).where(User.id == get_owner_id()))
    user = res.scalar_one_or_none()
    if not user:
        return UserProfile()

    training_setup = user.device_preferences.get("ai_training_setup", {}) if user.device_preferences else {}
    if not isinstance(training_setup, dict):
        training_setup = {}
    raw_equipment = training_setup.get("gym_equipment")
    gym_equipment = (
        [item for item in raw_equipment if isinstance(item, str) and item in _GYM_EQUIPMENT]
        if isinstance(raw_equipment, list)
        else []
    )
    raw_preference = training_setup.get("strength_equipment_preference")
    strength_equipment_preference = (
        raw_preference if raw_preference in _STRENGTH_EQUIPMENT_PREFERENCES else "balanced"
    )
    raw_pool_length = training_setup.get("pool_length_m")
    pool_length_m = (
        float(raw_pool_length)
        if isinstance(raw_pool_length, (int, float)) and 10 <= raw_pool_length <= 100
        else None
    )

    max_hr = user.max_hr_bpm
    if max_hr is None and user.device_preferences and isinstance(user.device_preferences.get("coros_running_fitness"), dict):
        rf_max = user.device_preferences["coros_running_fitness"].get("fitnessMaxHr")
        if isinstance(rf_max, (int, float)) and rf_max > 0:
            max_hr = round(rf_max)

    resting_hr = user.resting_hr_bpm
    if resting_hr is None:
        latest_daily = await db.scalar(
            select(DailyHealth.resting_hr_bpm)
            .where(DailyHealth.user_id == user.id, DailyHealth.resting_hr_bpm.is_not(None))
            .order_by(DailyHealth.date.desc())
            .limit(1)
        )
        if latest_daily:
            resting_hr = latest_daily

    hrr = (
        max_hr - resting_hr
        if max_hr is not None and resting_hr is not None and max_hr > resting_hr
        else None
    )

    threshold_hr = user.threshold_hr_bpm
    if threshold_hr is None:
        fitness = await db.scalar(
            select(FitnessEstimate.lactate_threshold_hr)
            .where(
                FitnessEstimate.user_id == user.id,
                FitnessEstimate.lactate_threshold_hr.is_not(None),
            )
            .order_by(FitnessEstimate.date.desc())
            .limit(1)
        )
        if fitness:
            threshold_hr = fitness
        elif user.device_preferences and isinstance(user.device_preferences.get("coros_running_fitness"), dict):
            rf_lthr = user.device_preferences["coros_running_fitness"].get("lthr")
            if isinstance(rf_lthr, (int, float)) and rf_lthr > 0:
                threshold_hr = round(rf_lthr)

    return UserProfile(
        first_name=user.first_name,
        last_name=user.last_name,
        nickname=user.nickname,
        birthdate=user.birthdate.isoformat() if user.birthdate else None,
        sex=user.sex,
        height_cm=user.height_cm,
        weight_kg=user.weight_kg,
        body_fat_pct=user.body_fat_pct,
        training_notes=user.training_notes,
        gym_equipment=gym_equipment,
        strength_equipment_preference=strength_equipment_preference,
        pool_length_m=pool_length_m,
        max_hr_bpm=max_hr,
        resting_hr_bpm=resting_hr,
        heart_rate_reserve_bpm=hrr,
        threshold_hr_bpm=threshold_hr,
    )


@router.put("/profile", response_model=UserProfile)
async def update_profile(
    payload: UserProfile,
    db: AsyncSession = Depends(get_db_session),
) -> UserProfile:
    """Save or update the user's biometric profile."""
    res = await db.execute(select(User).where(User.id == get_owner_id()))
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
    user.sex = payload.sex
    user.height_cm = payload.height_cm
    user.weight_kg = payload.weight_kg
    user.body_fat_pct = payload.body_fat_pct
    user.training_notes = payload.training_notes
    preferences = dict(user.device_preferences or {})
    preferences["ai_training_setup"] = {
        "gym_equipment": payload.gym_equipment,
        "strength_equipment_preference": payload.strength_equipment_preference,
        "pool_length_m": payload.pool_length_m,
    }
    user.device_preferences = preferences
    if payload.max_hr_bpm is not None:
        user.max_hr_bpm = payload.max_hr_bpm
    if payload.resting_hr_bpm is not None:
        user.resting_hr_bpm = payload.resting_hr_bpm
    if payload.threshold_hr_bpm is not None:
        user.threshold_hr_bpm = payload.threshold_hr_bpm
    user.updated_at = datetime.datetime.utcnow()

    await db.commit()
    await db.refresh(user)

    hrr = (
        user.max_hr_bpm - user.resting_hr_bpm
        if user.max_hr_bpm is not None
        and user.resting_hr_bpm is not None
        and user.max_hr_bpm > user.resting_hr_bpm
        else None
    )

    return UserProfile(
        first_name=user.first_name,
        last_name=user.last_name,
        nickname=user.nickname,
        birthdate=user.birthdate.isoformat() if user.birthdate else None,
        sex=user.sex,
        height_cm=user.height_cm,
        weight_kg=user.weight_kg,
        body_fat_pct=user.body_fat_pct,
        training_notes=user.training_notes,
        gym_equipment=payload.gym_equipment,
        strength_equipment_preference=payload.strength_equipment_preference,
        pool_length_m=payload.pool_length_m,
        max_hr_bpm=user.max_hr_bpm,
        resting_hr_bpm=user.resting_hr_bpm,
        heart_rate_reserve_bpm=hrr,
        threshold_hr_bpm=user.threshold_hr_bpm,
    )


@router.get("/goal", response_model=UserGoal)
async def get_goal(db: AsyncSession = Depends(get_db_session)) -> UserGoal:
    """Retrieve the user's current active training goal (backwards-compatibility)."""
    res = await db.execute(
        select(Goal)
        .where(Goal.user_id == get_owner_id(), Goal.is_active)
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
        goal_result_time=goal.goal_result_time,
        goal_race_note=goal.goal_race_note,
        goal_race_tier=goal.goal_race_tier,
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
        .where(Goal.user_id == get_owner_id(), Goal.is_active)
        .order_by(Goal.updated_at.desc())
    )
    goal = res.scalars().first()
    if not goal:
        goal = Goal(user_id=get_owner_id(), is_active=True)
        db.add(goal)

    goal.goal_description = payload.goal_description
    goal.goal_race_name = payload.goal_race_name
    goal.goal_race_date = (
        datetime.date.fromisoformat(payload.goal_race_date)
        if payload.goal_race_date
        else None
    )
    goal.goal_target_time = payload.goal_target_time
    goal.goal_result_time = payload.goal_result_time
    goal.goal_race_note = payload.goal_race_note
    goal.goal_race_tier = payload.goal_race_tier
    goal.weekly_training_hours = payload.weekly_training_hours
    goal.updated_at = datetime.datetime.utcnow()

    await db.commit()
    await db.refresh(goal)

    return UserGoal(
        goal_description=goal.goal_description,
        goal_race_name=goal.goal_race_name,
        goal_race_date=goal.goal_race_date.isoformat() if goal.goal_race_date else None,
        goal_target_time=goal.goal_target_time,
        goal_result_time=goal.goal_result_time,
        goal_race_note=goal.goal_race_note,
        goal_race_tier=goal.goal_race_tier,
        weekly_training_hours=goal.weekly_training_hours,
    )


@router.get("/goals", response_model=list[GoalResponse])
async def get_goals(db: AsyncSession = Depends(get_db_session)) -> list[Goal]:
    """Retrieve all training goals for the user, ordered by active status and creation date."""
    res = await db.execute(
        select(Goal)
        .where(Goal.user_id == get_owner_id())
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
        user_id=get_owner_id(),
        goal_description=payload.goal_description,
        goal_race_name=payload.goal_race_name,
        goal_race_date=payload.goal_race_date,
        goal_target_time=payload.goal_target_time,
        goal_result_time=payload.goal_result_time,
        goal_race_note=payload.goal_race_note,
        goal_race_tier=payload.goal_race_tier,
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
        select(Goal).where(Goal.id == goal_id, Goal.user_id == get_owner_id())
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
    if "goal_result_time" in update_data:
        goal.goal_result_time = payload.goal_result_time
    if "goal_race_note" in update_data:
        goal.goal_race_note = payload.goal_race_note
    if "goal_race_tier" in update_data:
        goal.goal_race_tier = payload.goal_race_tier
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
        select(Goal).where(Goal.id == goal_id, Goal.user_id == get_owner_id())
    )
    goal = res.scalar_one_or_none()
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")

    await db.execute(update(Document).where(Document.goal_id == goal_id).values(goal_id=None))
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
        select(Goal).where(Goal.id == goal_id, Goal.user_id == get_owner_id())
    )
    goal = res.scalar_one_or_none()
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")

    goal.is_active = not goal.is_active
    goal.updated_at = datetime.datetime.utcnow()

    await db.commit()
    await db.refresh(goal)
    return goal


def _document_path(storage_filename: str) -> Path:
    root = Path(settings.raw_file_store_path).resolve()
    path = (root / storage_filename).resolve()
    if path.parent != root:
        raise HTTPException(status_code=404, detail="Document not found")
    return path


@router.get("/documents", response_model=list[DocumentResponse])
async def get_documents(db: AsyncSession = Depends(get_db_session)) -> list[Document]:
    result = await db.execute(
        select(Document)
        .where(Document.user_id == get_owner_id())
        .order_by(Document.created_at.desc())
    )
    return list(result.scalars().all())


@router.post("/documents", response_model=DocumentResponse, status_code=201)
async def upload_document(
    file: UploadFile = File(...),
    goal_id: str | None = Form(default=None),
    db: AsyncSession = Depends(get_db_session),
) -> Document:
    content_type = file.content_type or ""
    if content_type != "application/pdf" and not content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only PDF and image files are allowed.")
    if goal_id:
        goal = await db.scalar(
            select(Goal).where(Goal.id == goal_id, Goal.user_id == get_owner_id())
        )
        if goal is None:
            raise HTTPException(status_code=404, detail="Goal not found")

    data = await file.read(MAX_DOCUMENT_BYTES + 1)
    if len(data) > MAX_DOCUMENT_BYTES:
        raise HTTPException(status_code=413, detail="Files must be 20 MB or smaller.")
    original_filename = (Path(file.filename or "document").name or "document")[:255]
    storage_filename = f"document_{secrets.token_hex(16)}"
    path = _document_path(storage_filename)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".upload-", delete=False) as temp:
        temp.write(data)
        temp_path = Path(temp.name)
    os.replace(temp_path, path)
    document = Document(
        user_id=get_owner_id(),
        goal_id=goal_id,
        original_filename=original_filename,
        storage_filename=storage_filename,
        content_type=content_type,
        size_bytes=len(data),
    )
    db.add(document)
    try:
        await db.commit()
        await db.refresh(document)
    except Exception:
        await db.rollback()
        path.unlink(missing_ok=True)
        temp_path.unlink(missing_ok=True)
        raise
    return document


@router.get("/documents/{document_id}/file")
async def serve_document(
    document_id: str,
    download: bool = False,
    db: AsyncSession = Depends(get_db_session),
) -> FileResponse:
    document = await db.scalar(
        select(Document).where(Document.id == document_id, Document.user_id == get_owner_id())
    )
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")
    path = _document_path(document.storage_filename)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Document file not found")
    if download:
        return FileResponse(
            path,
            media_type=document.content_type,
            filename=document.original_filename,
        )
    return FileResponse(path, media_type=document.content_type)



@router.delete("/documents/{document_id}")
async def delete_document(
    document_id: str, db: AsyncSession = Depends(get_db_session)
) -> dict[str, str]:
    document = await db.scalar(
        select(Document).where(Document.id == document_id, Document.user_id == get_owner_id())
    )
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")
    _document_path(document.storage_filename).unlink(missing_ok=True)
    await db.delete(document)
    await db.commit()
    return {"status": "success"}
