from __future__ import annotations
from uuid import UUID
import re
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.dependencies import get_current_user, require_admin, require_instructor, require_student
from app.db.session import get_db_session
from app.models import User, UserRole, Quiz, Question, QuizOption, QuizAttempt, QuizAnswer
from app.schemas.quiz import *
from app.services.quiz_service import QuizService, QuizGenerationService, QuizError
from app.core.config import get_settings

router=APIRouter(prefix="/quizzes",tags=["quizzes"])

def qresp(q, count=0): return QuizResponse(id=q.id,title=q.title,description=q.description,subject_id=q.subject_id,chapter_id=q.chapter_id,created_by=q.created_by,status=q.status,language=q.language,difficulty=q.difficulty,time_limit_seconds=q.time_limit_seconds,passing_score=q.passing_score,max_attempts=q.max_attempts,is_published=q.is_published,question_count=count)

async def can_manage(user, quiz):
    return user.role==UserRole.ADMIN or quiz.created_by==user.id

@router.post("",response_model=QuizResponse)
async def create(data:QuizCreate,user=Depends(get_current_user),session:AsyncSession=Depends(get_db_session)):
    if user.role not in (UserRole.ADMIN,UserRole.INSTRUCTOR): raise HTTPException(403,"Insufficient permissions")
    try: q=await QuizService(session).create(data,user.id)
    except QuizError as e: raise HTTPException(400,str(e))
    return qresp(q)

@router.get("",response_model=list[QuizResponse])
async def list_quizzes(user=Depends(get_current_user),session:AsyncSession=Depends(get_db_session)):
    if user.role not in (UserRole.ADMIN,UserRole.INSTRUCTOR): raise HTTPException(403,"Insufficient permissions")
    stmt=select(Quiz)
    if user.role!=UserRole.ADMIN: stmt=stmt.where(Quiz.created_by==user.id)
    rows=(await session.execute(stmt.order_by(Quiz.created_at.desc()))).scalars().all()
    return [qresp(q,len((await QuizService(session).questions(q.id)))) for q in rows]

@router.get("/{quiz_id}",response_model=QuizResponse)
async def get_quiz(quiz_id:UUID,user=Depends(get_current_user),session:AsyncSession=Depends(get_db_session)):
    q=await session.get(Quiz,quiz_id)
    if not q or not await can_manage(user,q): raise HTTPException(404,"Quiz not found")
    return qresp(q,len(await QuizService(session).questions(q.id)))

@router.patch("/{quiz_id}",response_model=QuizResponse)
async def update(quiz_id:UUID,data:QuizUpdate,user=Depends(get_current_user),session:AsyncSession=Depends(get_db_session)):
    if user.role not in (UserRole.ADMIN,UserRole.INSTRUCTOR): raise HTTPException(403,"Insufficient permissions")
    try: q=await QuizService(session).update(quiz_id,data,user.id,user.role==UserRole.ADMIN)
    except QuizError as e: raise HTTPException(404 if "not found" in str(e).lower() else 400,str(e))
    return qresp(q)

@router.delete("/{quiz_id}")
async def delete(quiz_id:UUID,user=Depends(get_current_user),session:AsyncSession=Depends(get_db_session)):
    if user.role not in (UserRole.ADMIN,UserRole.INSTRUCTOR): raise HTTPException(403,"Insufficient permissions")
    try: q=await QuizService(session).archive(quiz_id,user.id,user.role==UserRole.ADMIN)
    except QuizError as e: raise HTTPException(404,str(e))
    return {"status":"ARCHIVED","quiz_id":str(q.id)}

@router.post("/{quiz_id}/publish",response_model=QuizResponse)
async def publish(quiz_id:UUID,user=Depends(get_current_user),session:AsyncSession=Depends(get_db_session)):
    if user.role not in (UserRole.ADMIN,UserRole.INSTRUCTOR): raise HTTPException(403,"Insufficient permissions")
    try:q=await QuizService(session).publish(quiz_id,user.id,user.role==UserRole.ADMIN)
    except QuizError as e:raise HTTPException(400,str(e))
    return qresp(q,len(await QuizService(session).questions(q.id)))

@router.post("/{quiz_id}/archive",response_model=QuizResponse)
async def archive(quiz_id:UUID,user=Depends(get_current_user),session:AsyncSession=Depends(get_db_session)):
    if user.role not in (UserRole.ADMIN,UserRole.INSTRUCTOR): raise HTTPException(403,"Insufficient permissions")
    try:q=await QuizService(session).archive(quiz_id,user.id,user.role==UserRole.ADMIN)
    except QuizError as e:raise HTTPException(404,str(e))
    return qresp(q)

