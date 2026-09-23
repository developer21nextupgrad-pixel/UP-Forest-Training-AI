from __future__ import annotations

import logging
from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.schemas.legal import (
    LegalCitation,
    LegalQueryRequest,
    LegalQueryResponse,
)
from app.services.rag_context import build_context
from app.services.rag_retrieval import HybridRetriever
from app.services.rag_schemas import TutorGeneration
from app.services.rag_llm import MistralLLMProvider
from app.services.rag_service import _extract_json

logger = logging.getLogger(__name__)


LEGAL_SYSTEM_PROMPT = """You are the Legal Information Assistant for the Uttar Pradesh Forest Department.

Your task is to answer questions ONLY from the provided legal document context.

STRICT RULES:
1. Use only the supplied DOCUMENT CONTEXT.
2. Do not invent laws, sections, rules, dates, authorities, procedures, or citations.
3. If the supplied context does not contain enough information, clearly say that the available documents do not provide enough information.
4. Do not use outside knowledge.
5. Preserve the meaning of the source documents.
6. When answering, distinguish between an Act, Rule, Order, Circular, SOP, and Judgment when the context provides that information.
7. Never fabricate a section number or legal provision.
8. Keep the answer factual and document-grounded.
9. Return citations only for sources actually present in the supplied context.
10. If the question asks for legal advice beyond the supplied documents, state that the response is limited to the provided departmental/legal documents.

Return valid JSON with this exact structure:
{
  "answer": "string",
  "language": "hi or en",
  "key_points": ["string"],
  "citations": ["source_id"],
  "grounded": true
}

Set grounded=false if the provided context is insufficient to answer the question.
"""


class LegalService:
    def __init__(
        self,
        session: AsyncSession,
        settings: Settings,
    ) -> None:
        self.session = session
        self.settings = settings
        self.retriever = HybridRetriever(session, settings)
        self.llm = MistralLLMProvider(settings)

    @staticmethod
    def _resolve_language(
        requested_language: str,
        question: str,
    ) -> str:
        if requested_language in {"hi", "en"}:
            return requested_language

        # Conservative fallback.
        # Hindi Unicode characters strongly indicate Hindi input.
        if any("\u0900" <= char <= "\u097F" for char in question):
            return "hi"

        return "en"

    @staticmethod
    def _clean_optional(value: str | None) -> str | None:
        if value is None:
            return None

        value = value.strip()
        return value or None

    async def query(
        self,
        payload: LegalQueryRequest,
    ) -> LegalQueryResponse:
        question = payload.question.strip()

        if not question:
            raise ValueError("Question cannot be empty.")

        language = self._resolve_language(
            payload.language,
            question,
        )

        filters: dict = {
            "legal_only": True,
            "document_type": payload.document_type,
        }

        authority = self._clean_optional(payload.authority)

        if authority:
            filters["authority"] = authority

        logger.info(
            "Legal retrieval query=%r document_type=%s authority=%r language=%s",
            question,
            payload.document_type,
            authority,
            language,
        )

        results = await self.retriever.search(
            question,
            filters,
        )

        if not results:
            return LegalQueryResponse(
                answer=(
                    "The available legal documents do not contain "
                    "enough information to answer this question."
                ),
                language=language,
                grounded=False,
                key_points=[],
                citations=[],
            )

        context, source_map = build_context(
            results[: self.settings.rag_context_top_k],
            self.settings.rag_max_context_chars,
        )

        if not context.strip():
            return LegalQueryResponse(
                answer=(
                    "The available legal documents do not contain "
                    "enough information to answer this question."
                ),
                language=language,
                grounded=False,
                key_points=[],
                citations=[],
            )

        user_prompt = (
            f"Requested language: {language}\n\n"
            f"DOCUMENT CONTEXT:\n{context}\n\n"
            f"QUESTION:\n{question}"
        )

        try:
            raw = await self.llm.generate(
                system=LEGAL_SYSTEM_PROMPT,
                user=user_prompt,
            )
        except Exception:
            logger.exception(
                "Legal LLM generation failed"
            )
            raise

        if not raw:
            return LegalQueryResponse(
                answer=(
                    "The legal answer could not be generated "
                    "from the available documents."
                ),
                language=language,
                grounded=False,
                key_points=[],
                citations=[],
            )

        try:
            generation = TutorGeneration.model_validate(
                _extract_json(raw)
            )
        except Exception:
            logger.exception(
                "Legal LLM returned invalid structured output. raw=%r",
                raw[:2000],
            )

            return LegalQueryResponse(
                answer=(
                    "The legal answer could not be safely validated "
                    "against the document sources."
                ),
                language=language,
                grounded=False,
                key_points=[],
                citations=[],
            )

        citations: list[LegalCitation] = []

        for source_id in generation.citations:
            source = source_map.get(source_id)

            if not source:
                logger.warning(
                    "Ignoring invalid legal citation source_id=%s",
                    source_id,
                )
                continue

            citations.append(
                LegalCitation(
                    source_id=source_id,
                    document_id=source.document_id,
                    book_title=source.book_title or "Unknown",
                    page=source.page_number,
                    page_end=source.page_end,
                    printed_page=source.printed_page_start,
                    printed_page_end=source.printed_page_end,
                    section=source.section_title,
                    document_type=source.document_type,
                    authority=source.authority,
                    effective_date=(
                        date.fromisoformat(source.effective_date)
                        if source.effective_date
                        else None
                    ),
                )
            )

        return LegalQueryResponse(
            answer=generation.answer,
            language=(
                generation.language
                if generation.language in {"hi", "en"}
                else language
            ),
            key_points=generation.key_points,
            citations=citations,
            grounded=bool(generation.grounded and citations),
        )