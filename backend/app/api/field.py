"""Field Officer AI assistant endpoints."""



from __future__ import annotations



import logging
import uuid

from datetime import datetime, timezone

from uuid import UUID

import os

from pathlib import Path



from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File,Form
from fastapi.responses import FileResponse

from sqlalchemy import select

from sqlalchemy.ext.asyncio import AsyncSession



from app.api.dependencies import require_field_officer

from app.core.config import SettingsDep, get_settings

from app.db.session import get_db_session

from app.models.domain import Evidence

from app.models.domain import *

from app.models import (

    DailyDiary,

    FieldPatrolReport,

    IncidentReport,

    User,

    OffenceSeizureReport

)

from app.schemas.field_forms import (

    PatrolReportExtractRequest,

    PatrolReportExtractResponse,

    PatrolReportSaveRequest,

    PatrolReportSaveResponse,

    PatrolReportDraftItem,

    PatrolReportDraftListResponse,

    PatrolReportSubmitResponse,

    DailyDiaryFields,

    DailyDiaryItem,

    DailyDiaryListResponse,

    DailyDiarySaveRequest,

    DailyDiarySaveResponse,

    DailyDiarySubmitResponse,

    IncidentReportItem,

    IncidentReportSubmitResponse,

    IncidentReportListResponse,

    IncidentReportExtractRequest,

    IncidentReportExtractResponse,

    IncidentReportSaveRequest,

    IncidentReportSaveResponse,

    OffenceSeizureReportExtractRequest,

    OffenceSeizureReportExtractResponse,

    OffenceSeizureReportCreate,

    OffenceSeizureReportUpdate,

    OffenceSeizureReportResponse,
    OffenceSeizureReportSaveResponse,

    OffenceSeizureReportListItem,

    OffenceSeizureReportSubmitResponse,

)

from app.schemas.response import RagChatRequest, RagChatResponse

from app.services.content_intelligence import detect_language

from app.services.field_forms import FieldFormExtractionService

from app.services.rag_context import build_context

from app.services.rag_llm import MistralLLMProvider

from app.services.rag_prompts import FIELD_OFFICER_SYSTEM_PROMPT

from app.services.rag_service import RAGService, _extract_json

from app.services.rag_schemas import TutorGeneration

from app.services.species_identification import (

    SpeciesIdentificationService,

)

from app.services.field_forms import (

    extract_offence_seizure_report,

)





logger = logging.getLogger(__name__)



router = APIRouter(prefix="/field", tags=["field"])





def _language_name(language_code: str) -> str:

    """Return a clear language name for the LLM prompt."""



    normalized = (language_code or "").lower().strip()



    if normalized.startswith("hi"):

        return "Hindi"



    return "English"





def _not_found_message(language_code: str) -> str:

    """Return a language-matched message when retrieval has no answer."""



    if _language_name(language_code) == "Hindi":

        return (

            "मुझे उपलब्ध Field Officer knowledge base में "

            "इस प्रश्न की पर्याप्त जानकारी नहीं मिली।"

        )



    return (

        "I couldn't find this information in the available "

        "Field Officer knowledge base."

    )





def _insufficient_context_message(language_code: str) -> str:

    """Return a language-matched message when context is insufficient."""



    if _language_name(language_code) == "Hindi":

        return (

            "उपलब्ध Field Officer knowledge base में इस प्रश्न का "

            "उत्तर देने के लिए पर्याप्त जानकारी नहीं है।"

        )



    return (

        "I couldn't find enough information in the available "

        "Field Officer knowledge base."

    )





def _generation_failed_message(language_code: str) -> str:

    """Return a language-matched generation failure message."""



    if _language_name(language_code) == "Hindi":

        return (

            "उपलब्ध Field Officer documents से grounded उत्तर "

            "तैयार नहीं किया जा सका।"

        )



    return (

        "I couldn't generate a grounded answer from the "

        "available Field Officer documents."

    )





@router.post(

    "/forms/patrol/extract",

    response_model=PatrolReportExtractResponse,

)

async def extract_patrol_report(

    payload: PatrolReportExtractRequest,

    _: User = Depends(require_field_officer),

) -> PatrolReportExtractResponse:

    """

    Extract structured patrol-report fields from an officer's

    natural-language description.



    This endpoint does not save anything to the database.

    It only performs AI extraction and validation.

    """



    try:

        service = FieldFormExtractionService()



        fields, confidence = await service.extract_patrol_report(

            payload.text

        )



        field_data = fields.model_dump(mode="json")



        field_names = [

            "patrol_date",

            "beat",

            "range_name",

            "division",

            "start_time",

            "end_time",

            "location",

            "purpose",

            "observations",

            "wildlife_sighting",

            "illegal_activity",

            "action_taken",

            "incident_details",

            "additional_remarks",

        ]



        missing_fields = [

            field_name

            for field_name in field_names

            if field_data.get(field_name) in (None, "", [])

        ]



        return PatrolReportExtractResponse(

            success=True,

            form_type="PATROL_REPORT",

            fields=fields,

            missing_fields=missing_fields,

            source_text=payload.text,

            confidence=confidence,

            message="Patrol report fields extracted successfully.",

        )



    except ValueError as exc:

        logger.warning(

            "Patrol report extraction validation failed: %s",

            exc,

        )



        raise HTTPException(

            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,

            detail=str(exc),

        ) from exc



    except Exception:

        logger.exception(

            "Unexpected patrol report extraction error."

        )



        raise HTTPException(

            status_code=status.HTTP_502_BAD_GATEWAY,

            detail="Unable to extract patrol report fields.",

        )



@router.post(

    "/forms/incident/extract",

    response_model=IncidentReportExtractResponse,

)

async def extract_incident_report(

    payload: IncidentReportExtractRequest,

    _: User = Depends(require_field_officer),

) -> IncidentReportExtractResponse:

    """

    Extract structured incident-report fields from an officer's

    natural-language description.



    This endpoint does not save anything to the database.

    It only performs AI extraction and validation.

    """



    try:

        service = FieldFormExtractionService()



        fields, confidence = await service.extract_incident_report(

            payload.text

        )



        field_data = fields.model_dump(mode="json")



        field_names = [

            "incident_date",

            "incident_time",

            "division",

            "range_name",

            "beat",

            "location",

            "incident_type",

            "reported_by",

            "persons_involved",

            "wildlife_involved",

            "incident_description",

            "immediate_action_taken",

            "authorities_informed",

            "injury_or_damage",

            "evidence_details",

            "additional_remarks",

        ]



        missing_fields = [

            field_name

            for field_name in field_names

            if field_data.get(field_name) in (None, "", [])

        ]



        return IncidentReportExtractResponse(

            success=True,

            form_type="INCIDENT_REPORT",

            fields=fields,

            missing_fields=missing_fields,

            source_text=payload.text,

            confidence=confidence,

        )



    except ValueError as exc:

        raise HTTPException(

            status_code=422,

            detail=str(exc),

        ) from exc



    except Exception:

        logger.exception(

            "Incident report extraction failed."

        )

        raise HTTPException(

            status_code=500,

            detail="Unable to extract incident report.",

        )        



@router.post(

    "/forms/offence-seizure/extract",

    response_model=OffenceSeizureReportExtractResponse,

)

