from sqlalchemy import text

from fastapi import APIRouter

from app.core.config import get_settings
from app.core.constants import APP_VERSION
from app.db.session import get_engine
from app.schemas.response import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    database_status = "unavailable"
    try:
        async with get_engine().connect() as connection:
            await connection.execute(text("SELECT 1"))
        database_status = "ok"
    except Exception:
        # Health remains useful for local development when Postgres is not
        # running; production monitoring can inspect the dependency field.
        database_status = "unavailable"

    settings = get_settings()
    return HealthResponse(
        status="healthy",
        version=APP_VERSION,
        database=database_status,
        redis=None if not settings.redis_url else "not_checked",
    )
