from __future__ import annotations
from datetime import date, datetime
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field
from app.models.enums import ContentDomain, DocumentType


class BookCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    author: str | None = Field(default=None, max_length=300)
    publisher: str | None = Field(default=None, max_length=300)
    publication_year: int | None = Field(default=None, ge=1000, le=3000)
    edition: str | None = Field(default=None, max_length=100)
    language: str = Field(default="en", min_length=2, max_length=10)
    description: str | None = None
    domain: ContentDomain = ContentDomain.TRAINING
    subject_id: UUID | None = None


class BookUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    author: str | None = Field(default=None, max_length=300)
    publisher: str | None = Field(default=None, max_length=300)
    publication_year: int | None = Field(default=None, ge=1000, le=3000)
    edition: str | None = Field(default=None, max_length=100)
    language: str | None = Field(default=None, min_length=2, max_length=10)
    description: str | None = None
    domain: ContentDomain | None = None
    subject_id: UUID | None = None


class BookResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    title: str
    author: str | None
    publisher: str | None
    publication_year: int | None
    edition: str | None
    language: str
    description: str | None
    domain: ContentDomain
    subject_id: UUID | None
    status: str
    created_at: datetime
    updated_at: datetime


class BookListResponse(BaseModel):
    items: list[BookResponse]
    total: int
    limit: int
    offset: int


class DocumentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    book_id: UUID
    chapter_id: UUID | None
    file_name: str
    mime_type: str | None
    file_size: int | None
    page_count: int | None
    language: str
    processing_status: str
    ocr_status: str
    embedding_status: str
    created_at: datetime
    updated_at: datetime
    storage_key: str | None = None
    document_type: DocumentType | None = None
    authority: str | None = None
    effective_date: date | None = None
    rule: str | None = None
    

class DocumentStatusResponse(DocumentResponse):
    pass


class DocumentVersionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    document_id: UUID
    version_number: int
    version_label: str | None
    is_current: bool
    source_hash: str | None
    processing_status: str
    error_message: str | None
    processed_at: datetime | None
    created_at: datetime


class DocumentPageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    document_id: UUID
    document_version_id: UUID
    page_number: int
    printed_page_number: int | None = None
    chapter_id: UUID | None = None
    section_id: UUID | None = None
    markdown: str
    plain_text: str


class DocumentPageListResponse(BaseModel):
    items: list[DocumentPageResponse]
    limit: int
    offset: int


class DocumentChunkResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    document_id: UUID
    document_version_id: UUID | None
    chunk_index: int
    page_number: int | None
    page_end: int | None
    printed_page_start: int | None = None
    printed_page_end: int | None = None
    chapter_id: UUID | None = None
    section_id: UUID | None = None
    source_reference: str | None
    section_title: str | None
    chapter_title: str | None
    content: str
    content_hash: str | None
    language: str
    metadata_json: dict | None


class DocumentChunkListResponse(BaseModel):
    items: list[DocumentChunkResponse]
    limit: int
    offset: int


class IngestionJobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    document_id: UUID
    document_version_id: UUID | None
    status: str
    stage: str
    progress_percentage: float
    total_pages: int
    processed_pages: int
    total_chunks: int
    processed_chunks: int
    error_message: str | None
    started_at: datetime | None
    completed_at: datetime | None
    attempt_count: int = 0
    max_attempts: int = 3
    worker_id: str | None = None
    claimed_at: datetime | None = None
    lease_expires_at: datetime | None = None
    last_error_code: str | None = None
    failed_pages: list[int] | None = None
    completed_page_indices: list[int] | None = None
    created_at: datetime
    updated_at: datetime


class IngestionJobListResponse(BaseModel):
    items: list[IngestionJobResponse]
    total: int
    limit: int
    offset: int


class UploadDocumentResponse(BaseModel):
    document: DocumentResponse
    version: DocumentVersionResponse
    job: IngestionJobResponse
