from io import BytesIO
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from PIL import Image
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from starlette.datastructures import Headers, UploadFile

from app.api.field import (
    delete_evidence,
    identify_patrol_wildlife_photo,
    list_patrol_report_drafts,
    save_patrol_report_draft,
    update_patrol_report_draft,
    upload_evidence,
)
from app.models import Evidence, FieldPatrolReport, User, UserRole
from app.schemas.field_forms import PatrolReportSaveRequest


@pytest.mark.asyncio
async def test_patrol_wildlife_upload_idempotency_ownership_and_identification(
    tmp_path,
    monkeypatch,
):
    monkeypatch.chdir(tmp_path)
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(User.__table__.create)
        await connection.run_sync(FieldPatrolReport.__table__.create)
        await connection.run_sync(Evidence.__table__.create)

    sessions = async_sessionmaker(engine, expire_on_commit=False)
    image_buffer = BytesIO()
    Image.new("RGB", (120, 120), color="forestgreen").save(image_buffer, format="JPEG")
    image_content = image_buffer.getvalue()
    async with sessions() as session:
        officer = User(
            id=uuid4(),
            email="wildlife-officer@example.test",
            full_name="Wildlife Officer",
            role=UserRole.FIELD_OFFICER,
        )
        other = User(
            id=uuid4(),
            email="wildlife-other@example.test",
            full_name="Other Officer",
            role=UserRole.FIELD_OFFICER,
        )
        session.add_all([officer, other])
        await session.commit()

        sighting_id = uuid4()
        photo_id = uuid4()
        draft_payload = PatrolReportSaveRequest(
            purpose="Wildlife observation",
            wildlife_sighting="Legacy wildlife text",
            wildlife_sightings=[{
                "sighting_id": str(sighting_id),
                "latitude": 27.123456,
                "longitude": 81.654321,
                "accuracy_m": 12.5,
                "photos": [{
                    "photo_id": str(photo_id),
                    "file_name": "wildlife.jpg",
                    "mime_type": "image/jpeg",
                    "file_size": 24,
                }],
            }],
        )
        report_response = await save_patrol_report_draft(
            draft_payload,
            officer,
            session,
        )
        report_id = UUID(report_response.report_id)
        updated_response = await update_patrol_report_draft(
            report_id,
            draft_payload,
            officer,
            session,
        )
        assert updated_response.report_id == str(report_id)
        updated_report = await session.get(FieldPatrolReport, report_id)
        assert updated_report.wildlife_sighting == "Legacy wildlife text"
        assert updated_report.wildlife_sightings[0]["sighting_id"] == str(sighting_id)
        listed = await list_patrol_report_drafts(officer, session)
        assert listed.success is True
        assert any(item.report_id == str(report_id) for item in listed.reports)

        async def upload(
            target_report_id=report_id,
            target_sighting_id=sighting_id,
            target_photo_id=photo_id,
            operation_id=None,
        ):
            return await upload_evidence(
                report_type="PATROL",
                report_id=target_report_id,
                file=UploadFile(
                    filename="wildlife.jpg",
                    file=BytesIO(image_content),
                    headers=Headers({"content-type": "image/jpeg"}),
                ),
                description="Wildlife sighting photo",
                client_operation_id=operation_id or (
                    f"wildlife:{target_sighting_id}:{target_photo_id}"
                ),
                wildlife_sighting_id=str(target_sighting_id),
                wildlife_photo_id=str(target_photo_id),
                user=officer,
                session=session,
            )

        first_upload = await upload()
        retry_upload = await upload()
        assert retry_upload["evidence"]["id"] == first_upload["evidence"]["id"]
        assert await session.scalar(select(func.count()).select_from(Evidence)) == 1
        stored = await session.get(FieldPatrolReport, report_id)
        stored_sightings = [dict(item) for item in stored.wildlife_sightings]
        stored_sightings[0]["photos"][0]["evidence_id"] = None
        stored.wildlife_sightings = stored_sightings
        await session.commit()
        repaired_upload = await upload()
        assert repaired_upload["evidence"]["id"] == first_upload["evidence"]["id"]
        stored = await session.get(FieldPatrolReport, report_id)
        assert (
            stored.wildlife_sightings[0]["photos"][0]["evidence_id"]
            == first_upload["evidence"]["id"]
        )

        second_photo_id = uuid4()
        expanded_payload = PatrolReportSaveRequest(
            purpose="Wildlife observation",
            wildlife_sightings=[{
                "sighting_id": str(sighting_id),
                "latitude": 27.123456,
                "longitude": 81.654321,
                "accuracy_m": 12.5,
                "photos": [
                    {
                        "photo_id": str(photo_id),
                        "file_name": "wildlife.jpg",
                        "mime_type": "image/jpeg",
                        "file_size": 24,
                        "evidence_id": first_upload["evidence"]["id"],
                    },
                    {
                        "photo_id": str(second_photo_id),
                        "file_name": "second.jpg",
                        "mime_type": "image/jpeg",
                        "file_size": 24,
                    },
                ],
            }],
        )
        await update_patrol_report_draft(report_id, expanded_payload, officer, session)
        with pytest.raises(HTTPException) as wrong_photo_operation:
            await upload(
                target_photo_id=second_photo_id,
                operation_id=f"wildlife:{sighting_id}:{photo_id}",
            )
        assert wrong_photo_operation.value.status_code == 409

        other_report_response = await save_patrol_report_draft(
            draft_payload,
            officer,
            session,
        )
        with pytest.raises(HTTPException) as wrong_report_operation:
            await upload(target_report_id=UUID(other_report_response.report_id))
        assert wrong_report_operation.value.status_code == 409

        with pytest.raises(HTTPException) as invalid_sighting:
            await upload(target_sighting_id=uuid4(), target_photo_id=photo_id)
        assert invalid_sighting.value.status_code == 400
        with pytest.raises(HTTPException) as invalid_photo:
            await upload(target_photo_id=uuid4())
        assert invalid_photo.value.status_code == 400

        raced_evidence_id = uuid4()
        race_operation_id = f"wildlife:{sighting_id}:{second_photo_id}"
        async with sessions() as racing_session:
            racing_session.add(Evidence(
                id=raced_evidence_id,
                report_type="PATROL",
                report_id=report_id,
                officer_id=officer.id,
                client_operation_id=race_operation_id,
                file_name="second.jpg",
                storage_key=str(tmp_path / "existing-evidence.jpg"),
                file_type="jpg",
                file_size=len(image_content),
                mime_type="image/jpeg",
            ))
            await racing_session.commit()
        original_flush = session.flush
        raised_integrity_error = False

        async def raise_integrity_error(*args, **kwargs):
            nonlocal raised_integrity_error
            if not raised_integrity_error:
                raised_integrity_error = True
                raise IntegrityError("duplicate operation", {}, Exception("duplicate"))
            await original_flush(*args, **kwargs)

        monkeypatch.setattr(session, "flush", raise_integrity_error)
        raced_upload = await upload(target_photo_id=second_photo_id)
        monkeypatch.setattr(session, "flush", original_flush)
        assert raced_upload["evidence"]["id"] == str(raced_evidence_id)
        stored = await session.get(FieldPatrolReport, report_id)
        assert (
            stored.wildlife_sightings[0]["photos"][1]["evidence_id"]
            == str(raced_evidence_id)
        )

        class FakeSpeciesIdentificationService:
            async def identify(self, *, image_bytes, filename):
                assert image_bytes == image_content
                assert filename == "wildlife.jpg"
                return {
                    "common_name": "Possible deer",
                    "scientific_name": "Cervidae",
                    "confidence": 0.42,
                    "status": "uncertain",
                }

        monkeypatch.setattr(
            "app.api.field.SpeciesIdentificationService",
            FakeSpeciesIdentificationService,
        )
        identification = await identify_patrol_wildlife_photo(
            report_id=report_id,
            evidence_id=UUID(first_upload["evidence"]["id"]),
            wildlife_sighting_id=str(sighting_id),
            wildlife_photo_id=str(photo_id),
            user=officer,
            session=session,
        )
        assert identification["identification"]["status"] == "UNCERTAIN"
        assert identification["identification"]["confidence"] == 0.42

        stored = await session.get(FieldPatrolReport, report_id)
        stored_sighting = stored.wildlife_sightings[0]
        assert stored_sighting["latitude"] == 27.123456
        stored_photo = stored_sighting["photos"][0]
        assert stored_photo["evidence_id"] == first_upload["evidence"]["id"]
        assert stored_photo["identification"]["status"] == "UNCERTAIN"

        deletion = await delete_evidence(
            evidence_id=UUID(first_upload["evidence"]["id"]),
            user=officer,
            session=session,
        )
        assert deletion["success"] is True
        assert await session.scalar(select(func.count()).select_from(Evidence)) == 1
        stored = await session.get(FieldPatrolReport, report_id)
        assert (
            stored.wildlife_sightings[0]["photos"][0]["photo_id"]
            == str(second_photo_id)
        )
        second_deletion = await delete_evidence(
            evidence_id=raced_evidence_id,
            user=officer,
            session=session,
        )
        assert second_deletion["success"] is True
        assert await session.scalar(select(func.count()).select_from(Evidence)) == 0
        stored = await session.get(FieldPatrolReport, report_id)
        assert stored.wildlife_sightings[0]["photos"] == []

        with pytest.raises(HTTPException) as unauthorized:
            await identify_patrol_wildlife_photo(
                report_id=report_id,
                evidence_id=UUID(first_upload["evidence"]["id"]),
                wildlife_sighting_id=str(sighting_id),
                wildlife_photo_id=str(photo_id),
                user=other,
                session=session,
            )
        assert unauthorized.value.status_code == 404

    await engine.dispose()


def test_patrol_wildlife_coordinates_and_identification_confidence_are_validated():
    with pytest.raises(ValidationError):
        PatrolReportSaveRequest(
            wildlife_sightings=[{
                "sighting_id": str(uuid4()),
                "latitude": 91,
                "longitude": 81,
            }],
        )
    with pytest.raises(ValidationError):
        PatrolReportSaveRequest(
            wildlife_sightings=[{
                "sighting_id": str(uuid4()),
                "photos": [{
                    "photo_id": str(uuid4()),
                    "file_name": "wildlife.jpg",
                    "mime_type": "image/jpeg",
                    "file_size": 24,
                    "identification": {"status": "IDENTIFIED", "confidence": 1.2},
                }],
            }],
        )
