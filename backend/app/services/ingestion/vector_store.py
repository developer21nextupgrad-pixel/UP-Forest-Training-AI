from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Any
from uuid import UUID

try:
    import faiss
    import numpy as np
except ImportError:  # FAISS is an optional development adapter; pgvector is production.
    faiss = None
    np = None
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from .embedding import EmbeddingProvider

logger = logging.getLogger(__name__)


def _vector_literal(vector: list[float]) -> str:
    return "[" + ",".join(format(float(x), ".10g") for x in vector) + "]"


class VectorStore:
    async def index(self, chunks: list[dict[str, Any]]) -> int:
        raise NotImplementedError
    async def search(self, query: str, top_k: int, *, allowed_ids: set[str] | None = None) -> list[dict[str, Any]]:
        raise NotImplementedError


class PgVectorStore(VectorStore):
    """DB-native pgvector adapter. Vector dimension is discovered from the provider."""
    def __init__(self, session: AsyncSession, settings: Settings, embedding_provider: EmbeddingProvider) -> None:
        self.session = session
        self.settings = settings
        self.embedding_provider = embedding_provider

    async def _existing_dimension(self) -> int | None:
        row = (await self.session.execute(text("SELECT MAX(embedding_dimension) FROM document_chunks WHERE embedding IS NOT NULL"))).scalar_one_or_none()
        return int(row) if row is not None else None

    async def _ensure_index(self, dimension: int) -> None:
        if dimension > 2000:
            logger.warning("Embedding dimension %s exceeds pgvector HNSW vector limit; using exact vector search.", dimension)
            return
        index_name=f"ix_document_chunks_embedding_hnsw_{dimension}"
        exists=(await self.session.execute(text("SELECT 1 FROM pg_indexes WHERE schemaname=current_schema() AND indexname=:name"), {"name":index_name})).scalar_one_or_none()
        if exists:
            return
        # Dimension is discovered from the configured provider response, never guessed.
        await self.session.execute(text(f"CREATE INDEX IF NOT EXISTS {index_name} ON document_chunks USING hnsw ((embedding::vector({int(dimension)})) vector_cosine_ops) WHERE embedding_dimension = {int(dimension)}"))

    async def index(self, chunks: list[dict[str, Any]]) -> int:
        if not chunks:
            return 0
        texts = [item["content"] for item in chunks]
        vectors = await self.embedding_provider.embed(texts)
        if len(vectors) != len(chunks) or not vectors:
            raise RuntimeError("Embedding service returned invalid vector data")
        dimension = len(vectors[0])
        if dimension <= 0 or any(len(v) != dimension for v in vectors):
            raise RuntimeError("Embedding service returned inconsistent dimensions")
        existing = await self._existing_dimension()
        if existing is not None and existing != dimension:
            raise RuntimeError(f"Embedding dimension changed from {existing} to {dimension}; use a new vector store/index before switching models.")
        for item, vector in zip(chunks, vectors):
            await self.session.execute(
                text("UPDATE document_chunks SET embedding = CAST(:embedding AS vector), embedding_dimension = :dimension WHERE id = CAST(:id AS uuid)"),
                {"embedding": _vector_literal(vector), "dimension": dimension, "id": str(item["id"])},
            )
        await self._ensure_index(dimension)
        await self.session.flush()
        return len(chunks)

    async def search(self, query: str, top_k: int, *, allowed_ids: set[str] | None = None) -> list[dict[str, Any]]:
        if not query.strip() or top_k <= 0:
            return []
        vectors = await self.embedding_provider.embed([query])
        if not vectors or not vectors[0]:
            return []
        dimension=len(vectors[0])
        existing=await self._existing_dimension()
        if existing is not None and existing != dimension:
            raise RuntimeError(f"Embedding dimension changed from {existing} to {dimension}; current vector model must remain stable.")
        await self._ensure_index(dimension)
        params: dict[str, Any] = {"query_vector": _vector_literal(vectors[0]), "limit": top_k, "dimension": dimension}
        conditions = [
            "dc.embedding IS NOT NULL",
            "dc.embedding_dimension = :dimension",
            "dv.is_current IS TRUE",
            "d.archived_at IS NULL",
            "d.processing_status = 'READY'",
        ]
        if allowed_ids is not None:
            if not allowed_ids:
                return []
            conditions.append("dc.id = ANY(CAST(:allowed_ids AS uuid[]))")
            params["allowed_ids"] = [UUID(chunk_id) for chunk_id in allowed_ids]
        query_sql = text(f"""
            SELECT dc.id AS chunk_id, dc.document_id, dc.document_version_id, b.id AS book_id,
                   b.title AS book_title, d.file_name AS filename, dc.page_number, dc.page_end,
                   dc.printed_page_start, dc.printed_page_end, dc.source_reference, dc.chapter_id,
                   dc.section_id, dc.chapter_title, dc.section_title, dc.language, dc.content AS text,
                   1 - (dc.embedding::vector({dimension}) <=> CAST(:query_vector AS vector)) AS score
            FROM document_chunks dc
            JOIN document_versions dv ON dv.id = dc.document_version_id
            JOIN documents d ON d.id = dc.document_id
            JOIN books b ON b.id = d.book_id
            WHERE {' AND '.join(conditions)}
            ORDER BY dc.embedding::vector({dimension}) <=> CAST(:query_vector AS vector)
            LIMIT :limit
        """)
        rows = (await self.session.execute(query_sql, params)).mappings().all()
        return [dict(row) for row in rows]


