import datetime
import json
import re
from typing import Any

from mcp.client.session import ClientSession
from mcp.client.streamable_http import streamablehttp_client
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import get_settings
from src.mcp.coros_mcp_auth import get_valid_access_token

_SLEEP_TOOL = "querySleepOverview"

settings = get_settings()


def _duration_minutes(value: str) -> int:
    hours = re.search(r"(\d+)\s*h", value, re.I)
    minutes = re.search(r"(\d+)\s*min", value, re.I)
    return (int(hours.group(1)) * 60 if hours else 0) + (int(minutes.group(1)) if minutes else 0)


async def fetch_sleep_via_mcp(
    start_day: str,
    end_day: str,
    db: AsyncSession,
) -> list[dict[str, Any]]:
    """Fetch sleep records from COROS MCP server for the given date range.

    Args:
        start_day: Start date in YYYYMMDD format.
        end_day:   End date in YYYYMMDD format.
        db:        DB session used to load/refresh the OAuth token.

    Returns:
        List of raw sleep record dicts compatible with _upsert_sleep().

    Raises:
        RuntimeError: If COROS MCP is not connected (no stored tokens).
    """
    access_token = await get_valid_access_token(db, settings.coros_mcp_url)

    headers = {"Authorization": f"Bearer {access_token}"}

    async with streamablehttp_client(settings.coros_mcp_url, headers=headers) as (
        read_stream,
        write_stream,
        _,
    ):
        async with ClientSession(read_stream, write_stream) as session:
            await session.initialize()

            # Check the tool exposed by the current COROS MCP server.
            tool_list_result = await session.list_tools()
            available = {t.name for t in (tool_list_result.tools or [])}

            if _SLEEP_TOOL not in available:
                raise ValueError(f"COROS MCP sleep tool {_SLEEP_TOOL} is unavailable")

            result = await session.call_tool(
                _SLEEP_TOOL, {"startDate": start_day, "endDate": end_day}
            )

    if result.isError:
        raise ValueError("COROS MCP sleep query returned an error")

    return _parse_mcp_sleep_result(result.content)


def parse_mcp_sleep_prose(text: str) -> list[dict[str, Any]]:
    """Parse human-readable prose text returned by COROS MCP sleep tool."""
    # Split text into sections starting with a date e.g. 2026-07-22
    sections = re.split(r'(?:\r?\n)+(?=20\d{2}-\d{2}-\d{2})', text.strip())
    
    records = []
    for section in sections:
        section = section.strip()
        if not section:
            continue
            
        date_match = re.match(r'^(20\d{2})-(\d{2})-(\d{2})', section)
        if not date_match:
            continue
            
        y, m, d = date_match.groups()
        happen_day = f"{y}{m}{d}"
        
        score_match = re.search(r'Sleep Score:\s*(\d+)', section, re.I)
        score = int(score_match.group(1)) if score_match else None
        
        main_sleep_match = re.search(r'Main Sleep(?: \(asleep\))?:\s*([^\n]+)', section, re.I)
        total_minutes = _duration_minutes(main_sleep_match.group(1)) if main_sleep_match else 0
            
        deep_match = re.search(r'Deep Sleep Ratio:\s*(\d+)\s*%', section, re.I)
        light_match = re.search(r'Light Sleep Ratio:\s*(\d+)\s*%', section, re.I)
        rem_match = re.search(r'REM Ratio:\s*(\d+)\s*%', section, re.I)
        awake_ratio_match = re.search(r'Awake Ratio:\s*(\d+)\s*%', section, re.I)
        
        deep_pct = int(deep_match.group(1)) if deep_match else 0
        light_pct = int(light_match.group(1)) if light_match else 0
        rem_pct = int(rem_match.group(1)) if rem_match else 0
        awake_pct = int(awake_ratio_match.group(1)) if awake_ratio_match else 0
        
        deep_time = round((deep_pct / 100) * total_minutes) if total_minutes else 0
        light_time = round((light_pct / 100) * total_minutes) if total_minutes else 0
        rem_time = round((rem_pct / 100) * total_minutes) if total_minutes else 0
        wake_time = round((awake_pct / 100) * total_minutes) if total_minutes else 0
        
        records.append({
            "happenDay": happen_day,
            "performance": score,
            "sleepData": {
                "totalSleepTime": total_minutes,
                "deepTime": deep_time,
                "lightTime": light_time,
                "eyeTime": rem_time,
                "wakeTime": wake_time,
            }
        })

        nap_total_match = re.search(r"Naps Total(?: \(asleep\))?:\s*([^\n]+)", section, re.I)
        nap_total_minutes = _duration_minutes(nap_total_match.group(1)) if nap_total_match else None
        nap_windows = re.findall(
            r"Nap Window:\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})"
            r"\s*-\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})",
            section,
            re.I,
        )
        for nap_start_day, nap_start, nap_end_day, nap_end in nap_windows:
            start_dt = datetime.datetime.fromisoformat(f"{nap_start_day}T{nap_start}")
            end_dt = datetime.datetime.fromisoformat(f"{nap_end_day}T{nap_end}")
            if end_dt <= start_dt:
                end_dt += datetime.timedelta(days=1)
            nap_minutes = (
                nap_total_minutes
                if len(nap_windows) == 1 and nap_total_minutes is not None
                else round((end_dt - start_dt).total_seconds() / 60)
            )
            records.append({
                "happenDay": happen_day,
                "isNap": True,
                "sleepStart": start_dt.isoformat(),
                "sleepEnd": end_dt.isoformat(),
                "sleepData": {"totalSleepTime": nap_minutes},
            })
        
    return records


