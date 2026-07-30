"""FIT file parser using fitdecode.

Extracts Session, Lap, and Record messages from .FIT files into
canonical dataclass results. Never mutates inputs.
"""

from dataclasses import dataclass, field
from datetime import datetime
from io import BytesIO
from typing import Any

import fitdecode


@dataclass(frozen=True)
class ParsedRecord:
    """Single time-series data point from a FIT Record message."""

    timestamp: datetime
    position_lat: float | None = None
    position_long: float | None = None
    distance_m: float | None = None
    altitude_m: float | None = None
    speed_mps: float | None = None
    heart_rate_bpm: int | None = None
    cadence: int | None = None
    power_w: int | None = None
    temperature_c: float | None = None


@dataclass(frozen=True)
class ParsedLap:
    """Summary of a single lap from a FIT Lap message."""

    lap_index: int
    start_time: datetime
    elapsed_s: float
    distance_m: float | None = None
    avg_hr_bpm: int | None = None
    max_hr_bpm: int | None = None
    avg_speed_mps: float | None = None
    avg_power_w: int | None = None
    calories_kcal: int | None = None
    avg_cadence: int | None = None
    lap_trigger: str | None = None


@dataclass(frozen=True)
class ParsedSession:
    """Summary of a single session from a FIT Session message."""

    sport: str
    subsport: str | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None
    elapsed_time_s: float | None = None
    timer_time_s: float | None = None
    distance_m: float | None = None
    calories_kcal: int | None = None
    elevation_gain_m: float | None = None
    elevation_loss_m: float | None = None
    avg_speed_mps: float | None = None
    max_speed_mps: float | None = None
    avg_hr_bpm: int | None = None
    max_hr_bpm: int | None = None
    avg_cadence: int | None = None
    max_cadence: int | None = None
    avg_power_w: int | None = None
    max_power_w: int | None = None
    normalized_power_w: int | None = None


@dataclass(frozen=True)
class ParsedFitFile:
    """Complete parsed result from a FIT file."""

    sessions: list[ParsedSession] = field(default_factory=list)
    laps: list[ParsedLap] = field(default_factory=list)
    records: list[ParsedRecord] = field(default_factory=list)
    device_manufacturer: str | None = None
    device_product: str | None = None
    device_serial: str | None = None
    file_type: str | None = None
    errors: list[str] = field(default_factory=list)


def _get_field_value(frame: fitdecode.FitDataMessage, field_name: str) -> Any:
    """Safely extract a field value from a FIT data message."""
    try:
        field_data = frame.get_field(field_name)
        return field_data.value if field_data is not None else None
    except KeyError:
        return None


def _semicircles_to_degrees(semicircles: int | None) -> float | None:
    """Convert FIT semicircles to decimal degrees."""
    if semicircles is None:
        return None
    return semicircles * (180.0 / 2**31)


def _map_sport(sport_raw: Any) -> str:
    """Map FIT sport enum to canonical sport type string."""
    if sport_raw is None:
        return "other"
    sport_str = str(sport_raw).lower()
    sport_map: dict[str, str] = {
        "running": "run",
        "trail_running": "trail_run",
        "cycling": "ride",
        "swimming": "swim",
        "walking": "walk",
        "hiking": "hike",
        "training": "strength",
        "multisport": "multisport",
    }
    return sport_map.get(sport_str, "other")


