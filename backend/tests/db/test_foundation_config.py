from pathlib import Path

import pytest
from pydantic import ValidationError

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


def test_upload_dir_defaults_to_existing_local_location():
    from app.core.config import Settings

    settings = Settings(_env_file=None)
    assert settings.upload_dir == Path("uploads")


def test_production_upload_dir_must_be_absolute_and_can_be_configured(tmp_path):
    from app.core.config import Settings

    settings = Settings(
        _env_file=None,
        environment="production",
        vector_store="pgvector",
        upload_dir=tmp_path / "uploads",
    )
    assert settings.upload_dir == tmp_path / "uploads"

    with pytest.raises(ValidationError, match="UPLOAD_DIR must be an absolute"):
        Settings(
            _env_file=None,
            environment="production",
            vector_store="pgvector",
            upload_dir="uploads",
        )


def test_upload_dir_reads_upload_dir_environment_variable(monkeypatch, tmp_path):
    from app.core.config import Settings

    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path / "configured-uploads"))
    settings = Settings(_env_file=None)
    assert settings.upload_dir == tmp_path / "configured-uploads"


def test_evidence_storage_rejects_an_unusable_directory(tmp_path):
    from app.core.config import Settings
    from app.core.evidence_storage import EvidenceStorageError, prepare_evidence_storage

    blocked_parent = tmp_path / "not-a-directory"
    blocked_parent.write_text("block storage", encoding="utf-8")
    settings = Settings(_env_file=None, upload_dir=blocked_parent)

    with pytest.raises(EvidenceStorageError, match="not writable"):
        prepare_evidence_storage(settings)


def test_evidence_storage_path_supports_new_and_legacy_keys(tmp_path):
    from app.core.config import Settings
    from app.core.evidence_storage import resolve_evidence_storage_path

    settings = Settings(_env_file=None, upload_dir=tmp_path / "configured-uploads")

    assert resolve_evidence_storage_path("evidence/photo.jpg", settings) == (
        tmp_path / "configured-uploads" / "evidence" / "photo.jpg"
    )
    assert resolve_evidence_storage_path(
        "uploads/evidence/legacy.jpg",
        settings,
    ) == (Path.cwd() / "uploads" / "evidence" / "legacy.jpg").resolve()


def test_evidence_storage_rejects_traversal_and_external_absolute_paths(tmp_path):
    from app.core.config import Settings
    from app.core.evidence_storage import (
        EvidenceStorageError,
        resolve_evidence_storage_path,
    )

    upload_dir = tmp_path / "configured-uploads"
    settings = Settings(_env_file=None, upload_dir=upload_dir)

    with pytest.raises(EvidenceStorageError, match="traversal"):
        resolve_evidence_storage_path("evidence/../outside.jpg", settings)

    with pytest.raises(EvidenceStorageError, match="traversal"):
        resolve_evidence_storage_path("../uploads/evidence/outside.jpg", settings)

    outside_path = tmp_path / "private" / "evidence.jpg"
    with pytest.raises(EvidenceStorageError, match="outside an allowed"):
        resolve_evidence_storage_path(str(outside_path), settings)

    allowed_absolute_path = upload_dir / "evidence" / "existing.jpg"
    assert resolve_evidence_storage_path(str(allowed_absolute_path), settings) == (
        allowed_absolute_path.resolve()
    )


def test_evidence_storage_rejects_symlink_escape(tmp_path):
    from app.core.config import Settings
    from app.core.evidence_storage import (
        EvidenceStorageError,
        resolve_evidence_storage_path,
    )

    upload_dir = tmp_path / "configured-uploads"
    evidence_dir = upload_dir / "evidence"
    evidence_dir.mkdir(parents=True)
    outside_dir = tmp_path / "outside"
    outside_dir.mkdir()
    escape_link = evidence_dir / "linked"
    try:
        escape_link.symlink_to(outside_dir, target_is_directory=True)
    except (OSError, NotImplementedError) as exc:
        pytest.skip(f"Symlink creation is unavailable: {exc}")

    settings = Settings(_env_file=None, upload_dir=upload_dir)
    with pytest.raises(EvidenceStorageError, match="outside an allowed"):
        resolve_evidence_storage_path("evidence/linked/photo.jpg", settings)


def test_alembic_initial_revision_exists():
    path = Path(__file__).parents[2] / "alembic" / "versions" / "0001_foundation.py"
    assert path.exists()
    assert "0001_foundation" in path.read_text(encoding="utf-8")
