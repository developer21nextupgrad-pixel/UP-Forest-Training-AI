from __future__ import annotations

import asyncio
import logging
import random

import httpx

from app.core.config import Settings

logger = logging.getLogger(__name__)
_semaphores: dict[tuple[int, int], asyncio.Semaphore] = {}


def _gate(limit: int) -> asyncio.Semaphore:
    loop = asyncio.get_running_loop()
    key = (id(loop), limit)
    return _semaphores.setdefault(key, asyncio.Semaphore(limit))


class EmbeddingProvider:
    async def embed(self, texts: list[str]) -> list[list[float]]:
        raise NotImplementedError


class MistralEmbeddingProvider(EmbeddingProvider):
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def _url(self) -> str:
        base = self.settings.mistral_base_url.rstrip("/")
        return f"{base}/v1/embeddings" if not base.endswith("/v1") else f"{base}/embeddings"

    async def _request(self, client: httpx.AsyncClient, batch: list[str]) -> list[list[float]]:
        url = self._url()
        headers = {"Authorization": f"Bearer {self.settings.mistral_api_key}"}
        payload = {"model": self.settings.rag_embedding_model, "input": batch}
        for attempt in range(self.settings.mistral_max_retries + 1):
            try:
                response = await client.post(url, headers=headers, json=payload)
                if response.status_code == 429 or 500 <= response.status_code < 600:
                    if attempt >= self.settings.mistral_max_retries:
                        response.raise_for_status()
                    retry_after = response.headers.get("Retry-After")
                    try:
                        wait = float(retry_after) if retry_after else self.settings.mistral_retry_base_seconds * (2 ** attempt)
                    except ValueError:
                        wait = self.settings.mistral_retry_base_seconds * (2 ** attempt)
                    wait += random.uniform(0, max(0.05, wait * 0.25))
                    logger.warning("Mistral embedding transient status=%s retry=%s wait=%.2fs", response.status_code, attempt + 1, wait)
                    await asyncio.sleep(wait)
                    continue
                response.raise_for_status()
                data = response.json().get("data", [])
                if len(data) != len(batch):
                    raise RuntimeError("Embedding service returned an incomplete response")
                vectors = [item["embedding"] for item in sorted(data, key=lambda x: x["index"])]
                dimensions = {len(v) for v in vectors}
                if len(dimensions) != 1:
                    raise RuntimeError("Embedding service returned inconsistent vector dimensions")
                return vectors
            except (httpx.TimeoutException, httpx.NetworkError) as exc:
                if attempt >= self.settings.mistral_max_retries:
                    raise RuntimeError("Embedding service request failed after bounded retries") from exc
                wait = self.settings.mistral_retry_base_seconds * (2 ** attempt) + random.uniform(0, 0.25)
                await asyncio.sleep(wait)
        raise RuntimeError("Embedding request exhausted retry budget")

    async def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        if not self.settings.is_mistral_configured:
            raise RuntimeError("MISTRAL_API_KEY is not configured")
        gate = _gate(self.settings.embedding_max_concurrency)
        async with gate:
            async with httpx.AsyncClient(timeout=self.settings.rag_embedding_timeout_seconds) as client:
                vectors: list[list[float]] = []
                for start in range(0, len(texts), self.settings.rag_embedding_batch_size):
                    vectors.extend(await self._request(client, texts[start:start + self.settings.rag_embedding_batch_size]))
                return vectors
