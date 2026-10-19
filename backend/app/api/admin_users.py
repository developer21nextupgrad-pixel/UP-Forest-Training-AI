from __future__ import annotations



from uuid import UUID

from typing import Literal

from pathlib import Path

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from fastapi.responses import FileResponse

from pydantic import BaseModel, Field, field_validator

from sqlalchemy import select

from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_admin

from app.core.security import hash_password

from app.db.session import get_db_session

from app.models import (

    Enrollment,

    FieldPatrolReport,

    InstructorProfile,

    OffenceSeizureReport,

    StudentProfile,

    Subject,

    User,

    DailyDiary,

    UserRole,
    
    Evidence,

    IncidentReport,

)



router = APIRouter(

    prefix="/admin/users",

    tags=["Admin User Management"],

)





class AdminUserCreate(BaseModel):

    full_name: str = Field(min_length=2, max_length=200)

    email: str = Field(min_length=3, max_length=320)

    password: str = Field(min_length=8, max_length=128)

    role: str = Field(min_length=1, max_length=20)

    preferred_language: str = Field(

        default="en",

        min_length=2,

        max_length=10,

    )

    designation: str | None = Field(

        default=None,

        max_length=200,

    )

    academy: str | None = Field(

        default=None,

        max_length=200,

    )



    @field_validator("email")

    @classmethod

    def normalize_email(_cls_, value: str) -> str:

        return value.strip().lower()



    @field_validator("role")

    @classmethod

    def validate_role(_cls_, value: str) -> str:

        value = value.strip().upper()



        if value not in {

            "STUDENT",

            "INSTRUCTOR",

            "ADMIN",

            "LEGAL_USER",

            "FIELD_OFFICER",

        }:

            raise ValueError(

                "role must be STUDENT, INSTRUCTOR, ADMIN, LEGAL_USER, or FIELD_OFFICER"

            )



        return value





class AdminEnrollmentCreate(BaseModel):

    subject_id: UUID



    academy: str | None = Field(

        default=None,

        max_length=200,

    )



    batch: str | None = Field(

        default=None,

        max_length=100,

    )



    course: str | None = Field(

        default=None,

        max_length=200,

    )





# ============================================================

# ADMIN - PATROL REPORT REVIEW REQUEST

# ============================================================



class PatrolReportReviewRequest(BaseModel):

    review_status: Literal[

        "PENDING",

        "APPROVED",

        "REJECTED",

        "CHANGES_REQUESTED",

    ]



    review_comment: str | None = None





# ============================================================

# ADMIN - STUDENTS

# ============================================================



@router.get("/students")

async def list_students(

    _: User = Depends(require_admin),

    session: AsyncSession = Depends(get_db_session),

):

    rows = (

        await session.execute(

            select(User, StudentProfile)

            .join(

                StudentProfile,

                StudentProfile.user_id == User.id,

            )

            .where(

                User.role == UserRole.STUDENT,

                User.is_active.is_(True),

            )

            .order_by(User.full_name)

        )

    ).all()



    return [

        {

            "id": user.id,

            "full_name": user.full_name,

            "email": user.email,

            "student_profile_id": profile.id,

            "academy": profile.academy,

            "batch": profile.batch,

            "course": profile.course,

        }

        for user, profile in rows

    ]





# ============================================================

# ADMIN - CREATE USER

# ============================================================



@router.post("", status_code=201)

async def create_user(

    payload: AdminUserCreate,

    _: User = Depends(require_admin),

    session: AsyncSession = Depends(get_db_session),

):

    if await session.scalar(

        select(User).where(User.email == payload.email)

    ):

        raise HTTPException(

            409,

            "An account with this email already exists",

        )



    username_base = (

        "".join(

            ch

            for ch in payload.email.split("@", 1)[0]

            if ch.isalnum() or ch in "._-"

        )[:90]

        or "user"

    )



    username = username_base

    suffix = 1



    while await session.scalar(

        select(User.id).where(User.username == username)

    ):

        suffix += 1

        username = f"{username_base[:88]}-{suffix}"



    user = User(

        email=payload.email,

        username=username,

        password_hash=hash_password(payload.password),

        full_name=" ".join(payload.full_name.split()),

        role=UserRole(payload.role),

        is_active=True,

        preferred_language=payload.preferred_language,

    )



    session.add(user)

    await session.flush()



    if user.role == UserRole.STUDENT:

        session.add(

            StudentProfile(

                user_id=user.id,

                academy=payload.academy,

            )

        )



    elif user.role == UserRole.INSTRUCTOR:

        session.add(

            InstructorProfile(

                user_id=user.id,

                designation=payload.designation,

                academy=payload.academy,

            )

        )



    await session.commit()

    await session.refresh(user)



    return {

        "id": user.id,

        "email": user.email,

        "full_name": user.full_name,

        "role": user.role.value,

        "is_active": user.is_active,

    }





