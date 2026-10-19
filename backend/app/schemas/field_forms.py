"""Schemas for Field Officer form auto-fill workflows."""

from __future__ import annotations

from datetime import date, time,datetime
from uuid import UUID
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class PatrolReportFields(BaseModel):
    """Editable structured fields extracted from a patrol description."""

    model_config = ConfigDict(extra="ignore")

    patrol_date: date | None = None
    beat: str | None = None
    range_name: str | None = None
    division: str | None = None

    start_time: time | None = None
    end_time: time | None = None

    location: str | None = None
    team_members: list[str] = Field(default_factory=list)

    purpose: str | None = None
    observations: str | None = None
    wildlife_sighting: str | None = None
    illegal_activity: str | None = None
    action_taken: str | None = None
    incident_details: str | None = None
    additional_remarks: str | None = None


class PatrolReportExtractRequest(BaseModel):
    """Raw field description supplied by the officer."""

    text: str = Field(
        min_length=5,
        max_length=12000,
        description="Natural-language patrol description.",
    )
    language: str | None = Field(
        default=None,
        description="Optional language hint: hi or en.",
    )


class PatrolReportExtractResponse(BaseModel):
    """Structured patrol report extraction response."""

    success: bool = True
    form_type: str = "PATROL_REPORT"

    fields: PatrolReportFields

    missing_fields: list[str] = Field(default_factory=list)

    source_text: str

    confidence: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
    )

    message: str | None = None
    
class PatrolReportSaveRequest(PatrolReportFields):
    """Editable patrol report data submitted for draft persistence."""

    source_text: str | None = Field(
        default=None,
        max_length=12000,
    )

    ai_confidence: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
    )


class PatrolReportSaveResponse(BaseModel):
    """Saved patrol report draft response."""

    success: bool = True
    report_id: str
    form_type: str = "PATROL_REPORT"
    status: str = "DRAFT"
    message: str = "Patrol report draft saved successfully."

class PatrolReportSubmitResponse(BaseModel):
    """Submitted patrol report response."""

    success: bool = True
    report_id: str
    form_type: str = "PATROL_REPORT"
    status: str = "SUBMITTED"
    submitted_at: str
    message: str = "Patrol report submitted successfully."
    
class PatrolReportDraftItem(BaseModel):
    """Saved patrol report draft returned to the Field Officer."""

    report_id: str
    form_type: str = "PATROL_REPORT"
    status: str
    
    review_status: str | None = None
    review_comment: str | None = None
    reviewed_by: str | None = None
    reviewed_at: str | None = None

    patrol_date: date | None = None
    beat: str | None = None
    range_name: str | None = None
    division: str | None = None

    start_time: time | None = None
    end_time: time | None = None

    location: str | None = None
    team_members: list[str] = Field(default_factory=list)

    purpose: str | None = None
    observations: str | None = None
    wildlife_sighting: str | None = None
    illegal_activity: str | None = None
    action_taken: str | None = None
    incident_details: str | None = None
    additional_remarks: str | None = None

    source_text: str | None = None
    ai_confidence: float | None = None

    created_at: str | None = None
    updated_at: str | None = None


class PatrolReportDraftListResponse(BaseModel):
    """List of saved patrol report drafts."""

    success: bool = True
    reports: list[PatrolReportDraftItem] = Field(default_factory=list)
    total: int = 0


class IncidentReportFields(BaseModel):
    """Editable structured fields for a Field Officer incident report."""

    model_config = ConfigDict(extra="ignore")

    incident_date: date | None = None
    incident_time: time | None = None

    division: str | None = None
    range_name: str | None = None
    beat: str | None = None
    location: str | None = None

    incident_type: str | None = None
    reported_by: str | None = None

    persons_involved: list[str] = Field(default_factory=list)

    wildlife_involved: str | None = None
    incident_description: str | None = None
    immediate_action_taken: str | None = None
    authorities_informed: str | None = None
    injury_or_damage: str | None = None
    evidence_details: str | None = None
    additional_remarks: str | None = None


