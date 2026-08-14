"""Deterministic retrieval from the checked-in AI Coach knowledge library."""

import re
from dataclasses import dataclass
from functools import cache
from pathlib import Path

_KNOWLEDGE_DIR = Path(__file__).resolve().parents[2] / "knowledge" / "coaching"
_MAX_RESULTS = 3
_MAX_EXCERPT_CHARS = 1_200
_TOPICS = frozenset(
    {
        "cycling",
        "crossfit",
        "endurance",
        "hyrox",
        "nutrition",
        "recovery",
        "running",
        "strength",
        "swimming",
        "ultra",
    }
)
_STOP_WORDS = frozenset(
    {
        "a",
        "about",
        "and",
        "are",
        "can",
        "for",
        "how",
        "i",
        "in",
        "is",
        "me",
        "my",
        "of",
        "on",
        "should",
        "the",
        "to",
        "what",
        "with",
    }
)


@dataclass(frozen=True)
class KnowledgeSection:
    title: str
    heading: str
    topics: frozenset[str]
    text: str


def _terms(value: str) -> set[str]:
    return {
        term
        for term in re.findall(r"[a-z0-9]+", value.lower())
        if len(term) > 1 and term not in _STOP_WORDS
    }


def _front_matter(raw: str) -> tuple[dict[str, str], str]:
    if not raw.startswith("---\n"):
        return {}, raw
    end = raw.find("\n---\n", 4)
    if end == -1:
        return {}, raw
    metadata = {
        key.strip(): value.strip()
        for line in raw[4:end].splitlines()
        if ":" in line
        for key, value in [line.split(":", 1)]
    }
    return metadata, raw[end + 5 :]


def _sections(path: Path) -> list[KnowledgeSection]:
    metadata, raw = _front_matter(path.read_text(encoding="utf-8"))
    topics = frozenset(
        value.strip().lower()
        for value in (metadata.get("topic", "") + "," + metadata.get("tags", "")).split(",")
        if value.strip()
    )
    title = metadata.get("title", path.stem.replace("-", " ").title())
    chunks = re.split(r"(?=^## )", raw, flags=re.MULTILINE)
    return [
        KnowledgeSection(
            title=title,
            heading=chunk.splitlines()[0].removeprefix("## "),
            topics=topics,
            text=chunk.strip(),
        )
        for chunk in chunks
        if chunk.strip().startswith("## ")
    ]


@cache
def _library() -> tuple[KnowledgeSection, ...]:
    return tuple(
        section for path in sorted(_KNOWLEDGE_DIR.glob("*.md")) for section in _sections(path)
    )


def search_coaching_knowledge(query: str, topic: str | None = None) -> list[str]:
    """Return up to three concise, in-document-cited knowledge excerpts."""
    query_terms = _terms(query)
    if not query_terms:
        return []
    requested_topic = topic.lower() if topic else None
    ranked: list[tuple[int, KnowledgeSection]] = []
    for section in _library():
        if requested_topic and requested_topic not in section.topics:
            continue
        text_terms = _terms(section.text)
        score = len(query_terms & text_terms)
        if query_terms & _terms(section.title):
            score += 2
        if query_terms & _terms(section.heading):
            score += 2
        if score:
            ranked.append((score, section))
    ranked.sort(key=lambda item: (-item[0], item[1].title, item[1].text))
    return [section.text[:_MAX_EXCERPT_CHARS] for _, section in ranked[:_MAX_RESULTS]]


def valid_knowledge_topic(topic: str | None) -> bool:
    return topic is None or (isinstance(topic, str) and topic.lower() in _TOPICS)
