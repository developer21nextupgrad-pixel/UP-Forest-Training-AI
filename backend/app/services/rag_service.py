from __future__ import annotations

import json
import logging
import re
import time
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.models import (
    AuditLog,
    ChatMessage,
    ChatRole,
    ChatSession,
    DocumentChunk,
    DocumentPage,
    Enrollment,
    StudentProfile,
)
from app.services.content_intelligence import detect_language as detect_content_language
from app.services.content_intelligence import normalize_query
from app.services.rag_context import build_context
from app.services.rag_llm import LLMProvider, MistralLLMProvider
from app.services.rag_prompts import TUTOR_SYSTEM_PROMPT
from app.services.rag_retrieval import HybridRetriever
from app.services.rag_schemas import Citation, RetrievalResult, TutorGeneration


class RAGService:
    def __init__(self, session: AsyncSession, settings: Settings):
        self.retriever = HybridRetriever(session, settings)

    async def retrieve(self, query: str, filters: dict) -> list[RetrievalResult]:
        return await self.retriever.search(normalize_query(query), filters)


class ContentIntelligenceService:
    def __init__(self, session: AsyncSession, settings: Settings, provider: LLMProvider | None = None):
        self.session = session
        self.settings = settings
        self.retriever = HybridRetriever(session, settings)
        self.provider = provider or MistralLLMProvider(settings)

    async def answer(self, query: str, filters: dict) -> tuple[list[RetrievalResult], str, bool, list[dict]]:
        normalized = normalize_query(query)
        try:
            results = await self.retriever.search(normalized, filters)
        except Exception:
            logger.exception("Content intelligence retrieval failed for query=%r", normalized)
            return (
                [],
                "I couldn't retrieve relevant information from the uploaded documents.",
                False,
                [],
            )
        logger.info(
            "Content intelligence query normalized=%r retrieved=%d",
            normalized,
            len(results),
        )
        if not results:
            return (
                [],
                "I couldn't find enough relevant information in the uploaded documents to answer this question.",
                False,
                [],
            )

        context, source_map = build_context(
            results[: self.settings.rag_context_top_k],
            self.settings.rag_max_context_chars,
        )
        if not context:
            return (
                results,
                "I couldn't find enough relevant information in the uploaded documents to answer this question.",
                False,
                [],
            )

        source_lines = "\n".join(
            f"[{source_id}] document={item.filename} pdf_page={item.page_number or 'unknown'} "
            f"printed_page={item.printed_page_start or 'unknown'} chunk_id={item.chunk_id}"
            for source_id, item in source_map.items()
        )
        prompt = (
            "Answer the administrator's question using ONLY the supplied document context. "
            "If the context does not answer it, say so clearly and do not use general knowledge. "
            "Return ONLY the JSON shape required by the system prompt and cite only supplied source IDs.\n\n"
            f"DOCUMENT CONTEXT:\n{context}\n\n"
            f"SOURCE INDEX:\n{source_lines}\n\n"
            f"QUESTION:\n{normalized}"
        )
        try:
            raw = await self.provider.generate(
                system=TUTOR_SYSTEM_PROMPT,
                user=prompt,
            )

            try:
                generation = TutorGeneration.model_validate(
                    _extract_json(raw)
                )

            except Exception as validation_error:
                logger.warning(
                    "Initial LLM JSON validation failed. Attempting repair. error=%s",
                    validation_error,
                )

                repair_prompt = (
                    "Your previous response was not valid for the required JSON schema.\n"
                    "Return ONLY a valid JSON object.\n\n"
                    "Required schema:\n"
                    '{"answer":"string",'
                    '"language":"hi|en",'
                    '"key_points":["string"],'
                    '"citations":["source-1"],'
                    '"grounded":true}\n\n'
                    "Rules:\n"
                    "1. Use ONLY the supplied document context.\n"
                    "2. Do not use outside/general knowledge.\n"
                    "3. citations must contain ONLY source IDs supplied in the context.\n"
                    "4. grounded must be true only if the answer is supported by the context.\n"
                    "5. Do not add markdown fences.\n"
                    "6. Do not add any explanation outside the JSON object.\n\n"
                    "Previous response:\n"
                    f"{raw}"
                )

                repaired_raw = await self.provider.generate(
                    system=TUTOR_SYSTEM_PROMPT,
                    user=repair_prompt,
                )

                generation = TutorGeneration.model_validate(
                    _extract_json(repaired_raw)
                )

        except Exception:
            logger.exception(
                "Content intelligence LLM generation failed"
            )

            return (
                results,
                "I couldn't generate a grounded answer from the available documents.",
                False,
                [],
            )
        valid_ids = set(source_map)
        source_ids = [
            source_id for source_id in generation.citations if source_id in valid_ids
        ]
        if not generation.grounded or not source_ids or not generation.answer.strip():
            logger.warning(
                "Content intelligence LLM returned an ungrounded answer: citations=%s",
                source_ids,
            )
            return (
                results,
                "I couldn't find enough relevant information in the uploaded documents to answer this question.",
                False,
                [],
            )
        sources = [
            {
                "document": item.filename,
                "page": item.page_number,
                "page_end": item.page_end,
                "printed_page": item.printed_page_start,
                "printed_page_end": item.printed_page_end,
                "chunk_id": item.chunk_id,
                "document_id": item.document_id,
                "source_reference": item.source_reference,
            }
            for source_id in source_ids[: self.settings.rag_max_citations]
            for item in [source_map[source_id]]
        ]
        return results, generation.answer.strip(), True, sources

