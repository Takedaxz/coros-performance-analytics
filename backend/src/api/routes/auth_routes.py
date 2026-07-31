"""COROS MCP OAuth routes.

Handles the browser-based OAuth flow that lets the user authorize COROS Analytics
to call the COROS MCP server without using the Mobile API.

Flow:
  GET /auth/coros-mcp/connect   → redirect user to COROS OAuth page
  GET /auth/coros-mcp/callback  → receive code, exchange for tokens, store in DB
  GET /auth/coros-mcp/status    → connection state for the frontend
  DELETE /auth/coros-mcp        → disconnect (delete stored tokens)
"""

import html
import logging
from typing import Literal

from fastapi import APIRouter, Depends
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import get_settings
from src.db.engine import get_db_session
from src.mcp.coros_mcp_auth import (
    consume_oauth_state,
    delete_tokens,
    discover_oauth_metadata,
    dynamic_register_client,
    exchange_code,
    load_tokens,
    save_tokens,
    start_oauth_flow,
)

logger = logging.getLogger(__name__)
router = APIRouter()
settings = get_settings()


@router.get("/coros-mcp/connect")
async def connect_coros_mcp(
    theme: Literal["light", "dark"] = "dark",
    db: AsyncSession = Depends(get_db_session),
) -> RedirectResponse:
    """Start the COROS MCP OAuth flow.

    Discovers OAuth metadata, registers the client if not already done,
    then redirects the user's browser to the COROS authorization page.
    """
    try:
        metadata = await discover_oauth_metadata(settings.coros_mcp_url)
    except Exception as exc:
        logger.error("coros_mcp: failed to discover OAuth metadata: %s", exc)
        return HTMLResponse(
            content=_error_page("Could not reach COROS MCP server. Try again later.", theme),
            status_code=502,
        )

    registration_endpoint = metadata.get("registration_endpoint")
    authorization_endpoint = metadata.get("authorization_endpoint")
    token_endpoint = metadata.get("token_endpoint")

    if not authorization_endpoint or not token_endpoint:
        return HTMLResponse(
            content=_error_page("COROS MCP returned incomplete OAuth metadata.", theme),
            status_code=502,
        )

    # Attempt dynamic client registration if we don't have a client_id yet.
    existing = await load_tokens(db)
    client_id = existing["client_id"] if existing else None

    if not client_id and registration_endpoint:
        try:
            reg = await dynamic_register_client(
                registration_endpoint,
                settings.coros_mcp_redirect_uri,
                settings.coros_mcp_url,
            )
            client_id = reg.get("client_id")
            if not client_id:
                raise ValueError("Registration response missing client_id")
            logger.info("coros_mcp: dynamic registration succeeded, client_id=%s", client_id)
        except Exception as exc:
            logger.error("coros_mcp: dynamic registration failed: %s", exc)
            return HTMLResponse(
                content=_error_page(f"COROS OAuth registration failed: {exc}", theme),
                status_code=502,
            )

    if not client_id:
        return HTMLResponse(
            content=_error_page(
                "COROS MCP server does not support dynamic registration. "
                "A pre-registered client_id is required.",
                theme,
            ),
            status_code=501,
        )

    _state, auth_url = start_oauth_flow(
        authorization_endpoint=authorization_endpoint,
        token_endpoint=token_endpoint,
        registration_endpoint=registration_endpoint or "",
        client_id=client_id,
        redirect_uri=settings.coros_mcp_redirect_uri,
        theme=theme,
    )

    # Temporarily store client_id in DB so the callback can use it
    # (access_token placeholder; will be replaced after code exchange).
    if not existing or existing.get("client_id") != client_id:
        await save_tokens(
            db,
            client_id=client_id,
            access_token="pending",
            refresh_token=None,
            expires_in=-1,
        )

    return RedirectResponse(auth_url)


