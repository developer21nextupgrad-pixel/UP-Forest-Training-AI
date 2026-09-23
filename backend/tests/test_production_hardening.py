import pytest
from app.schemas.auth import RegisterRequest
from app.services.auth_service import AuthService
from app.services.ingestion.text_processing import extract_page_structure, analyze_document_pages, detect_printed_page_number

def test_public_register_schema_has_no_role_field():
    payload=RegisterRequest(full_name="A Student",email="a@example.com",password="StrongPass1")
    assert not hasattr(payload,"role")

def test_chapter_detection_supports_roman_chapters():
    chapter, number, section, _=extract_page_structure("Chapter XIII\nSales and Purchases\nBody")
    assert chapter == "Sales and Purchases"
    assert number == 13
    assert section is None

def test_document_structure_carries_chapter_across_pages():
    rows=analyze_document_pages([(1,"Chapter II\nForest Resources"),(2,"continuation"),(3,"SECTION 1\nOverview")])
    assert rows[0].chapter_title == "Forest Resources"
    assert rows[1].chapter_title == "Forest Resources"
    assert rows[2].chapter_title == "Forest Resources"
    assert rows[2].section_title == "Overview"

def test_printed_page_is_separate_from_pdf_page():
    assert detect_printed_page_number("body\n\n257") == 257
