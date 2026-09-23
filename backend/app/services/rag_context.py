from __future__ import annotations
from app.services.rag_schemas import RetrievalResult

def build_context(results: list[RetrievalResult], max_chars: int) -> tuple[str, dict[str, RetrievalResult]]:
    blocks = []
    source_map: dict[str, RetrievalResult] = {}
    used = 0
    for i, result in enumerate(results, 1):
        source_id = f"source-{i}"
        source_map[source_id] = result
        printed = (
            f"{result.printed_page_start}-{result.printed_page_end}"
            if result.printed_page_start is not None and result.printed_page_end is not None
            else str(result.printed_page_start or "Unknown")
        )
        header = (
            f"[{source_id}]\n"
            f"Book: {result.book_title or result.filename}\n"
            f"Chapter: {result.chapter_title or 'Unknown'}\n"
            f"Section: {result.section_title or 'Unknown'}\n"
            f"Page: {result.page_number if result.page_number is not None else 'Unknown'}\n"
            f"Printed page: {printed}\n"
        )
        block = f"{header}\n{result.text.strip()}\n"
        if used + len(block) > max_chars:
            break
        blocks.append(block)
        used += len(block)
    return "\n".join(blocks), source_map
