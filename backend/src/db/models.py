"""Canonical schema as SQLAlchemy ORM models.

Every table tracks provenance: source_type, source_hash, parser_version.
Vendor-provided metrics are stored in dedicated *_vendor fields and never
overwritten by app-derived estimates.
"""

from datetime import date, datetime
from enum import StrEnum
from typing import Any, Literal
from uuid import uuid4

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSON, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class SourceType(StrEnum):
    FIT = "fit"
    TCX = "tcx"
    API_OFFICIAL = "api_official"
    MANUAL = "manual"


class SportType(StrEnum):
    RUN = "run"
    TRAIL_RUN = "trail_run"
    RIDE = "ride"
    SWIM = "swim"
    WALK = "walk"
    HIKE = "hike"
    STRENGTH = "strength"
    MULTISPORT = "multisport"
    OTHER = "other"


class ImportJobStatus(StrEnum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    PARTIAL = "partial"


# ---------------------------------------------------------------------------
# Base
# ---------------------------------------------------------------------------


class Base(DeclarativeBase):
    pass


# ---------------------------------------------------------------------------
# User & Device
# ---------------------------------------------------------------------------


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    timezone: Mapped[str] = mapped_column(String(50), default="UTC", server_default="UTC")
    units: Mapped[str] = mapped_column(String(10), default="metric", server_default="metric")

    # Biometrics & Profile
    first_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    last_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    nickname: Mapped[str | None] = mapped_column(String(100), nullable=True)
    birthdate: Mapped[date | None] = mapped_column(Date, nullable=True)
    sex: Mapped[Literal["female", "male"] | None] = mapped_column(String(10), nullable=True)
    height_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    weight_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    body_fat_pct: Mapped[float | None] = mapped_column(Float, nullable=True)

    max_hr_bpm: Mapped[int | None] = mapped_column(Integer, nullable=True)
    resting_hr_bpm: Mapped[int | None] = mapped_column(Integer, nullable=True)
    threshold_hr_bpm: Mapped[int | None] = mapped_column(Integer, nullable=True)
    threshold_pace_s_per_km: Mapped[float | None] = mapped_column(Float, nullable=True)
    ftp_w: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sleep_target_hours: Mapped[float] = mapped_column(Float, default=8.0, server_default="8.0")
    training_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    device_preferences: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, server_default=text("now()"), onupdate=datetime.utcnow
    )

    devices: Mapped[list["Device"]] = relationship(back_populates="user")
    activities: Mapped[list["Activity"]] = relationship(back_populates="user")
    goals: Mapped[list["Goal"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Device(Base):
    __tablename__ = "devices"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    vendor: Mapped[str] = mapped_column(String(50), default="COROS")
    model: Mapped[str] = mapped_column(String(100), nullable=False)
    firmware_version: Mapped[str | None] = mapped_column(String(50), nullable=True)
    serial_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    user: Mapped["User"] = relationship(back_populates="devices")


class Goal(Base):
    __tablename__ = "goals"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)

    goal_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    goal_race_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    goal_race_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    goal_target_time: Mapped[str | None] = mapped_column(String(20), nullable=True)
    goal_result_time: Mapped[str | None] = mapped_column(String(20), nullable=True)
    goal_race_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    goal_race_tier: Mapped[str | None] = mapped_column(String(1), nullable=True)
    weekly_training_hours: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    user: Mapped["User"] = relationship(back_populates="goals")


# ---------------------------------------------------------------------------
# Activity
# ---------------------------------------------------------------------------


class Activity(Base):
    __tablename__ = "activities"
    __table_args__ = (
        UniqueConstraint("source_hash", name="uq_activity_source_hash"),
        Index("ix_activity_start_time", "start_time"),
        Index("ix_activity_sport", "sport"),
    )

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    sport: Mapped[str] = mapped_column(Enum(SportType, name="sport_type"), nullable=False)
    subsport: Mapped[str | None] = mapped_column(String(50), nullable=True)
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Time
    start_time: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    end_time: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    timezone: Mapped[str] = mapped_column(String(50), default="UTC")
    elapsed_time_s: Mapped[float | None] = mapped_column(Float, nullable=True)
    timer_time_s: Mapped[float | None] = mapped_column(Float, nullable=True)
    moving_time_s: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Distance & elevation
    distance_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    elevation_gain_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    elevation_loss_m: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Calories
    calories_kcal: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Speed
    avg_speed_mps: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_speed_mps: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Heart rate
    avg_hr_bpm: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_hr_bpm: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Cadence
    avg_cadence: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_cadence: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Power
    avg_power_w: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_power_w: Mapped[int | None] = mapped_column(Integer, nullable=True)
    normalized_power_w: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Vendor metrics (preserved unchanged)
    training_load_vendor: Mapped[float | None] = mapped_column(Float, nullable=True)
    recovery_vendor: Mapped[float | None] = mapped_column(Float, nullable=True)
    training_effect_aerobic_vendor: Mapped[float | None] = mapped_column(Float, nullable=True)
    training_effect_anaerobic_vendor: Mapped[float | None] = mapped_column(Float, nullable=True)
    efficiency_vendor: Mapped[float | None] = mapped_column(Float, nullable=True)
    vo2max_vendor: Mapped[float | None] = mapped_column(Float, nullable=True)
    running_fitness_vendor: Mapped[float | None] = mapped_column(Float, nullable=True)
    ftp_vendor: Mapped[int | None] = mapped_column(Integer, nullable=True)
    strength_detail: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # App-derived metrics (separate from vendor)
    efficiency_factor_app: Mapped[float | None] = mapped_column(Float, nullable=True)
    cardiac_drift_pct_app: Mapped[float | None] = mapped_column(Float, nullable=True)
    hr_quality_flag: Mapped[str | None] = mapped_column(String(50), nullable=True)
    postmortem: Mapped[str | None] = mapped_column(Text, nullable=True)
    activity_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Provenance
    source_type: Mapped[str] = mapped_column(Enum(SourceType, name="source_type"), nullable=False)
    source_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    source_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    label_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    parser_version: Mapped[str] = mapped_column(String(20), default="0.1.0")

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    user: Mapped["User"] = relationship(back_populates="activities")
    records: Mapped[list["ActivityRecord"]] = relationship(
        back_populates="activity", cascade="all, delete-orphan"
    )
    laps: Mapped[list["ActivityLap"]] = relationship(
        back_populates="activity", cascade="all, delete-orphan"
    )


class ActivityRecord(Base):
    """Per-second time-series data from FIT/TCX parsing."""

    __tablename__ = "activity_records"
    __table_args__ = (Index("ix_record_activity_timestamp", "activity_id", "timestamp"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    activity_id: Mapped[str] = mapped_column(
        ForeignKey("activities.id", ondelete="CASCADE"), nullable=False
    )

    timestamp: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    elapsed_s: Mapped[float | None] = mapped_column(Float, nullable=True)
    position_lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    position_long: Mapped[float | None] = mapped_column(Float, nullable=True)
    distance_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    altitude_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    speed_mps: Mapped[float | None] = mapped_column(Float, nullable=True)
    heart_rate_bpm: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cadence: Mapped[int | None] = mapped_column(Integer, nullable=True)
    power_w: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ground_time_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    stride_length_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    stride_ratio_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    stride_height_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    temperature_c: Mapped[float | None] = mapped_column(Float, nullable=True)
    vertical_speed_mps: Mapped[float | None] = mapped_column(Float, nullable=True)
    grade_pct: Mapped[float | None] = mapped_column(Float, nullable=True)

    activity: Mapped["Activity"] = relationship(back_populates="records")


class ActivityLap(Base):
    __tablename__ = "activity_laps"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    activity_id: Mapped[str] = mapped_column(
        ForeignKey("activities.id", ondelete="CASCADE"), nullable=False
    )

    lap_index: Mapped[int] = mapped_column(Integer, nullable=False)
    start_time: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    elapsed_s: Mapped[float] = mapped_column(Float, nullable=False)
    distance_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    avg_hr_bpm: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_hr_bpm: Mapped[int | None] = mapped_column(Integer, nullable=True)
    avg_speed_mps: Mapped[float | None] = mapped_column(Float, nullable=True)
    avg_power_w: Mapped[int | None] = mapped_column(Integer, nullable=True)
    calories_kcal: Mapped[int | None] = mapped_column(Integer, nullable=True)
    avg_cadence: Mapped[int | None] = mapped_column(Integer, nullable=True)
    lap_trigger: Mapped[str | None] = mapped_column(String(50), nullable=True)

    activity: Mapped["Activity"] = relationship(back_populates="laps")


# ---------------------------------------------------------------------------
# Sleep
# ---------------------------------------------------------------------------


class SleepSession(Base):
    __tablename__ = "sleep_sessions"
    __table_args__ = (Index("ix_sleep_start", "sleep_start"),)

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)

    sleep_start: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    sleep_end: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    duration_s: Mapped[int] = mapped_column(Integer, nullable=False)
    is_nap: Mapped[bool] = mapped_column(Boolean, default=False)

    # Stage durations in seconds
    stage_light_s: Mapped[int | None] = mapped_column(Integer, nullable=True)
    stage_deep_s: Mapped[int | None] = mapped_column(Integer, nullable=True)
    stage_rem_s: Mapped[int | None] = mapped_column(Integer, nullable=True)
    stage_awake_s: Mapped[int | None] = mapped_column(Integer, nullable=True)

    sleep_quality_vendor: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Provenance
    source_type: Mapped[str] = mapped_column(
        Enum(SourceType, name="source_type", create_type=False), nullable=False
    )
    source_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    parser_version: Mapped[str] = mapped_column(String(20), default="0.1.0")

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


# ---------------------------------------------------------------------------
# Daily Health
# ---------------------------------------------------------------------------


class DailyHealth(Base):
    __tablename__ = "daily_health"
    __table_args__ = (UniqueConstraint("user_id", "date", name="uq_daily_health_user_date"),)

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)

    # Heart rate
    resting_hr_bpm: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # HRV
    overnight_hrv_avg_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    overnight_hrv_normal_low_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    overnight_hrv_normal_high_ms: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Other daily
    stress_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    steps: Mapped[int | None] = mapped_column(Integer, nullable=True)
    active_calories_kcal: Mapped[int | None] = mapped_column(Integer, nullable=True)
    breathing_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    spo2_pct: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Vendor fitness/recovery
    recovery_vendor: Mapped[float | None] = mapped_column(Float, nullable=True)
    base_fitness_vendor: Mapped[float | None] = mapped_column(Float, nullable=True)
    load_impact_vendor: Mapped[float | None] = mapped_column(Float, nullable=True)
    intensity_trend_vendor: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # App-derived
    hrv_7d_sma: Mapped[float | None] = mapped_column(Float, nullable=True)
    hrv_30d_sma: Mapped[float | None] = mapped_column(Float, nullable=True)
    hrv_zscore: Mapped[float | None] = mapped_column(Float, nullable=True)
    readiness_score_app: Mapped[float | None] = mapped_column(Float, nullable=True)
    strain_score_app: Mapped[float | None] = mapped_column(Float, nullable=True)
    anomaly_flags: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # Provenance
    source_type: Mapped[str] = mapped_column(
        Enum(SourceType, name="source_type", create_type=False), nullable=False
    )
    parser_version: Mapped[str] = mapped_column(String(20), default="0.1.0")

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )


