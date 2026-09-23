import asyncio
from pathlib import Path
from io import BytesIO

from pypdf import PdfReader

from app.services.mistral_ocr import _ocr_one_batch
from app.core.config import get_settings
from app.core.mistral_client import get_mistral_client


async def main():
    settings = get_settings()
    settings.ocr_max_concurrency = 1

    pdf_path = Path(
        r"..\docs\reference\official-up-forest-source.pdf"
    )

    content = pdf_path.read_bytes()

    reader = PdfReader(BytesIO(content))

    print("Total PDF pages:", len(reader.pages))
    print("Testing pages: 101-120")
    print("Sending OCR request...")

    client = get_mistral_client()

    pages, failed = await _ocr_one_batch(
        client,
        reader,
        list(range(100, 120)),
        settings,
    )

    print("OCR pages:", len(pages))
    print("Failed pages:", failed)


if __name__ == "__main__":
    asyncio.run(main())