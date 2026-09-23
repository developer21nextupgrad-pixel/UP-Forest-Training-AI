from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_legal_user
from app.core.config import SettingsDep, get_settings
from app.db.session import get_db_session
from app.models import User, UserRole
from app.schemas.auth import (
    CurrentUserResponse,
    LoginRequest,
    RegisterRequest,
    TokenResponse,
)
from app.schemas.legal import LegalQueryRequest, LegalQueryResponse
from app.services.auth_service import AuthService
from app.services.legal.service import LegalService

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/legal",
    tags=["Legal Assistant"],
)

@router.post(
    "/auth/register",
    response_model=CurrentUserResponse,
    status_code=status.HTTP_201_CREATED,
)
async def legal_register(
    payload: RegisterRequest,
    request: Request,
    session: AsyncSession = Depends(get_db_session),
) -> CurrentUserResponse:
    service = AuthService(session)

    user = await service.register_for_role(
        full_name=payload.full_name,
        email=payload.email,
        password=payload.password,
        role=UserRole.LEGAL_USER,
        request_id=getattr(request.state, "request_id", None),
    )

    await session.commit()

    return CurrentUserResponse.model_validate(user)

@router.post(
    "/auth/login",
    response_model=TokenResponse,
)
async def legal_login(
    payload: LoginRequest,
    request: Request,
    session: AsyncSession = Depends(get_db_session),
) -> TokenResponse:
    service = AuthService(session)

    user = await service.authenticate_for_role(
        email=payload.email,
        password=payload.password,
        role=UserRole.LEGAL_USER,
        request_id=getattr(request.state, "request_id", None),
    )

    access, refresh = await service.issue_tokens(
        user,
        getattr(request.state, "request_id", None),
    )

    await session.commit()

    return TokenResponse(
        access_token=access,
        refresh_token=refresh,
        expires_in=get_settings().access_token_expire_minutes * 60,
        user=CurrentUserResponse.model_validate(user),
    )


@router.post(
    "/query",
    response_model=LegalQueryResponse,
)
async def legal_query(
    payload: LegalQueryRequest,
    settings: SettingsDep,
    user: User = Depends(require_legal_user),
    session: AsyncSession = Depends(get_db_session),
) -> LegalQueryResponse:
    try:
        return await LegalService(
            session,
            settings,
        ).query(payload)

    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    except Exception as exc:
        logger.exception(
            "Legal query failed for user=%s",
            user.id,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Unable to answer from the legal document index.",
        ) from exc