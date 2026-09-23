"""Core relational domain model for the UP Forest training platform.

This is intentionally a foundation: it models ownership, content, learning
state, tutor conversations, assessment, review scheduling, and audit events
without implementing those workflows.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    text,
)

from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.vector import Vector

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.enums import (
    BookStatus,
    ChatRole,
    EnrollmentStatus,
    ProcessingStatus,
    UserRole,
    IngestionJobStatus,
    IngestionStage,
)

JSONType = JSON


class User(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    username: Mapped[str | None] = mapped_column(String(100), unique=True, index=True)
    password_hash: Mapped[str | None] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(200))
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole, name="user_role", native_enum=False), default=UserRole.STUDENT
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    preferred_language: Mapped[str] = mapped_column(String(10), default="en")
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    student_profile: Mapped["StudentProfile | None"] = relationship(
        back_populates="user", uselist=False, cascade="all, delete-orphan"
    )
    instructor_profile: Mapped["InstructorProfile | None"] = relationship(
        back_populates="user", uselist=False, cascade="all, delete-orphan"
    )


class StudentProfile(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "student_profiles"
    __table_args__ = (UniqueConstraint("user_id", name="uq_student_profile_user"),)

    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    trainee_identifier: Mapped[str | None] = mapped_column(String(100), unique=True)
    academy: Mapped[str | None] = mapped_column(String(200))
    batch: Mapped[str | None] = mapped_column(String(100))
    course: Mapped[str | None] = mapped_column(String(200))

    user: Mapped[User] = relationship(back_populates="student_profile")
    enrollments: Mapped[list["Enrollment"]] = relationship(
        back_populates="student", cascade="all, delete-orphan"
    )


class InstructorProfile(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "instructor_profiles"
    __table_args__ = (UniqueConstraint("user_id", name="uq_instructor_profile_user"),)

    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    designation: Mapped[str | None] = mapped_column(String(200))
    academy: Mapped[str | None] = mapped_column(String(200))

    user: Mapped[User] = relationship(back_populates="instructor_profile")


class InstructorSubjectAssignment(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Authorization relationship between an instructor profile and a subject.

    This is not an analytics table; it is the minimum missing assignment
    relationship required to scope instructor intelligence safely.
    """
    __tablename__ = "instructor_subject_assignments"
    __table_args__ = (
        UniqueConstraint(
            "instructor_id",
            "subject_id",
            name="uq_instructor_subject_assignment",
        ),
    )

    instructor_id: Mapped[UUID] = mapped_column(
        ForeignKey("instructor_profiles.id", ondelete="CASCADE"), index=True
    )
    subject_id: Mapped[UUID] = mapped_column(
        ForeignKey("subjects.id", ondelete="CASCADE"), index=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    instructor: Mapped[InstructorProfile] = relationship()
    subject: Mapped["Subject"] = relationship()


class Subject(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "subjects"

    name: Mapped[str] = mapped_column(String(200))
    code: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    language: Mapped[str] = mapped_column(String(10), default="en")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    chapters: Mapped[list["Chapter"]] = relationship(
        back_populates="subject", cascade="all, delete-orphan"
    )
    books: Mapped[list["Book"]] = relationship(back_populates="subject")
    enrollments: Mapped[list["Enrollment"]] = relationship(back_populates="subject")


class Chapter(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "chapters"
    __table_args__ = (
        UniqueConstraint("subject_id", "chapter_number", name="uq_chapter_number_subject"),
    )

    subject_id: Mapped[UUID] = mapped_column(
        ForeignKey("subjects.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(300))
    chapter_number: Mapped[int] = mapped_column(Integer)
    description: Mapped[str | None] = mapped_column(Text)
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    subject: Mapped[Subject] = relationship(back_populates="chapters")
    documents: Mapped[list["Document"]] = relationship(back_populates="chapter")
    sections: Mapped[list["DocumentSection"]] = relationship(back_populates="chapter")
    progress: Mapped[list["LearningProgress"]] = relationship(back_populates="chapter")


class Book(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "books"

    title: Mapped[str] = mapped_column(String(300))
    author: Mapped[str | None] = mapped_column(String(300))
    publisher: Mapped[str | None] = mapped_column(String(300))
    publication_year: Mapped[int | None] = mapped_column(Integer)
    edition: Mapped[str | None] = mapped_column(String(100))
    language: Mapped[str] = mapped_column(String(10), default="en")
    description: Mapped[str | None] = mapped_column(Text)

    domain: Mapped[str] = mapped_column(
        String(20),
        default="TRAINING",
        nullable=False,
        index=True,
    )

    subject_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("subjects.id", ondelete="SET NULL"), index=True
    )
    status: Mapped[BookStatus] = mapped_column(
        Enum(BookStatus, name="book_status", native_enum=False),
        default=BookStatus.UPLOADED,
    )

    subject: Mapped[Subject | None] = relationship(back_populates="books")
    documents: Mapped[list["Document"]] = relationship(
        back_populates="book", cascade="all, delete-orphan"
    )


class Document(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "documents"

    book_id: Mapped[UUID] = mapped_column(
        ForeignKey("books.id", ondelete="CASCADE"), index=True
    )
    chapter_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("chapters.id", ondelete="SET NULL"), index=True
    )
    file_name: Mapped[str] = mapped_column(String(500))
    file_path: Mapped[str | None] = mapped_column(String(1000))
    storage_key: Mapped[str | None] = mapped_column(String(1000))
    mime_type: Mapped[str | None] = mapped_column(String(200))
    file_size: Mapped[int | None] = mapped_column(Integer)
    page_count: Mapped[int | None] = mapped_column(Integer)
    language: Mapped[str] = mapped_column(String(10), default="en")

    document_type: Mapped[str | None] = mapped_column(
        String(50),
        nullable=True,
        index=True,
    )
    authority: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        index=True,
    )
    effective_date: Mapped[date | None] = mapped_column(
        Date,
        nullable=True,
        index=True,
    )
    rule: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    processing_status: Mapped[ProcessingStatus] = mapped_column(
        Enum(ProcessingStatus, name="document_processing_status", native_enum=False, length=30),
        default=ProcessingStatus.PENDING,
    )
    ocr_status: Mapped[ProcessingStatus] = mapped_column(
        Enum(ProcessingStatus, name="document_ocr_status", native_enum=False, length=30),
        default=ProcessingStatus.PENDING,
    )
    embedding_status: Mapped[ProcessingStatus] = mapped_column(
        Enum(ProcessingStatus, name="document_embedding_status", native_enum=False, length=30),
        default=ProcessingStatus.PENDING,
    )
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    book: Mapped[Book] = relationship(back_populates="documents")
    chapter: Mapped[Chapter | None] = relationship(back_populates="documents")
    versions: Mapped[list["DocumentVersion"]] = relationship(
        back_populates="document", cascade="all, delete-orphan"
    )
    chunks: Mapped[list["DocumentChunk"]] = relationship(
        back_populates="document", cascade="all, delete-orphan"
    )


class DocumentVersion(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "document_versions"
    __table_args__ = (UniqueConstraint("document_id", "version_number", name="uq_document_version"),)

    document_id: Mapped[UUID] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), index=True
    )
    version_number: Mapped[int] = mapped_column(Integer)
    version_label: Mapped[str | None] = mapped_column(String(100))
    is_current: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    source_hash: Mapped[str | None] = mapped_column(String(128), index=True)
    processing_status: Mapped[str] = mapped_column(String(30), default="PENDING", nullable=False, index=True)
    error_message: Mapped[str | None] = mapped_column(Text)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("CURRENT_TIMESTAMP"), nullable=False
    )

    document: Mapped[Document] = relationship(back_populates="versions")
    chunks: Mapped[list["DocumentChunk"]] = relationship(back_populates="document_version")


class DocumentSection(UUIDPrimaryKeyMixin, Base):
    """Version-specific section boundary inside a document chapter."""
    __tablename__ = "document_sections"
    __table_args__ = (
        UniqueConstraint("document_version_id", "chapter_id", "section_number", name="uq_document_section"),
    )

    document_id: Mapped[UUID] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    document_version_id: Mapped[UUID] = mapped_column(ForeignKey("document_versions.id", ondelete="CASCADE"), index=True)
    chapter_id: Mapped[UUID] = mapped_column(ForeignKey("chapters.id", ondelete="CASCADE"), index=True)
    section_number: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(500))
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    page_start: Mapped[int | None] = mapped_column(Integer)
    page_end: Mapped[int | None] = mapped_column(Integer)
    printed_page_start: Mapped[int | None] = mapped_column(Integer)
    printed_page_end: Mapped[int | None] = mapped_column(Integer)
    source_reference: Mapped[str | None] = mapped_column(String(1000))

    document: Mapped[Document] = relationship()
    version: Mapped[DocumentVersion] = relationship()
    chapter: Mapped[Chapter] = relationship(back_populates="sections")
    chunks: Mapped[list["DocumentChunk"]] = relationship(back_populates="section")


class DocumentPage(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "document_pages"
    __table_args__ = (
        UniqueConstraint("document_version_id", "page_number", name="uq_document_page"),
    )

    document_id: Mapped[UUID] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), index=True
    )
    document_version_id: Mapped[UUID] = mapped_column(
        ForeignKey("document_versions.id", ondelete="CASCADE"), index=True
    )
    page_number: Mapped[int] = mapped_column(Integer)
    printed_page_number: Mapped[int | None] = mapped_column(Integer, index=True)
    chapter_id: Mapped[UUID | None] = mapped_column(ForeignKey("chapters.id", ondelete="SET NULL"), index=True)
    section_id: Mapped[UUID | None] = mapped_column(ForeignKey("document_sections.id", ondelete="SET NULL"), index=True)
    markdown: Mapped[str] = mapped_column(Text)
    plain_text: Mapped[str] = mapped_column(Text)

