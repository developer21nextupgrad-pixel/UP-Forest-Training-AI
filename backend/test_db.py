import asyncio
from sqlalchemy import text
from app.db.session import get_engine


async def main():
    engine = get_engine()

    async with engine.begin() as conn:
        result = await conn.execute(
            text("""
                SELECT EXISTS (
                    SELECT 1
                    FROM information_schema.tables
                    WHERE table_name = 'password_reset_tokens'
                )
            """)
        )

        print("password_reset_tokens exists:", result.scalar())

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
