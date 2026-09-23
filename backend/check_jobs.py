import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

DATABASE_URL = "postgresql+asyncpg://postgres:Aditya%4010937@127.0.0.1:5432/up_forest"


async def main():
    engine = create_async_engine(DATABASE_URL)

    async with engine.connect() as conn:
        result = await conn.execute(
            text("""
                SELECT
                    j.id,
                    j.status,
                    j.stage,
                    j.progress_percentage,
                    j.total_pages,
                    j.processed_pages,
                    j.total_chunks,
                    j.processed_chunks,
                    j.error_message,
                    d.file_name
                FROM document_ingestion_jobs j
                JOIN documents d ON d.id = j.document_id
                ORDER BY j.created_at DESC
                LIMIT 10;
            """)
        )

        for row in result:
            print(row)

    await engine.dispose()


asyncio.run(main())