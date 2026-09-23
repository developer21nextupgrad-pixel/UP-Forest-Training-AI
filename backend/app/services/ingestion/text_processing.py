from __future__ import annotations

import re
from dataclasses import dataclass

from app.services.content_intelligence import detect_language, language_confidence


def clean_text(text: str) -> str:
    text = text.replace("\x00", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n[ \t]+", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


_ROMAN = re.compile(r"^[IVXLCDM]+$", re.I)
_CHAPTER = re.compile(r"^\s*(?:chapter|अध्याय)\s*[-:.)]?\s*(?P<num>[IVXLCDM]+|\d+)?\s*[-:.)]?\s*(?P<title>.*)$", re.I)
_SECTION = re.compile(r"^\s*(?:section|खंड)\s*[-:.)]?\s*(?P<num>[IVXLCDM]+|\d+(?:\.\d+)*)?\s*[-:.)]?\s*(?P<title>.+)$", re.I)


def roman_to_int(value: str) -> int | None:
    if not value or not _ROMAN.match(value): return None
    vals={"I":1,"V":5,"X":10,"L":50,"C":100,"D":500,"M":1000}
    total=0; prev=0
    for char in value.upper()[::-1]:
        n=vals[char]; total += -n if n < prev else n; prev=max(prev,n)
    return total


def detect_printed_page_number(text: str) -> int | None:
    lines=[x.strip() for x in text.splitlines() if x.strip()]
    for line in reversed(lines[-12:]):
        if re.fullmatch(r"\d{1,4}", line):
            value=int(line)
            if 1 <= value <= 9999: return value
    return None


def _heading_from_next(lines: list[str], index: int) -> str | None:
    for nxt in lines[index+1:index+4]:
        if 3 <= len(nxt) <= 180 and not _CHAPTER.match(nxt) and not _SECTION.match(nxt):
            return nxt.strip(" #:-–—")
    return None


def extract_page_structure(text: str) -> tuple[str | None, int | None, str | None, int | None]:
    lines=[line.strip() for line in text.splitlines() if line.strip()]
    chapter_title=None; chapter_number=None; section_title=None; section_number=None
    for i,line in enumerate(lines[:80]):
        match=_CHAPTER.match(line)
        if match:
            num=match.group("num"); title=(match.group("title") or "").strip()
            if not title: title=_heading_from_next(lines,i) or ""
            chapter_title=title or None
            chapter_number=roman_to_int(num) if num and _ROMAN.match(num) else (int(num) if num and num.isdigit() else None)
            return chapter_title, chapter_number, None, None
    for i,line in enumerate(lines[:80]):
        prefix=re.match(r"^\s*(?:section|खंड)\s*(.*)$", line, re.I)
        if prefix:
            rest=prefix.group(1).strip(" :-–—")
            number_match=re.match(r"^(?P<num>[IVXLCDM]+|\d+(?:\.\d+)*)[.)]?\s+(?P<title>.+)$", rest, re.I)
            if number_match:
                raw=number_match.group("num"); title=number_match.group("title").strip()
            elif rest and re.fullmatch(r"[IVXLCDM]+|\d+(?:\.\d+)*", rest, re.I):
                raw=rest; title=_heading_from_next(lines,i) or ""
            else:
                raw=None; title=rest
            section_title=title or None
            section_number=roman_to_int(raw) if raw and _ROMAN.match(raw) else (int(raw.split('.')[0]) if raw and raw.split('.')[0].isdigit() else None)
            return None, None, section_title, section_number
        if line.startswith("#"):
            return line.lstrip("# ").strip(), None, None, None
        if line.isupper() and 3 <= len(line) <= 120 and len(line.split()) <= 14:
            return line, None, None, None
    return None, None, None, None


def detect_structure(text: str) -> tuple[str | None, str | None]:
    """Backward-compatible conservative detector.

    The ingestion pipeline uses ``extract_page_structure`` for normalized
    chapter titles. Legacy callers/tests expect the explicit chapter marker
    itself (for example ``CHAPTER 1``), so this function preserves that
    contract.
    """
    lines=[line.strip() for line in text.splitlines() if line.strip()]
    for line in lines[:40]:
        if _CHAPTER.match(line):
            return line, None
    _, _, section, _ = extract_page_structure(text)
    return None, section


@dataclass(frozen=True)
class PageStructure:
    page_number: int
    printed_page_number: int | None
    chapter_title: str | None
    chapter_number: int | None
    section_title: str | None
    section_number: int | None


def analyze_document_pages(pages: list[tuple[int, str]]) -> list[PageStructure]:
    current_chapter: str | None=None; current_number: int | None=None; current_section: str | None=None; current_section_number: int | None=None
    out=[]
    for page_number, text in pages:
        chapter, ch_num, section, sec_num=extract_page_structure(text)
        if chapter:
            current_chapter, current_number=chapter, ch_num
            current_section, current_section_number=None, None
        if section:
            current_section, current_section_number=section, sec_num
        out.append(PageStructure(page_number, detect_printed_page_number(text), current_chapter, current_number, current_section, current_section_number))
    return out


def chunk_text(text: str, chunk_size: int = 1200, overlap: int = 200) -> list[str]:
    if chunk_size <= 0 or overlap < 0 or overlap >= chunk_size: raise ValueError("Invalid chunking configuration")
    text=clean_text(text)
    if not text:return []
    paragraphs=[p.strip() for p in re.split(r"\n{2,}",text) if p.strip()]
    chunks=[]; current=""
    for paragraph in paragraphs:
        candidate=f"{current}\n\n{paragraph}".strip() if current else paragraph
        if len(candidate)<=chunk_size: current=candidate; continue
        if current: chunks.append(current)
        if len(paragraph)>chunk_size:
            start=0
            while start<len(paragraph):
                end=min(start+chunk_size,len(paragraph))
                if end<len(paragraph):
                    boundary=max(paragraph.rfind(". ",start,end),paragraph.rfind("\n",start,end))
                    if boundary>start+int(chunk_size*0.55): end=boundary+1
                part=paragraph[start:end].strip()
                if part: chunks.append(part)
                if end>=len(paragraph):break
                start=max(end-overlap,start+1)
            current=""
        else: current=paragraph
    if current:chunks.append(current)
    return chunks

__all__=["clean_text","detect_structure","extract_page_structure","analyze_document_pages","detect_printed_page_number","roman_to_int","chunk_text","detect_language","language_confidence","PageStructure"]
