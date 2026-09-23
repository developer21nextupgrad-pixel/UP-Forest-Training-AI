from pathlib import Path
from uuid import uuid4

import pytest

from app.models.enums import ProcessingStatus, IngestionStage, IngestionJobStatus
from app.services.ingestion.storage import LocalStorageProvider
from app.services.ingestion.text_processing import chunk_text, clean_text, detect_structure


def test_processing_lifecycle_contains_required_stages():
    assert ProcessingStatus.QUEUED.value == "QUEUED"
    assert ProcessingStatus.OCR_PROCESSING.value == "OCR_PROCESSING"
    assert ProcessingStatus.CHUNKING.value == "CHUNKING"
    assert ProcessingStatus.EMBEDDING.value == "EMBEDDING"
    assert ProcessingStatus.READY.value == "READY"


def test_chunking_overlap_and_small_text():
    text = "A " * 1000
    chunks = chunk_text(text, chunk_size=120, overlap=20)
    assert len(chunks) > 1
    assert all(len(x) <= 120 for x in chunks)
    assert chunks[0][-19:].strip() == chunks[1][:19].strip()


def test_cleaning_and_conservative_structure():
    text = "  CHAPTER 1\n\n\n  Forest Management  "
    assert clean_text(text) == "CHAPTER 1\n\nForest Management"
    assert detect_structure(text)[0] == "CHAPTER 1"


@pytest.mark.asyncio
async def test_local_storage_safe_key(tmp_path: Path):
    provider = LocalStorageProvider(str(tmp_path))
    doc_id = uuid4()
    key = await provider.save(document_id=doc_id, filename="../../unsafe.pdf", content=b"%PDF-test")
    assert key.startswith(f"documents/{doc_id}/original/")
    assert await provider.exists(key)
    assert await provider.get(key) == b"%PDF-test"
    await provider.delete(key)
    assert not await provider.exists(key)


def test_job_states():
    assert IngestionJobStatus.QUEUED.value == "QUEUED"
    assert IngestionStage.VECTOR_INDEXING.value == "VECTOR_INDEXING"
