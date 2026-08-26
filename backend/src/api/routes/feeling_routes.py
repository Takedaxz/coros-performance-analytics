"""Owner-scoped athlete-reported daily feelings."""

from datetime import date, timedelta
from typing import Literal, cast

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.engine import get_db_session
from src.db.models import DailyFeeling
from src.db.owner import get_owner_id

router = APIRouter()

FeelingLevel = Literal["very_low", "low", "okay", "good", "great"]


class FeelingPayload(BaseModel):
    feeling: FeelingLevel
    note: str | None = None

    @field_validator("note")
    @classmethod
    def normalize_note(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None


class FeelingResponse(FeelingPayload):
    date: date


def _response(entry: DailyFeeling) -> FeelingResponse:
    return FeelingResponse(
        date=entry.date, feeling=cast("FeelingLevel", entry.feeling), note=entry.note
    )


async def _entry_for_date(db: AsyncSession, feeling_date: date) -> DailyFeeling | None:
    entry = await db.scalar(
        select(DailyFeeling).where(
            DailyFeeling.user_id == get_owner_id(), DailyFeeling.date == feeling_date
        )
    )
    return entry


@router.get("/today", response_model=FeelingResponse | None)
async def get_today_feeling(db: AsyncSession = Depends(get_db_session)) -> FeelingResponse | None:
    """Return today's check-in, if the athlete has completed it."""
    entry = await _entry_for_date(db, date.today())
    return _response(entry) if entry else None


@router.get("", response_model=list[FeelingResponse])
async def list_feelings(
    days: int = Query(default=30, ge=1, le=365),
    db: AsyncSession = Depends(get_db_session),
) -> list[FeelingResponse]:
    """Return recent check-ins for the editable feeling log."""
    cutoff = date.today() - timedelta(days=days - 1)
    entries = await db.scalars(
        select(DailyFeeling)
        .where(DailyFeeling.user_id == get_owner_id(), DailyFeeling.date >= cutoff)
        .order_by(DailyFeeling.date.desc())
    )
    return [_response(entry) for entry in entries]


@router.get("/{feeling_date}", response_model=FeelingResponse | None)
async def get_feeling(
    feeling_date: date, db: AsyncSession = Depends(get_db_session)
) -> FeelingResponse | None:
    """Return one historical check-in for editing."""
    entry = await _entry_for_date(db, feeling_date)
    return _response(entry) if entry else None


@router.put("/{feeling_date}", response_model=FeelingResponse)
async def save_feeling(
    feeling_date: date,
    payload: FeelingPayload,
    db: AsyncSession = Depends(get_db_session),
) -> FeelingResponse:
    """Create or edit a feeling for today or any past day."""
    if feeling_date > date.today():
        raise HTTPException(
            status_code=422, detail="A feeling cannot be recorded for a future date."
        )

    entry = await _entry_for_date(db, feeling_date)
    if entry is None:
        entry = DailyFeeling(
            user_id=get_owner_id(), date=feeling_date, feeling=payload.feeling, note=payload.note
        )
        db.add(entry)
    else:
        entry.feeling = payload.feeling
        entry.note = payload.note

    await db.commit()
    await db.refresh(entry)
    return _response(entry)
