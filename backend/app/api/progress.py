from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_student
from app.core.config import get_settings
from app.db.session import get_db_session
from app.models import User
from app.schemas.progress import (
    ChapterMasteryResponse,
    DailyReviewsResponse,
    ProgressSummaryResponse,
    RecommendationResponse,
    RecommendationsResponse,
    ReviewListResponse,
    ReviewResponse,
    SignalSet,
    StrongTopicResponse,
    SubjectProgressDetailResponse,
    SubjectProgressResponse,
    WeakTopicResponse,
)
from app.services.progress_intelligence import ProgressIntelligenceService


router = APIRouter(prefix="/student", tags=["Progress Intelligence"])


async def _profile_id(user: User, session: AsyncSession) -> UUID:
    from app.models import StudentProfile
    from sqlalchemy import select

    profile = (
        await session.execute(
            select(StudentProfile).where(StudentProfile.user_id == user.id)
        )
    ).scalar_one_or_none()
    if not profile:
        raise HTTPException(409, "Student profile is not configured.")
    return profile.id


def _chapter(item: dict) -> ChapterMasteryResponse:
    return ChapterMasteryResponse(
        chapter_id=item["chapter_id"],
        subject_id=item["subject_id"],
        chapter_title=item["chapter_title"],
        mastery=item["mastery"],
        status=item["status"],
        coverage=item["coverage"],
        completion=item["completion"],
        quiz_performance={
            "completed_attempts": len(item["attempts"]),
            "latest": item["latest_score"],
            "average": round(item["average_score"], 2) if item["average_score"] is not None else None,
            "best": item["best_score"],
        },
        latest_score=item["latest_score"],
        average_score=round(item["average_score"], 2) if item["average_score"] is not None else None,
        best_score=item["best_score"],
        question_accuracy=round(item["question_accuracy"], 2) if item["question_accuracy"] is not None else None,
        evidence_count=item["evidence_count"],
        last_activity_at=item["last_activity_at"],
        review_priority=item["review_priority"],
        review_status=item["review_status"],
        next_review=item["next_review"],
        signals=SignalSet(**item["signals"]),
        explanation=item["explanation"],
    )


def _subject(item: dict) -> SubjectProgressResponse:
    return SubjectProgressResponse(
        subject_id=item["subject_id"],
        name=item["name"],
        mastery=item["mastery"],
        coverage=item["coverage"],
        chapter_count=item["chapter_count"],
        studied_chapter_count=item["studied_chapter_count"],
        chapters=[_chapter(x) for x in item["chapters"]],
        weak_chapters=item["weak_chapters"],
        strong_chapters=item["strong_chapters"],
        not_started_chapters=item["not_started_chapters"],
        recent_performance=item["recent_performance"],
    )


def _review(schedule, chapter, status: str) -> ReviewResponse:
    return ReviewResponse(
        review_id=schedule.id,
        subject_id=schedule.subject_id,
        chapter_id=chapter.id,
        chapter=chapter.title,
        mastery=float(schedule.mastery_score),
        status=status,
        priority=float(schedule.priority),
        last_reviewed_at=schedule.last_reviewed_at,
        next_review_at=schedule.next_review_at,
        recommended_action="REVIEW",
    )


@router.get("/progress", response_model=ProgressSummaryResponse)
async def progress(
    user: User = Depends(require_student),
    session: AsyncSession = Depends(get_db_session),
):
    student_id = await _profile_id(user, session)
    svc = ProgressIntelligenceService(session, get_settings())
    data = await svc.get_or_calculate(student_id)
    return ProgressSummaryResponse(
        overall=data["overall"],
        subjects=[_subject(x) for x in data["subjects"]],
        weak_topics=[
            {
                "topic": x["chapter_title"],
                "chapter_id": x["chapter_id"],
                "subject_id": x["subject_id"],
                "mastery": x["mastery"],
                "status": x["status"],
                "coverage": x["completion"],
                "priority": x["review_priority"],
                "reason": x["explanation"],
                "last_studied": x["last_activity_at"],
                "recommended_action": "REVIEW",
            }
            for x in data["weak_topics"]
        ],
        strong_topics=[
            {
                "topic": x["chapter_title"],
                "chapter_id": x["chapter_id"],
                "subject_id": x["subject_id"],
                "mastery": x["mastery"],
                "coverage": x["completion"],
                "evidence": x["evidence_count"],
                "last_activity": x["last_activity_at"],
            }
            for x in data["strong_topics"]
        ],
        not_started=[
            {
                "topic": x["chapter_title"],
                "chapter_id": x["chapter_id"],
                "subject_id": x["subject_id"],
                "status": "NOT_STARTED",
                "mastery": None,
                "coverage": x["completion"],
                "priority": x["review_priority"],
            }
            for x in data["not_started"]
        ],
        learning_gaps=[
            {
                "topic": x["chapter_title"],
                "chapter_id": x["chapter_id"],
                "subject_id": x["subject_id"],
                "status": x["status"],
                "mastery": x["mastery"],
                "coverage": x["completion"],
                "priority": x["review_priority"],
            }
            for x in sorted(data["weak_topics"] + data["not_started"], key=lambda z: z["review_priority"], reverse=True)
        ],
    )


