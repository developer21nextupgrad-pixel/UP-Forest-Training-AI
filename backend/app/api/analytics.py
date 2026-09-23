from __future__ import annotations

from datetime import datetime, timezone
from math import ceil
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_admin, require_instructor, require_student
from app.core.config import get_settings
from app.db.session import get_db_session
from app.models import (
    Chapter,
    Enrollment,
    EnrollmentStatus,
    InstructorProfile,
    StudentProfile,
    InstructorSubjectAssignment,
    LearningHistory,
    ReviewSchedule,
    Subject,
    User,
    UserRole,
)
from app.schemas.analytics import (
    ActivityResponse, AdminActivityResponse, AdminContentResponse,
    AdminDashboardResponse, AdminLearningResponse, AdminQuizResponse,
    AdminReviewsResponse, AdminUsersResponse, AssignmentRequest,
    AssignmentResponse, ChapterAnalyticsResponse, InstructorDashboardResponse,
    InstructorSummary, QuizAnalyticsListResponse, QuizAnalyticsResponse,
    StudentAnalyticsDetailResponse, StudentAnalyticsListResponse,
    SubjectAnalyticsResponse, SystemHealthResponse,
)
from app.services.analytics import (
    AdminAnalyticsService, AnalyticsScopeError, InstructorAnalyticsService,
)

router = APIRouter(tags=["Instructor & Admin Intelligence"])


def page_meta(page: int, page_size: int, total: int) -> dict:
    return {"page": page, "page_size": page_size, "total": total,
            "total_pages": max(1, ceil(total / page_size))}


def handle_scope(exc: Exception):
    # Do not reveal whether an unauthorized resource exists.
    raise HTTPException(status_code=404, detail=str(exc))


async def instructor_dashboard_data(user: User, session: AsyncSession):
    svc = InstructorAnalyticsService(session, get_settings())
    ids = await svc.assigned_subject_ids(user.id)
    students = await svc.scoped_students(user.id, ids)
    snapshots = await svc._bulk_snapshots(students, ids)
    risks = [(sid, svc.risk(s)) for sid, s in snapshots.items()]
    subjects = await svc.subject_overview(user.id)
    weak = await svc.weak_topics(user.id)
    active = int((await session.execute(
        select(func.count(func.distinct(LearningHistory.student_id)))
        .where(
            LearningHistory.student_id.in_(students or [UUID(int=0)]),
            LearningHistory.created_at >= datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0),
        )
    )).scalar_one())
    quiz_scores = [x for s in snapshots.values() for x in s["latest_scores"]]
    # Quiz completion here is completed attempts / assigned published quizzes * students,
    # bounded to the instructor's authorized subject scope.
    from app.models import Quiz, QuizAttempt
    quiz_count = int((await session.execute(
        select(func.count()).select_from(Quiz).where(
            Quiz.subject_id.in_(ids or [UUID(int=0)]),
            Quiz.status == "PUBLISHED", Quiz.is_published.is_(True), Quiz.is_active.is_(True)
        )
    )).scalar_one())
    attempts = int((await session.execute(
        select(func.count()).select_from(QuizAttempt).join(Quiz, Quiz.id == QuizAttempt.quiz_id)
        .where(
            QuizAttempt.student_id.in_(students or [UUID(int=0)]),
            QuizAttempt.status.in_(["SUBMITTED", "EXPIRED"]),
            Quiz.subject_id.in_(ids or [UUID(int=0)]),
        )
    )).scalar_one())
    expected = quiz_count * len(students)
    due = int((await session.execute(
        select(func.count()).select_from(ReviewSchedule).where(
            ReviewSchedule.student_id.in_(students or [UUID(int=0)]),
            ReviewSchedule.next_review_at <= datetime.now(timezone.utc)
        )
    )).scalar_one())
    risk_items = []
    for sid, r in risks:
        if r["level"] in {"HIGH", "MEDIUM"}:
            profile, u = (await session.execute(
                select(StudentProfile, User)
                .join(User, User.id == StudentProfile.user_id)
                .where(StudentProfile.id == sid)
            )).one()
            risk_items.append({
                "student_id": sid, "name": u.full_name,
                "mastery": snapshots[sid]["overall_mastery"], "coverage": snapshots[sid]["coverage"],
                "risk": r["level"], "risk_score": r["score"], "reasons": r["reasons"],
                "last_active": snapshots[sid]["last_activity"],
            })
    risk_items.sort(key=lambda x: (-x["risk_score"], x["name"]))
    activity_rows, _ = await svc.activity(user.id, start=datetime.now(timezone.utc)-__import__("datetime").timedelta(days=7), end=None, limit=10, offset=0)
    summary = InstructorSummary(
        students=len(students),
        active_students=active,
        average_mastery=round(sum(s["overall_mastery"] for s in snapshots.values() if s["overall_mastery"] is not None) / max(1, len([s for s in snapshots.values() if s["overall_mastery"] is not None])), 2) if snapshots else None,
        average_coverage=round(sum(s["coverage"] for s in snapshots.values()) / max(1, len(snapshots)), 2),
        quiz_completion=round(100 * attempts / expected, 2) if expected else None,
        average_quiz_score=round(sum(quiz_scores)/len(quiz_scores), 2) if quiz_scores else None,
        weak_topics=len(weak), at_risk_students=sum(1 for _, r in risks if r["level"]=="HIGH"), due_reviews=due,
    )
    return InstructorDashboardResponse(summary=summary, weak_topics=weak[:10], at_risk_students=risk_items[:10],
                                        subject_overview=subjects, recent_activity=activity_rows)