async def extract_offence_seizure(

    payload: OffenceSeizureReportExtractRequest,

    settings: SettingsDep,

    _: User = Depends(require_field_officer),

) -> OffenceSeizureReportExtractResponse:

    """Extract an Offence & Seizure Report from natural language."""



    if not payload.text.strip():

        raise HTTPException(

            status_code=status.HTTP_400_BAD_REQUEST,

            detail="Report text cannot be empty.",

        )



    try:

        fields = await extract_offence_seizure_report(

            payload.text.strip(),

            settings,

        )

    except Exception:

        logger.exception(

            "Offence & Seizure Report extraction failed"

        )

        raise HTTPException(

            status_code=status.HTTP_502_BAD_GATEWAY,

            detail="Unable to extract Offence & Seizure Report.",

        )



    return OffenceSeizureReportExtractResponse(

        success=True,

        fields=fields,

    )



@router.post("/species/identify")

async def identify_species(

    image: UploadFile = File(...),

    _: User = Depends(require_field_officer),

    session: AsyncSession = Depends(get_db_session),

):

    """

    Identify a wildlife or plant species from an uploaded image.

    """



    if not image.content_type:

        raise HTTPException(

            status_code=status.HTTP_400_BAD_REQUEST,

            detail="Image content type is missing.",

        )



    allowed_types = {

        "image/jpeg",

        "image/png",

        "image/webp",

    }



    if image.content_type not in allowed_types:

        raise HTTPException(

            status_code=status.HTTP_400_BAD_REQUEST,

            detail="Only JPEG, PNG, and WebP images are supported.",

        )



    try:

        # ---------------------------------------------------------

        # Read uploaded image

        # ---------------------------------------------------------



        image_bytes = await image.read()



        service = SpeciesIdentificationService()



        result = await service.identify(

            image_bytes=image_bytes,

            filename=image.filename,

        )



        # ---------------------------------------------------------

        # Extract species information

        # ---------------------------------------------------------



        species_name = (

            result.get("scientific_name")

            or result.get("common_name")

            or result.get("local_name")

        )



        rag_results = []



        # ---------------------------------------------------------

        # Species-specific RAG retrieval

        # ---------------------------------------------------------



        if species_name:

            common_name = (

                result.get("common_name") or ""

            ).strip()



            local_name = (

                result.get("local_name") or ""

            ).strip()



            scientific_name = (

                result.get("scientific_name") or ""

            ).strip()



            rag_query = " ".join(

                part

                for part in [

                    common_name,

                    local_name,

                    scientific_name,

                    "wildlife habitat identification protection conservation",

                ]

                if part

            )



            rag_results = await RAGService(

                session,

                get_settings(),

            ).retrieve(

                rag_query,

                {

                    "query_language": "en",

                },

            )



        # ---------------------------------------------------------

        # Species-specific relevance filtering

        # ---------------------------------------------------------



        common_name_lower = (

            result.get("common_name") or ""

        ).strip().lower()



        local_name_lower = (

            result.get("local_name") or ""

        ).strip().lower()



        scientific_name_lower = (

            result.get("scientific_name") or ""

        ).strip().lower()



        species_keywords = set()



        for value in [

            common_name_lower,

            local_name_lower,

            scientific_name_lower,

        ]:

            if value:

                species_keywords.update(

                    token

                    for token in value.replace("-", " ").split()

                    if len(token) >= 3

                )



        # ---------------------------------------------------------

# Species-specific relevance filtering

# ---------------------------------------------------------



        common_name_lower = (

            result.get("common_name") or ""

        ).strip().lower()



        local_name_lower = (

            result.get("local_name") or ""

        ).strip().lower()



        scientific_name_lower = (

            result.get("scientific_name") or ""

        ).strip().lower()



        species_keywords = set()



        for value in [

            common_name_lower,

            local_name_lower,

            scientific_name_lower,

        ]:

            if value:

                species_keywords.update(

                    token

                    for token in value.replace("-", " ").split()

                    if len(token) >= 3

                )



        filtered_rag_results = []



        for item in rag_results:

            text = (item.text or "").lower()

            score = item.relevance_score or 0.0



            species_match = any(

                keyword in text

                for keyword in species_keywords

            )



            # -----------------------------------------------------

            # Strong semantic result

            # -----------------------------------------------------

            #

            # High score can be useful even if exact species name

            # is not present because the vector search may understand

            # related wildlife/legal/conservation content.

            #

            if score >= 0.70:

                filtered_rag_results.append(item)

                continue



            # -----------------------------------------------------

            # Medium relevance

            # -----------------------------------------------------

            #

            # Medium-score results MUST contain an actual species

            # keyword. Generic words like "forest", "animal",

            # "wildlife", etc. are not enough.

            #

            if score >= 0.45 and species_match:

                filtered_rag_results.append(item)

                continue



            # -----------------------------------------------------

            # Low relevance

            # -----------------------------------------------------

            #

            # Anything below 0.45 is discarded.

            #

            continue





        # ---------------------------------------------------------

        # Remove duplicate chunks

        # ---------------------------------------------------------



        unique_results = []

        seen_chunks = set()



        for item in filtered_rag_results:

            if item.chunk_id in seen_chunks:

                continue



            seen_chunks.add(item.chunk_id)

            unique_results.append(item)



        # Keep only the best 5 results

        filtered_rag_results = unique_results[:5]



        # ---------------------------------------------------------

        # Remove duplicate chunks

        # ---------------------------------------------------------



        unique_results = []

        seen_chunks = set()



        for item in filtered_rag_results:

            if item.chunk_id in seen_chunks:

                continue



            seen_chunks.add(item.chunk_id)

            unique_results.append(item)



        # Keep best 5 results

        filtered_rag_results = unique_results[:5]



        # ---------------------------------------------------------

        # Confidence handling

        # ---------------------------------------------------------



        confidence = result.get("confidence")



        if confidence is not None:

            if confidence < 0.50:

                result["identification_status"] = "uncertain"



            elif confidence < 0.80:

                result["identification_status"] = "uncertain"



        # ---------------------------------------------------------

        # Final response

        # ---------------------------------------------------------



        return {

            "success": True,

            "result": result,

            "forest_knowledge": [

                {

                    "chunk_id": item.chunk_id,

                    "document_id": item.document_id,

                    "text": item.text,

                    "score": item.relevance_score,

                    "source_reference": item.source_reference,

                    "book_title": item.book_title,

                    "section_title": item.section_title,

                    "chapter_title": item.chapter_title,

                    "page_number": item.page_number,

                    "page_end": item.page_end,

                }

                for item in filtered_rag_results

            ],

        }



    except ValueError as exc:

        raise HTTPException(

            status_code=status.HTTP_400_BAD_REQUEST,

            detail=str(exc),

        ) from exc



    except Exception:

        logger.exception(

            "Species identification failed for file %s",

            image.filename,

        )



        raise HTTPException(

            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,

            detail="Unable to identify species from the image.",

        )



    except ValueError as exc:

        raise HTTPException(

            status_code=status.HTTP_400_BAD_REQUEST,

            detail=str(exc),

        ) from exc



    except Exception:

        logger.exception(

            "Species identification failed for file %s",

            image.filename,

        )



        raise HTTPException(

            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,

            detail="Unable to identify species from the image.",

        )





