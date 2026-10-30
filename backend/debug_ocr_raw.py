import json
import urllib.request
import urllib.error

from app.core.config import Settings

s = Settings()

url = "https://api.mistral.ai/v1/ocr"

payload = {
    "model": "mistral-ocr-latest",
    "document": {
        "type": "file",
        "file_id": "af4c824d-9e55-49d0-b644-cabcf992cf3d",
    },
}

data = json.dumps(payload).encode("utf-8")

request = urllib.request.Request(
    url,
    data=data,
    method="POST",
    headers={
        "Authorization": f"Bearer {s.mistral_api_key}",
        "Content-Type": "application/json",
    },
)

try:
    with urllib.request.urlopen(request, timeout=60) as response:
        print("STATUS:", response.status)
        print()
        print("=== RESPONSE HEADERS ===")
        for key, value in response.headers.items():
            print(f"{key}: {value}")

        print()
        print("=== RESPONSE BODY ===")
        print(response.read().decode("utf-8"))

except urllib.error.HTTPError as exc:
    print("STATUS:", exc.code)
    print()
    print("=== RESPONSE HEADERS ===")
    for key, value in exc.headers.items():
        print(f"{key}: {value}")

    print()
    print("=== RESPONSE BODY ===")
    print(exc.read().decode("utf-8"))
