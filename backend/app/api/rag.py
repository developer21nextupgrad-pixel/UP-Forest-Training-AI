"""RAG indexing and document-grounded chat endpoints."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import SettingsDep
from app.core.rate_limiter import get_rate_limiter
from app.schemas.response import (
    OcrSuccessResponse,
    RagChatRequest,
    RagChatResponse,
    RagIndexResponse,
)
from app.services import rag
from app.db.session import get_db_session
from app.services.rag_service import RAGService
from app.models import Enrollment, EnrollmentStatus, StudentProfile
from app.api.dependencies import require_student, require_admin

logger = logging.getLogger(__name__)
router = APIRouter(tags=["rag"])


@router.post("/rag/index", response_model=RagIndexResponse)
async def index_document(
    request: Request, result: OcrSuccessResponse, settings: SettingsDep, _: object = Depends(require_admin)
) -> RagIndexResponse:
    client_ip = request.client.host if request.client else "unknown"
    if not get_rate_limiter().allow(f"rag-index:{client_ip}"):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Rate limit exceeded")
    if settings.vector_store == "pgvector":
        raise HTTPException(status_code=410, detail="Standalone RAG indexing is disabled. Upload documents through the admin book ingestion workflow.")
    try:
        indexed = await rag.index_ocr_result(result, settings)
    except Exception as exc:
        logger.exception("RAG indexing failed")
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "Document text was extracted, but indexing failed. Please try again.",
        ) from exc
    return RagIndexResponse(**indexed)


@router.post("/rag/chat", response_model=RagChatResponse)
async def rag_chat(
    request: Request, payload: RagChatRequest, settings: SettingsDep,
    session: AsyncSession = Depends(get_db_session),
    user: object = Depends(require_student),
) -> RagChatResponse:
    client_ip = request.client.host if request.client else "unknown"
    if not get_rate_limiter().allow(f"rag-chat:{client_ip}"):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Rate limit exceeded")
    if not settings.is_mistral_configured:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "AI service temporarily unavailable")
    profile = await session.scalar(select(StudentProfile).where(StudentProfile.user_id == user.id))
    if not profile:
        raise HTTPException(status.HTTP_409_CONFLICT, "Student profile is not configured")
    subject_ids = [str(x) for x in (await session.execute(
        select(Enrollment.subject_id).where(Enrollment.student_id == profile.id, Enrollment.status == EnrollmentStatus.ACTIVE)
    )).scalars().all()]
    try:
        results = await RAGService(session, settings).retrieve(payload.question, {"_authorized_subject_ids": subject_ids,"training_only": True,
})
    except Exception as exc:
        logger.exception("Legacy RAG retrieval failed")
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Unable to retrieve from the document index.") from exc
    if not results:
        return RagChatResponse(answer="I couldn't find the answer in the uploaded documents.", found=False, sources=[])
    # Legacy endpoint keeps its historical response contract. New Tutor API
    # provides structured grounded answers and citations.
    from app.services.rag_llm import MistralLLMProvider
    from app.services.rag_context import build_context
    from app.services.rag_prompts import TUTOR_SYSTEM_PROMPT
    context, _ = build_context(results[:settings.rag_context_top_k], settings.rag_max_context_chars)
    try:
        raw = await MistralLLMProvider(settings).generate(
            system=TUTOR_SYSTEM_PROMPT,
            user=f"Requested language: en\nDOCUMENT CONTEXT:\n{context}\n\nQUESTION:\n{payload.question}",
        )
        answer = raw or "I couldn't generate an answer from the uploaded documents."
    except Exception as exc:
        logger.exception("Legacy RAG generation failed")
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Unable to answer from the document index.") from exc
    return RagChatResponse(
        answer=answer, found=True,
        sources=[{
            "filename": r.filename,
            "page": r.page_number or 0,
            "score": r.fusion_score,
            "snippet": r.text[:300],
        } for r in results],
    )