def detect_language(text: str, requested: str | None = None) -> str:
    detected = detect_content_language(text)
    if requested in {"hi", "en"}:
        return requested
    if detected == "mixed":
        # For generation, choose the dominant script while preserving mixed retrieval.
        dev = len(re.findall(r"[\u0900-\u097F]", text))
        lat = len(re.findall(r"[A-Za-z]", text))
        return "hi" if dev >= lat else "en"
    return detected if detected in {"hi", "en"} else "en"

def classify_intent(text: str) -> str:
    t = text.lower()
    if any(x in t for x in ("compare", "difference between", "अंतर", "तुलना")):
        return "COMPARISON"
    if any(x in t for x in ("example", "उदाहरण")):
        return "EXAMPLE"
    if any(x in t for x in ("summarize", "summary", "सारांश", "संक्षेप")):
        return "SUMMARY"
    if any(x in t for x in ("define", "definition", "what is", "क्या है")):
        return "DEFINITION"
    if any(x in t for x in ("explain", "समझाइए", "बताइए")):
        return "EXPLANATION"
    return "FACTUAL"

def contextualize_query(message: str, history: list[ChatMessage]) -> str:
    if not history:
        return message
    lowered = message.lower().strip()
    vague = {"it", "this", "that", "they", "them", "iska", "isko", "ye", "yah", "उसका", "इसे", "इसका"}
    if len(lowered.split()) <= 8 and any(token in lowered.split() for token in vague):
        previous = [m.content for m in history if m.role == ChatRole.USER][-3:]
        if previous:
            return f"{previous[-1]}\nFollow-up: {message}"
    return message

