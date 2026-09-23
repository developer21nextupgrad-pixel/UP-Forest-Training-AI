"""Password hashing and JWT primitives."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
from uuid import uuid4

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from app.core.config import get_settings

_password_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _password_hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def _secret() -> str:
    secret = get_settings().jwt_secret_key
    if not secret:
        raise RuntimeError("JWT_SECRET_KEY must be configured before authentication is used")
    return secret


def create_token(user_id: str, role: str, token_type: str, expires_delta: timedelta) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": user_id, "role": role, "type": token_type, "iat": now, "exp": now + expires_delta, "jti": str(uuid4())}
    return jwt.encode(payload, _secret(), algorithm=get_settings().jwt_algorithm)


def decode_token(token: str, expected_type: str) -> dict:
    payload = jwt.decode(token, _secret(), algorithms=[get_settings().jwt_algorithm])
    if payload.get("type") != expected_type or not payload.get("sub"):
        raise jwt.InvalidTokenError("Invalid token type")
    return payload


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
