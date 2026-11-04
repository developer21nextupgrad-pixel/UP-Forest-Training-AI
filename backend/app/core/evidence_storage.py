from __future__ import annotations

import tempfile
from pathlib import Path, PureWindowsPath

from app.core.config import Settings


class EvidenceStorageError(OSError):
    """Raised when the configured evidence directory cannot be used."""


def prepare_evidence_storage(settings: Settings) -> Path:
    upload_root = settings.upload_dir.resolve()
    evidence_dir = upload_root / "evidence"
    try:
        evidence_dir.mkdir(parents=True, exist_ok=True)
        resolved_evidence_dir = evidence_dir.resolve()
        resolved_evidence_dir.relative_to(upload_root)
        with tempfile.NamedTemporaryFile(
            prefix=".write-check-",
            dir=resolved_evidence_dir,
            delete=True,
        ):
            pass
    except (OSError, RuntimeError, ValueError) as exc:
        raise EvidenceStorageError(
            f"Configured evidence storage is not writable: {evidence_dir}"
        ) from exc
    return resolved_evidence_dir


def resolve_evidence_storage_path(storage_key: str, settings: Settings) -> Path:
    try:
        return _resolve_evidence_storage_path(storage_key, settings)
    except EvidenceStorageError:
        raise
    except (OSError, RuntimeError) as exc:
        raise EvidenceStorageError(
            "Evidence storage path cannot be resolved safely."
        ) from exc


def _resolve_evidence_storage_path(storage_key: str, settings: Settings) -> Path:
    if not storage_key or "\x00" in storage_key:
        raise EvidenceStorageError("Evidence storage key is invalid.")

    normalized_key = storage_key.replace("\\", "/")
    stored_path = Path(normalized_key)
    if any(part == ".." for part in normalized_key.split("/")):
        raise EvidenceStorageError("Evidence storage key contains path traversal.")

    upload_root = settings.upload_dir.resolve()
    configured_evidence_root = upload_root / "evidence"
    legacy_upload_root = (Path.cwd() / "uploads").resolve()
    legacy_evidence_root = legacy_upload_root / "evidence"
    candidate_roots = (
        (configured_evidence_root, upload_root),
        (legacy_evidence_root, Path.cwd().resolve()),
    )

    if stored_path.is_absolute():
        candidate = stored_path
    elif PureWindowsPath(normalized_key).is_absolute():
        raise EvidenceStorageError(
            "Evidence storage key uses an unauthorized absolute path."
        )
    elif normalized_key.startswith("uploads/evidence/"):
        candidate = legacy_evidence_root / Path(*normalized_key.split("/")[2:])
    elif normalized_key.startswith("evidence/"):
        candidate = configured_evidence_root / Path(*normalized_key.split("/")[1:])
    else:
        raise EvidenceStorageError(
            "Evidence storage key is outside an allowed evidence root."
        )

    resolved_candidate = candidate.resolve()
    for evidence_root, parent_root in candidate_roots:
        resolved_parent = parent_root.resolve()
        resolved_root = evidence_root.resolve()
        try:
            resolved_root.relative_to(resolved_parent)
            resolved_candidate.relative_to(resolved_root)
        except ValueError:
            continue
        if resolved_candidate != resolved_root:
            return resolved_candidate

    raise EvidenceStorageError(
        "Evidence storage key is outside an allowed evidence root."
    )
