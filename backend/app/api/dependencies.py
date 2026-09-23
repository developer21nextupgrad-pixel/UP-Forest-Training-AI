from __future__ import annotations
from uuid import UUID
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.security import decode_token
from app.db.session import get_db_session
from app.models import User

bearer = HTTPBearer(auto_error=False)

async def get_current_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer), session: AsyncSession = Depends(get_db_session)) -> User:
    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required", headers={"WWW-Authenticate":"Bearer"})
    try:
        payload = decode_token(credentials.credentials, "access")
        user_id = UUID(payload["sub"])
    except (ValueError, jwt.PyJWTError, RuntimeError):
        raise HTTPException(status_code=401, detail="Invalid or expired access token", headers={"WWW-Authenticate":"Bearer"})
    user = await session.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Authentication required", headers={"WWW-Authenticate":"Bearer"})
    return user

def require_roles(*roles: str):
    async def dependency(user: User = Depends(get_current_user)) -> User:
        if user.role.value not in roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user
    return dependency

require_student = require_roles("STUDENT")
require_instructor = require_roles("INSTRUCTOR")
require_admin = require_roles("ADMIN")
require_legal_user = require_roles("LEGAL_USER")
require_field_officer = require_roles("FIELD_OFFICER")