# ---------------------------------------------------------------------------
# Fitness Estimates
# ---------------------------------------------------------------------------


class FitnessEstimate(Base):
    __tablename__ = "fitness_estimates"
    __table_args__ = (Index("ix_fitness_date", "date"),)

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)

    vo2max_vendor: Mapped[float | None] = mapped_column(Float, nullable=True)
    ftp_vendor: Mapped[int | None] = mapped_column(Integer, nullable=True)
    running_fitness_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    lactate_threshold_hr: Mapped[int | None] = mapped_column(Integer, nullable=True)
    lactate_threshold_pace_s_per_km: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Race predictions (seconds)
    race_pred_5k_s: Mapped[int | None] = mapped_column(Integer, nullable=True)
    race_pred_10k_s: Mapped[int | None] = mapped_column(Integer, nullable=True)
    race_pred_half_s: Mapped[int | None] = mapped_column(Integer, nullable=True)
    race_pred_marathon_s: Mapped[int | None] = mapped_column(Integer, nullable=True)

    biological_age_app: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Provenance
    source_type: Mapped[str] = mapped_column(
        Enum(SourceType, name="source_type", create_type=False), nullable=False
    )
    parser_version: Mapped[str] = mapped_column(String(20), default="0.1.0")

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


# ---------------------------------------------------------------------------
# Import & Sync Audit
# ---------------------------------------------------------------------------


