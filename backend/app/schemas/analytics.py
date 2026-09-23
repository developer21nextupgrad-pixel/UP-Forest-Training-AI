from __future__ import annotations
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, Field


class PageInfo(BaseModel):
    page: int
    page_size: int
    total: int
    total_pages: int


class InstructorSummary(BaseModel):
    students: int
    active_students: int
    average_mastery: float | None
    average_coverage: float
    quiz_completion: float | None
    average_quiz_score: float | None
    weak_topics: int
    at_risk_students: int
    due_reviews: int


class RiskItem(BaseModel):
    student_id: UUID
    name: str
    mastery: float | None
    coverage: float
    risk: str
    risk_score: float
    reasons: list[str]
    last_active: datetime | None


class InstructorDashboardResponse(BaseModel):
    summary: InstructorSummary
    weak_topics: list[dict]
    at_risk_students: list[RiskItem]
    subject_overview: list[dict]
    recent_activity: list[dict]


class StudentAnalyticsItem(BaseModel):
    student_id: UUID
    name: str
    email: str
    academy: str | None = None
    batch: str | None = None
    mastery: float | None
    coverage: float
    quiz_score: float | None
    weak_topics: int
    due_reviews: int
    risk: str
    risk_score: float
    risk_reasons: list[str]
    last_active: datetime | None


class StudentAnalyticsListResponse(BaseModel):
    items: list[StudentAnalyticsItem]
    page: int
    page_size: int
    total: int
    total_pages: int


class StudentAnalyticsDetailResponse(BaseModel):
    student: dict
    subjects: list[dict]
    chapters: list[dict]
    weak_topics: list[dict]
    strong_topics: list[dict]
    reviews: list[dict]
    recent_history: list[dict]
    risk: dict


class SubjectAnalyticsResponse(BaseModel):
    items: list[dict]
    page: int = 1
    page_size: int = 50
    total: int = 0
    total_pages: int = 1


class ChapterAnalyticsResponse(BaseModel):
    chapter: dict


class QuizAnalyticsListResponse(BaseModel):
    items: list[dict]
    page: int
    page_size: int
    total: int
    total_pages: int


class QuizAnalyticsResponse(BaseModel):
    analytics: dict


class ActivityResponse(BaseModel):
    items: list[dict]
    page: int
    page_size: int
    total: int
    total_pages: int


class AdminDashboardResponse(BaseModel):
    summary: dict
    risk_distribution: dict


class AdminUsersResponse(BaseModel):
    items: list[dict]
    page: int
    page_size: int
    total: int
    total_pages: int


class AdminContentResponse(BaseModel):
    content: dict


class AdminQuizResponse(BaseModel):
    analytics: dict


class AdminLearningResponse(BaseModel):
    analytics: dict


class AdminReviewsResponse(BaseModel):
    analytics: dict


class AdminActivityResponse(BaseModel):
    items: list[dict]
    page: int
    page_size: int
    total: int
    total_pages: int


class SystemHealthResponse(BaseModel):
    health: dict


class AssignmentRequest(BaseModel):
    subject_id: UUID
    active: bool = True


class AssignmentResponse(BaseModel):
    id: UUID
    instructor_id: UUID
    subject_id: UUID
    active: bool