def _extract_json(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("LLM did not return a JSON object")
    return json.loads(text[start:end + 1])

class TutorService:
    def __init__(self, session: AsyncSession, settings: Settings, provider: LLMProvider | None = None):
        self.session, self.settings = session, settings
        self.provider = provider or MistralLLMProvider(settings)

    async def _student_profile(self, user_id: UUID) -> StudentProfile:
        result = await self.session.execute(select(StudentProfile).where(StudentProfile.user_id == user_id))
        profile = result.scalar_one_or_none()
        if not profile:
            raise ValueError("Student profile is not configured.")
        return profile

    async def _get_owned_session(self, session_id: UUID, student_id: UUID) -> ChatSession | None:
        result = await self.session.execute(
            select(ChatSession).where(ChatSession.id == session_id, ChatSession.student_id == student_id)
        )
        return result.scalar_one_or_none()

    async def _authorized_subject_ids(self, student_id: UUID) -> list[str]:
        result = await self.session.execute(
            select(Enrollment.subject_id).where(Enrollment.student_id == student_id, Enrollment.status == "ACTIVE")
        )
        return [str(x) for x in result.scalars().all()]

    async def _validate_scope(self, student_id: UUID, subject_id: UUID | None, chapter_id: UUID | None) -> list[str]:
        authorized = await self._authorized_subject_ids(student_id)
        if subject_id and str(subject_id) not in authorized:
            raise PermissionError("You are not authorized to access this learning content.")
        if chapter_id:
            from app.models import Chapter
            chapter = await self.session.get(Chapter, chapter_id)
            if not chapter or str(chapter.subject_id) not in authorized:
                raise PermissionError("You are not authorized to access this learning content.")
        return authorized

    async def chat(
        self, *, user_id: UUID, session_id: UUID | None, message: str,
        language: str | None, subject_id: UUID | None, chapter_id: UUID | None,
    ) -> tuple[ChatSession, ChatMessage, TutorGeneration, list[Citation]]:
        student = await self._student_profile(user_id)
        authorized_subject_ids = await self._validate_scope(student.id, subject_id, chapter_id)
        chat_session = await self._get_owned_session(session_id, student.id) if session_id else None
        if session_id and not chat_session:
            raise LookupError("Chat session not found.")
        if not chat_session:
            chat_session = ChatSession(
                student_id=student.id, subject_id=subject_id, chapter_id=chapter_id,
                language=detect_language(message, language),
                title=message[:80],
            )
            self.session.add(chat_session)
            await self.session.flush()

        history_result = await self.session.execute(
            select(ChatMessage).where(ChatMessage.session_id == chat_session.id)
            .order_by(ChatMessage.created_at.desc()).limit(self.settings.tutor_max_history_messages)
        )
        history = list(reversed(history_result.scalars().all()))
        user_message = ChatMessage(session_id=chat_session.id, role=ChatRole.USER, content=message)
        self.session.add(user_message)
        await self.session.flush()

        effective_subject_id = subject_id or chat_session.subject_id
        effective_chapter_id = chapter_id or chat_session.chapter_id
        authorized_subject_ids = await self._validate_scope(student.id, effective_subject_id, effective_chapter_id)
        query = contextualize_query(message, history)
        filters = {
            "_authorized_subject_ids": authorized_subject_ids,
            "query_language": detect_content_language(query),
            "subject_id": str(effective_subject_id) if effective_subject_id else None,
            "chapter_id": str(effective_chapter_id) if effective_chapter_id else None,
        }
        retrieval_started = time.perf_counter()
        results = await RAGService(self.session, self.settings).retrieve(query, filters)
        retrieval_latency_ms = round((time.perf_counter() - retrieval_started) * 1000, 2)
        language_code = detect_language(message, language)
        best_score = max((r.relevance_score for r in results), default=0.0)

        if not results or best_score < self.settings.rag_min_confidence:
            generation = TutorGeneration(
                answer="I couldn't find sufficient information about this in the available Forest Department learning material."
                if language_code == "en" else
                "उपलब्ध वन विभाग की अध्ययन सामग्री में इस प्रश्न के लिए पर्याप्त जानकारी नहीं मिली।",
                language=language_code, key_points=[], citations=[], grounded=False,
            )
            citations: list[Citation] = []
        else:
            context, source_map = build_context(results[:self.settings.rag_context_top_k], self.settings.rag_max_context_chars)
            history_text = "\n".join(f"{m.role.value}: {m.content}" for m in history[-self.settings.tutor_max_history_messages:])
            user_prompt = (
                f"Requested language: {language_code}\n"
                f"Question intent: {classify_intent(message)}\n"
                f"Conversation history:\n{history_text or '(none)'}\n\n"
                f"DOCUMENT CONTEXT:\n{context}\n\nQUESTION:\n{message}"
            )
            try:
                raw = await self.provider.generate(system=TUTOR_SYSTEM_PROMPT, user=user_prompt)
                try:
                    generation = TutorGeneration.model_validate(_extract_json(raw))
                except Exception:
                    repair = (
                        "Return ONLY valid JSON matching this schema: "
                        '{"answer":"string","language":"hi|en","key_points":["string"],'
                        '"citations":["source-1"],"grounded":true}. '
                        "Use only the supplied source IDs and context.\n\n" + raw
                    )
                    repaired = await self.provider.generate(system=TUTOR_SYSTEM_PROMPT, user=repair)
                    generation = TutorGeneration.model_validate(_extract_json(repaired))
            except Exception:
                generation = TutorGeneration(
                    answer="I couldn't generate a grounded answer from the available documents.",
                    language=language_code, key_points=[], citations=[], grounded=False,
                )
            valid_ids = set(source_map)
            source_ids = [x for x in generation.citations if x in valid_ids]
            generation.citations = source_ids
            generation.grounded = bool(generation.grounded and source_ids)
            citations = []
            for source_id in source_ids[:self.settings.rag_max_citations]:
                item = source_map[source_id]
                chunk = await self.session.get(DocumentChunk, UUID(item.chunk_id))
                if not chunk:
                    continue
                if item.page_number is not None and item.document_version_id:
                    page_result = await self.session.execute(
                        select(DocumentPage.id).where(
                            DocumentPage.document_version_id == UUID(item.document_version_id),
                            DocumentPage.page_number == item.page_number,
                        )
                    )
                    if not page_result.scalar_one_or_none():
                        continue
                # Citation metadata is mapped from retrieval, never trusted from the LLM.
                citations.append(Citation(
                    source_id=source_id,
                    document_id=UUID(item.document_id),
                    book_title=item.book_title or item.filename,
                    page=item.page_number,
                    page_end=item.page_end,
                    printed_page=item.printed_page_start,
                    printed_page_end=item.printed_page_end,
                    section=item.section_title or item.chapter_title,
                ))
            if not citations:
                generation.grounded = False
                generation.citations = []
            if not generation.grounded:
                generation.citations = []
                citations = []
                generation.answer = (
                    "I couldn't find sufficient information about this in the available Forest Department learning material."
                    if language_code == "en" else
                    "उपलब्ध वन विभाग की अध्ययन सामग्री में इस प्रश्न के लिए पर्याप्त जानकारी नहीं मिली।"
                )

        assistant_message = ChatMessage(session_id=chat_session.id, role=ChatRole.ASSISTANT, content=generation.answer)
        self.session.add(assistant_message)
        self.session.add(AuditLog(
            user_id=user_id, action="TUTOR_QUERY", resource_type="chat_session",
            resource_id=str(chat_session.id), metadata_json={
                "retrieved_chunk_ids": [r.chunk_id for r in results],
                "language": language_code, "intent": classify_intent(message),
                "grounded": generation.grounded,
                "retrieval_latency_ms": retrieval_latency_ms,
                "retrieval_mode": "hybrid",
                "top_k": self.settings.rag_fused_top_k,
                "retrieved_chunks": [{"chunk_id": r.chunk_id, "score": r.relevance_score, "language": r.language} for r in results],
            },
        ))
        await self.session.flush()
        self.session.add(AuditLog(
            user_id=user_id, action="TUTOR_RESPONSE", resource_type="chat_message",
            resource_id=str(assistant_message.id), metadata_json={
                "citation_source_ids": generation.citations, "grounded": generation.grounded,
            },
        ))
        await self.session.commit()
        await self.session.refresh(chat_session)
        await self.session.refresh(assistant_message)
        return chat_session, assistant_message, generation, citations
logger = logging.getLogger(__name__)
