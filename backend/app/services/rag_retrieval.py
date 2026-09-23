from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.models import Book, Document, DocumentChunk, DocumentVersion
from app.services.ingestion.embedding import MistralEmbeddingProvider
from app.services.ingestion.vector_store import get_vector_store
from app.services.rag_bm25 import BM25Index
from app.services.rag_schemas import RetrievalResult

logger = logging.getLogger(__name__)


async def _current_chunk_records(session: AsyncSession) -> list[dict]:
    result = await session.execute(
        select(DocumentChunk, Document, Book)
        .join(DocumentVersion, DocumentChunk.document_version_id == DocumentVersion.id)
        .join(Document, DocumentChunk.document_id == Document.id)
        .join(Book, Document.book_id == Book.id)
        .where(DocumentVersion.is_current.is_(True), Document.archived_at.is_(None))
    )
    records = []
    for chunk, doc, book in result.all():
        records.append({
            "chunk_id": str(chunk.id),
            "id": str(chunk.id),
            "document_id": str(chunk.document_id),
            "document_version_id": str(chunk.document_version_id) if chunk.document_version_id else None,
            "book_id": str(book.id),
            "book_title": book.title,
            "filename": doc.file_name,
            "page": chunk.page_number,
            "page_number": chunk.page_number,
            "page_end": chunk.page_end,
            "source_reference": chunk.source_reference,
            "chunk_index": chunk.chunk_index,
            "chapter_title": chunk.chapter_title,
            "section_title": chunk.section_title,
            "language": chunk.language,
            "text": chunk.content,
            "content": chunk.content,
            "subject_id": str(book.subject_id) if book.subject_id else None,
            "document_type": doc.document_type,
            "authority": doc.authority,
            "effective_date": (
                doc.effective_date.isoformat()
                if doc.effective_date
                else None
            ),
            "rule": doc.rule,
            "chapter_id": str(chunk.chapter_id) if chunk.chapter_id else (str(doc.chapter_id) if doc.chapter_id else None),
            "section_id": str(chunk.section_id) if chunk.section_id else None,
            "printed_page_start": chunk.printed_page_start,
            "printed_page_end": chunk.printed_page_end,
        })
    return records

class NoOpReranker:
    async def rerank(self, query: str, results: list[RetrievalResult], top_k: int) -> list[RetrievalResult]:
        return results[:top_k]

class BM25Manager:
    _instance: BM25Manager | None = None
    def __init__(self, settings: Settings):
        self.settings = settings
        self.index = BM25Index(settings.rag_bm25_k1, settings.rag_bm25_b)
        self._lock = asyncio.Lock()
        self._signature: tuple[int, int] | None = None

    @classmethod
    def instance(cls, settings: Settings) -> BM25Manager:
        if cls._instance is None:
            cls._instance = cls(settings)
        return cls._instance

    async def ensure_built(self, session: AsyncSession) -> None:
        count_result = await session.execute(select(DocumentChunk.id).join(DocumentVersion).where(DocumentVersion.is_current.is_(True)))
        ids = list(count_result.scalars().all())
        signature = (len(ids), hash(tuple(str(x) for x in ids)))
        if self._signature == signature and self.index.documents:
            return
        async with self._lock:
            if self._signature == signature and self.index.documents:
                return
            records = await _current_chunk_records(session)
            self.index.build(records)
            self._signature = signature

    async def search(self, session: AsyncSession, query: str, top_k: int, allowed_ids: set[str] | None = None) -> list[tuple[dict, float]]:
        await self.ensure_built(session)
        return self.index.search(query, top_k, allowed_ids)

    def invalidate(self) -> None:
        self._signature = None

