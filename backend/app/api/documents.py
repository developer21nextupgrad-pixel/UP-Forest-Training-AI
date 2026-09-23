from __future__ import annotations

import hashlib
import logging
from datetime import datetime,timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user, require_admin
from app.core.config import get_settings
from app.db.session import get_db_session
from app.models import (
    Book,
    Document,
    DocumentChunk,
    DocumentIngestionJob,
    DocumentPage,
    DocumentSection,
    DocumentVersion,
    Enrollment,
    IngestionJobStatus,
    IngestionStage,
    ProcessingStatus,
    User,
)
from app.repositories.core import (
    DocumentChunkRepository,
    DocumentIngestionJobRepository,
    DocumentPageRepository,
    DocumentRepository,
    DocumentVersionRepository,
)
from app.schemas.books import (
    DocumentChunkListResponse,
    DocumentChunkResponse,
    DocumentPageListResponse,
    DocumentPageResponse,
    DocumentResponse,
    DocumentStatusResponse,
    DocumentVersionResponse,
    IngestionJobListResponse,
    IngestionJobResponse,
)
from app.services.ingestion.queue import IngestionQueue
from app.services.ingestion.storage import get_storage_provider
from app.services.rag_service import ContentIntelligenceService

router = APIRouter(tags=["Document Management"])
logger = logging.getLogger(__name__)


@router.get("/admin/content/search")
async def admin_content_search(
    query: str | None = Query(default=None, min_length=1, max_length=200),
    book_id: UUID | None = None, document_id: UUID | None = None, subject_id: UUID | None = None,
    chapter_id: UUID | None = None, language: str | None = None,
    page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
    _: User = Depends(require_admin), session: AsyncSession = Depends(get_db_session),
):
    if query:
        results, answer, grounded, sources = await ContentIntelligenceService(
            session, get_settings()
        ).answer(query, {
            "book_id": str(book_id) if book_id else None,
            "document_id": str(document_id) if document_id else None,
            "subject_id": str(subject_id) if subject_id else None,
            "chapter_id": str(chapter_id) if chapter_id else None,
            "language": language,
        })
        start = (page - 1) * page_size
        selected = results[start:start + page_size]
        logger.info(
            "Admin content search query=%r answer_grounded=%s sources=%d",
            query,
            grounded,
            len(sources),
        )
        return {
            "items": [{
                "chunk_id": item.chunk_id, "document_id": item.document_id,
                "book_id": item.book_id, "book_title": item.book_title,
                "document_title": item.filename, "page_start": item.page_number,
                "page_end": item.page_end, "chapter_title": item.chapter_title,
                "section_title": item.section_title, "language": item.language,
                "content": item.text, "source_reference": item.source_reference,
                "score": item.relevance_score,
            } for item in selected],
            "answer": answer,
            "grounded": grounded,
            "sources": sources,
            "page": page, "page_size": page_size, "total": len(results),
            "total_pages": (len(results) + page_size - 1) // page_size,
        }

    stmt = (
        select(DocumentChunk, Document, Book)
        .join(Document, DocumentChunk.document_id == Document.id)
        .join(Book, Document.book_id == Book.id)
        .join(DocumentVersion, DocumentChunk.document_version_id == DocumentVersion.id)
        .where(DocumentVersion.is_current.is_(True), Document.archived_at.is_(None))
    )
    if query:
        pattern = f"%{query}%"
        stmt = stmt.where(DocumentChunk.content.ilike(pattern))
    if book_id: stmt = stmt.where(Book.id == book_id)
    if document_id: stmt = stmt.where(Document.id == document_id)
    if subject_id: stmt = stmt.where(Book.subject_id == subject_id)
    if chapter_id: stmt = stmt.where(DocumentChunk.chapter_id == chapter_id)
    if language: stmt = stmt.where(DocumentChunk.language == language)
    count_stmt = select(func.count()).select_from(stmt.with_only_columns(DocumentChunk.id).order_by(None).subquery())
    total = int((await session.execute(count_stmt)).scalar_one())
    rows = (await session.execute(stmt.order_by(DocumentChunk.chunk_index).offset((page-1)*page_size).limit(page_size))).all()
    return {
        "items": [{
            "chunk_id": str(chunk.id), "document_id": str(doc.id), "book_id": str(book.id),
            "book_title": book.title, "document_title": doc.file_name, "page_start": chunk.page_number,
            "page_end": chunk.page_end, "chapter_title": chunk.chapter_title, "section_title": chunk.section_title,
            "language": chunk.language, "content": chunk.content, "source_reference": chunk.source_reference,
        } for chunk, doc, book in rows],
        "page": page, "page_size": page_size, "total": total,
        "total_pages": (total + page_size - 1) // page_size,
    }


