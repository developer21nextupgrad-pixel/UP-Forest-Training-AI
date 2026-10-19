"""OCR service — the only module that talks to Mistral's OCR API (ADR 0001).

Verified against ``mistralai==2.9.1``'s actual SDK surface (not guessed):
``client.ocr.process_async(model=..., document=...)`` returns an
``OCRResponse`` whose ``.pages`` is a list of ``OCRPageObject``, each with a
``.markdown`` field.

Documents are passed as base64 data URIs keyed by ``document_url`` (PDF) or
``image_url`` (image).

Book-scale PDFs are OCR'd in page batches (``extract_text_batched``) instead
of one call, using ``process_async(..., pages=[...])``.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import random
import re
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from io import BytesIO
from typing import Literal

from mistralai.client import Mistral
from mistralai.client.models.documenturlchunk import DocumentURLChunk
from mistralai.client.models.imageurlchunk import ImageURLChunk
from pypdf import PdfReader, PdfWriter
from pypdf.errors import PdfReadError

from app.core.config import Settings
from app.core.exceptions import (
    MistralRateLimitError,
    MistralServiceError,
    MistralTimeoutError,
)
from app.core.mistral_client import get_mistral_client
from app.core.rate_limiter import get_ocr_page_rate_limiter


logger = logging.getLogger(__name__)


_MARKDOWN_NOISE = re.compile(
    r"(?:!\[[^\]]*\]\([^)]*\)|\[([^\]]*)\]\([^)]*\)|[#>*_`~-])"
)


def _markdown_to_plain_text(markdown: str) -> str:
    """Lightweight strip — good enough for a 'Plain Text' tab, not a full parser."""
    without_links_and_images = _MARKDOWN_NOISE.sub(
        lambda m: m.group(1) or "",
        markdown,
    )
    return re.sub(r"\n{3,}", "\n\n", without_links_and_images).strip()


@dataclass(frozen=True, slots=True)
class OcrPage:
    index: int
    markdown: str
    plain_text: str


@dataclass(frozen=True, slots=True)
class OcrResult:
    filename: str
    pages: int
    markdown: str
    plain_text: str
    processing_time: float
    model: str
    page_contents: list[OcrPage]
    failed_pages: list[int] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class OcrProgressEvent:
    kind: Literal["total_pages", "progress", "done"]
    total_pages: int | None = None
    pages_done: int | None = None

    # Sorted 0-based page indices completed so far.
    completed_pages: list[int] | None = None

    result: OcrResult | None = None
    failed_pages: list[int] | None = None


def compute_page_batches(
    total_pages: int,
    batch_size: int,
) -> list[list[int]]:
    """Split [0, total_pages) into contiguous page-index batches."""
    return [
        list(range(start, min(start + batch_size, total_pages)))
        for start in range(0, total_pages, batch_size)
    ]


async def extract_text(
    *,
    filename: str,
    content_type: str,
    content: bytes,
    settings: Settings,
) -> OcrResult:
    """OCR a single image/PDF request."""
    client = get_mistral_client()

    encoded = base64.b64encode(content).decode("ascii")
    data_uri = f"data:{content_type};base64,{encoded}"

    document: DocumentURLChunk | ImageURLChunk = (
        DocumentURLChunk(document_url=data_uri)
        if content_type == "application/pdf"
        else ImageURLChunk(image_url=data_uri)
    )

    start = time.perf_counter()

    try:
        response = await asyncio.wait_for(
            client.ocr.process_async(
                model=settings.ocr_model,
                document=document,
            ),
            timeout=settings.ocr_timeout_seconds,
        )
    except TimeoutError as exc:
        raise MistralTimeoutError("Processing timeout") from exc
    except Exception as exc:
        if _exception_status(exc) == 429:
            raise MistralRateLimitError(
                "Mistral OCR rate limit exceeded.",
                retry_after=_retry_after(exc),
            ) from exc

        raise MistralServiceError(
            "Unable to process your file. Please try again."
        ) from exc

    processing_time = time.perf_counter() - start

    pages = response.pages or []
    markdown = "\n\n".join(page.markdown for page in pages)

    if not markdown.strip():
        raise MistralServiceError("No text detected in this document.")

    page_contents = [
        OcrPage(
            index=page.index,
            markdown=page.markdown,
            plain_text=_markdown_to_plain_text(page.markdown),
        )
        for page in pages
    ]

    return OcrResult(
        filename=filename,
        pages=len(pages),
        markdown=markdown,
        plain_text=_markdown_to_plain_text(markdown),
        processing_time=processing_time,
        model=settings.ocr_model,
        page_contents=page_contents,
    )


def _exception_status(exc: Exception | None) -> int | None:
    """Extract an HTTP status code from common SDK exception shapes."""
    if exc is None:
        return None

    for obj in (
        exc,
        getattr(exc, "response", None),
        getattr(exc, "error", None),
    ):
        value = getattr(obj, "status_code", None) if obj is not None else None

        if isinstance(value, int):
            return value

    return None


def _retry_after(exc: Exception) -> float | None:
    """Read Retry-After from an SDK exception when available."""
    for obj in (
        exc,
        getattr(exc, "response", None),
    ):
        headers = getattr(obj, "headers", None) if obj is not None else None

        if headers:
            value = headers.get("Retry-After")

            if value:
                try:
                    return float(value)
                except (TypeError, ValueError):
                    pass

    return None


def _retryable_ocr_exception(exc: Exception) -> bool:
    """Return whether a non-rate-limit OCR error may be retried."""
    status = _exception_status(exc)

    return (
        isinstance(exc, (TimeoutError, asyncio.TimeoutError))
        or (
            status is not None
            and 500 <= status < 600
        )
    )


async def _ocr_one_batch(
    client: Mistral,
    reader: PdfReader,
    batch_indices: list[int],
    settings: Settings,
) -> tuple[list[OcrPage], list[int]]:
    """OCR one PDF page batch with rate limiting and retry/backoff.

    429 rate-limit errors are retried with exponential backoff and jitter.
    Other retryable errors (timeouts / 5xx) are also retried.
    """

    # ---------------------------------------------------------
    # 1. Build PDF containing only this batch's pages
    # ---------------------------------------------------------
    writer = PdfWriter()

    for page_index in batch_indices:
        writer.add_page(reader.pages[page_index])

    batch_buffer = BytesIO()
    writer.write(batch_buffer)

    batch_encoded = base64.b64encode(
        batch_buffer.getvalue()
    ).decode("ascii")

    batch_data_uri = (
        f"data:application/pdf;base64,{batch_encoded}"
    )

    last_exc: Exception | None = None

    # ---------------------------------------------------------
    # 2. OCR request + retry loop
    # ---------------------------------------------------------
    for attempt in range(settings.mistral_max_retries + 1):

        try:
            # -------------------------------------------------
            # Rate limiter
            # -------------------------------------------------
            await get_ocr_page_rate_limiter().acquire(
                len(batch_indices)
            )

            # -------------------------------------------------
            # Mistral OCR API
            # -------------------------------------------------
            response = await asyncio.wait_for(
                client.ocr.process_async(
                    model=settings.ocr_model,
                    document=DocumentURLChunk(
                        document_url=batch_data_uri
                    ),
                ),
                timeout=settings.ocr_batch_timeout_seconds(
                    len(batch_indices)
                ),
            )

            # -------------------------------------------------
            # Convert OCR response
            # -------------------------------------------------
            pages = [
                OcrPage(
                    index=batch_indices[page.index],
                    markdown=page.markdown,
                    plain_text=_markdown_to_plain_text(
                        page.markdown
                    ),
                )
                for page in response.pages or []
            ]

            # -------------------------------------------------
            # Detect pages missing from OCR response
            # -------------------------------------------------
            seen = {page.index for page in pages}

            failed = [
                index
                for index in batch_indices
                if index not in seen
            ]

            return pages, failed

        # =====================================================
        # TIMEOUT
        # =====================================================
        except TimeoutError as exc:
            last_exc = exc

            if attempt >= settings.mistral_max_retries:
                break

            wait = (
                settings.mistral_retry_base_seconds
                * (2 ** attempt)
            )

            jitter = random.uniform(
                0.0,
                min(2.0, wait * 0.25),
            )

            wait += jitter

            logger.warning(
                "MISTRAL OCR TIMEOUT | "
                "retry=%d/%d | pages=%d | wait=%.2fs",
                attempt + 1,
                settings.mistral_max_retries,
                len(batch_indices),
                wait,
            )

            await asyncio.sleep(wait)

        # =====================================================
        # ALL OTHER EXCEPTIONS
        # =====================================================
        except Exception as exc:
            last_exc = exc

            status = _exception_status(exc)

            # =================================================
            # 429 RATE LIMIT
            # =================================================
            if status == 429:

                # ---------------------------------------------
                # No retries remaining
                # ---------------------------------------------
                if attempt >= settings.mistral_max_retries:

                    logger.error(
                        "MISTRAL OCR RATE LIMIT | "
                        "max retries exhausted | "
                        "pages=%d | attempts=%d",
                        len(batch_indices),
                        attempt + 1,
                    )

                    raise MistralRateLimitError(
                        "Mistral OCR rate limit exceeded "
                        "after retries.",
                        retry_after=_retry_after(exc),
                    ) from exc

                # ---------------------------------------------
                # Prefer provider Retry-After
                # ---------------------------------------------
                wait = _retry_after(exc)

                # ---------------------------------------------
                # Otherwise exponential backoff
                # 2s -> 4s -> 8s -> 16s
                # ---------------------------------------------
                if wait is None:
                    wait = (
                        settings.mistral_retry_base_seconds
                        * (2 ** attempt)
                    )

                # ---------------------------------------------
                # Add jitter
                # Prevents multiple concurrent requests
                # from retrying at exactly the same time.
                # ---------------------------------------------
                jitter = random.uniform(
                    0.0,
                    min(2.0, wait * 0.25),
                )

                wait += jitter

                logger.warning(
                    "MISTRAL OCR 429 | "
                    "retry=%d/%d | pages=%d | wait=%.2fs",
                    attempt + 1,
                    settings.mistral_max_retries,
                    len(batch_indices),
                    wait,
                )

                await asyncio.sleep(wait)

                continue

            # =================================================
            # OTHER RETRYABLE ERRORS
            # =================================================
            if (
                not _retryable_ocr_exception(exc)
                or attempt >= settings.mistral_max_retries
            ):
                break

            # -------------------------------------------------
            # Retry-After if provider supplied it
            # -------------------------------------------------
            wait = _retry_after(exc)

            # -------------------------------------------------
            # Otherwise exponential backoff
            # -------------------------------------------------
            if wait is None:
                wait = (
                    settings.mistral_retry_base_seconds
                    * (2 ** attempt)
                )

            # -------------------------------------------------
            # Jitter
            # -------------------------------------------------
            jitter = random.uniform(
                0.0,
                min(2.0, wait * 0.25),
            )

            wait += jitter

            logger.warning(
                "MISTRAL OCR TRANSIENT ERROR | "
                "status=%s | retry=%d/%d | "
                "pages=%d | wait=%.2fs",
                status,
                attempt + 1,
                settings.mistral_max_retries,
                len(batch_indices),
                wait,
            )

            await asyncio.sleep(wait)

    # =========================================================
    # 3. Retries exhausted
    # =========================================================

    # Timeout → mark batch pages as failed
    if isinstance(
        last_exc,
        (TimeoutError, asyncio.TimeoutError),
    ):
        logger.error(
            "OCR BATCH TIMEOUT | pages=%s | attempts=%d",
            batch_indices,
            settings.mistral_max_retries + 1,
        )

        return [], list(batch_indices)

    # ---------------------------------------------------------
    # 429 should already have been raised above.
    # This is a safety fallback.
    # ---------------------------------------------------------
    if last_exc is not None:
        status = _exception_status(last_exc)

        if status == 429:
            raise MistralRateLimitError(
                "Mistral OCR rate limit exceeded after retries.",
                retry_after=_retry_after(last_exc),
            ) from last_exc

    # ---------------------------------------------------------
    # Other permanent/transient failure
    # ---------------------------------------------------------
    logger.error(
        "OCR BATCH FAILED | "
        "pages=%s | type=%s | status=%s | error=%s",
        batch_indices,
        type(last_exc).__name__ if last_exc else None,
        _exception_status(last_exc) if last_exc else None,
        repr(last_exc),
    )

    return [], list(batch_indices)

async def extract_text_batched(
    *,
    filename: str,
    content_type: str,
    content: bytes,
    settings: Settings,
) -> AsyncIterator[OcrProgressEvent]:
    """OCR a document page-by-page in controlled batches."""

    if content_type != "application/pdf":
        yield OcrProgressEvent(
            kind="total_pages",
            total_pages=1,
        )

        result = await extract_text(
            filename=filename,
            content_type=content_type,
            content=content,
            settings=settings,
        )

        yield OcrProgressEvent(
            kind="progress",
            pages_done=1,
            total_pages=1,
            completed_pages=[0],
        )

        yield OcrProgressEvent(
            kind="done",
            result=result,
        )

        return

    try:
        reader = PdfReader(BytesIO(content))
        total_pages = len(reader.pages)

    except PdfReadError as exc:
        raise MistralServiceError(
            "Unable to read this PDF. It may be corrupted or "
            "password protected."
        ) from exc

    if total_pages == 0:
        raise MistralServiceError(
            "This PDF has no pages."
        )

    if total_pages > settings.ocr_max_pages:
        raise MistralServiceError(
            f"This PDF has {total_pages} pages; "
            f"the maximum is {settings.ocr_max_pages}."
        )

    yield OcrProgressEvent(
        kind="total_pages",
        total_pages=total_pages,
    )

    client = get_mistral_client()

    batches = compute_page_batches(
        total_pages,
        settings.ocr_batch_pages,
    )

    all_pages: list[OcrPage] = []
    failed_pages: list[int] = []

    start = time.perf_counter()

    semaphore = asyncio.Semaphore(
        max(1, settings.ocr_max_concurrency)
    )

    async def run_batch(batch: list[int]):
        async with semaphore:
            return await _ocr_one_batch(
                client,
                reader,
                batch,
                settings,
            )

    window_size = max(
        1,
        settings.ocr_max_concurrency,
    )

    for window_start in range(
        0,
        len(batches),
        window_size,
    ):
        batch_window = batches[
            window_start:window_start + window_size
        ]

        tasks = [
            asyncio.create_task(
                run_batch(batch)
            )
            for batch in batch_window
        ]

        try:
            for coro in asyncio.as_completed(tasks):
                pages, failed = await coro

                all_pages.extend(pages)
                failed_pages.extend(failed)

                yield OcrProgressEvent(
                    kind="progress",
                    pages_done=len(all_pages),
                    total_pages=total_pages,
                    completed_pages=sorted(
                        page.index
                        for page in all_pages
                    ),
                    failed_pages=sorted(
                        set(failed_pages)
                    ),
                )

        finally:
            for task in tasks:
                if not task.done():
                    task.cancel()

            await asyncio.gather(
                *tasks,
                return_exceptions=True,
            )

    all_pages.sort(
        key=lambda page: page.index
    )

    failed_pages = sorted(
        set(failed_pages)
    )

    markdown = "\n\n".join(
        page.markdown
        for page in all_pages
    )

    if not markdown.strip():
        raise MistralServiceError(
            "No text detected in this document."
        )

    result = OcrResult(
        filename=filename,
        pages=len(all_pages),
        markdown=markdown,
        plain_text=_markdown_to_plain_text(markdown),
        processing_time=time.perf_counter() - start,
        model=settings.ocr_model,
        page_contents=all_pages,
        failed_pages=failed_pages,
    )

    yield OcrProgressEvent(
        kind="done",
        result=result,
        failed_pages=failed_pages,
    )