class FAISSVectorStore(VectorStore):
    """Explicit development-only legacy adapter."""
    _lock = asyncio.Lock()
    def __init__(self, settings: Settings, embedding_provider: EmbeddingProvider) -> None:
        self.settings = settings; self.embedding_provider = embedding_provider
    def _paths(self) -> tuple[Path, Path]:
        root = Path(self.settings.rag_index_dir); return root / "index.faiss", root / "metadata.json"
    async def index(self, chunks: list[dict[str, Any]]) -> int:
        if faiss is None or np is None:
            raise RuntimeError("FAISS development adapter is not installed")
        if not chunks: return 0
        index_file, metadata_file = self._paths()
        async with self._lock:
            index = faiss.read_index(str(index_file)) if index_file.exists() else None
            metadata = json.loads(metadata_file.read_text(encoding="utf-8")) if metadata_file.exists() else []
            existing = {m.get("chunk_id") or m.get("id") for m in metadata}
            keep = [item for item in chunks if item["id"] not in existing]
            if not keep: return 0
            vectors = np.asarray(await self.embedding_provider.embed([x["content"] for x in keep]), dtype="float32")
            if vectors.ndim != 2 or len(vectors) != len(keep): raise RuntimeError("Embedding service returned invalid vector data")
            faiss.normalize_L2(vectors)
            if index is None: index = faiss.IndexFlatIP(vectors.shape[1])
            elif index.d != vectors.shape[1]: raise RuntimeError("Existing RAG index uses a different embedding dimension")
            index.add(vectors)
            for item in keep:
                metadata.append({"id":item["id"],"chunk_id":item["id"],"document_id":item["document_id"],"document_version_id":item.get("document_version_id"),"book_id":item.get("book_id"),"book_title":item.get("book_title"),"filename":item.get("filename"),"page":item.get("page"),"page_end":item.get("page_end"),"source_reference":item.get("source_reference"),"chunk":item.get("chunk_index",0)+1,"chapter_title":item.get("chapter_title"),"section_title":item.get("section_title"),"language":item.get("language","en"),"text":item["content"]})
            index_file.parent.mkdir(parents=True, exist_ok=True)
            tmp_index=index_file.with_suffix(".tmp"); tmp_meta=metadata_file.with_suffix(".tmp")
            faiss.write_index(index,str(tmp_index)); tmp_meta.write_text(json.dumps(metadata,ensure_ascii=False),encoding="utf-8")
            os.replace(tmp_index,index_file); os.replace(tmp_meta,metadata_file)
            return len(keep)
    async def search(self, query: str, top_k: int, *, allowed_ids: set[str] | None = None) -> list[dict[str, Any]]:
        if faiss is None or np is None:
            raise RuntimeError("FAISS development adapter is not installed")
        if not query.strip() or top_k <= 0: return []
        vectors=np.asarray(await self.embedding_provider.embed([query]),dtype="float32"); faiss.normalize_L2(vectors)
        index_file,metadata_file=self._paths()
        async with self._lock:
            if not index_file.exists() or not metadata_file.exists(): return []
            index=faiss.read_index(str(index_file)); metadata=json.loads(metadata_file.read_text(encoding="utf-8"))
            if index.ntotal==0:return []
            scores,indices=index.search(vectors,min(index.ntotal,max(top_k*5,50)))
        results=[]
        for score,idx in zip(scores[0],indices[0]):
            if idx<0 or idx>=len(metadata):continue
            item=dict(metadata[idx]); cid=str(item.get("chunk_id") or item.get("id"))
            if allowed_ids is not None and cid not in allowed_ids:continue
            item["score"]=round(float(score),6); results.append(item)
            if len(results)>=top_k:break
        return results


def get_vector_store(settings: Settings, embedding_provider: EmbeddingProvider, session: AsyncSession | None = None) -> VectorStore:
    store_name = getattr(settings, "vector_store", "faiss")
    if store_name == "pgvector":
        if session is None: raise ValueError("pgvector vector store requires a database session")
        return PgVectorStore(session, settings, embedding_provider)
    if store_name == "faiss":
        if getattr(settings, "environment", "local") == "production": raise ValueError("FAISS is not allowed in production")
        return FAISSVectorStore(settings, embedding_provider)
    raise ValueError(f"Unsupported vector store: {settings.vector_store}")
