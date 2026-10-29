"""AI extraction services for Field Officer forms."""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime
from datetime import date

from app.core.config import Settings
from app.schemas.field_forms import OffenceSeizureReportFields
from app.core.config import get_settings
from app.services.rag_llm import MistralLLMProvider
from app.schemas.field_forms import (
    IncidentReportFields,
    PatrolReportFields,
)
from app.services.rag_prompts import FIELD_OFFICER_SYSTEM_PROMPT
from app.services.rag_service import _extract_json

logger = logging.getLogger(__name__)


PATROL_REPORT_SYSTEM_PROMPT = """
You are a structured data extraction assistant for a Forest Department
Field Officer application.

Your job is to extract patrol-report information from the officer's
natural-language description.

IMPORTANT RULES:

1. Return ONLY valid JSON.
2. Never invent information.
3. If a field is not present in the input, return null.
4. Do not infer names, locations, dates or times that are not explicitly stated.
5. Preserve Hindi text when the input is Hindi.
6. Preserve English text when the input is English.
7. Extract information faithfully without changing its meaning.
8. "team_members" must always be a JSON array.
9. Use ISO format for dates: YYYY-MM-DD.
10. Use 24-hour format for times: HH:MM:SS.
11. "confidence" must be a number between 0 and 1.
12. The response must contain exactly these top-level keys:

{
  "patrol_date": null,
  "beat": null,
  "range_name": null,
  "division": null,
  "start_time": null,
  "end_time": null,
  "location": null,
  "team_members": [],
  "purpose": null,
  "observations": null,
  "wildlife_sighting": null,
  "illegal_activity": null,
  "action_taken": null,
  "incident_details": null,
  "additional_remarks": null,
  "confidence": null
}
"""


INCIDENT_REPORT_SYSTEM_PROMPT = """
You are a structured data extraction assistant for a Forest Department
Field Officer application.

Your job is to extract incident-report information from the officer's
natural-language description.

IMPORTANT RULES:

1. Return ONLY valid JSON.
2. Never invent information.
3. If a field is not present in the input, return null.
4. Do not infer names, locations, dates or times that are not explicitly stated.
5. Preserve Hindi text when the input is Hindi.
6. Preserve English text when the input is English.
7. Extract information faithfully without changing its meaning.
8. "persons_involved" must always be a JSON array.
9. Use ISO format for dates: YYYY-MM-DD.
10. Use 24-hour format for times: HH:MM:SS.
11. "confidence" must be a number between 0 and 1.
12. The response must contain exactly these top-level keys:

{
  "incident_date": null,
  "incident_time": null,
  "division": null,
  "range_name": null,
  "beat": null,
  "location": null,
  "incident_type": null,
  "reported_by": null,
  "persons_involved": [],
  "wildlife_involved": null,
  "incident_description": null,
  "immediate_action_taken": null,
  "authorities_informed": null,
  "injury_or_damage": null,
  "evidence_details": null,
  "additional_remarks": null,
  "confidence": null
}
"""


