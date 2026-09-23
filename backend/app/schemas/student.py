from __future__ import annotations
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field

class EnrollmentResponse(BaseModel):
    id: UUID
    subject_id: UUID
    subject_name: str
    subject_code: str
    status: str
    progress_percentage: float

class StudentSubjectResponse(BaseModel):
    id: UUID
    name: str
    code: str
    description: str | None
    language: str
    chapter_count: int
    progress_percentage: float

class ChapterProgressResponse(BaseModel):
    id: UUID
    title: str
    chapter_number: int
    order_index: int
    description: str | None
    progress_percentage: float
    completed: bool

class SubjectDetailResponse(BaseModel):
    subject: StudentSubjectResponse
    chapters: list[ChapterProgressResponse]
    last_accessed_chapter_id: UUID | None = None

class ContentSource(BaseModel):
    book_title: str
    page_start: int | None = None
    page_end: int | None = None
    document_id: UUID | None = None

class ChapterContentItem(BaseModel):
    chunk_id: UUID
    content: str
    page_number: int | None
    section_title: str | None
    chapter_title: str | None
    source: ContentSource

class ChapterContentResponse(BaseModel):
    subject_id: UUID
    chapter_id: UUID
    chapter_title: str
    description: str | None
    items: list[ChapterContentItem]
    page: int
    limit: int
    total: int
    previous_chapter_id: UUID | None
    next_chapter_id: UUID | None

class ProgressUpdateRequest(BaseModel):
    completion_percentage: float = Field(ge=0, le=100)
    time_spent_seconds: int = Field(ge=0, le=14400)

class LearningProgressResponse(BaseModel):
    chapter_id: UUID
    subject_id: UUID
    completion_percentage: float
    time_spent_seconds: int
    last_accessed_at: datetime | None

class LearningHistoryItem(BaseModel):
    id: UUID
    event: str
    subject_name: str | None
    chapter_title: str | None
    timestamp: datetime
    event_data: dict | None = None

class LearningHistoryResponse(BaseModel):
    items: list[LearningHistoryItem]
    limit: int
    offset: int
    total: int

class ContinueLearning(BaseModel):
    subject_id: UUID
    subject_name: str
    chapter_id: UUID
    chapter_title: str
    progress_percentage: float

class DashboardSummary(BaseModel):
    subjects: int
    chapters: int
    completed_chapters: int
    overall_progress: float
    time_spent_seconds: int

class DashboardResponse(BaseModel):
    student: dict
    summary: DashboardSummary
    continue_learning: ContinueLearning | None
    recent_activity: list[LearningHistoryItem]
    subjects: list[StudentSubjectResponse]
    progress_summary: dict = {}
    mastery: float | None = None
    coverage: float = 0.0
    weak_topics: list[dict] = []
    due_reviews: list[dict] = []
    recommendations: list[dict] = []

class StudentProfileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    full_name: str
    preferred_language: str
    trainee_identifier: str | None
    academy: str | None
    batch: str | None
    course: str | None

class StudentProfileUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=200)
    preferred_language: str | None = Field(default=None, pattern="^(hi|en)$")