@router.post("/{quiz_id}/questions",response_model=QuestionResponse)
async def add_question(quiz_id:UUID,data:QuestionCreate,user=Depends(get_current_user),session:AsyncSession=Depends(get_db_session)):
    if user.role not in (UserRole.ADMIN,UserRole.INSTRUCTOR): raise HTTPException(403,"Insufficient permissions")
    try:q=await QuizService(session).add_question(quiz_id,data,user.id,user.role==UserRole.ADMIN)
    except QuizError as e:raise HTTPException(400,str(e))
    opts=(await session.execute(select(QuizOption).where(QuizOption.question_id==q.id).order_by(QuizOption.order_index))).scalars().all()
    return QuestionResponse(id=q.id,question_text=q.question_text,question_type=q.question_type,difficulty=q.difficulty,explanation=q.explanation,points=q.points,order_index=q.order_index,options=[OptionResponse(id=o.id,option_text=o.option_text,option_label=o.option_label,order_index=o.order_index) for o in opts])

@router.patch("/questions/{question_id}",response_model=QuestionResponse)
async def update_question(question_id:UUID,data:QuestionUpdate,user=Depends(get_current_user),session:AsyncSession=Depends(get_db_session)):
    if user.role not in (UserRole.ADMIN,UserRole.INSTRUCTOR): raise HTTPException(403,"Insufficient permissions")
    q=await session.get(Question,question_id)
    if not q: raise HTTPException(404,"Question not found")
    quiz=await session.get(Quiz,q.quiz_id)
    if not quiz or not await can_manage(user,quiz): raise HTTPException(404,"Question not found")
    if quiz.status!="DRAFT": raise HTTPException(400,"Only draft quizzes can be edited")
    vals=data.model_dump(exclude_unset=True); opts=vals.pop("options",None)
    for k,v in vals.items(): setattr(q,k,v)
    if opts is not None:
        if sum(o["is_correct"] for o in opts)!=1: raise HTTPException(400,"Exactly one correct option is required")
        if len({re.sub(r"\\s+"," ",o["option_text"].strip().lower()) for o in opts})!=len(opts): raise HTTPException(400,"Duplicate options")
        old=(await session.execute(select(QuizOption).where(QuizOption.question_id==q.id))).scalars().all()
        for o in old: await session.delete(o)
        await session.flush()
        for o in opts:
            session.add(QuizOption(question_id=q.id,option_key=o["option_label"],option_text=o["option_text"],option_label=o["option_label"],order_index=o["order_index"],is_correct=o["is_correct"]))
    await session.commit()
    rows=(await session.execute(select(QuizOption).where(QuizOption.question_id==q.id).order_by(QuizOption.order_index))).scalars().all()
    return QuestionResponse(id=q.id,question_text=q.question_text,question_type=q.question_type,difficulty=q.difficulty,explanation=q.explanation,points=q.points,order_index=q.order_index,options=[OptionResponse(id=o.id,option_text=o.option_text,option_label=o.option_label,order_index=o.order_index) for o in rows])

@router.delete("/questions/{question_id}")
async def delete_question(question_id:UUID,user=Depends(get_current_user),session:AsyncSession=Depends(get_db_session)):
    if user.role not in (UserRole.ADMIN,UserRole.INSTRUCTOR): raise HTTPException(403,"Insufficient permissions")
    q=await session.get(Question,question_id)
    if not q: raise HTTPException(404,"Question not found")
    quiz=await session.get(Quiz,q.quiz_id)
    if not quiz or not await can_manage(user,quiz): raise HTTPException(404,"Question not found")
    if quiz.status!="DRAFT": raise HTTPException(400,"Only draft quizzes can be edited")
    await session.delete(q); await session.commit()
    return {"status":"deleted","question_id":str(question_id)}

@router.get("/{quiz_id}/questions",response_model=list[QuestionResponse])
async def questions(quiz_id:UUID,user=Depends(get_current_user),session:AsyncSession=Depends(get_db_session)):
    q=await session.get(Quiz,quiz_id)
    if not q or not await can_manage(user,q): raise HTTPException(404,"Quiz not found")
    out=[]
    for x,opts in await QuizService(session).questions(quiz_id):
        out.append(QuestionResponse(id=x.id,question_text=x.question_text,question_type=x.question_type,difficulty=x.difficulty,explanation=x.explanation,points=x.points,order_index=x.order_index,options=[OptionResponse(id=o.id,option_text=o.option_text,option_label=o.option_label,order_index=o.order_index) for o in opts]))
    return out

