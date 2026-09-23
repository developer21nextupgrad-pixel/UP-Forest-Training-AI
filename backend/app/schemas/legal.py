from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field

from app.models.enums import DocumentType
from app.services.rag_schemas import Citation


class LegalQueryRequest(BaseModel):
    question: str = Field(
        min_length=1,
        max_length=4000,
    )
    language: str = Field(
        default="auto",
        pattern="^(hi|en|auto)$",
    )
    document_type: DocumentType | None = None
    authority: str | None = Field(
        default=None,
        max_length=255,
    )


class LegalCitation(Citation):
    document_type: DocumentType | None = None
    authority: str | None = None
    effective_date: str | None = None


class LegalQueryResponse(BaseModel):
    success: bool = True
    answer: str
    language: str
    grounded: bool
    key_points: list[str] = Field(default_factory=list)
    citations: list[LegalCitation] = Field(default_factory=list)