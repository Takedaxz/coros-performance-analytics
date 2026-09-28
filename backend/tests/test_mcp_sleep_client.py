import json
from contextlib import asynccontextmanager
from types import SimpleNamespace
from typing import TYPE_CHECKING, cast
from unittest.mock import AsyncMock

import pytest

from src.mcp import sleep_client
from src.mcp.sleep_client import _parse_mcp_sleep_result

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


SLEEP_OVERVIEW = (
    "Sleep Overview\n"
    "========================\n"
    "Note: each record below is dated by its wake-up day.\n\n"
    "2026-06-03\n"
    "Sleep Score: 82\n"
    "Daily Sleep: 7h 15min (incl. naps)\n"
    "Main Sleep (asleep): 7h 15min\n"
    "Main Sleep Period (incl. awake): 7h 30min\n"
    "Sleep metrics scope: daily\n"
    "Deep Sleep Ratio: 20%\n"
    "Light Sleep Ratio: 55%\n"
    "REM Ratio: 22%\n"
    "Awake Ratio: 3%\n"
    "Awake Time: 15 min\n"
    "Awake Count (>5 min): 1\n"
    "Main Sleep Window: 2026-06-02 22:30 - 2026-06-03 06:00\n"
    "Naps Total: 0 min"
)


def test_parses_live_sleep_overview_format() -> None:
    records = _parse_mcp_sleep_result([{"text": json.dumps(SLEEP_OVERVIEW)}])

    assert len(records) == 1
    assert records[0]["happenDay"] == "20260603"
    assert records[0]["performance"] == 82
    assert records[0]["sleepData"]["totalSleepTime"] == 435


def test_nap_duration_uses_asleep_time_from_overview() -> None:
    overview = (
        "Sleep Overview\n\n"
        "2026-06-03\n"
        "Sleep Score: 82\n"
        "Main Sleep (asleep): 5h 0min\n"
        "Naps Total (asleep): 2h 10min\n"
        "Nap Window: 2026-06-03 09:00 - 2026-06-03 11:20"
    )

    records = _parse_mcp_sleep_result([{"text": json.dumps(overview)}])

    assert len(records) == 2
    assert records[1]["isNap"] is True
    assert records[1]["sleepData"]["totalSleepTime"] == 130
    assert records[1]["sleepStart"] == "2026-06-03T09:00:00"
    assert records[1]["sleepEnd"] == "2026-06-03T11:20:00"


@pytest.mark.asyncio
async def test_fetch_sleep_uses_available_overview_tool(monkeypatch: pytest.MonkeyPatch) -> None:
    session = AsyncMock()
    session.__aenter__.return_value = session
    session.list_tools.return_value = SimpleNamespace(
        tools=[SimpleNamespace(name="querySleepOverview")]
    )
    session.call_tool.return_value = SimpleNamespace(
        isError=False,
        content=[{"text": json.dumps(SLEEP_OVERVIEW)}],
        structuredContent=None,
    )

    @asynccontextmanager
    async def stream(*_args: object, **_kwargs: object):
        yield None, None, None

    monkeypatch.setattr(sleep_client, "get_valid_access_token", AsyncMock(return_value="token"))
    monkeypatch.setattr(sleep_client, "streamablehttp_client", stream)
    monkeypatch.setattr(sleep_client, "ClientSession", lambda *_args: session)

    records = await sleep_client.fetch_sleep_via_mcp(
        "20260601", "20260603", cast("AsyncSession", None)
    )

    session.call_tool.assert_awaited_once_with(
        "querySleepOverview", {"startDate": "20260601", "endDate": "20260603"}
    )
    assert records[0]["sleepData"]["totalSleepTime"] == 435
