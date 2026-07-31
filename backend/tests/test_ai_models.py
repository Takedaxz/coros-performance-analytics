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