@router.post("/generate",response_model=GenerateQuizResponse)
async def generate(data:GenerateQuizRequest,user=Depends(get_current_user),session:AsyncSession=Depends(get_db_session)):
    if user.role not in (UserRole.ADMIN,UserRole.INSTRUCTOR): raise HTTPException(403,"Insufficient permissions")
    try: job=await QuizGenerationService(session,get_settings()).create_job(data,user.id,get_settings().redis_url)
    except Exception as e: raise HTTPException(400,str(e))
    return GenerateQuizResponse(job_id=job.id,status=job.status,generated_count=0)

@router.get("/generation/jobs/{job_id}",response_model=QuizGenerationJobResponse)
async def generation_job(job_id:UUID,user=Depends(get_current_user),session:AsyncSession=Depends(get_db_session)):
    from app.models import QuizGenerationJob
    job=await session.get(QuizGenerationJob,job_id)
    if not job or (user.role!=UserRole.ADMIN and job.created_by!=user.id): raise HTTPException(404,"Generation job not found")
    return QuizGenerationJobResponse(job_id=job.id,status=job.status,progress=job.progress,generated_count=job.generated_count,target_count=job.number_of_questions,error_message=job.error_message)

# Student endpoints
student_router=APIRouter(prefix="/student",tags=["student-quizzes"])

def squestion(q,opts):
    return StudentQuestionResponse(id=q.id,question_text=q.question_text,question_type=q.question_type,difficulty=q.difficulty,points=q.points,order_index=q.order_index,options=[OptionResponse(id=o.id,option_text=o.option_text,option_label=o.option_label,order_index=o.order_index) for o in opts])

async def student_quiz_response(q, student_id, session):
    svc=QuizService(session); used=await svc.attempt_count(student_id,q.id)
    best=(await session.execute(select(func.max(QuizAttempt.percentage)).where(QuizAttempt.student_id==student_id,QuizAttempt.quiz_id==q.id,QuizAttempt.status=="SUBMITTED"))).scalar_one()
    remaining=None if q.max_attempts is None else max(q.max_attempts-used,0)
    return StudentQuizResponse(**qresp(q,len(await svc.questions(q.id))).model_dump(),attempts_used=used,attempts_remaining=remaining,best_score=best)

@student_router.get("/quizzes",response_model=list[StudentQuizResponse])
async def student_quizzes(user=Depends(require_student),session:AsyncSession=Depends(get_db_session)):
    profile=(await session.execute(select(__import__("app.models",fromlist=["StudentProfile"]).StudentProfile).where(__import__("app.models",fromlist=["StudentProfile"]).StudentProfile.user_id==user.id))).scalar_one()
    out=[]
    for q in await QuizService(session).accessible_quizzes(profile.id): out.append(await student_quiz_response(q,profile.id,session))
    return out

@student_router.get("/quizzes/{quiz_id}",response_model=StudentQuizDetail)
async def student_quiz(quiz_id:UUID,user=Depends(require_student),session:AsyncSession=Depends(get_db_session)):
    from app.models import StudentProfile
    profile=(await session.execute(select(StudentProfile).where(StudentProfile.user_id==user.id))).scalar_one()
    try:q=await QuizService(session).student_access(profile.id,quiz_id)
    except QuizError: raise HTTPException(404,"Quiz not found")
    rows=await QuizService(session).questions(q.id)
    return StudentQuizDetail(quiz=await student_quiz_response(q,profile.id,session),questions=[squestion(x,o) for x,o in rows])

@student_router.post("/quizzes/{quiz_id}/attempts",response_model=StartAttemptResponse)
async def start(quiz_id:UUID,user=Depends(require_student),session:AsyncSession=Depends(get_db_session)):
    from app.models import StudentProfile
    profile=(await session.execute(select(StudentProfile).where(StudentProfile.user_id==user.id))).scalar_one()
    try:a=await QuizService(session).start_attempt(profile.id,quiz_id)
    except QuizError as e: raise HTTPException(400,str(e))
    rows=await QuizService(session).questions(quiz_id)
    return StartAttemptResponse(id=a.id,quiz_id=a.quiz_id,status=a.status,started_at=a.started_at,time_limit_seconds=(await session.get(Quiz,quiz_id)).time_limit_seconds,questions=[squestion(x,o) for x,o in rows])

