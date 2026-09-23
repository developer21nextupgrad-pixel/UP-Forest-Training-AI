import asyncio
from app.core.config import get_settings
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

async def main():
    settings = get_settings()

    print("Testing database connection...")
    print("Host:", settings.database_url.split("@")[-1])

    engine = create_async_engine(settings.database_url)

    try:
        async with engine.connect() as conn:
            result = await conn.execute(text("SELECT version()"))
            print("DATABASE CONNECTED ?")
            print(result.scalar())
    finally:
        await engine.dispose()

asyncio.run(main())
