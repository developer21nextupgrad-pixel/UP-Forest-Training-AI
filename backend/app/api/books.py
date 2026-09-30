from __future__ import annotations

from datetime import date
from pathlib import Path
import hashlib
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_admin
from app.core.config import get_settings
from app.db.session import get_db_session
from app.models import (
    Book,
    BookStatus,
    Document,
    DocumentIngestionJob,
    DocumentVersion,
    IngestionJobStatus,
    IngestionStage,
    ProcessingStatus,
    User,
    DocumentType,
)
from app.repositories.core import (
    BookRepository,
    DocumentRepository,
    DocumentChunkRepository,
)
from app.schemas.books import (
    BookCreate,
    BookListResponse,
    BookResponse,
    BookUpdate,
    DocumentChunkListResponse,
    DocumentChunkResponse,
    DocumentResponse,
    DocumentStatusResponse,
    DocumentVersionResponse,
    IngestionJobResponse,
    UploadDocumentResponse,
)
from app.services.ingestion.queue import IngestionQueue
from app.services.ingestion.storage import get_storage_provider
from app.utils.file import sanitize_filename
from app.utils.validators import validate_ocr_upload


router = APIRouter(
    prefix="/books",
    tags=["Book Management"],
)


def _book(book: Book) -> BookResponse:
    return BookResponse.model_validate(book)


def _document(doc: Document) -> DocumentResponse:
    return DocumentResponse.model_validate(doc)


@router.post(
    "",
    response_model=BookResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_book(
    payload: BookCreate,
    _: User = Depends(require_admin),
    session: AsyncSession = Depends(get_db_session),
):
    book = Book(**payload.model_dump())

    session.add(book)
    await session.commit()
    await session.refresh(book)

    return _book(book)


@router.get(
    "",
    response_model=BookListResponse,
)
async def list_books(
    search: str | None = None,
    subject_id: UUID | None = None,
    language: str | None = None,
    book_status: str | None = Query(
        default=None,
        alias="status",
    ),
    limit: int = Query(
        20,
        ge=1,
        le=100,
    ),
    offset: int = Query(
        0,
        ge=0,
    ),
    _: User = Depends(require_admin),
    session: AsyncSession = Depends(get_db_session),
):
    books, total = await BookRepository(session).list_filtered(
        limit=limit,
        offset=offset,
        search=search,
        subject_id=subject_id,
        language=language,
        status=book_status,
    )

    return BookListResponse(
        items=[_book(x) for x in books],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/{book_id}",
    response_model=BookResponse,
)
async def get_book(
    book_id: UUID,
    _: User = Depends(require_admin),
    session: AsyncSession = Depends(get_db_session),
):
    book = await session.get(Book, book_id)

    if not book:
        raise HTTPException(
            status_code=404,
            detail="Book not found",
        )

    return _book(book)


@router.patch(
    "/{book_id}",
    response_model=BookResponse,
)
async def update_book(
    book_id: UUID,
    payload: BookUpdate,
    _: User = Depends(require_admin),
    session: AsyncSession = Depends(get_db_session),
):
    book = await session.get(Book, book_id)

    if not book:
        raise HTTPException(
            status_code=404,
            detail="Book not found",
        )

    for key, value in payload.model_dump(
        exclude_unset=True
    ).items():
        setattr(book, key, value)

    await session.commit()
    await session.refresh(book)

    return _book(book)


@router.delete(
    "/{book_id}",
    response_model=BookResponse,
)
async def archive_book(
    book_id: UUID,
    _: User = Depends(require_admin),
    session: AsyncSession = Depends(get_db_session),
):
    book = await session.get(Book, book_id)

    if not book:
        raise HTTPException(
            status_code=404,
            detail="Book not found",
        )

    active = await session.execute(
        select(Document).where(
            Document.book_id == book.id,
            Document.processing_status.in_(
                [
                    ProcessingStatus.PROCESSING,
                    ProcessingStatus.OCR_PROCESSING,
                    ProcessingStatus.TEXT_PROCESSING,
                    ProcessingStatus.CHUNKING,
                    ProcessingStatus.EMBEDDING,
                ]
            ),
        )
    )

    if active.scalars().first():
        raise HTTPException(
            status_code=409,
            detail="Cannot archive a book while a document is processing.",
        )

    book.status = BookStatus.ARCHIVED

    await session.commit()
    await session.refresh(book)

    return _book(book)


# ============================================================
# DELETE PARTICULAR PDF DOCUMENT
# ============================================================

@router.delete(
    "/{book_id}/documents/{document_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_document(
    book_id: UUID,
    document_id: UUID,
    _: User = Depends(require_admin),
    session: AsyncSession = Depends(get_db_session),
    settings=Depends(get_settings),
):
    """
    Permanently delete a single PDF document.

    This removes:
    - document DB record
    - document versions
    - ingestion jobs
    - document pages
    - document sections
    - document chunks / embeddings

    Related database records are configured with ON DELETE CASCADE
    in the domain models.

    The physical PDF stored under STORAGE_ROOT is also removed
    when possible.
    """

    document = await session.get(
        Document,
        document_id,
    )

    if not document or document.book_id != book_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found",
        )

    # Never allow deletion while ingestion is actively running.
    active_statuses = {
        ProcessingStatus.PROCESSING,
        ProcessingStatus.OCR_PROCESSING,
        ProcessingStatus.TEXT_PROCESSING,
        ProcessingStatus.CHUNKING,
        ProcessingStatus.EMBEDDING,
    }

    if document.processing_status in active_statuses:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete a document while it is processing.",
        )

    # Save the storage key before deleting the DB object.
    storage_key = document.storage_key or document.file_path

    # Delete the database record.
    #
    # The DB schema has ON DELETE CASCADE for document-owned
    # versions/pages/sections/chunks/ingestion jobs.
    await session.delete(document)

    await session.commit()

    # --------------------------------------------------------
    # Delete physical PDF from local storage
    # --------------------------------------------------------

    if storage_key:
        try:
            storage_root = Path(settings.storage_root)

            storage_path = storage_root / storage_key

            # Prevent accidental directory deletion.
            if storage_path.is_file():
                storage_path.unlink()

        except Exception:
            # The database deletion has already succeeded.
            # Do not turn a successful DB delete into a 500
            # just because the temporary file is already gone.
            pass

    return None


