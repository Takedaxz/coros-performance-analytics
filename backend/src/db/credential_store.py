"""Encrypted credential store for COROS API credentials.

Credentials are encrypted with AES-256-GCM (การเข้ารหัสแบบ symmetric พร้อม authentication tag)
using APP_SECRET_KEY as key material before being persisted in the `app_settings` table.
The plaintext password is never written to disk or logged.
"""

import base64
import hashlib
import json
import os

from Crypto.Cipher import AES
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.models import AppSetting

_SETTING_KEY = "coros.credentials"


def _derive_key(secret: str) -> bytes:
    """Derive a 32-byte AES key from APP_SECRET_KEY via SHA-256."""
    return hashlib.sha256(secret.encode()).digest()


def _encrypt(plaintext: str, secret: str) -> str:
    """Return base64-encoded AES-256-GCM ciphertext with prepended nonce."""
    key = _derive_key(secret)
    nonce = os.urandom(12)
    cipher = AES.new(key, AES.MODE_GCM, nonce=nonce)
    ciphertext, tag = cipher.encrypt_and_digest(plaintext.encode())
    # Layout: nonce(12) + tag(16) + ciphertext
    blob = nonce + tag + ciphertext
    return base64.b64encode(blob).decode()


def _decrypt(encoded: str, secret: str) -> str:
    """Decrypt a blob produced by _encrypt. Raises ValueError on tamper."""
    key = _derive_key(secret)
    blob = base64.b64decode(encoded)
    nonce, tag, ciphertext = blob[:12], blob[12:28], blob[28:]
    cipher = AES.new(key, AES.MODE_GCM, nonce=nonce)
    try:
        return cipher.decrypt_and_verify(ciphertext, tag).decode()
    except ValueError as exc:
        raise ValueError("Credential decryption failed — possible tampering.") from exc


async def save_coros_credentials(
    db: AsyncSession,
    email: str,
    password: str,
    secret: str,
) -> None:
    """Encrypt and persist COROS credentials in the database."""
    payload = json.dumps({"email": email.strip(), "password": password})
    encrypted = _encrypt(payload, secret)

    existing = await db.get(AppSetting, _SETTING_KEY)
    if existing:
        existing.value = encrypted
    else:
        db.add(AppSetting(key=_SETTING_KEY, value=encrypted))
    await db.commit()


async def load_coros_credentials(
    db: AsyncSession,
    secret: str,
) -> tuple[str, str] | None:
    """Return (email, password) or None if not configured."""
    result = await db.execute(
        select(AppSetting).where(AppSetting.key == _SETTING_KEY)
    )
    row = result.scalar_one_or_none()
    if not row:
        return None
    try:
        data = json.loads(_decrypt(row.value, secret))
        return data["email"], data["password"]
    except (ValueError, KeyError):
        return None


async def clear_coros_credentials(db: AsyncSession) -> None:
    """Remove stored COROS credentials."""
    existing = await db.get(AppSetting, _SETTING_KEY)
    if existing:
        await db.delete(existing)
        await db.commit()
