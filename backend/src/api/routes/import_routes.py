"""Import routes: upload FIT/TCX files, check import job status."""

import hashlib
from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import get_settings
from src.db.engine import get_db_session
from src.db.models import ImportJob, ImportJobStatus

router = APIRouter()
settings = get_settings()


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, str]:
    """Upload a FIT, TCX, or ZIP file for parsing and import."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in ("fit", "tcx", "zip"):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: .{ext}. Accepted: .fit, .tcx, .zip",
        )

    contents = await file.read()
    if len(contents) < 20_000 and ext != "zip":
        raise HTTPException(
            status_code=400,
            detail="File too small (<20KB). Likely not a valid activity file.",
        )
    if len(contents) > 200_000_000:
        raise HTTPException(
            status_code=400,
            detail="File too large (>200MB).",
        )

    source_hash = hashlib.sha256(contents).hexdigest()

    # Check for duplicate import
    existing = await db.execute(select(ImportJob).where(ImportJob.source_hash == source_hash))
    if existing.scalar_one_or_none() is not None:
        return {"status": "duplicate", "message": "This file has already been imported."}

    # Store raw file
    import os

    raw_dir = settings.raw_file_store_path
    os.makedirs(raw_dir, exist_ok=True)
    raw_path = os.path.join(raw_dir, f"{source_hash}.{ext}")
    with open(raw_path, "wb") as f:
        f.write(contents)

    # Create import job record
    # TODO: get real user_id from auth
    job = ImportJob(
        user_id="00000000-0000-0000-0000-000000000000",
        filename=file.filename,
        file_size_bytes=len(contents),
        source_hash=source_hash,
        status=ImportJobStatus.PENDING,
        created_at=datetime.utcnow(),
    )
    db.add(job)
    await db.flush()

    # TODO: dispatch async parse task via ARQ
    # await arq_pool.enqueue_job("parse_import", job.id)

    return {"status": "accepted", "job_id": job.id, "source_hash": source_hash}


@router.get("/jobs")
async def list_import_jobs(
    db: AsyncSession = Depends(get_db_session),
) -> list[dict[str, str | int | None]]:
    """List all import jobs ordered by creation time."""
    result = await db.execute(select(ImportJob).order_by(ImportJob.created_at.desc()).limit(50))
    jobs = result.scalars().all()
    return [
        {
            "id": j.id,
            "filename": j.filename,
            "status": j.status,
            "activities_created": j.activities_created,
            "activities_duplicate": j.activities_duplicate,
            "errors_count": j.errors_count,
            "created_at": j.created_at.isoformat() if j.created_at else None,
            "completed_at": j.completed_at.isoformat() if j.completed_at else None,
        }
        for j in jobs
    ]


@router.get("/jobs/{job_id}")
async def get_import_job(
    job_id: str,
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, str | int | dict | None]:
    """Get details of a specific import job."""
    result = await db.execute(select(ImportJob).where(ImportJob.id == job_id))
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Import job not found")
    return {
        "id": job.id,
        "filename": job.filename,
        "status": job.status,
        "activities_created": job.activities_created,
        "activities_duplicate": job.activities_duplicate,
        "errors_count": job.errors_count,
        "error_details": job.error_details,
        "parser_version": job.parser_version,
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "completed_at": job.completed_at.isoformat() if job.completed_at else None,
    }
