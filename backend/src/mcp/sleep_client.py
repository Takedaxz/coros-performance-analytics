import datetime
import json
import logging
import re
from typing import Any

from mcp.client.session import ClientSession
from mcp.client.streamable_http import streamablehttp_client
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import get_settings
from src.mcp.coros_mcp_auth import get_valid_access_token

logger = logging.getLogger(__name__)

_PREFERRED_TOOL = "querySleepData"
_FALLBACK_TOOL = "get_sleep_data"

settings = get_settings()


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

            # Discover available tools to choose the right sleep tool name.
            tool_list_result = await session.list_tools()
            available = {t.name for t in (tool_list_result.tools or [])}

            tool_name = _PREFERRED_TOOL if _PREFERRED_TOOL in available else (
                _FALLBACK_TOOL if _FALLBACK_TOOL in available else None
            )

            if not tool_name:
                logger.warning(
                    "coros_mcp_sleep: neither %s nor %s found in tool list: %s",
                    _PREFERRED_TOOL,
                    _FALLBACK_TOOL,
                    sorted(available),
                )
                return []

            try:
                dt_start = datetime.datetime.strptime(start_day, "%Y%m%d")
                dt_end = datetime.datetime.strptime(end_day, "%Y%m%d")
                days_diff = max(1, (dt_end - dt_start).days)
            except Exception:
                days_diff = 14

            # Must match the required properties exactly: startDate, endDate, days
            args: dict[str, Any] = {
                "startDate": start_day,
                "endDate": end_day,
                "days": days_diff
            }

            result = await session.call_tool(tool_name, args)

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
        
        main_sleep_match = re.search(r'Main Sleep:\s*([^\n]+)', section, re.I)
        total_minutes = 0
        if main_sleep_match:
            duration_str = main_sleep_match.group(1)
            h_match = re.search(r'(\d+)\s*h', duration_str, re.I)
            m_match = re.search(r'(\d+)\s*min', duration_str, re.I)
            hours = int(h_match.group(1)) if h_match else 0
            mins = int(m_match.group(1)) if m_match else 0
            total_minutes = hours * 60 + mins
            
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

        for nap_start, nap_end in re.findall(
            r"Nap Window:\s*\d{4}-\d{2}-\d{2}\s+(\d{2}:\d{2})\s*-\s*\d{4}-\d{2}-\d{2}\s+(\d{2}:\d{2})",
            section,
            re.I,
        ):
            start_dt = datetime.datetime.fromisoformat(f"{y}-{m}-{d}T{nap_start}")
            end_dt = datetime.datetime.fromisoformat(f"{y}-{m}-{d}T{nap_end}")
            if end_dt <= start_dt:
                end_dt += datetime.timedelta(days=1)
            records.append({
                "happenDay": happen_day,
                "isNap": True,
                "sleepStart": start_dt.isoformat(),
                "sleepEnd": end_dt.isoformat(),
                "sleepData": {"totalSleepTime": round((end_dt - start_dt).total_seconds() / 60)},
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
