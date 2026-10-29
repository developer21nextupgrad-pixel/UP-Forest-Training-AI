from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api import whatsapp
from app.core.config import Settings
from app.models import User, UserRole, WhatsAppInboundMessage, WhatsAppOfficerLink


def make_settings() -> Settings:
    return Settings(
        _env_file=None,
        whatsapp_access_token="test-access-token",
        whatsapp_phone_number_id="123456",
        whatsapp_verify_token="verify-token",
        whatsapp_app_secret="app-secret",
        whatsapp_business_number="+1 555 0100",
    )


async def create_test_session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(User.__table__.create)
        await connection.run_sync(WhatsAppOfficerLink.__table__.create)
        await connection.run_sync(WhatsAppInboundMessage.__table__.create)
    return engine, async_sessionmaker(engine, expire_on_commit=False)


@pytest.mark.asyncio
async def test_pairing_code_is_hashed_and_consumed_once():
    engine, sessions = await create_test_session()
    settings = make_settings()
    async with sessions() as session:
        officer = User(
            id=uuid4(),
            email="whatsapp-officer@example.test",
            full_name="WhatsApp Officer",
            role=UserRole.FIELD_OFFICER,
            is_active=True,
        )
        session.add(officer)
        await session.commit()

        result = await whatsapp.start_pairing(settings, session, officer)
        link = await session.scalar(
            select(WhatsAppOfficerLink).where(WhatsAppOfficerLink.user_id == officer.id)
        )
        assert link is not None
        assert link.pairing_code_hash == whatsapp._code_hash(
            result.code, settings.whatsapp_app_secret
        )
        assert link.pairing_code_hash != result.code

        message = WhatsAppInboundMessage(
            provider_message_id="wamid.pair",
            sender_phone="15550123456",
            message_text=f"LINK {result.code}",
        )
        reply = await whatsapp._create_reply(message, settings, session)
        assert "now linked" in reply
        await session.refresh(link)
        assert link.phone_number == "15550123456"
        assert link.pairing_code_hash is None

        repeated = await whatsapp._create_reply(message, settings, session)
        assert "invalid or expired" in repeated

    await engine.dispose()


@pytest.mark.asyncio
async def test_webhook_verification_requires_configured_verify_token():
    settings = make_settings()
    response = await whatsapp.verify_meta_webhook(
        settings,
        mode="subscribe",
        verify_token="verify-token",
        challenge="challenge-value",
    )
    assert response.body == b"challenge-value"

    with pytest.raises(HTTPException) as error:
        await whatsapp.verify_meta_webhook(
            settings,
            mode="subscribe",
            verify_token="incorrect",
            challenge="challenge-value",
        )
    assert error.value.status_code == 403


def test_webhook_parser_only_accepts_configured_phone_number():
    message = {
        "id": "wamid.123",
        "from": "15550123456",
        "type": "text",
        "text": {"body": "Question"},
    }
    payload = {
        "entry": [
            {
                "changes": [
                    {
                        "value": {
                            "metadata": {"phone_number_id": "configured-number"},
                            "messages": [message],
                        }
                    }
                ]
            },
            {
                "changes": [
                    {
                        "value": {
                            "metadata": {"phone_number_id": "other-number"},
                            "messages": [{**message, "id": "wamid.other"}],
                        }
                    }
                ]
            },
        ]
    }

    assert whatsapp._extract_messages(payload, "configured-number") == [
        {
            "id": "wamid.123",
            "phone": "15550123456",
            "text": "Question",
            "type": "text",
        }
    ]


@pytest.mark.asyncio
async def test_provider_retry_reuses_reply_and_duplicate_webhook_is_ignored(
    monkeypatch,
):
    engine, sessions = await create_test_session()
    settings = make_settings()
    chat = AsyncMock(return_value=SimpleNamespace(answer="Grounded answer", sources=[]))
    monkeypatch.setattr(whatsapp, "field_chat", chat)
    deliveries: list[str] = []

    async def send(_settings, _recipient: str, text: str):
        deliveries.append(text)
        if len(deliveries) == 1:
            raise RuntimeError("Temporary provider failure")

    monkeypatch.setattr(whatsapp, "send_whatsapp_text", send)

    async with sessions() as session:
        officer = User(
            id=uuid4(),
            email="whatsapp-retry@example.test",
            full_name="Retry Officer",
            role=UserRole.FIELD_OFFICER,
            is_active=True,
        )
        session.add(officer)
        await session.flush()
        session.add(
            WhatsAppOfficerLink(
                user_id=officer.id,
                phone_number="15550123456",
                paired_at=whatsapp.datetime.now(whatsapp.UTC),
            )
        )
        await session.commit()

        payload = {
            "id": "wamid.retry",
            "phone": "15550123456",
            "text": "Where can I find the forest procedure?",
        }
        with pytest.raises(HTTPException) as error:
            await whatsapp._process_message(payload, settings, session)
        assert error.value.status_code == 503

        await whatsapp._process_message(payload, settings, session)
        await whatsapp._process_message(payload, settings, session)

        event = await session.get(WhatsAppInboundMessage, "wamid.retry")
        assert event is not None
        assert event.status == "SENT"
        assert chat.await_count == 1
        assert deliveries == ["Grounded answer", "Grounded answer"]

    await engine.dispose()