@router.get("/progress/subjects/{subject_id}", response_model=SubjectProgressDetailResponse)
async def subject_progress(
    subject_id: UUID,
    user: User = Depends(require_student),
    session: AsyncSession = Depends(get_db_session),
):
    student_id = await _profile_id(user, session)
    try:
        data = await ProgressIntelligenceService(session, get_settings()).subject(student_id, subject_id)
    except LookupError:
        raise HTTPException(404, "Subject not found")
    return SubjectProgressDetailResponse(subject=_subject(data))


@router.get("/progress/chapters/{chapter_id}", response_model=ChapterMasteryResponse)
async def chapter_progress(
    chapter_id: UUID,
    user: User = Depends(require_student),
    session: AsyncSession = Depends(get_db_session),
):
    student_id = await _profile_id(user, session)
    try:
        data = await ProgressIntelligenceService(session, get_settings()).chapter(student_id, chapter_id)
    except LookupError:
        raise HTTPException(404, "Chapter not found")
    return _chapter(data)


@router.get("/progress/weak-topics", response_model=list[WeakTopicResponse])
async def weak_topics(
    user: User = Depends(require_student),
    session: AsyncSession = Depends(get_db_session),
):
    student_id = await _profile_id(user, session)
    data = await ProgressIntelligenceService(session, get_settings()).weak_topics(student_id)
    return [
        WeakTopicResponse(
            topic=x["chapter_title"],
            chapter_id=x["chapter_id"],
            subject_id=x["subject_id"],
            mastery=float(x["mastery"]),
            status=x["status"],
            coverage=float(x["completion"]),
            priority=float(x["review_priority"]),
            reason=x["explanation"],
            last_studied=x["last_activity_at"],
            recommended_action="REVIEW",
            quiz_id=x.get("quiz_id"),
        )
        for x in data
    ]


@router.get("/progress/strong-topics", response_model=list[StrongTopicResponse])
async def strong_topics(
    user: User = Depends(require_student),
    session: AsyncSession = Depends(get_db_session),
):
    student_id = await _profile_id(user, session)
    data = await ProgressIntelligenceService(session, get_settings()).strong_topics(student_id)
    return [
        StrongTopicResponse(
            topic=x["chapter_title"],
            chapter_id=x["chapter_id"],
            subject_id=x["subject_id"],
            mastery=float(x["mastery"]),
            coverage=float(x["completion"]),
            evidence=x["evidence_count"],
            last_activity=x["last_activity_at"],
        )
        for x in data
    ]


@router.get("/recommendations", response_model=RecommendationsResponse)
async def recommendations(
    user: User = Depends(require_student),
    session: AsyncSession = Depends(get_db_session),
):
    student_id = await _profile_id(user, session)
    data = await ProgressIntelligenceService(session, get_settings()).recommendations(student_id)
    return RecommendationsResponse(
        recommendations=[RecommendationResponse(**x) for x in data]
    )


@router.get("/reviews/today", response_model=DailyReviewsResponse)
async def reviews_today(
    user: User = Depends(require_student),
    session: AsyncSession = Depends(get_db_session),
):
    student_id = await _profile_id(user, session)
    svc = ProgressIntelligenceService(session, get_settings())
    rows, overdue = await svc.daily_reviews(student_id)
    return DailyReviewsResponse(
        due_count=len(rows),
        overdue_count=overdue,
        reviews=[_review(schedule, chapter, status) for schedule, chapter, status in rows],
    )


@router.get("/reviews", response_model=ReviewListResponse)
async def reviews(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user: User = Depends(require_student),
    session: AsyncSession = Depends(get_db_session),
):
    student_id = await _profile_id(user, session)
    rows, total = await ProgressIntelligenceService(session, get_settings()).reviews(student_id, limit, offset)
    return ReviewListResponse(
        items=[_review(schedule, chapter, status) for schedule, chapter, status in rows],
        limit=limit,
        offset=offset,
        total=total,
    )


@router.post("/reviews/{review_id}/complete", response_model=ReviewResponse)
async def complete_review(
    review_id: UUID,
    user: User = Depends(require_student),
    session: AsyncSession = Depends(get_db_session),
):
    student_id = await _profile_id(user, session)
    try:
        schedule = await ProgressIntelligenceService(session, get_settings()).complete_review(student_id, review_id)
    except LookupError:
        raise HTTPException(404, "Review not found")
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    chapter = await session.get(__import__("app.models", fromlist=["Chapter"]).Chapter, schedule.chapter_id)
    return _review(schedule, chapter, "COMPLETED")


@router.post("/reviews/{review_id}/skip", response_model=ReviewResponse)
async def skip_review(
    review_id: UUID,
    user: User = Depends(require_student),
    session: AsyncSession = Depends(get_db_session),
):
    student_id = await _profile_id(user, session)
    try:
        schedule = await ProgressIntelligenceService(session, get_settings()).skip_review(student_id, review_id)
    except LookupError:
        raise HTTPException(404, "Review not found")
    chapter = await session.get(__import__("app.models", fromlist=["Chapter"]).Chapter, schedule.chapter_id)
    return _review(schedule, chapter, "SKIPPED")