class IncidentReportExtractRequest(BaseModel):
    """Raw incident description supplied by the officer."""

    text: str = Field(
        min_length=5,
        max_length=12000,
        description="Natural-language incident description.",
    )

    language: str | None = Field(
        default=None,
        description="Optional language hint: hi or en.",
    )


class IncidentReportExtractResponse(BaseModel):
    """Structured incident report extraction response."""

    success: bool = True
    form_type: str = "INCIDENT_REPORT"

    fields: IncidentReportFields

    missing_fields: list[str] = Field(default_factory=list)

    source_text: str

    confidence: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
    )

    message: str | None = None


class IncidentReportSaveRequest(IncidentReportFields):
    """Editable incident report data submitted for draft persistence."""

    source_text: str | None = Field(
        default=None,
        max_length=12000,
    )


class IncidentReportSaveResponse(BaseModel):
    """Saved incident report draft response."""

    success: bool = True
    incident_id: str
    form_type: str = "INCIDENT_REPORT"
    status: str = "DRAFT"
    message: str = "Incident report draft saved successfully."


class IncidentReportSubmitResponse(BaseModel):
    """Submitted incident report response."""

    success: bool = True
    incident_id: str
    form_type: str = "INCIDENT_REPORT"
    status: str = "SUBMITTED"
    submitted_at: str
    message: str = "Incident report submitted successfully."


class IncidentReportItem(BaseModel):
    """Saved incident report returned to the Field Officer."""

    incident_id: str
    form_type: str = "INCIDENT_REPORT"
    status: str

    review_status: str | None = None
    review_comment: str | None = None
    reviewed_by: str | None = None
    reviewed_at: str | None = None

    incident_date: date | None = None
    incident_time: time | None = None

    division: str | None = None
    range_name: str | None = None
    beat: str | None = None
    location: str | None = None

    incident_type: str | None = None
    reported_by: str | None = None

    persons_involved: list[str] = Field(default_factory=list)

    wildlife_involved: str | None = None
    incident_description: str | None = None
    immediate_action_taken: str | None = None
    authorities_informed: str | None = None
    injury_or_damage: str | None = None
    evidence_details: str | None = None
    additional_remarks: str | None = None

    source_text: str | None = None

    created_at: str | None = None
    updated_at: str | None = None
    submitted_at: str | None = None


class IncidentReportListResponse(BaseModel):
    """List of saved incident reports."""

    success: bool = True
    incidents: list[IncidentReportItem] = Field(default_factory=list)
    total: int = 0
    
class DailyDiaryFields(BaseModel):
    """Editable structured fields for a Field Officer daily diary."""

    model_config = ConfigDict(extra="ignore")

    diary_date: date | None = None
    subject: str | None = None
    description: str | None = None
    location: str | None = None

    activities: list[str] = Field(default_factory=list)

    observations: str | None = None
    additional_remarks: str | None = None


class DailyDiarySaveRequest(DailyDiaryFields):
    """Editable daily diary data submitted for draft persistence."""

    source_text: str | None = Field(
        default=None,
        max_length=12000,
    )


class DailyDiarySaveResponse(BaseModel):
    """Saved daily diary draft response."""

    success: bool = True
    diary_id: str
    form_type: str = "DAILY_DIARY"
    status: str = "DRAFT"
    message: str = "Daily diary draft saved successfully."


class DailyDiarySubmitResponse(BaseModel):
    """Submitted daily diary response."""

    success: bool = True
    diary_id: str
    form_type: str = "DAILY_DIARY"
    status: str = "SUBMITTED"
    submitted_at: str
    message: str = "Daily diary submitted successfully."


