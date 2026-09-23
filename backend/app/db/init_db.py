"""Database initialization helpers.

Production schema changes must be applied through Alembic. ``create_all`` is
provided only for isolated local/test bootstrap scenarios.
"""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncEngine

from app.db.base import Base
from app.models import *  # noqa: F401,F403


async def create_all(engine: AsyncEngine) -> None:
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
