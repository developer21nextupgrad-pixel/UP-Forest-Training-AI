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
                    id,
                    file_name,
                    storage_key,
                    mime_type,
                    processing_status,
                    ocr_status
                FROM documents
                ORDER BY created_at DESC
                LIMIT 10;
            """)
        )

        for row in result:
            print(row)

    await engine.dispose()


asyncio.run(main())