@router.get("/api/v1/instructor/dashboard", response_model=InstructorDashboardResponse)
async def instructor_dashboard(user: User = Depends(require_instructor), session: AsyncSession = Depends(get_db_session)):
    return await instructor_dashboard_data(user, session)


@router.get("/api/v1/instructor/students", response_model=StudentAnalyticsListResponse)
async def instructor_students(
    page:int=Query(1,ge=1), page_size:int=Query(25,ge=1,le=100),
    search:str|None=None, risk:str|None=None, min_mastery:float|None=Query(None,ge=0,le=100),
    max_mastery:float|None=Query(None,ge=0,le=100), sort:str="risk",
    subject_id:UUID|None=None, user:User=Depends(require_instructor),
    session:AsyncSession=Depends(get_db_session)
):
    try:
        items,total=await InstructorAnalyticsService(session,get_settings()).student_list(
            user.id,page=page,page_size=page_size,search=search,risk=risk,
            min_mastery=min_mastery,max_mastery=max_mastery,sort=sort,subject_id=subject_id)
    except AnalyticsScopeError as exc: handle_scope(exc)
    return StudentAnalyticsListResponse(items=items,**page_meta(page,page_size,total))


@router.get("/api/v1/instructor/students/{student_id}", response_model=StudentAnalyticsDetailResponse)
async def instructor_student(student_id:UUID,user:User=Depends(require_instructor),session:AsyncSession=Depends(get_db_session)):
    svc=InstructorAnalyticsService(session,get_settings())
    try: data=await svc.student_detail(user.id,student_id)
    except AnalyticsScopeError as exc: handle_scope(exc)
    snap=data["snapshot"]
    profile=data["profile"]; u=data["user"]
    weak=[{"topic":c["chapter_title"],"chapter_id":c["chapter_id"],"subject_id":c["subject_id"],"mastery":c["mastery"],"priority":c["review_priority"],"reason":c["explanation"]} for c in snap["chapters"] if c["status"]=="WEAK"]
    strong=[{"topic":c["chapter_title"],"chapter_id":c["chapter_id"],"mastery":c["mastery"],"coverage":c["coverage"],"evidence":c["evidence_count"]} for c in snap["chapters"] if c["status"]=="MASTERED"]
    allowed_subjects=await svc.assigned_subject_ids(user.id)
    reviews,_=await svc.progress.reviews(student_id,limit=100,offset=0,subject_ids=allowed_subjects)
    history=list((await session.execute(select(LearningHistory).where(LearningHistory.student_id==student_id,LearningHistory.subject_id.in_(allowed_subjects or [UUID(int=0)])).order_by(LearningHistory.created_at.desc()).limit(20))).scalars().all())
    return StudentAnalyticsDetailResponse(
        student={"id":student_id,"name":u.full_name,"email":u.email,"academy":profile.academy,"batch":profile.batch,"course":profile.course},
        subjects=snap["subjects"],chapters=snap["chapters"],weak_topics=weak,strong_topics=strong,
        reviews=[{"id": r.id, "topic": ch.title if ch is not None and getattr(ch, "title", None) else "Review", "status": st.value if hasattr(st, "value") else str(st), "priority": float(r.priority or 0), "next_review_at": r.next_review_at} for r, ch, st in reviews],
        recent_history=[{"id":h.id,"event":h.event_type,"timestamp":h.created_at,"event_data":h.event_data} for h in history],
        risk=data["risk"])