@router.get("/coros-mcp/callback")
async def coros_mcp_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: AsyncSession = Depends(get_db_session),
) -> HTMLResponse:
    """Handle the OAuth redirect from COROS.

    Exchanges the authorization code for tokens and stores them.
    Returns a small HTML page the user can close.
    """
    pending = consume_oauth_state(state) if state else None
    theme = pending.get("theme", "dark") if pending else "dark"

    if error:
        logger.warning("coros_mcp: OAuth error from COROS: %s", error)
        return HTMLResponse(content=_error_page(f"COROS authorization denied: {error}", theme))

    if not code or not state:
        return HTMLResponse(content=_error_page("Missing code or state parameter.", theme))

    if not pending:
        # State may have been lost on server restart; try to proceed with stored client_id.
        logger.warning("coros_mcp: unknown state %s — attempting recovery", state)
        stored = await load_tokens(db)
        if not stored or not stored.get("client_id"):
            return HTMLResponse(
                content=_error_page("OAuth state expired. Please try connecting again.", theme)
            )
        client_id = stored["client_id"]
        try:
            metadata = await discover_oauth_metadata(settings.coros_mcp_url)
            token_endpoint = metadata["token_endpoint"]
        except Exception as exc:
            return HTMLResponse(content=_error_page(f"Token exchange setup failed: {exc}", theme))
        code_verifier = ""  # Can't recover verifier — PKCE will fail; user must retry
        tokens = None
        try:
            tokens = await exchange_code(
                token_endpoint=token_endpoint,
                code=code,
                code_verifier=code_verifier,
                redirect_uri=settings.coros_mcp_redirect_uri,
                client_id=client_id,
            )
        except Exception as exc:
            return HTMLResponse(
                content=_error_page(f"Token exchange failed: {exc}. Please reconnect.", theme)
            )
    else:
        client_id = pending["client_id"]
        try:
            tokens = await exchange_code(
                token_endpoint=pending["token_endpoint"],
                code=code,
                code_verifier=pending["verifier"],
                redirect_uri=pending["redirect_uri"],
                client_id=client_id,
            )
        except Exception as exc:
            logger.error("coros_mcp: token exchange failed: %s", exc)
            return HTMLResponse(content=_error_page(f"Token exchange failed: {exc}", theme))

    await save_tokens(
        db,
        client_id=client_id,
        access_token=tokens["access_token"],
        refresh_token=tokens.get("refresh_token"),
        expires_in=tokens.get("expires_in"),
    )

    logger.info("coros_mcp: OAuth complete, tokens stored")
    return HTMLResponse(content=_success_page(theme))


