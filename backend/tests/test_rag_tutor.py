from __future__ import annotations

from app.services.rag_bm25 import BM25Index, tokenize
from app.services.rag_context import build_context
from app.services.rag_retrieval import NoOpReranker
from app.services.rag_schemas import RetrievalResult
import asyncio

def test_tokenize_hindi_and_english():
    tokens = tokenize("Forest Conservation Act वन संरक्षण अधिनियम")
    assert "forest" in tokens
    assert "संरक्षण" in tokens

def test_bm25_exact_terminology_ranks_match_first():
    index = BM25Index()
    index.build([
        {"chunk_id": "a", "text": "selection felling is a silvicultural method"},
        {"chunk_id": "b", "text": "forest fire prevention and control"},
    ])
    results = index.search("selection felling", 2)
    assert results[0][0]["chunk_id"] == "a"
    assert results[0][1] > 0

def test_bm25_allowed_ids_filter():
    index = BM25Index()
    index.build([
        {"chunk_id": "a", "text": "CAMPA compensatory afforestation"},
        {"chunk_id": "b", "text": "CAMPA implementation guidelines"},
    ])
    results = index.search("CAMPA", 10, allowed_ids={"b"})
    assert [x[0]["chunk_id"] for x in results] == ["b"]

def test_context_builder_preserves_provenance_and_limit():
    result = RetrievalResult(
        chunk_id="c1", document_id="d1", document_version_id="v1",
        book_id="b1", book_title="Silviculture Handbook", filename="book.pdf",
        page_number=45, chapter_title="Silviculture",
        section_title="Selection Felling", text="A" * 100,
    )
    context, mapping = build_context([result], 500)
    assert "[source-1]" in context
    assert "Page: 45" in context
    assert mapping["source-1"].chunk_id == "c1"

def test_context_builder_respects_limit():
    result = RetrievalResult(
        chunk_id="c1", document_id="d1", filename="book.pdf",
        page_number=1, text="A" * 500,
    )
    context, mapping = build_context([result], 50)
    assert context == ""
    assert mapping == {"source-1": result}

def test_noop_reranker_preserves_order():
    results = [
        RetrievalResult(chunk_id="a", document_id="d", filename="a", text="a"),
        RetrievalResult(chunk_id="b", document_id="d", filename="b", text="b"),
    ]
    out = asyncio.run(NoOpReranker().rerank("q", results, 1))
    assert [x.chunk_id for x in out] == ["a"]