def parse_fit_file(data: bytes) -> ParsedFitFile:
    """Parse a FIT file from raw bytes into canonical structures.

    Args:
        data: Raw bytes of the .fit file.

    Returns:
        ParsedFitFile with sessions, laps, records, and device info.

    Raises:
        ValueError: If the file cannot be parsed as a valid FIT file.
    """
    sessions: list[ParsedSession] = []
    laps: list[ParsedLap] = []
    records: list[ParsedRecord] = []
    errors: list[str] = []
    device_manufacturer: str | None = None
    device_product: str | None = None
    device_serial: str | None = None
    file_type: str | None = None
    lap_index = 0

    try:
        with fitdecode.FitReader(BytesIO(data)) as reader:
            for frame in reader:
                if not isinstance(frame, fitdecode.FitDataMessage):
                    continue

                msg_name = frame.name

                if msg_name == "file_id":
                    file_type = str(_get_field_value(frame, "type"))
                    manufacturer = _get_field_value(frame, "manufacturer")
                    device_manufacturer = str(manufacturer) if manufacturer else None
                    product = _get_field_value(frame, "product")
                    device_product = str(product) if product else None
                    serial = _get_field_value(frame, "serial_number")
                    device_serial = str(serial) if serial else None

                elif msg_name == "session":
                    sport_raw = _get_field_value(frame, "sport")
                    subsport_raw = _get_field_value(frame, "sub_sport")
                    sessions.append(
                        ParsedSession(
                            sport=_map_sport(sport_raw),
                            subsport=str(subsport_raw) if subsport_raw else None,
                            start_time=_get_field_value(frame, "start_time"),
                            end_time=_get_field_value(frame, "timestamp"),
                            elapsed_time_s=_get_field_value(frame, "total_elapsed_time"),
                            timer_time_s=_get_field_value(frame, "total_timer_time"),
                            distance_m=_get_field_value(frame, "total_distance"),
                            calories_kcal=_get_field_value(frame, "total_calories"),
                            elevation_gain_m=_get_field_value(frame, "total_ascent"),
                            elevation_loss_m=_get_field_value(frame, "total_descent"),
                            avg_speed_mps=_get_field_value(frame, "avg_speed"),
                            max_speed_mps=_get_field_value(frame, "max_speed"),
                            avg_hr_bpm=_get_field_value(frame, "avg_heart_rate"),
                            max_hr_bpm=_get_field_value(frame, "max_heart_rate"),
                            avg_cadence=_get_field_value(frame, "avg_cadence"),
                            max_cadence=_get_field_value(frame, "max_cadence"),
                            avg_power_w=_get_field_value(frame, "avg_power"),
                            max_power_w=_get_field_value(frame, "max_power"),
                            normalized_power_w=_get_field_value(frame, "normalized_power"),
                        )
                    )

                elif msg_name == "lap":
                    laps.append(
                        ParsedLap(
                            lap_index=lap_index,
                            start_time=_get_field_value(frame, "start_time")
                            or _get_field_value(frame, "timestamp"),
                            elapsed_s=_get_field_value(frame, "total_elapsed_time") or 0.0,
                            distance_m=_get_field_value(frame, "total_distance"),
                            avg_hr_bpm=_get_field_value(frame, "avg_heart_rate"),
                            max_hr_bpm=_get_field_value(frame, "max_heart_rate"),
                            avg_speed_mps=_get_field_value(frame, "avg_speed"),
                            avg_power_w=_get_field_value(frame, "avg_power"),
                            calories_kcal=_get_field_value(frame, "total_calories"),
                            avg_cadence=_get_field_value(frame, "avg_cadence"),
                            lap_trigger=(
                                str(lap_trigger)
                                if (lap_trigger := _get_field_value(frame, "lap_trigger"))
                                is not None
                                else None
                            ),
                        )
                    )
                    lap_index += 1

                elif msg_name == "record":
                    ts = _get_field_value(frame, "timestamp")
                    if ts is None:
                        continue
                    records.append(
                        ParsedRecord(
                            timestamp=ts,
                            position_lat=_semicircles_to_degrees(
                                _get_field_value(frame, "position_lat")
                            ),
                            position_long=_semicircles_to_degrees(
                                _get_field_value(frame, "position_long")
                            ),
                            distance_m=_get_field_value(frame, "distance"),
                            altitude_m=_get_field_value(frame, "altitude"),
                            speed_mps=_get_field_value(frame, "speed"),
                            heart_rate_bpm=_get_field_value(frame, "heart_rate"),
                            cadence=_get_field_value(frame, "cadence"),
                            power_w=_get_field_value(frame, "power"),
                            temperature_c=_get_field_value(frame, "temperature"),
                        )
                    )

    except Exception as exc:
        errors.append(f"FIT parse error: {exc}")

    return ParsedFitFile(
        sessions=sessions,
        laps=laps,
        records=records,
        device_manufacturer=device_manufacturer,
        device_product=device_product,
        device_serial=device_serial,
        file_type=file_type,
        errors=errors,
    )
