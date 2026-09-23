from __future__ import annotations
from datetime import datetime, timezone
from uuid import UUID
import re
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import Quiz, Question, QuizOption, QuizAttempt, QuizAnswer, Subject, Chapter, Enrollment, EnrollmentStatus, StudentProfile, Document, DocumentVersion, ProcessingStatus, LearningHistory, AuditLog
from app.services.student_service import StudentService
from app.services.rag_retrieval import HybridRetriever
from app.services.rag_context import build_context
from app.services.rag_llm import LLMProvider, MistralLLMProvider
from app.core.config import Settings
from app.schemas.quiz import GeneratedQuestion

class QuizError(Exception): pass

def _norm(v: str) -> str:
    return re.sub(r"[^a-z0-9\u0900-\u097f]+", " ", v.lower()).strip()

class QuizService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def _validate_subject_chapter_scope(self, subject_id, chapter_id):
        subject = await self.session.get(Subject, subject_id)
        if not subject:
            raise QuizError("Subject not found")
        if chapter_id:
            chapter = await self.session.get(Chapter, chapter_id)
            if not chapter or chapter.subject_id != subject_id:
                raise QuizError("Chapter does not belong to subject")

    async def _scope(self, quiz_id: UUID, user_id: UUID, admin: bool):
        q = await self.session.get(Quiz, quiz_id)
        if not q: raise QuizError("Quiz not found")
        if not admin and q.created_by != user_id: raise QuizError("Quiz not found")
        return q

    async def validate_quiz(self, quiz: Quiz):
        if not quiz.title.strip(): raise QuizError("Title is required")
        if not quiz.subject_id: raise QuizError("Subject is required")
        subject = await self.session.get(Subject, quiz.subject_id)
        if not subject: raise QuizError("Subject not found")
        if quiz.chapter_id:
            ch = await self.session.get(Chapter, quiz.chapter_id)
            if not ch or ch.subject_id != quiz.subject_id: raise QuizError("Chapter does not belong to subject")
        questions = (await self.session.execute(select(Question).where(Question.quiz_id==quiz.id).order_by(Question.order_index))).scalars().all()
        if not questions: raise QuizError("Quiz needs at least one question")
        seen_q=set()
        for q in questions:
            nq=_norm(q.question_text)
            if not nq or nq in seen_q: raise QuizError("Duplicate or empty question")
            seen_q.add(nq)
            if q.points <= 0: raise QuizError("Question points must be positive")
            opts=(await self.session.execute(select(QuizOption).where(QuizOption.question_id==q.id).order_by(QuizOption.order_index))).scalars().all()
            if len(opts)<2: raise QuizError("Each question needs at least two options")
            if len({_norm(o.option_text) for o in opts}) != len(opts): raise QuizError("Duplicate options")
            if q.question_type == "MCQ_SINGLE" and sum(bool(o._is_correct_internal if hasattr(o,"_is_correct_internal") else False) for o in opts) != 1:
                # correctness is stored in DB only via a private attribute populated by service below
                correct=(await self.session.execute(select(QuizOption.id).where(QuizOption.question_id==q.id, QuizOption.is_correct.is_(True)))).scalars().all()
                if len(correct)!=1: raise QuizError("MCQ_SINGLE requires exactly one correct answer")
        return True

    async def create(self, data, user_id: UUID):
        await self._validate_subject_chapter_scope(
            data.subject_id,
            data.chapter_id,
        )
        q=Quiz(**data.model_dump(),created_by=user_id,status="DRAFT",is_published=False)
        self.session.add(q); await self.session.flush()
        self.session.add(AuditLog(user_id=user_id,action="QUIZ_CREATED",resource_type="quiz",resource_id=str(q.id),metadata_json={}))
        await self.session.commit(); await self.session.refresh(q); return q

    async def update(self, quiz_id, data, user_id, admin=False):
        q=await self._scope(quiz_id,user_id,admin)
        if q.status=="PUBLISHED" and await self.has_active_attempts(q.id):
            raise QuizError("Published quiz with active attempts cannot be edited")
        for k,v in data.model_dump(exclude_unset=True).items(): setattr(q,k,v)
        await self._validate_subject_chapter_scope(q.subject_id, q.chapter_id)
        q.status="DRAFT"; q.is_published=False
        await self.session.commit(); return q

    async def has_active_attempts(self, quiz_id):
        return (await self.session.execute(select(func.count()).select_from(QuizAttempt).where(QuizAttempt.quiz_id==quiz_id,QuizAttempt.status=="IN_PROGRESS"))).scalar_one()>0

    async def questions(self, quiz_id):
        qs=(await self.session.execute(select(Question).where(Question.quiz_id==quiz_id).order_by(Question.order_index))).scalars().all()
        return [(q,(await self.session.execute(select(QuizOption).where(QuizOption.question_id==q.id).order_by(QuizOption.order_index))).scalars().all()) for q in qs]

    async def add_question(self, quiz_id, data, user_id, admin=False):
        q=await self._scope(quiz_id,user_id,admin)
        if q.status!="DRAFT": raise QuizError("Only draft quizzes can be edited")
        if data.question_type!="MCQ_SINGLE": raise QuizError("Only MCQ_SINGLE is supported")
        if len({_norm(o.option_text) for o in data.options}) != len(data.options): raise QuizError("Duplicate options")
        correct=sum(o.is_correct for o in data.options)
        if correct!=1: raise QuizError("Exactly one correct option is required")
        nq=_norm(data.question_text)
        existing=await self.questions(quiz_id)
        if any(_norm(x.question_text)==nq for x,_ in existing): raise QuizError("Duplicate question")
        q=Question(quiz_id=quiz_id,question_text=data.question_text,question_type=data.question_type,difficulty=data.difficulty,explanation=data.explanation,points=data.points,order_index=data.order_index)
        self.session.add(q); await self.session.flush()
        for o in data.options:
            self.session.add(QuizOption(question_id=q.id,option_key=o.option_label,option_text=o.option_text,option_label=o.option_label,order_index=o.order_index))
            # set correctness after flush via separate lookup
        # set correct using labels
        for o in data.options:
            if o.is_correct:
                row=(await self.session.execute(select(QuizOption).where(QuizOption.question_id==q.id,QuizOption.option_label==o.option_label))).scalar_one()
                row._is_correct_internal=True
                # actual column exists in prior schema; ensure attribute set below
                row.is_correct=o.is_correct
        await self.session.commit(); return q

    async def publish(self, quiz_id,user_id,admin=False):
        q=await self._scope(quiz_id,user_id,admin)
        await self.validate_quiz(q)
        q.status="PUBLISHED"; q.is_published=True
        self.session.add(AuditLog(user_id=user_id,action="QUIZ_PUBLISHED",resource_type="quiz",resource_id=str(q.id),metadata_json={}))
        await self.session.commit(); return q

    async def archive(self, quiz_id,user_id,admin=False):
        q=await self._scope(quiz_id,user_id,admin)
        q.status="ARCHIVED"; q.is_published=False; q.is_active=False
        self.session.add(AuditLog(user_id=user_id,action="QUIZ_ARCHIVED",resource_type="quiz",resource_id=str(q.id),metadata_json={}))
        await self.session.commit(); return q

    async def accessible_quizzes(self, student_id):
        ids=(await self.session.execute(select(Enrollment.subject_id).where(Enrollment.student_id==student_id,Enrollment.status==EnrollmentStatus.ACTIVE))).scalars().all()
        if not ids: return []
        qs=(await self.session.execute(select(Quiz).where(Quiz.subject_id.in_(ids),Quiz.status=="PUBLISHED",Quiz.is_published.is_(True),Quiz.is_active.is_(True)).order_by(Quiz.created_at.desc()))).scalars().all()
        out=[]
        for q in qs:
            if q.chapter_id:
                ch=await self.session.get(Chapter,q.chapter_id)
                if not ch or not ch.is_active: continue
            out.append(q)
        return out

    async def student_access(self, student_id, quiz_id):
        q=await self.session.get(Quiz,quiz_id)
        if not q or q.status!="PUBLISHED" or not q.is_published: raise QuizError("Quiz not found")
        if not await StudentService(self.session).has_subject_access(student_id,q.subject_id): raise QuizError("Quiz not found")
        if q.chapter_id and not (await StudentService(self.session).chapter_access(student_id,q.chapter_id)): raise QuizError("Quiz not found")
        return q

    async def attempt_count(self, student_id, quiz_id):
        return int((await self.session.execute(select(func.count()).select_from(QuizAttempt).where(QuizAttempt.student_id==student_id,QuizAttempt.quiz_id==quiz_id,QuizAttempt.status.in_(["SUBMITTED","EXPIRED","ABANDONED"])))).scalar_one())

    async def start_attempt(self, student_id, quiz_id):
        q=await self.student_access(student_id,quiz_id)
        used=await self.attempt_count(student_id,quiz_id)
        if q.max_attempts and used>=q.max_attempts: raise QuizError("Maximum attempts reached")
        active=(await self.session.execute(select(QuizAttempt).where(QuizAttempt.student_id==student_id,QuizAttempt.quiz_id==quiz_id,QuizAttempt.status=="IN_PROGRESS"))).scalar_one_or_none()
        if active: return active
        a=QuizAttempt(quiz_id=quiz_id,student_id=student_id,status="IN_PROGRESS",started_at=datetime.now(timezone.utc))
        self.session.add(a); await self.session.flush()
        for qn, opts in await self.questions(quiz_id):
            self.session.add(QuizAnswer(attempt_id=a.id, question_id=qn.id, selected_option_id=None, question_snapshot={"text": qn.question_text, "points": qn.points, "options": [{"id": str(o.id), "label": o.option_label, "text": o.option_text} for o in opts]}))
        self.session.add(LearningHistory(student_id=student_id,event_type="QUIZ_STARTED",subject_id=q.subject_id,chapter_id=q.chapter_id,event_data={"quiz_id":str(q.id)}))
        await self.session.commit(); return a

    async def submit(self, student_id, attempt_id, answers):

        a = (
            await self.session.execute(
                select(QuizAttempt).where(
                    QuizAttempt.id == attempt_id,
                    QuizAttempt.student_id == student_id,
                )
            )
        ).scalar_one_or_none()

        if not a:
            raise QuizError("Attempt not found")

        if a.status != "IN_PROGRESS":
            raise QuizError("Attempt already finalized")

        q = await self.session.get(Quiz, a.quiz_id)

        now = datetime.now(timezone.utc)

        elapsed = (
            int((now - a.started_at).total_seconds())
            if a.started_at
            else 0
        )

        # ---------------------------------------------------------
        # Check time limit
        # ---------------------------------------------------------
        if q.time_limit_seconds and elapsed > q.time_limit_seconds:

            a.status = "EXPIRED"
            a.submitted_at = now
            a.completed_at = now
            a.time_taken_seconds = elapsed
            a.score = 0
            a.percentage = 0
            a.passed = False

            self.session.add(
                LearningHistory(
                    student_id=student_id,
                    event_type="QUIZ_FAILED",
                    subject_id=q.subject_id,
                    chapter_id=q.chapter_id,
                    event_data={
                        "quiz_id": str(q.id),
                        "attempt_id": str(a.id),
                        "reason": "EXPIRED",
                    },
                )
            )

            await self.session.commit()

            await self._refresh_progress_after_quiz_submission(student_id)

            return a

        # ---------------------------------------------------------
        # Load attempt answers explicitly
        # IMPORTANT:
        # Do NOT use a.answers here.
        # ---------------------------------------------------------
        answer_rows = (
            await self.session.execute(
                select(QuizAnswer).where(
                    QuizAnswer.attempt_id == a.id
                )
            )
        ).scalars().all()

        amap = {
            answer.question_id: answer
            for answer in answer_rows
        }

        total = 0
        score = 0

        # ---------------------------------------------------------
        # Process submitted answers
        # ---------------------------------------------------------
        for item in answers:

            if item.question_id not in amap:
                raise QuizError(
                    "Question does not belong to attempt"
                )

            ans = amap[item.question_id]

            snap = ans.question_snapshot or {}

            question = await self.session.get(
                Question,
                ans.question_id,
            )

            if not question or question.quiz_id != a.quiz_id:
                raise QuizError(
                    "Question does not belong to this quiz"
                )

            # -----------------------------------------------------
            # Load options for this question
            # -----------------------------------------------------
            options_result = await self.session.execute(
                select(QuizOption)
                .where(
                    QuizOption.question_id == question.id
                )
                .order_by(QuizOption.order_index)
            )

            db_options = options_result.scalars().all()

            options = {
                str(option.id): option
                for option in db_options
            }

            # -----------------------------------------------------
            # Validate selected option
            # -----------------------------------------------------
            if (
                item.selected_option_id
                and str(item.selected_option_id) not in options
            ):
                raise QuizError("Invalid option")

            # -----------------------------------------------------
            # Save selected answer
            # -----------------------------------------------------
            ans.selected_option_id = item.selected_option_id

            selected_option = (
                options.get(str(item.selected_option_id))
                if item.selected_option_id
                else None
            )

            ans.selected_option_label = (
                selected_option.option_label
                if selected_option
                else None
            )

            # -----------------------------------------------------
            # Check correct answer
            # -----------------------------------------------------
            correct_option = next(
                (
                    option
                    for option in db_options
                    if option.is_correct
                ),
                None,
            )

            ans.is_correct = bool(
                selected_option
                and correct_option
                and selected_option.id == correct_option.id
            )

            ans.points_awarded = (
                float(question.points)
                if ans.is_correct
                else 0.0
            )

        # ---------------------------------------------------------
        # Calculate total and score
        # IMPORTANT:
        # Use answer_rows instead of a.answers
        # ---------------------------------------------------------
        for ans in answer_rows:

            total += float(
                (ans.question_snapshot or {}).get(
                    "points",
                    0,
                )
            )

            score += float(
                ans.points_awarded or 0
            )

        # ---------------------------------------------------------
        # Calculate percentage and result
        # ---------------------------------------------------------
        pct = round(
            (score / total * 100)
            if total
            else 0,
            2,
        )

        passed = pct >= q.passing_score

        # ---------------------------------------------------------
        # Finalize attempt
        # ---------------------------------------------------------
        a.score = score
        a.percentage = pct
        a.passed = passed
        a.status = "SUBMITTED"
        a.submitted_at = now
        a.completed_at = now
        a.time_taken_seconds = elapsed

        # ---------------------------------------------------------
        # Learning history - submitted
        # ---------------------------------------------------------
        self.session.add(
            LearningHistory(
                student_id=student_id,
                event_type="QUIZ_SUBMITTED",
                subject_id=q.subject_id,
                chapter_id=q.chapter_id,
                event_data={
                    "quiz_id": str(q.id),
                    "attempt_id": str(a.id),
                    "percentage": pct,
                },
            )
        )

        # ---------------------------------------------------------
        # Learning history - passed / failed
        # ---------------------------------------------------------
        self.session.add(
            LearningHistory(
                student_id=student_id,
                event_type=(
                    "QUIZ_PASSED"
                    if passed
                    else "QUIZ_FAILED"
                ),
                subject_id=q.subject_id,
                chapter_id=q.chapter_id,
                event_data={
                    "quiz_id": str(q.id),
                    "attempt_id": str(a.id),
                    "percentage": pct,
                },
            )
        )

        # ---------------------------------------------------------
        # Commit
        # ---------------------------------------------------------
        await self.session.commit()

        # ---------------------------------------------------------
        # Recalculate progress / invalidate cache
        # ---------------------------------------------------------
        await self._refresh_progress_after_quiz_submission(student_id)

        return a

    async def _refresh_progress_after_quiz_submission(self, student_id: UUID) -> None:
        """Queue persistence and invalidate cached calculations independently."""
        from app.core.config import get_settings
        from app.services.progress_intelligence import ProgressIntelligenceService

        settings = get_settings()
        try:
            from app.services.ingestion.queue import IngestionQueue

            queue = IngestionQueue(settings.redis_url)
            try:
                await queue.enqueue_progress_recalculate(student_id)
            finally:
                await queue.close()
        except Exception:
            pass

        try:
            await ProgressIntelligenceService(
                self.session,
                settings,
            ).invalidate_cache(student_id)
        except Exception:
            pass

    async def result(self, student_id, attempt_id):
        a=(await self.session.execute(select(QuizAttempt).where(QuizAttempt.id==attempt_id,QuizAttempt.student_id==student_id))).scalar_one_or_none()
        if not a: raise QuizError("Attempt not found")
        if a.status not in ("SUBMITTED","EXPIRED"): raise QuizError("Result unavailable")
        return a, await self.questions(a.quiz_id)

