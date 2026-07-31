from src.api.routes.auth_routes import _error_page, _success_page
from src.mcp.coros_mcp_auth import consume_oauth_state, start_oauth_flow


def test_oauth_result_pages_preserve_theme_and_escape_errors() -> None:
    _, url = start_oauth_flow(
        authorization_endpoint="https://example.com/authorize",
        token_endpoint="https://example.com/token",
        registration_endpoint="",
        client_id="client",
        redirect_uri="http://localhost/callback",
        theme="light",
    )
    state = url.split("state=", 1)[1].split("&", 1)[0]

    assert consume_oauth_state(state)["theme"] == "light"
    assert 'data-theme="light"' in _success_page("light")
    assert "<script>" not in _error_page("<script>alert(1)</script>", "dark")
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in _error_page(
        "<script>alert(1)</script>",
        "dark",
    )
