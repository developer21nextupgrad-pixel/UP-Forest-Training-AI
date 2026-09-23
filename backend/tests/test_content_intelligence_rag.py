import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

from app.services.rag_schemas import RetrievalResult
from app.services.rag_service import ContentIntelligenceService


def _settings() -> SimpleNamespace:
    return SimpleNamespace(
        rag_bm25_k1=1.5,
        rag_bm25_b=0.75,
        rag_context_top_k=5,
        rag_max_context_chars=2000,
        rag_max_citations=5,
    )


def test_content_intelligence_generates_grounded_answer_and_sources():
    result = RetrievalResult(
        chunk_id="chunk-1",
        document_id="document-1",
        filename="hecu101.pdf",
        page_number=1,
        text="Probe and ponder questions introduce the chapter.",
        relevance_score=0.8,
    )
    provider = SimpleNamespace(
        generate=AsyncMock(
            return_value=(
                '{"answer":"The chapter opens with probe-and-ponder questions.",'
                '"language":"en","key_points":[],"citations":["source-1"],"grounded":true}'
            )
        )
    )
    service = ContentIntelligenceService(None, _settings(), provider)
    service.retriever = SimpleNamespace(search=AsyncMock(return_value=[result]))

    results, answer, grounded, sources = asyncio.run(
        service.answer("What questions are given on the first page?", {})
    )

    assert results == [result]
    assert answer.startswith("The chapter opens")
    assert grounded is True
    assert sources[0]["chunk_id"] == "chunk-1"
    assert "DOCUMENT CONTEXT" in provider.generate.await_args.kwargs["user"]


def test_content_intelligence_handles_zero_results_without_llm():
    provider = SimpleNamespace(generate=AsyncMock())
    service = ContentIntelligenceService(None, _settings(), provider)
    service.retriever = SimpleNamespace(search=AsyncMock(return_value=[]))

    _, answer, grounded, sources = asyncio.run(service.answer("unrelated", {}))

    assert grounded is False
    assert sources == []
    assert "couldn't find enough" in answer
    provider.generate.assert_not_awaited()


def test_content_intelligence_handles_retrieval_and_llm_failures():
    provider = SimpleNamespace(generate=AsyncMock(side_effect=RuntimeError("provider down")))
    service = ContentIntelligenceService(None, _settings(), provider)
    result = RetrievalResult(
        chunk_id="chunk-1",
        document_id="document-1",
        filename="book.pdf",
        text="Document evidence.",
        relevance_score=0.8,
    )
    service.retriever = SimpleNamespace(search=AsyncMock(return_value=[result]))

    _, answer, grounded, sources = asyncio.run(service.answer("question", {}))
    assert grounded is False
    assert sources == []
    assert "couldn't generate" in answer

    service.retriever = SimpleNamespace(search=AsyncMock(side_effect=RuntimeError("db down")))
    _, answer, grounded, sources = asyncio.run(service.answer("question", {}))
    assert grounded is False
    assert sources == []
    assert "couldn't retrieve" in answer
