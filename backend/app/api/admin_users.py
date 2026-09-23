from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_admin
from app.core.security import hash_password
from app.db.session import get_db_session
from app.models import (
    Enrollment,
    InstructorProfile,
    StudentProfile,
    Subject,
    User,
    UserRole,
)

router = APIRouter(prefix="/admin/users", tags=["Admin User Management"])


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
    def normalize_email(cls, value: str) -> str:
        return value.strip().lower()

    @field_validator("role")
    @classmethod
    def validate_role(cls, value: str) -> str:
        value = value.strip().upper()

        if value not in {"STUDENT", "INSTRUCTOR", "ADMIN","LEGAL_USER","FIELD_OFFICER"}:
            raise ValueError(
                "role must be STUDENT, INSTRUCTOR, or ADMIN","LEGAL_USER","FIELD_OFFICER"
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