@router.post(

    "/forms/patrol",

    response_model=PatrolReportSaveResponse,

)

async def save_patrol_report_draft(

    payload: PatrolReportSaveRequest,

    user: User = Depends(require_field_officer),

    session: AsyncSession = Depends(get_db_session),

) -> PatrolReportSaveResponse:

    """

    Save an editable Field Officer patrol report as a draft.

    """



    report = FieldPatrolReport(

        officer_id=user.id,

        status="DRAFT",

        patrol_date=payload.patrol_date,

        beat=payload.beat,

        range_name=payload.range_name,

        division=payload.division,

        start_time=payload.start_time,

        end_time=payload.end_time,

        location=payload.location,

        team_members=payload.team_members,

        purpose=payload.purpose,

        observations=payload.observations,

        wildlife_sighting=payload.wildlife_sighting,

        illegal_activity=payload.illegal_activity,

        action_taken=payload.action_taken,

        incident_details=payload.incident_details,

        additional_remarks=payload.additional_remarks,

        source_text=payload.source_text,

        ai_confidence=payload.ai_confidence,

    )



    session.add(report)



    try:

        await session.commit()

        await session.refresh(report)



    except Exception:

        await session.rollback()



        logger.exception(

            "Failed to save patrol report draft for officer %s",

            user.id,

        )



        raise HTTPException(

            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,

            detail="Unable to save patrol report draft.",

        )



    return PatrolReportSaveResponse(

        success=True,

        report_id=str(report.id),

        form_type="PATROL_REPORT",

        status=report.status,

        message="Patrol report draft saved successfully.",

    )



@router.post(

    "/forms/incident",

    response_model=IncidentReportSaveResponse,

)

async def save_incident_report_draft(

    payload: IncidentReportSaveRequest,

    user: User = Depends(require_field_officer),

    session: AsyncSession = Depends(get_db_session),

) -> IncidentReportSaveResponse:

    """

    Save an editable Field Officer incident report as a draft.

    """



    report = IncidentReport(

        officer_id=user.id,

        status="DRAFT",

        incident_date=payload.incident_date,

        incident_time=payload.incident_time,

        division=payload.division,

        range_name=payload.range_name,

        beat=payload.beat,

        location=payload.location,

        incident_type=payload.incident_type,

        reported_by=payload.reported_by,

        persons_involved=payload.persons_involved,

        wildlife_involved=payload.wildlife_involved,

        incident_description=payload.incident_description,

        immediate_action_taken=payload.immediate_action_taken,

        authorities_informed=payload.authorities_informed,

        injury_or_damage=payload.injury_or_damage,

        evidence_details=payload.evidence_details,

        additional_remarks=payload.additional_remarks,

        source_text=payload.source_text,

    )



    session.add(report)



    try:

        await session.commit()

        await session.refresh(report)



    except Exception:

        await session.rollback()



        logger.exception(

            "Failed to save incident report draft for officer %s",

            user.id,

        )



        raise HTTPException(

            status_code=500,

            detail="Unable to save incident report draft.",

        )



    return IncidentReportSaveResponse(

        success=True,

        incident_id=str(report.id),

        form_type="INCIDENT_REPORT",

        status=report.status,

        message="Incident report draft saved successfully.",

    )



@router.post(

    "/forms/offence-seizure",

    response_model=OffenceSeizureReportSaveResponse,

)

async def save_offence_seizure_report_draft(

    payload: OffenceSeizureReportCreate,

    user: User = Depends(require_field_officer),

    session: AsyncSession = Depends(get_db_session),

) -> OffenceSeizureReportSaveResponse:

    """

    Save an editable Field Officer Offence & Seizure Report as a draft.

    """



    fields = payload.fields



    report = OffenceSeizureReport(

        officer_id=user.id,

        status="DRAFT",

        offence_date=fields.offence_date,

        offence_time=fields.offence_time,

        division=fields.division,

        range_name=fields.range_name,

        beat=fields.beat,

        location=fields.location,

        offence_type=fields.offence_type,

        applicable_law=fields.applicable_law,

        applicable_section=fields.applicable_section,

        persons_involved=fields.persons_involved,

        seized_material=fields.seized_material,

        seizure_location=fields.seizure_location,

        seizure_date=fields.seizure_date,

        seizure_time=fields.seizure_time,

        vehicle_details=fields.vehicle_details,

        vehicle_registration_number=fields.vehicle_registration_number,

        evidence_details=fields.evidence_details,

        witnesses=fields.witnesses,

        action_taken=fields.action_taken,

        authorities_informed=fields.authorities_informed,

        case_reference_number=fields.case_reference_number,

        fir_number=fields.fir_number,

        incident_reference_id=fields.incident_reference_id,

        description=fields.description,

        additional_remarks=fields.additional_remarks,

        ai_confidence=fields.ai_confidence,

    )



    session.add(report)



    try:

        await session.commit()

        await session.refresh(report)



    except Exception:

        await session.rollback()



        logger.exception(

            "Failed to save Offence & Seizure Report draft for officer %s",

            user.id,

        )



        raise HTTPException(

            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,

            detail="Unable to save Offence & Seizure Report draft.",

        )



    return {
        "success": True,
        "report_id": str(report.id),
        "form_type": "OFFENCE_SEIZURE",
        "status": report.status,
        "message": "Offence & Seizure Report draft saved successfully.",
    }



@router.get(

    "/forms/incident",

    response_model=IncidentReportListResponse,

)

async def list_incident_reports(

    user: User = Depends(require_field_officer),

    session: AsyncSession = Depends(get_db_session),

) -> IncidentReportListResponse:

    """

    Return all incident reports created by the logged-in Field Officer.

    """



    result = await session.execute(

        select(IncidentReport)

        .where(IncidentReport.officer_id == user.id)

        .order_by(IncidentReport.created_at.desc())

    )



    reports = result.scalars().all()



    items = [

        IncidentReportItem(

            incident_id=str(report.id),

            form_type="INCIDENT_REPORT",

            status=report.status,

            review_status=report.review_status,

            review_comment=report.review_comment,

            reviewed_by=(

                str(report.reviewed_by)

                if report.reviewed_by

                else None

            ),

            reviewed_at=(

                report.reviewed_at.isoformat()

                if report.reviewed_at

                else None

            ),

            incident_date=report.incident_date,

            incident_time=report.incident_time,

            division=report.division,

            range_name=report.range_name,

            beat=report.beat,

            location=report.location,

            incident_type=report.incident_type,

            reported_by=report.reported_by,

            persons_involved=report.persons_involved or [],

            wildlife_involved=report.wildlife_involved,

            incident_description=report.incident_description,

            immediate_action_taken=report.immediate_action_taken,

            authorities_informed=report.authorities_informed,

            injury_or_damage=report.injury_or_damage,

            evidence_details=report.evidence_details,

            additional_remarks=report.additional_remarks,

            source_text=report.source_text,

            created_at=(

                report.created_at.isoformat()

                if report.created_at

                else None

            ),

            updated_at=(

                report.updated_at.isoformat()

                if report.updated_at

                else None

            ),

            submitted_at=(

                report.submitted_at.isoformat()

                if report.submitted_at

                else None

            ),

        )

        for report in reports

    ]



    return IncidentReportListResponse(

        success=True,

        incidents=items,

        total=len(items),

    )



