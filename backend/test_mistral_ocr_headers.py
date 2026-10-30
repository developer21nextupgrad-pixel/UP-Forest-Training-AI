import asyncio
from mistralai.client import Mistral
from app.core.config import Settings


async def main():
    s = Settings()
    c = Mistral(api_key=s.mistral_api_key)

    try:
        await c.ocr.process_async(
            model="mistral-ocr-latest",
            document={
                "type": "file",
                "file_id": "af4c824d-9e55-49d0-b644-cabcf992cf3d",
            },
        )
        print("OCR PASS")

    except Exception as exc:
        print("OCR FAILED")
        print("TYPE:", type(exc).__name__)
        print("MESSAGE:", str(exc))

        response = getattr(exc, "http_res", None)

        if response is not None:
            print("STATUS:", getattr(response, "status_code", None))
            print("HEADERS:")
            for key, value in response.headers.items():
                if "rate" in key.lower() or "retry" in key.lower():
                    print(f"{key}: {value}")


asyncio.run(main())
