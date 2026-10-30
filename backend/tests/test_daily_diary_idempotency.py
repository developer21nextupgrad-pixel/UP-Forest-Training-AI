from uuid import UUID, uuid4
from io import BytesIO

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from starlette.datastructures import Headers, UploadFile

from app.api.field import (
    list_daily_diaries,
    save_daily_diary_draft,
    save_incident_report_draft,
    save_offence_seizure_report_draft,
    save_patrol_report_draft,
    update_incident_report_draft,
    submit_daily_diary,
    submit_incident_report,
    submit_offence_seizure_report,
    submit_patrol_report,
    upload_evidence,
)
from app.models import (
    DailyDiary,
    Evidence,
    FieldPatrolReport,
    IncidentReport,
    OffenceSeizureReport,
    User,
    UserRole,
)
from app.schemas.field_forms import (
    DailyDiarySaveRequest,
    IncidentReportSaveRequest,
    OffenceSeizureReportCreate,
    OffenceSeizureReportFields,
    PatrolReportSaveRequest,
)


@pytest.mark.asyncio
async def test_daily_diary_create_retries_are_idempotent_and_officer_scoped():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(User.__table__.create)
        await connection.run_sync(DailyDiary.__table__.create)

    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as session:
        officer = User(
            id=uuid4(),
            email="officer@example.test",
            full_name="Field Officer",
            role=UserRole.FIELD_OFFICER,
        )
        other_officer = User(
            id=uuid4(),
            email="other@example.test",
            full_name="Other Officer",
            role=UserRole.FIELD_OFFICER,
        )
        session.add_all([officer, other_officer])
        await session.commit()

        first = await save_daily_diary_draft(
            DailyDiarySaveRequest(
                description="Initial local content",
                client_operation_id="create:stable-operation",
            ),
            officer,
            session,
        )
        retry = await save_daily_diary_draft(
            DailyDiarySaveRequest(
                description="Latest local content",
                client_operation_id="create:stable-operation",
            ),
            officer,
            session,
        )

        assert retry.diary_id == first.diary_id
        assert await session.scalar(select(func.count()).select_from(DailyDiary)) == 1
        stored = await session.get(DailyDiary, UUID(first.diary_id))
        assert stored is not None
        assert stored.description == "Latest local content"

        other = await save_daily_diary_draft(
            DailyDiarySaveRequest(
                description="Other officer content",
                client_operation_id="create:stable-operation",
            ),
            other_officer,
            session,
        )
        assert other.diary_id != first.diary_id
        assert await session.scalar(select(func.count()).select_from(DailyDiary)) == 2

        submitted = await submit_daily_diary(UUID(first.diary_id), officer, session)
        repeated_submit = await submit_daily_diary(UUID(first.diary_id), officer, session)
        assert submitted.status == "SUBMITTED"
        assert repeated_submit.submitted_at == submitted.submitted_at

    await engine.dispose()


@pytest.mark.asyncio
async def test_daily_diary_list_returns_only_the_authenticated_officers_records():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(User.__table__.create)
        await connection.run_sync(DailyDiary.__table__.create)

    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as session:
        officer = User(
            id=uuid4(),
            email="list-officer@example.test",
            full_name="Diary List Officer",
            role=UserRole.FIELD_OFFICER,
        )
        other_officer = User(
            id=uuid4(),
            email="other-list-officer@example.test",
            full_name="Other Diary List Officer",
            role=UserRole.FIELD_OFFICER,
        )
        session.add_all([officer, other_officer])
        await session.flush()
        session.add_all([
            DailyDiary(officer_id=officer.id, status="DRAFT", description="Own record"),
            DailyDiary(officer_id=other_officer.id, status="DRAFT", description="Other record"),
        ])
        await session.commit()

        response = await list_daily_diaries(officer, session)

        assert response.success is True
        assert response.total == 1
        assert [item.description for item in response.diaries] == ["Own record"]

    await engine.dispose()