# ============================================================

# ADMIN - USER STATUS

# ============================================================



@router.patch("/{user_id}/status")

async def set_user_status(

    user_id: UUID,

    active: bool,

    _: User = Depends(require_admin),

    session: AsyncSession = Depends(get_db_session),

):

    user = await session.get(User, user_id)



    if not user:

        raise HTTPException(

            404,

            "User not found",

        )



    user.is_active = active



    await session.commit()



    return {

        "id": user.id,

        "is_active": user.is_active,

    }





# ============================================================

# ADMIN - ENROLLMENT

# ============================================================



@router.post("/{user_id}/enrollments", status_code=201)

async def create_enrollment(

    user_id: UUID,

    payload: AdminEnrollmentCreate,

    _: User = Depends(require_admin),

    session: AsyncSession = Depends(get_db_session),

):

    # Verify user exists

    user = await session.get(User, user_id)



    if not user:

        raise HTTPException(

            404,

            "User not found",

        )



    # Only students can be enrolled

    if user.role != UserRole.STUDENT:

        raise HTTPException(

            400,

            "Only student users can be enrolled",

        )



    # Find StudentProfile

    student = await session.scalar(

        select(StudentProfile).where(

            StudentProfile.user_id == user.id

        )

    )



    if not student:

        raise HTTPException(

            404,

            "Student profile not found",

        )



    # Verify subject exists

    subject = await session.get(

        Subject,

        payload.subject_id,

    )



    if not subject:

        raise HTTPException(

            404,

            "Subject not found",

        )



    # Subject must be active

    if not subject.is_active:

        raise HTTPException(

            400,

            "Subject is inactive",

        )



    # Prevent duplicate enrollment

    existing = await session.scalar(

        select(Enrollment).where(

            Enrollment.student_id == student.id,

            Enrollment.subject_id == subject.id,

        )

    )



    if existing:

        raise HTTPException(

            409,

            "Student is already enrolled in this subject",

        )



    # Create enrollment

    enrollment = Enrollment(

        student_id=student.id,

        subject_id=subject.id,

        academy=payload.academy or student.academy,

        batch=payload.batch or student.batch,

        course=payload.course or student.course,

    )



    session.add(enrollment)



    await session.commit()

    await session.refresh(enrollment)



    return {

        "id": enrollment.id,

        "student_id": enrollment.student_id,

        "user_id": user.id,

        "student_name": user.full_name,

        "subject_id": subject.id,

        "subject_name": subject.name,

        "subject_code": subject.code,

        "academy": enrollment.academy,

        "batch": enrollment.batch,

        "course": enrollment.course,

        "status": enrollment.status.value,

    }





# ============================================================

# ADMIN - FIELD OFFICER PATROL REPORTS

# ============================================================



@router.get("/field/patrol-reports")

async def list_patrol_reports(

    _: User = Depends(require_admin),

    session: AsyncSession = Depends(get_db_session),

):

    rows = (

        await session.execute(

            select(FieldPatrolReport, User)

            .join(

                User,

                User.id == FieldPatrolReport.officer_id,

            )

            .where(

                FieldPatrolReport.status == "SUBMITTED",

            )

            .order_by(FieldPatrolReport.submitted_at.desc())

        )

    ).all()



    return [

        {

            "id": report.id,

            "officer_id": report.officer_id,

            "officer_name": officer.full_name,

            "officer_email": officer.email,

            "patrol_date": report.patrol_date,

            "beat": report.beat,

            "division": report.division,

            "status": report.status,

            "submitted_at": report.submitted_at,

            "review_status": report.review_status,

            "review_comment": report.review_comment,

            "reviewed_by": report.reviewed_by,

            "reviewed_at": report.reviewed_at,

        }

        for report, officer in rows

    ]