@router.get("/content/documents/{document_id}/source")
async def source_preview(
    document_id: UUID, page_number: int | None = Query(default=None, ge=1),
    version_id: UUID | None = None, section: str | None = None,
    user: User = Depends(get_current_user), session: AsyncSession = Depends(get_db_session),
):
    doc = await session.get(Document, document_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    if user.role.value == "STUDENT":
        from app.models import StudentProfile

        profile = (
            await session.execute(
                select(StudentProfile.id).where(
                    StudentProfile.user_id == user.id
                )
            )
        ).scalar_one_or_none()

        book = await session.get(Book, doc.book_id)

        if not profile or not book or not book.subject_id:
            raise HTTPException(
                403,
                "Learning content is not authorized",
            )

        allowed = (
            await session.execute(
                select(Enrollment.id).where(
                    Enrollment.student_id == profile,
                    Enrollment.subject_id == book.subject_id,
                    Enrollment.status == "ACTIVE",
                )
            )
        ).scalar_one_or_none()

        if not allowed:
            raise HTTPException(
                403,
                "Learning content is not authorized",
            )

    elif user.role.value not in {"ADMIN", "LEGAL_USER"}:
        raise HTTPException(
            403,
            "Insufficient permissions",
        )
    stmt = select(DocumentPage).where(DocumentPage.document_id == document_id)
    if version_id: stmt = stmt.where(DocumentPage.document_version_id == version_id)
    else: stmt = stmt.where(DocumentPage.document_version_id == select(DocumentVersion.id).where(DocumentVersion.document_id == document_id, DocumentVersion.is_current.is_(True)).scalar_subquery())
    if page_number: stmt = stmt.where(DocumentPage.page_number == page_number)
    page_obj = (await session.execute(stmt.order_by(DocumentPage.page_number).limit(1))).scalars().first()
    if not page_obj:
        raise HTTPException(404, "Source page not found")
    return {"document_id": str(document_id), "version_id": str(page_obj.document_version_id), "page_number": page_obj.page_number, "printed_page_number": page_obj.printed_page_number, "chapter_id": str(page_obj.chapter_id) if page_obj.chapter_id else None, "section_id": str(page_obj.section_id) if page_obj.section_id else None, "section": section, "markdown": page_obj.markdown, "plain_text": page_obj.plain_text}


@router.get("/books/{book_id}/documents", response_model=list[DocumentResponse])
async def list_documents(book_id: UUID, _: User = Depends(require_admin),
                          session: AsyncSession = Depends(get_db_session)):
    if not await session.get(Book, book_id):
        raise HTTPException(404, "Book not found")
    docs = await DocumentRepository(session).list_for_book(book_id)
    return [DocumentResponse.model_validate(x) for x in docs]


@router.get("/documents/{document_id}", response_model=DocumentResponse)
async def get_document(document_id: UUID, _: User = Depends(require_admin),
                       session: AsyncSession = Depends(get_db_session)):
    doc = await session.get(Document, document_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    return DocumentResponse.model_validate(doc)


@router.get("/documents/{document_id}/status", response_model=DocumentStatusResponse)
async def document_status(document_id: UUID, _: User = Depends(require_admin),
                          session: AsyncSession = Depends(get_db_session)):
    doc = await session.get(Document, document_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    return DocumentStatusResponse.model_validate(doc)


@router.get("/documents/{document_id}/pages", response_model=DocumentPageListResponse)
async def document_pages(
    document_id: UUID, limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0),
    _: User = Depends(require_admin), session: AsyncSession = Depends(get_db_session),
):
    if not await session.get(Document, document_id):
        raise HTTPException(404, "Document not found")
    pages = await DocumentPageRepository(session).list_for_document(document_id, limit=limit, offset=offset)
    return DocumentPageListResponse(
        items=[DocumentPageResponse.model_validate(x) for x in pages], limit=limit, offset=offset
    )


@router.get("/documents/{document_id}/sections")
async def document_sections(
    document_id: UUID,
    version_id: UUID | None = None,
    _: User = Depends(require_admin),
    session: AsyncSession = Depends(get_db_session),
):
    if not await session.get(Document, document_id):
        raise HTTPException(404, "Document not found")
    if version_id is None:
        version_id = await session.scalar(select(DocumentVersion.id).where(DocumentVersion.document_id == document_id, DocumentVersion.is_current.is_(True)))
    rows = (await session.execute(
        select(DocumentSection).where(DocumentSection.document_id == document_id, DocumentSection.document_version_id == version_id).order_by(DocumentSection.order_index)
    )).scalars().all()
    return {"items": [
        {"id": x.id, "document_id": x.document_id, "document_version_id": x.document_version_id, "chapter_id": x.chapter_id, "section_number": x.section_number, "title": x.title, "order_index": x.order_index, "page_start": x.page_start, "page_end": x.page_end, "printed_page_start": x.printed_page_start, "printed_page_end": x.printed_page_end, "source_reference": x.source_reference}
        for x in rows
    ]}

@router.get("/documents/{document_id}/chunks", response_model=DocumentChunkListResponse)
async def document_chunks(
    document_id: UUID, limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0),
    _: User = Depends(require_admin), session: AsyncSession = Depends(get_db_session),
):
    if not await session.get(Document, document_id):
        raise HTTPException(404, "Document not found")
    chunks = await DocumentChunkRepository(session).list_for_document(document_id, limit=limit, offset=offset)
    return DocumentChunkListResponse(
        items=[DocumentChunkResponse.model_validate(x) for x in chunks], limit=limit, offset=offset
    )


@router.get("/documents/{document_id}/versions", response_model=list[DocumentVersionResponse])
async def document_versions(document_id: UUID, _: User = Depends(require_admin),
                            session: AsyncSession = Depends(get_db_session)):
    if not await session.get(Document, document_id):
        raise HTTPException(404, "Document not found")
    result = await session.execute(
        select(DocumentVersion).where(DocumentVersion.document_id == document_id)
        .order_by(DocumentVersion.version_number.desc())
    )
    return [DocumentVersionResponse.model_validate(x) for x in result.scalars().all()]


@router.post("/documents/{document_id}/reprocess", response_model=IngestionJobResponse)
async def reprocess_document(
    document_id: UUID,
    _: User = Depends(require_admin),
    session: AsyncSession = Depends(get_db_session),
    settings=Depends(get_settings),
):
    doc = (
        await session.execute(
            select(Document)
            .where(Document.id == document_id)
            .with_for_update()
        )
    ).scalar_one_or_none()

    if not doc or not doc.storage_key:
        raise HTTPException(404, "Document not found")

    # Check for an existing active job.
    active = await session.execute(
        select(DocumentIngestionJob)
        .where(
            DocumentIngestionJob.document_id == document_id,
            DocumentIngestionJob.status.in_(
                [
                    IngestionJobStatus.QUEUED,
                    IngestionJobStatus.PROCESSING,
                ]
            ),
        )
        .order_by(DocumentIngestionJob.created_at.desc())
    )

    existing_job = active.scalars().first()

    if existing_job:
        now = datetime.now(timezone.utc)

        # A processing job that has not updated for 5 minutes is considered stale.
        stale_threshold = now - timedelta(minutes=5)

        job_is_stale = (
            existing_job.status == IngestionJobStatus.PROCESSING
            and existing_job.updated_at is not None
            and existing_job.updated_at < stale_threshold
        )

        # A queued job is already waiting for the worker.
        if existing_job.status == IngestionJobStatus.QUEUED:
            return IngestionJobResponse.model_validate(existing_job)

        # Only keep a processing job if it is genuinely updating.
        if (
            existing_job.status == IngestionJobStatus.PROCESSING
            and not job_is_stale
            and existing_job.lease_expires_at
            and existing_job.lease_expires_at > now
        ):
            return IngestionJobResponse.model_validate(existing_job)

        # Otherwise the job is stale. Reset it so the worker can claim it again.
        existing_job.status = IngestionJobStatus.QUEUED
        existing_job.stage = IngestionStage.FILE_VALIDATION
        existing_job.progress_percentage = 0
        existing_job.processed_pages = 0
        existing_job.processed_chunks = 0
        existing_job.error_message = None
        existing_job.last_error_code = None
        existing_job.worker_id = None
        existing_job.claimed_at = None
        existing_job.lease_expires_at = None
        existing_job.failed_pages = []
        existing_job.completed_page_indices = []

        doc.processing_status = ProcessingStatus.QUEUED
        doc.ocr_status = ProcessingStatus.QUEUED
        doc.embedding_status = ProcessingStatus.PENDING

        await session.commit()
        await session.refresh(existing_job)

        try:
            queue = IngestionQueue(settings.redis_url)
            await queue.enqueue(existing_job.id)
            await queue.close()
        except Exception as exc:
            existing_job.status = IngestionJobStatus.FAILED
            existing_job.error_message = "Ingestion queue is unavailable."
            doc.processing_status = ProcessingStatus.FAILED
            await session.commit()
            raise HTTPException(
                503,
                "Ingestion service is temporarily unavailable.",
            ) from exc

        return IngestionJobResponse.model_validate(existing_job)

    current = await DocumentVersionRepository(session).get_current(document_id)

    if not current:
        raise HTTPException(409, "Document has no current version.")

    new_version_number = await DocumentVersionRepository(
        session
    ).next_version_number(document_id)

    content = await get_storage_provider(
        settings.storage_root
    ).get(doc.storage_key)

    source_hash = hashlib.sha256(content).hexdigest()

    version = DocumentVersion(
        document_id=document_id,
        version_number=new_version_number,
        version_label=f"Reprocess {new_version_number}",
        is_current=False,
        source_hash=source_hash,
    )

    session.add(version)
    await session.flush()

    job = DocumentIngestionJob(
        document_id=document_id,
        document_version_id=version.id,
        status=IngestionJobStatus.QUEUED,
        stage=IngestionStage.FILE_VALIDATION,
    )

    doc.processing_status = ProcessingStatus.QUEUED
    doc.ocr_status = ProcessingStatus.QUEUED
    doc.embedding_status = ProcessingStatus.PENDING

    session.add(job)
    await session.commit()
    await session.refresh(job)

    try:
        queue = IngestionQueue(settings.redis_url)
        await queue.enqueue(job.id)
        await queue.close()
    except Exception as exc:
        job.status = IngestionJobStatus.FAILED
        job.error_message = "Ingestion queue is unavailable."
        doc.processing_status = ProcessingStatus.FAILED
        await session.commit()
        raise HTTPException(
            503,
            "Ingestion service is temporarily unavailable.",
        ) from exc

    return IngestionJobResponse.model_validate(job)


@router.get("/ingestion/jobs/{job_id}", response_model=IngestionJobResponse)
async def get_job(job_id: UUID, _: User = Depends(require_admin),
                  session: AsyncSession = Depends(get_db_session)):
    job = await session.get(DocumentIngestionJob, job_id)
    if not job:
        raise HTTPException(404, "Ingestion job not found")
    return IngestionJobResponse.model_validate(job)


@router.get("/ingestion/jobs", response_model=IngestionJobListResponse)
async def list_jobs(limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0),
                    _: User = Depends(require_admin), session: AsyncSession = Depends(get_db_session)):
    jobs, total = await DocumentIngestionJobRepository(session).list_recent(limit=limit, offset=offset)
    return IngestionJobListResponse(
        items=[IngestionJobResponse.model_validate(x) for x in jobs], total=total, limit=limit, offset=offset
    )
