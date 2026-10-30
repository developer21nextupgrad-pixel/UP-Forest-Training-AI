import asyncio
from mistralai.client import Mistral
from app.core.config import Settings


async def main():
    s = Settings()
    client = Mistral(api_key=s.mistral_api_key)

    try:
        response = await client.ocr.process_async(
            model="mistral-ocr-latest",
            document={
                "type": "document_url",
                "document_url": "https://arxiv.org/pdf/2201.04234",
            },
        )

        print("OCR PUBLIC URL PASS")
        print("PAGES:", len(response.pages))

    except Exception as exc:
        print("OCR PUBLIC URL FAILED")
        print("TYPE:", type(exc).__name__)
        print("MESSAGE:", str(exc))

        http_res = getattr(exc, "http_res", None)

        if http_res:
            print("STATUS:", http_res.status_code)

            for key, value in http_res.headers.items():
                if "rate" in key.lower() or "retry" in key.lower():
                    print(f"{key}: {value}")


asyncio.run(main())
