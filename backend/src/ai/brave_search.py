"""Bounded Brave Search retrieval for current coaching information."""

from typing import Any
from urllib.parse import urlparse

import httpx

from src.config import get_settings

_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search"
_RESULT_COUNT = 3
_TRUSTED_DOMAINS = frozenset(
    {
        "acsm.org",
        "crossfit.com",
        "hyrox.com",
        "maintain.hyrox.com",
        "olympics.com",
        "pmc.ncbi.nlm.nih.gov",
        "pubmed.ncbi.nlm.nih.gov",
    }
)


def _is_trusted_url(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return any(host == domain or host.endswith(f".{domain}") for domain in _TRUSTED_DOMAINS)


def _trusted_results(payload: dict[str, Any]) -> list[dict[str, str]]:
    web = payload.get("web")
    if not isinstance(web, dict):
        return []
    results = web.get("results")
    if not isinstance(results, list):
        return []

    sources: list[dict[str, str]] = []
    for item in results:
        if not isinstance(item, dict):
            continue
        title, url, description = item.get("title"), item.get("url"), item.get("description")
        if not isinstance(title, str) or not isinstance(url, str) or not _is_trusted_url(url):
            continue
        sources.append(
            {
                "title": title,
                "url": url,
                "snippet": description if isinstance(description, str) else "",
            }
        )
        if len(sources) == _RESULT_COUNT:
            break
    return sources


async def search_live_coaching_sources(query: str) -> dict[str, list[dict[str, str]] | str]:
    """Return trusted current sources without exposing credentials."""
    api_key = get_settings().brave_search_api_key
    if not api_key:
        return {"error": "Live web search is not configured."}

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                _SEARCH_URL,
                headers={"X-Subscription-Token": api_key},
                params={"q": query, "count": 10, "safesearch": "strict"},
            )
            response.raise_for_status()
    except httpx.HTTPError:
        return {"error": "Live web search is unavailable."}

    sources = _trusted_results(response.json())
    return {"sources": sources} if sources else {"error": "No trusted live sources found."}
