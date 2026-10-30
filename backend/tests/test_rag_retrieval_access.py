from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api import field as field_api
from app.models.enums import UserRole
from app.schemas.response import RagChatRequest
from app.services.rag_retrieval import HybridRetriever, _allowed_chunk_ids
from app.services.rag_schemas import RetrievalResult


@pytest.fixture
async def retrieval_session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.execute(
            text(
                "CREATE TABLE books (id CHAR(32) PRIMARY KEY, domain VARCHAR(20), "
                "subject_id CHAR(32))"
            )
        )
        await connection.execute(
            text(
                "CREATE TABLE documents (id CHAR(32) PRIMARY KEY, book_id CHAR(32), "
                "archived_at DATETIME, document_type VARCHAR(50), "
                "authority VARCHAR(255), "
                "effective_date DATE, rule TEXT, processing_status VARCHAR(30))"
            )
        )
        await connection.execute(
            text(
                "CREATE TABLE document_versions (id CHAR(32) PRIMARY KEY, "
                "document_id CHAR(32), is_current BOOLEAN, "
                "processing_status VARCHAR(30))"
            )
        )
        await connection.execute(
            text(
                "CREATE TABLE document_chunks (id CHAR(32) PRIMARY KEY, "
                "document_id CHAR(32), document_version_id CHAR(32), "
                "chapter_id CHAR(32), "
                "section_id CHAR(32), language VARCHAR(10))"
            )
        )

    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        subject_a, subject_b = uuid4(), uuid4()
        content = {
            "shared_training": (
                "TRAINING",
                subject_a,
                None,
                None,
                "READY",
                "READY",
                True,
            ),
            "other_subject_training": (
                "TRAINING",
                subject_b,
                None,
                None,
                "READY",
                "READY",
                True,
            ),
            "field_shared": ("FIELD", None, None, None, "READY", "READY", True),
            "field_typed": ("FIELD", None, "SOP", None, "READY", "READY", True),
            "training_manual": (
                "TRAINING",
                None,
                "MANUAL",
                None,
                "READY",
                "READY",
                True,
            ),
            "training_law": ("TRAINING", None, "ACT", None, "READY", "READY", True),
            "legal_domain": ("LEGAL", None, "ACT", None, "READY", "READY", True),
            "archived": ("TRAINING", None, None, "2026-01-01", "READY", "READY", True),
            "document_not_ready": (
                "TRAINING",
                None,
                None,
                None,
                "FAILED",
                "READY",
                True,
            ),
            "partial_current_version": (
                "TRAINING",
                None,
                None,
                None,
                "READY",
                "PARTIAL",
                True,
            ),
            "not_current": ("TRAINING", None, None, None, "READY", "READY", False),
        }
        ids = {}
        for key, (
            domain,
            subject_id,
            document_type,
            archived_at,
            document_status,
            version_status,
            current,
        ) in content.items():
            book_id, document_id, version_id, chunk_id = (uuid4() for _ in range(4))
            ids[key] = str(chunk_id)
            await session.execute(
                text(
                    "INSERT INTO books (id, domain, subject_id) "
                    "VALUES (:id, :domain, :subject_id)"
                ),
                {
                    "id": book_id.hex,
                    "domain": domain,
                    "subject_id": subject_id.hex if subject_id else None,
                },
            )
            await session.execute(
                text(
                    "INSERT INTO documents (id, book_id, archived_at, document_type, "
                    "processing_status) VALUES (:id, :book_id, :archived_at, "
                    ":document_type, "
                    ":processing_status)"
                ),
                {
                    "id": document_id.hex,
                    "book_id": book_id.hex,
                    "archived_at": archived_at,
                    "document_type": document_type,
                    "processing_status": document_status,
                },
            )
            await session.execute(
                text(
                    "INSERT INTO document_versions (id, document_id, is_current, "
                    "processing_status) VALUES (:id, :document_id, :is_current, "
                    ":processing_status)"
                ),
                {
                    "id": version_id.hex,
                    "document_id": document_id.hex,
                    "is_current": current,
                    "processing_status": version_status,
                },
            )
            await session.execute(
                text(
                    "INSERT INTO document_chunks (id, document_id, "
                    "document_version_id, language) "
                    "VALUES (:id, :document_id, :version_id, 'en')"
                ),
                {
                    "id": chunk_id.hex,
                    "document_id": document_id.hex,
                    "version_id": version_id.hex,
                },
            )
        await session.commit()
        yield session, ids, subject_a
    await engine.dispose()


