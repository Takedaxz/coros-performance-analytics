import asyncio

from src import ai
from src.ai import gemini_client, list_provider_models, openai_compat_client, resolve_model


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
    assert resolve_model("openai_compat:claude-sonnet-4.6") == (
        "openai_compat",
        "claude-sonnet-4.6",
    )
    assert resolve_model("gemini:gemini-3.5-flash") == ("gemini", "gemini-3.5-flash")


def test_list_provider_models(monkeypatch) -> None:
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


def test_coach_stream_retries_gemini_quota_errors_with_flash_lite(monkeypatch) -> None:
    requested_models: list[str] = []

    def stream_with_model(
        _provider: str,
        model: str,
        *_args: object,
    ):
        requested_models.append(model)
        if model == "gemini-3.5-flash":
            raise RuntimeError("429 RESOURCE_EXHAUSTED: quota")
        yield "Flash Lite answer"

    monkeypatch.setattr(ai, "resolve_model", lambda _model: ("gemini", "gemini-3.5-flash"))
    monkeypatch.setattr(ai, "ask_coach_with_tools_stream", stream_with_model)

    loop = asyncio.new_event_loop()
    try:
        answer = "".join(
            ai.ask_coach_stream(
                "Question", "Context", user_id="user-id", tool_calls=[], event_loop=loop
            )
        )
    finally:
        loop.close()

    assert answer == "Flash Lite answer"
    assert requested_models == ["gemini-3.5-flash", "gemini-3.5-flash-lite"]


def test_coach_retries_gemini_quota_errors_with_flash_lite(monkeypatch) -> None:
    requested_models: list[str] = []

    def ask_with_model(_provider: str, model: str, *_args: object) -> str:
        requested_models.append(model)
        if model == "gemini-3.5-flash":
            raise RuntimeError("429 RESOURCE_EXHAUSTED: quota")
        return "Flash Lite answer"

    monkeypatch.setattr(ai, "resolve_model", lambda _model: ("gemini", "gemini-3.5-flash"))
    monkeypatch.setattr(ai, "ask_coach_with_tools", ask_with_model)

    loop = asyncio.new_event_loop()
    try:
        answer = ai.ask_coach(
            "Question", "Context", user_id="user-id", tool_calls=[], event_loop=loop
        )
    finally:
        loop.close()

    assert answer == "Flash Lite answer"
    assert requested_models == ["gemini-3.5-flash", "gemini-3.5-flash-lite"]


def test_resolve_model_aliases() -> None:
    assert resolve_model("3.5-flash0lite") == ("gemini", "gemini-3.5-flash-lite")
    assert resolve_model("gemini:3.5-flash0lite") == ("gemini", "gemini-3.5-flash-lite")
    assert resolve_model("3.5-flash-lite") == ("gemini", "gemini-3.5-flash-lite")


def test_generate_postmortem_passes_resolved_model(monkeypatch) -> None:
    passed_model: list[str] = []

    def mock_gemini_postmortem(context: str, act_context: str, model: str | None = None) -> str:
        passed_model.append(model or "")
        return "Postmortem OK"

    monkeypatch.setattr(gemini_client, "generate_postmortem", mock_gemini_postmortem)

    res = ai.generate_postmortem("Context", "Activity", model="3.5-flash0lite")
    assert res == "Postmortem OK"
    assert passed_model == ["gemini-3.5-flash-lite"]

