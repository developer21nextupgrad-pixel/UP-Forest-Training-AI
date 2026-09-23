from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID
import hashlib
import json

from sqlalchemy import and_, case, desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.models import (
    Book,
    Chapter,
    Document,
    DocumentIngestionJob,
    Enrollment,
    EnrollmentStatus,
    InstructorProfile,
    InstructorSubjectAssignment,
    LearningHistory,
    LearningProgress,
    Question,
    Quiz,
    QuizAnswer,
    QuizAttempt,
    ReviewSchedule,
    StudentProfile,
    Subject,
    User,
    WeakTopic,
)
from app.models.enums import UserRole
from app.services.progress_intelligence import (
    COMPLETED_ATTEMPT_STATUSES,
    MEANINGFUL_EVENTS,
    ProgressIntelligenceService,
    clamp,
)


class AnalyticsScopeError(Exception):
    pass


class InstructorAnalyticsService:
    """Authorization-aware analytics built on Prompt-7 source-of-truth data."""

    def __init__(self, session: AsyncSession, settings: Settings | None = None):
        self.session = session
        self.settings = settings or Settings()
        self.progress = ProgressIntelligenceService(session, self.settings)

    async def instructor_profile(self, user_id: UUID) -> InstructorProfile:
        profile = (
            await self.session.execute(
                select(InstructorProfile).where(InstructorProfile.user_id == user_id)
            )
        ).scalar_one_or_none()
        if not profile:
            raise AnalyticsScopeError("Instructor profile is not configured.")
        return profile

    async def assigned_subject_ids(self, user_id: UUID) -> list[UUID]:
        profile = await self.instructor_profile(user_id)
        rows = await self.session.execute(
            select(InstructorSubjectAssignment.subject_id)
            .where(
                InstructorSubjectAssignment.instructor_id == profile.id,
                InstructorSubjectAssignment.is_active.is_(True),
            )
            .order_by(InstructorSubjectAssignment.subject_id)
        )
        return list(rows.scalars().all())

    async def ensure_subject_access(self, user_id: UUID, subject_id: UUID) -> None:
        ids = await self.assigned_subject_ids(user_id)
        if subject_id not in ids:
            raise AnalyticsScopeError("Subject is outside the instructor's authorized scope.")

    async def scoped_students(
        self,
        user_id: UUID,
        subject_ids: list[UUID] | None = None,
    ) -> list[UUID]:
        """
        Return all registered student profiles that are visible to the
        instructor's authorized subject scope.

        Student visibility is based on the existence of a student account,
        not on whether the student has started learning or has an active
        enrollment yet.

        This allows newly created student accounts to appear in the
        instructor roster with zero/default learning metrics.
        """

        allowed = await self.assigned_subject_ids(user_id)

        if subject_ids is not None:
            allowed = [x for x in allowed if x in subject_ids]

        # Instructor has no authorized subjects.
        if not allowed:
            return []

        rows = await self.session.execute(
            select(StudentProfile.id)
            .join(User, User.id == StudentProfile.user_id)
            .where(
                User.role == UserRole.STUDENT,
            )
            .distinct()
        )

        return list(rows.scalars().all())

    async def ensure_student_access(
        self,
        user_id: UUID,
        student_id: UUID,
    ) -> None:
        """
        Ensure the student exists and the instructor has an authorized
        subject scope.

        Enrollment is intentionally NOT required here because newly
        created student accounts must be visible to instructors even
        before the student starts learning.
        """

        allowed = await self.assigned_subject_ids(user_id)

        if not allowed:
            raise AnalyticsScopeError(
                "Instructor has no authorized subject scope."
            )

        exists = await self.session.execute(
            select(func.count())
            .select_from(StudentProfile)
            .join(User, User.id == StudentProfile.user_id)
            .where(
                StudentProfile.id == student_id,
                User.role == UserRole.STUDENT,
            )
        )

        if int(exists.scalar_one()) == 0:
            raise AnalyticsScopeError(
                "Student is outside the instructor's authorized scope."
            )

    async def _bulk_snapshots(
        self, student_ids: list[UUID], subject_ids: list[UUID]
    ) -> dict[UUID, dict[str, Any]]:
        """Compute Prompt-7 mastery in bulk: fixed query set, no per-student DB loop."""
        if not student_ids or not subject_ids:
            return {}

        grouped_rows = (
            await self.session.execute(
                select(Subject, Chapter)
                .join(Chapter, Chapter.subject_id == Subject.id)
                .where(
                    Subject.id.in_(subject_ids),
                    Subject.is_active.is_(True),
                    Chapter.is_active.is_(True),
                )
                .order_by(Subject.name, Chapter.order_index, Chapter.chapter_number)
            )
        ).all()
        grouped: dict[UUID, tuple[Subject, list[Chapter]]] = {}
        for subject, chapter in grouped_rows:
            grouped.setdefault(subject.id, (subject, []))[1].append(chapter)

        enrollment_rows = list(
            (
                await self.session.execute(
                    select(Enrollment.student_id, Enrollment.subject_id)
                    .where(
                        Enrollment.student_id.in_(student_ids),
                        Enrollment.subject_id.in_(subject_ids),
                        Enrollment.status == EnrollmentStatus.ACTIVE,
                    )
                )
            ).all()
        )
        enrolled_subjects: dict[UUID, set[UUID]] = {}
        for sid, subid in enrollment_rows:
            enrolled_subjects.setdefault(sid, set()).add(subid)

        progress_rows = list(
            (
                await self.session.execute(
                    select(LearningProgress).where(LearningProgress.student_id.in_(student_ids))
                )
            ).scalars().all()
        )
        history_rows = list(
            (
                await self.session.execute(
                    select(LearningHistory)
                    .where(LearningHistory.student_id.in_(student_ids))
                    .order_by(LearningHistory.created_at)
                )
            ).scalars().all()
        )
        attempt_rows = list(
            (
                await self.session.execute(
                    select(QuizAttempt, Quiz)
                    .join(Quiz, Quiz.id == QuizAttempt.quiz_id)
                    .where(
                        QuizAttempt.student_id.in_(student_ids),
                        QuizAttempt.status.in_(COMPLETED_ATTEMPT_STATUSES),
                        Quiz.subject_id.in_(subject_ids),
                    )
                    .order_by(QuizAttempt.submitted_at, QuizAttempt.created_at)
                )
            ).all()
        )
        answer_rows = list(
            (
                await self.session.execute(
                    select(QuizAnswer, Question, QuizAttempt, Quiz)
                    .join(Question, Question.id == QuizAnswer.question_id)
                    .join(QuizAttempt, QuizAttempt.id == QuizAnswer.attempt_id)
                    .join(Quiz, Quiz.id == QuizAttempt.quiz_id)
                    .where(
                        QuizAttempt.student_id.in_(student_ids),
                        QuizAttempt.status.in_(COMPLETED_ATTEMPT_STATUSES),
                        QuizAnswer.is_correct.is_not(None),
                        Quiz.subject_id.in_(subject_ids),
                    )
                )
            ).all()
        )
        schedules = list(
            (
                await self.session.execute(
                    select(ReviewSchedule).where(ReviewSchedule.student_id.in_(student_ids), ReviewSchedule.subject_id.in_(subject_ids))
                )
            ).scalars().all()
        )
        quizzes = list(
            (
                await self.session.execute(
                    select(Quiz).where(
                        Quiz.subject_id.in_(subject_ids),
                        Quiz.status == "PUBLISHED",
                        Quiz.is_published.is_(True),
                        Quiz.is_active.is_(True),
                    )
                )
            ).scalars().all()
        )

        now = datetime.now(timezone.utc)
        out: dict[UUID, dict[str, Any]] = {}
        for student_id in student_ids:
            pmap = {
                p.chapter_id: p
                for p in progress_rows
                if p.student_id == student_id
            }

            hmap: dict[UUID, list[LearningHistory]] = {}
            for h in history_rows:
                if h.student_id == student_id and h.chapter_id:
                    hmap.setdefault(h.chapter_id, []).append(h)

            amap: dict[UUID, list[QuizAttempt]] = {}
            for a, q in attempt_rows:
                if a.student_id == student_id and q.chapter_id:
                    amap.setdefault(q.chapter_id, []).append(a)

            ansmap: dict[UUID, list[QuizAnswer]] = {}
            for answer, question, attempt, quiz in answer_rows:
                if (
                    attempt.student_id == student_id
                    and quiz.chapter_id
                ):
                    ansmap.setdefault(quiz.chapter_id, []).append(answer)

            smap = {
                s.chapter_id: s
                for s in schedules
                if s.student_id == student_id and s.chapter_id
            }

            qmap = {
                q.chapter_id: q.id
                for q in quizzes
                if q.chapter_id
            }
            subjects = []
            all_chapters = []
            for subject, chapters in grouped.values():
                if subject.id not in enrolled_subjects.get(student_id, set()):
                    continue
                metrics = [
                    self.progress._chapter_metrics(
                        c,
                        pmap,
                        hmap,
                        amap,
                        ansmap,
                        smap,
                        qmap,
                        now,
                    )
                    for c in chapters
                ]
                studied = [m for m in metrics if m["status"] != "NOT_STARTED"]
                values = [m["mastery"] for m in studied if m["mastery"] is not None]
                mastery = round(sum(values) / len(values), 2) if values else None
                coverage = round(100 * len(studied) / len(metrics), 2) if metrics else 0
                subjects.append(
                    {
                        "subject_id": subject.id,
                        "name": subject.name,
                        "mastery": mastery,
                        "coverage": coverage,
                        "chapter_count": len(metrics),
                        "chapters": metrics,
                    }
                )
                all_chapters.extend(metrics)

            studied_all = [m for m in all_chapters if m["status"] != "NOT_STARTED"]
            values = [m["mastery"] for m in studied_all if m["mastery"] is not None]
            overall_mastery = round(sum(values) / len(values), 2) if values else None
            coverage = round(100 * len(studied_all) / len(all_chapters), 2) if all_chapters else 0
            latest_scores = [m["latest_score"] for m in all_chapters if m["latest_score"] is not None]
            last_activity = max(
                (m["last_activity_at"] for m in all_chapters if m["last_activity_at"]),
                default=None,
            )
            decline = max(
                (float(m.get("decline_signal", 50.0)) for m in all_chapters),
                default=50.0,
            )
            due = sum(
                1 for s in schedules
                if s.student_id == student_id
                and s.subject_id in subject_ids
                and s.next_review_at is not None
                and s.next_review_at <= now
            )
            out[student_id] = {
                "overall_mastery": overall_mastery,
                "coverage": coverage,
                "subjects": subjects,
                "chapters": all_chapters,
                "latest_scores": latest_scores,
                "last_activity": last_activity,
                "decline_signal": decline,
                "due_reviews": due,
            }
        return out

    def risk(self, snapshot: dict[str, Any]) -> dict[str, Any]:
        mastery = snapshot["overall_mastery"]
        mastery_signal = 100.0 if mastery is None else 100.0 - mastery
        coverage = float(snapshot["coverage"])
        coverage_signal = 100.0 - coverage
        decline_signal = float(snapshot["decline_signal"])
        last = snapshot["last_activity"]
        if not last:
            inactivity = 100.0
        else:
            days = max(0.0, (datetime.now(timezone.utc) - last).total_seconds() / 86400)
            if days < self.settings.risk_inactivity_warning_days:
                inactivity = 0.0
            elif days >= self.settings.risk_inactivity_high_days:
                inactivity = 100.0
            else:
                span = self.settings.risk_inactivity_high_days - self.settings.risk_inactivity_warning_days
                inactivity = 100.0 * (days - self.settings.risk_inactivity_warning_days) / span
        overdue = clamp(
            100.0 * snapshot["due_reviews"] / self.settings.risk_overdue_saturation_count
        )
        score = clamp(
            self.settings.learning_risk_mastery_weight * mastery_signal
            + self.settings.learning_risk_coverage_weight * coverage_signal
            + self.settings.learning_risk_decline_weight * decline_signal
            + self.settings.learning_risk_inactivity_weight * inactivity
            + self.settings.learning_risk_overdue_weight * overdue
        )
        if score >= self.settings.learning_risk_high_threshold:
            level = "HIGH"
        elif score >= self.settings.learning_risk_medium_threshold:
            level = "MEDIUM"
        else:
            level = "LOW"
        reasons = []
        if mastery is None:
            reasons.append("There is not enough mastery evidence yet.")
        elif mastery < 40:
            reasons.append(f"Overall mastery is {round(mastery)}%.")
        if coverage < 50:
            reasons.append(f"Content coverage is {round(snapshot['coverage'])}%.")
        if decline_signal > 50:
            reasons.append(f"Recent quiz performance shows a {round(decline_signal / max(self.settings.decline_points_multiplier, 1))}-point decline signal.")
        if inactivity >= 50:
            reasons.append("Recent learning activity is low.")
        if snapshot["due_reviews"]:
            reasons.append(f"{snapshot['due_reviews']} review(s) are overdue or due.")
        if not reasons:
            reasons.append("Mastery, coverage and recent activity are currently healthy.")
        return {"score": score, "level": level, "reasons": reasons, "signals": {
            "mastery": mastery_signal,
            "coverage": coverage_signal,
            "decline": decline_signal,
            "inactivity": inactivity,
            "overdue": overdue,
        }}

    async def student_list(
        self, user_id: UUID, *, page: int, page_size: int, search: str | None,
        risk: str | None, min_mastery: float | None, max_mastery: float | None,
        sort: str, subject_id: UUID | None
    ):
        allowed_subjects = await self.assigned_subject_ids(user_id)
        if subject_id and subject_id not in allowed_subjects:
            raise AnalyticsScopeError("Subject is outside the instructor's authorized scope.")
        subject_scope = [subject_id] if subject_id else allowed_subjects
        student_ids = await self.scoped_students(user_id, subject_scope)
        if search:
            term = f"%{search.strip()}%"
            rows = await self.session.execute(
                select(StudentProfile.id)
                .join(User, User.id == StudentProfile.user_id)
                .where(
                    StudentProfile.id.in_(student_ids or [UUID(int=0)]),
                    or_(User.full_name.ilike(term), User.email.ilike(term), User.username.ilike(term)),
                )
            )
            student_ids = list(rows.scalars().all())
        snapshots = await self._bulk_snapshots(student_ids, subject_scope)
        user_rows = await self.session.execute(
            select(StudentProfile, User)
            .join(User, User.id == StudentProfile.user_id)
            .where(StudentProfile.id.in_(student_ids or [UUID(int=0)]))
        )
        users = {p.id: (p, u) for p, u in user_rows.all()}
        items = []
        for sid, snap in snapshots.items():
            r = self.risk(snap)
            m = snap["overall_mastery"]
            if risk and r["level"] != risk:
                continue
            if min_mastery is not None and (m is None or m < min_mastery):
                continue
            if max_mastery is not None and (m is None or m > max_mastery):
                continue
            p, u = users[sid]
            items.append({
                "student_id": sid, "name": u.full_name, "email": u.email,
                "academy": p.academy, "batch": p.batch,
                "mastery": m, "coverage": snap["coverage"],
                "quiz_score": round(sum(snap["latest_scores"]) / len(snap["latest_scores"]), 2) if snap["latest_scores"] else None,
                "weak_topics": sum(1 for c in snap["chapters"] if c["status"] == "WEAK"),
                "due_reviews": snap["due_reviews"], "risk": r["level"],
                "risk_score": r["score"], "risk_reasons": r["reasons"],
                "last_active": snap["last_activity"],
            })
        reverse = sort not in {"name", "last_active_asc"}
        key = "name" if sort == "name" else "risk_score" if sort == "risk" else "mastery" if sort == "mastery" else "last_active"
        items.sort(key=lambda x: (x[key] is None, x[key]), reverse=reverse)
        total = len(items)
        start = (page - 1) * page_size
        return items[start:start + page_size], total

    async def student_detail(self, user_id: UUID, student_id: UUID) -> dict[str, Any]:
        await self.ensure_student_access(user_id, student_id)
        subject_ids = await self.assigned_subject_ids(user_id)
        snap = (await self._bulk_snapshots([student_id], subject_ids)).get(student_id)
        if not snap:
            raise AnalyticsScopeError("Student is outside the instructor's authorized scope.")
        profile, user = (
            await self.session.execute(
                select(StudentProfile, User).join(User, User.id == StudentProfile.user_id)
                .where(StudentProfile.id == student_id)
            )
        ).one()
        return {"profile": profile, "user": user, "snapshot": snap, "risk": self.risk(snap)}

    async def subject_overview(self, user_id: UUID, subject_id: UUID | None = None):
        allowed = await self.assigned_subject_ids(user_id)
        ids = [subject_id] if subject_id else allowed
        if subject_id and subject_id not in allowed:
            raise AnalyticsScopeError("Subject is outside the instructor's authorized scope.")
        students = await self.scoped_students(user_id, ids)
        snapshots = await self._bulk_snapshots(students, ids)
        subjects = []
        subj_rows = await self.session.execute(select(Subject).where(Subject.id.in_(ids or [UUID(int=0)])))
        for subject in subj_rows.scalars().all():
            relevant = [s["subjects"] for s in snapshots.values()]
            metrics = [next((x for x in ss if x["subject_id"] == subject.id), None) for ss in relevant]
            metrics = [m for m in metrics if m]
            weak = sum(sum(1 for c in m["chapters"] if c["status"] == "WEAK") for m in metrics)
            risks = sum(1 for s in snapshots.values() if self.risk(s)["level"] == "HIGH" and any(x["subject_id"] == subject.id for x in s["subjects"]))
            subjects.append({
                "subject_id": subject.id, "name": subject.name,
                "students": len(students),
                "average_mastery": round(sum(m["mastery"] for m in metrics if m["mastery"] is not None) / max(1, len([m for m in metrics if m["mastery"] is not None])), 2) if metrics else None,
                "average_coverage": round(sum(m["coverage"] for m in metrics) / max(1, len(metrics)), 2) if metrics else 0,
                "quiz_performance": round(
                    sum(x for s in snapshots.values() for x in s["latest_scores"]) /
                    max(1, sum(len(s["latest_scores"]) for s in snapshots.values())), 2
                ) if metrics else None,
                "weak_topic_count": weak, "at_risk_students": risks,
            })
        return subjects

    async def weak_topics(self, user_id: UUID, subject_id: UUID | None = None):
        allowed = await self.assigned_subject_ids(user_id)
        ids = [subject_id] if subject_id else allowed
        if subject_id and subject_id not in allowed:
            raise AnalyticsScopeError("Subject is outside the instructor's authorized scope.")
        student_ids = await self.scoped_students(user_id, ids)
        snapshots = await self._bulk_snapshots(student_ids, ids)
        buckets: dict[tuple[UUID, UUID], list[dict[str, Any]]] = {}
        for snap in snapshots.values():
            for c in snap["chapters"]:
                if c["status"] == "WEAK":
                    buckets.setdefault((c["subject_id"], c["chapter_id"]), []).append(c)
        rows = []
        for (sid, cid), values in buckets.items():
            ch = values[0]
            rows.append({
                "subject_id": sid, "chapter_id": cid, "topic": ch["chapter_title"],
                "affected_students": len(values),
                "percentage_students": round(100 * len(values) / max(1, len(student_ids)), 2),
                "average_mastery": round(sum(v["mastery"] for v in values) / len(values), 2),
                "average_quiz_score": round(
                    sum(v["latest_score"] for v in values if v["latest_score"] is not None) /
                    max(1, len([v for v in values if v["latest_score"] is not None])), 2
                ),
            })
        rows.sort(key=lambda x: (-x["affected_students"], x["topic"]))
        return rows

    async def chapter(self, user_id: UUID, chapter_id: UUID):
        chapter = await self.session.get(Chapter, chapter_id)
        if not chapter:
            raise AnalyticsScopeError("Chapter not found.")
        await self.ensure_subject_access(user_id, chapter.subject_id)
        student_ids = await self.scoped_students(user_id, [chapter.subject_id])
        snaps = await self._bulk_snapshots(student_ids, [chapter.subject_id])
        vals = [next((c for c in s["chapters"] if c["chapter_id"] == chapter_id), None) for s in snaps.values()]
        vals = [x for x in vals if x]
        studied = [x for x in vals if x["status"] != "NOT_STARTED"]
        scores = [x["latest_score"] for x in vals if x["latest_score"] is not None]
        return {
            "chapter_id": chapter.id, "title": chapter.title, "students": len(vals),
            "studied_count": len(studied), "completion_rate": round(100*len(studied)/max(1,len(vals)),2),
            "average_mastery": round(sum(x["mastery"] for x in studied if x["mastery"] is not None)/max(1,len([x for x in studied if x["mastery"] is not None])),2) if studied else None,
            "average_coverage": round(sum(x["coverage"] for x in vals)/max(1,len(vals)),2),
            "average_quiz_score": round(sum(scores)/len(scores),2) if scores else None,
            "quiz_completion_rate": round(100*len(scores)/max(1,len(vals)),2),
            "weak_students": sum(x["status"] == "WEAK" for x in vals),
            "mastered_students": sum(x["status"] == "MASTERED" for x in vals),
            "not_started_students": sum(x["status"] == "NOT_STARTED" for x in vals),
        }

    async def quiz_list(self, user_id: UUID, page: int, page_size: int, search: str | None, subject_id: UUID | None):
        ids = await self.assigned_subject_ids(user_id)
        if subject_id:
            if subject_id not in ids: raise AnalyticsScopeError("Subject is outside the instructor's authorized scope.")
            ids = [subject_id]
        q = select(Quiz).where(Quiz.subject_id.in_(ids or [UUID(int=0)]), Quiz.is_active.is_(True))
        if search:
            q = q.where(Quiz.title.ilike(f"%{search.strip()}%"))
        q = q.order_by(Quiz.created_at.desc()).offset((page-1)*page_size).limit(page_size)
        rows = list((await self.session.execute(q)).scalars().all())
        total = int((await self.session.execute(select(func.count()).select_from(Quiz).where(Quiz.subject_id.in_(ids or [UUID(int=0)]), Quiz.is_active.is_(True)))).scalar_one())
        return rows, total

    async def quiz_analytics(self, user_id: UUID, quiz_id: UUID) -> dict[str, Any]:
        q = await self.session.get(Quiz, quiz_id)
        if not q: raise AnalyticsScopeError("Quiz not found.")
        await self.ensure_subject_access(user_id, q.subject_id)
        attempts = list((await self.session.execute(
            select(QuizAttempt).where(QuizAttempt.quiz_id == quiz_id, QuizAttempt.status.in_(COMPLETED_ATTEMPT_STATUSES))
        )).scalars().all())
        scoped_students = await self.scoped_students(user_id, [q.subject_id])
        answers = list((await self.session.execute(
            select(QuizAnswer, Question)
            .join(Question, Question.id == QuizAnswer.question_id)
            .join(QuizAttempt, QuizAttempt.id == QuizAnswer.attempt_id)
            .where(QuizAttempt.quiz_id == quiz_id, QuizAttempt.status.in_(COMPLETED_ATTEMPT_STATUSES), QuizAnswer.is_correct.is_not(None))
        )).all())
        questions: dict[UUID, list[bool]] = {}
        texts: dict[UUID, str] = {}
        for a, question in answers:
            questions.setdefault(question.id, []).append(bool(a.is_correct))
            texts[question.id] = question.question_text
        qstats = []
        for qid, vals in questions.items():
            if len(vals) < self.settings.quiz_question_min_evidence:
                continue
            correct = 100*sum(vals)/len(vals)
            qstats.append({"question_id": qid, "question": texts[qid], "attempt_count": len(vals),
                           "correct_percentage": round(correct,2), "incorrect_percentage": round(100-correct,2),
                           "difficulty": round(100-correct,2)})
        scores = [float(a.percentage) for a in attempts if a.percentage is not None]
        return {
            "quiz_id": q.id, "title": q.title, "published": bool(q.is_published),
            "total_attempts": len(attempts),
            "completion_rate": round(100 * len({a.student_id for a in attempts}) / max(1, len(scoped_students)), 2),
            "average_score": round(sum(scores)/len(scores),2) if scores else None,
            "pass_rate": round(100*sum(bool(a.passed) for a in attempts)/len(attempts),2) if attempts else None,
            "question_count": len(qstats),
            "questions": sorted(qstats, key=lambda x: (-x["difficulty"], x["question"])),
        }

    async def activity(self, user_id: UUID, *, start: datetime | None, end: datetime | None, limit: int, offset: int):
        ids = await self.assigned_subject_ids(user_id)
        student_ids = await self.scoped_students(user_id, ids)
        q = (
            select(LearningHistory, User, Subject, Chapter)
            .join(StudentProfile, StudentProfile.id == LearningHistory.student_id)
            .join(User, User.id == StudentProfile.user_id)
            .outerjoin(Subject, Subject.id == LearningHistory.subject_id)
            .outerjoin(Chapter, Chapter.id == LearningHistory.chapter_id)
            .where(
                LearningHistory.student_id.in_(student_ids or [UUID(int=0)]),
                LearningHistory.subject_id.in_(ids or [UUID(int=0)]),
            )
        )
        if start: q=q.where(LearningHistory.created_at >= start)
        if end: q=q.where(LearningHistory.created_at <= end)
        total=int((await self.session.execute(select(func.count()).select_from(LearningHistory).where(
            LearningHistory.student_id.in_(student_ids or [UUID(int=0)]),
            LearningHistory.subject_id.in_(ids or [UUID(int=0)]),
            *( [LearningHistory.created_at >= start] if start else [] ),
            *( [LearningHistory.created_at <= end] if end else [] ),
        ))).scalar_one())
        rows=(await self.session.execute(q.order_by(LearningHistory.created_at.desc()).offset(offset).limit(limit))).all()
        return [{"id":h.id,"event":h.event_type,"student":u.full_name,"subject":sub.name if sub else None,"chapter":ch.title if ch else None,"timestamp":h.created_at,"event_data":h.event_data} for h,u,sub,ch in rows], total


