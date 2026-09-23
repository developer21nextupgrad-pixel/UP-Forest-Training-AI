from __future__ import annotations

from datetime import datetime, timedelta, timezone
import secrets

import jwt
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import (
    create_token,
    decode_token,
    hash_password,
    hash_refresh_token,
    verify_password,
)
from app.models import AuditLog, PasswordResetToken, RefreshTokenSession, StudentProfile, User, UserRole
from app.repositories import PasswordResetTokenRepository, RefreshTokenRepository, UserRepository
from app.services.email_service import EmailService


class AuthService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.users = UserRepository(session)
        self.refresh_sessions = RefreshTokenRepository(session)
        self.reset_tokens = PasswordResetTokenRepository(session)
        self.settings = get_settings()

    async def authenticate(self, email: str, password: str, request_id: str | None = None) -> User:
        user = await self.users.get_by_email(email.lower())
        if not user or not user.password_hash or not verify_password(password, user.password_hash) or not user.is_active:
            await self._audit("LOGIN_FAILED", user.id if user else None, request_id)
            await self.session.commit()
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
        user.last_login_at = datetime.now(timezone.utc)
        await self._audit("LOGIN_SUCCESS", user.id, request_id)
        await self.session.flush()
        return user
    
    async def authenticate_for_role(
        self,
        email: str,
        password: str,
        role: UserRole,
        request_id: str | None = None,
    ) -> User:
        """Authenticate a user only for the requested portal role."""

        user = await self.users.get_by_email(email.lower().strip())

        if (
            not user
            or user.role != role
            or not user.password_hash
            or not verify_password(password, user.password_hash)
            or not user.is_active
        ):
            await self._audit(
                "LOGIN_FAILED",
                user.id if user else None,
                request_id,
            )
            await self.session.commit()
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid credentials",
            )

        user.last_login_at = datetime.now(timezone.utc)

        await self._audit(
            "LOGIN_SUCCESS",
            user.id,
            request_id,
        )

        await self.session.flush()

        return user
    
    async def register_for_role(
        self,
        full_name: str,
        email: str,
        password: str,
        role: UserRole,
        request_id: str | None = None,
    ) -> User:
        """Create a self-registered account for one specific public portal."""

        normalized_email = email.lower().strip()

        if await self.users.get_by_email(normalized_email):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An account with this email already exists",
            )

        local_part = normalized_email.split("@", 1)[0]
        username_base = "".join(
            ch for ch in local_part
            if ch.isalnum() or ch in "._-"
        )[:90] or role.value.lower()

        username = username_base
        suffix = 1

        while await self.users.get_by_username(username):
            suffix += 1
            username = f"{username_base[:88]}-{suffix}"

        user = User(
            email=normalized_email,
            username=username,
            password_hash=hash_password(password),
            full_name=full_name.strip(),
            role=role,
            is_active=True,
            preferred_language="en",
        )

        self.session.add(user)
        await self.session.flush()

        await self._audit(
            "REGISTER_SUCCESS",
            user.id,
            request_id,
        )

        return user

    # async def register(self, full_name: str, email: str, password: str, request_id: str | None = None) -> User:
    # async def register(
    #     self,
    #     full_name: str,
    #     email: str,
    #     password: str,
    #     role: str = "student",
    #     request_id: str | None = None,
    # ) -> User:
    #     normalized_email = email.lower().strip()
    #     if await self.users.get_by_email(normalized_email):
    #         raise HTTPException(status_code=409, detail="An account with this email already exists")

    #     local_part = normalized_email.split("@", 1)[0]
    #     username_base = "".join(ch for ch in local_part if ch.isalnum() or ch in "._-")[:90] or "student"
    #     username = username_base
    #     suffix = 1
    #     while await self.users.get_by_username(username):
    #         suffix += 1
    #         username = f"{username_base[:88]}-{suffix}"

    #     # user = User(
    #     #     email=normalized_email,
    #     #     username=username,
    #     #     password_hash=hash_password(password),
    #     #     full_name=full_name.strip(),
    #     #     role=UserRole.STUDENT,
    #     #     is_active=True,
    #     #     preferred_language="en",
    #     # )
    #     # self.session.add(user)
    #     # await self.session.flush()
    #     # self.session.add(StudentProfile(user_id=user.id))
    #     # await self._audit("REGISTER_SUCCESS", user.id, request_id)
    #     # return user
        
    #     role_value = role.strip().lower()

    #     # try:
    #     #     user_role = UserRole(role_value)
    #     # except ValueError:
    #     #     raise HTTPException(
    #     #         status_code=status.HTTP_400_BAD_REQUEST,
    #     #         detail="Invalid role. Allowed roles: student, instructor, admin",
    #     #     )
        
    #     role_value = role.strip().lower()

    #     try:
    #         user_role = UserRole(role_value.upper())
    #     except ValueError:
    #         raise HTTPException(
    #             status_code=status.HTTP_400_BAD_REQUEST,
    #             detail="Invalid role. Allowed roles: student, instructor, admin",
    #         )

    #     user = User(
    #         email=normalized_email,
    #         username=username,
    #         password_hash=hash_password(password),
    #         full_name=full_name.strip(),
    #         role=user_role,
    #         is_active=True,
    #         preferred_language="en",
    #     )

    #     self.session.add(user)
    #     await self.session.flush()

    #     # Student profile should only exist for student accounts.
    #     if user_role == UserRole.STUDENT:
    #         self.session.add(StudentProfile(user_id=user.id))

    #     await self._audit("REGISTER_SUCCESS", user.id, request_id)
    #     return user
    
    async def register(
        self,
        full_name: str,
        email: str,
        password: str,
        role: str = "student",
        request_id: str | None = None,
    ) -> User:
        """Create a public account as STUDENT, regardless of client input.

        ``role`` remains an optional argument for backward compatibility with
        older internal callers, but it is intentionally ignored. Privileged
        accounts must be created by authenticated administrative workflows.
        """
        normalized_email = email.lower().strip()
        if await self.users.get_by_email(normalized_email):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An account with this email already exists",
            )

        local_part = normalized_email.split("@", 1)[0]
        username_base = "".join(
            ch for ch in local_part if ch.isalnum() or ch in "._-"
        )[:90] or "student"
        username = username_base
        suffix = 1
        while await self.users.get_by_username(username):
            suffix += 1
            username = f"{username_base[:88]}-{suffix}"

        user = User(
            email=normalized_email,
            username=username,
            password_hash=hash_password(password),
            full_name=full_name.strip(),
            role=UserRole.STUDENT,
            is_active=True,
            preferred_language="en",
        )
        self.session.add(user)
        await self.session.flush()
        self.session.add(StudentProfile(user_id=user.id))
        await self._audit("REGISTER_SUCCESS", user.id, request_id)
        return user

    async def issue_tokens(self, user: User, request_id: str | None = None):
        settings = self.settings
        access = create_token(str(user.id), user.role.value, "access", timedelta(minutes=settings.access_token_expire_minutes))
        refresh = create_token(str(user.id), user.role.value, "refresh", timedelta(days=settings.refresh_token_expire_days))
        payload = decode_token(refresh, "refresh")
        expires = datetime.fromtimestamp(payload["exp"], timezone.utc)
        self.session.add(RefreshTokenSession(user_id=user.id, token_hash=hash_refresh_token(refresh), expires_at=expires))
        await self._audit("TOKEN_ISSUED", user.id, request_id)
        await self.session.flush()
        return access, refresh

    async def refresh(self, token: str, request_id: str | None = None):
        try:
            payload = decode_token(token, "refresh")
        except (jwt.PyJWTError, RuntimeError):
            raise HTTPException(status_code=401, detail="Invalid refresh token")
        session = await self.refresh_sessions.get_by_hash(hash_refresh_token(token))
        now = datetime.now(timezone.utc)
        if not session or session.revoked_at or session.expires_at <= now:
            raise HTTPException(status_code=401, detail="Invalid refresh token")
        user = await self.users.get(session.user_id)
        if not user or not user.is_active or str(user.id) != payload.get("sub"):
            raise HTTPException(status_code=401, detail="Invalid refresh token")
        session.revoked_at = now
        access = create_token(str(user.id), user.role.value, "access", timedelta(minutes=self.settings.access_token_expire_minutes))
        new_refresh = create_token(str(user.id), user.role.value, "refresh", timedelta(days=self.settings.refresh_token_expire_days))
        new_payload = decode_token(new_refresh, "refresh")
        self.session.add(RefreshTokenSession(user_id=user.id, token_hash=hash_refresh_token(new_refresh), expires_at=datetime.fromtimestamp(new_payload["exp"], timezone.utc)))
        await self._audit("TOKEN_REFRESH", user.id, request_id)
        await self.session.flush()
        return access, new_refresh, user

    async def logout(self, token: str, request_id: str | None = None):
        try:
            decode_token(token, "refresh")
        except (jwt.PyJWTError, RuntimeError):
            return {"message": "Logged out"}
        session = await self.refresh_sessions.get_by_hash(hash_refresh_token(token))
        if session and not session.revoked_at:
            session.revoked_at = datetime.now(timezone.utc)
            await self._audit("LOGOUT", session.user_id, request_id)
            await self.session.flush()
        return {"message": "Logged out"}

    async def request_password_reset(self, email: str, request_id: str | None = None) -> str | None:
        user = await self.users.get_by_email(email.lower().strip())
        if not user or not user.is_active:
            # Keep account existence private.
            return None

        now = datetime.now(timezone.utc)
        existing = await self.session.execute(
            select(PasswordResetToken).where(
                PasswordResetToken.user_id == user.id,
                PasswordResetToken.used_at.is_(None),
            )
        )
        for token in existing.scalars().all():
            token.used_at = now

        raw_token = secrets.token_urlsafe(48)
        reset_record = PasswordResetToken(
            user_id=user.id,
            token_hash=hash_refresh_token(raw_token),
            expires_at=now + timedelta(minutes=self.settings.password_reset_expire_minutes),
        )
        self.session.add(reset_record)
        await self._audit("PASSWORD_RESET_REQUESTED", user.id, request_id)
        await self.session.flush()
        return raw_token

    async def reset_password(self, raw_token: str, new_password: str, request_id: str | None = None) -> User:
        record = await self.reset_tokens.get_by_hash(hash_refresh_token(raw_token))
        now = datetime.now(timezone.utc)
        if not record or record.used_at or record.expires_at <= now:
            raise HTTPException(status_code=400, detail="This password reset link is invalid or expired")

        user = await self.users.get(record.user_id)
        if not user or not user.is_active:
            raise HTTPException(status_code=400, detail="This password reset link is invalid or expired")

        user.password_hash = hash_password(new_password)
        record.used_at = now
        await self.refresh_sessions.revoke_all_for_user(user.id)
        await self._audit("PASSWORD_RESET_SUCCESS", user.id, request_id)
        await self.session.flush()
        return user

    async def _audit(self, action: str, user_id, request_id):
        self.session.add(AuditLog(user_id=user_id, action=action, resource_type="auth", request_id=request_id, metadata_json={}))
