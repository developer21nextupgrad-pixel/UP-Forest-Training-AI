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
                    d.file_name,
                    d.processing_status,
                    d.ocr_status,
                    d.embedding_status,
                    COUNT(DISTINCT p.id) AS pages,
                    COUNT(DISTINCT c.id) AS chunks
                FROM documents d
                LEFT JOIN document_pages p
                    ON p.document_id = d.id
                LEFT JOIN document_chunks c
                    ON c.document_id = d.id
                GROUP BY
                    d.id,
                    d.file_name,
                    d.processing_status,
                    d.ocr_status,
                    d.embedding_status
                ORDER BY d.created_at DESC;
            """)
        )

        for row in result:
            print(row)

    await engine.dispose()


asyncio.run(main())