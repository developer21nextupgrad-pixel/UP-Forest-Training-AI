"""Persistence-only repositories used by services and API routes."""
from __future__ import annotations

from typing import Generic, TypeVar
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Book, ChatMessage, ChatSession, Chapter, Document, DocumentChunk, DocumentPage,
    DocumentIngestionJob, DocumentVersion, InstructorProfile, StudentProfile,
    Subject, User, RefreshTokenSession, PasswordResetToken,
)

T = TypeVar("T")


class Repository(Generic[T]):
    model: type[T]

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get(self, entity_id: UUID) -> T | None:
        return await self.session.get(self.model, entity_id)

    async def list(self, *, limit: int = 100, offset: int = 0) -> list[T]:
        result = await self.session.execute(
            select(self.model).offset(offset).limit(limit)
        )
        return list(result.scalars().all())

    async def add(self, entity: T) -> T:
        self.session.add(entity)
        await self.session.flush()
        return entity

    async def delete(self, entity: T) -> None:
        await self.session.delete(entity)


class UserRepository(Repository[User]):
    model = User

    async def get_by_email(self, email: str) -> User | None:
        result = await self.session.execute(select(User).where(User.email == email))
        return result.scalar_one_or_none()

    async def get_by_username(self, username: str) -> User | None:
        result = await self.session.execute(select(User).where(User.username == username))
        return result.scalar_one_or_none()


class StudentRepository(Repository[StudentProfile]):
    model = StudentProfile


class InstructorRepository(Repository[InstructorProfile]):
    model = InstructorProfile


class SubjectRepository(Repository[Subject]):
    model = Subject


class ChapterRepository(Repository[Chapter]):
    model = Chapter

    async def list_for_subject(self, subject_id: UUID) -> list[Chapter]:
        result = await self.session.execute(
            select(Chapter).where(Chapter.subject_id == subject_id).order_by(Chapter.order_index)
        )
        return list(result.scalars().all())


class BookRepository(Repository[Book]):
    model = Book

    async def list_filtered(
        self, *, limit: int, offset: int, search: str | None = None,
        subject_id: UUID | None = None, language: str | None = None,
        status: str | None = None,
    ) -> tuple[list[Book], int]:
        stmt = select(Book)
        count_stmt = select(func.count()).select_from(Book)
        if search:
            term = f"%{search.strip()}%"
            condition = Book.title.ilike(term) | Book.author.ilike(term)
            stmt = stmt.where(condition)
            count_stmt = count_stmt.where(condition)
        if subject_id:
            stmt = stmt.where(Book.subject_id == subject_id)
            count_stmt = count_stmt.where(Book.subject_id == subject_id)
        if language:
            stmt = stmt.where(Book.language == language)
            count_stmt = count_stmt.where(Book.language == language)
        if status:
            stmt = stmt.where(Book.status == status)
            count_stmt = count_stmt.where(Book.status == status)
        total = int((await self.session.execute(count_stmt)).scalar_one())
        result = await self.session.execute(
            stmt.order_by(Book.created_at.desc()).offset(offset).limit(limit)
        )
        return list(result.scalars().all()), total


class DocumentRepository(Repository[Document]):
    model = Document

    async def list_for_book(self, book_id: UUID) -> list[Document]:
        result = await self.session.execute(
            select(Document).where(Document.book_id == book_id).order_by(Document.created_at.desc())
        )
        return list(result.scalars().all())

    async def find_version_by_hash(self, source_hash: str) -> DocumentVersion | None:
        result = await self.session.execute(
            select(DocumentVersion).where(DocumentVersion.source_hash == source_hash)
        )
        return result.scalars().first()


class DocumentVersionRepository(Repository[DocumentVersion]):
    model = DocumentVersion

    async def next_version_number(self, document_id: UUID) -> int:
        result = await self.session.execute(
            select(func.max(DocumentVersion.version_number)).where(
                DocumentVersion.document_id == document_id
            )
        )
        return int(result.scalar_one() or 0) + 1

    async def get_current(self, document_id: UUID) -> DocumentVersion | None:
        result = await self.session.execute(
            select(DocumentVersion).where(
                DocumentVersion.document_id == document_id,
                DocumentVersion.is_current.is_(True),
            )
        )
        return result.scalars().first()


class DocumentPageRepository(Repository[DocumentPage]):
    model = DocumentPage

    async def list_for_document(
        self, document_id: UUID, *, limit: int = 100, offset: int = 0
    ) -> list[DocumentPage]:
        result = await self.session.execute(
            select(DocumentPage).where(DocumentPage.document_id == document_id)
            .order_by(DocumentPage.page_number).offset(offset).limit(limit)
        )
        return list(result.scalars().all())


class DocumentChunkRepository(Repository[DocumentChunk]):
    model = DocumentChunk

    async def list_for_document(
        self, document_id: UUID, *, limit: int = 100, offset: int = 0
    ) -> list[DocumentChunk]:
        result = await self.session.execute(
            select(DocumentChunk)
            .where(DocumentChunk.document_id == document_id)
            .order_by(DocumentChunk.chunk_index)
            .offset(offset).limit(limit)
        )
        return list(result.scalars().all())


class DocumentIngestionJobRepository(Repository[DocumentIngestionJob]):
    model = DocumentIngestionJob

    async def list_recent(self, *, limit: int = 50, offset: int = 0) -> tuple[list[DocumentIngestionJob], int]:
        count = int((await self.session.execute(select(func.count()).select_from(DocumentIngestionJob))).scalar_one())
        result = await self.session.execute(
            select(DocumentIngestionJob).order_by(DocumentIngestionJob.created_at.desc()).offset(offset).limit(limit)
        )
        return list(result.scalars().all()), count

    async def list_recoverable(self, *, stale_before) -> list[DocumentIngestionJob]:
        result = await self.session.execute(
            select(DocumentIngestionJob).where(
                (DocumentIngestionJob.status == "QUEUED")
                | ((DocumentIngestionJob.status == "PROCESSING") & (DocumentIngestionJob.lease_expires_at < stale_before))
            ).order_by(DocumentIngestionJob.created_at).limit(100)
        )
        return list(result.scalars().all())


class ChatRepository(Repository[ChatSession]):
    model = ChatSession

    async def list_messages(self, session_id: UUID) -> list[ChatMessage]:
        result = await self.session.execute(
            select(ChatMessage).where(ChatMessage.session_id == session_id).order_by(ChatMessage.created_at)
        )
        return list(result.scalars().all())


class RefreshTokenRepository(Repository[RefreshTokenSession]):
    model = RefreshTokenSession

    async def get_by_hash(self, token_hash: str) -> RefreshTokenSession | None:
        result = await self.session.execute(
            select(RefreshTokenSession).where(RefreshTokenSession.token_hash == token_hash)
        )
        return result.scalar_one_or_none()

    async def revoke_all_for_user(self, user_id: UUID) -> None:
        result = await self.session.execute(
            select(RefreshTokenSession).where(
                RefreshTokenSession.user_id == user_id,
                RefreshTokenSession.revoked_at.is_(None),
            )
        )
        now = __import__('datetime').datetime.now(__import__('datetime').timezone.utc)
        for token_session in result.scalars().all():
            token_session.revoked_at = now


class PasswordResetTokenRepository(Repository[PasswordResetToken]):
    model = PasswordResetToken

    async def get_by_hash(self, token_hash: str) -> PasswordResetToken | None:
        result = await self.session.execute(
            select(PasswordResetToken).where(PasswordResetToken.token_hash == token_hash)
        )
        return result.scalar_one_or_none()
