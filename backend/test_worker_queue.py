import asyncio

from app.core.config import get_settings
from app.services.ingestion.queue import IngestionQueue


async def main():
    queue = IngestionQueue(get_settings().redis_url)

    print("Waiting for queue item...")

    queue_name, job_id = await queue.dequeue_any(timeout=10)

    print("QUEUE NAME:", queue_name)
    print("JOB ID:", job_id)

    await queue.close()


if __name__ == "__main__":
    asyncio.run(main())