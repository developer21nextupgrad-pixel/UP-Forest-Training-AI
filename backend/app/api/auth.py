from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user, require_admin, require_instructor, require_student
from app.core.config import get_settings
from app.db.session import get_db_session
from app.models import User
from app.schemas.auth import (
    CurrentUserResponse,
    ForgotPasswordRequest,
    LoginRequest,
    MessageResponse,
    RefreshTokenRequest,
    RegisterRequest,
    ResetPasswordRequest,
    TokenResponse,
)
from app.services.auth_service import AuthService
from app.services.email_service import EmailService

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, request: Request, session: AsyncSession = Depends(get_db_session)):
    service = AuthService(session)
    user = await service.authenticate(payload.email, payload.password, getattr(request.state, "request_id", None))
    access, refresh = await service.issue_tokens(user, getattr(request.state, "request_id", None))
    await session.commit()
    return TokenResponse(
        access_token=access,
        refresh_token=refresh,
        expires_in=get_settings().access_token_expire_minutes * 60,
        user=CurrentUserResponse.model_validate(user),
    )


@router.post("/register", response_model=CurrentUserResponse, status_code=status.HTTP_201_CREATED)
async def register(payload: RegisterRequest, request: Request, session: AsyncSession = Depends(get_db_session)):
    service = AuthService(session)
    user = await service.register(payload.full_name, payload.email, payload.password, request_id=getattr(request.state, "request_id", None))
    await session.commit()
    return CurrentUserResponse.model_validate(user)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(payload: RefreshTokenRequest, request: Request, session: AsyncSession = Depends(get_db_session)):
    service = AuthService(session)
    access, refresh_token, user = await service.refresh(payload.refresh_token, getattr(request.state, "request_id", None))
    await session.commit()
    return TokenResponse(
        access_token=access,
        refresh_token=refresh_token,
        expires_in=get_settings().access_token_expire_minutes * 60,
        user=CurrentUserResponse.model_validate(user),
    )


@router.get("/me", response_model=CurrentUserResponse)
async def me(user: User = Depends(get_current_user)):
    return CurrentUserResponse.model_validate(user)


@router.post("/logout", status_code=status.HTTP_200_OK)
async def logout(payload: RefreshTokenRequest, request: Request, session: AsyncSession = Depends(get_db_session)):
    result = await AuthService(session).logout(payload.refresh_token, getattr(request.state, "request_id", None))
    await session.commit()
    return result


@router.post("/forgot-password", response_model=MessageResponse)
async def forgot_password(payload: ForgotPasswordRequest, request: Request, session: AsyncSession = Depends(get_db_session)):
    settings = get_settings()
    email_service = EmailService(settings)
    if settings.environment == "production" and not email_service.configured:
        raise HTTPException(status_code=503, detail="Password reset email delivery is not configured")

    service = AuthService(session)
    raw_token = await service.request_password_reset(payload.email, getattr(request.state, "request_id", None))
    await session.commit()

    response = MessageResponse(
        message="If an account exists for that email, a password reset link has been sent."
    )
    if raw_token:
        reset_url = f"{settings.frontend_base_url.rstrip('/')}/reset-password?token={raw_token}"
        if settings.environment == "local" and not email_service.configured:
            response.debug_reset_url = reset_url
        else:
            try:
                await email_service.send_password_reset(payload.email, reset_url)
            except Exception:
                raise HTTPException(status_code=503, detail="Unable to send the password reset email")
    return response


@router.post("/reset-password", response_model=MessageResponse)
async def reset_password(payload: ResetPasswordRequest, request: Request, session: AsyncSession = Depends(get_db_session)):
    service = AuthService(session)
    await service.reset_password(payload.token, payload.new_password, getattr(request.state, "request_id", None))
    await session.commit()
    return MessageResponse(message="Your password has been reset successfully. Please sign in.")


@router.get("/student-test")
async def student_test(user: User = Depends(require_student)):
    return {"message": "student access granted", "role": user.role.value}


@router.get("/instructor-test")
async def instructor_test(user: User = Depends(require_instructor)):
    return {"message": "instructor access granted", "role": user.role.value}


@router.get("/admin-test")
async def admin_test(user: User = Depends(require_admin)):
    return {"message": "admin access granted", "role": user.role.value}