class AdminAnalyticsService:
    def __init__(self, session: AsyncSession, settings: Settings | None = None):
        self.session=session; self.settings=settings or Settings()
        self.progress=ProgressIntelligenceService(session,self.settings)

    @staticmethod
    def _date_filter(column, start, end):
        clauses=[]
        if start: clauses.append(column >= start)
        if end: clauses.append(column <= end)
        return clauses

    async def _all_students(self):
        rows=await self.session.execute(select(StudentProfile.id))
        return list(rows.scalars().all())

    async def _snapshots(self):
        ids=await self._all_students()
        subjects=list((await self.session.execute(select(Subject.id))).scalars().all())
        return await InstructorAnalyticsService(self.session,self.settings)._bulk_snapshots(ids,subjects)

    async def dashboard(self):
        snapshots=await self._snapshots()
        student_count=int((await self.session.execute(select(func.count()).select_from(StudentProfile))).scalar_one())
        instructor_count=int((await self.session.execute(select(func.count()).select_from(InstructorProfile))).scalar_one())
        subject_count=int((await self.session.execute(select(func.count()).select_from(Subject).where(Subject.is_active.is_(True)))).scalar_one())
        chapter_count=int((await self.session.execute(select(func.count()).select_from(Chapter).where(Chapter.is_active.is_(True)))).scalar_one())
        book_count=int((await self.session.execute(select(func.count()).select_from(Book))).scalar_one())
        doc_count=int((await self.session.execute(select(func.count()).select_from(Document))).scalar_one())
        quiz_count=int((await self.session.execute(select(func.count()).select_from(Quiz).where(Quiz.is_active.is_(True)))).scalar_one())
        attempts=int((await self.session.execute(select(func.count()).select_from(QuizAttempt).where(QuizAttempt.status.in_(COMPLETED_ATTEMPT_STATUSES)))).scalar_one())
        mastery=[s["overall_mastery"] for s in snapshots.values() if s["overall_mastery"] is not None]
        risks=[InstructorAnalyticsService(self.session,self.settings).risk(s) for s in snapshots.values()]
        weak_count = int((await self.session.execute(select(func.count()).select_from(WeakTopic).where(WeakTopic.status == "WEAK"))).scalar_one())
        due = int((await self.session.execute(select(func.count()).select_from(ReviewSchedule).where(ReviewSchedule.next_review_at <= datetime.now(timezone.utc)))).scalar_one())
        active_week=int((await self.session.execute(select(func.count(func.distinct(LearningHistory.student_id))).select_from(LearningHistory).where(LearningHistory.created_at >= datetime.now(timezone.utc)-__import__("datetime").timedelta(days=7)))).scalar_one())
        return {
            "summary":{"students":student_count,"active_students":active_week,"instructors":instructor_count,"subjects":subject_count,"chapters":chapter_count,"books":book_count,"documents":doc_count,"quizzes":quiz_count,"quiz_attempts":attempts,
                       "average_mastery":round(sum(mastery)/len(mastery),2) if mastery else None,
                       "average_coverage":round(sum(s["coverage"] for s in snapshots.values())/max(1,len(snapshots)),2),
                       "at_risk_students":sum(r["level"]=="HIGH" for r in risks),
                       "weak_topics":weak_count,"due_reviews":due},
            "risk_distribution":{"HIGH":sum(r["level"]=="HIGH" for r in risks),"MEDIUM":sum(r["level"]=="MEDIUM" for r in risks),"LOW":sum(r["level"]=="LOW" for r in risks)},
        }

    async def users(self,page:int,page_size:int,search:str|None,role:str|None):
        q=select(User)
        if role: q=q.where(User.role==role)
        if search:
            t=f"%{search.strip()}%"; q=q.where(or_(User.full_name.ilike(t),User.email.ilike(t),User.username.ilike(t)))
        total=int((await self.session.execute(select(func.count()).select_from(q.subquery()))).scalar_one())
        rows=list((await self.session.execute(q.order_by(User.full_name).offset((page-1)*page_size).limit(page_size))).scalars().all())
        return rows,total

    async def subjects(self,page:int,page_size:int,search:str|None):
        q=select(Subject).where(Subject.is_active.is_(True))
        if search:q=q.where(or_(Subject.name.ilike(f"%{search}%"),Subject.code.ilike(f"%{search}%")))
        total=int((await self.session.execute(select(func.count()).select_from(q.subquery()))).scalar_one())
        subjects=list((await self.session.execute(q.order_by(Subject.name).offset((page-1)*page_size).limit(page_size))).scalars().all())
        snaps=await self._snapshots()
        chapter_counts = {}
        if subjects:
            chapter_counts = dict((await self.session.execute(
                select(Chapter.subject_id, func.count())
                .where(Chapter.subject_id.in_([s.id for s in subjects]), Chapter.is_active.is_(True))
                .group_by(Chapter.subject_id)
            )).all())
        items=[]
        for sub in subjects:
            metrics=[next((x for x in s["subjects"] if x["subject_id"]==sub.id),None) for s in snaps.values()]
            metrics=[x for x in metrics if x]
            items.append({"subject_id":sub.id,"name":sub.name,"code":sub.code,"students":len(metrics),
                          "chapters":int(chapter_counts.get(sub.id, 0)),
                          "average_mastery":round(sum(x["mastery"] for x in metrics if x["mastery"] is not None)/max(1,len([x for x in metrics if x["mastery"] is not None])),2) if metrics else None,
                          "average_coverage":round(sum(x["coverage"] for x in metrics)/len(metrics),2) if metrics else 0})
        return items,total

    async def content(self):
        books=int((await self.session.execute(select(func.count()).select_from(Book))).scalar_one())
        documents=int((await self.session.execute(select(func.count()).select_from(Document))).scalar_one())
        processing=dict((await self.session.execute(select(Document.processing_status,func.count()).group_by(Document.processing_status))).all())
        ocr=dict((await self.session.execute(select(Document.ocr_status,func.count()).group_by(Document.ocr_status))).all())
        jobs=dict((await self.session.execute(select(DocumentIngestionJob.status,func.count()).group_by(DocumentIngestionJob.status))).all())
        return {"books":books,"documents":documents,"processing":{str(k):v for k,v in processing.items()},
                "ocr":{str(k):v for k,v in ocr.items()},"ingestion_jobs":{str(k):v for k,v in jobs.items()}}

    async def quizzes(self):
        rows=await self.session.execute(select(Quiz.status,func.count()).group_by(Quiz.status))
        status={str(k):v for k,v in rows.all()}
        attempts=int((await self.session.execute(select(func.count()).select_from(QuizAttempt).where(QuizAttempt.status.in_(COMPLETED_ATTEMPT_STATUSES)))).scalar_one())
        scores=list((await self.session.execute(select(QuizAttempt.percentage).where(QuizAttempt.status.in_(COMPLETED_ATTEMPT_STATUSES),QuizAttempt.percentage.is_not(None)))).scalars().all())
        passed=int((await self.session.execute(select(func.count()).select_from(QuizAttempt).where(QuizAttempt.status.in_(COMPLETED_ATTEMPT_STATUSES),QuizAttempt.passed.is_(True)))).scalar_one())
        return {"status":status,"total_attempts":attempts,"average_score":round(sum(scores)/len(scores),2) if scores else None,
                "pass_rate":round(100*passed/attempts,2) if attempts else None}

    async def learning(self):
        snapshots=await self._snapshots()
        dist={k:0 for k in ("NOT_STARTED","WEAK","NEEDS_REVIEW","DEVELOPING","MASTERED")}
        cov=[s["coverage"] for s in snapshots.values()]
        for s in snapshots.values():
            for c in s["chapters"]: dist[c["status"]]=dist.get(c["status"],0)+1
        weak=int((await self.session.execute(select(func.count()).select_from(WeakTopic).where(WeakTopic.status=="WEAK"))).scalar_one())
        review=await self.reviews()
        risk_service = InstructorAnalyticsService(self.session, self.settings)
        risks = [risk_service.risk(s)["level"] for s in snapshots.values()]
        return {"average_mastery":round(sum(s["overall_mastery"] for s in snapshots.values() if s["overall_mastery"] is not None)/max(1,len([s for s in snapshots.values() if s["overall_mastery"] is not None])),2) if snapshots else None,
                "average_coverage":round(sum(cov)/len(cov),2) if cov else 0,"mastery_distribution":dist,
                "weak_topics":weak,"risk_distribution":{k:risks.count(k) for k in ("HIGH","MEDIUM","LOW")},"review":review}

    async def reviews(self):
        total = int(
            (await self.session.execute(
                select(func.count()).select_from(ReviewSchedule)
            )).scalar_one()
        )

        completed = int(
            (await self.session.execute(
                select(func.count())
                .select_from(ReviewSchedule)
                .where(ReviewSchedule.status == "COMPLETED")
            )).scalar_one()
        )

        skipped = int(
            (await self.session.execute(
                select(func.count())
                .select_from(ReviewSchedule)
                .where(ReviewSchedule.status == "SKIPPED")
            )).scalar_one()
        )

        overdue = int(
            (await self.session.execute(
                select(func.count())
                .select_from(ReviewSchedule)
                .where(
                    ReviewSchedule.next_review_at <= datetime.now(timezone.utc),
                    ReviewSchedule.status != "COMPLETED",
                )
            )).scalar_one()
        )

        average_priority = float(
            (await self.session.execute(
                select(func.avg(ReviewSchedule.priority))
            )).scalar_one() or 0
        )

        completion_rate = round(
            100 * completed / max(1, completed + skipped),
            2,
        )

        return {
            "total": total,
            "completed": completed,
            "skipped": skipped,
            "overdue": overdue,
            "completion_rate": completion_rate,
            "average_priority": average_priority,
        }    
    

    async def activity(self,start:datetime|None,end:datetime|None,limit:int,offset:int):
        q=select(LearningHistory,User).join(StudentProfile,StudentProfile.id==LearningHistory.student_id).join(User,User.id==StudentProfile.user_id)
        clauses=self._date_filter(LearningHistory.created_at,start,end)
        if clauses:q=q.where(and_(*clauses))
        total=int((await self.session.execute(select(func.count()).select_from(LearningHistory).where(and_(*clauses) if clauses else True))).scalar_one())
        rows=(await self.session.execute(q.order_by(LearningHistory.created_at.desc()).offset(offset).limit(limit))).all()
        return [{"id":h.id,"student":u.full_name,"event":h.event_type,"timestamp":h.created_at,"event_data":h.event_data} for h,u in rows],total

    async def system_health(self):
        result = {
            "backend": {"status": "HEALTHY"},
            "database": {"status": "NOT_VERIFIED"},
            "redis": {"status": "NOT_VERIFIED"},
            "worker": {"status": "NOT_VERIFIED"},
            "ingestion": {"status": "NOT_VERIFIED"},
        }

        # Database health
        try:
            await self.session.execute(select(1))
            result["database"] = {"status": "HEALTHY"}
        except Exception:
            result["database"] = {"status": "UNHEALTHY"}

        # Redis health
        try:
            from redis.asyncio import Redis

            r = Redis.from_url(self.settings.redis_url)
            await r.ping()
            await r.aclose()

            result["redis"] = {"status": "HEALTHY"}
        except Exception:
            result["redis"] = {"status": "UNHEALTHY"}

        # Worker health is represented by Redis availability.
        if result["redis"]["status"] == "HEALTHY":
            result["worker"] = {"status": "HEALTHY"}
        else:
            result["worker"] = {"status": "UNHEALTHY"}

        # Ingestion health derives from current queue/job state.
        try:
            pending = int(
                (
                    await self.session.execute(
                        select(func.count())
                        .select_from(DocumentIngestionJob)
                        .where(
                            DocumentIngestionJob.status.in_(
                                ["QUEUED", "PROCESSING"]
                            )
                        )
                    )
                ).scalar_one()
            )

            result["ingestion"] = {
                "status": "ACTIVE" if pending else "IDLE",
                "pending_jobs": pending,
            }

        except Exception:
            result["ingestion"] = {
                "status": "UNAVAILABLE",
            }

        return result

    async def weak_topics(self, start=None, end=None):
        # Admin/global weak-topic aggregation is derived from current Prompt-7 persisted WeakTopic rows.
        q=select(WeakTopic.chapter_id,WeakTopic.subject_id,func.count().label("affected"),func.avg(WeakTopic.mastery_score).label("mastery"),func.avg(WeakTopic.priority).label("priority")).where(WeakTopic.status=="WEAK").group_by(WeakTopic.chapter_id,WeakTopic.subject_id).order_by(desc("affected"))
        rows=(await self.session.execute(q)).all()
        out=[]
        for r in rows:
            ch=await self.session.get(Chapter,r.chapter_id)
            if ch: out.append({"subject_id":r.subject_id,"chapter_id":r.chapter_id,"topic":ch.title,"affected_students":r.affected,"average_mastery":round(float(r.mastery),2),"average_priority":round(float(r.priority),2)})
        return out