@student_router.get("/attempts/{attempt_id}/questions",response_model=StartAttemptResponse)
async def attempt_questions(attempt_id:UUID,user=Depends(require_student),session:AsyncSession=Depends(get_db_session)):
    from app.models import StudentProfile
    profile=(await session.execute(select(StudentProfile).where(StudentProfile.user_id==user.id))).scalar_one()
    a=(await session.execute(select(QuizAttempt).where(QuizAttempt.id==attempt_id,QuizAttempt.student_id==profile.id))).scalar_one_or_none()
    if not a: raise HTTPException(404,"Attempt not found")
    q=await session.get(Quiz,a.quiz_id)
    if a.status!="IN_PROGRESS": raise HTTPException(409,"Attempt is no longer in progress")
    rows=await QuizService(session).questions(a.quiz_id)
    return StartAttemptResponse(id=a.id,quiz_id=a.quiz_id,status=a.status,started_at=a.started_at,time_limit_seconds=q.time_limit_seconds,questions=[squestion(x,o) for x,o in rows])

@student_router.post("/attempts/{attempt_id}/submit",response_model=QuizResultResponse)
async def submit(attempt_id:UUID,data:SubmitRequest,user=Depends(require_student),session:AsyncSession=Depends(get_db_session)):
    from app.models import StudentProfile
    profile=(await session.execute(select(StudentProfile).where(StudentProfile.user_id==user.id))).scalar_one()
    try:a=await QuizService(session).submit(profile.id,attempt_id,data.answers)
    except QuizError as e: raise HTTPException(400,str(e))
    return await build_result(a,profile.id,session)

async def build_result(a,student_id,session):
    q=await session.get(Quiz,a.quiz_id); rows={x.id:(x,o) for x,o in await QuizService(session).questions(a.quiz_id)}
    results=[]
    answers=(await session.execute(select(QuizAnswer).where(QuizAnswer.attempt_id==a.id))).scalars().all()
    for ans in answers:
        x,opts=rows[ans.question_id]; selected=next((o for o in opts if o.id==ans.selected_option_id),None); correct=next((o for o in opts if o.is_correct),None)
        results.append(QuestionResult(question_id=x.id,question_text=x.question_text,selected_option=OptionResponse(id=selected.id,option_text=selected.option_text,option_label=selected.option_label,order_index=selected.order_index) if selected else None,correct_option=OptionResponse(id=correct.id,option_text=correct.option_text,option_label=correct.option_label,order_index=correct.order_index) if correct else None,is_correct=bool(ans.is_correct),points_awarded=float(ans.points_awarded or 0),points_possible=x.points,explanation=x.explanation))
    return QuizResultResponse(attempt_id=a.id,quiz_id=a.quiz_id,status=a.status,score=float(a.score or 0),percentage=float(a.percentage or 0),passed=bool(a.passed),time_taken_seconds=int(a.time_taken_seconds or 0),results=results)

@student_router.get("/attempts/{attempt_id}",response_model=QuizResultResponse)
async def attempt(attempt_id:UUID,user=Depends(require_student),session:AsyncSession=Depends(get_db_session)):
    from app.models import StudentProfile
    profile=(await session.execute(select(StudentProfile).where(StudentProfile.user_id==user.id))).scalar_one()
    try:a,_=await QuizService(session).result(profile.id,attempt_id)
    except QuizError as e: raise HTTPException(404,str(e))
    return await build_result(a,profile.id,session)

@student_router.get("/quiz-history",response_model=list[QuizHistoryItem])
async def history(user=Depends(require_student),session:AsyncSession=Depends(get_db_session),limit:int=Query(20,ge=1,le=100),offset:int=Query(0,ge=0)):
    from app.models import StudentProfile
    profile=(await session.execute(select(StudentProfile).where(StudentProfile.user_id==user.id))).scalar_one()
    rows=(await session.execute(select(QuizAttempt,Quiz.title).join(Quiz,Quiz.id==QuizAttempt.quiz_id).where(QuizAttempt.student_id==profile.id).order_by(QuizAttempt.created_at.desc()).offset(offset).limit(limit))).all()
    out=[]
    for a,title in rows:
        num=int((await session.execute(select(func.count()).select_from(QuizAttempt).where(QuizAttempt.student_id==profile.id,QuizAttempt.quiz_id==a.quiz_id,QuizAttempt.created_at<=a.created_at))).scalar_one())
        out.append(QuizHistoryItem(attempt_id=a.id,quiz_id=a.quiz_id,quiz_title=title,attempt_number=num,score=a.score,percentage=a.percentage,passed=a.passed,status=a.status,submitted_at=a.submitted_at))
    return out
