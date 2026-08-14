from types import SimpleNamespace

import pytest

from src.ai import brave_search
from src.ai.brave_search import _is_trusted_url, _trusted_results


def test_live_search_keeps_only_trusted_domains_and_three_results() -> None:
    payload = {
        "web": {
            "results": [
                {"title": "ACSM", "url": "https://www.acsm.org/guidance", "description": "a"},
                {"title": "Ignore", "url": "https://example.com/post", "description": "b"},
                {
                    "title": "PubMed",
                    "url": "https://pubmed.ncbi.nlm.nih.gov/1/",
                    "description": "c",
                },
                {"title": "HYROX", "url": "https://hyrox.com/rules/", "description": "d"},
                {
                    "title": "Extra",
                    "url": "https://pmc.ncbi.nlm.nih.gov/articles/1/",
                    "description": "e",
                },
            ]
        }
    }

    sources = _trusted_results(payload)

    assert [source["title"] for source in sources] == ["ACSM", "PubMed", "HYROX"]
    assert _is_trusted_url("https://library.crossfit.com/article")
    assert not _is_trusted_url("https://acsm.org.example.com/article")


@pytest.mark.asyncio
async def test_live_search_requires_a_server_side_key(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = SimpleNamespace(brave_search_api_key="")
    monkeypatch.setattr(brave_search, "get_settings", lambda: settings)

    result = await brave_search.search_live_coaching_sources("latest HYROX rules")

    assert result == {"error": "Live web search is not configured."}
