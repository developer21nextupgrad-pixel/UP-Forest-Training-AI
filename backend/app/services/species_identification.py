from __future__ import annotations

import base64
import json
import logging
from io import BytesIO

from PIL import Image

from app.core.config import get_settings
from app.services.rag_llm import MistralLLMProvider
from app.services.rag_service import RAGService

logger = logging.getLogger(__name__)


SPECIES_IDENTIFICATION_SYSTEM_PROMPT = """
You are a wildlife and plant identification assistant for the
Uttar Pradesh Forest Department.

Analyze the provided image carefully.

Your task is to identify the visible animal, bird, insect, tree,
plant, or other relevant forest species.

Do NOT claim certainty when the image does not provide enough evidence.

Return ONLY valid JSON in this exact structure:

{
  "common_name": "English common name or null",
  "local_name": "Hindi/local name or null",
  "scientific_name": "Scientific name or null",
  "category": "animal|bird|plant|tree|insect|reptile|other|unknown",
  "confidence": 0.0,
  "identification_status": "identified|uncertain|not_identifiable",
  "description": "Short visual description",
  "key_features": [
    "feature 1",
    "feature 2"
  ],
  "alternative_species": [
    {
      "common_name": "Alternative species",
      "scientific_name": "Scientific name or null",
      "confidence": 0.0
    }
  ]
}

Rules:
- confidence must be between 0.0 and 1.0.
- Do not invent a scientific name.
- If the image is blurry, distant, obstructed, or insufficient,
  use "uncertain" or "not_identifiable".
- Keep alternative_species empty when there are no meaningful alternatives.
- Return JSON only. No markdown. No explanation outside JSON.
"""


class SpeciesIdentificationService:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.llm = MistralLLMProvider(self.settings)

    @staticmethod
    def _validate_image(image_bytes: bytes) -> tuple[int, int, str]:
        try:
            image = Image.open(BytesIO(image_bytes))
            image.verify()

            image = Image.open(BytesIO(image_bytes))

            width, height = image.size
            image_format = (image.format or "JPEG").lower()

            return width, height, image_format

        except Exception as exc:
            raise ValueError(
                "Invalid or unsupported image file"
            ) from exc

    @staticmethod
    def _build_data_uri(
        image_bytes: bytes,
        image_format: str,
    ) -> str:
        mime_type = {
            "jpg": "image/jpeg",
            "jpeg": "image/jpeg",
            "png": "image/png",
            "webp": "image/webp",
            "gif": "image/gif",
        }.get(
            image_format,
            "image/jpeg",
        )

        encoded = base64.b64encode(image_bytes).decode("utf-8")

        return f"data:{mime_type};base64,{encoded}"

    async def identify(
        self,
        *,
        image_bytes: bytes,
        filename: str | None = None,
    ) -> dict:

        if not image_bytes:
            raise ValueError("Image file is empty")

        width, height, image_format = self._validate_image(
            image_bytes
        )

        if width < 100 or height < 100:
            raise ValueError(
                "Image resolution is too low for reliable identification"
            )

        image_data_uri = self._build_data_uri(
            image_bytes,
            image_format,
        )

        user_prompt = """
Identify the species shown in this image.

Focus on visible evidence such as:
- body shape
- color and markings
- leaves, flowers, bark, or other plant characteristics
- habitat/context visible in the image
- distinctive physical features

If identification is uncertain, provide the most likely candidates
instead of presenting a guess as certain.

Return the requested JSON structure only.
"""

        raw_response = await self.llm.generate_with_image(
            system=SPECIES_IDENTIFICATION_SYSTEM_PROMPT,
            user=user_prompt,
            image_data_uri=image_data_uri,
            temperature=0.1,
        )

        if not raw_response:
            raise RuntimeError(
                "Species identification model returned an empty response"
            )

        try:
            result = json.loads(raw_response)
        except json.JSONDecodeError as exc:
            logger.error(
                "Invalid species identification JSON: %s",
                raw_response,
            )
            raise RuntimeError(
                "Species identification model returned invalid JSON"
            ) from exc

        result["image"] = {
            "filename": filename,
            "width": width,
            "height": height,
            "format": image_format,
        }

        return result