@pytest.mark.asyncio
async def test_shared_field_scope_preserves_role_and_legal_boundaries(
    retrieval_session,
):
    session, ids, subject_a = retrieval_session
    admin = await _allowed_chunk_ids(session, {"requester_role": "ADMIN"})
    student = await _allowed_chunk_ids(
        session,
        {
            "requester_role": "STUDENT",
            "_authorized_subject_ids": [str(subject_a)],
            "training_only": True,
        },
    )
    field = await _allowed_chunk_ids(
        session,
        {
            "requester_role": "FIELD_OFFICER",
            "domains": ["FIELD", "TRAINING"],
            "field_officer_knowledge_only": True,
        },
    )

    assert admin == {
        ids["shared_training"],
        ids["other_subject_training"],
        ids["field_shared"],
        ids["field_typed"],
        ids["training_manual"],
        ids["training_law"],
        ids["legal_domain"],
        ids["partial_current_version"],
    }
    assert student == {ids["shared_training"]}
    assert field == {
        ids["shared_training"],
        ids["other_subject_training"],
        ids["field_shared"],
        ids["field_typed"],
        ids["training_manual"],
        ids["partial_current_version"],
    }
    assert ids["training_law"] not in field
    assert ids["legal_domain"] not in field


@pytest.mark.asyncio
async def test_dense_and_bm25_receive_the_same_field_authorized_chunks(
    retrieval_session,
):
    session, ids, _ = retrieval_session
    shared_chunk = ids["shared_training"]

    class DenseStore:
        allowed_ids = None

        async def search(self, query, top_k, *, allowed_ids=None):
            self.allowed_ids = allowed_ids
            if shared_chunk not in (allowed_ids or set()):
                return []
            return [
                {
                    "chunk_id": shared_chunk,
                    "document_id": str(uuid4()),
                    "filename": "shared-forest-guide.pdf",
                    "language": "en",
                    "text": "Forest patrol procedures and habitat protection.",
                    "score": 0.9,
                }
            ]

    class LexicalIndex:
        allowed_ids = None

        async def search(self, session, query, top_k, allowed_ids=None):
            self.allowed_ids = allowed_ids
            if shared_chunk not in (allowed_ids or set()):
                return []
            return [
                (
                    {
                        "chunk_id": shared_chunk,
                        "document_id": str(uuid4()),
                        "filename": "shared-forest-guide.pdf",
                        "language": "en",
                        "text": "Forest patrol procedures and habitat protection.",
                    },
                    2.0,
                )
            ]

    settings = SimpleNamespace(
        rag_dense_top_k=5,
        rag_similarity_threshold=0.0,
        rag_bm25_top_k=5,
        rag_dense_weight=0.5,
        rag_bm25_weight=0.3,
        rag_metadata_weight=0.2,
        rag_fused_top_k=5,
        rag_reranker_enabled=False,
    )
    retriever = HybridRetriever.__new__(HybridRetriever)
    retriever.session = session
    retriever.settings = settings
    retriever.vector_store = DenseStore()
    retriever.bm25 = LexicalIndex()
    retriever.reranker = None

    results = await retriever.search(
        "What are forest patrol procedures?",
        {
            "requester_role": "FIELD_OFFICER",
            "domains": ["FIELD", "TRAINING"],
            "training_only": True,
            "query_language": "en",
        },
    )

    assert retriever.vector_store.allowed_ids == retriever.bm25.allowed_ids
    assert shared_chunk in retriever.vector_store.allowed_ids
    assert ids["training_law"] not in retriever.vector_store.allowed_ids
    assert [item.chunk_id for item in results] == [shared_chunk]


