from __future__ import annotations

import json
import logging
import math
import time
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from redis.asyncio import Redis
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.models import (
    Chapter,
    Enrollment,
    EnrollmentStatus,
    LearningHistory,
    LearningProgress,
    Quiz,
    QuizAnswer,
    QuizAttempt,
    Question,
    ReviewSchedule,
    Subject,
    WeakTopic,
)
from app.services.student_service import StudentService


logger = logging.getLogger(__name__)


MEANINGFUL_EVENTS = {
    "CHAPTER_OPENED",
    "CHAPTER_COMPLETED",
    "QUIZ_STARTED",
    "QUIZ_SUBMITTED",
    "TUTOR_QUESTION",
    "QUIZ_PASSED",
    "QUIZ_FAILED",
}

COMPLETED_ATTEMPT_STATUSES = {"SUBMITTED", "EXPIRED"}


def clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return round(max(low, min(high, value)), 2)


def recency_signal(days_since_activity: float, decay_days: float) -> float:
    return clamp(
        100.0 * math.exp(
            -max(0.0, days_since_activity) / decay_days
        )
    )


def classify_mastery(
    mastery: float | None,
    evidence_count: int,
    settings: Settings,
) -> str:
    if mastery is None or evidence_count <= 0:
        return "NOT_STARTED"

    if mastery < settings.mastery_weak_threshold:
        return "WEAK"

    if mastery < settings.mastery_review_threshold:
        return "NEEDS_REVIEW"

    if mastery < settings.mastery_mastered_threshold:
        return "DEVELOPING"

    if evidence_count < settings.min_evidence_for_mastered:
        return "DEVELOPING"

    return "MASTERED"


def quiz_signal_from_scores(
    latest: float | None,
    average: float | None,
    best: float | None,
    settings: Settings,
) -> float | None:
    values = [
        value
        for value in (latest, average, best)
        if value is not None
    ]

    if not values:
        return None

    weights = [
        settings.quiz_latest_weight,
        settings.quiz_average_weight,
        settings.quiz_best_weight,
    ]

    available = [
        (value, weight)
        for value, weight in zip(
            (latest, average, best),
            weights,
        )
        if value is not None
    ]

    return clamp(
        sum(value * weight for value, weight in available)
        / sum(weight for _, weight in available)
    )


def activity_signal_from_count(
    count: int,
    settings: Settings,
) -> float:
    return clamp(
        min(
            settings.activity_signal_cap,
            max(0, count) * settings.activity_points_per_event,
        )
    )


def decline_signal_from_scores(
    previous: float | None,
    latest: float | None,
    settings: Settings,
) -> float:
    if previous is None or latest is None:
        return 50.0

    delta = latest - previous

    if delta < 0:
        return clamp(
            abs(delta) * settings.decline_points_multiplier
        )

    if delta > 0:
        return clamp(
            max(
                0.0,
                50.0 - delta * settings.decline_points_multiplier,
            )
        )

    return 50.0


def review_interval_days(
    mastery: float | None,
    settings: Settings,
) -> int:
    if mastery is None:
        return settings.review_interval_developing_days

    if mastery < settings.mastery_weak_threshold:
        return settings.review_interval_very_weak_days

    if mastery < settings.mastery_review_threshold:
        return settings.review_interval_weak_days

    if mastery < settings.mastery_mastered_threshold:
        return settings.review_interval_developing_days

    if mastery < 90:
        return settings.review_interval_good_days

    return settings.review_interval_mastered_days


def review_priority(
    mastery: float | None,
    completion: float,
    recency: float | None,
    decline: float,
    settings: Settings,
    status: str,
) -> float:
    if status == "NOT_STARTED":
        weakness = 50.0
        recency_part = 50.0
    else:
        weakness = 100.0 - (mastery or 0.0)
        recency_part = 100.0 - (
            recency if recency is not None else 50.0
        )

    coverage = 100.0 - completion

    return clamp(
        settings.review_priority_weakness_weight * weakness
        + settings.review_priority_recency_weight * recency_part
        + settings.review_priority_decline_weight * decline
        + settings.review_priority_coverage_weight * coverage
    )


def priority_status(priority: float) -> str:
    if priority < 40:
        return "LOW"

    if priority < 70:
        return "MEDIUM"

    if priority < 85:
        return "HIGH"

    return "URGENT"


def explain_mastery(
    status: str,
    mastery: float | None,
    signals: dict[str, float | None],
    completion: float,
    decline: float,
) -> str:
    if status == "NOT_STARTED":
        return (
            "You have not yet built meaningful evidence "
            "for this chapter."
        )

    if decline > 50:
        return (
            "Recent quiz performance is declining; the latest "
            f"observed change is a {round(decline / 2)}-point decline."
        )

    if mastery is not None and mastery < 40 and completion >= 60:
        return (
            f"Your mastery is {round(mastery)}% despite "
            f"{round(completion)}% content completion."
        )

    available = [
        f"{key.replace('_', ' ')}={round(value)}"
        for key, value in signals.items()
        if value is not None
    ]

    return (
        "Mastery combines the available evidence signals "
        f"({', '.join(available)})."
    )


