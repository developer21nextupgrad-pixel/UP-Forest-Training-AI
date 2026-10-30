import asyncio
from pathlib import Path

from app.services.mistral_ocr import extract_text
from app.core.config import Settings
from app.core.exceptions import MistralRateLimitError


async def main():
    pdf = Path("ocr_test_page.pdf")
    content = pdf.read_bytes()

    try:
        result = await extract_text(
            filename=pdf.name,
            content_type="application/pdf",
            content=content,
            settings=Settings(),
        )

        print("OCR SUCCESS")
        print("pages:", result.pages)

    except MistralRateLimitError as exc:
        print("EXPECTED RATE LIMIT ERROR")
        print("type:", type(exc).__name__)
        print("message:", str(exc))
        print("retry_after:", exc.retry_after)

    except Exception as exc:
        print("UNEXPECTED ERROR")
        print("type:", type(exc).__name__)
        print("message:", str(exc))


asyncio.run(main())
