from __future__ import annotations
from typing import Any
from uuid import UUID
from pydantic import BaseModel, Field

class RetrievalResult(BaseModel):
    chunk_id: str
    document_id: str
    document_version_id: str | None = None
    book_id: str | None = None
    book_title: str | None = None
    filename: str
    page_number: int | None = None
    page_end: int | None = None
    printed_page_start: int | None = None
    printed_page_end: int | None = None
    source_reference: str | None = None
    chapter_title: str | None = None
    section_title: str | None = None
    language: str = "en"
    document_type: str | None = None
    authority: str | None = None
    effective_date: str | None = None
    rule: str | None = None
    text: str
    dense_score: float | None = None
    bm25_score: float | None = None
    fusion_score: float = 0.0
    relevance_score: float = 0.0
    rerank_score: float | None = None

class Citation(BaseModel):
    source_id: str
    document_id: UUID
    book_title: str
    page: int | None = None
    page_end: int | None = None
    printed_page: int | None = None
    printed_page_end: int | None = None
    section: str | None = None

class TutorGeneration(BaseModel):
    answer: str = Field(min_length=1)
    language: str
    key_points: list[str] = []
    citations: list[str] = []
    grounded: bool

class TutorResponse(BaseModel):
    success: bool = True
    session_id: UUID
    message_id: UUID
    answer: str
    language: str
    key_points: list[str] = []
    citations: list[Citation] = []
    grounded: bool
