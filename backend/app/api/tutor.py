from __future__ import annotations
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.dependencies import require_student
from app.core.config import SettingsDep
from app.db.session import get_db_session
from app.models import ChatMessage, ChatSession, User, StudentProfile
from app.schemas.tutor import (
    TutorChatRequest, TutorChatResponse, TutorMessageResponse,
    TutorSessionCreateRequest, TutorSessionResponse,
)
from app.services.rag_service import TutorService

router = APIRouter(prefix="/tutor", tags=["AI Tutor"])

async def _student_id(session: AsyncSession, user: User) -> UUID:
    result = await session.execute(select(StudentProfile.id).where(StudentProfile.user_id == user.id))
    student_id = result.scalar_one_or_none()
    if not student_id:
        raise HTTPException(status.HTTP_409_CONFLICT, "Student profile is not configured.")
    return student_id

@router.post("/sessions", response_model=TutorSessionResponse)
async def create_session(
    payload: TutorSessionCreateRequest,
    user: User = Depends(require_student),
    session: AsyncSession = Depends(get_db_session),
):
    student_id = await _student_id(session, user)
    item = ChatSession(
        student_id=student_id, subject_id=payload.subject_id,
        chapter_id=payload.chapter_id, language=payload.language or user.preferred_language,
        title=payload.title or "New Tutor Chat",
    )
    session.add(item)
    await session.commit()
    await session.refresh(item)
    return TutorSessionResponse.model_validate(item)

@router.get("/sessions", response_model=list[TutorSessionResponse])
async def list_sessions(
    user: User = Depends(require_student),
    session: AsyncSession = Depends(get_db_session),
):
    student_id = await _student_id(session, user)
    result = await session.execute(
        select(ChatSession).where(ChatSession.student_id == student_id).order_by(ChatSession.updated_at.desc())
    )
    return [TutorSessionResponse.model_validate(x) for x in result.scalars().all()]

@router.get("/sessions/{session_id}", response_model=list[TutorMessageResponse])
async def get_session(
    session_id: UUID,
    user: User = Depends(require_student),
    session: AsyncSession = Depends(get_db_session),
):
    student_id = await _student_id(session, user)
    exists = await session.execute(select(ChatSession.id).where(ChatSession.id == session_id, ChatSession.student_id == student_id))
    if not exists.scalar_one_or_none():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Chat session not found")
    result = await session.execute(
        select(ChatMessage).where(ChatMessage.session_id == session_id).order_by(ChatMessage.created_at)
    )
    return [TutorMessageResponse.model_validate(x) for x in result.scalars().all()]

@router.delete("/sessions/{session_id}", status_code=204)
async def delete_session(
    session_id: UUID,
    user: User = Depends(require_student),
    session: AsyncSession = Depends(get_db_session),
):
    student_id = await _student_id(session, user)
    item = (await session.execute(select(ChatSession).where(ChatSession.id == session_id, ChatSession.student_id == student_id))).scalar_one_or_none()
    if not item:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Chat session not found")
    await session.delete(item)
    await session.commit()

@router.post("/chat", response_model=TutorChatResponse)
async def tutor_chat(
    payload: TutorChatRequest,
    settings: SettingsDep,
    user: User = Depends(require_student),
    session: AsyncSession = Depends(get_db_session),
):
    try:
        chat_session, message, generation, citations = await TutorService(session, settings).chat(
            user_id=user.id, session_id=payload.session_id, message=payload.message,
            language=payload.language, subject_id=payload.subject_id, chapter_id=payload.chapter_id,
        )
    except LookupError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    return TutorChatResponse(
        session_id=chat_session.id, message_id=message.id, answer=generation.answer,
        language=generation.language, key_points=generation.key_points,
        citations=citations, grounded=generation.grounded,
    )
