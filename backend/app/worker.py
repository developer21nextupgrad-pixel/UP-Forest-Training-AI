"""Minimal Redis-backed ingestion worker.

Run locally with:
    python -m app.worker
"""
from __future__ import annotations
import asyncio
import logging
from datetime import datetime, timedelta, timezone
from sqlalchemy import select

from app.core.config import get_settings
from app.db.session import get_session_factory
from app.services.ingestion.queue import IngestionQueue
from app.services.ingestion.service import IngestionService
from app.services.quiz_service import QuizGenerationService
from app.models import QuizGenerationJob, Question
from app.schemas.quiz import GenerateQuizRequest
from app.services.ingestion.queue import QUIZ_QUEUE_NAME, PROGRESS_QUEUE_NAME
from app.repositories.core import DocumentIngestionJobRepository

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ingestion-worker")

async def main() -> None:
    settings = get_settings()
    queue = IngestionQueue(settings.redis_url)
    logger.info("Ingestion worker started")
    try:
        while True:
            queue_name, job_id = await queue.dequeue_any(timeout=5)
            logger.info("QUEUE POLL RESULT | queue=%s | job_id=%s", queue_name, job_id)
            if job_id is None:
                async with get_session_factory()() as session:
                    stale_before = datetime.now(timezone.utc) - timedelta(seconds=settings.ingestion_job_timeout_seconds)
                    recoverable = await DocumentIngestionJobRepository(session).list_recoverable(stale_before=stale_before)
                    for job in recoverable:
                        await queue.enqueue(job.id)
                continue
            try:
                async with get_session_factory()() as session:
                    if queue_name == PROGRESS_QUEUE_NAME:
                        from app.services.progress_intelligence import ProgressIntelligenceService
                        await ProgressIntelligenceService(session, settings).recalculate_and_persist(job_id)
                    elif queue_name == QUIZ_QUEUE_NAME:
                        job = await session.get(QuizGenerationJob, job_id)
                        if job and job.status == "QUEUED":
                            job.status = "PROCESSING"; job.progress = 10
                            await session.commit()
                            req = GenerateQuizRequest(subject_id=job.subject_id, chapter_id=job.chapter_id, number_of_questions=job.number_of_questions, difficulty=job.difficulty, language=job.language)
                            try:
                                quiz = await QuizGenerationService(session, settings).generate(req, job.created_by)
                                job.status = "COMPLETE"; job.progress = 100
                                job.generated_count = int((await session.execute(select(Question.id).where(Question.quiz_id == quiz.id))).scalars().all().__len__())
                            except Exception as exc:
                                job.status = "FAILED"; job.error_message = str(exc)
                            await session.commit()
                    else:
                        logger.info("INGESTION START | job_id=%s", job_id)

                        await IngestionService(session, settings).process_job(job_id)

                        logger.info("INGESTION FINISHED | job_id=%s", job_id)
            except Exception:
                logger.exception("Worker failed job_id=%s", job_id)
    finally:
        await queue.close()

if __name__ == "__main__":
    asyncio.run(main())
