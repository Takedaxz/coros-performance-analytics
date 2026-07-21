"""COROS MCP OAuth routes.

Handles the browser-based OAuth flow that lets the user authorize COROS Analytics
to call the COROS MCP server without using the Mobile API.

Flow:
  GET /auth/coros-mcp/connect   → redirect user to COROS OAuth page
  GET /auth/coros-mcp/callback  → receive code, exchange for tokens, store in DB
  GET /auth/coros-mcp/status    → connection state for the frontend
  DELETE /auth/coros-mcp        → disconnect (delete stored tokens)
"""

import logging

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
            content=_error_page("Could not reach COROS MCP server. Try again later."),
            status_code=502,
        )

    registration_endpoint = metadata.get("registration_endpoint")
    authorization_endpoint = metadata.get("authorization_endpoint")
    token_endpoint = metadata.get("token_endpoint")

    if not authorization_endpoint or not token_endpoint:
        return HTMLResponse(
            content=_error_page("COROS MCP returned incomplete OAuth metadata."),
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
                content=_error_page(f"COROS OAuth registration failed: {exc}"),
                status_code=502,
            )

    if not client_id:
        return HTMLResponse(
            content=_error_page(
                "COROS MCP server does not support dynamic registration. "
                "A pre-registered client_id is required."
            ),
            status_code=501,
        )

    _state, auth_url = start_oauth_flow(
        authorization_endpoint=authorization_endpoint,
        token_endpoint=token_endpoint,
        registration_endpoint=registration_endpoint or "",
        client_id=client_id,
        redirect_uri=settings.coros_mcp_redirect_uri,
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
    if error:
        logger.warning("coros_mcp: OAuth error from COROS: %s", error)
        return HTMLResponse(content=_error_page(f"COROS authorization denied: {error}"))

    if not code or not state:
        return HTMLResponse(content=_error_page("Missing code or state parameter."))

    pending = consume_oauth_state(state)
    if not pending:
        # State may have been lost on server restart; try to proceed with stored client_id.
        logger.warning("coros_mcp: unknown state %s — attempting recovery", state)
        stored = await load_tokens(db)
        if not stored or not stored.get("client_id"):
            return HTMLResponse(content=_error_page("OAuth state expired. Please try connecting again."))
        client_id = stored["client_id"]
        try:
            metadata = await discover_oauth_metadata(settings.coros_mcp_url)
            token_endpoint = metadata["token_endpoint"]
        except Exception as exc:
            return HTMLResponse(content=_error_page(f"Token exchange setup failed: {exc}"))
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
            return HTMLResponse(content=_error_page(f"Token exchange failed: {exc}. Please reconnect."))
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
            return HTMLResponse(content=_error_page(f"Token exchange failed: {exc}"))

    await save_tokens(
        db,
        client_id=client_id,
        access_token=tokens["access_token"],
        refresh_token=tokens.get("refresh_token"),
        expires_in=tokens.get("expires_in"),
    )

    logger.info("coros_mcp: OAuth complete, tokens stored")
    return HTMLResponse(content=_success_page())


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

def _success_page() -> str:
    return """<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>COROS Connected</title>
<style>
  body{font-family:system-ui,sans-serif;display:flex;align-items:center;
       justify-content:center;height:100vh;margin:0;background:#0f1117;color:#e2e8f0}
  .card{text-align:center;padding:2rem 3rem;background:#1a1f2e;border-radius:1rem;
        border:1px solid #2d3748}
  h1{color:#68d391;margin-bottom:.5rem}
  p{color:#a0aec0}
  button{margin-top:1.5rem;padding:.6rem 1.4rem;background:#3182ce;color:#fff;
         border:none;border-radius:.5rem;cursor:pointer;font-size:1rem}
</style>
</head>
<body>
<div class="card">
  <h1>COROS MCP Connected</h1>
  <p>Sleep data sync is now active. You can close this tab.</p>
  <button onclick="window.close()">Close</button>
</div>
</body>
</html>"""


def _error_page(message: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Connection Failed</title>
<style>
  body{{font-family:system-ui,sans-serif;display:flex;align-items:center;
       justify-content:center;height:100vh;margin:0;background:#0f1117;color:#e2e8f0}}
  .card{{text-align:center;padding:2rem 3rem;background:#1a1f2e;border-radius:1rem;
        border:1px solid #2d3748}}
  h1{{color:#fc8181;margin-bottom:.5rem}}
  p{{color:#a0aec0;max-width:24rem}}
  button{{margin-top:1.5rem;padding:.6rem 1.4rem;background:#3182ce;color:#fff;
         border:none;border-radius:.5rem;cursor:pointer;font-size:1rem}}
</style>
</head>
<body>
<div class="card">
  <h1>Connection Failed</h1>
  <p>{message}</p>
  <button onclick="window.close()">Close</button>
</div>
</body>
</html>"""
