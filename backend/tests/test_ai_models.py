from src.ai import openai_compat_client


def test_model_discovery_is_sorted_and_cached(monkeypatch) -> None:
    class Model:
        def __init__(self, model_id: str) -> None:
            self.id = model_id

    class Models:
        calls = 0

        def list(self):
            self.calls += 1
            return type("Response", (), {"data": [Model("z-model"), Model("a-model")]})()

    models = Models()
    client = type("Client", (), {"models": models})()
    monkeypatch.setattr(openai_compat_client, "_get_client", lambda: client)
    openai_compat_client._discover_models.cache_clear()

    assert openai_compat_client._discover_models(1) == ("a-model", "z-model")
    assert openai_compat_client._discover_models(1) == ("a-model", "z-model")
    assert models.calls == 1


def test_stream_uses_selected_model(monkeypatch) -> None:
    requested: dict[str, str] = {}

    class Completions:
        def create(self, **kwargs):
            requested["model"] = kwargs["model"]
            return []

    client = type(
        "Client",
        (),
        {"chat": type("Chat", (), {"completions": Completions()})()},
    )()
    monkeypatch.setattr(openai_compat_client, "_get_client", lambda: client)

    assert list(openai_compat_client.ask_coach_stream("Question", "Context", model="model-b")) == []
    assert requested["model"] == "model-b"


def test_resolve_model_prefixes() -> None:
    from src.ai import resolve_model

    assert resolve_model("openai_compat:claude-sonnet-4.6") == ("openai_compat", "claude-sonnet-4.6")
    assert resolve_model("gemini:gemini-3.5-flash") == ("gemini", "gemini-3.5-flash")


def test_list_provider_models(monkeypatch) -> None:
    from src.ai import list_provider_models, gemini_client, openai_compat_client

    monkeypatch.setattr(openai_compat_client, "list_models", lambda: ["claude-sonnet-4.6"])
    monkeypatch.setattr(gemini_client, "list_models", lambda: ["gemini-3.5-flash"])

    # Ensure ready flags are true for testing
    from src import ai
    monkeypatch.setattr(ai, "_openai_compat_ready", lambda: True)
    monkeypatch.setattr(ai, "_gemini_ready", lambda: True)

    providers = list_provider_models()
    assert len(providers) == 2
    assert providers[0]["id"] == "gemini"
    assert providers[0]["models"][0]["id"] == "gemini:gemini-3.5-flash"
    assert providers[1]["id"] == "openai_compat"
    assert providers[1]["models"][0]["id"] == "openai_compat:claude-sonnet-4.6"