class ProgressIntelligenceService:

    def __init__(
        self,
        session: AsyncSession,
        settings: Settings | None = None,
    ):
        self.session = session
        self.settings = settings or Settings()

        # Reuse one Redis connection pool instead of creating
        # and closing a Redis client on every request.
        self._redis: Redis | None = None

    def _get_redis(self) -> Redis:
        """
        Lazily create and reuse a Redis connection pool.

        Redis.from_url() creates a client backed by a connection pool.
        Reusing the client avoids reconnecting to Redis on every
        dashboard/progress request.
        """
        if self._redis is None:
            self._redis = Redis.from_url(
                self.settings.redis_url,
                decode_responses=True,
                socket_connect_timeout=1,
                socket_timeout=2,
                health_check_interval=30,
            )

        return self._redis

    async def _enrolled_subjects(
        self,
        student_id: UUID,
    ) -> list[tuple[Subject, list[Chapter]]]:

        rows = (
            await self.session.execute(
                select(Subject, Chapter)
                .join(
                    Enrollment,
                    Enrollment.subject_id == Subject.id,
                )
                .join(
                    Chapter,
                    Chapter.subject_id == Subject.id,
                )
                .where(
                    Enrollment.student_id == student_id,
                    Enrollment.status == EnrollmentStatus.ACTIVE,
                    Subject.is_active.is_(True),
                    Chapter.is_active.is_(True),
                )
                .order_by(
                    Subject.name,
                    Chapter.order_index,
                    Chapter.chapter_number,
                )
            )
        ).all()

        grouped: dict[
            UUID,
            tuple[Subject, list[Chapter]],
        ] = {}

        for subject, chapter in rows:
            grouped.setdefault(
                subject.id,
                (subject, []),
            )[1].append(chapter)

        return list(grouped.values())

    async def _source_data(
        self,
        student_id: UUID,
        subject_ids: list[UUID],
        chapter_ids: list[UUID],
    ):
        """
        Load only data relevant to the student's enrolled chapters.

        This avoids scanning unrelated student/history/quiz data.
        """

        if not chapter_ids:
            return [], [], [], [], [], []

        progress_rows = (
            await self.session.execute(
                select(LearningProgress).where(
                    LearningProgress.student_id == student_id,
                    LearningProgress.chapter_id.in_(chapter_ids),
                )
            )
        ).scalars().all()

        history_rows = (
            await self.session.execute(
                select(LearningHistory)
                .where(
                    LearningHistory.student_id == student_id,
                    LearningHistory.chapter_id.in_(chapter_ids),
                    LearningHistory.event_type.in_(
                        MEANINGFUL_EVENTS
                    ),
                )
                .order_by(LearningHistory.created_at)
            )
        ).scalars().all()

        attempt_rows = (
            await self.session.execute(
                select(QuizAttempt, Quiz)
                .join(
                    Quiz,
                    Quiz.id == QuizAttempt.quiz_id,
                )
                .where(
                    QuizAttempt.student_id == student_id,
                    QuizAttempt.status.in_(
                        COMPLETED_ATTEMPT_STATUSES
                    ),
                    Quiz.chapter_id.in_(chapter_ids),
                )
                .order_by(
                    QuizAttempt.submitted_at,
                    QuizAttempt.created_at,
                )
            )
        ).all()

        answer_rows = (
            await self.session.execute(
                select(
                    QuizAnswer,
                    Question,
                    QuizAttempt,
                    Quiz,
                )
                .join(
                    Question,
                    Question.id == QuizAnswer.question_id,
                )
                .join(
                    QuizAttempt,
                    QuizAttempt.id == QuizAnswer.attempt_id,
                )
                .join(
                    Quiz,
                    Quiz.id == QuizAttempt.quiz_id,
                )
                .where(
                    QuizAttempt.student_id == student_id,
                    QuizAttempt.status.in_(
                        COMPLETED_ATTEMPT_STATUSES
                    ),
                    QuizAnswer.is_correct.is_not(None),
                    Quiz.subject_id.in_(subject_ids),
                )
            )
        ).all()

        schedules = (
            await self.session.execute(
                select(ReviewSchedule).where(
                    ReviewSchedule.student_id == student_id,
                    ReviewSchedule.chapter_id.in_(chapter_ids),
                )
            )
        ).scalars().all()

        quiz_rows = (
            await self.session.execute(
                select(Quiz).where(
                    Quiz.status == "PUBLISHED",
                    Quiz.is_published.is_(True),
                    Quiz.is_active.is_(True),
                    Quiz.subject_id.in_(subject_ids),
                )
            )
        ).scalars().all()

        return (
            progress_rows,
            history_rows,
            attempt_rows,
            answer_rows,
            schedules,
            quiz_rows,
        )

    @staticmethod
    def _question_chapter_id(
        question: Question,
        quiz: Quiz,
    ) -> UUID | None:

        if quiz.chapter_id:
            return quiz.chapter_id

        metadata = question.source_metadata or {}
        raw = metadata.get("chapter_id")

        if raw:
            try:
                return UUID(str(raw))
            except (ValueError, TypeError):
                return None

        return None

    def _chapter_metrics(
        self,
        chapter: Chapter,
        progress_map: dict[UUID, LearningProgress],
        history_by_chapter: dict[
            UUID,
            list[LearningHistory],
        ],
        attempts_by_chapter: dict[
            UUID,
            list[QuizAttempt],
        ],
        answers_by_chapter: dict[
            UUID,
            list[QuizAnswer],
        ],
        schedule_map: dict[
            UUID,
            ReviewSchedule,
        ],
        quiz_map: dict[UUID, UUID],
        now: datetime,
    ) -> dict[str, Any]:

        progress = progress_map.get(chapter.id)

        completion = (
            clamp(
                float(progress.completion_percentage)
            )
            if progress
            else 0.0
        )

        chapter_attempts = attempts_by_chapter.get(
            chapter.id,
            [],
        )

        scores = [
            float(a.percentage or 0.0)
            for a in chapter_attempts
            if a.percentage is not None
        ]

        latest = scores[-1] if scores else None

        average = (
            sum(scores) / len(scores)
            if scores
            else None
        )

        best = max(scores) if scores else None

        chapter_answers = answers_by_chapter.get(
            chapter.id,
            [],
        )

        question_accuracy = (
            100.0
            * sum(
                bool(a.is_correct)
                for a in chapter_answers
            )
            / len(chapter_answers)
            if chapter_answers
            else None
        )

        chapter_history = history_by_chapter.get(
            chapter.id,
            [],
        )

        activity_count = len(chapter_history)

        timestamps = [
            h.created_at
            for h in chapter_history
        ]

        if progress and progress.last_accessed_at:
            timestamps.append(
                progress.last_accessed_at
            )

        timestamps.extend(
            a.submitted_at
            for a in chapter_attempts
            if a.submitted_at
        )

        last_activity = (
            max(timestamps)
            if timestamps
            else None
        )

        evidence_count = 0

        if progress and (
            progress.completion_percentage > 0
            or progress.time_spent > 0
        ):
            evidence_count += 1

        evidence_count += len(chapter_attempts)

        evidence_count += min(
            3,
            len(chapter_history),
        )

        evidence_count = min(
            evidence_count,
            10,
        )

        recency = (
            recency_signal(
                (
                    now - last_activity
                ).total_seconds()
                / 86400,
                self.settings.recency_decay_days,
            )
            if last_activity
            else None
        )

        activity = (
            activity_signal_from_count(
                activity_count,
                self.settings,
            )
            if activity_count
            else None
        )

        quiz_sig = quiz_signal_from_scores(
            latest,
            average,
            best,
            self.settings,
        )

        signals: dict[
            str,
            float | None,
        ] = {
            "quiz_signal": quiz_sig,
            "completion_signal": (
                completion
                if progress
                else None
            ),
            "recency_signal": recency,
            "activity_signal": activity,
        }

        configured_weights = {
            "quiz_signal":
                self.settings.mastery_quiz_weight,

            "completion_signal":
                self.settings.mastery_completion_weight,

            "recency_signal":
                self.settings.mastery_recency_weight,

            "activity_signal":
                self.settings.mastery_activity_weight,
        }

        available = [
            (
                signals[name],
                weight,
            )
            for name, weight
            in configured_weights.items()
            if signals[name] is not None
        ]

        mastery = (
            clamp(
                sum(
                    float(value) * weight
                    for value, weight
                    in available
                )
                / sum(
                    weight
                    for _, weight
                    in available
                )
            )
            if available
            else None
        )

        previous = (
            scores[-2]
            if len(scores) >= 2
            else None
        )

        decline = (
            decline_signal_from_scores(
                previous,
                latest,
                self.settings,
            )
            if len(scores) >= 2
            else 50.0
        )

        status = classify_mastery(
            mastery,
            evidence_count,
            self.settings,
        )

        priority = review_priority(
            mastery,
            completion,
            recency,
            decline,
            self.settings,
            status,
        )

        schedule = schedule_map.get(
            chapter.id
        )

        # ---------------------------------------------------------
        # Convert ORM objects to JSON-safe primitive values.
        # Never return ReviewSchedule / QuizAttempt ORM objects
        # directly from analytics response data.
        # ---------------------------------------------------------

        review_status = None

        if schedule:
            review_status = (
                schedule.status.value
                if hasattr(schedule.status, "value")
                else str(schedule.status)
            )

        next_review = (
            schedule.next_review_at
            if schedule
            else None
        )

        attempts = [
            {
                "id": a.id,
                "percentage": (
                    float(a.percentage)
                    if a.percentage is not None
                    else None
                ),
                "status": (
                    a.status.value
                    if hasattr(a.status, "value")
                    else str(a.status)
                ),
                "submitted_at": a.submitted_at,
            }
            for a in chapter_attempts
        ]

        return {
            "chapter_id": chapter.id,
            "subject_id": chapter.subject_id,
            "chapter_title": chapter.title,

            "mastery": mastery,
            "status": status,

            "coverage": completion,
            "completion": completion,

            "latest_score": latest,
            "average_score": average,
            "best_score": best,
            "question_accuracy": question_accuracy,

            "evidence_count": evidence_count,
            "last_activity_at": last_activity,

            "review_priority": priority,
            "review_status": review_status,
            "next_review": next_review,

            "signals": signals,
            "decline_signal": decline,

            "explanation": explain_mastery(
                status,
                mastery,
                signals,
                completion,
                decline,
            ),

            # JSON-safe review information.
            # Do NOT return the raw ReviewSchedule ORM object.
            "schedule": (
                {
                    "id": schedule.id,
                    "chapter_id": schedule.chapter_id,
                    "subject_id": schedule.subject_id,
                    "status": review_status,
                    "priority": float(
                        schedule.priority or 0
                    ),
                    "next_review_at": schedule.next_review_at,
                }
                if schedule
                else None
            ),

            # JSON-safe quiz attempt information.
            # Do NOT return raw QuizAttempt ORM objects.
            "attempts": attempts,

            "quiz_id": quiz_map.get(
                chapter.id
            ),
        }

    async def calculate(
        self,
        student_id: UUID,
    ) -> dict[str, Any]:

        started = time.perf_counter()

        grouped = await self._enrolled_subjects(
            student_id
        )

        subject_ids = [
            subject.id
            for subject, _ in grouped
        ]

        chapter_ids = [
            chapter.id
            for _, chapters in grouped
            for chapter in chapters
        ]

        (
            progress_rows,
            history_rows,
            attempt_rows,
            answer_rows,
            schedules,
            published_quizzes,
        ) = await self._source_data(
            student_id,
            subject_ids,
            chapter_ids,
        )

        logger.info(
            "PROGRESS SOURCE DATA student_id=%s "
            "subjects=%s chapters=%s "
            "progress=%s history=%s attempts=%s "
            "answers=%s schedules=%s quizzes=%s "
            "time_ms=%.2f",
            student_id,
            len(subject_ids),
            len(chapter_ids),
            len(progress_rows),
            len(history_rows),
            len(attempt_rows),
            len(answer_rows),
            len(schedules),
            len(published_quizzes),
            (
                time.perf_counter()
                - started
            ) * 1000,
        )

        progress_map = {
            p.chapter_id: p
            for p in progress_rows
        }

        schedule_map = {
            s.chapter_id: s
            for s in schedules
            if s.chapter_id
        }

        quiz_map = {
            q.chapter_id: q.id
            for q in published_quizzes
            if q.chapter_id
        }

        history_by_chapter: dict[
            UUID,
            list[LearningHistory],
        ] = {}

        for row in history_rows:
            history_by_chapter.setdefault(
                row.chapter_id,
                [],
            ).append(row)

        attempts_by_chapter: dict[
            UUID,
            list[QuizAttempt],
        ] = {}

        for attempt, quiz in attempt_rows:
            if quiz.chapter_id:
                attempts_by_chapter.setdefault(
                    quiz.chapter_id,
                    [],
                ).append(attempt)

        answers_by_chapter: dict[
            UUID,
            list[QuizAnswer],
        ] = {}

        for (
            answer,
            question,
            _attempt,
            quiz,
        ) in answer_rows:

            chapter_id = (
                self._question_chapter_id(
                    question,
                    quiz,
                )
            )

            if chapter_id in chapter_ids:
                answers_by_chapter.setdefault(
                    chapter_id,
                    [],
                ).append(answer)

        now = datetime.now(timezone.utc)

        subjects: list[
            dict[str, Any]
        ] = []

        all_chapters: list[
            dict[str, Any]
        ] = []

        for subject, chapters in grouped:

            metrics = [
                self._chapter_metrics(
                    chapter,
                    progress_map,
                    history_by_chapter,
                    attempts_by_chapter,
                    answers_by_chapter,
                    schedule_map,
                    quiz_map,
                    now,
                )
                for chapter in chapters
            ]

            studied = [
                metric
                for metric in metrics
                if metric["status"]
                != "NOT_STARTED"
            ]

            numeric = [
                metric["mastery"]
                for metric in studied
                if metric["mastery"] is not None
            ]

            mastery = (
                round(
                    sum(numeric)
                    / len(numeric),
                    2,
                )
                if numeric
                else None
            )

            coverage = (
                round(
                    100.0
                    * len(studied)
                    / len(metrics),
                    2,
                )
                if metrics
                else 0.0
            )

            recent = [
                float(
                    metric["latest_score"]
                )
                for metric in metrics
                if metric["latest_score"]
                is not None
            ]

            subjects.append(
                {
                    "subject_id": subject.id,
                    "name": subject.name,
                    "mastery": mastery,
                    "coverage": coverage,
                    "chapter_count": len(metrics),
                    "studied_chapter_count": len(
                        studied
                    ),
                    "chapters": metrics,
                    "weak_chapters": [
                        metric["chapter_id"]
                        for metric in metrics
                        if metric["status"]
                        == "WEAK"
                    ],
                    "strong_chapters": [
                        metric["chapter_id"]
                        for metric in metrics
                        if metric["status"]
                        == "MASTERED"
                    ],
                    "not_started_chapters": [
                        metric["chapter_id"]
                        for metric in metrics
                        if metric["status"]
                        == "NOT_STARTED"
                    ],
                    "recent_performance": recent[-5:],
                }
            )

            all_chapters.extend(metrics)

        studied_all = [
            metric
            for metric in all_chapters
            if metric["status"]
            != "NOT_STARTED"
        ]

        values = [
            metric["mastery"]
            for metric in studied_all
            if metric["mastery"] is not None
        ]

        overall_mastery = (
            round(
                sum(values)
                / len(values),
                2,
            )
            if values
            else None
        )

        overall_coverage = (
            round(
                100.0
                * len(studied_all)
                / len(all_chapters),
                2,
            )
            if all_chapters
            else 0.0
        )

        weak = [
            metric
            for metric in all_chapters
            if metric["status"] == "WEAK"
        ]

        strong = [
            metric
            for metric in all_chapters
            if metric["status"] == "MASTERED"
        ]

        not_started = [
            metric
            for metric in all_chapters
            if metric["status"] == "NOT_STARTED"
        ]

        return {
            "overall": {
                "mastery": overall_mastery,
                "coverage": overall_coverage,
            },
            "subjects": subjects,
            "weak_topics": sorted(
                weak,
                key=lambda x: x[
                    "review_priority"
                ],
                reverse=True,
            ),
            "strong_topics": sorted(
                strong,
                key=lambda x: x[
                    "mastery"
                ] or 0,
                reverse=True,
            ),
            "not_started": sorted(
                not_started,
                key=lambda x: x[
                    "chapter_title"
                ],
            ),
        }

    async def _upsert_schedules(
        self,
        student_id: UUID,
        calculated: dict[str, Any],
        now: datetime,
    ):

        for subject in calculated["subjects"]:

            for item in subject["chapters"]:

                if item["status"] == "NOT_STARTED":
                    continue

                schedule = item["schedule"]

                interval = review_interval_days(
                    item["mastery"],
                    self.settings,
                )

                if schedule is None:

                    due = (
                        now
                        + timedelta(
                            days=interval
                        )
                    )

                    schedule = ReviewSchedule(
                        student_id=student_id,
                        subject_id=item[
                            "subject_id"
                        ],
                        chapter_id=item[
                            "chapter_id"
                        ],
                        topic=item[
                            "chapter_title"
                        ],
                        mastery_score=float(
                            item["mastery"] or 0
                        ),
                        mastery_at_schedule=item[
                            "mastery"
                        ],
                        priority=item[
                            "review_priority"
                        ],
                        status="SCHEDULED",
                        scheduled_for=due,
                        next_review_at=due,
                        review_count=0,
                    )

                    self.session.add(schedule)

                else:

                    schedule.mastery_score = float(
                        item["mastery"] or 0
                    )

                    schedule.priority = float(
                        item["review_priority"]
                    )

                    schedule.topic = item[
                        "chapter_title"
                    ]

                    if schedule.next_review_at is None:

                        due = (
                            now
                            + timedelta(
                                days=interval
                            )
                        )

                        schedule.scheduled_for = due
                        schedule.next_review_at = due
                        schedule.mastery_at_schedule = (
                            item["mastery"]
                        )
                        schedule.status = "SCHEDULED"

                    elif schedule.next_review_at <= now:
                        schedule.status = "DUE"

    async def persist(
        self,
        student_id: UUID,
        calculated: dict[str, Any],
    ) -> None:

        now = datetime.now(timezone.utc)

        await self.session.execute(
            delete(WeakTopic).where(
                WeakTopic.student_id
                == student_id
            )
        )

        for item in calculated["weak_topics"]:

            self.session.add(
                WeakTopic(
                    student_id=student_id,
                    subject_id=item[
                        "subject_id"
                    ],
                    chapter_id=item[
                        "chapter_id"
                    ],
                    topic=item[
                        "chapter_title"
                    ],
                    mastery_score=float(
                        item["mastery"] or 0
                    ),
                    coverage_percentage=item[
                        "completion"
                    ],
                    priority=item[
                        "review_priority"
                    ],
                    status=item["status"],
                    reason=item[
                        "explanation"
                    ],
                    evidence_count=item[
                        "evidence_count"
                    ],
                )
            )

        await self._upsert_schedules(
            student_id,
            calculated,
            now,
        )

        await self.session.commit()

    async def recalculate_and_persist(
        self,
        student_id: UUID,
    ) -> dict[str, Any]:

        calculated = await self.calculate(
            student_id
        )

        await self.persist(
            student_id,
            calculated,
        )

        return calculated

    async def _cache_get(
        self,
        student_id: UUID,
    ) -> dict[str, Any] | None:

        started = time.perf_counter()

        try:
            redis = self._get_redis()

            raw = await redis.get(
                f"progress:student:{student_id}"
            )

            elapsed = (
                time.perf_counter()
                - started
            ) * 1000

            logger.info(
                "REDIS GET student_id=%s "
                "time_ms=%.2f hit=%s",
                student_id,
                elapsed,
                bool(raw),
            )

            return (
                json.loads(raw)
                if raw
                else None
            )

        except Exception as exc:

            logger.warning(
                "REDIS GET failed "
                "student_id=%s error=%s",
                student_id,
                exc,
            )

            return None

    async def _cache_set(
        self,
        student_id: UUID,
        data: dict[str, Any],
    ) -> None:

        started = time.perf_counter()

        try:
            redis = self._get_redis()

            await redis.setex(
                f"progress:student:{student_id}",
                self.settings.progress_cache_ttl_seconds,
                json.dumps(
                    data,
                    default=str,
                ),
            )

            logger.info(
                "REDIS SET student_id=%s "
                "time_ms=%.2f",
                student_id,
                (
                    time.perf_counter()
                    - started
                ) * 1000,
            )

        except Exception as exc:

            logger.warning(
                "REDIS SET failed "
                "student_id=%s error=%s",
                student_id,
                exc,
            )

    async def invalidate_cache(
        self,
        student_id: UUID,
    ) -> None:

        started = time.perf_counter()

        try:
            redis = self._get_redis()

            await redis.delete(
                f"progress:student:{student_id}"
            )

            logger.info(
                "REDIS DELETE student_id=%s "
                "time_ms=%.2f",
                student_id,
                (
                    time.perf_counter()
                    - started
                ) * 1000,
            )

        except Exception as exc:

            logger.warning(
                "REDIS DELETE failed "
                "student_id=%s error=%s",
                student_id,
                exc,
            )

    async def get_or_calculate(
        self,
        student_id: UUID,
    ) -> dict[str, Any]:

        started = time.perf_counter()

        cached = await self._cache_get(
            student_id
        )

        if cached:

            logger.info(
                "PROGRESS CACHE HIT "
                "student_id=%s time_ms=%.2f",
                student_id,
                (
                    time.perf_counter()
                    - started
                ) * 1000,
            )

            return cached

        logger.info(
            "PROGRESS CACHE MISS "
            "student_id=%s time_ms=%.2f",
            student_id,
            (
                time.perf_counter()
                - started
            ) * 1000,
        )

        data = await self.calculate(
            student_id
        )

        logger.info(
            "PROGRESS CALCULATED "
            "student_id=%s time_ms=%.2f",
            student_id,
            (
                time.perf_counter()
                - started
            ) * 1000,
        )

        await self._cache_set(
            student_id,
            data,
        )

        logger.info(
            "PROGRESS CACHE SET "
            "student_id=%s total_ms=%.2f",
            student_id,
            (
                time.perf_counter()
                - started
            ) * 1000,
        )

        return data

    async def weak_topics(
        self,
        student_id: UUID,
    ) -> list[dict[str, Any]]:

        data = await self.get_or_calculate(
            student_id
        )

        return data["weak_topics"]

    async def strong_topics(
        self,
        student_id: UUID,
    ) -> list[dict[str, Any]]:

        data = await self.get_or_calculate(
            student_id
        )

        return data["strong_topics"]

    async def subject(
        self,
        student_id: UUID,
        subject_id: UUID,
    ) -> dict[str, Any]:

        if not await StudentService(
            self.session
        ).has_subject_access(
            student_id,
            subject_id,
        ):
            raise LookupError(
                "Subject not found"
            )

        data = await self.get_or_calculate(
            student_id
        )

        for item in data["subjects"]:
            if item["subject_id"] == subject_id:
                return item

        raise LookupError(
            "Subject not found"
        )

    async def chapter(
        self,
        student_id: UUID,
        chapter_id: UUID,
    ) -> dict[str, Any]:

        chapter = await StudentService(
            self.session
        ).chapter_access(
            student_id,
            chapter_id,
        )

        data = await self.get_or_calculate(
            student_id
        )

        for subject in data["subjects"]:
            for item in subject["chapters"]:
                if item["chapter_id"] == chapter.id:
                    return item

        raise LookupError(
            "Chapter not found"
        )

    async def reviews(
        self,
        student_id: UUID,
        limit: int = 50,
        offset: int = 0,
        subject_ids: list[UUID] | None = None,
    ):

        rows = (
            await self.session.execute(
                select(
                    ReviewSchedule,
                    Chapter,
                )
                .join(
                    Chapter,
                    Chapter.id
                    == ReviewSchedule.chapter_id,
                )
                .where(
                    ReviewSchedule.student_id == student_id,
                    ReviewSchedule.subject_id.in_(subject_ids or [UUID(int=0)]) if subject_ids is not None else True,
                )
                .order_by(
                    ReviewSchedule.next_review_at.nullsfirst(),
                    ReviewSchedule.priority.desc(),
                )
                .offset(offset)
                .limit(limit)
            )
        ).all()

        total = int(
            (
                await self.session.execute(
                    select(
                        func.count()
                    )
                    .select_from(
                        ReviewSchedule
                    )
                    .where(
                        ReviewSchedule.student_id == student_id,
                        ReviewSchedule.subject_id.in_(subject_ids or [UUID(int=0)]) if subject_ids is not None else True,
                    )
                )
            ).scalar_one()
        )

        now = datetime.now(
            timezone.utc
        )

        items = []

        for schedule, chapter in rows:

            status = schedule.status

            if (
                schedule.next_review_at
                and schedule.next_review_at <= now
            ):
                status = "DUE"

            items.append(
                (
                    schedule,
                    chapter,
                    status,
                )
            )

        return items, total

    async def daily_reviews(
        self,
        student_id: UUID,
    ):

        items, _ = await self.reviews(
            student_id,
            limit=100,
            offset=0,
        )

        due = [
            item
            for item in items
            if item[2] == "DUE"
        ]

        overdue = [
            item
            for item in due
            if (
                item[0].next_review_at
                and item[0].next_review_at
                < datetime.now(timezone.utc)
            )
        ]

        return due, len(overdue)

    async def complete_review(
        self,
        student_id: UUID,
        review_id: UUID,
    ) -> ReviewSchedule:

        schedule = (
            await self.session.execute(
                select(ReviewSchedule).where(
                    ReviewSchedule.id
                    == review_id,
                    ReviewSchedule.student_id
                    == student_id,
                )
            )
        ).scalar_one_or_none()

        if not schedule:
            raise LookupError(
                "Review not found"
            )

        now = datetime.now(
            timezone.utc
        )

        if (
            not schedule.next_review_at
            or schedule.next_review_at > now
        ):
            raise ValueError(
                "Review is not due yet"
            )

        schedule.status = "COMPLETED"
        schedule.last_reviewed_at = now
        schedule.review_count += 1

        data = await self.calculate(
            student_id
        )

        chapter = next(
            (
                chapter
                for subject
                in data["subjects"]
                for chapter
                in subject["chapters"]
                if chapter["chapter_id"]
                == schedule.chapter_id
            ),
            None,
        )

        mastery = (
            chapter["mastery"]
            if chapter
            else schedule.mastery_score
        )

        interval = review_interval_days(
            mastery,
            self.settings,
        )

        next_at = (
            now
            + timedelta(
                days=interval
            )
        )

        schedule.mastery_score = float(
            mastery or 0
        )

        schedule.mastery_at_schedule = mastery

        schedule.priority = (
            float(
                chapter[
                    "review_priority"
                ]
            )
            if chapter
            else schedule.priority
        )

        schedule.scheduled_for = next_at
        schedule.next_review_at = next_at

        self.session.add(
            LearningHistory(
                student_id=student_id,
                event_type="REVIEW_COMPLETED",
                subject_id=schedule.subject_id,
                chapter_id=schedule.chapter_id,
                event_data={
                    "review_id": str(
                        schedule.id
                    ),
                    "mastery": mastery,
                    "next_review_at":
                        next_at.isoformat(),
                },
            )
        )

        await self.session.commit()

        await self.invalidate_cache(
            student_id
        )

        try:
            from app.core.config import get_settings
            from app.services.ingestion.queue import (
                IngestionQueue,
            )

            queue = IngestionQueue(
                get_settings().redis_url
            )

            await queue.enqueue_progress_recalculate(
                student_id
            )

            await queue.close()

        except Exception:
            pass

        return schedule

    async def skip_review(
        self,
        student_id: UUID,
        review_id: UUID,
    ) -> ReviewSchedule:

        schedule = (
            await self.session.execute(
                select(ReviewSchedule).where(
                    ReviewSchedule.id
                    == review_id,
                    ReviewSchedule.student_id
                    == student_id,
                )
            )
        ).scalar_one_or_none()

        if not schedule:
            raise LookupError(
                "Review not found"
            )

        now = datetime.now(
            timezone.utc
        )

        schedule.status = "SKIPPED"

        next_at = (
            now
            + timedelta(days=1)
        )

        schedule.scheduled_for = next_at
        schedule.next_review_at = next_at

        self.session.add(
            LearningHistory(
                student_id=student_id,
                event_type="REVIEW_SKIPPED",
                subject_id=schedule.subject_id,
                chapter_id=schedule.chapter_id,
                event_data={
                    "review_id": str(
                        schedule.id
                    )
                },
            )
        )

        await self.session.commit()

        await self.invalidate_cache(
            student_id
        )

        try:
            from app.core.config import get_settings
            from app.services.ingestion.queue import (
                IngestionQueue,
            )

            queue = IngestionQueue(
                get_settings().redis_url
            )

            await queue.enqueue_progress_recalculate(
                student_id
            )

            await queue.close()

        except Exception:
            pass

        return schedule

    def recommendations_from_data(
        self,
        data: dict[str, Any],
        due_rows: list[
            tuple[
                ReviewSchedule,
                Chapter,
                str,
            ]
        ]
        | None = None,
    ) -> list[dict[str, Any]]:

        """
        Build recommendations without recalculating
        progress intelligence.
        """

        actions: list[
            dict[str, Any]
        ] = []

        weak = data.get(
            "weak_topics",
            []
        )

        not_started = data.get(
            "not_started",
            []
        )

        for item in weak:

            reason = (
                item.get("explanation")
                or "This topic needs additional review."
            )

            if item.get(
                "decline_signal",
                0,
            ) > 50:

                reason = (
                    "Your recent quiz performance "
                    f"is declining for "
                    f"{item['chapter_title']}."
                )

            elif (
                item.get("completion", 0)
                >= 60
                and (
                    item.get("mastery")
                    or 0
                )
                < 40
            ):

                reason = (
                    f"Your mastery is "
                    f"{round(item['mastery'])}% "
                    f"despite "
                    f"{round(item['completion'])}% "
                    "content completion."
                )

            actions.append(
                {
                    "id": (
                        f"review:"
                        f"{item['chapter_id']}"
                    ),
                    "title": (
                        f"Review "
                        f"{item['chapter_title']}"
                    ),
                    "reason": reason,
                    "priority": item.get(
                        "review_priority",
                        0,
                    ),
                    "action_type": "REVIEW",
                    "subject_id": item[
                        "subject_id"
                    ],
                    "chapter_id": item[
                        "chapter_id"
                    ],
                    "quiz_id": item.get(
                        "quiz_id"
                    ),
                }
            )

        for item in not_started:

            actions.append(
                {
                    "id": (
                        f"study:"
                        f"{item['chapter_id']}"
                    ),
                    "title": (
                        f"Start "
                        f"{item['chapter_title']}"
                    ),
                    "reason": (
                        "You have not started "
                        "this chapter yet."
                    ),
                    "priority": item.get(
                        "review_priority",
                        0,
                    ),
                    "action_type": "STUDY",
                    "subject_id": item[
                        "subject_id"
                    ],
                    "chapter_id": item[
                        "chapter_id"
                    ],
                    "quiz_id": item.get(
                        "quiz_id"
                    ),
                }
            )

        quiz_by_chapter = {
            chapter["chapter_id"]:
                chapter.get("quiz_id")
            for subject in data.get(
                "subjects",
                []
            )
            for chapter in subject.get(
                "chapters",
                []
            )
        }

        for (
            schedule,
            chapter,
            _status,
        ) in due_rows or []:

            actions.append(
                {
                    "id": (
                        f"due:"
                        f"{schedule.id}"
                    ),
                    "title": (
                        f"Review "
                        f"{chapter.title}"
                    ),
                    "reason": (
                        "This chapter is due "
                        "for review."
                    ),
                    "priority": max(
                        float(
                            schedule.priority
                        ),
                        70.0,
                    ),
                    "action_type": "REVIEW",
                    "subject_id": schedule.subject_id,
                    "chapter_id": chapter.id,
                    "quiz_id": quiz_by_chapter.get(
                        chapter.id
                    ),
                }
            )

        actions.sort(
            key=lambda x: (
                -x["priority"],
                x["id"],
            )
        )

        deduped = []
        seen = set()

        for item in actions:

            if item["chapter_id"] in seen:
                continue

            seen.add(
                item["chapter_id"]
            )

            deduped.append(item)

            if len(deduped) == 5:
                break

        return deduped

    async def recommendations(
        self,
        student_id: UUID,
    ) -> list[dict[str, Any]]:

        data = await self.get_or_calculate(
            student_id
        )

        due, _ = await self.daily_reviews(
            student_id
        )

        return self.recommendations_from_data(
            data,
            due,
        )