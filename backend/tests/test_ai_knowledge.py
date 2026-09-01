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
    assert any("Strength alongside endurance" in excerpt for excerpt in excerpts)


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


def test_limiter_diagnosis_and_phenotypes_is_searchable() -> None:
    excerpts = search_coaching_knowledge("diagnosing ceiling sustain capacity durability", "endurance")

    assert excerpts
    assert any("Capacity, durability, and specificity framework" in excerpt for excerpt in excerpts)


def test_norwegian_method_and_controlled_threshold_is_searchable() -> None:
    excerpts = search_coaching_knowledge("Norwegian method controlled threshold lactate", "running")

    assert excerpts
    assert any("Controlled threshold volume and lactate regulation" in excerpt for excerpt in excerpts)


def test_marathon_durability_and_decoupling_is_searchable() -> None:
    excerpts = search_coaching_knowledge("Maunder durability decoupling marathon", "running")

    assert excerpts
    assert any("Physiological durability versus fresh ceiling" in excerpt or "Workload decoupling onset" in excerpt for excerpt in excerpts)


def test_hyrox_running_dominance_and_strength_reserve_is_searchable() -> None:
    excerpts = search_coaching_knowledge("HYROX running 50% sled push strength reserve", "hyrox")

    assert excerpts
    assert any("running-driven hybrid competition" in excerpt or "Strength station reshuffling" in excerpt for excerpt in excerpts)


def test_strides_and_running_economy_is_searchable() -> None:
    excerpts = search_coaching_knowledge("strides neuromuscular stiffness heavy resistance", "running")

    assert excerpts
    assert any("Strides for neuromuscular coordination" in excerpt or "Running economy" in excerpt for excerpt in excerpts)


def test_cross_training_transfer_is_searchable() -> None:
    excerpts = search_coaching_knowledge("cross-training cycling eccentric tendon stiffness", "endurance")

    assert excerpts
    assert any("Cardiovascular stimulus versus running-specific mechanics" in excerpt for excerpt in excerpts)


def test_training_intensity_distribution_is_searchable() -> None:
    excerpts = search_coaching_knowledge("pyramidal polarized 80/20 distribution", "endurance")

    assert excerpts
    assert any("Distribution models: pyramidal, polarized" in excerpt or "80/20 observation" in excerpt for excerpt in excerpts)