@pytest.mark.asyncio
async def test_dense_retrieval_errors_are_not_reported_as_empty_results(
    retrieval_session,
):
    session, _, _ = retrieval_session

    class FailedDenseStore:
        async def search(self, query, top_k, *, allowed_ids=None):
            raise RuntimeError("vector backend unavailable")

    settings = SimpleNamespace(
        rag_dense_top_k=5,
        rag_similarity_threshold=0.0,
    )
    retriever = HybridRetriever.__new__(HybridRetriever)
    retriever.session = session
    retriever.settings = settings
    retriever.vector_store = FailedDenseStore()

    with pytest.raises(RuntimeError, match="vector backend unavailable"):
        await retriever.dense_search("forest patrol procedures", {})


@pytest.mark.asyncio
async def test_same_shared_question_is_retrievable_for_admin_student_and_field(
    retrieval_session,
):
    session, ids, subject_a = retrieval_session
    shared_chunk = ids["shared_training"]
    query = "What steps should an officer follow during a forest patrol?"

    class RetrievalAdapter:
        async def search(self, *args, allowed_ids=None, **kwargs):
            requested_query = next(
                (value for value in args if isinstance(value, str)),
                kwargs.get("query"),
            )
            if requested_query != query:
                return []
            if shared_chunk not in (allowed_ids or set()):
                return []
            if args[0] == query:
                return [
                    {
                        "chunk_id": shared_chunk,
                        "document_id": str(uuid4()),
                        "filename": "shared-forest-guide.pdf",
                        "language": "en",
                        "text": (
                            "Record patrol observations and protect forest habitats."
                        ),
                        "score": 0.9,
                    }
                ]
            return [
                (
                    {
                        "chunk_id": shared_chunk,
                        "document_id": str(uuid4()),
                        "filename": "shared-forest-guide.pdf",
                        "language": "en",
                        "text": (
                            "Record patrol observations and protect forest habitats."
                        ),
                    },
                    2.0,
                )
            ]

    settings = SimpleNamespace(
        rag_dense_top_k=5,
        rag_similarity_threshold=0.0,
        rag_bm25_top_k=5,
        rag_dense_weight=0.5,
        rag_bm25_weight=0.3,
        rag_metadata_weight=0.2,
        rag_fused_top_k=5,
        rag_reranker_enabled=False,
    )
    role_filters = [
        {"requester_role": "ADMIN"},
        {
            "requester_role": "STUDENT",
            "_authorized_subject_ids": [str(subject_a)],
            "training_only": True,
        },
        {
            "requester_role": "FIELD_OFFICER",
            "domains": ["FIELD", "TRAINING"],
            "field_officer_knowledge_only": True,
        },
    ]

    for filters in role_filters:
        retriever = HybridRetriever.__new__(HybridRetriever)
        retriever.session = session
        retriever.settings = settings
        retriever.vector_store = RetrievalAdapter()
        retriever.bm25 = RetrievalAdapter()
        retriever.reranker = None
        results = await retriever.search(query, filters)
        assert [item.chunk_id for item in results] == [shared_chunk]

        if filters["requester_role"] == "FIELD_OFFICER":
            assert (
                await retriever.search("unrelated query with no source", filters) == []
            )


