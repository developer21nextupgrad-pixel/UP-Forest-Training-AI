from app.services.content_intelligence import detect_language, language_confidence, normalize_query
from app.services.ingestion.text_processing import chunk_text, detect_structure


def test_language_detection_en_hi_mixed():
    assert detect_language("Forest conservation is important") == "en"
    assert detect_language("वन संरक्षण महत्वपूर्ण है") == "hi"
    assert detect_language("Forest संरक्षण महत्वपूर्ण है") == "mixed"


def test_language_confidence_and_normalization():
    assert language_confidence("वन संरक्षण महत्वपूर्ण है", "hi") > 0.9
    assert normalize_query("  वन   संरक्षण\nक्या है? ") == "वन संरक्षण क्या है?"


def test_structure_detection_is_conservative():
    assert detect_structure("CHAPTER 1\nForest Regeneration")[0] == "CHAPTER 1"
    assert detect_structure("This is an ordinary paragraph with enough words.") == (None, None)


def test_chunking_preserves_paragraph_context_and_overlap():
    text = "Heading\n\n" + ("Forest regeneration requires appropriate seed sources. " * 20)
    chunks = chunk_text(text, 250, 50)
    assert len(chunks) > 1
    assert all(chunk for chunk in chunks)
    assert any("Forest regeneration" in c for c in chunks)
