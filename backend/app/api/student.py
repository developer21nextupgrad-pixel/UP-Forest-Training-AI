from __future__ import annotations
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
import logging
import time
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.api.dependencies import require_student
from app.db.session import get_db_session
from app.models import User, StudentProfile
from app.schemas.student import *
from app.services.student_service import StudentService

router=APIRouter(prefix="/student",tags=["Student Learning"])
logger = logging.getLogger(__name__)

async def ctx(user: User, session: AsyncSession):
    profile=(await session.execute(select(StudentProfile).where(StudentProfile.user_id==user.id))).scalar_one_or_none()
    if not profile: raise HTTPException(409,"Student profile is not configured.")
    return profile

@router.get("/dashboard",response_model=DashboardResponse)
async def dashboard(user:User=Depends(require_student),session:AsyncSession=Depends(get_db_session)):
    started = time.perf_counter()
    p=await ctx(user,session); svc=StudentService(session)
    # rows,summary,cont,recent=await svc.dashboard(p.id)
    t = time.perf_counter()

    rows, summary, cont, recent = await svc.dashboard(p.id)

    logger.info(
        "TIMING student_service.dashboard = %.2f ms",
        (time.perf_counter() - t) * 1000,
    )
    logger.info("student.dashboard.base_ms=%.2f student_id=%s", (time.perf_counter()-started)*1000, p.id)
    def subj(x):
        s,n,prog=x; return StudentSubjectResponse(id=s.id,name=s.name,code=s.code,description=s.description,language=s.language,chapter_count=n,progress_percentage=prog)
    def hist(x):
        h,sn,ct=x; return LearningHistoryItem(id=h.id,event=h.event_type,subject_name=sn,chapter_title=ct,timestamp=h.created_at,event_data=h.event_data)
    from app.core.config import get_settings
    from app.services.progress_intelligence import ProgressIntelligenceService
    intelligence = ProgressIntelligenceService(session, get_settings())
    intelligence_started = time.perf_counter()
    # progress_data = await intelligence.get_or_calculate(p.id)
    t = time.perf_counter()

    progress_data = await intelligence.get_or_calculate(p.id)

    logger.info(
        "TIMING intelligence.get_or_calculate = %.2f ms",
        (time.perf_counter() - t) * 1000,
    )
    # due_rows, _ = await intelligence.daily_reviews(p.id)
    t = time.perf_counter()

    due_rows, _ = await intelligence.daily_reviews(p.id)

    logger.info(
        "TIMING intelligence.daily_reviews = %.2f ms",
        (time.perf_counter() - t) * 1000,
    )
    # recommendations = intelligence.recommendations_from_data(progress_data, due_rows)
    t = time.perf_counter()

    recommendations = intelligence.recommendations_from_data(
        progress_data,
        due_rows,
    )

    logger.info(
        "TIMING intelligence.recommendations = %.2f ms",
        (time.perf_counter() - t) * 1000,
    )
    logger.info(
        "student.dashboard.intelligence_ms=%.2f student_id=%s total_ms=%.2f",
        (time.perf_counter()-intelligence_started)*1000,
        p.id,
        (time.perf_counter()-started)*1000,
    )
    due_reviews = [
        {
            "review_id": str(schedule.id),
            "chapter_id": str(chapter.id),
            "chapter": chapter.title,
            "mastery": float(schedule.mastery_score),
            "priority": float(schedule.priority),
            "status": status,
            "next_review_at": schedule.next_review_at.isoformat() if schedule.next_review_at else None,
        }
        for schedule, chapter, status in due_rows
    ]
    weak_topics = [
        {
            "topic": x["chapter_title"],
            "chapter_id": str(x["chapter_id"]),
            "subject_id": str(x["subject_id"]),
            "mastery": x["mastery"],
            "priority": x["review_priority"],
            "reason": x["explanation"],
        }
        for x in progress_data["weak_topics"][:5]
    ]
    return DashboardResponse(
        student={"name":user.full_name,"preferred_language":user.preferred_language},
        summary=DashboardSummary(subjects=len(rows),chapters=summary["chapters"],completed_chapters=summary["completed"],overall_progress=summary["avg"],time_spent_seconds=summary["time"]),
        continue_learning=ContinueLearning(**cont) if cont else None,
        recent_activity=[hist(x) for x in recent],
        subjects=[subj(x) for x in rows],
        progress_summary=progress_data["overall"],
        mastery=progress_data["overall"]["mastery"],
        coverage=progress_data["overall"]["coverage"],
        weak_topics=weak_topics,
        due_reviews=due_reviews[:5],
        recommendations=recommendations,
    )

@router.get("/enrollments",response_model=list[EnrollmentResponse])
async def enrollments(user:User=Depends(require_student),session:AsyncSession=Depends(get_db_session)):
    p=await ctx(user,session)
    from app.models import Enrollment, LearningProgress, Subject, Chapter
    rows=(await session.execute(select(Enrollment,Subject).join(Subject,Subject.id==Enrollment.subject_id).where(Enrollment.student_id==p.id).order_by(Subject.name))).all()
    out=[]
    for e,s in rows:
        prog=await StudentService(session).subject_progress(p.id,s.id)
        out.append(EnrollmentResponse(id=e.id,subject_id=s.id,subject_name=s.name,subject_code=s.code,status=e.status.value,progress_percentage=prog))
    return out

