"""In-memory rate limiters for paid external API calls."""

from __future__ import annotations

import asyncio
import time
from collections import defaultdict, deque
from functools import lru_cache


class RateLimiter:
    def __init__(
        self,
        *,
        max_requests: int,
        window_seconds: float,
    ) -> None:
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, *, key: str) -> bool:
        now = time.monotonic()
        hits = self._hits[key]

        while hits and now - hits[0] >= self.window_seconds:
            hits.popleft()

        if len(hits) >= self.max_requests:
            return False

        hits.append(now)
        return True


class PageRateLimiter:
    """
    O(1) amortized sliding-window page rate limiter.

    Mistral OCR limit:
        625 pages/minute

    Application safety limit:
        500 pages/minute
    """

    def __init__(
        self,
        *,
        max_pages: int = 500,
        window_seconds: float = 60.0,
    ) -> None:
        if max_pages <= 0:
            raise ValueError("max_pages must be > 0")

        if window_seconds <= 0:
            raise ValueError("window_seconds must be > 0")

        self.max_pages = max_pages
        self.window_seconds = window_seconds

        # (timestamp, pages)
        self._hits: deque[tuple[float, int]] = deque()

        # O(1) replacement for:
        # sum(count for _, count in self._hits)
        self._used_pages = 0

        self._lock = asyncio.Lock()

    def _remove_expired(self, now: float) -> None:
        """Remove expired entries in amortized O(1)."""

        while self._hits:
            timestamp, pages = self._hits[0]

            if now - timestamp < self.window_seconds:
                break

            self._hits.popleft()
            self._used_pages -= pages

    async def acquire(self, pages: int) -> None:
        """
        Wait until `pages` can be sent without exceeding the quota.
        """

        pages = max(1, pages)

        if pages > self.max_pages:
            raise ValueError(
                f"Batch contains {pages} pages, "
                f"but rate limiter maximum is {self.max_pages}."
            )

        while True:
            async with self._lock:
                now = time.monotonic()

                self._remove_expired(now)

                # O(1)
                if self._used_pages + pages <= self.max_pages:
                    self._hits.append((now, pages))
                    self._used_pages += pages
                    return

                oldest_timestamp = self._hits[0][0]

                wait_for = (
                    self.window_seconds
                    - (now - oldest_timestamp)
                )

            await asyncio.sleep(
                max(0.05, wait_for)
            )


@lru_cache(maxsize=1)
def get_rate_limiter() -> RateLimiter:
    from app.core.config import get_settings

    settings = get_settings()

    return RateLimiter(
        max_requests=settings.rate_limit_requests_per_minute,
        window_seconds=60.0,
    )


@lru_cache(maxsize=1)
def get_ocr_page_rate_limiter() -> PageRateLimiter:
    """
    Mistral OCR:
        Provider limit = 625 pages/minute
        Application limit = 500 pages/minute
    """

    return PageRateLimiter(
        max_pages=500,
        window_seconds=60.0,
    )