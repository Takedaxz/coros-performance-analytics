"""COROS MCP sleep data client.

Calls the querySleepData (or get_sleep_data) MCP tool on the COROS MCP server
using a stored OAuth Bearer token — no Mobile API login required.
"""

import json
import logging
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

            args: dict[str, Any] = {"startDay": start_day, "endDay": end_day}

            result = await session.call_tool(tool_name, args)

    return _parse_mcp_sleep_result(result.content)


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
        except (json.JSONDecodeError, TypeError):
            continue

        # The MCP tool may return a list or a single object.
        if isinstance(parsed, list):
            records.extend(_normalize_sleep_record(r) for r in parsed if isinstance(r, dict))
        elif isinstance(parsed, dict):
            # May be wrapped: {"data": [...]} or {"statisticData": {"dayDataList": [...]}}
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
        "performance": raw.get("performance") or raw.get("score") or raw.get("sleepScore"),
        "sleepData": {
            "totalSleepTime": mins("totalSleepTime", "totalMinutes"),
            "deepTime": mins("deepTime", "deepMinutes"),
            "lightTime": mins("lightTime", "lightMinutes"),
            "eyeTime": mins("eyeTime", "remMinutes"),
            "wakeTime": mins("wakeTime", "awakeMinutes"),
        },
    }
