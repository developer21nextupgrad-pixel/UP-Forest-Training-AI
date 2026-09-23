from __future__ import annotations
from pathlib import Path
from uuid import UUID
import os
import secrets

class StorageProvider:
    async def save(self, *, document_id: UUID, filename: str, content: bytes) -> str:
        raise NotImplementedError
    async def get(self, storage_key: str) -> bytes:
        raise NotImplementedError
    async def delete(self, storage_key: str) -> None:
        raise NotImplementedError
    async def exists(self, storage_key: str) -> bool:
        raise NotImplementedError


class LocalStorageProvider(StorageProvider):
    def __init__(self, root: str) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        root = self.root.resolve()
        path = (self.root / key).resolve()
        if root != path and root not in path.parents:
            raise ValueError("Invalid storage key")
        return path

    async def save(self, *, document_id: UUID, filename: str, content: bytes) -> str:
        suffix = Path(filename).suffix.lower()
        safe_name = f"{secrets.token_hex(12)}{suffix}"
        key = f"documents/{document_id}/original/{safe_name}"
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return key

    async def get(self, storage_key: str) -> bytes:
        return self._path(storage_key).read_bytes()

    async def delete(self, storage_key: str) -> None:
        path = self._path(storage_key)
        if path.exists():
            path.unlink()

    async def exists(self, storage_key: str) -> bool:
        return self._path(storage_key).exists()


def get_storage_provider(root: str) -> StorageProvider:
    return LocalStorageProvider(root)
