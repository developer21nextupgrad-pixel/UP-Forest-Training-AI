from __future__ import annotations
from datetime import datetime, timezone
from uuid import UUID
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import (
    User, StudentProfile, Enrollment, EnrollmentStatus, Subject, Chapter,
    LearningProgress, LearningHistory, Document, DocumentVersion, DocumentChunk,
    Book, ProcessingStatus,
)

class StudentService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def profile(self, user_id: UUID):
        user = await self.session.get(User, user_id)
        profile = (await self.session.execute(select(StudentProfile).where(StudentProfile.user_id == user_id))).scalar_one_or_none()
        if not user or not profile: raise LookupError("Student profile not found")
        return user, profile

    async def enrolled_subject_ids(self, student_id: UUID) -> list[UUID]:
        q = await self.session.execute(select(Enrollment.subject_id).where(
            Enrollment.student_id == student_id, Enrollment.status == EnrollmentStatus.ACTIVE
        ))
        return list(q.scalars().all())

    async def has_subject_access(self, student_id: UUID, subject_id: UUID) -> bool:
        return (await self.session.execute(select(Enrollment.id).where(
            Enrollment.student_id == student_id, Enrollment.subject_id == subject_id,
            Enrollment.status == EnrollmentStatus.ACTIVE
        ))).scalar_one_or_none() is not None

    async def subject_progress(self, student_id: UUID, subject_id: UUID) -> float:
        q = await self.session.execute(select(func.coalesce(func.avg(LearningProgress.completion_percentage), 0)).where(
            LearningProgress.student_id == student_id, LearningProgress.subject_id == subject_id
        ))
        return round(float(q.scalar_one() or 0), 2)

    async def subjects(self, student_id: UUID):
        """Return enrolled subjects with chapter counts and progress in one query."""
        rows = (
            await self.session.execute(
                select(
                    Subject,
                    func.count(func.distinct(Chapter.id)).label("chapter_count"),
                    func.coalesce(func.avg(LearningProgress.completion_percentage), 0).label("progress"),
                )
                .join(Enrollment, Enrollment.subject_id == Subject.id)
                .outerjoin(Chapter, (Chapter.subject_id == Subject.id) & Chapter.is_active.is_(True))
                .outerjoin(
                    LearningProgress,
                    (LearningProgress.chapter_id == Chapter.id)
                    & (LearningProgress.student_id == student_id),
                )
                .where(
                    Enrollment.student_id == student_id,
                    Enrollment.status == EnrollmentStatus.ACTIVE,
                    Subject.is_active.is_(True),
                )
                .group_by(Subject.id)
                .order_by(Subject.name)
            )
        ).all()
        return [(s, int(chapter_count or 0), round(float(progress or 0), 2)) for s, chapter_count, progress in rows]

    async def subject_detail(self, student_id: UUID, subject_id: UUID):
        if not await self.has_subject_access(student_id, subject_id): raise LookupError("Subject not found")
        subject=await self.session.get(Subject,subject_id)
        if not subject or not subject.is_active: raise LookupError("Subject not found")
        chapters=(await self.session.execute(select(Chapter).where(Chapter.subject_id==subject_id,Chapter.is_active.is_(True)).order_by(Chapter.order_index,Chapter.chapter_number))).scalars().all()
        progress=(await self.session.execute(select(LearningProgress).where(LearningProgress.student_id==student_id,LearningProgress.subject_id==subject_id))).scalars().all()
        pm={p.chapter_id:p for p in progress}
        return subject, chapters, pm

    async def chapter_access(self, student_id: UUID, chapter_id: UUID):
        row=(await self.session.execute(select(Chapter).where(Chapter.id==chapter_id,Chapter.is_active.is_(True)))).scalar_one_or_none()
        if not row or not await self.has_subject_access(student_id,row.subject_id): raise LookupError("Chapter not found")
        return row

    async def chapter_content(self, student_id: UUID, chapter_id: UUID, page: int, limit: int):
        chapter=await self.chapter_access(student_id,chapter_id)
        baseq=select(DocumentChunk, Book).join(Document,Document.id==DocumentChunk.document_id).join(Book,Book.id==Document.book_id).join(DocumentVersion,DocumentVersion.id==DocumentChunk.document_version_id).where(
            (DocumentChunk.chapter_id==chapter_id) | (Document.chapter_id==chapter_id), Document.archived_at.is_(None),
            Document.processing_status==ProcessingStatus.READY, DocumentVersion.is_current.is_(True)
        )
        total=int((await self.session.execute(select(func.count()).select_from(baseq.subquery()))).scalar_one())
        rows=(await self.session.execute(baseq.order_by(DocumentChunk.page_number,DocumentChunk.chunk_index).offset((page-1)*limit).limit(limit))).all()
        chapters=(await self.session.execute(select(Chapter.id).where(Chapter.subject_id==chapter.subject_id,Chapter.is_active.is_(True)).order_by(Chapter.order_index,Chapter.chapter_number))).scalars().all()
        idx=chapters.index(chapter_id)
        prev_id=chapters[idx-1] if idx>0 else None
        next_id=chapters[idx+1] if idx+1<len(chapters) else None
        return chapter, rows, total, prev_id, next_id

    async def record_event(self, student_id: UUID, event: str, subject_id: UUID|None=None, chapter_id: UUID|None=None, data: dict|None=None):
        self.session.add(LearningHistory(student_id=student_id,event_type=event,subject_id=subject_id,chapter_id=chapter_id,event_data=data))

    async def update_progress(self, student_id: UUID, chapter_id: UUID, completion: float, seconds: int):
        chapter=await self.chapter_access(student_id,chapter_id)
        now=datetime.now(timezone.utc)
        p=(await self.session.execute(select(LearningProgress).where(
            LearningProgress.student_id==student_id, LearningProgress.chapter_id==chapter_id
        ))).scalar_one_or_none()
        old_completed=bool(p and p.completion_percentage>=100)
        if not p:
            p=LearningProgress(student_id=student_id,subject_id=chapter.subject_id,chapter_id=chapter_id,completion_percentage=completion,time_spent=seconds,last_accessed_at=now)
            self.session.add(p)
        else:
            p.completion_percentage=max(float(p.completion_percentage),completion)
            p.time_spent=min(int(p.time_spent)+seconds, 31_536_000)
            p.last_accessed_at=now
        if not old_completed and p.completion_percentage>=100:
            self.session.add(LearningHistory(student_id=student_id,event_type="CHAPTER_COMPLETED",subject_id=chapter.subject_id,chapter_id=chapter_id,event_data=None))
        else:
            await self.record_event(student_id,"CHAPTER_OPENED",chapter.subject_id,chapter_id,{"completion_percentage":float(p.completion_percentage)})
        await self.session.commit(); await self.session.refresh(p)
        try:
            from app.core.config import get_settings
            from app.services.ingestion.queue import IngestionQueue
            queue = IngestionQueue(get_settings().redis_url)
            await queue.enqueue_progress_recalculate(student_id)
            await queue.close()
            from app.services.progress_intelligence import ProgressIntelligenceService
            await ProgressIntelligenceService(self.session, get_settings()).invalidate_cache(student_id)
        except Exception:
            # Redis is an optional accelerator; the synchronous source-of-truth
            # update must remain successful when the worker is unavailable.
            pass
        return p

    async def history(self, student_id: UUID, limit: int, offset: int):
        count=int((await self.session.execute(select(func.count()).select_from(LearningHistory).where(LearningHistory.student_id==student_id))).scalar_one())
        rows=(await self.session.execute(select(LearningHistory,Subject.name,Chapter.title).outerjoin(Subject,Subject.id==LearningHistory.subject_id).outerjoin(Chapter,Chapter.id==LearningHistory.chapter_id).where(LearningHistory.student_id==student_id).order_by(LearningHistory.created_at.desc()).offset(offset).limit(limit))).all()
        return rows,count

    async def dashboard(self, student_id: UUID):
        """Build the dashboard with bounded, set-based queries.

        The previous implementation called the subject-progress query once per
        subject and then added several full-student scans. This endpoint is on
        the critical landing path, so keep it to a small number of indexed
        queries and leave heavier mastery calculation to the worker/cache.
        """
        subjects = await self.subjects(student_id)
        ids = [s.id for s, _, _ in subjects]

        if ids:
            progress_stats = (
                await self.session.execute(
                    select(
                        func.count(LearningProgress.id),
                        func.coalesce(func.avg(LearningProgress.completion_percentage), 0),
                        func.coalesce(func.sum(LearningProgress.time_spent), 0),
                    ).where(
                        LearningProgress.student_id == student_id,
                        LearningProgress.subject_id.in_(ids),
                    )
                )
            ).one()
            completed = int(
                (
                    await self.session.execute(
                        select(func.count(LearningProgress.id)).where(
                            LearningProgress.student_id == student_id,
                            LearningProgress.subject_id.in_(ids),
                            LearningProgress.completion_percentage >= 100,
                        )
                    )
                ).scalar_one()
            )
            chapter_count = sum(chapters for _, chapters, _ in subjects)
        else:
            progress_stats = (0, 0, 0)
            completed = 0
            chapter_count = 0

        _, avg_progress, time_spent = progress_stats

        recent = (
            await self.session.execute(
                select(LearningHistory, Subject.name, Chapter.title)
                .outerjoin(Subject, Subject.id == LearningHistory.subject_id)
                .outerjoin(Chapter, Chapter.id == LearningHistory.chapter_id)
                .where(LearningHistory.student_id == student_id)
                .order_by(LearningHistory.created_at.desc())
                .limit(5)
            )
        ).all()

        q = (
            await self.session.execute(
                select(
                    LearningProgress,
                    Subject.name,
                    Chapter.title,
                )
                .join(Subject, Subject.id == LearningProgress.subject_id)
                .join(Chapter, Chapter.id == LearningProgress.chapter_id)
                .where(
                    LearningProgress.student_id == student_id,
                    LearningProgress.subject_id.in_(ids) if ids else False,
                    LearningProgress.completion_percentage < 100,
                )
                .order_by(LearningProgress.last_accessed_at.desc().nullslast())
                .limit(1)
            )
        ).first() if ids else None

        cont = None
        if q:
            p, sn, ct = q
            cont = {
                "subject_id": p.subject_id,
                "subject_name": sn,
                "chapter_id": p.chapter_id,
                "chapter_title": ct,
                "progress_percentage": float(p.completion_percentage),
            }
        elif subjects:
            subject = subjects[0][0]
            ch = (
                await self.session.execute(
                    select(Chapter)
                    .where(
                        Chapter.subject_id == subject.id,
                        Chapter.is_active.is_(True),
                    )
                    .order_by(Chapter.order_index, Chapter.chapter_number)
                    .limit(1)
                )
            ).scalar_one_or_none()
            if ch:
                cont = {
                    "subject_id": subject.id,
                    "subject_name": subject.name,
                    "chapter_id": ch.id,
                    "chapter_title": ch.title,
                    "progress_percentage": 0,
                }

        return (
            subjects,
            {
                "chapters": chapter_count,
                "completed": completed,
                "avg": round(float(avg_progress or 0), 2),
                "time": int(time_spent or 0),
            },
            cont,
            recent,
        )