@router.get("/api/v1/instructor/subjects", response_model=SubjectAnalyticsResponse)
async def instructor_subjects(
    page:int=Query(1,ge=1), page_size:int=Query(50,ge=1,le=100), subject_id:UUID|None=None,
    user:User=Depends(require_instructor), session:AsyncSession=Depends(get_db_session)
):
    try: items=await InstructorAnalyticsService(session,get_settings()).subject_overview(user.id,subject_id)
    except AnalyticsScopeError as exc: handle_scope(exc)
    total=len(items); start=(page-1)*page_size
    return SubjectAnalyticsResponse(items=items[start:start+page_size],**page_meta(page,page_size,total))


@router.get("/api/v1/instructor/subjects/{subject_id}", response_model=SubjectAnalyticsResponse)
async def instructor_subject(subject_id:UUID,user:User=Depends(require_instructor),session:AsyncSession=Depends(get_db_session)):
    try: items=await InstructorAnalyticsService(session,get_settings()).subject_overview(user.id,subject_id)
    except AnalyticsScopeError as exc: handle_scope(exc)
    return SubjectAnalyticsResponse(items=items,page=1,page_size=1,total=len(items),total_pages=1)


@router.get("/api/v1/instructor/chapters/{chapter_id}", response_model=ChapterAnalyticsResponse)
async def instructor_chapter(chapter_id:UUID,user:User=Depends(require_instructor),session:AsyncSession=Depends(get_db_session)):
    try: data=await InstructorAnalyticsService(session,get_settings()).chapter(user.id,chapter_id)
    except AnalyticsScopeError as exc: handle_scope(exc)
    return ChapterAnalyticsResponse(chapter=data)


@router.get("/api/v1/instructor/weak-topics")
async def instructor_weak_topics(subject_id:UUID|None=None,user:User=Depends(require_instructor),session:AsyncSession=Depends(get_db_session)):
    try: return await InstructorAnalyticsService(session,get_settings()).weak_topics(user.id,subject_id)
    except AnalyticsScopeError as exc: handle_scope(exc)


@router.get("/api/v1/instructor/at-risk-students")
async def instructor_risk_students(user:User=Depends(require_instructor),session:AsyncSession=Depends(get_db_session)):
    svc=InstructorAnalyticsService(session,get_settings())
    items,total=await svc.student_list(user.id,page=1,page_size=100,risk="HIGH",min_mastery=None,max_mastery=None,sort="risk",subject_id=None)
    return {"items":items,"total":total}