@router.put(

    "/forms/incident/{incident_id}",

    response_model=IncidentReportSaveResponse,

)

async def update_incident_report_draft(

    incident_id: UUID,

    payload: IncidentReportSaveRequest,

    user: User = Depends(require_field_officer),

    session: AsyncSession = Depends(get_db_session),

) -> IncidentReportSaveResponse:

    """

    Update an existing Incident Report draft owned by the logged-in

    Field Officer.

    """



    report = await session.get(IncidentReport, incident_id)



    if not report:

        raise HTTPException(

            status_code=404,

            detail="Incident report not found.",

        )



    if report.officer_id != user.id:

        raise HTTPException(

            status_code=403,

            detail="You are not allowed to update this incident report.",

        )



    if report.status != "DRAFT":

        raise HTTPException(

            status_code=400,

            detail="Only draft incident reports can be updated.",

        )



    report.incident_date = payload.incident_date

    report.incident_time = payload.incident_time

    report.division = payload.division

    report.range_name = payload.range_name

    report.beat = payload.beat

    report.location = payload.location

    report.incident_type = payload.incident_type

    report.reported_by = payload.reported_by

    report.persons_involved = payload.persons_involved

    report.wildlife_involved = payload.wildlife_involved

    report.incident_description = payload.incident_description

    report.immediate_action_taken = payload.immediate_action_taken

    report.authorities_informed = payload.authorities_informed

    report.injury_or_damage = payload.injury_or_damage

    report.evidence_details = payload.evidence_details

    report.additional_remarks = payload.additional_remarks

    report.source_text = payload.source_text



    try:

        await session.commit()

        await session.refresh(report)



    except Exception:

        await session.rollback()



        logger.exception(

            "Failed to update incident report %s for officer %s",

            incident_id,

            user.id,

        )



        raise HTTPException(

            status_code=500,

            detail="Unable to update incident report draft.",

        )



    return IncidentReportSaveResponse(

        success=True,

        incident_id=str(report.id),

        form_type="INCIDENT_REPORT",

        status=report.status,

        message="Incident report draft updated successfully.",

    )



@router.put(

    "/forms/offence-seizure/{report_id}",

    response_model=OffenceSeizureReportSaveResponse

)

async def update_offence_seizure_report_draft(

    report_id: UUID,

    payload: OffenceSeizureReportUpdate,

    user: User = Depends(require_field_officer),

    session: AsyncSession = Depends(get_db_session),

) -> OffenceSeizureReportResponse:

    """

    Update an existing Offence & Seizure Report draft owned by the

    logged-in Field Officer.

    """



    report = await session.get(OffenceSeizureReport, report_id)



    if not report:

        raise HTTPException(

            status_code=404,

            detail="Offence & Seizure Report not found.",

        )



    if report.officer_id != user.id:

        raise HTTPException(

            status_code=403,

            detail="You are not allowed to update this Offence & Seizure Report.",

        )



    if report.status != "DRAFT":

        raise HTTPException(

            status_code=400,

            detail="Only draft Offence & Seizure Reports can be updated.",

        )



    fields = payload.fields



    report.offence_date = fields.offence_date

    report.offence_time = fields.offence_time

    report.division = fields.division

    report.range_name = fields.range_name

    report.beat = fields.beat

    report.location = fields.location

    report.offence_type = fields.offence_type

    report.applicable_law = fields.applicable_law

    report.applicable_section = fields.applicable_section

    report.persons_involved = fields.persons_involved

    report.seized_material = fields.seized_material

    report.seizure_location = fields.seizure_location

    report.seizure_date = fields.seizure_date

    report.seizure_time = fields.seizure_time

    report.vehicle_details = fields.vehicle_details

    report.vehicle_registration_number = fields.vehicle_registration_number

    report.evidence_details = fields.evidence_details

    report.witnesses = fields.witnesses

    report.action_taken = fields.action_taken

    report.authorities_informed = fields.authorities_informed

    report.case_reference_number = fields.case_reference_number

    report.fir_number = fields.fir_number

    report.incident_reference_id = fields.incident_reference_id

    report.description = fields.description

    report.additional_remarks = fields.additional_remarks

    report.ai_confidence = fields.ai_confidence



    try:

        await session.commit()

        await session.refresh(report)



    except Exception:

        await session.rollback()



        logger.exception(

            "Failed to update Offence & Seizure Report %s for officer %s",

            report_id,

            user.id,

        )



        raise HTTPException(

            status_code=500,

            detail="Unable to update Offence & Seizure Report draft.",

        )



    return OffenceSeizureReportSaveResponse(
    success=True,
    report_id=str(report.id),
    form_type="OFFENCE_SEIZURE",
    status=report.status,
    message="Offence & Seizure Report draft updated successfully.",
)    


@router.get(
    "/forms/offence-seizure/{report_id}",
    response_model=OffenceSeizureReportResponse,
)
async def get_offence_seizure_report(
    report_id: UUID,
    user: User = Depends(require_field_officer),
    session: AsyncSession = Depends(get_db_session),
) -> OffenceSeizureReportResponse:
    """Fetch an Offence & Seizure Report owned by the logged-in officer."""

    report = await session.get(OffenceSeizureReport, report_id)

    if not report:
        raise HTTPException(
            status_code=404,
            detail="Offence & Seizure Report not found.",
        )

    if report.officer_id != user.id:
        raise HTTPException(
            status_code=403,
            detail="You are not allowed to access this report.",
        )

    return OffenceSeizureReportResponse.model_validate(report)


@router.post(

    "/forms/incident/{incident_id}/submit",

    response_model=IncidentReportSubmitResponse,

)

async def submit_incident_report(

    incident_id: UUID,

    user: User = Depends(require_field_officer),

    session: AsyncSession = Depends(get_db_session),

) -> IncidentReportSubmitResponse:

    """

    Submit an Incident Report draft created by the logged-in

    Field Officer.

    """



    report = await session.get(IncidentReport, incident_id)



    if not report:

        raise HTTPException(

            status_code=404,

            detail="Incident report not found.",

        )



    if report.officer_id != user.id:

        raise HTTPException(

            status_code=403,

            detail="You are not allowed to submit this incident report.",

        )



    if report.status != "DRAFT":

        raise HTTPException(

            status_code=400,

            detail="Only draft incident reports can be submitted.",

        )



    required_fields = {

        "incident_date": report.incident_date,

        "range_name": report.range_name,

        "beat": report.beat,

        "location": report.location,

        "incident_type": report.incident_type,

        "incident_description": report.incident_description,

        "immediate_action_taken": report.immediate_action_taken,

    }



    missing_fields = [

        field_name

        for field_name, value in required_fields.items()

        if value in (None, "")

    ]



    if missing_fields:

        raise HTTPException(

            status_code=422,

            detail={

                "message": "Please complete all required fields before submitting.",

                "missing_fields": missing_fields,

            },

        )



    report.status = "SUBMITTED"

    report.submitted_at = datetime.now(timezone.utc)



    try:

        await session.commit()

        await session.refresh(report)



    except Exception:

        await session.rollback()



        logger.exception(

            "Failed to submit incident report %s for officer %s",

            incident_id,

            user.id,

        )



        raise HTTPException(

            status_code=500,

            detail="Unable to submit incident report.",

        )



    return IncidentReportSubmitResponse(

        success=True,

        incident_id=str(report.id),

        form_type="INCIDENT_REPORT",

        status=report.status,

        submitted_at=report.submitted_at.isoformat(),

        message="Incident report submitted successfully.",

    )