# ============================================================
# UPLOAD PDF
# ============================================================

@router.post(
    "/{book_id}/documents",
    response_model=UploadDocumentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_document(
    book_id: UUID,
    file: UploadFile = File(...),
    language: str = Form("en"),
    document_type: DocumentType | None = Form(default=None),
    authority: str | None = Form(default=None),
    effective_date: date | None = Form(default=None),
    rule: str | None = Form(default=None),
    _: User = Depends(require_admin),
    session: AsyncSession = Depends(get_db_session),
    settings=Depends(get_settings),
):
    if authority is not None:
        authority = authority.strip() or None

    if rule is not None:
        rule = rule.strip() or None

    if language not in {
        "en",
        "hi",
        "auto",
        "unknown",
    }:
        raise HTTPException(
            status_code=422,
            detail="language must be en, hi, auto, or unknown",
        )

    book = await session.get(
        Book,
        book_id,
    )

    if (
        not book
        or book.status == BookStatus.ARCHIVED
    ):
        raise HTTPException(
            status_code=404,
            detail="Book not found",
        )

    filename = sanitize_filename(
        file.filename
    )

    content = await file.read()

    validate_ocr_upload(
        filename=filename,
        content_type=file.content_type,
        size=len(content),
        max_bytes=settings.max_upload_size_bytes,
    )

    if content[:4] != b"%PDF":
        raise HTTPException(
            status_code=415,
            detail="Invalid PDF file signature.",
        )

    source_hash = hashlib.sha256(
        content
    ).hexdigest()

    duplicate = await DocumentRepository(
        session
    ).find_version_by_hash(
        source_hash
    )

    if duplicate:
        raise HTTPException(
            status_code=409,
            detail="This exact document content has already been registered.",
        )

    document = Document(
        book_id=book.id,
        file_name=filename,
        mime_type=file.content_type or "application/pdf",
        file_size=len(content),
        language=language,
        document_type=(
            document_type.value
            if document_type
            else None
        ),
        authority=authority,
        effective_date=effective_date,
        rule=rule,
        processing_status=ProcessingStatus.QUEUED,
        ocr_status=ProcessingStatus.QUEUED,
        embedding_status=ProcessingStatus.PENDING,
    )

    session.add(document)

    await session.flush()

    storage = get_storage_provider(
        settings.storage_root
    )

    key = await storage.save(
        document_id=document.id,
        filename=filename,
        content=content,
    )

    document.storage_key = key
    document.file_path = key

    version = DocumentVersion(
        document_id=document.id,
        version_number=1,
        version_label="Initial",
        is_current=True,
        source_hash=source_hash,
    )

    session.add(version)

    await session.flush()

    job = DocumentIngestionJob(
        document_id=document.id,
        document_version_id=version.id,
        status=IngestionJobStatus.QUEUED,
        stage=IngestionStage.FILE_VALIDATION,
    )

    session.add(job)

    await session.commit()

    await session.refresh(document)
    await session.refresh(version)
    await session.refresh(job)

    try:
        queue = IngestionQueue(
            settings.redis_url
        )

        await queue.enqueue(
            job.id
        )

        await queue.close()

    except Exception as exc:
        job.status = IngestionJobStatus.FAILED

        job.error_message = (
            "Ingestion queue is unavailable."
        )

        document.processing_status = (
            ProcessingStatus.FAILED
        )

        await session.commit()

        raise HTTPException(
            status_code=503,
            detail="Ingestion service is temporarily unavailable.",
        ) from exc

    return UploadDocumentResponse(
        document=_document(document),
        version=DocumentVersionResponse.model_validate(
            version
        ),
        job=IngestionJobResponse.model_validate(
            job
        ),
    )