@pytest.mark.asyncio
async def test_remaining_field_form_create_retries_are_idempotent_and_officer_scoped():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(User.__table__.create)
        await connection.run_sync(FieldPatrolReport.__table__.create)
        await connection.run_sync(IncidentReport.__table__.create)
        await connection.run_sync(OffenceSeizureReport.__table__.create)

    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as session:
        officer = User(
            id=uuid4(),
            email="offline-forms@example.test",
            full_name="Offline Forms Officer",
            role=UserRole.FIELD_OFFICER,
        )
        other = User(
            id=uuid4(),
            email="offline-forms-other@example.test",
            full_name="Other Offline Forms Officer",
            role=UserRole.FIELD_OFFICER,
        )
        session.add_all([officer, other])
        await session.commit()

        patrol_payload = PatrolReportSaveRequest(
            purpose="First patrol payload",
            client_operation_id="patrol:create:stable",
        )
        patrol_first = await save_patrol_report_draft(patrol_payload, officer, session)
        patrol_retry = await save_patrol_report_draft(
            PatrolReportSaveRequest(
                purpose="Updated patrol payload",
                client_operation_id="patrol:create:stable",
            ),
            officer,
            session,
        )
        assert patrol_retry.report_id == patrol_first.report_id
        assert await session.scalar(select(func.count()).select_from(FieldPatrolReport)) == 1
        assert (await session.get(FieldPatrolReport, UUID(patrol_first.report_id))).purpose == "Updated patrol payload"

        incident_first = await save_incident_report_draft(
            IncidentReportSaveRequest(
                incident_description="Incident draft",
                client_operation_id="incident:create:stable",
            ),
            officer,
            session,
        )
        incident_retry = await save_incident_report_draft(
            IncidentReportSaveRequest(
                incident_description="Updated incident draft",
                client_operation_id="incident:create:stable",
            ),
            officer,
            session,
        )
        assert incident_retry.incident_id == incident_first.incident_id
        assert await session.scalar(select(func.count()).select_from(IncidentReport)) == 1

        recovered_incident = await update_incident_report_draft(
            uuid4(),
            IncidentReportSaveRequest(
                incident_description="Recovered incident draft",
                client_operation_id="incident:create:stable",
            ),
            officer,
            session,
        )
        assert recovered_incident.incident_id == incident_first.incident_id
        stored_incident = await session.get(
            IncidentReport,
            UUID(incident_first.incident_id),
        )
        assert stored_incident.incident_description == "Recovered incident draft"
        assert await session.scalar(select(func.count()).select_from(IncidentReport)) == 1
        with pytest.raises(HTTPException) as unauthorized_recovery:
            await update_incident_report_draft(
                uuid4(),
                IncidentReportSaveRequest(
                    incident_description="Must not cross officer boundary",
                    client_operation_id="incident:create:stable",
                ),
                other,
                session,
            )
        assert unauthorized_recovery.value.status_code == 404
        with pytest.raises(HTTPException) as missing_incident:
            await update_incident_report_draft(
                uuid4(),
                IncidentReportSaveRequest(
                    incident_description="No matching server report",
                ),
                officer,
                session,
            )
        assert missing_incident.value.status_code == 404

        offence_payload = OffenceSeizureReportCreate(
            fields=OffenceSeizureReportFields(description="Offence draft"),
            client_operation_id="offence:create:stable",
        )
        offence_first = await save_offence_seizure_report_draft(offence_payload, officer, session)
        offence_retry = await save_offence_seizure_report_draft(
            OffenceSeizureReportCreate(
                fields=OffenceSeizureReportFields(description="Updated offence draft"),
                client_operation_id="offence:create:stable",
            ),
            officer,
            session,
        )
        assert offence_retry.report_id == offence_first["report_id"]
        assert await session.scalar(select(func.count()).select_from(OffenceSeizureReport)) == 1

        other_patrol = await save_patrol_report_draft(
            PatrolReportSaveRequest(
                client_operation_id="patrol:create:stable",
                purpose="Other officer's own form",
            ),
            other,
            session,
        )
        assert other_patrol.report_id != patrol_first.report_id
        assert await session.scalar(select(func.count()).select_from(FieldPatrolReport)) == 2

    await engine.dispose()


@pytest.mark.asyncio
async def test_repeated_field_report_submissions_return_existing_success():
    from datetime import date, datetime, time, timezone

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(User.__table__.create)
        await connection.run_sync(FieldPatrolReport.__table__.create)
        await connection.run_sync(IncidentReport.__table__.create)
        await connection.run_sync(OffenceSeizureReport.__table__.create)

    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as session:
        officer = User(
            id=uuid4(),
            email="submitted-forms@example.test",
            full_name="Submitted Forms Officer",
            role=UserRole.FIELD_OFFICER,
        )
        session.add(officer)
        await session.flush()
        submitted_at = datetime.now(timezone.utc)
        patrol = FieldPatrolReport(
            officer_id=officer.id,
            status="SUBMITTED",
            patrol_date=date.today(),
            start_time=time(8, 0),
            end_time=time(9, 0),
            submitted_at=submitted_at,
        )
        incident = IncidentReport(
            officer_id=officer.id,
            status="SUBMITTED",
            submitted_at=submitted_at,
        )
        offence = OffenceSeizureReport(
            officer_id=officer.id,
            status="SUBMITTED",
            submitted_at=submitted_at,
        )
        session.add_all([patrol, incident, offence])
        await session.commit()

        assert (await submit_patrol_report(patrol.id, officer, session)).report_id == str(patrol.id)
        assert (await submit_patrol_report(patrol.id, officer, session)).report_id == str(patrol.id)
        assert (await submit_incident_report(incident.id, officer, session)).incident_id == str(incident.id)
        assert (await submit_incident_report(incident.id, officer, session)).incident_id == str(incident.id)
        assert (await submit_offence_seizure_report(offence.id, officer, session)).report_id == offence.id
        assert (await submit_offence_seizure_report(offence.id, officer, session)).report_id == offence.id

    await engine.dispose()


@pytest.mark.asyncio
async def test_evidence_upload_retry_with_same_operation_id_does_not_duplicate_files(
    tmp_path,
    monkeypatch,
):
    monkeypatch.chdir(tmp_path)
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(User.__table__.create)
        await connection.run_sync(OffenceSeizureReport.__table__.create)
        await connection.run_sync(Evidence.__table__.create)

    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as session:
        officer = User(
            id=uuid4(),
            email="evidence-officer@example.test",
            full_name="Evidence Officer",
            role=UserRole.FIELD_OFFICER,
        )
        session.add(officer)
        await session.flush()
        report = OffenceSeizureReport(officer_id=officer.id, status="DRAFT")
        session.add(report)
        await session.commit()

        async def upload():
            return await upload_evidence(
                report_type="OFFENCE_SEIZURE",
                report_id=report.id,
                file=UploadFile(
                    filename="evidence.jpg",
                    file=BytesIO(b"test evidence bytes"),
                    headers=Headers({"content-type": "image/jpeg"}),
                ),
                description=None,
                client_operation_id="evidence-operation-1",
                user=officer,
                session=session,
            )

        first = await upload()
        retry = await upload()

        assert first["evidence"]["id"] == retry["evidence"]["id"]
        assert await session.scalar(select(func.count()).select_from(Evidence)) == 1
        assert len(list((tmp_path / "uploads" / "evidence").glob("*.jpg"))) == 1

    await engine.dispose()