def _parse_mcp_sleep_result(content: list[Any]) -> list[dict[str, Any]]:
    """Parse MCP tool result content into a list of sleep record dicts.

    The MCP response is a list of content items. Each item may be a
    TextContent block containing JSON, or already a dict.
    We normalize them into the same shape as the Mobile API response so
    _upsert_sleep() needs no changes.
    """
    records: list[dict[str, Any]] = []

    for item in content:
        raw_text: str | None = None

        if hasattr(item, "text"):
            raw_text = item.text
        elif isinstance(item, dict) and "text" in item:
            raw_text = item["text"]
        elif isinstance(item, str):
            raw_text = item

        if raw_text is None:
            continue

        try:
            parsed = json.loads(raw_text)
            if isinstance(parsed, list):
                records.extend(_normalize_sleep_record(r) for r in parsed if isinstance(r, dict))
            elif isinstance(parsed, dict):
                day_list = (
                    parsed.get("dayDataList")
                    or parsed.get("data", {}).get("statisticData", {}).get("dayDataList")
                    or parsed.get("data")
                )
                if isinstance(day_list, list):
                    records.extend(
                        _normalize_sleep_record(r) for r in day_list if isinstance(r, dict)
                    )
                elif parsed.get("happenDay") or parsed.get("sleepData"):
                    records.append(_normalize_sleep_record(parsed))
            elif isinstance(parsed, str):
                records.extend(parse_mcp_sleep_prose(parsed))
        except (json.JSONDecodeError, TypeError):
            # Parse human-readable text block fallback
            records.extend(parse_mcp_sleep_prose(raw_text))

    return [r for r in records if r]

def _normalize_sleep_record(raw: dict[str, Any]) -> dict[str, Any]:
    """Normalize a raw MCP sleep record to match the Mobile API shape.

    Mobile API shape (what _upsert_sleep expects):
      {
        "happenDay": "20260721",
        "performance": 85,          # sleep quality score
        "sleepData": {
          "totalSleepTime": 420,    # minutes
          "deepTime": 90,
          "lightTime": 200,
          "eyeTime": 80,            # REM
          "wakeTime": 50,
        }
      }
    """
    happen_day = str(
        raw.get("happenDay") or raw.get("date") or raw.get("day") or ""
    ).replace("-", "")

    sleep_data_raw = raw.get("sleepData") or raw

    def mins(key: str, alt: str | None = None) -> int:
        v = sleep_data_raw.get(key) or (sleep_data_raw.get(alt) if alt else None) or 0
        return int(v)

    return {
        "happenDay": happen_day,
        "isNap": bool(raw.get("isNap") or raw.get("is_nap")),
        "sleepStart": raw.get("sleepStart") or raw.get("sleep_start"),
        "sleepEnd": raw.get("sleepEnd") or raw.get("sleep_end"),
        "performance": raw.get("performance") or raw.get("score") or raw.get("sleepScore"),
        "sleepData": {
            "totalSleepTime": mins("totalSleepTime", "totalMinutes"),
            "deepTime": mins("deepTime", "deepMinutes"),
            "lightTime": mins("lightTime", "lightMinutes"),
            "eyeTime": mins("eyeTime", "remMinutes"),
            "wakeTime": mins("wakeTime", "awakeMinutes"),
        },
    }