class DailyDiaryItem(BaseModel):
    """Saved daily diary returned to the Field Officer."""

    diary_id: str
    form_type: str = "DAILY_DIARY"
    status: str

    review_status: str | None = None
    review_comment: str | None = None
    reviewed_by: str | None = None
    reviewed_at: str | None = None

    diary_date: date | None = None
    subject: str | None = None
    description: str | None = None
    location: str | None = None

    activities: list[str] = Field(default_factory=list)

    observations: str | None = None
    additional_remarks: str | None = None

    source_text: str | None = None

    created_at: str | None = None
    updated_at: str | None = None
    submitted_at: str | None = None


class DailyDiaryListResponse(BaseModel):
    """List of saved daily diaries."""

    success: bool = True
    diaries: list[DailyDiaryItem] = Field(default_factory=list)
    total: int = 0

class OffenceSeizureReportFields(BaseModel):
    offence_date: date | None = None
    offence_time: time | None = None

    division: str | None = None
    range_name: str | None = None
    beat: str | None = None
    location: str | None = None

    offence_type: str | None = None
    applicable_law: str | None = None
    applicable_section: str | None = None

    persons_involved: list[dict] = Field(default_factory=list)
    seized_material: list[dict] = Field(default_factory=list)

    seizure_location: str | None = None
    seizure_date: date | None = None
    seizure_time: time | None = None

    vehicle_details: str | None = None
    vehicle_registration_number: str | None = None

    evidence_details: str | None = None
    witnesses: list[dict] = Field(default_factory=list)

    action_taken: str | None = None
    authorities_informed: str | None = None

    case_reference_number: str | None = None
    fir_number: str | None = None

    incident_reference_id: UUID | None = None

    description: str | None = None
    additional_remarks: str | None = None

    ai_confidence: float | None = None


class OffenceSeizureReportExtractRequest(BaseModel):
    text: str = Field(..., min_length=1)


class OffenceSeizureReportExtractResponse(BaseModel):
    success: bool
    fields: OffenceSeizureReportFields


class OffenceSeizureReportCreate(BaseModel):
    fields: OffenceSeizureReportFields


class OffenceSeizureReportUpdate(BaseModel):
    fields: OffenceSeizureReportFields


class OffenceSeizureReportSubmitResponse(BaseModel):
    success: bool
    message: str
    report_id: UUID


class OffenceSeizureReportListItem(BaseModel):
    id: UUID
    status: str
    review_status: str

    offence_date: date | None = None
    offence_type: str | None = None
    location: str | None = None
    range_name: str | None = None
    beat: str | None = None

    case_reference_number: str | None = None
    fir_number: str | None = None

    ai_confidence: float | None = None

    created_at: datetime
    updated_at: datetime
    submitted_at: datetime | None = None

    class Config:
        from_attributes = True


class OffenceSeizureReportResponse(BaseModel):
    id: UUID
    officer_id: UUID

    status: str
    review_status: str

    offence_date: date | None = None
    offence_time: time | None = None

    division: str | None = None
    range_name: str | None = None
    beat: str | None = None
    location: str | None = None

    offence_type: str | None = None
    applicable_law: str | None = None
    applicable_section: str | None = None

    persons_involved: list[dict] = Field(default_factory=list)
    seized_material: list[dict] = Field(default_factory=list)

    seizure_location: str | None = None
    seizure_date: date | None = None
    seizure_time: time | None = None

    vehicle_details: str | None = None
    vehicle_registration_number: str | None = None

    evidence_details: str | None = None
    witnesses: list[dict] = Field(default_factory=list)

    action_taken: str | None = None
    authorities_informed: str | None = None

    case_reference_number: str | None = None
    fir_number: str | None = None

    incident_reference_id: UUID | None = None

    description: str | None = None
    additional_remarks: str | None = None

    source_text: str | None = None
    ai_confidence: float | None = None

    review_comment: str | None = None
    reviewed_by: UUID | None = None
    reviewed_at: datetime | None = None

    created_at: datetime
    updated_at: datetime
    submitted_at: datetime | None = None

    class Config:
        from_attributes = True
        
class OffenceSeizureReportSaveResponse(BaseModel):
    success: bool
    report_id: str
    form_type: str
    status: str
    message: str