@router.get("/coros-mcp/status")
async def coros_mcp_status(
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Return current COROS MCP connection state."""
    import time

    row = await load_tokens(db)
    if not row or row.get("access_token") == "pending":
        return {"connected": False}

    expires_at = row.get("expires_at") or 0
    return {
        "connected": True,
        "has_refresh_token": bool(row.get("refresh_token")),
        "expires_at": expires_at,
        "expired": int(time.time()) > expires_at,
    }


@router.delete("/coros-mcp")
async def disconnect_coros_mcp(
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Remove stored COROS MCP tokens."""
    await delete_tokens(db)
    logger.info("coros_mcp: disconnected")
    return {"connected": False}


# ---------------------------------------------------------------------------
# HTML helpers
# ---------------------------------------------------------------------------

def _success_page(theme: str = "dark") -> str:
    return _result_page(
        status="success",
        title="COROS MCP connected",
        message="Sleep data sync is active and ready to use.",
        theme=theme,
    )


def _error_page(message: str, theme: str = "dark") -> str:
    return _result_page(
        status="error",
        title="Connection failed",
        message=message,
        theme=theme,
    )


def _result_page(
    status: Literal["success", "error"],
    title: str,
    message: str,
    theme: str,
) -> str:
    safe_theme = "light" if theme == "light" else "dark"
    safe_message = html.escape(message)
    icon = (
        '<path d="m8.5 12.5 2.2 2.2 4.8-5.2"/>'
        if status == "success"
        else '<path d="M12 8.5v4.25M12 16h.01"/>'
    )
    eyebrow = "Connection complete" if status == "success" else "Action required"

    return f"""<!DOCTYPE html>
<html lang="en" data-theme="{safe_theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<style>
  :root {{
    color-scheme: dark;
    --bg: #070a0c; --surface: #131a1e;
    --text: #f5f7f7; --muted: #a5afb4; --border: rgba(255,255,255,.1);
    --brand: #21e6a5; --brand-text: #07120e; --success: #38df64;
    --error: #ff4d62; --shadow: 0 24px 70px rgba(0,0,0,.42);
  }}
  :root[data-theme="light"] {{
    color-scheme: light;
    --bg: #f4f6f5; --surface: #fff;
    --text: #17201c; --muted: #52605a; --border: rgba(23,32,28,.11);
    --brand: #11875f; --brand-text: #fff; --success: #15803d;
    --error: #c9364a; --shadow: 0 24px 70px rgba(55,70,63,.16);
  }}
  * {{ box-sizing: border-box; }}
  body {{
    min-height: 100vh; min-height: 100dvh; margin: 0; padding: 24px;
    display: grid; place-items: center; overflow: hidden;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
    color: var(--text); background:
      radial-gradient(
        circle at 50% 30%,
        color-mix(in srgb, var(--brand) 10%, transparent),
        transparent 34%
      ),
      var(--bg);
  }}
  .card {{
    width: min(100%, 460px); padding: clamp(32px, 8vw, 48px);
    text-align: center; background: var(--surface); border: 1px solid var(--border);
    border-radius: 20px; box-shadow: var(--shadow);
    animation: card-in 420ms cubic-bezier(.2,.8,.2,1) both;
  }}
  .brand {{
    display: inline-flex; align-items: center; gap: 9px; margin-bottom: 32px;
    color: var(--muted); font-size: 12px; font-weight: 700; letter-spacing: .16em;
    text-transform: uppercase;
  }}
  .brand-mark {{ width: 10px; height: 10px; border: 3px solid var(--brand); border-radius: 50%; }}
  .status {{
    width: 68px; height: 68px; margin: 0 auto 24px; display: grid; place-items: center;
    color: var(--{status}); background: color-mix(in srgb, var(--{status}) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--{status}) 28%, transparent);
    border-radius: 50%; animation: status-in 500ms 120ms cubic-bezier(.2,.9,.25,1.25) both;
  }}
  .status svg {{ width: 31px; height: 31px; fill: none; stroke: currentColor;
    stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }}
  .eyebrow {{
    margin: 0 0 10px; color: var(--{status}); font-size: 12px; font-weight: 700;
    letter-spacing: .12em; text-transform: uppercase;
  }}
  h1 {{ margin: 0; font-size: clamp(26px, 6vw, 34px); line-height: 1.12; letter-spacing: -.035em; }}
  .message {{
    margin: 14px auto 0; max-width: 340px; color: var(--muted);
    font-size: 15px; line-height: 1.65;
  }}
  button {{
    width: 100%; min-height: 48px; margin-top: 32px; padding: 0 20px;
    color: var(--brand-text); background: var(--brand); border: 0; border-radius: 12px;
    font: inherit; font-weight: 700; cursor: pointer;
    transition: transform 140ms ease, filter 140ms ease;
  }}
  button:hover {{ filter: brightness(1.06); transform: translateY(-1px); }}
  button:active {{ transform: translateY(0); }}
  button:focus-visible {{
    outline: 3px solid color-mix(in srgb, var(--brand) 35%, transparent);
    outline-offset: 3px;
  }}
  .hint {{ margin: 14px 0 0; color: var(--muted); font-size: 12px; }}
  @keyframes card-in {{ from {{ opacity: 0; transform: translateY(14px) scale(.985); }} }}
  @keyframes status-in {{ from {{ opacity: 0; transform: scale(.72); }} }}
  @media (prefers-reduced-motion: reduce) {{
    .card, .status {{ animation: none; }}
    button {{ transition: none; }}
  }}
</style>
</head>
<body>
  <main class="card">
    <div class="brand"><span class="brand-mark"></span>COROS Analytics</div>
    <div class="status" aria-hidden="true">
      <svg viewBox="0 0 24 24">{icon}</svg>
    </div>
    <p class="eyebrow">{eyebrow}</p>
    <h1>{title}</h1>
    <p class="message">{safe_message}</p>
    <button
      type="button"
      onclick="window.close();setTimeout(()=>document.querySelector('.hint').hidden=false,250)"
    >
      Close window
    </button>
    <p class="hint" hidden>This window can now be closed safely.</p>
  </main>
</body>
</html>"""
