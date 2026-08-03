"""COROS MCP OAuth lifecycle helpers.

Implements:
- OIDC/OAuth metadata discovery
- Dynamic Client Registration (RFC 7591) — no pre-registered client_id needed
- PKCE authorization URL construction
- Authorization code exchange
- Token refresh
- DB-backed token retrieval with automatic silent refresh
"""

import logging
import secrets
import time
from base64 import urlsafe_b64encode
from datetime import datetime
from hashlib import sha256

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

_MCP_ROW_ID = "default"


# ---------------------------------------------------------------------------
# OAuth metadata discovery
# ---------------------------------------------------------------------------

async def discover_oauth_metadata(mcp_url: str) -> dict:
    """Fetch OAuth Authorization Server metadata from COROS MCP server.

    Tries the standard well-known endpoint derived from the resource URL.
    """
    # Strip path components to get the base URL for discovery
    from urllib.parse import urlparse
    parsed = urlparse(mcp_url)
    base = f"{parsed.scheme}://{parsed.netloc}"
    discovery_url = f"{base}/.well-known/oauth-authorization-server"

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(discovery_url)
        resp.raise_for_status()
        return resp.json()


# ---------------------------------------------------------------------------
# Dynamic Client Registration (RFC 7591)
# ---------------------------------------------------------------------------

async def dynamic_register_client(
    registration_endpoint: str,
    redirect_uri: str,
    mcp_url: str,
) -> dict:
    """Register this app as an OAuth client with the COROS MCP server.

    Returns the registration response containing client_id (and optionally
    client_secret for confidential clients).
    """
    payload = {
        "client_name": "COROS Core",
        "redirect_uris": [redirect_uri],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",  # PKCE public client
        "scope": "openid mcp.tools offline_access",
    }

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(registration_endpoint, json=payload)
        resp.raise_for_status()
        return resp.json()


# ---------------------------------------------------------------------------
# PKCE helpers
# ---------------------------------------------------------------------------

def _generate_pkce() -> tuple[str, str]:
    """Return (code_verifier, code_challenge) for PKCE (RFC 7636)."""
    verifier = secrets.token_urlsafe(64)
    challenge = urlsafe_b64encode(
        sha256(verifier.encode()).digest()
    ).rstrip(b"=").decode()
    return verifier, challenge


# ---------------------------------------------------------------------------
# Authorization URL
# ---------------------------------------------------------------------------

def build_authorization_url(
    authorization_endpoint: str,
    client_id: str,
    redirect_uri: str,
    scope: str,
    state: str,
    code_challenge: str,
) -> str:
    """Construct the PKCE authorization URL to redirect the user to."""
    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "scope": scope,
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    query = "&".join(f"{k}={v}" for k, v in params.items())
    return f"{authorization_endpoint}?{query}"


# ---------------------------------------------------------------------------
# Token exchange
# ---------------------------------------------------------------------------

async def exchange_code(
    token_endpoint: str,
    code: str,
    code_verifier: str,
    redirect_uri: str,
    client_id: str,
) -> dict:
    """Exchange authorization code for access + refresh tokens."""
    payload = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
        "client_id": client_id,
        "code_verifier": code_verifier,
    }
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            token_endpoint,
            data=payload,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        resp.raise_for_status()
        return resp.json()


async def refresh_access_token(
    token_endpoint: str,
    refresh_token: str,
    client_id: str,
) -> dict:
    """Silently obtain a new access token using the stored refresh token."""
    payload = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": client_id,
    }
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            token_endpoint,
            data=payload,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        resp.raise_for_status()
        return resp.json()


# ---------------------------------------------------------------------------
# In-memory OAuth state store (per-request PKCE values)
# ---------------------------------------------------------------------------

# Keyed by `state` param — cleared once the callback is received.
_pending_states: dict[str, dict] = {}


def start_oauth_flow(
    authorization_endpoint: str,
    token_endpoint: str,
    registration_endpoint: str,
    client_id: str,
    redirect_uri: str,
    scope: str = "openid mcp.tools offline_access",
    theme: str = "dark",
) -> tuple[str, str]:
    """Create a PKCE state entry and return (state, authorization_url)."""
    state = secrets.token_urlsafe(16)
    verifier, challenge = _generate_pkce()

    _pending_states[state] = {
        "verifier": verifier,
        "client_id": client_id,
        "token_endpoint": token_endpoint,
        "redirect_uri": redirect_uri,
        "theme": theme,
    }

    url = build_authorization_url(
        authorization_endpoint=authorization_endpoint,
        client_id=client_id,
        redirect_uri=redirect_uri,
        scope=scope,
        state=state,
        code_challenge=challenge,
    )
    return state, url