@router.post(

    "/forms/offence-seizure/{report_id}/submit",

    response_model=OffenceSeizureReportSubmitResponse,

)

async def submit_offence_seizure_report(

    report_id: UUID,

    user: User = Depends(require_field_officer),

    session: AsyncSession = Depends(get_db_session),

) -> OffenceSeizureReportSubmitResponse:

    report = await session.get(OffenceSeizureReport, report_id)



    if not report:

        raise HTTPException(

            status_code=404,

            detail="Offence & Seizure Report not found.",

        )



    if report.officer_id != user.id:

        raise HTTPException(

            status_code=403,

            detail="You are not allowed to submit this Offence & Seizure Report.",

        )



    if report.status != "DRAFT":

        raise HTTPException(

            status_code=400,

            detail="Only draft Offence & Seizure Reports can be submitted.",

        )



    required_fields = {

        "offence_date": report.offence_date,

        "range_name": report.range_name,

        "beat": report.beat,

        "offence_type": report.offence_type,

        "description": report.description,

        "action_taken": report.action_taken,

    }



    missing_fields = [

        field_name

        for field_name, value in required_fields.items()

        if value in (None, "")

    ]



    if missing_fields:

        raise HTTPException(

            status_code=422,

            detail={

                "message": "Please complete all required fields before submitting.",

                "missing_fields": missing_fields,

            },

        )



    report.status = "SUBMITTED"

    report.submitted_at = datetime.now(timezone.utc)



    try:

        await session.commit()

        await session.refresh(report)

    except Exception:

        await session.rollback()

        logger.exception(

            "Failed to submit Offence & Seizure Report %s for officer %s",

            report_id,

            user.id,

        )

        raise HTTPException(

            status_code=500,

            detail="Unable to submit Offence & Seizure Report.",

        )



    return OffenceSeizureReportSubmitResponse(

        success=True,

        message="Offence & Seizure Report submitted successfully.",

        report_id=report.id,

    )    



@router.delete("/forms/incident/{incident_id}")

async def delete_incident_report(

    incident_id: UUID,

    user: User = Depends(require_field_officer),

    session: AsyncSession = Depends(get_db_session),

):

    report = await session.get(IncidentReport, incident_id)



    if not report:

        raise HTTPException(

            status_code=404,

            detail="Incident report not found",

        )



    # Officer can delete only their own report

    if report.officer_id != user.id:

        raise HTTPException(

            status_code=403,

            detail="You are not allowed to delete this incident report",

        )



    # Only drafts can be deleted

    if report.status != "DRAFT":

        raise HTTPException(

            status_code=400,

            detail="Only draft incident reports can be deleted",

        )



    try:

        await session.delete(report)

        await session.commit()

    except Exception:

        await session.rollback()

        raise HTTPException(

            status_code=500,

            detail="Unable to delete incident report",

        )



    return {

        "success": True,

        "incident_id": str(incident_id),

        "message": "Incident report draft deleted successfully.",

    }



@router.get(

    "/forms/patrol",

    response_model=PatrolReportDraftListResponse,

)

async def list_patrol_report_drafts(

    user: User = Depends(require_field_officer),

    session: AsyncSession = Depends(get_db_session),

) -> PatrolReportDraftListResponse:

    """

    Return all patrol reports belonging to the logged-in Field Officer.



    Includes:

    - DRAFT

    - SUBMITTED



    Reports are ordered by latest update first.

    """



    result = await session.execute(

        select(FieldPatrolReport)

        .where(

            FieldPatrolReport.officer_id == user.id,

        )

        .order_by(FieldPatrolReport.updated_at.desc())

    )



    reports = result.scalars().all()



    items = [

        PatrolReportDraftItem(

            report_id=str(report.id),

            form_type="PATROL_REPORT",

            status=report.status,



            review_status=report.review_status,

            review_comment=report.review_comment,

            reviewed_by=(

                str(report.reviewed_by)

                if report.reviewed_by

                else None

            ),

            reviewed_at=(

                report.reviewed_at.isoformat()

                if report.reviewed_at

                else None

            ),



            patrol_date=report.patrol_date,

            beat=report.beat,

            range_name=report.range_name,

            division=report.division,



            start_time=report.start_time,

            end_time=report.end_time,



            location=report.location,

            team_members=report.team_members or [],



            purpose=report.purpose,

            observations=report.observations,

            wildlife_sighting=report.wildlife_sighting,

            illegal_activity=report.illegal_activity,

            action_taken=report.action_taken,

            incident_details=report.incident_details,

            additional_remarks=report.additional_remarks,



            source_text=report.source_text,

            ai_confidence=report.ai_confidence,



            created_at=(

                report.created_at.isoformat()

                if report.created_at

                else None

            ),



            updated_at=(

                report.updated_at.isoformat()

                if report.updated_at

                else None

            ),

        )

        for report in reports

    ]



    return PatrolReportDraftListResponse(

        success=True,

        reports=items,

        total=len(items),

    )



@router.put(

    "/forms/patrol/{report_id}",

    response_model=PatrolReportSaveResponse,

)

async def update_patrol_report_draft(

    report_id: UUID,

    payload: PatrolReportSaveRequest,

    user: User = Depends(require_field_officer),

    session: AsyncSession = Depends(get_db_session),

) -> PatrolReportSaveResponse:

    """Update an existing patrol report draft owned by the logged-in officer."""



    result = await session.execute(

        select(FieldPatrolReport).where(

            FieldPatrolReport.id == report_id,

            FieldPatrolReport.officer_id == user.id,



        )

    )



    report = result.scalar_one_or_none()



    if report is None:

        raise HTTPException(

            status_code=status.HTTP_404_NOT_FOUND,

            detail="Patrol report draft not found.",

        )



    report.patrol_date = payload.patrol_date

    report.beat = payload.beat

    report.range_name = payload.range_name

    report.division = payload.division



    report.start_time = payload.start_time

    report.end_time = payload.end_time



    report.location = payload.location

    report.team_members = payload.team_members



    report.purpose = payload.purpose

    report.observations = payload.observations

    report.wildlife_sighting = payload.wildlife_sighting

    report.illegal_activity = payload.illegal_activity

    report.action_taken = payload.action_taken

    report.incident_details = payload.incident_details

    report.additional_remarks = payload.additional_remarks



    report.source_text = payload.source_text

    report.ai_confidence = payload.ai_confidence



    try:

        await session.commit()

        await session.refresh(report)



    except Exception:

        await session.rollback()



        logger.exception(

            "Failed to update patrol report draft %s for officer %s",

            report_id,

            user.id,

        )



        raise HTTPException(

            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,

            detail="Unable to update patrol report draft.",

        )



    return PatrolReportSaveResponse(

        success=True,

        report_id=str(report.id),

        form_type="PATROL_REPORT",

        status=report.status,

        message="Patrol report draft updated successfully.",

    )




