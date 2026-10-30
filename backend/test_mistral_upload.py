import asyncio
from pathlib import Path

from mistralai.client import Mistral
from app.core.config import Settings


async def main():
    s = Settings()
    c = Mistral(api_key=s.mistral_api_key)

    r = await c.files.upload_async(
        file={
            "file_name": "ocr_429_test.pdf",
            "content": Path("ocr_test_page.pdf").read_bytes(),
        },
        purpose="ocr",
    )

    print("UPLOAD PASS")
    print("FILE ID:", r.id)


asyncio.run(main())
