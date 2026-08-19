from html import unescape
from typing import Any
from urllib.parse import parse_qs, urlparse
import re

import httpx

from src.config import get_settings

_BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search"
_TAVILY_SEARCH_URL = "https://api.tavily.com/search"
_RESULT_COUNT = 5
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
    fallback_sources: list[dict[str, str]] = []
    for item in results:
        if not isinstance(item, dict):
            continue
        title, url, description = item.get("title"), item.get("url"), item.get("description")
        if not isinstance(title, str) or not isinstance(url, str):
            continue
        record = {
            "title": unescape(re.sub(r"<[^>]+>", "", title)).strip(),
            "url": url.strip(),
            "snippet": unescape(re.sub(r"<[^>]+>", "", description)).strip() if isinstance(description, str) else "",
        }
        if _is_trusted_url(url):
            sources.append(record)
        else:
            fallback_sources.append(record)
        if len(sources) == _RESULT_COUNT:
            break

    final = sources if sources else fallback_sources[:_RESULT_COUNT]
    return final


_TAVILY_EXTRACT_URL = "https://api.tavily.com/extract"


async def _search_tavily(query: str, api_key: str) -> list[dict[str, str]]:
    """Query Tavily AI Search or Extract API for advanced deep web extraction."""
    url_match = re.search(r"https?://[^\s]+", query)
    if url_match:
        target_url = url_match.group(0)
        try:
            async with httpx.AsyncClient(timeout=12.0) as client:
                extract_resp = await client.post(
                    _TAVILY_EXTRACT_URL,
                    json={"api_key": api_key, "urls": [target_url]},
                )
                if extract_resp.status_code == 200:
                    data = extract_resp.json()
                    results = data.get("results")
                    if isinstance(results, list) and results:
                        extracted_sources: list[dict[str, str]] = []
                        for item in results:
                            if not isinstance(item, dict):
                                continue
                            raw_title = item.get("title") or "Extracted Web Page"
                            raw_content = item.get("raw_content") or item.get("content") or ""
                            url = item.get("url") or target_url
                            extracted_sources.append(
                                {
                                    "title": unescape(re.sub(r"<[^>]+>", "", str(raw_title))).strip(),
                                    "url": str(url).strip(),
                                    "snippet": unescape(re.sub(r"<[^>]+>", "", str(raw_content))).strip()[:1000],
                                }
                            )
                        if extracted_sources:
                            return extracted_sources
        except Exception:
            pass

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                _TAVILY_SEARCH_URL,
                json={
                    "api_key": api_key,
                    "query": query,
                    "search_depth": "advanced",
                    "max_results": _RESULT_COUNT,
                    "include_answer": False,
                },
            )
            if resp.status_code != 200:
                return []
            data = resp.json()
            results = data.get("results")
            if not isinstance(results, list):
                return []
            sources: list[dict[str, str]] = []
            for item in results:
                if not isinstance(item, dict):
                    continue
                title, url = item.get("title"), item.get("url")
                content = item.get("content") or item.get("raw_content") or ""
                if not isinstance(title, str) or not isinstance(url, str):
                    continue
                clean_title = unescape(re.sub(r"<[^>]+>", "", title)).strip()
                clean_snippet = unescape(re.sub(r"<[^>]+>", "", str(content))).strip()
                sources.append(
                    {
                        "title": clean_title,
                        "url": url.strip(),
                        "snippet": clean_snippet[:500],
                    }
                )
                if len(sources) == _RESULT_COUNT:
                    break
            return sources
    except Exception:
        return []


async def _search_brave(query: str, api_key: str) -> list[dict[str, str]]:
    """Query Brave Search API."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                _BRAVE_SEARCH_URL,
                headers={"X-Subscription-Token": api_key},
                params={"q": query, "count": 10, "safesearch": "strict"},
            )
            if response.status_code == 200:
                return _trusted_results(response.json())
    except Exception:
        pass
    return []


async def _fallback_duckduckgo_search(query: str) -> list[dict[str, str]]:
    """Fallback to DuckDuckGo HTML search if primary & secondary providers fail or are unconfigured."""
    try:
        async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
            resp = await client.get(
                "https://html.duckduckgo.com/html/",
                params={"q": query},
                headers={
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                },
            )
            if resp.status_code != 200:
                return []
            results: list[dict[str, str]] = []
            matches = re.findall(
                r'<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)</a>.*?(?:<a[^>]+class="result__snippet"[^>]*>(.*?)</a>)?',
                resp.text,
                re.DOTALL,
            )
            for raw_url, raw_title, raw_snippet in matches:
                actual_url = raw_url
                if "uddg=" in raw_url:
                    parsed = parse_qs(urlparse(raw_url).query)
                    if "uddg" in parsed and parsed["uddg"]:
                        actual_url = parsed["uddg"][0]
                title = unescape(re.sub(r"<[^>]+>", "", raw_title)).strip()
                snippet = unescape(re.sub(r"<[^>]+>", "", raw_snippet)).strip() if raw_snippet else ""
                if actual_url.startswith("http") and title:
                    results.append({"title": title, "url": actual_url, "snippet": snippet})
                if len(results) >= _RESULT_COUNT:
                    break
            return results
    except Exception:
        return []


async def search_live_coaching_sources(query: str) -> dict[str, list[dict[str, str]] | str]:
    """Return live web search sources with primary Tavily, secondary Brave, and tertiary DuckDuckGo."""
    settings = get_settings()
    sources: list[dict[str, str]] = []

    # 1. Primary: Tavily AI Search
    tavily_key = getattr(settings, "tavily_api_key", "")
    if tavily_key:
        sources = await _search_tavily(query, tavily_key)

    # 2. Secondary: Brave Search API
    brave_key = settings.brave_search_api_key
    if not sources and brave_key:
        sources = await _search_brave(query, brave_key)

    # 3. Tertiary: DuckDuckGo Fallback
    if not sources:
        sources = await _fallback_duckduckgo_search(query)

    return {"sources": sources} if sources else {"error": "No live web search sources found."}
