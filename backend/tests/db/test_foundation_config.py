import importlib.util
from pathlib import Path

from app.core.config import get_settings


def test_database_configuration_is_environment_driven(monkeypatch):
    get_settings.cache_clear()
    monkeypatch.setenv(
        "DATABASE_URL",
        "postgresql+asyncpg://example:example@localhost:5432/up_forest",
    )
    settings = get_settings()
    assert settings.database_url.startswith("postgresql+asyncpg://")
    get_settings.cache_clear()


def test_alembic_initial_revision_exists():
    path = Path(__file__).parents[2] / "alembic" / "versions" / "0001_foundation.py"
    assert path.exists()
    assert "0001_foundation" in path.read_text(encoding="utf-8")
