"""COROS MCP client for daily steps and active calories."""

import datetime
import json
import re
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

_PREFERRED_TOOL = "queryDailyHealthData"
_FALLBACK_TOOL = "get_daily_health_data"


async def fetch_daily_health_via_mcp(
    start_day: str, end_day: str, db: "AsyncSession"
) -> list[dict[str, Any]]:
    """Fetch daily health records through the user-authorized COROS MCP server."""
    from src.config import get_settings
    from src.mcp.coros_mcp_auth import get_valid_access_token

    settings = get_settings()
    access_token = await get_valid_access_token(db, settings.coros_mcp_url)
    days = _days_between(start_day, end_day)
    from mcp.client.session import ClientSession
    from mcp.client.streamable_http import streamablehttp_client

    async with streamablehttp_client(
        settings.coros_mcp_url, headers={"Authorization": f"Bearer {access_token}"}
    ) as (read_stream, write_stream, _):
        async with ClientSession(read_stream, write_stream) as session:
            await session.initialize()
            tools = (await session.list_tools()).tools or []
            tool = next(
                (item for item in tools if item.name == _PREFERRED_TOOL),
                next((item for item in tools if item.name == _FALLBACK_TOOL), None),
            )
            if tool is None:
                return []
            args = _build_daily_health_args(tool.inputSchema, start_day, end_day, days)
            result = await session.call_tool(tool.name, args)
            if result.isError:
                raise RuntimeError(f"COROS MCP tool {tool.name} failed: {result.content}")

    return _parse_mcp_daily_health_result(result.content, end_day)


def _days_between(start_day: str, end_day: str) -> int:
    try:
        start = datetime.datetime.strptime(start_day, "%Y%m%d")
        end = datetime.datetime.strptime(end_day, "%Y%m%d")
        return max(1, (end - start).days)
    except ValueError:
        return 14


def _build_daily_health_args(
    schema: dict[str, Any], start_day: str, end_day: str, days: int
) -> dict[str, Any]:
    """Build the single range argument shape declared by the MCP tool."""
    properties = schema.get("properties", {})
    names = set(properties) if isinstance(properties, dict) else set()
    required = set(schema.get("required", []))
    end_iso = f"{end_day[:4]}-{end_day[4:6]}-{end_day[6:]}"
    start_iso = f"{start_day[:4]}-{start_day[4:6]}-{start_day[6:]}"
    args: dict[str, Any]

    if {"startDate", "endDate"} <= names:
        args = {"startDate": start_iso, "endDate": end_iso}
        if "days" in names:
            args["days"] = days
    elif {"startDay", "endDay"} <= names:
        args = {"startDay": start_day, "endDay": end_day}
        if "days" in names:
            args["days"] = days
    elif "days" in names:
        args = {"days": days}
    elif start_day == end_day and "date" in names:
        args = {"date": end_iso}
    else:
        raise RuntimeError("Unsupported COROS MCP daily-health tool schema")

    if not required <= args.keys():
        raise RuntimeError("Unsupported COROS MCP daily-health required fields")
    return args


def _parse_mcp_daily_health_result(
    content: list[Any], fallback_day: str | None = None
) -> list[dict[str, int | str | None]]:
    """Normalize MCP text blocks to the daily-health fields stored by this app."""
    records: dict[str, dict[str, int | str | None]] = {}
    for item in content:
        raw_text = getattr(item, "text", item.get("text") if isinstance(item, dict) else item)
        if not isinstance(raw_text, str):
            continue
        try:
            data = json.loads(raw_text)
        except json.JSONDecodeError:
            _add_prose_record(records, raw_text, fallback_day)
        else:
            _collect_records(records, data, fallback_day)
    return list(records.values())


def _collect_records(
    records: dict[str, dict[str, int | str | None]], data: Any, fallback_day: str | None = None
) -> None:
    if isinstance(data, list):
        for item in data:
            _collect_records(records, item, fallback_day)
    elif isinstance(data, dict):
        raw_day = data.get("happenDay") or data.get("date") or data.get("day")
        happen_day = _happen_day(raw_day) or fallback_day
        steps = _integer(data, "steps", "stepCount", "stepsCount", "totalSteps", "dailySteps")
        calories = _integer(
            data, "activeCalories", "calories", "calorie", "kcal", "totalCalories", "dailyCalories"
        )
        if happen_day and (steps is not None or calories is not None):
            current = records.setdefault(
                happen_day, {"happenDay": happen_day, "steps": None, "calories": None}
            )
            if steps is not None:
                current["steps"] = steps
            if calories is not None:
                current["calories"] = calories
        for value in data.values():
            _collect_records(records, value, happen_day)
    elif isinstance(data, str):
        _add_prose_record(records, data, fallback_day)


def _happen_day(value: Any) -> str | None:
    digits = re.sub(r"\D", "", str(value)) if value is not None else ""
    return digits[:8] if len(digits) >= 8 else None


def _add_prose_record(
    records: dict[str, dict[str, int | str | None]], text: str, fallback_day: str | None = None
) -> None:
    sections = re.split(r"(?:^|\n)\s*---\s*(\d{8}|\d{4}-\d{2}-\d{2})\s*---\s*", text)
    if len(sections) > 1:
        for i in range(1, len(sections), 2):
            happen_day = _happen_day(sections[i])
            sec_text = sections[i + 1] if i + 1 < len(sections) else ""
            if happen_day:
                steps = _number_from_label(sec_text, r"(?:steps?|step count)")
                calories = _number_from_label(
                    sec_text, r"(?:calories(?: burned)?|total calories|daily calories|calorie|kcal)"
                )
                if steps is not None or calories is not None:
                    records[happen_day] = {"happenDay": happen_day, "steps": steps, "calories": calories}
    else:
        date_match = re.search(r"\b20\d{2}[-/]?\d{2}[-/]?\d{2}\b", text)
        happen_day = _happen_day(date_match.group() if date_match else None) or fallback_day
        if not happen_day:
            return
        steps = _number_from_label(text, r"(?:steps?|step count)")
        calories = _number_from_label(
            text, r"(?:calories(?: burned)?|total calories|daily calories|calorie|kcal)"
        )
        if steps is not None or calories is not None:
            records[happen_day] = {"happenDay": happen_day, "steps": steps, "calories": calories}


def _number_from_label(text: str, label: str) -> int | None:
    match = re.search(rf"\b{label}\b\s*[:=-]\s*([\d,.]+)", text, re.IGNORECASE)
    return int(match.group(1).replace(",", "")) if match else None


def _integer(row: dict[str, Any], *keys: str) -> int | None:
    for key in keys:
        value = row.get(key)
        if value is not None:
            try:
                return int(float(str(value).replace(",", "")))
            except ValueError:
                continue
    return None


if __name__ == "__main__":
    assert _days_between("20260701", "20260702") == 1
    assert _integer({"steps": "1,234"}, "steps") == 1234
    result = _parse_mcp_daily_health_result(["2026-07-07\nSteps: 9,284\nCalories: 2,387 kcal"])
    assert result[0]["steps"] == 9284