# ============================================================
# FIELD OFFICER - EVIDENCE UPLOAD
# ============================================================

@router.post("/evidence/upload")
async def upload_evidence(
    report_type: str = Form(...),
    report_id: UUID = Form(...),
    file: UploadFile = File(...),
    description: str | None = Form(None),
    user: User = Depends(require_field_officer),
    session: AsyncSession = Depends(get_db_session),
):
    """
    Upload evidence/photo for a Field Officer report.

    Supported report types:
    - PATROL
    - INCIDENT
    - OFFENCE_SEIZURE

    Supported files:
    - JPG/JPEG
    - PNG
    - WEBP
    - PDF

    Maximum file size: 10 MB.
    """

    allowed_report_types = {
        "PATROL",
        "INCIDENT",
        "OFFENCE_SEIZURE",
    }

    report_type = report_type.strip().upper()

    if report_type not in allowed_report_types:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Invalid report type. Allowed values: "
                "PATROL, INCIDENT, OFFENCE_SEIZURE."
            ),
        )

    original_filename = (file.filename or "").strip()

    if not original_filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File name is required.",
        )

    extension = Path(original_filename).suffix.lower()

    allowed_files = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".pdf": "application/pdf",
    }

    if extension not in allowed_files:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Unsupported file type. Allowed files: "
                "JPG, JPEG, PNG, WEBP, PDF."
            ),
        )

    expected_mime_type = allowed_files[extension]

    if file.content_type != expected_mime_type:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File MIME type does not match the file extension.",
        )

    max_file_size = 10 * 1024 * 1024  # 10 MB

    file_content = await file.read()

    if not file_content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty.",
        )

    if len(file_content) > max_file_size:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="File size must not exceed 10 MB.",
        )

    # ---------------------------------------------------------
    # Verify that the report exists and belongs to this officer.
    # ---------------------------------------------------------

    report = None

    if report_type == "PATROL":
        result = await session.execute(
            select(FieldPatrolReport).where(
                FieldPatrolReport.id == report_id,
                FieldPatrolReport.officer_id == user.id,
            )
        )
        report = result.scalar_one_or_none()

    elif report_type == "INCIDENT":
        result = await session.execute(
            select(IncidentReport).where(
                IncidentReport.id == report_id,
                IncidentReport.officer_id == user.id,
            )
        )
        report = result.scalar_one_or_none()

    elif report_type == "OFFENCE_SEIZURE":
        result = await session.execute(
            select(OffenceSeizureReport).where(
                OffenceSeizureReport.id == report_id,
                OffenceSeizureReport.officer_id == user.id,
            )
        )
        report = result.scalar_one_or_none()

    if report is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Report not found or you do not have access to it.",
        )

    # ---------------------------------------------------------
    # Store the file using a random filename.
    # Never use the original filename as the storage filename.
    # ---------------------------------------------------------

    storage_dir = Path("uploads") / "evidence"
    storage_dir.mkdir(parents=True, exist_ok=True)

    storage_filename = f"{UUID(int=uuid.uuid4().int).hex}{extension}"
    storage_path = storage_dir / storage_filename

    try:
        storage_path.write_bytes(file_content)

        evidence = Evidence(
            report_type=report_type,
            report_id=report_id,
            officer_id=user.id,
            file_name=original_filename,
            storage_key=str(storage_path),
            file_type=extension.lstrip("."),
            file_size=len(file_content),
            mime_type=expected_mime_type,
            description=description.strip() if description else None,
        )

        session.add(evidence)
        await session.commit()
        await session.refresh(evidence)

    except Exception:
        await session.rollback()

        if storage_path.exists():
            try:
                storage_path.unlink()
            except OSError:
                logger.exception(
                    "Failed to remove evidence file after database error."
                )

        logger.exception(
            "Failed to save evidence for report %s",
            report_id,
        )

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to upload evidence.",
        )

    return {
        "success": True,
        "message": "Evidence uploaded successfully.",
        "evidence": {
            "id": str(evidence.id),
            "report_type": evidence.report_type,
            "report_id": str(evidence.report_id),
            "file_name": evidence.file_name,
            "file_type": evidence.file_type,
            "file_size": evidence.file_size,
            "mime_type": evidence.mime_type,
            "description": evidence.description,
            "uploaded_at": (
                evidence.uploaded_at.isoformat()
                if evidence.uploaded_at
                else None
            ),
        },
    }

@router.get("/evidence/{evidence_id}/file")
async def get_evidence_file(
    evidence_id: UUID,
    user: User = Depends(require_field_officer),
    session: AsyncSession = Depends(get_db_session),
):
    """
    Return an uploaded evidence file.
    """

    result = await session.execute(
        select(Evidence).where(
            Evidence.id == evidence_id,
            Evidence.officer_id == user.id,
        )
    )

    evidence = result.scalar_one_or_none()

    if evidence is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence not found or you do not have access to it.",
        )

    storage_path = Path(evidence.storage_key)

    if not storage_path.exists() or not storage_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence file is not available.",
        )

    return FileResponse(
        path=storage_path,
        media_type=evidence.mime_type,
        filename=evidence.file_name,
    )
    
@router.delete("/evidence/{evidence_id}")
async def delete_evidence(
    evidence_id: UUID,
    user: User = Depends(require_field_officer),
    session: AsyncSession = Depends(get_db_session),
):
    evidence = await session.execute(
        select(Evidence).where(
            Evidence.id == evidence_id,
            Evidence.officer_id == user.id,
        )
    )

    evidence = evidence.scalar_one_or_none()

    if evidence is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence not found or you do not have access to it.",
        )

    storage_path = Path(evidence.storage_key)

    try:
        await session.delete(evidence)
        await session.commit()
    except Exception:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to delete evidence.",
        )

    if storage_path.exists() and storage_path.is_file():
        try:
            storage_path.unlink()
        except OSError:
            logger.exception(
                "Failed to delete evidence file from storage: %s",
                storage_path,
            )

    return {
        "success": True,
        "evidence_id": str(evidence_id),
        "message": "Evidence deleted successfully.",
    }      
    
@router.get("/evidence/{report_type}/{report_id}")
async def get_evidence(
    report_type: str,
    report_id: UUID,
    user: User = Depends(require_field_officer),
    session: AsyncSession = Depends(get_db_session),
):
    """
    Get all evidence files attached to a Field Officer report.
    """

    allowed_report_types = {
        "PATROL",
        "INCIDENT",
        "OFFENCE_SEIZURE",
    }

    report_type = report_type.strip().upper()

    if report_type not in allowed_report_types:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Invalid report type. Allowed values: "
                "PATROL, INCIDENT, OFFENCE_SEIZURE."
            ),
        )

    result = await session.execute(
        select(Evidence)
        .where(
            Evidence.report_type == report_type,
            Evidence.report_id == report_id,
            Evidence.officer_id == user.id,
        )
        .order_by(Evidence.uploaded_at.desc())
    )

    evidence_items = result.scalars().all()

    return {
        "success": True,
        "report_type": report_type,
        "report_id": str(report_id),
        "count": len(evidence_items),
        "evidence": [
            {
                "id": str(item.id),
                "file_name": item.file_name,
                "file_type": item.file_type,
                "file_size": item.file_size,
                "mime_type": item.mime_type,
                "description": item.description,
                "uploaded_at": (
                    item.uploaded_at.isoformat()
                    if item.uploaded_at
                    else None
                ),
            }
            for item in evidence_items
        ],
    }