class QuizGenerationService:
    async def create_job(self, req, user_id, redis_url):
        from app.models import QuizGenerationJob
        from app.services.ingestion.queue import IngestionQueue
        job=QuizGenerationJob(created_by=user_id,subject_id=req.subject_id,chapter_id=req.chapter_id,number_of_questions=req.number_of_questions,difficulty=req.difficulty,language=req.language,status="QUEUED")
        self.session.add(job); await self.session.commit(); await self.session.refresh(job)
        queue=IngestionQueue(redis_url)
        await queue.enqueue_quiz(job.id); await queue.close()
        return job

    def __init__(self, session: AsyncSession, settings: Settings, provider: LLMProvider|None=None):
        self.session=session; self.settings=settings; self.provider=provider or MistralLLMProvider(settings)
    async def generate(self, req, user_id):
        subject=await self.session.get(Subject,req.subject_id)
        if not subject: raise QuizError("Subject not found")
        if req.chapter_id:
            ch=await self.session.get(Chapter,req.chapter_id)
            if not ch or ch.subject_id!=req.subject_id: raise QuizError("Chapter does not belong to subject")
        filters={"subject_id":str(req.subject_id),"chapter_id":str(req.chapter_id) if req.chapter_id else None}
        results=await HybridRetriever(self.session,self.settings).search(f"Generate assessment for {subject.name}",filters)
        if not results: raise QuizError("Insufficient approved content")
        context,source_map=build_context(results[:self.settings.rag_context_top_k],self.settings.rag_max_context_chars)
        prompt = (
            f"Generate {req.number_of_questions} grounded MCQ questions in {req.language}.\\n"
            f"Difficulty: {req.difficulty}. Use ONLY the supplied context. Do not invent facts, choices, citations or explanations.\\n"
            "Return ONLY a JSON array. Each item must contain question, exactly four options with label/text, "
            "correct_option, explanation, difficulty and citations. Every question needs exactly one correct option "
            "and at least one valid source citation.\\nCONTEXT:\\n" + context
        )
        raw=await self.provider.generate(system="You are a Forest Department assessment author. Follow the supplied context only.",user=prompt)
        import json
        def parse_array(value: str):
            value=value.strip()
            if value.startswith("```"):
                value=value.replace("```json", "", 1).replace("```", "").strip()
            start, end=value.find("["), value.rfind("]")
            if start < 0 or end <= start:
                raise ValueError("LLM did not return a JSON array")
            return json.loads(value[start:end+1])
        try:
            data=parse_array(raw)
        except Exception as exc:
            repair=(
                "Return ONLY a valid JSON array matching the requested quiz schema. "
                "Use ONLY the supplied context; do not add facts or citations.\n"
                f"Previous response:\n{raw}\n"
            )
            repaired=await self.provider.generate(system="You repair grounded Forest Department quiz JSON.",user=repair)
            data=parse_array(repaired)
        validated=[GeneratedQuestion.model_validate(x) for x in data]
        quiz=Quiz(title=f"{subject.name} AI Assessment",description="AI-generated draft requiring human review",subject_id=req.subject_id,chapter_id=req.chapter_id,created_by=user_id,status="DRAFT",language=req.language,difficulty=req.difficulty,is_published=False)
        self.session.add(quiz); await self.session.flush()
        existing_rows=(await self.session.execute(
            select(Question.question_text).join(Quiz, Quiz.id == Question.quiz_id).where(
                Quiz.subject_id == req.subject_id,
                Quiz.chapter_id == req.chapter_id if req.chapter_id else Quiz.chapter_id.is_(None),
                Quiz.is_active.is_(True),
            )
        )).scalars().all()
        seen={_norm(x) for x in existing_rows}
        created_count=0
        for item in validated:
            nq=_norm(item.question)
            if nq in seen: continue
            seen.add(nq)
            valid_cits=[c for c in item.citations if c in source_map]
            if not valid_cits or len(item.options)!=4 or len({_norm(x.text) for x in item.options})<4 or item.correct_option not in {x.label for x in item.options}: continue
            src=source_map[valid_cits[0]]
            qq=Question(quiz_id=quiz.id,question_text=item.question,question_type="MCQ_SINGLE",difficulty=item.difficulty,explanation=item.explanation,points=1,order_index=created_count,source_document_id=UUID(src.document_id),source_document_version_id=UUID(src.document_version_id) if src.document_version_id else None,source_chunk_id=UUID(src.chunk_id) if src.chunk_id else None,source_page=src.page_number,source_metadata={"citations":valid_cits,"book_title":src.book_title,"chapter_title":src.chapter_title,"section_title":src.section_title,"chunk_id":src.chunk_id,"document_version_id":src.document_version_id})
            self.session.add(qq); await self.session.flush(); created_count += 1
            for i,o in enumerate(item.options):
                self.session.add(QuizOption(question_id=qq.id,option_key=o.label,option_text=o.text,option_label=o.label,order_index=i,is_correct=(o.label==item.correct_option)))
        self.session.add(AuditLog(user_id=user_id,action="QUIZ_GENERATED",resource_type="quiz",resource_id=str(quiz.id),metadata_json={"grounded":True}))
        await self.session.commit(); return quiz