class DocumentChunk(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "document_chunks"
    __table_args__ = (
        UniqueConstraint(
            "document_version_id", "chunk_index", name="uq_document_chunk_index"
        ),
    )

    document_id: Mapped[UUID] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), index=True
    )
    document_version_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("document_versions.id", ondelete="CASCADE"), index=True
    )
    chunk_index: Mapped[int] = mapped_column(Integer)
    page_number: Mapped[int | None] = mapped_column(Integer)
    page_end: Mapped[int | None] = mapped_column(Integer)
    printed_page_start: Mapped[int | None] = mapped_column(Integer)
    printed_page_end: Mapped[int | None] = mapped_column(Integer)
    chapter_id: Mapped[UUID | None] = mapped_column(ForeignKey("chapters.id", ondelete="SET NULL"), index=True)
    section_id: Mapped[UUID | None] = mapped_column(ForeignKey("document_sections.id", ondelete="SET NULL"), index=True)
    embedding_dimension: Mapped[int | None] = mapped_column(Integer)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(), nullable=True)
    source_reference: Mapped[str | None] = mapped_column(String(1000))
    section_title: Mapped[str | None] = mapped_column(String(500))
    chapter_title: Mapped[str | None] = mapped_column(String(500))
    content: Mapped[str] = mapped_column(Text)
    content_hash: Mapped[str | None] = mapped_column(String(128), index=True)
    language: Mapped[str] = mapped_column(String(10), default="en")
    metadata_json: Mapped[dict[str, Any] | None] = mapped_column("metadata", JSONType)

    document: Mapped[Document] = relationship(back_populates="chunks")
    chapter: Mapped[Chapter | None] = relationship()
    section: Mapped[DocumentSection | None] = relationship(back_populates="chunks")
    document_version: Mapped[DocumentVersion | None] = relationship(back_populates="chunks")