@router.post("/chat", response_model=RagChatResponse)

async def field_chat(

    payload: RagChatRequest,

    settings: SettingsDep,

    session: AsyncSession = Depends(get_db_session),

    _: User = Depends(require_field_officer),

) -> _RagChatResponse_:

    """Answer a Field Officer question using FIELD-domain documents only."""



    language_code = detect_language(payload.question)

    language_name = _language_name(language_code)



    try:

        results = await RAGService(session, settings).retrieve(

            payload.question,

            {

                "domain": "FIELD",

                "query_language": language_code,

            },

        )

    except Exception:

        logger.exception("Field Officer retrieval failed")



        raise HTTPException(

            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,

            detail="Unable to retrieve field information.",

        )



    if not results:

        return RagChatResponse(

            answer=_not_found_message(language_code),

            found=False,

            sources=[],

        )



    context, source_map = build_context(

        results[: settings.rag_context_top_k],

        settings.rag_max_context_chars,

    )



    if not context:

        return RagChatResponse(

            answer=_insufficient_context_message(language_code),

            found=False,

            sources=[],

        )



    source_lines = "\n".join(

        f"[{source_id}] document={item.filename} "

        f"pdf_page={item.page_number or 'unknown'} "

        f"chunk_id={item.chunk_id}"

        for source_id, item in source_map.items()

    )



    prompt = (

        "Answer the Field Officer's question using ONLY the supplied "

        "Field Officer document context.\n\n"



        f"REQUIRED RESPONSE LANGUAGE: {language_name}\n\n"



        "LANGUAGE RULES:\n"

        f"1. The user's question was detected as {language_name}.\n"

        f"2. Write the answer entirely in {language_name}.\n"

        "3. Do not translate the answer into another language.\n"

        "4. Do not switch to English when the requested language is Hindi.\n"

        "5. Technical terms, document names, official names, laws, "

        "section names and proper nouns may remain in their original "

        "form when necessary.\n"

        "6. The JSON field \`answer\` must contain the answer in the "

        "required response language.\n"

        "7. The JSON field \`key_points\` must also use the required "

        "response language.\n\n"



        "GROUNDING RULES:\n"

        "8. Use ONLY the supplied Field Officer document context.\n"

        "9. Do not use outside knowledge.\n"

        "10. If the context does not answer the question, do not invent "

        "an answer. Set grounded to false and citations to an empty array.\n"

        "11. citations must contain ONLY source IDs from the supplied "

        "SOURCE INDEX.\n\n"



        "OUTPUT RULES:\n"

        "12. Return ONLY the JSON shape required by the system prompt.\n"

        "13. Do not add markdown fences.\n"

        "14. Do not add explanations outside the JSON object.\n\n"



        f"DOCUMENT CONTEXT:\n{context}\n\n"

        f"SOURCE INDEX:\n{source_lines}\n\n"

        f"QUESTION:\n{payload.question}"

    )



    try:

        raw = await MistralLLMProvider(settings).generate(

            system=FIELD_OFFICER_SYSTEM_PROMPT,

            user=prompt,

        )

    except Exception:

        logger.exception("Field Officer LLM generation failed")



        raise HTTPException(

            status_code=status.HTTP_502_BAD_GATEWAY,

            detail="Unable to generate a grounded field response.",

        )



    try:

        generation = TutorGeneration.model_validate(

            _extract_json(raw)

        )



    except Exception:

        logger.warning(

            "Field Officer LLM returned invalid JSON. Attempting repair."

        )



        repair_prompt = (

            "Repair the previous Field Officer response and return ONLY "

            "valid JSON matching this exact schema:\n\n"

            '{"answer":"string",'

            '"language":"hi|en",'

            '"key_points":["string"],'

            '"citations":["source-1"],'

            '"grounded":true}\n\n'



            f"REQUIRED RESPONSE LANGUAGE: {language_name}\n\n"



            "LANGUAGE RULES:\n"

            f"1. The answer MUST be written entirely in {language_name}.\n"

            "2. Do not switch languages.\n"

            "3. key_points must also be written in the same language.\n"

            "4. Preserve technical terms and official names when "

            "appropriate.\n\n"



            "GROUNDING RULES:\n"

            "5. Use ONLY information supported by the original "

            "Field Officer document context.\n"

            "6. Do not introduce outside knowledge.\n"

            "7. citations must contain ONLY supplied source IDs.\n"

            "8. grounded must be true only when the answer is "

            "supported by the supplied context.\n"

            "9. If the previous response is unsupported, return an "

            "appropriately grounded response with grounded=false and "

            "citations=[] rather than inventing information.\n"

            "10. Do not add markdown fences or explanations.\n\n"



            f"Original user question:\n{payload.question}\n\n"

            f"Detected language:\n{language_name}\n\n"

            f"Available source IDs:\n{', '.join(source_map.keys())}\n\n"

            f"Previous response:\n{raw}"

        )



        try:

            repaired_raw = await MistralLLMProvider(settings).generate(

                system=FIELD_OFFICER_SYSTEM_PROMPT,

                user=repair_prompt,

            )



            generation = TutorGeneration.model_validate(

                _extract_json(repaired_raw)

            )



        except Exception:

            logger.exception(

                "Field Officer LLM JSON validation/repair failed"

            )



            return RagChatResponse(

                answer=_generation_failed_message(language_code),

                found=False,

                sources=[],

            )



    valid_ids = set(source_map)



    source_ids = [

        source_id

        for source_id in generation.citations

        if source_id in valid_ids

    ]



    if (

        not generation.grounded

        or not source_ids

        or not generation.answer.strip()

    ):

        return RagChatResponse(

            answer=_insufficient_context_message(language_code),

            found=False,

            sources=[],

        )



    return RagChatResponse(

        answer=generation.answer.strip(),

        found=True,

        sources=[

            {

                "filename": source_map[source_id].filename,

                "page": source_map[source_id].page_number or 0,

                "score": source_map[source_id].fusion_score,

                "snippet": source_map[source_id].text[:300],

            }

            for source_id in source_ids[: settings.rag_max_citations]

        ],

    )



@router.post(

    "/forms/patrol/{report_id}/submit",

    response_model=PatrolReportSubmitResponse,

)

