from __future__ import annotations
import re
import unicodedata


def detect_language(text: str) -> str:
    """Deterministic first-pass detector for English/Hindi/mixed content."""
    devanagari = len(re.findall(r"[\u0900-\u097F]", text))
    latin = len(re.findall(r"[A-Za-z]", text))
    if devanagari and latin:
        return "mixed"
    if devanagari:
        return "hi"
    if latin:
        return "en"
    return "unknown"


def language_confidence(text: str, language: str | None = None) -> float:
    dev = len(re.findall(r"[\u0900-\u097F]", text))
    lat = len(re.findall(r"[A-Za-z]", text))
    total = dev + lat
    if not total:
        return 0.0
    if language == "mixed":
        return min(dev, lat) / max(dev, lat)
    dominant = max(dev, lat) / total
    return round(dominant, 4)


def normalize_query(text: str) -> str:
    """Normalize Unicode/whitespace without translating or changing user intent."""
    text = unicodedata.normalize("NFKC", text)
    return re.sub(r"\s+", " ", text).strip()