@router.get("/api/v1/instructor/quizzes", response_model=QuizAnalyticsListResponse)
async def instructor_quizzes(
    page:int=Query(1,ge=1),page_size:int=Query(25,ge=1,le=100),search:str|None=None,subject_id:UUID|None=None,
    user:User=Depends(require_instructor),session:AsyncSession=Depends(get_db_session)
):
    try: rows,total=await InstructorAnalyticsService(session,get_settings()).quiz_list(user.id,page,page_size,search,subject_id)
    except AnalyticsScopeError as exc: handle_scope(exc)
    items=[{"id":q.id,"title":q.title,"subject_id":q.subject_id,"chapter_id":q.chapter_id,"status":q.status,"published":q.is_published} for q in rows]
    return QuizAnalyticsListResponse(items=items,**page_meta(page,page_size,total))


@router.get("/api/v1/instructor/quizzes/{quiz_id}/analytics", response_model=QuizAnalyticsResponse)
async def instructor_quiz_analytics(quiz_id:UUID,user:User=Depends(require_instructor),session:AsyncSession=Depends(get_db_session)):
    try: data=await InstructorAnalyticsService(session,get_settings()).quiz_analytics(user.id,quiz_id)
    except AnalyticsScopeError as exc: handle_scope(exc)
    return QuizAnalyticsResponse(analytics=data)


@router.get("/api/v1/instructor/activity", response_model=ActivityResponse)
async def instructor_activity(
    page:int=Query(1,ge=1),page_size:int=Query(25,ge=1,le=100),
    start:datetime|None=None,end:datetime|None=None,user:User=Depends(require_instructor),session:AsyncSession=Depends(get_db_session)
):
    if start and end and start>end: raise HTTPException(400,"start must be <= end")
    try: items,total=await InstructorAnalyticsService(session,get_settings()).activity(user.id,start=start,end=end,limit=page_size,offset=(page-1)*page_size)
    except AnalyticsScopeError as exc: handle_scope(exc)
    return ActivityResponse(items=items,**page_meta(page,page_size,total))


# Admin
@router.get("/api/v1/admin/dashboard", response_model=AdminDashboardResponse)
async def admin_dashboard(user:User=Depends(require_admin),session:AsyncSession=Depends(get_db_session)):
    return AdminDashboardResponse(**await AdminAnalyticsService(session,get_settings()).dashboard())


@router.get("/api/v1/admin/users", response_model=AdminUsersResponse)
async def admin_users(page:int=Query(1,ge=1),page_size:int=Query(25,ge=1,le=100),search:str|None=None,role:str|None=None,user:User=Depends(require_admin),session:AsyncSession=Depends(get_db_session)):
    items,total=await AdminAnalyticsService(session,get_settings()).users(page,page_size,search,role)
    data=[]
    student_ids_by_user = {}
    if items:
        prof_rows = await session.execute(
            select(StudentProfile.id, StudentProfile.user_id).where(
                StudentProfile.user_id.in_([x.id for x in items])
            )
        )
        student_ids_by_user = {uid: sid for sid, uid in prof_rows.all()}
    enrollment_counts = {}
    if student_ids_by_user:
        counts = await session.execute(
            select(Enrollment.student_id, func.count())
            .where(
                Enrollment.student_id.in_(list(student_ids_by_user.values())),
                Enrollment.status == EnrollmentStatus.ACTIVE,
            )
            .group_by(Enrollment.student_id)
        )
        enrollment_counts = dict(counts.all())
    for u in items:
        sid = student_ids_by_user.get(u.id)
        enroll = int(enrollment_counts.get(sid, 0)) if sid else 0
        data.append({"id":u.id,"name":u.full_name,"email":u.email,"role":u.role.value,"status":"ACTIVE" if u.is_active else "INACTIVE","last_login_at":u.last_login_at,"enrollment_count":enroll})
    return AdminUsersResponse(items=data,**page_meta(page,page_size,total))



@router.get("/api/v1/admin/content", response_model=AdminContentResponse)
async def admin_content(user:User=Depends(require_admin),session:AsyncSession=Depends(get_db_session)):
    return AdminContentResponse(content=await AdminAnalyticsService(session,get_settings()).content())