class DocumentIngestionJob(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "document_ingestion_jobs"

    document_id: Mapped[UUID] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), index=True
    )
    document_version_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("document_versions.id", ondelete="SET NULL"), index=True
    )
    status: Mapped[IngestionJobStatus] = mapped_column(
        Enum(IngestionJobStatus, name="ingestion_job_status", native_enum=False),
        default=IngestionJobStatus.QUEUED,
        nullable=False,
    )
    stage: Mapped[IngestionStage] = mapped_column(
        Enum(IngestionStage, name="ingestion_stage", native_enum=False),
        default=IngestionStage.FILE_VALIDATION,
        nullable=False,
    )
    progress_percentage: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    total_pages: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    processed_pages: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_chunks: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    processed_chunks: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    attempt_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    worker_id: Mapped[str | None] = mapped_column(String(200))
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    last_error_code: Mapped[str | None] = mapped_column(String(100))
    failed_pages: Mapped[list[int] | None] = mapped_column(JSONType)
    completed_page_indices: Mapped[list[int] | None] = mapped_column(JSONType)
    idempotency_key: Mapped[str | None] = mapped_column(String(200), unique=True, index=True)

    document: Mapped[Document] = relationship()

class Enrollment(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "enrollments"
    __table_args__ = (UniqueConstraint("student_id", "subject_id", name="uq_enrollment_student_subject"),)

    student_id: Mapped[UUID] = mapped_column(
        ForeignKey("student_profiles.id", ondelete="CASCADE"), index=True
    )
    subject_id: Mapped[UUID] = mapped_column(
        ForeignKey("subjects.id", ondelete="CASCADE"), index=True
    )
    academy: Mapped[str | None] = mapped_column(String(200))
    batch: Mapped[str | None] = mapped_column(String(100))
    course: Mapped[str | None] = mapped_column(String(200))
    status: Mapped[EnrollmentStatus] = mapped_column(
        Enum(EnrollmentStatus, name="enrollment_status", native_enum=False),
        default=EnrollmentStatus.ACTIVE,
    )

    student: Mapped[StudentProfile] = relationship(back_populates="enrollments")
    subject: Mapped[Subject] = relationship(back_populates="enrollments")


class LearningProgress(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "learning_progress"
    __table_args__ = (UniqueConstraint("student_id", "subject_id", "chapter_id", name="uq_learning_progress"),)

    student_id: Mapped[UUID] = mapped_column(ForeignKey("student_profiles.id", ondelete="CASCADE"), index=True)
    subject_id: Mapped[UUID] = mapped_column(ForeignKey("subjects.id", ondelete="CASCADE"), index=True)
    chapter_id: Mapped[UUID] = mapped_column(ForeignKey("chapters.id", ondelete="CASCADE"), index=True)
    completion_percentage: Mapped[float] = mapped_column(Float, default=0.0)
    last_accessed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    time_spent: Mapped[int] = mapped_column(Integer, default=0)

    student: Mapped[StudentProfile] = relationship()
    subject: Mapped[Subject] = relationship()
    chapter: Mapped[Chapter] = relationship(back_populates="progress")


class LearningHistory(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "learning_history"

    student_id: Mapped[UUID] = mapped_column(ForeignKey("student_profiles.id", ondelete="CASCADE"), index=True)
    event_type: Mapped[str] = mapped_column(String(100), index=True)
    subject_id: Mapped[UUID | None] = mapped_column(ForeignKey("subjects.id", ondelete="SET NULL"))
    chapter_id: Mapped[UUID | None] = mapped_column(ForeignKey("chapters.id", ondelete="SET NULL"))
    event_data: Mapped[dict[str, Any] | None] = mapped_column(JSONType)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("CURRENT_TIMESTAMP"), nullable=False)

    student: Mapped[StudentProfile] = relationship()
    subject: Mapped[Subject | None] = relationship()
    chapter: Mapped[Chapter | None] = relationship()


class ChatSession(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "chat_sessions"

    student_id: Mapped[UUID] = mapped_column(ForeignKey("student_profiles.id", ondelete="CASCADE"), index=True)
    title: Mapped[str | None] = mapped_column(String(300))
    subject_id: Mapped[UUID | None] = mapped_column(ForeignKey("subjects.id", ondelete="SET NULL"))
    chapter_id: Mapped[UUID | None] = mapped_column(ForeignKey("chapters.id", ondelete="SET NULL"))
    language: Mapped[str] = mapped_column(String(10), default="en")

    student: Mapped[StudentProfile] = relationship()
    subject: Mapped[Subject | None] = relationship()
    chapter: Mapped[Chapter | None] = relationship()
    messages: Mapped[list["ChatMessage"]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )


class ChatMessage(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "chat_messages"

    session_id: Mapped[UUID] = mapped_column(ForeignKey("chat_sessions.id", ondelete="CASCADE"), index=True)
    role: Mapped[ChatRole] = mapped_column(
        Enum(ChatRole, name="chat_role", native_enum=False)
    )
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("CURRENT_TIMESTAMP"), nullable=False)

    session: Mapped[ChatSession] = relationship(back_populates="messages")


class Quiz(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "quizzes"

    title: Mapped[str] = mapped_column(String(300))
    description: Mapped[str | None] = mapped_column(Text)
    subject_id: Mapped[UUID | None] = mapped_column(ForeignKey("subjects.id", ondelete="SET NULL"), index=True)
    chapter_id: Mapped[UUID | None] = mapped_column(ForeignKey("chapters.id", ondelete="SET NULL"), index=True)
    created_by: Mapped[UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    status: Mapped[str] = mapped_column(String(30), default="DRAFT", index=True)
    language: Mapped[str] = mapped_column(String(10), default="en")
    difficulty: Mapped[str | None] = mapped_column(String(50))
    time_limit_seconds: Mapped[int | None] = mapped_column(Integer)
    passing_score: Mapped[float] = mapped_column(Float, default=60.0)
    max_attempts: Mapped[int | None] = mapped_column(Integer)
    is_published: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    subject: Mapped[Subject | None] = relationship()
    chapter: Mapped[Chapter | None] = relationship()
    creator: Mapped[User | None] = relationship()
    questions: Mapped[list["Question"]] = relationship(back_populates="quiz", cascade="all, delete-orphan")
    attempts: Mapped[list["QuizAttempt"]] = relationship(back_populates="quiz", cascade="all, delete-orphan")


class Question(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "questions"

    quiz_id: Mapped[UUID] = mapped_column(ForeignKey("quizzes.id", ondelete="CASCADE"), index=True)
    question_text: Mapped[str] = mapped_column(Text)
    question_type: Mapped[str] = mapped_column(String(50), default="MCQ_SINGLE")
    difficulty: Mapped[str | None] = mapped_column(String(50))
    explanation: Mapped[str | None] = mapped_column(Text)
    points: Mapped[float] = mapped_column(Float, default=1.0)
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    source_document_id: Mapped[UUID | None] = mapped_column(ForeignKey("documents.id", ondelete="SET NULL"))
    source_document_version_id: Mapped[UUID | None] = mapped_column(ForeignKey("document_versions.id", ondelete="SET NULL"), index=True)
    source_chunk_id: Mapped[UUID | None] = mapped_column(ForeignKey("document_chunks.id", ondelete="SET NULL"), index=True)
    source_page: Mapped[int | None] = mapped_column(Integer)
    source_metadata: Mapped[dict[str, Any] | None] = mapped_column(JSONType)

    quiz: Mapped[Quiz] = relationship(back_populates="questions")
    options: Mapped[list["QuizOption"]] = relationship(back_populates="question", cascade="all, delete-orphan")
    source_document: Mapped[Document | None] = relationship()


class QuizOption(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "quiz_options"

    question_id: Mapped[UUID] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"), index=True)
    option_key: Mapped[str] = mapped_column(String(20))
    option_text: Mapped[str] = mapped_column(Text)
    option_label: Mapped[str] = mapped_column(String(20))
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    is_correct: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    question: Mapped[Question] = relationship(back_populates="options")


class QuizAttempt(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "quiz_attempts"

    quiz_id: Mapped[UUID] = mapped_column(ForeignKey("quizzes.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[UUID] = mapped_column(ForeignKey("student_profiles.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(30), default="IN_PROGRESS", index=True)
    score: Mapped[float | None] = mapped_column(Float)
    percentage: Mapped[float | None] = mapped_column(Float)
    passed: Mapped[bool | None] = mapped_column(Boolean)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    time_taken_seconds: Mapped[int | None] = mapped_column(Integer)

    quiz: Mapped[Quiz] = relationship(back_populates="attempts")
    student: Mapped[StudentProfile] = relationship()
    answers: Mapped[list["QuizAnswer"]] = relationship(back_populates="attempt", cascade="all, delete-orphan")


class QuizAnswer(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "quiz_answers"
    __table_args__ = (UniqueConstraint("attempt_id", "question_id", name="uq_quiz_answer_attempt_question"),)

    attempt_id: Mapped[UUID] = mapped_column(ForeignKey("quiz_attempts.id", ondelete="CASCADE"), index=True)
    question_id: Mapped[UUID] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"), index=True)
    selected_option_id: Mapped[UUID | None] = mapped_column(ForeignKey("quiz_options.id", ondelete="SET NULL"))
    selected_option_label: Mapped[str | None] = mapped_column(String(20))
    question_snapshot: Mapped[dict[str, Any] | None] = mapped_column(JSONType)
    is_correct: Mapped[bool | None] = mapped_column(Boolean)
    points_awarded: Mapped[float | None] = mapped_column(Float)
    answered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("CURRENT_TIMESTAMP"), nullable=False)

    attempt: Mapped[QuizAttempt] = relationship(back_populates="answers")
    question: Mapped[Question] = relationship()
    selected_option: Mapped[QuizOption | None] = relationship()

class QuizGenerationJob(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "quiz_generation_jobs"

    created_by: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    subject_id: Mapped[UUID] = mapped_column(ForeignKey("subjects.id", ondelete="CASCADE"), index=True)
    chapter_id: Mapped[UUID | None] = mapped_column(ForeignKey("chapters.id", ondelete="SET NULL"), index=True)
    number_of_questions: Mapped[int] = mapped_column(Integer)
    difficulty: Mapped[str] = mapped_column(String(20))
    language: Mapped[str] = mapped_column(String(10))
    status: Mapped[str] = mapped_column(String(30), default="QUEUED", index=True)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    generated_count: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[str | None] = mapped_column(Text)

    creator: Mapped[User] = relationship()

class WeakTopic(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "weak_topics"
    __table_args__ = (UniqueConstraint("student_id", "subject_id", "chapter_id", "topic", name="uq_weak_topic"),)

    student_id: Mapped[UUID] = mapped_column(ForeignKey("student_profiles.id", ondelete="CASCADE"), index=True)
    subject_id: Mapped[UUID] = mapped_column(ForeignKey("subjects.id", ondelete="CASCADE"), index=True)
    chapter_id: Mapped[UUID | None] = mapped_column(ForeignKey("chapters.id", ondelete="SET NULL"), index=True)
    topic: Mapped[str] = mapped_column(String(300))
    mastery_score: Mapped[float] = mapped_column(Float, default=0.0)
    coverage_percentage: Mapped[float] = mapped_column(Float, default=0.0)
    priority: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[str] = mapped_column(String(30), default="WEAK", index=True)
    reason: Mapped[str | None] = mapped_column(Text)
    evidence_count: Mapped[int] = mapped_column(Integer, default=0)
    review_count: Mapped[int] = mapped_column(Integer, default=0)
    last_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    student: Mapped[StudentProfile] = relationship()
    subject: Mapped[Subject] = relationship()
    chapter: Mapped[Chapter | None] = relationship()


class ReviewSchedule(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "review_schedules"

    student_id: Mapped[UUID] = mapped_column(ForeignKey("student_profiles.id", ondelete="CASCADE"), index=True)
    subject_id: Mapped[UUID] = mapped_column(ForeignKey("subjects.id", ondelete="CASCADE"), index=True)
    chapter_id: Mapped[UUID | None] = mapped_column(ForeignKey("chapters.id", ondelete="SET NULL"), index=True)
    topic: Mapped[str] = mapped_column(String(300))
    mastery_score: Mapped[float] = mapped_column(Float, default=0.0)
    mastery_at_schedule: Mapped[float | None] = mapped_column(Float)
    priority: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[str] = mapped_column(String(30), default="SCHEDULED", index=True)
    scheduled_for: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    next_review_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    review_count: Mapped[int] = mapped_column(Integer, default=0)
    last_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    student: Mapped[StudentProfile] = relationship()
    subject: Mapped[Subject] = relationship()
    chapter: Mapped[Chapter | None] = relationship()



class AuditLog(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "audit_logs"

    user_id: Mapped[UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    action: Mapped[str] = mapped_column(String(100), index=True)
    resource_type: Mapped[str | None] = mapped_column(String(100))
    resource_id: Mapped[str | None] = mapped_column(String(100), index=True)
    request_id: Mapped[str | None] = mapped_column(String(100), index=True)
    metadata_json: Mapped[dict[str, Any] | None] = mapped_column("metadata", JSONType)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("CURRENT_TIMESTAMP"), nullable=False)

    user: Mapped[User | None] = relationship()


class PasswordResetToken(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "password_reset_tokens"

    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("CURRENT_TIMESTAMP"), nullable=False)

    user: Mapped[User] = relationship()


class RefreshTokenSession(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "refresh_token_sessions"

    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("CURRENT_TIMESTAMP"), nullable=False)

    user: Mapped[User] = relationship()


# Export list for migrations and imports.
__all__ = [
    "User", "StudentProfile", "InstructorProfile", "InstructorSubjectAssignment", "Subject", "Chapter", "Book",
    "Document", "DocumentVersion", "DocumentPage", "DocumentChunk", "DocumentIngestionJob", "Enrollment",
    "LearningProgress", "LearningHistory", "ChatSession", "ChatMessage",
    "Quiz", "Question", "QuizOption", "QuizAttempt", "QuizAnswer", "QuizGenerationJob",
    "WeakTopic", "ReviewSchedule", "AuditLog", "RefreshTokenSession", "PasswordResetToken",
]
