from src.ai.knowledge import search_coaching_knowledge, valid_knowledge_topic


def test_knowledge_search_returns_cited_nutrition_guidance() -> None:
    excerpts = search_coaching_knowledge("protein while cutting", "nutrition")

    assert excerpts
    assert "ISSN position stand" in excerpts[0]


def test_knowledge_search_rejects_unknown_topics() -> None:
    assert valid_knowledge_topic("recovery")
    assert not valid_knowledge_topic("medical")


def test_strength_topic_includes_mixed_modal_guidance() -> None:
    excerpts = search_coaching_knowledge("strength session", "strength")

    assert excerpts
    assert "Strength alongside endurance" in excerpts[0]


def test_ultra_search_returns_distance_specific_guidance() -> None:
    excerpts = search_coaching_knowledge("100K fueling and back-to-back training", "ultra")

    assert excerpts
    assert "50K, 100K, and ultra preparation" in excerpts[0]


def test_cycling_and_swimming_topics_are_available() -> None:
    assert valid_knowledge_topic("cycling")
    assert valid_knowledge_topic("swimming")
    assert search_coaching_knowledge("threshold intervals", "cycling")
    assert search_coaching_knowledge("pool technique drills", "swimming")


def test_zone2_and_interval_note_is_searchable() -> None:
    excerpts = search_coaching_knowledge("zone 2 interval aerobic", "endurance")

    assert excerpts
    assert any("Zone 2 builds repeatable aerobic volume" in excerpt for excerpt in excerpts)