@router.get("/api/v1/admin/quizzes", response_model=AdminQuizResponse)
async def admin_quizzes(user:User=Depends(require_admin),session:AsyncSession=Depends(get_db_session)):
    return AdminQuizResponse(analytics=await AdminAnalyticsService(session,get_settings()).quizzes())


@router.get("/api/v1/admin/learning-analytics", response_model=AdminLearningResponse)
async def admin_learning(user:User=Depends(require_admin),session:AsyncSession=Depends(get_db_session)):
    return AdminLearningResponse(analytics=await AdminAnalyticsService(session,get_settings()).learning())


@router.get("/api/v1/admin/reviews", response_model=AdminReviewsResponse)
async def admin_reviews(user:User=Depends(require_admin),session:AsyncSession=Depends(get_db_session)):
    return AdminReviewsResponse(analytics=await AdminAnalyticsService(session,get_settings()).reviews())


@router.get("/api/v1/admin/activity", response_model=AdminActivityResponse)
async def admin_activity(page:int=Query(1,ge=1),page_size:int=Query(25,ge=1,le=100),start:datetime|None=None,end:datetime|None=None,user:User=Depends(require_admin),session:AsyncSession=Depends(get_db_session)):
    if start and end and start>end: raise HTTPException(400,"start must be <= end")
    items,total=await AdminAnalyticsService(session,get_settings()).activity(start,end,page_size,(page-1)*page_size)
    return AdminActivityResponse(items=items,**page_meta(page,page_size,total))


@router.get("/api/v1/admin/system-health", response_model=SystemHealthResponse)
async def admin_health(user:User=Depends(require_admin),session:AsyncSession=Depends(get_db_session)):
    return SystemHealthResponse(health=await AdminAnalyticsService(session,get_settings()).system_health())


@router.get("/api/v1/admin/weak-topics")
async def admin_weak_topics(user:User=Depends(require_admin),session:AsyncSession=Depends(get_db_session)):
    return {"items":await AdminAnalyticsService(session,get_settings()).weak_topics()}


@router.post("/api/v1/admin/instructors/{instructor_id}/subjects", response_model=AssignmentResponse)
async def assign_subject(instructor_id: UUID, payload: AssignmentRequest, user: User = Depends(require_admin), session: AsyncSession = Depends(get_db_session)):
    instructor_user = await session.get(User, instructor_id); profile = None
    if instructor_user:
        if instructor_user.role != UserRole.INSTRUCTOR: raise HTTPException(status_code=400, detail="User is not an instructor")
        profile = await session.scalar(select(InstructorProfile).where(InstructorProfile.user_id == instructor_user.id))
    else: profile = await session.get(InstructorProfile, instructor_id)
    if not profile: raise HTTPException(status_code=404, detail="Instructor profile not found")
    subject = await session.get(Subject, payload.subject_id)
    if not subject: raise HTTPException(status_code=404, detail="Subject not found")
    row = (await session.execute(select(InstructorSubjectAssignment).where(InstructorSubjectAssignment.instructor_id == profile.id, InstructorSubjectAssignment.subject_id == payload.subject_id))).scalar_one_or_none()
    if row: row.is_active = payload.active
    else: row = InstructorSubjectAssignment(instructor_id=profile.id, subject_id=payload.subject_id, is_active=payload.active); session.add(row)
    await session.commit(); await session.refresh(row); return AssignmentResponse(id=row.id, instructor_id=row.instructor_id, subject_id=row.subject_id, active=row.is_active)


@router.delete("/api/v1/admin/instructors/{instructor_id}/subjects/{subject_id}")
async def unassign_subject(instructor_id:UUID,subject_id:UUID,user:User=Depends(require_admin),session:AsyncSession=Depends(get_db_session)):
    row=(await session.execute(select(InstructorSubjectAssignment).where(
        InstructorSubjectAssignment.instructor_id==instructor_id,InstructorSubjectAssignment.subject_id==subject_id))).scalar_one_or_none()
    if not row: raise HTTPException(404,"Assignment not found")
    row.is_active=False; await session.commit()
    return {"message":"Subject assignment disabled"}
