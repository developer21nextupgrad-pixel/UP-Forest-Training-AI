"""Field Officer AI assistant endpoints."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_field_officer
from app.core.config import SettingsDep
from app.db.session import get_db_session
from app.models import User
from app.schemas.response import RagChatRequest, RagChatResponse
from app.services.content_intelligence import detect_language
from app.services.rag_context import build_context
from app.services.rag_llm import MistralLLMProvider
from app.services.rag_prompts import FIELD_OFFICER_SYSTEM_PROMPT
from app.services.rag_service import RAGService, _extract_json
from app.services.rag_schemas import TutorGeneration


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/field", tags=["field"])


@router.post("/chat", response_model=RagChatResponse)
async def field_chat(
    payload: RagChatRequest,
    settings: SettingsDep,
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(require_field_officer),
) -> RagChatResponse:
    """Answer a Field Officer question using FIELD-domain documents only."""

    language_code = detect_language(payload.question)

    try:
        results = await RAGService(session, settings).retrieve(
            payload.question,
            {
                "domain": "FIELD",
                "query_language": language_code,
            },
        )
    except Exception:
        logger.exception("Field Officer retrieval failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to retrieve field information.",
        )

    if not results:
        return RagChatResponse(
            answer=(
                "I couldn't find this information in the available "
                "Field Officer knowledge base."
            ),
            found=False,
            sources=[],
        )

    context, source_map = build_context(
        results[: settings.rag_context_top_k],
        settings.rag_max_context_chars,
    )

    if not context:
        return RagChatResponse(
            answer=(
                "I couldn't find enough information in the available "
                "Field Officer knowledge base."
            ),
            found=False,
            sources=[],
        )

    source_lines = "\n".join(
        f"[{source_id}] document={item.filename} "
        f"pdf_page={item.page_number or 'unknown'} "
        f"chunk_id={item.chunk_id}"
        for source_id, item in source_map.items()
    )

    prompt = (
        "Answer the Field Officer's question using ONLY the supplied "
        "Field Officer document context.\n"
        "If the context does not answer the question, say so clearly.\n"
        "Return ONLY the JSON shape required by the system prompt.\n\n"
        f"Requested language: {language_code}\n\n"
        f"DOCUMENT CONTEXT:\n{context}\n\n"
        f"SOURCE INDEX:\n{source_lines}\n\n"
        f"QUESTION:\n{payload.question}"
    )

    try:
        raw = await MistralLLMProvider(settings).generate(
            system=FIELD_OFFICER_SYSTEM_PROMPT,
            user=prompt,
        )
    except Exception:
        logger.exception("Field Officer LLM generation failed")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Unable to generate a grounded field response.",
        )

    try:
        generation = TutorGeneration.model_validate(
            _extract_json(raw)
        )
    except Exception:
        logger.warning(
            "Field Officer LLM returned invalid JSON. Attempting repair."
        )

        repair_prompt = (
            "Return ONLY valid JSON matching this exact schema:\n"
            '{"answer":"string",'
            '"language":"hi|en",'
            '"key_points":["string"],'
            '"citations":["source-1"],'
            '"grounded":true}\n\n'
            "Rules:\n"
            "1. Use ONLY the supplied Field Officer document context.\n"
            "2. Do not use outside knowledge.\n"
            "3. citations must contain ONLY supplied source IDs.\n"
            "4. grounded must be true only when the answer is supported.\n"
            "5. Do not add markdown fences or explanations.\n\n"
            f"Previous response:\n{raw}"
        )

        try:
            repaired_raw = await MistralLLMProvider(settings).generate(
                system=FIELD_OFFICER_SYSTEM_PROMPT,
                user=repair_prompt,
            )

            generation = TutorGeneration.model_validate(
                _extract_json(repaired_raw)
            )
        except Exception:
            logger.exception(
                "Field Officer LLM JSON validation/repair failed"
            )
            return RagChatResponse(
                answer=(
                    "I couldn't generate a grounded answer from the "
                    "available Field Officer documents."
                ),
                found=False,
                sources=[],
            )

    valid_ids = set(source_map)

    source_ids = [
        source_id
        for source_id in generation.citations
        if source_id in valid_ids
    ]

    if (
        not generation.grounded
        or not source_ids
        or not generation.answer.strip()
    ):
        return RagChatResponse(
            answer=(
                "I couldn't find enough information in the available "
                "Field Officer knowledge base."
            ),
            found=False,
            sources=[],
        )

    return RagChatResponse(
        answer=generation.answer.strip(),
        found=True,
        sources=[
            {
                "filename": source_map[source_id].filename,
                "page": source_map[source_id].page_number or 0,
                "score": source_map[source_id].fusion_score,
                "snippet": source_map[source_id].text[:300],
            }
            for source_id in source_ids[: settings.rag_max_citations]
        ],
    )