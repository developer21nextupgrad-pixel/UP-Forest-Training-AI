from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.db.base import Base
from app.models import (
    Book,
    Chapter,
    Document,
    DocumentChunk,
    DocumentVersion,
    StudentProfile,
    Subject,
    User,
    UserRole,
)


def test_foundation_schema_creates_and_supports_basic_crud():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        user = User(
            email="student@example.com",
            full_name="Forest Student",
            role=UserRole.STUDENT,
        )
        profile = StudentProfile(user=user, academy="UP Forest Academy")
        subject = Subject(name="Forest Management", code="FM-101")
        chapter = Chapter(
            subject=subject,
            title="Introduction",
            chapter_number=1,
            order_index=1,
        )
        book = Book(title="Forest Handbook", subject=subject)
        document = Document(
            book=book,
            chapter=chapter,
            file_name="forest-handbook.pdf",
            page_count=10,
        )
        version = DocumentVersion(document=document, version_number=1)
        chunk = DocumentChunk(
            document=document,
            document_version=version,
            chunk_index=0,
            page_number=1,
            content="Forest management fundamentals.",
            metadata_json={"source": "ocr"},
        )
        session.add_all([profile, chapter, book, document, version, chunk])
        session.commit()

        stored = session.scalar(select(DocumentChunk).where(DocumentChunk.chunk_index == 0))
        assert stored is not None
        assert stored.document.file_name == "forest-handbook.pdf"
        assert stored.document_version.version_number == 1
        assert stored.document.book.subject.code == "FM-101"


def test_foundation_contains_required_entities():
    required = {
        "users", "student_profiles", "instructor_profiles", "subjects", "chapters",
        "books", "documents", "document_versions", "document_chunks", "enrollments",
        "learning_progress", "learning_history", "chat_sessions", "chat_messages",
        "quizzes", "questions", "quiz_options", "quiz_attempts", "quiz_answers",
        "weak_topics", "review_schedules", "audit_logs",
    }
    assert required.issubset(Base.metadata.tables)
