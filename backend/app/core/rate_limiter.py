"""In-memory rate limiters for paid external API calls."""

from __future__ import annotations

import asyncio
import time
from collections import defaultdict, deque
from functools import lru_cache


class RateLimiter:
    def __init__(self, *, max_requests: int, window_seconds: float) -> None:
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        hits = self._hits[key]

        while hits and now - hits[0] > self.window_seconds:
            hits.popleft()

        if len(hits) >= self.max_requests:
            return False

        hits.append(now)
        return True


class PageRateLimiter:
    """Sliding-window limiter for APIs whose quota is measured in pages."""

    def __init__(self, *, max_pages: int, window_seconds: float = 60.0) -> None:
        self.max_pages = max_pages
        self.window_seconds = window_seconds
        self._hits: deque[tuple[float, int]] = deque()
        self._lock = asyncio.Lock()

    async def acquire(self, pages: int) -> None:
        """Wait until `pages` can be sent without exceeding the page quota."""

        pages = max(1, pages)

        while True:
            async with self._lock:
                now = time.monotonic()

                while (
                    self._hits
                    and now - self._hits[0][0] >= self.window_seconds
                ):
                    self._hits.popleft()

                used_pages = sum(count for _, count in self._hits)

                if used_pages + pages <= self.max_pages:
                    self._hits.append((now, pages))
                    return

                wait_for = self.window_seconds - (now - self._hits[0][0])

            await asyncio.sleep(max(0.1, wait_for))


@lru_cache
def get_rate_limiter() -> RateLimiter:
    from app.core.config import get_settings

    settings = get_settings()

    return RateLimiter(
        max_requests=settings.rate_limit_requests_per_minute,
        window_seconds=60.0,
    )


@lru_cache
def get_ocr_page_rate_limiter() -> PageRateLimiter:
    """Mistral OCR provider quota: 60 pages/minute."""

    return PageRateLimiter(
        max_pages=60,
        window_seconds=60.0,
    )