@router.get("/subjects",response_model=list[StudentSubjectResponse])
async def subjects(user:User=Depends(require_student),session:AsyncSession=Depends(get_db_session)):
    p=await ctx(user,session); rows=await StudentService(session).subjects(p.id)
    return [StudentSubjectResponse(id=s.id,name=s.name,code=s.code,description=s.description,language=s.language,chapter_count=n,progress_percentage=prog) for s,n,prog in rows]

@router.get("/subjects/{subject_id}",response_model=SubjectDetailResponse)
async def subject_detail(subject_id:UUID,user:User=Depends(require_student),session:AsyncSession=Depends(get_db_session)):
    p=await ctx(user,session)
    try: s,chapters,pm=await StudentService(session).subject_detail(p.id,subject_id)
    except LookupError: raise HTTPException(404,"Subject not found")
    sp=await StudentService(session).subject_progress(p.id,s.id)
    items=[ChapterProgressResponse(id=c.id,title=c.title,chapter_number=c.chapter_number,order_index=c.order_index,description=c.description,progress_percentage=float(pm[c.id].completion_percentage) if c.id in pm else 0,completed=bool(c.id in pm and pm[c.id].completion_percentage>=100)) for c in chapters]
    last=max((p for p in pm.values() if p.last_accessed_at),key=lambda x:x.last_accessed_at,default=None)
    return SubjectDetailResponse(subject=StudentSubjectResponse(id=s.id,name=s.name,code=s.code,description=s.description,language=s.language,chapter_count=len(chapters),progress_percentage=sp),chapters=items,last_accessed_chapter_id=last.chapter_id if last else None)

@router.get("/chapters/{chapter_id}",response_model=ChapterContentResponse)
async def chapter(chapter_id:UUID,page:int=Query(1,ge=1),limit:int=Query(10,ge=1,le=50),user:User=Depends(require_student),session:AsyncSession=Depends(get_db_session)):
    p=await ctx(user,session); svc=StudentService(session)
    try: c,rows,total,prev_id,next_id=await svc.chapter_content(p.id,chapter_id,page,limit)
    except LookupError: raise HTTPException(404,"Chapter not found")
    await svc.record_event(p.id,"CHAPTER_OPENED",c.subject_id,c.id,None); await session.commit()
    items=[]
    for chunk,book in rows:
        items.append(ChapterContentItem(chunk_id=chunk.id,content=chunk.content,page_number=chunk.page_number,section_title=chunk.section_title,chapter_title=chunk.chapter_title,source=ContentSource(book_title=book.title,page_start=chunk.printed_page_start or chunk.page_number,page_end=chunk.printed_page_end or chunk.page_end,document_id=chunk.document_id)))
    return ChapterContentResponse(subject_id=c.subject_id,chapter_id=c.id,chapter_title=c.title,description=c.description,items=items,page=page,limit=limit,total=total,previous_chapter_id=prev_id,next_chapter_id=next_id)

@router.post("/chapters/{chapter_id}/progress",response_model=LearningProgressResponse)
async def progress(chapter_id:UUID,payload:ProgressUpdateRequest,user:User=Depends(require_student),session:AsyncSession=Depends(get_db_session)):
    p=await ctx(user,session)
    try: x=await StudentService(session).update_progress(p.id,chapter_id,payload.completion_percentage,payload.time_spent_seconds)
    except LookupError: raise HTTPException(404,"Chapter not found")
    return LearningProgressResponse(chapter_id=x.chapter_id,subject_id=x.subject_id,completion_percentage=float(x.completion_percentage),time_spent_seconds=x.time_spent,last_accessed_at=x.last_accessed_at)

@router.get("/history",response_model=LearningHistoryResponse)
async def history(limit:int=Query(20,ge=1,le=100),offset:int=Query(0,ge=0),user:User=Depends(require_student),session:AsyncSession=Depends(get_db_session)):
    p=await ctx(user,session); rows,total=await StudentService(session).history(p.id,limit,offset)
    return LearningHistoryResponse(items=[LearningHistoryItem(id=h.id,event=h.event_type,subject_name=sn,chapter_title=ct,timestamp=h.created_at,event_data=h.event_data) for h,sn,ct in rows],limit=limit,offset=offset,total=total)

@router.get("/profile",response_model=StudentProfileResponse)
async def profile(user:User=Depends(require_student),session:AsyncSession=Depends(get_db_session)):
    _,p=await StudentService(session).profile(user.id)
    return StudentProfileResponse(full_name=user.full_name,preferred_language=user.preferred_language,trainee_identifier=p.trainee_identifier,academy=p.academy,batch=p.batch,course=p.course)

@router.patch("/profile",response_model=StudentProfileResponse)
async def update_profile(payload:StudentProfileUpdate,user:User=Depends(require_student),session:AsyncSession=Depends(get_db_session)):
    _,p=await StudentService(session).profile(user.id)
    vals=payload.model_dump(exclude_unset=True)
    if "full_name" in vals: user.full_name=vals.pop("full_name")
    if "preferred_language" in vals: user.preferred_language=vals.pop("preferred_language")
    await session.commit()
    return StudentProfileResponse(full_name=user.full_name,preferred_language=user.preferred_language,trainee_identifier=p.trainee_identifier,academy=p.academy,batch=p.batch,course=p.course)