async def submit_patrol_report(

    report_id: UUID,

    user: User = Depends(require_field_officer),

    session: AsyncSession = Depends(get_db_session),

) -> PatrolReportSubmitResponse:

    """

    Submit a patrol report.



    Only the Field Officer who owns the draft can submit it.

    A report can only move from DRAFT to SUBMITTED.

    """



    report = await session.get(FieldPatrolReport, report_id)



    if not report:

        raise HTTPException(

            status_code=status.HTTP_404_NOT_FOUND,

            detail="Patrol report not found.",

        )



    if report.officer_id != user.id:

        raise HTTPException(

            status_code=status.HTTP_403_FORBIDDEN,

            detail="You are not authorized to submit this patrol report.",

        )



    if report.status != "DRAFT":

        raise HTTPException(

            status_code=status.HTTP_409_CONFLICT,

            detail="Only draft patrol reports can be submitted.",

        )



    required_fields = {

        "patrol_date": report.patrol_date,

        "beat": report.beat,

        "start_time": report.start_time,

        "end_time": report.end_time,

        "location": report.location,

        "purpose": report.purpose,

    }



    missing_fields = [

        field_name

        for field_name, value in required_fields.items()

        if value is None or (isinstance(value, str) and not value.strip())

    ]



    if missing_fields:

        raise HTTPException(

            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,

            detail={

                "message": "Please complete all required patrol report fields.",

                "missing_fields": missing_fields,

            },

        )



    if report.start_time and report.end_time:

        if report.end_time <= report.start_time:

            raise HTTPException(

                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,

                detail="End time must be later than start time.",

            )



    submitted_at = datetime.now(timezone.utc)



    report.status = "SUBMITTED"

    report.submitted_at = submitted_at



    try:

        await session.commit()

        await session.refresh(report)



    except Exception:

        await session.rollback()



        logger.exception(

            "Failed to submit patrol report %s for officer %s",

            report_id,

            user.id,

        )



        raise HTTPException(

            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,

            detail="Unable to submit patrol report.",

        )



    return PatrolReportSubmitResponse(

        success=True,

        report_id=str(report.id),

        form_type="PATROL_REPORT",

        status=report.status,

        submitted_at=report.submitted_at.isoformat(),

        message="Patrol report submitted successfully.",

    )



@router.post(

    "/forms/daily-diary",

    response_model=DailyDiarySaveResponse,

)

async def save_daily_diary_draft(

    payload: DailyDiarySaveRequest,

    user: User = Depends(require_field_officer),

    session: AsyncSession = Depends(get_db_session),

) -> DailyDiarySaveResponse:

    diary = DailyDiary(

        officer_id=user.id,

        status="DRAFT",

        diary_date=payload.diary_date,

        subject=payload.subject,

        description=payload.description,

        location=payload.location,

        activities=payload.activities,

        observations=payload.observations,

        additional_remarks=payload.additional_remarks,

        source_text=payload.source_text,

    )



    session.add(diary)



    try:

        await session.commit()

        await session.refresh(diary)

    except Exception:

        await session.rollback()

        logger.exception("Failed to save daily diary draft")

        raise HTTPException(

            status_code=500,

            detail="Unable to save daily diary draft.",

        )



    return DailyDiarySaveResponse(

        success=True,

        diary_id=str(diary.id),

        form_type="DAILY_DIARY",

        status="DRAFT",

    )





@router.get(

    "/forms/daily-diary",

    response_model=DailyDiaryListResponse,

)

async def list_daily_diaries(

    user: User = Depends(require_field_officer),

    session: AsyncSession = Depends(get_db_session),

) -> DailyDiaryListResponse:

    result = await session.execute(

        select(DailyDiary)

        .where(DailyDiary.officer_id == user.id)

        .order_by(DailyDiary.updated_at.desc())

    )



    diaries = result.scalars().all()



    items = [

        DailyDiaryItem(

            diary_id=str(diary.id),

            form_type="DAILY_DIARY",

            status=diary.status,

            review_status=diary.review_status,

            review_comment=diary.review_comment,

            reviewed_by=(

                str(diary.reviewed_by)

                if diary.reviewed_by

                else None

            ),

            reviewed_at=(

                diary.reviewed_at.isoformat()

                if diary.reviewed_at

                else None

            ),

            diary_date=diary.diary_date,

            subject=diary.subject,

            description=diary.description,

            location=diary.location,

            activities=diary.activities or [],

            observations=diary.observations,

            additional_remarks=diary.additional_remarks,

            source_text=diary.source_text,

            created_at=(

                diary.created_at.isoformat()

                if diary.created_at

                else None

            ),

            updated_at=(

                diary.updated_at.isoformat()

                if diary.updated_at

                else None

            ),

            submitted_at=(

                diary.submitted_at.isoformat()

                if diary.submitted_at

                else None

            ),

        )

        for diary in diaries

    ]



    return DailyDiaryListResponse(

        success=True,

        diaries=items,

        total=len(items),

    )



@router.put(

    "/forms/daily-diary/{diary_id}",

    response_model=DailyDiarySaveResponse,

)

async def update_daily_diary_draft(

    diary_id: UUID,

    payload: DailyDiarySaveRequest,

    user: User = Depends(require_field_officer),

    session: AsyncSession = Depends(get_db_session),

) -> DailyDiarySaveResponse:

    result = await session.execute(

        select(DailyDiary).where(

            DailyDiary.id == diary_id,

            DailyDiary.officer_id == user.id,

        )

    )



    diary = result.scalar_one_or_none()



    if diary is None:

        raise HTTPException(

            status_code=404,

            detail="Daily diary not found.",

        )



    if diary.status != "DRAFT":

        raise HTTPException(

            status_code=400,

            detail="Only draft daily diaries can be edited.",

        )



    diary.diary_date = payload.diary_date

    diary.subject = payload.subject

    diary.description = payload.description

    diary.location = payload.location

    diary.activities = payload.activities

    diary.observations = payload.observations

    diary.additional_remarks = payload.additional_remarks

    diary.source_text = payload.source_text



    try:

        await session.commit()

        await session.refresh(diary)

    except Exception:

        await session.rollback()

        logger.exception("Failed to update daily diary draft")

        raise HTTPException(

            status_code=500,

            detail="Unable to update daily diary draft.",

        )



    return DailyDiarySaveResponse(

        success=True,

        diary_id=str(diary.id),

        form_type="DAILY_DIARY",

        status="DRAFT",

    )



@router.post(

    "/forms/daily-diary/{diary_id}/submit",

    response_model=DailyDiarySubmitResponse,

)

async def submit_daily_diary(

    diary_id: UUID,

    user: User = Depends(require_field_officer),

    session: AsyncSession = Depends(get_db_session),

) -> DailyDiarySubmitResponse:

    result = await session.execute(

        select(DailyDiary).where(

            DailyDiary.id == diary_id,

            DailyDiary.officer_id == user.id,

        )

    )



    diary = result.scalar_one_or_none()



    if diary is None:

        raise HTTPException(

            status_code=404,

            detail="Daily diary not found.",

        )



    if diary.status != "DRAFT":

        raise HTTPException(

            status_code=400,

            detail="Only draft daily diaries can be submitted.",

        )



    diary.status = "SUBMITTED"

    diary.submitted_at = datetime.now(timezone.utc)



    try:

        await session.commit()

        await session.refresh(diary)

    except Exception:

        await session.rollback()

        logger.exception("Failed to submit daily diary")

        raise HTTPException(

            status_code=500,

            detail="Unable to submit daily diary.",

        )



    return DailyDiarySubmitResponse(

        success=True,

        diary_id=str(diary.id),

        form_type="DAILY_DIARY",

        status="SUBMITTED",

        submitted_at=diary.submitted_at.isoformat(),

    )