async def _allowed_chunk_ids(session: AsyncSession, filters: dict) -> set[str] | None:
    filters = {k: v for k, v in filters.items() if v}
    stmt = (
        select(DocumentChunk.id)
        .join(DocumentVersion, DocumentChunk.document_version_id == DocumentVersion.id)
        .join(Document, DocumentChunk.document_id == Document.id)
        .join(Book, Document.book_id == Book.id)
        .where(DocumentVersion.is_current.is_(True), Document.archived_at.is_(None))
    )
    if filters.get("subject_id"):
        stmt = stmt.where(Book.subject_id == UUID(filters["subject_id"]))
    if filters.get("chapter_id"):
        stmt = stmt.where(DocumentChunk.chapter_id == UUID(filters["chapter_id"]))
    if filters.get("section_id"):
        stmt = stmt.where(DocumentChunk.section_id == UUID(filters["section_id"]))
    if filters.get("book_id"):
        stmt = stmt.where(Book.id == UUID(filters["book_id"]))
        
    if filters.get("domain"):
        stmt = stmt.where(Book.domain == filters["domain"])
    
    if filters.get("document_id"):
        stmt = stmt.where(Document.id == UUID(filters["document_id"]))
    if filters.get("document_version_id"):
        stmt = stmt.where(DocumentVersion.id == UUID(filters["document_version_id"]))
    if filters.get("language"):
        stmt = stmt.where(DocumentChunk.language == filters["language"])
        
    if filters.get("legal_only"):
        stmt = stmt.where(Document.document_type.is_not(None))
    
    if filters.get("training_only"):
        stmt = stmt.where(Document.document_type.is_(None))
    
    if filters.get("document_type"):
        document_type = filters["document_type"]

        if hasattr(document_type, "value"):
            document_type = document_type.value

        stmt = stmt.where(Document.document_type == document_type)
    
    if filters.get("authority"):
        stmt = stmt.where(
            Document.authority == filters["authority"]
        )
    authorized_subject_ids = filters.get("_authorized_subject_ids")
    if authorized_subject_ids is not None:
        stmt = stmt.where(Book.subject_id.in_([UUID(x) for x in authorized_subject_ids]))
    result = await session.execute(stmt)
    return {str(x) for x in result.scalars().all()}