class ImportJob(Base):
    __tablename__ = "import_jobs"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)

    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    file_size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(
        Enum(ImportJobStatus, name="import_job_status"), default=ImportJobStatus.PENDING
    )

    activities_created: Mapped[int] = mapped_column(Integer, default=0)
    activities_duplicate: Mapped[int] = mapped_column(Integer, default=0)
    errors_count: Mapped[int] = mapped_column(Integer, default=0)
    error_details: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    parser_version: Mapped[str] = mapped_column(String(20), default="0.1.0")
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class SyncEvent(Base):
    __tablename__ = "sync_events"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)

    source_type: Mapped[str] = mapped_column(
        Enum(SourceType, name="source_type", create_type=False), nullable=False
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    records_upserted: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


# ---------------------------------------------------------------------------
# AI Outputs
# ---------------------------------------------------------------------------


class AIOutput(Base):
    __tablename__ = "ai_outputs"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)

    output_type: Mapped[str] = mapped_column(String(50), nullable=False)
    prompt_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    response_text: Mapped[str] = mapped_column(Text, nullable=False)
    response_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    evidence_refs: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    model_name: Mapped[str] = mapped_column(String(50), nullable=False)
    tokens_used: Mapped[int | None] = mapped_column(Integer, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


# ---------------------------------------------------------------------------
# AI Chat Sessions
# ---------------------------------------------------------------------------


class ChatProject(Base):
    """Named folder grouping chat sessions in the sidebar."""

    __tablename__ = "chat_projects"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    icon: Mapped[str | None] = mapped_column(String(32), nullable=True)
    highlight_color: Mapped[str | None] = mapped_column(String(16), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_chat_projects_user_name"),)


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    project_id: Mapped[str | None] = mapped_column(
        ForeignKey("chat_projects.id", ondelete="SET NULL"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False, default="New Chat")
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    model_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    messages: Mapped[list["ChatMessage"]] = relationship(
        "ChatMessage", back_populates="session", cascade="all, delete-orphan"
    )


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    session_id: Mapped[str] = mapped_column(
        ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[str] = mapped_column(String(10), nullable=False)  # "user" | "assistant"
    content: Mapped[str] = mapped_column(Text, nullable=False)
    images: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    tool_calls: Mapped[list[dict[str, Any] | str] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    session: Mapped["ChatSession"] = relationship("ChatSession", back_populates="messages")


class AppSetting(Base):
    """Generic encrypted key-value store for server-side settings.

    Values are stored as AES-256-GCM ciphertext (base64-encoded).
    The application layer is responsible for encryption/decryption.
    """

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, server_default=text("now()"), onupdate=datetime.utcnow
    )


class CorosMcpToken(Base):
    """OAuth tokens for COROS MCP server integration."""

    __tablename__ = "coros_mcp_tokens"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    client_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    client_secret: Mapped[str | None] = mapped_column(String(255), nullable=True)
    access_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    refresh_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    expires_at: Mapped[int | None] = mapped_column(Integer, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, server_default=text("now()"), onupdate=datetime.utcnow
    )