def consume_oauth_state(state: str) -> dict | None:
    """Pop and return the PKCE state entry. Returns None if state is unknown."""
    return _pending_states.pop(state, None)


# ---------------------------------------------------------------------------
# DB helpers — token persistence
# ---------------------------------------------------------------------------

async def save_tokens(
    db: AsyncSession,
    client_id: str,
    access_token: str,
    refresh_token: str | None,
    expires_in: int | None,
    client_secret: str | None = None,
) -> None:
    """Upsert OAuth tokens into the coros_mcp_tokens table."""
    expires_at = int(time.time()) + (expires_in or 3600)
    now = datetime.utcnow()

    await db.execute(
        text(
            """
            INSERT INTO coros_mcp_tokens
                (id, client_id, client_secret, access_token, refresh_token, expires_at, updated_at)
            VALUES
                (:id, :client_id, :client_secret, :access_token, :refresh_token, :expires_at, :updated_at)
            ON CONFLICT (id) DO UPDATE SET
                client_id     = EXCLUDED.client_id,
                client_secret = EXCLUDED.client_secret,
                access_token  = EXCLUDED.access_token,
                refresh_token = EXCLUDED.refresh_token,
                expires_at    = EXCLUDED.expires_at,
                updated_at    = EXCLUDED.updated_at
            """
        ),
        {
            "id": _MCP_ROW_ID,
            "client_id": client_id,
            "client_secret": client_secret,
            "access_token": access_token,
            "refresh_token": refresh_token,
            "expires_at": expires_at,
            "updated_at": now,
        },
    )
    await db.commit()


async def load_tokens(db: AsyncSession) -> dict | None:
    """Return the stored MCP token row, or None if not connected."""
    result = await db.execute(
        text("SELECT * FROM coros_mcp_tokens WHERE id = :id"),
        {"id": _MCP_ROW_ID},
    )
    row = result.mappings().one_or_none()
    return dict(row) if row else None


async def delete_tokens(db: AsyncSession) -> None:
    """Remove stored MCP tokens (disconnect)."""
    await db.execute(
        text("DELETE FROM coros_mcp_tokens WHERE id = :id"),
        {"id": _MCP_ROW_ID},
    )
    await db.commit()


# ---------------------------------------------------------------------------
# Public helper — get a valid access token (refresh if needed)
# ---------------------------------------------------------------------------

_TOKEN_EXPIRY_BUFFER_SECONDS = 120


async def get_valid_access_token(db: AsyncSession, mcp_url: str) -> str:
    """Return a usable access token, refreshing silently if close to expiry.

    Raises RuntimeError if no tokens are stored (user has not connected yet).
    """
    row = await load_tokens(db)
    if not row:
        raise RuntimeError("COROS MCP not connected. Complete OAuth flow first.")

    now = int(time.time())
    expires_at = row.get("expires_at") or 0

    if expires_at - now > _TOKEN_EXPIRY_BUFFER_SECONDS:
        return row["access_token"]

    # Token expired or close to expiry — attempt silent refresh.
    refresh_token = row.get("refresh_token")
    client_id = row.get("client_id")
    if not refresh_token or not client_id:
        raise RuntimeError("COROS MCP token expired and no refresh token available. Reconnect.")

    logger.info("coros_mcp: access token expired, refreshing silently")
    try:
        metadata = await discover_oauth_metadata(mcp_url)
        token_endpoint = metadata["token_endpoint"]
        tokens = await refresh_access_token(token_endpoint, refresh_token, client_id)
    except Exception as exc:
        raise RuntimeError(f"COROS MCP token refresh failed: {exc}") from exc

    await save_tokens(
        db,
        client_id=client_id,
        access_token=tokens["access_token"],
        refresh_token=tokens.get("refresh_token", refresh_token),
        expires_in=tokens.get("expires_in"),
        client_secret=row.get("client_secret"),
    )
    return tokens["access_token"]
