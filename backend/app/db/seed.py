"""Development/demo seed only. Production content is created through admin document ingestion.

This module is intentionally never invoked by application startup.
"""

import asyncio
import os

from sqlalchemy import select

from app.db.session import get_session_factory
from app.models import (
    User,
    UserRole,
    Subject,
    Chapter,
    StudentProfile,
    Enrollment,
    EnrollmentStatus,
)
from app.core.security import hash_password


USERS = [
    (
        "admin@example.local",
        "Admin User",
        UserRole.ADMIN,
        "ADMIN_PASSWORD",
    ),
    (
        "instructor@example.local",
        "Instructor User",
        UserRole.INSTRUCTOR,
        "INSTRUCTOR_PASSWORD",
    ),
    (
        "developer21.nextupgrad@gmail.com",
        "Student User",
        UserRole.STUDENT,
        "STUDENT_PASSWORD",
    ),
]


SUBJECTS = [
    (
        "Forest Management",
        "FM-101",
        "Forest management fundamentals.",
        "en",
    ),
    (
        "Wildlife Conservation",
        "WC-101",
        "Wildlife conservation fundamentals.",
        "en",
    ),
    (
        "Forest Ecology",
        "FE-101",
        "Forest ecology and ecosystem fundamentals.",
        "en",
    ),
]


CHAPTERS = {
    "FM-101": [
        (
            "Introduction to Forest Management",
            "Overview of forest management principles and practices.",
        ),
        (
            "Forest Resources and Their Management",
            "Management of forest resources and sustainable utilization.",
        ),
        (
            "Sustainable Forest Management",
            "Principles and practices of sustainable forest management.",
        ),
        (
            "Forest Management Planning",
            "Planning, monitoring and implementation of forest management activities.",
        ),
    ],
    "WC-101": [
        (
            "Introduction to Wildlife Conservation",
            "Fundamentals of wildlife conservation and protection.",
        ),
        (
            "Wildlife Habitat Management",
            "Management and protection of wildlife habitats.",
        ),
        (
            "Protected Areas and National Parks",
            "Protected areas, national parks and wildlife sanctuaries.",
        ),
        (
            "Human-Wildlife Conflict",
            "Understanding and managing human-wildlife conflict.",
        ),
    ],
    "FE-101": [
        (
            "Introduction to Forest Ecology",
            "Basic concepts and principles of forest ecology.",
        ),
        (
            "Forest Ecosystems",
            "Structure, functions and dynamics of forest ecosystems.",
        ),
        (
            "Biodiversity and Conservation",
            "Forest biodiversity and ecological conservation.",
        ),
        (
            "Ecological Processes",
            "Important ecological processes operating in forest ecosystems.",
        ),
    ],
}


async def seed() -> None:
    async with get_session_factory()() as session:

        # ---------------------------------------------------------
        # Seed users
        # ---------------------------------------------------------
        for email, name, role, env_name in USERS:

            existing = await session.scalar(
                select(User).where(User.email == email)
            )

            if existing:
                continue

            password = os.getenv(env_name)

            if not password:
                raise RuntimeError(
                    f"Set {env_name} before running the development seed"
                )

            session.add(
                User(
                    email=email,
                    username=email.split("@")[0],
                    password_hash=hash_password(password),
                    full_name=name,
                    role=role,
                    is_active=True,
                )
            )

        await session.flush()

        # ---------------------------------------------------------
        # Seed subjects
        # ---------------------------------------------------------
        for name, code, description, language in SUBJECTS:

            existing_subject = await session.scalar(
                select(Subject).where(Subject.code == code)
            )

            if existing_subject:
                continue

            session.add(
                Subject(
                    name=name,
                    code=code,
                    description=description,
                    language=language,
                    is_active=True,
                )
            )

        await session.flush()

        # ---------------------------------------------------------
        # Seed chapters
        # ---------------------------------------------------------
        for subject_code, chapter_list in CHAPTERS.items():

            subject = await session.scalar(
                select(Subject).where(
                    Subject.code == subject_code
                )
            )

            if not subject:
                continue

            for chapter_number, (title, description) in enumerate(
                chapter_list,
                start=1,
            ):

                existing_chapter = await session.scalar(
                    select(Chapter).where(
                        Chapter.subject_id == subject.id,
                        Chapter.chapter_number == chapter_number,
                    )
                )

                if existing_chapter:
                    continue

                session.add(
                    Chapter(
                        subject_id=subject.id,
                        title=title,
                        chapter_number=chapter_number,
                        description=description,
                        order_index=chapter_number,
                        is_active=True,
                    )
                )

        await session.flush()

        # ---------------------------------------------------------
        # Seed student enrollments
        # ---------------------------------------------------------
        student_user = await session.scalar(
            select(User).where(
                User.email == "developer21.nextupgrad@gmail.com"
            )
        )

        if student_user:

            student_profile = await session.scalar(
                select(StudentProfile).where(
                    StudentProfile.user_id == student_user.id
                )
            )

            if student_profile:

                for subject_code in [
                    "FM-101",
                    "WC-101",
                    "FE-101",
                ]:

                    subject = await session.scalar(
                        select(Subject).where(
                            Subject.code == subject_code
                        )
                    )

                    if not subject:
                        continue

                    existing_enrollment = await session.scalar(
                        select(Enrollment).where(
                            Enrollment.student_id == student_profile.id,
                            Enrollment.subject_id == subject.id,
                        )
                    )

                    if existing_enrollment:
                        continue

                    session.add(
                        Enrollment(
                            student_id=student_profile.id,
                            subject_id=subject.id,
                            academy=student_profile.academy,
                            batch=student_profile.batch,
                            course=student_profile.course,
                            status=EnrollmentStatus.ACTIVE,
                        )
                    )

        # ---------------------------------------------------------
        # Commit everything
        # ---------------------------------------------------------
        await session.commit()


if __name__ == "__main__":
    asyncio.run(seed())