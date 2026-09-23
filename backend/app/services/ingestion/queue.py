from __future__ import annotations
import json
from uuid import UUID
from redis.asyncio import Redis

QUEUE_NAME = "up_forest:ingestion"
QUIZ_QUEUE_NAME = "up_forest:quiz_generation"
PROGRESS_QUEUE_NAME = "up_forest:progress_recalculate"

class IngestionQueue:
    def __init__(self, redis_url: str) -> None:
        self.redis = Redis.from_url(redis_url, decode_responses=True)

    async def enqueue(self, job_id: UUID) -> None:
        await self.redis.rpush(QUEUE_NAME, str(job_id))

    async def dequeue(self, timeout: int = 5) -> UUID | None:
        item = await self.redis.blpop(QUEUE_NAME, timeout=timeout)
        if not item:
            return None
        return UUID(item[1])

    async def enqueue_quiz(self, job_id: UUID) -> None:
        await self.redis.rpush(QUIZ_QUEUE_NAME, str(job_id))

    async def enqueue_progress_recalculate(self, student_id: UUID) -> None:
        await self.redis.rpush(PROGRESS_QUEUE_NAME, str(student_id))

    async def dequeue_any(self, timeout: int = 5):
        item = await self.redis.blpop([QUEUE_NAME, QUIZ_QUEUE_NAME, PROGRESS_QUEUE_NAME], timeout=timeout)
        if not item:
            return None, None
        return item[0], UUID(item[1])

    async def close(self) -> None:
        await self.redis.aclose()
