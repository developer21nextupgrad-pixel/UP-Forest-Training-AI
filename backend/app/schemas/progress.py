from __future__ import annotations
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, Field

class SignalSet(BaseModel):
    quiz_signal: float | None
    completion_signal: float | None
    recency_signal: float | None
    activity_signal: float | None

class ChapterMasteryResponse(BaseModel):
    chapter_id: UUID
    subject_id: UUID
    chapter_title: str
    mastery: float | None
    status: str
    coverage: float
    completion: float
    quiz_performance: dict
    latest_score: float | None
    average_score: float | None
    best_score: float | None
    question_accuracy: float | None
    evidence_count: int
    last_activity_at: datetime | None
    review_priority: float
    review_status: str | None
    next_review: datetime | None
    signals: SignalSet
    explanation: str

class SubjectProgressResponse(BaseModel):
    subject_id: UUID
    name: str
    mastery: float | None
    coverage: float
    chapter_count: int
    studied_chapter_count: int
    chapters: list[ChapterMasteryResponse]
    weak_chapters: list[UUID]
    strong_chapters: list[UUID]
    not_started_chapters: list[UUID]
    recent_performance: list[float]

# class ProgressSummaryResponse(BaseModel):
#     mastery: float | None
#     coverage: float
#     subjects: list[SubjectProgressResponse]
#     weak_topics: list[dict]
#     strong_topics: list[dict]
#     not_started: list[dict]
#     learning_gaps: list[dict] = []

class OverallProgressResponse(BaseModel):
    mastery: float | None
    coverage: float


class ProgressSummaryResponse(BaseModel):
    overall: OverallProgressResponse
    subjects: list[SubjectProgressResponse]
    weak_topics: list[dict]
    strong_topics: list[dict]
    not_started: list[dict]
    learning_gaps: list[dict] = []

class SubjectProgressDetailResponse(BaseModel):
    subject: SubjectProgressResponse

class WeakTopicResponse(BaseModel):
    topic: str
    chapter_id: UUID
    subject_id: UUID
    mastery: float
    status: str
    coverage: float
    priority: float
    reason: str
    last_studied: datetime | None
    recommended_action: str
    quiz_id: UUID | None = None

class StrongTopicResponse(BaseModel):
    topic: str
    chapter_id: UUID
    subject_id: UUID
    mastery: float
    coverage: float
    evidence: int
    last_activity: datetime | None

class ReviewResponse(BaseModel):
    review_id: UUID
    subject_id: UUID
    chapter_id: UUID
    chapter: str
    mastery: float
    status: str
    priority: float
    last_reviewed_at: datetime | None
    next_review_at: datetime | None
    recommended_action: str

class DailyReviewsResponse(BaseModel):
    due_count: int
    overdue_count: int
    reviews: list[ReviewResponse]

class ReviewListResponse(BaseModel):
    items: list[ReviewResponse]
    limit: int
    offset: int
    total: int

class RecommendationResponse(BaseModel):
    id: str
    title: str
    reason: str
    priority: float
    action_type: str
    subject_id: UUID
    chapter_id: UUID
    quiz_id: UUID | None = None

class RecommendationsResponse(BaseModel):
    recommendations: list[RecommendationResponse]