@router.get(

    "/field/offence-seizure-reports",

)

async def list_offence_seizure_reports(

    session: AsyncSession = Depends(get_db_session),

    _: User = Depends(require_admin),

):

    result = await session.execute(
        select(OffenceSeizureReport)
        .where(OffenceSeizureReport.submitted_at.is_not(None))
        .order_by(OffenceSeizureReport.submitted_at.desc())
    )



    reports = result.scalars().all()



    return [

        {

            "id": report.id,

            "officer_id": report.officer_id,

            "status": report.status,

            "review_status": report.review_status,

            "offence_date": report.offence_date,

            "offence_type": report.offence_type,

            "division": report.division,

            "range_name": report.range_name,

            "beat": report.beat,

            "location": report.location,

            "case_reference_number": report.case_reference_number,

            "fir_number": report.fir_number,

            "ai_confidence": report.ai_confidence,

            "submitted_at": report.submitted_at,

            "created_at": report.created_at,

            "updated_at": report.updated_at,

        }

        for report in reports

    ]



@router.get(

    "/field/offence-seizure-reports/{report_id}",

)

async def get_offence_seizure_report(

    report_id: UUID,

    session: AsyncSession = Depends(get_db_session),

    _: User = Depends(require_admin),

):

    report = await session.get(OffenceSeizureReport, report_id)



    if not report:

        raise HTTPException(

            status_code=404,

            detail="Offence & Seizure Report not found.",

        )



    return {

        "id": report.id,

        "officer_id": report.officer_id,

        "status": report.status,

        "review_status": report.review_status,

        "offence_date": report.offence_date,

        "offence_time": report.offence_time,

        "division": report.division,

        "range_name": report.range_name,

        "beat": report.beat,

        "location": report.location,

        "offence_type": report.offence_type,

        "applicable_law": report.applicable_law,

        "applicable_section": report.applicable_section,

        "persons_involved": report.persons_involved,

        "seized_material": report.seized_material,

        "seizure_location": report.seizure_location,

        "seizure_date": report.seizure_date,

        "seizure_time": report.seizure_time,

        "vehicle_details": report.vehicle_details,

        "vehicle_registration_number": report.vehicle_registration_number,

        "evidence_details": report.evidence_details,

        "witnesses": report.witnesses,

        "action_taken": report.action_taken,

        "authorities_informed": report.authorities_informed,

        "case_reference_number": report.case_reference_number,

        "fir_number": report.fir_number,

        "incident_reference_id": report.incident_reference_id,

        "description": report.description,

        "additional_remarks": report.additional_remarks,

        "source_text": report.source_text,

        "ai_confidence": report.ai_confidence,

        "review_comment": report.review_comment,

        "reviewed_by": report.reviewed_by,

        "reviewed_at": report.reviewed_at,

        "created_at": report.created_at,

        "updated_at": report.updated_at,

        "submitted_at": report.submitted_at,

    }