class HybridRetriever:
    def __init__(self, session: AsyncSession, settings: Settings):
        self.session, self.settings = session, settings
        self.vector_store = get_vector_store(settings, MistralEmbeddingProvider(settings), session)
        self.bm25 = BM25Manager.instance(settings)
        self.reranker = NoOpReranker()

    async def dense_search(self, query: str, filters: dict) -> list[RetrievalResult]:
        allowed = await _allowed_chunk_ids(self.session, filters)
        try:
            raw = await self.vector_store.search(
                query, self.settings.rag_dense_top_k * 5, allowed_ids=allowed
            )
        except Exception:
            logger.exception("Dense retrieval failed for query=%r", query)
            return []
        raw = [item for item in raw if float(item.get("score", 0.0)) >= self.settings.rag_similarity_threshold]
        return [RetrievalResult(
            chunk_id=str(x.get("chunk_id") or x.get("id")),
            document_id=str(x["document_id"]),
            document_version_id=str(x.get("document_version_id")) if x.get("document_version_id") else None,
            book_id=str(x.get("book_id")) if x.get("book_id") else None,
            book_title=x.get("book_title"),
            filename=x.get("filename", "Unknown"),
            page_number=x.get("page") or x.get("page_number"),
            page_end=x.get("page_end"),
            printed_page_start=x.get("printed_page_start"),
            printed_page_end=x.get("printed_page_end"),
            source_reference=x.get("source_reference"),
            chapter_title=x.get("chapter_title"),
            section_title=x.get("section_title"),
            language=x.get("language", "en"),
            document_type=x.get("document_type"),
            authority=x.get("authority"),
            effective_date=x.get("effective_date"),
            rule=x.get("rule"),
            text=x.get("text", ""),
            dense_score=float(x.get("score", 0)),
        ) for x in raw[:self.settings.rag_dense_top_k]]

    async def bm25_search(self, query: str, filters: dict) -> list[RetrievalResult]:
        allowed = await _allowed_chunk_ids(self.session, filters)
        raw = await self.bm25.search(self.session, query, self.settings.rag_bm25_top_k, allowed)
        return [RetrievalResult(
            chunk_id=str(x["chunk_id"]), document_id=str(x["document_id"]),
            document_version_id=x.get("document_version_id"), book_id=x.get("book_id"),
            book_title=x.get("book_title"), filename=x.get("filename", "Unknown"),
            page_number=x.get("page_number"), page_end=x.get("page_end"), printed_page_start=x.get("printed_page_start"), printed_page_end=x.get("printed_page_end"), source_reference=x.get("source_reference"), chapter_title=x.get("chapter_title"),
            section_title=x.get("section_title"),
            language=x.get("language", "en"),
            document_type=x.get("document_type"),
            authority=x.get("authority"),
            effective_date=x.get("effective_date"),
            rule=x.get("rule"),
            text=x.get("text", ""),
            bm25_score=float(score)
        ) for x, score in raw]

    async def search(self, query: str, filters: dict) -> list[RetrievalResult]:
        logger.info("Content retrieval query=%r filters=%s", query, filters)
        # AsyncSession does not permit concurrent statements on one session.
        dense = await self.dense_search(query, filters)
        lexical = await self.bm25_search(query, filters)
        merged: dict[str, RetrievalResult] = {}
        ranks: dict[str, list[int]] = defaultdict(list)
        for rank, item in enumerate(dense, 1):
            merged[item.chunk_id] = item
            ranks[item.chunk_id].append(rank)
        for rank, item in enumerate(lexical, 1):
            if item.chunk_id in merged:
                old = merged[item.chunk_id]
                old.bm25_score = item.bm25_score

                # Dense retrieval may not carry document-level metadata.
                # Backfill missing metadata from the lexical result.
                if old.document_type is None:
                    old.document_type = item.document_type

                if old.authority is None:
                    old.authority = item.authority

                if old.effective_date is None:
                    old.effective_date = item.effective_date

                if old.rule is None:
                    old.rule = item.rule

                if old.book_title is None:
                    old.book_title = item.book_title

                if old.source_reference is None:
                    old.source_reference = item.source_reference

                if old.chapter_title is None:
                    old.chapter_title = item.chapter_title

                if old.section_title is None:
                    old.section_title = item.section_title

            else:
                merged[item.chunk_id] = item

            ranks[item.chunk_id].append(rank)
        def normalize(values: list[float]) -> dict[float, float]:
            if not values:
                return {}
            lo, hi = min(values), max(values)
            if hi - lo < 1e-9:
                return {v: 1.0 for v in values}
            return {v: (v - lo) / (hi - lo) for v in values}

        dense_norm = normalize([x.dense_score for x in dense if x.dense_score is not None])
        bm25_norm = normalize([x.bm25_score for x in lexical if x.bm25_score is not None])
        query_language = filters.get("query_language")
        for chunk_id, item in merged.items():
            dense_score = dense_norm.get(item.dense_score, 0.0) if item.dense_score is not None else 0.0
            lexical_score = bm25_norm.get(item.bm25_score, 0.0) if item.bm25_score is not None else 0.0
            metadata_score = 1.0 if query_language and item.language == query_language else (0.5 if query_language == "mixed" and item.language in {"hi", "en"} else 0.0)
            # A deterministic weighted hybrid score. Each component is normalized to 0..1.
            item.relevance_score = max(0.0, min(1.0,
                self.settings.rag_dense_weight * dense_score
                + self.settings.rag_bm25_weight * lexical_score
                + self.settings.rag_metadata_weight * metadata_score
            ))
            item.fusion_score = item.relevance_score
        ranked = sorted(merged.values(), key=lambda x: x.relevance_score, reverse=True)
        if self.settings.rag_reranker_enabled:
            ranked = await self.reranker.rerank(query, ranked, self.settings.rag_fused_top_k)
        selected = ranked[:self.settings.rag_fused_top_k]
        logger.info(
            "Content retrieval candidates: dense=%d lexical=%d selected=%d chunks=%s scores=%s",
            len(dense),
            len(lexical),
            len(selected),
            [item.chunk_id for item in selected],
            [round(item.relevance_score, 4) for item in selected],
        )
        return selected