class FieldFormExtractionService:
    """Extract structured field forms from natural-language input."""

    def __init__(self) -> None:
        self.settings = get_settings()
        self.llm = MistralLLMProvider(self.settings)

    async def extract_patrol_report(
        self,
        text: str,
    ) -> tuple[PatrolReportFields, float | None]:
        """Extract patrol report fields from natural-language text."""

        clean_text = text.strip()

        if not clean_text:
            raise ValueError("Patrol report text cannot be empty.")

        today = date.today().isoformat()

        user_prompt = f"""
Extract patrol report fields from the following officer description.

Today's date is {today}.

OFFICER DESCRIPTION:
{clean_text}

Return ONLY the JSON object.
"""

        raw_response = await self.llm.generate(
            system=PATROL_REPORT_SYSTEM_PROMPT,
            user=user_prompt,
        )

        payload = self._parse_json(raw_response)

        confidence = payload.pop("confidence", None)

        fields = PatrolReportFields.model_validate(payload)

        return fields, confidence

    async def extract_incident_report(
        self,
        text: str,
    ) -> tuple[IncidentReportFields, float | None]:
        """Extract incident report fields from natural-language text."""

        clean_text = text.strip()

        if not clean_text:
            raise ValueError("Incident report text cannot be empty.")

        today = date.today().isoformat()

        user_prompt = f"""
Extract incident report fields from the following officer description.

Today's date is {today}.

OFFICER DESCRIPTION:
{clean_text}

Return ONLY the JSON object.
"""

        raw_response = await self.llm.generate(
            system=INCIDENT_REPORT_SYSTEM_PROMPT,
            user=user_prompt,
        )

        payload = self._parse_json(raw_response)

        confidence = payload.pop("confidence", None)

        fields = IncidentReportFields.model_validate(payload)

        return fields, confidence

    async def extract_daily_diary(self, text: str) -> dict:
            """Extract Daily Diary fields from an officer's narrative."""

            clean_text = text.strip()
            if not clean_text:
                raise ValueError("Daily diary text cannot be empty.")

            prompt = """

Extract Daily Diary fields from the officer's narrative.

Rules:
- Return only valid JSON. Do not include markdown.
- Never invent information.
- Use null for missing text/date fields.
- Use [] if no activities are mentioned.
- Preserve the language and meaning of the narrative.
- Extract the diary date only when explicitly stated in the narrative.
- Do not use today's date unless explicitly stated.
- Return diary_date strictly in DD-MM-YYYY format.
- Example: "22 October 2026" becomes "22-10-2026".
- If a date is explicitly mentioned, extract it exactly.
- Convert dates such as "22 October 2026" to "22-10-2026".
- Never return an explicitly mentioned date as null.
- If the date is not explicitly mentioned, return null.
- The description field must contain a concise summary of the
  field activities, not a copy of the complete original narrative.
- Extract only information supported by the narrative.

Return exactly this JSON structure:
{
    "diary_date": null,
    "subject": null,
    "description": null,
    "location": null,
    "activities": [],
    "observations": null,
    "additional_remarks": null
}
"""


            raw_response = await self.llm.generate(
                system=prompt,
                user=clean_text,
            )
            data = self._parse_json(raw_response)


            # Deterministically extract an explicitly mentioned date.
            # This avoids relying entirely on the AI model for dates.
            date_patterns = [
                (
                    r"\b(\d{1,2})\s+"
                    r"(January|February|March|April|May|June|July|August|"
                    r"September|October|November|December)\s+(\d{4})\b",
                    "%d %B %Y",
                ),
                (r"\b(\d{1,2})[-/](\d{1,2})[-/](\d{4})\b", None),
            ]

            for pattern, date_format in date_patterns:
                match = re.search(pattern, clean_text, re.IGNORECASE)

                if not match:
                    continue

                try:
                    if date_format:
                        parsed_date = datetime.strptime(
                            " ".join(match.groups()).title(),
                            date_format,
                        )
                    else:
                        day, month, year = map(int, match.groups())
                        parsed_date = datetime(year, month, day)

                    data["diary_date"] = parsed_date.strftime("%d-%m-%Y")
                    break

                except ValueError:
                    continue


            allowed_fields = {
                "diary_date",
                "subject",
                "description",
                "location",
                "activities",
                "observations",
                "additional_remarks",
            }

            result = {key: data.get(key) for key in allowed_fields}
            result["activities"] = (
                result["activities"]
                if isinstance(result["activities"], list)
                else []
            )
            return result

    @staticmethod
    def _parse_json(raw_response: str) -> dict:
        """Parse JSON safely from the LLM response."""

        text = raw_response.strip()

        if text.startswith("```"):
            lines = text.splitlines()

            if lines and lines[0].strip().startswith("```"):
                lines = lines[1:]

            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]

            text = "\n".join(lines).strip()

            if text.lower().startswith("json"):
                text = text[4:].strip()

        try:
            payload = json.loads(text)
        except json.JSONDecodeError as exc:
            logger.error(
                "Invalid JSON returned by field form extraction model: %s",
                raw_response,
            )
            raise ValueError(
                "The AI returned an invalid structured response."
            ) from exc

        if not isinstance(payload, dict):
            raise ValueError(
                "The AI response must be a JSON object."
            )

        return payload

async def extract_offence_seizure_report(
    text: str,
    settings: Settings,
) -> OffenceSeizureReportFields:
    prompt = f"""
Extract a structured Offence and Seizure Report from the Field Officer's description below. The description may be in Hindi or English.

Return ONLY valid JSON with exactly the requested fields and correct data types.

DATE AND TIME EXTRACTION — CRITICAL:
1. Carefully scan the entire description for dates and times, including inside long sentences.
2. Extract offence_date from the date on which the offence or incident occurred.
3. Extract offence_time from the time when the offence or incident occurred.
4. Extract seizure_date and seizure_time only when the seizure date and time are explicitly stated.
5. Convert explicit dates such as "14 October 2026", "October 14, 2026", and "14/10/2026" to YYYY-MM-DD.
6. Convert explicit times such as "08:30 AM" to "08:30:00", "11:45 PM" to "23:45:00", and "14:20" to "14:20:00".
7. Do not confuse offence date/time with seizure date/time.
8. If a date or time is not explicitly stated, return null. Never invent one.
9. Before returning JSON, verify that every explicitly mentioned date and time has been extracted into the appropriate field.

Return this JSON structure:

{{
  "offence_date": null,
  "offence_time": null,
  "division": null,
  "range_name": null,
  "beat": null,
  "location": null,
  "offence_type": null,
  "applicable_law": null,
  "applicable_section": null,
  "persons_involved": [],
  "seized_material": [],
  "seizure_location": null,
  "seizure_date": null,
  "seizure_time": null,
  "vehicle_details": null,
  "vehicle_registration_number": null,
  "evidence_details": null,
  "witnesses": [],
  "action_taken": null,
  "authorities_informed": null,
  "case_reference_number": null,
  "fir_number": null,
  "incident_reference_id": null,
  "description": null,
  "additional_remarks": null,
  "ai_confidence": null
}}

GENERAL RULES:
- Extract only information explicitly present in the description.
- Never invent missing information.
- Use null for unavailable scalar fields and [] for unavailable list fields.
- Preserve names, locations, laws and legal sections accurately.
- Do not infer applicable laws or legal sections.
- Use structured objects for persons_involved, seized_material, and witnesses when information is available.
- Keep vehicle_registration_number exactly as mentioned.
- ai_confidence must be a number between 0 and 1.
- Return valid JSON only. Do not include Markdown.

FIELD OFFICER DESCRIPTION:

{text}
"""

    raw = await MistralLLMProvider(settings).generate(
        system=FIELD_OFFICER_SYSTEM_PROMPT,
        user=prompt,
    )

    try:
        data = _extract_json(raw)
        return OffenceSeizureReportFields.model_validate(data)
    except Exception:
        logger.exception(
            "Offence & Seizure Report extraction failed"
        )
        raise ValueError(
            "Unable to extract Offence & Seizure Report."
        )
