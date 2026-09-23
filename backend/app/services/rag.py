"""Backward-compatible facade for the legacy RAG endpoints.

Production Tutor/RAG behavior lives in the provider-independent retrieval and
TutorService modules. This module only preserves the historical /rag/index
contract used by existing OCR integrations.
"""
from __future__ import annotations
import uuid
from typing import Any
from app.core.config import Settings
from app.schemas.response import OcrSuccessResponse
from app.services.ingestion.embedding import MistralEmbeddingProvider
from app.services.ingestion.vector_store import get_vector_store
from app.services.ingestion.text_processing import chunk_text, clean_text

async def index_ocr_result(result: OcrSuccessResponse, settings: Settings) -> dict[str, Any]:
    if settings.vector_store == "pgvector":
        raise RuntimeError("Standalone RAG indexing is disabled in pgvector mode; use document ingestion.")
    document_id = str(uuid.uuid4())
    chunks: list[dict[str, Any]] = []
    for page in result.page_contents:
        for chunk_index, chunk in enumerate(
            chunk_text(clean_text(page.plain_text or page.markdown), settings.rag_chunk_size, settings.rag_chunk_overlap)
        ):
            chunks.append({
                "id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"{document_id}:{page.index}:{chunk_index}")),
                "document_id": document_id,
                "document_version_id": None,
                "filename": result.filename,
                "page": page.index + 1,
                "chunk_index": chunk_index,
                "chapter_title": None,
                "section_title": None,
                "language": "en",
                "content": chunk,
            })
    if not chunks:
        raise ValueError("No text was available to index")
    indexed = await get_vector_store(
        settings, MistralEmbeddingProvider(settings)
    ).index(chunks)
    return {
        "document_id": document_id,
        "filename": result.filename,
        "pages": result.pages,
        "chunks": indexed,
    }
