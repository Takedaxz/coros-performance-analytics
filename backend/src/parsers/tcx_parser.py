"""TCX file parser using lxml.

Extracts activity summaries, laps, and trackpoints from Garmin TCX format
into the same canonical dataclass structures as the FIT parser.
"""

from dataclasses import dataclass, field
from datetime import datetime
from io import BytesIO

from lxml import etree

from src.parsers.fit_parser import ParsedLap, ParsedRecord, ParsedSession

# TCX namespace
NS = {"tcx": "http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"}
EXT_NS = {"ext": "http://www.garmin.com/xmlschemas/ActivityExtension/v2"}


@dataclass(frozen=True)
class ParsedTcxFile:
    """Complete parsed result from a TCX file."""

    sessions: list[ParsedSession] = field(default_factory=list)
    laps: list[ParsedLap] = field(default_factory=list)
    records: list[ParsedRecord] = field(default_factory=list)
    sport: str = "other"
    errors: list[str] = field(default_factory=list)


def _text(element: etree._Element | None) -> str | None:
    """Extract text content from an XML element, or None."""
    if element is None:
        return None
    return element.text


def _float(element: etree._Element | None) -> float | None:
    """Extract float from XML element text."""
    text = _text(element)
    if text is None:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _int(element: etree._Element | None) -> int | None:
    """Extract int from XML element text."""
    text = _text(element)
    if text is None:
        return None
    try:
        return int(float(text))
    except ValueError:
        return None


def _parse_timestamp(text: str | None) -> datetime | None:
    """Parse ISO 8601 timestamp from TCX."""
    if text is None:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None


def _map_tcx_sport(sport_raw: str | None) -> str:
    """Map TCX sport attribute to canonical sport type."""
    if sport_raw is None:
        return "other"
    sport_map: dict[str, str] = {
        "running": "run",
        "biking": "ride",
        "other": "other",
    }
    return sport_map.get(sport_raw.lower(), "other")


def _parse_extension_value(trackpoint: etree._Element, field_name: str) -> float | None:
    """Extract a value from Garmin ActivityExtension/v2 in a trackpoint."""
    extensions = trackpoint.find("tcx:Extensions", NS)
    if extensions is None:
        return None
    tpx = extensions.find("ext:TPX", EXT_NS)
    if tpx is None:
        return None
    elem = tpx.find(f"ext:{field_name}", EXT_NS)
    return _float(elem)


def parse_tcx_file(data: bytes) -> ParsedTcxFile:
    """Parse a TCX file from raw bytes into canonical structures.

    Args:
        data: Raw bytes of the .tcx file.

    Returns:
        ParsedTcxFile with sessions, laps, records.

    Raises:
        ValueError: If the file cannot be parsed as valid TCX.
    """
    errors: list[str] = []
    sessions: list[ParsedSession] = []
    laps: list[ParsedLap] = []
    records: list[ParsedRecord] = []

    try:
        tree = etree.parse(BytesIO(data))
    except etree.XMLSyntaxError as exc:
        raise ValueError(f"Invalid TCX XML: {exc}") from exc

    root = tree.getroot()
    activities = root.findall(".//tcx:Activity", NS)

    for activity_el in activities:
        sport_attr = activity_el.get("Sport")
        sport = _map_tcx_sport(sport_attr)

        # Collect all trackpoints and laps for session-level aggregation
        all_trackpoint_timestamps: list[datetime] = []
        total_distance = 0.0
        total_calories = 0
        total_time_s = 0.0

        lap_elements = activity_el.findall("tcx:Lap", NS)
        for lap_idx, lap_el in enumerate(lap_elements):
            lap_start_str = lap_el.get("StartTime")
            lap_start = _parse_timestamp(lap_start_str)

            lap_time_s = _float(lap_el.find("tcx:TotalTimeSeconds", NS))
            lap_dist = _float(lap_el.find("tcx:DistanceMeters", NS))
            lap_cals = _int(lap_el.find("tcx:Calories", NS))
            lap_avg_hr = _int(lap_el.find("tcx:AverageHeartRateBpm/tcx:Value", NS))
            lap_max_hr = _int(lap_el.find("tcx:MaximumHeartRateBpm/tcx:Value", NS))

            laps.append(
                ParsedLap(
                    lap_index=lap_idx,
                    start_time=lap_start or datetime.min,
                    elapsed_s=lap_time_s or 0.0,
                    distance_m=lap_dist,
                    avg_hr_bpm=lap_avg_hr,
                    max_hr_bpm=lap_max_hr,
                    avg_speed_mps=None,
                    avg_power_w=None,
                    calories_kcal=lap_cals,
                    avg_cadence=None,
                    lap_trigger=None,
                )
            )

            if lap_time_s:
                total_time_s += lap_time_s
            if lap_dist:
                total_distance += lap_dist
            if lap_cals:
                total_calories += lap_cals

            # Parse trackpoints
            trackpoints = lap_el.findall("tcx:Track/tcx:Trackpoint", NS)
            for tp in trackpoints:
                ts_text = _text(tp.find("tcx:Time", NS))
                ts = _parse_timestamp(ts_text)
                if ts is None:
                    continue
                all_trackpoint_timestamps.append(ts)

                lat = _float(tp.find("tcx:Position/tcx:LatitudeDegrees", NS))
                lon = _float(tp.find("tcx:Position/tcx:LongitudeDegrees", NS))
                alt = _float(tp.find("tcx:AltitudeMeters", NS))
                dist = _float(tp.find("tcx:DistanceMeters", NS))
                hr = _int(tp.find("tcx:HeartRateBpm/tcx:Value", NS))
                cadence = _int(tp.find("tcx:Cadence", NS))

                # Garmin extensions
                speed = _parse_extension_value(tp, "Speed")
                power = _parse_extension_value(tp, "Watts")
                run_cadence = _parse_extension_value(tp, "RunCadence")

                records.append(
                    ParsedRecord(
                        timestamp=ts,
                        position_lat=lat,
                        position_long=lon,
                        altitude_m=alt,
                        distance_m=dist,
                        speed_mps=speed,
                        heart_rate_bpm=hr,
                        cadence=int(run_cadence) if run_cadence else cadence,
                        power_w=int(power) if power else None,
                        temperature_c=None,
                    )
                )

        # Build session summary
        start_time = all_trackpoint_timestamps[0] if all_trackpoint_timestamps else None
        end_time = all_trackpoint_timestamps[-1] if all_trackpoint_timestamps else None
        avg_speed = (total_distance / total_time_s) if total_time_s > 0 else None

        sessions.append(
            ParsedSession(
                sport=sport,
                start_time=start_time,
                end_time=end_time,
                elapsed_time_s=total_time_s,
                timer_time_s=total_time_s,
                distance_m=total_distance,
                calories_kcal=total_calories,
                avg_speed_mps=avg_speed,
            )
        )

    return ParsedTcxFile(
        sessions=sessions,
        laps=laps,
        records=records,
        sport=sport if activities else "other",
        errors=errors,
    )