@pytest.mark.asyncio
async def test_field_chat_generates_grounded_answer_with_citations(monkeypatch):
    captured = {}
    retrieved = RetrievalResult(
        chunk_id=str(uuid4()),
        document_id=str(uuid4()),
        filename="shared-forest-guide.pdf",
        page_number=4,
        text=(
            "Forest Manual 94 A: record patrol observations and protect forest "
            "habitats."
        ),
        document_type="MANUAL",
        relevance_score=0.9,
        fusion_score=0.9,
    )

    class FakeRAGService:
        def __init__(self, session, settings):
            pass

        async def retrieve(self, question, filters):
            captured["filters"] = filters
            captured["question"] = question
            return [retrieved]

    class FakeProvider:
        def __init__(self, settings):
            pass

        async def generate(self, *, system, user):
            captured["prompt"] = user
            return (
                '{"answer":"Record observations and protect habitats.",'
                '"language":"en","key_points":[],"citations":["source-1"],'
                '"grounded":true}'
            )

    monkeypatch.setattr(field_api, "RAGService", FakeRAGService)
    monkeypatch.setattr(field_api, "MistralLLMProvider", FakeProvider)
    settings = SimpleNamespace(
        rag_context_top_k=5,
        rag_max_context_chars=2000,
        rag_max_citations=5,
    )
    response = await field_api.field_chat(
        RagChatRequest(question="What is Forest Manual 94 A?"),
        settings=settings,
        session=object(),
        user=SimpleNamespace(role=UserRole.FIELD_OFFICER),
    )

    assert response.found is True
    assert response.answer == "Record observations and protect habitats."
    assert response.sources[0].filename == "shared-forest-guide.pdf"
    assert response.sources[0].page == 4
    assert captured["question"] == "What is Forest Manual 94 A?"
    assert "DOCUMENT CONTEXT" in captured["prompt"]
    assert captured["filters"]["domains"] == ["FIELD", "TRAINING"]
    assert captured["filters"]["field_officer_knowledge_only"] is True


@pytest.mark.asyncio
async def test_field_chat_rejects_irrelevant_answer_without_valid_citation(monkeypatch):
    retrieved = RetrievalResult(
        chunk_id=str(uuid4()),
        document_id=str(uuid4()),
        filename="forest-manual.pdf",
        page_number=4,
        text="Forest Manual 94 A describes patrol record keeping.",
        document_type="MANUAL",
        relevance_score=0.9,
        fusion_score=0.9,
    )

    class FakeRAGService:
        def __init__(self, session, settings):
            pass

        async def retrieve(self, question, filters):
            return [retrieved]

    class FakeProvider:
        def __init__(self, settings):
            pass

        async def generate(self, *, system, user):
            return (
                '{"answer":"The supplied document does not cover this topic.",'
                '"language":"en","key_points":[],"citations":[],"grounded":false}'
            )

    monkeypatch.setattr(field_api, "RAGService", FakeRAGService)
    monkeypatch.setattr(field_api, "MistralLLMProvider", FakeProvider)
    response = await field_api.field_chat(
        RagChatRequest(question="What is the capital of France?"),
        settings=SimpleNamespace(
            rag_context_top_k=5,
            rag_max_context_chars=2000,
            rag_max_citations=5,
        ),
        session=object(),
        user=SimpleNamespace(role=UserRole.FIELD_OFFICER),
    )

    assert response.found is False
    assert response.sources == []
    assert "couldn't find enough information" in response.answer


@pytest.mark.asyncio
async def test_field_chat_applies_shared_non_legal_filters(monkeypatch):
    captured = {}

    class FakeRAGService:
        def __init__(self, session, settings):
            pass

        async def retrieve(self, question, filters):
            captured.update(filters)
            return []

    monkeypatch.setattr(field_api, "RAGService", FakeRAGService)
    result = await field_api.field_chat(
        RagChatRequest(question="What are forest patrol procedures?"),
        settings=SimpleNamespace(),
        session=object(),
        user=SimpleNamespace(role=UserRole.FIELD_OFFICER),
    )

    assert result.found is False
    assert captured == {
        "requester_role": "FIELD_OFFICER",
        "domains": ["FIELD", "TRAINING"],
        "field_officer_knowledge_only": True,
        "query_language": "en",
    }