@router.get("/field/offence-seizure-reports/{report_id}/evidence")
async def list_offence_seizure_evidence(
    report_id: UUID,
    _: User = Depends(require_admin),
    session: AsyncSession = Depends(get_db_session),
):
    result = await session.execute(
        select(Evidence)
        .where(
            Evidence.report_type == "OFFENCE_SEIZURE",
            Evidence.report_id == report_id,
        )
        .order_by(Evidence.uploaded_at.desc())
    )

    evidence_items = result.scalars().all()

    return {
        "success": True,
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
    
@router.get(
    "/field/offence-seizure-evidence/{evidence_id}/file"
)
async def get_admin_offence_seizure_evidence_file(
    evidence_id: UUID,
    _: User = Depends(require_admin),
    session: AsyncSession = Depends(get_db_session),
):
    evidence = await session.get(Evidence, evidence_id)

    if not evidence:
        raise HTTPException(
            status_code=404,
            detail="Evidence file not found.",
        )

    if evidence.report_type != "OFFENCE_SEIZURE":
        raise HTTPException(
            status_code=400,
            detail="Invalid evidence report type.",
        )

    storage_path = Path(evidence.storage_key)

    if not storage_path.exists() or not storage_path.is_file():
        raise HTTPException(
            status_code=404,
            detail="Evidence file is missing from storage.",
        )

    return FileResponse(
        path=storage_path,
        media_type=evidence.mime_type,
        filename=evidence.file_name,
    )    

@router.patch(
    "/field/offence-seizure-reports/{report_id}/review"
)
async def review_offence_seizure_report(
    report_id: UUID,
    payload: PatrolReportReviewRequest,
    user: User = Depends(require_admin),
    session: AsyncSession = Depends(get_db_session),
):
    report = await session.get(OffenceSeizureReport, report_id)

    if not report:
        raise HTTPException(
            status_code=404,
            detail="Offence & Seizure Report not found",
        )

    # Draft reports cannot be reviewed.
    if report.status == "DRAFT" and report.review_status == "PENDING":
        raise HTTPException(
            status_code=400,
            detail="Only submitted or previously reviewed Offence & Seizure Reports can be reviewed",
        )

    # Update review information.
    report.review_status = payload.review_status
    report.review_comment = payload.review_comment
    report.reviewed_by = user.id
    report.reviewed_at = datetime.now(timezone.utc)

    # Keep report status synchronized with review status.
    if payload.review_status == "APPROVED":
        report.status = "APPROVED"

    elif payload.review_status == "REJECTED":
        report.status = "REJECTED"

    elif payload.review_status == "CHANGES_REQUESTED":
        report.status = "CHANGES_REQUESTED"

    elif payload.review_status == "PENDING":
        report.status = "SUBMITTED"

    try:
        await session.commit()
        await session.refresh(report)

    except Exception:
        await session.rollback()
        raise HTTPException(
            status_code=500,
            detail="Unable to update Offence & Seizure Report review",
        )

    return {
        "success": True,
        "report_id": str(report.id),
        "status": report.status,
        "review_status": report.review_status,
        "review_comment": report.review_comment,
        "reviewed_by": str(report.reviewed_by) if report.reviewed_by else None,
        "reviewed_at": report.reviewed_at,
    }


@router.get("/field/incident-reports")

async def list_incident_reports(

    _: User = Depends(require_admin),

    session: AsyncSession = Depends(get_db_session),

):

    rows = (

        await session.execute(

            select(IncidentReport, User)

            .join(User, User.id == IncidentReport.officer_id)

            .where(IncidentReport.status == "SUBMITTED")

            .order_by(IncidentReport.submitted_at.desc())

        )

    ).all()



    return [

        {

            "id": report.id,

            "officer_id": report.officer_id,

            "officer_name": officer.full_name,

            "officer_email": officer.email,

            "incident_date": report.incident_date,

            "incident_time": report.incident_time,

            "incident_type": report.incident_type,

            "location": report.location,

            "division": report.division,

            "range_name": report.range_name,

            "beat": report.beat,

            "status": report.status,

            "submitted_at": report.submitted_at,

            "review_status": report.review_status,

            "review_comment": report.review_comment,

            "reviewed_by": report.reviewed_by,

            "reviewed_at": report.reviewed_at,

        }

        for report, officer in rows

    ]







@router.get("/field/incident-reports/{incident_id}")

async def get_incident_report(

    incident_id: UUID,

    _: User = Depends(require_admin),

    session: AsyncSession = Depends(get_db_session),

):

    result = await session.execute(

        select(IncidentReport, User)

        .join(User, User.id == IncidentReport.officer_id)

        .where(IncidentReport.id == incident_id)

    )



    row = result.first()



    if not row:

        raise HTTPException(

            status_code=404,

            detail="Incident report not found",

        )



    report, officer = row



    return {

        "id": report.id,

        "officer_id": report.officer_id,

        "officer_name": officer.full_name,

        "officer_email": officer.email,

        "incident_date": report.incident_date,

        "incident_time": report.incident_time,

        "division": report.division,

        "range_name": report.range_name,

        "beat": report.beat,

        "location": report.location,

        "incident_type": report.incident_type,

        "reported_by": report.reported_by,

        "persons_involved": report.persons_involved,

        "wildlife_involved": report.wildlife_involved,

        "incident_description": report.incident_description,

        "immediate_action_taken": report.immediate_action_taken,

        "authorities_informed": report.authorities_informed,

        "injury_or_damage": report.injury_or_damage,

        "evidence_details": report.evidence_details,

        "additional_remarks": report.additional_remarks,

        "source_text": report.source_text,

        "review_status": report.review_status,

        "review_comment": report.review_comment,

        "reviewed_by": report.reviewed_by,

        "reviewed_at": report.reviewed_at,

        "status": report.status,

        "created_at": report.created_at,

        "updated_at": report.updated_at,

        "submitted_at": report.submitted_at,

    }    

@router.patch("/field/incident-reports/{incident_id}/review")

async def review_incident_report(

    incident_id: UUID,

    payload: PatrolReportReviewRequest,

    user: User = Depends(require_admin),

    session: AsyncSession = Depends(get_db_session),

):

    report = await session.get(IncidentReport, incident_id)



    if not report:

        raise HTTPException(

            status_code=404,

            detail="Incident report not found",

        )



    report.review_status = payload.review_status

    report.review_comment = payload.review_comment

    report.reviewed_by = user.id

    report.reviewed_at = datetime.now(timezone.utc)



    try:

        await session.commit()

        await session.refresh(report)



    except Exception:

        await session.rollback()



        raise HTTPException(

            status_code=500,

            detail="Unable to update incident report review",

        )



    return {

        "success": True,

        "incident_id": report.id,

        "review_status": report.review_status,

        "review_comment": report.review_comment,

        "reviewed_by": report.reviewed_by,

        "reviewed_at": report.reviewed_at,

    }



# ============================================================

# ADMIN - GET SINGLE PATROL REPORT

# ============================================================



@router.get("/field/patrol-reports/{report_id}")

async def get_patrol_report(

    report_id: UUID,

    _: User = Depends(require_admin),

    session: AsyncSession = Depends(get_db_session),

):

    result = await session.execute(

        select(FieldPatrolReport, User)

        .join(

            User,

            User.id == FieldPatrolReport.officer_id,

        )

        .where(

            FieldPatrolReport.id == report_id,

        )

    )



    row = result.first()



    if not row:

        raise HTTPException(

            status_code=404,

            detail="Patrol report not found",

        )



    report, officer = row



    return {

        "id": report.id,

        "officer_id": report.officer_id,

        "officer_name": officer.full_name,

        "officer_email": officer.email,



        "patrol_date": report.patrol_date,

        "beat": report.beat,

        "division": report.division,



        "start_time": report.start_time,

        "end_time": report.end_time,

        "location": report.location,



        "team_members": report.team_members,



        "purpose": report.purpose,

        "observations": report.observations,

        "wildlife_sighting": report.wildlife_sighting,

        "illegal_activity": report.illegal_activity,

        "action_taken": report.action_taken,

        "incident_details": report.incident_details,

        "additional_remarks": report.additional_remarks,



        "source_text": report.source_text,

        "ai_confidence": report.ai_confidence,



        "status": report.status,



        # Review information

        "review_status": report.review_status,

        "review_comment": report.review_comment,

        "reviewed_by": report.reviewed_by,

        "reviewed_at": report.reviewed_at,



        "created_at": report.created_at,

        "updated_at": report.updated_at,

        "submitted_at": report.submitted_at,

    }





# ============================================================

# ADMIN - REVIEW PATROL REPORT

# ============================================================



@router.patch("/field/patrol-reports/{report_id}/review")

async def review_patrol_report(

    report_id: UUID,

    payload: PatrolReportReviewRequest,

    user: User = Depends(require_admin),

    session: AsyncSession = Depends(get_db_session),

):

    report = await session.get(

        FieldPatrolReport,

        report_id,

    )



    if not report:

        raise HTTPException(

            status_code=404,

            detail="Patrol report not found",

        )



    report.review_status = payload.review_status

    report.review_comment = payload.review_comment

    report.reviewed_by = user.id

    report.reviewed_at = datetime.now(timezone.utc)



    try:

        await session.commit()

        await session.refresh(report)



    except Exception:

        await session.rollback()



        raise HTTPException(

            status_code=500,

            detail="Unable to update patrol report review",

        )



    return {

        "success": True,

        "report_id": report.id,

        "review_status": report.review_status,

        "review_comment": report.review_comment,

        "reviewed_by": report.reviewed_by,

        "reviewed_at": report.reviewed_at,

    }



# ============================================================

# ADMIN - GET DAILY DIARIES

# ============================================================



@router.get("/field/daily-diaries")

async def list_daily_diaries(

    _: User = Depends(require_admin),

    session: AsyncSession = Depends(get_db_session),

):

    rows = (

        await session.execute(

            select(DailyDiary, User)

            .join(

                User,

                User.id == DailyDiary.officer_id,

            )

            .where(

                DailyDiary.status == "SUBMITTED",

            )

            .order_by(DailyDiary.submitted_at.desc())

        )

    ).all()



    return [

        {

            "id": diary.id,

            "officer_id": diary.officer_id,

            "officer_name": officer.full_name,

            "officer_email": officer.email,

            "diary_date": diary.diary_date,

            "subject": diary.subject,

            "location": diary.location,

            "status": diary.status,

            "submitted_at": diary.submitted_at,

            "review_status": diary.review_status,

            "review_comment": diary.review_comment,

            "reviewed_by": diary.reviewed_by,

            "reviewed_at": diary.reviewed_at,

        }

        for diary, officer in rows

    ]





# ============================================================

# ADMIN - GET SINGLE DAILY DIARY

# ============================================================



@router.get("/field/daily-diaries/{diary_id}")

async def get_daily_diary(

    diary_id: UUID,

    _: User = Depends(require_admin),

    session: AsyncSession = Depends(get_db_session),

):

    result = await session.execute(

        select(DailyDiary, User)

        .join(

            User,

            User.id == DailyDiary.officer_id,

        )

        .where(

            DailyDiary.id == diary_id,

        )

    )



    row = result.first()



    if not row:

        raise HTTPException(

            status_code=404,

            detail="Daily diary not found",

        )



    diary, officer = row



    return {

        "id": diary.id,

        "officer_id": diary.officer_id,

        "officer_name": officer.full_name,

        "officer_email": officer.email,



        "diary_date": diary.diary_date,

        "subject": diary.subject,

        "description": diary.description,

        "location": diary.location,

        "activities": diary.activities,

        "observations": diary.observations,

        "additional_remarks": diary.additional_remarks,



        "source_text": diary.source_text,



        "status": diary.status,



        # Review information

        "review_status": diary.review_status,

        "review_comment": diary.review_comment,

        "reviewed_by": diary.reviewed_by,

        "reviewed_at": diary.reviewed_at,



        "created_at": diary.created_at,

        "updated_at": diary.updated_at,

        "submitted_at": diary.submitted_at,

    }





# ============================================================

# ADMIN - REVIEW DAILY DIARY

# ============================================================



@router.patch("/field/daily-diaries/{diary_id}/review")

async def review_daily_diary(

    diary_id: UUID,

    payload: PatrolReportReviewRequest,

    user: User = Depends(require_admin),

    session: AsyncSession = Depends(get_db_session),

):

    diary = await session.get(

        DailyDiary,

        diary_id,

    )



    if not diary:

        raise HTTPException(

            status_code=404,

            detail="Daily diary not found",

        )



    diary.review_status = payload.review_status

    diary.review_comment = payload.review_comment

    diary.reviewed_by = user.id

    diary.reviewed_at = datetime.now(timezone.utc)



    try:

        await session.commit()

        await session.refresh(diary)



    except Exception:

        await session.rollback()



        raise HTTPException(

            status_code=500,

            detail="Unable to update daily diary review",

        )



    return {

        "success": True,

        "diary_id": diary.id,

        "review_status": diary.review_status,

        "review_comment": diary.review_comment,

        "reviewed_by": diary.reviewed_by,

        "reviewed_at": diary.reviewed_at,

    }
