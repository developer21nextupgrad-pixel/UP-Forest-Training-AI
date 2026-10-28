"""Meta WhatsApp Cloud API webhook and Field Officer pairing endpoints."""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import re
import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

import httpx
from fastapi import (
    APIRouter,
    Depends,
    Header,
    HTTPException,
    Query,
    Request,
    Response,
    status,
)
from pydantic import BaseModel
from sqlalchemy import and_, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_field_officer
from app.api.field import field_chat
from app.core.config import SettingsDep
from app.core.rate_limiter import get_rate_limiter
from app.db.session import get_db_session
from app.models import User, UserRole, WhatsAppInboundMessage, WhatsAppOfficerLink
from app.schemas.response import RagChatRequest

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/whatsapp", tags=["whatsapp"])

PAIRING_TTL = timedelta(minutes=10)
PROCESSING_LEASE = timedelta(minutes=3)
MAX_MESSAGE_LENGTH = 4000
MAX_REPLY_LENGTH = 4096
MAX_WEBHOOK_BODY_BYTES = 1_000_000


class PairingStatusResponse(BaseModel):
    success: bool = True
    configured: bool
    business_number: str | None = None
    paired: bool
    masked_phone_number: str | None = None
    pairing_expires_at: datetime | None = None


class PairingCodeResponse(BaseModel):
    success: bool = True
    code: str
    expires_at: datetime
    business_number: str | None = None


class UnlinkResponse(BaseModel):
    success: bool = True
    paired: bool = False


def _code_hash(code: str, secret: str) -> str:
    return hmac.new(
        secret.encode("utf-8"), code.encode("ascii"), hashlib.sha256
    ).hexdigest()


def _normalize_phone(value: str) -> str | None:
    digits = re.sub(r"\D", "", value)
    if not 8 <= len(digits) <= 15:
        return None
    return digits


def _mask_phone(value: str | None) -> str | None:
    if not value:
        return None
    return f"••••••{value[-4:]}"


@router.get("/pairing", response_model=PairingStatusResponse)
async def get_pairing_status(
    settings: SettingsDep,
    session: AsyncSession = Depends(get_db_session),
    user: User = Depends(require_field_officer),
) -> PairingStatusResponse:
    link = await session.scalar(
        select(WhatsAppOfficerLink).where(WhatsAppOfficerLink.user_id == user.id)
    )
    return PairingStatusResponse(
        configured=settings.is_whatsapp_configured,
        business_number=settings.whatsapp_business_number or None,
        paired=bool(link and link.phone_number),
        masked_phone_number=_mask_phone(link.phone_number if link else None),
        pairing_expires_at=link.pairing_expires_at if link else None,
    )


@router.post("/pairing", response_model=PairingCodeResponse)
async def start_pairing(
    settings: SettingsDep,
    session: AsyncSession = Depends(get_db_session),
    user: User = Depends(require_field_officer),
) -> PairingCodeResponse:
    if not settings.is_whatsapp_configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="WhatsApp messaging is not configured by the administrator.",
        )

    link = await session.scalar(
        select(WhatsAppOfficerLink).where(WhatsAppOfficerLink.user_id == user.id)
    )
    if link is not None and link.phone_number:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Unlink the current WhatsApp number before pairing another number.",
        )
    if link is None:
        link = WhatsAppOfficerLink(user_id=user.id)
        session.add(link)

    code = f"{secrets.randbelow(100_000_000):08d}"
    link.pairing_code_hash = _code_hash(code, settings.whatsapp_app_secret)
    link.pairing_expires_at = datetime.now(UTC) + PAIRING_TTL
    await session.commit()
    return PairingCodeResponse(
        code=code,
        expires_at=link.pairing_expires_at,
        business_number=settings.whatsapp_business_number or None,
    )


@router.delete("/pairing", response_model=UnlinkResponse)
async def unlink_whatsapp(
    session: AsyncSession = Depends(get_db_session),
    user: User = Depends(require_field_officer),
) -> UnlinkResponse:
    link = await session.scalar(
        select(WhatsAppOfficerLink).where(WhatsAppOfficerLink.user_id == user.id)
    )
    if link is not None:
        await session.delete(link)
        await session.commit()
    return UnlinkResponse()


async def send_whatsapp_text(settings: Any, recipient: str, text: str) -> None:
    if not settings.is_whatsapp_configured:
        raise RuntimeError("WhatsApp provider credentials are not configured.")
    if not re.fullmatch(r"v\d+\.\d+", settings.whatsapp_graph_api_version):
        raise RuntimeError("WHATSAPP_GRAPH_API_VERSION must look like vNN.N.")
    url = (
        f"https://graph.facebook.com/{settings.whatsapp_graph_api_version}/"
        f"{settings.whatsapp_phone_number_id}/messages"
    )
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.post(
            url,
            headers={"Authorization": f"Bearer {settings.whatsapp_access_token}"},
            json={
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": recipient,
                "type": "text",
                "text": {"preview_url": False, "body": text[:MAX_REPLY_LENGTH]},
            },
        )
        response.raise_for_status()


def _extract_messages(
    payload: dict[str, Any], expected_phone_number_id: str
) -> list[dict[str, str]]:
    messages: list[dict[str, str]] = []
    entries = payload.get("entry", [])
    if not isinstance(entries, list):
        return messages
    for entry in entries:
        if not isinstance(entry, dict) or not isinstance(entry.get("changes"), list):
            continue
        for change in entry["changes"]:
            if not isinstance(change, dict):
                continue
            value = change.get("value", {})
            if not isinstance(value, dict):
                continue
            metadata = value.get("metadata", {})
            if not isinstance(metadata, dict):
                continue
            if metadata.get("phone_number_id") != expected_phone_number_id:
                continue
            value_messages = value.get("messages", [])
            if not isinstance(value_messages, list):
                continue
            for message in value_messages:
                if not isinstance(message, dict):
                    continue
                message_id = message.get("id")
                sender = message.get("from")
                if (
                    not isinstance(message_id, str)
                    or len(message_id) > 200
                    or not isinstance(sender, str)
                ):
                    continue
                phone = _normalize_phone(sender)
                if not phone:
                    continue
                kind = message.get("type")
                text_data = message.get("text")
                body = (
                    text_data.get("body")
                    if kind == "text" and isinstance(text_data, dict)
                    else None
                )
                messages.append({
                    "id": message_id,
                    "phone": phone,
                    "text": body[: MAX_MESSAGE_LENGTH + 1] if isinstance(body, str) else "",
                    "type": kind if isinstance(kind, str) else "unknown",
                })
    return messages


async def _create_reply(
    message: WhatsAppInboundMessage,
    settings: Any,
    session: AsyncSession,
) -> str:
    if not message.message_text:
        return "Please send your question as a text message. Image and voice messages are not supported yet."

    pairing_command = re.fullmatch(r"\s*LINK\s+(\d{8})\s*", message.message_text, re.IGNORECASE)
    if pairing_command:
        if not get_rate_limiter().allow(key=f"whatsapp-pairing:{message.sender_phone}"):
            return "Too many pairing attempts. Please wait a minute and try again."
        code = pairing_command.group(1)
        now = datetime.now(UTC)
        link = await session.scalar(
            select(WhatsAppOfficerLink).where(
                WhatsAppOfficerLink.pairing_code_hash
                == _code_hash(code, settings.whatsapp_app_secret)
            )
        )
        if link is None or link.pairing_expires_at is None:
            return "That pairing code is invalid or expired. Generate a new code in the Field Officer portal."
        expiry = link.pairing_expires_at
        if expiry.tzinfo is None:
            expiry = expiry.replace(tzinfo=UTC)
        if expiry <= now:
            link.pairing_code_hash = None
            link.pairing_expires_at = None
            await session.commit()
            return "That pairing code has expired. Generate a new code in the Field Officer portal."

        officer = await session.get(User, link.user_id)
        if officer is None or not officer.is_active or officer.role != UserRole.FIELD_OFFICER:
            return "This account cannot be linked. Contact your administrator."
        existing = await session.scalar(
            select(WhatsAppOfficerLink).where(
                WhatsAppOfficerLink.phone_number == message.sender_phone
            )
        )
        if existing is not None and existing.user_id != link.user_id:
            return "This WhatsApp number is already linked to another account. Contact your administrator."
        consumed = await session.execute(
            update(WhatsAppOfficerLink)
            .where(
                WhatsAppOfficerLink.id == link.id,
                WhatsAppOfficerLink.pairing_code_hash
                == _code_hash(code, settings.whatsapp_app_secret),
                WhatsAppOfficerLink.pairing_expires_at > now,
                WhatsAppOfficerLink.phone_number.is_(None),
            )
            .values(
                phone_number=message.sender_phone,
                paired_at=now,
                pairing_code_hash=None,
                pairing_expires_at=None,
                updated_at=now,
            )
            .execution_options(synchronize_session=False)
        )
        if consumed.rowcount != 1:
            await session.rollback()
            return "That pairing code is invalid or expired. Generate a new code in the Field Officer portal."
        await session.commit()
        return "Your WhatsApp number is now linked to your Field Officer account. You can ask forest and field knowledge questions here."

    link = await session.scalar(
        select(WhatsAppOfficerLink).where(
            WhatsAppOfficerLink.phone_number == message.sender_phone
        )
    )
    if link is None:
        return "This number is not linked. Sign in to the Field Officer portal, create a WhatsApp pairing code, then send LINK followed by the code."
    officer = await session.get(User, link.user_id)
    if officer is None or not officer.is_active or officer.role != UserRole.FIELD_OFFICER:
        return "Your linked Field Officer account is unavailable. Contact your administrator."
    if len(message.message_text) > MAX_MESSAGE_LENGTH:
        return f"Please keep questions under {MAX_MESSAGE_LENGTH} characters."

    if not get_rate_limiter().allow(key=f"whatsapp-assistant:{message.sender_phone}"):
        return "You have reached the message limit. Please try again in a minute."

    answer = await field_chat(
        RagChatRequest(question=message.message_text),
        settings,
        session,
        officer,
    )
    reply = answer.answer
    if answer.sources:
        sources = "\n".join(
            f"• {source.filename}, p. {source.page}"
            for source in answer.sources[:3]
        )
        reply = f"{reply}\n\nSources:\n{sources}"
    return reply[:MAX_REPLY_LENGTH]


async def _process_message(
    message: dict[str, str],
    settings: Any,
    session: AsyncSession,
) -> None:
    event = await session.get(WhatsAppInboundMessage, message["id"])
    if event is None:
        event = WhatsAppInboundMessage(
            provider_message_id=message["id"],
            sender_phone=message["phone"],
            message_text=message["text"],
            status="RECEIVED",
        )
        session.add(event)
        try:
            await session.commit()
        except IntegrityError:
            await session.rollback()
            event = await session.get(WhatsAppInboundMessage, message["id"])
            if event is None:
                raise

    now = datetime.now(UTC)
    claim = await session.execute(
        update(WhatsAppInboundMessage)
        .where(
            WhatsAppInboundMessage.provider_message_id == message["id"],
            or_(
                WhatsAppInboundMessage.status.in_(("RECEIVED", "FAILED", "PENDING_SEND")),
                and_(
                    WhatsAppInboundMessage.status == "PROCESSING",
                    WhatsAppInboundMessage.updated_at < now - PROCESSING_LEASE,
                ),
            ),
        )
        .values(status="PROCESSING", updated_at=now)
    )
    if claim.rowcount != 1:
        await session.commit()
        return
    await session.commit()
    event = await session.get(WhatsAppInboundMessage, message["id"])
    if event is None:
        raise RuntimeError("Claimed WhatsApp event could not be reloaded.")

    try:
        if event.reply_text and event.status == "PROCESSING":
            # A previous delivery attempt already produced an answer; retry only
            # provider delivery rather than repeating retrieval/model work.
            reply = event.reply_text
        else:
            reply = await _create_reply(event, settings, session)
        event.reply_text = reply
        event.status = "PENDING_SEND"
        event.last_error = None
        await session.commit()
    except Exception as exc:
        await session.rollback()
        event = await session.get(WhatsAppInboundMessage, message["id"])
        if event is not None:
            event.status = "FAILED"
            event.last_error = "Assistant could not prepare a response."
            await session.commit()
        logger.exception("WhatsApp assistant processing failed for message %s", message["id"])
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Assistant temporarily unavailable.",
        ) from exc

    try:
        await send_whatsapp_text(settings, message["phone"], reply)
    except Exception as exc:
        await session.rollback()
        event = await session.get(WhatsAppInboundMessage, message["id"])
        if event is not None:
            event.status = "PENDING_SEND"
            event.last_error = "WhatsApp provider did not confirm message delivery."
            await session.commit()
        logger.exception("WhatsApp provider send failed for message %s", message["id"])
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="WhatsApp response delivery failed.",
        ) from exc

    event = await session.get(WhatsAppInboundMessage, message["id"])
    if event is not None:
        event.status = "SENT"
        event.last_error = None
        await session.commit()


@router.get("/webhook")
async def verify_meta_webhook(
    settings: SettingsDep,
    mode: str | None = Query(default=None, alias="hub.mode"),
    verify_token: str | None = Query(default=None, alias="hub.verify_token"),
    challenge: str | None = Query(default=None, alias="hub.challenge"),
) -> Response:
    if (
        mode != "subscribe"
        or not settings.whatsapp_verify_token
        or not verify_token
        or not hmac.compare_digest(verify_token, settings.whatsapp_verify_token)
        or challenge is None
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Webhook verification failed.",
        )
    return Response(content=challenge, media_type="text/plain")


@router.post("/webhook")
async def receive_meta_webhook(
    request: Request,
    settings: SettingsDep,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    signature: str | None = Header(default=None, alias="X-Hub-Signature-256"),
) -> dict[str, bool]:
    if not settings.is_whatsapp_webhook_configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="WhatsApp webhook verification settings are not configured.",
        )
    content_length = request.headers.get("content-length")
    if content_length is not None:
        try:
            if int(content_length) > MAX_WEBHOOK_BODY_BYTES:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail="Webhook payload is too large.",
                )
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid content length.",
            ) from exc
    body = await request.body()
    if len(body) > MAX_WEBHOOK_BODY_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Webhook payload is too large.",
        )
    digest = hmac.new(
        settings.whatsapp_app_secret.encode("utf-8"), body, hashlib.sha256
    ).hexdigest()
    expected_signature = f"sha256={digest}"
    if not signature or not hmac.compare_digest(signature, expected_signature):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid webhook signature.",
        )
    try:
        payload = json.loads(body)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=400, detail="Invalid webhook payload.") from exc
    if (
        not isinstance(payload, dict)
        or payload.get("object") != "whatsapp_business_account"
        or not isinstance(payload.get("entry"), list)
    ):
        raise HTTPException(status_code=400, detail="Unsupported webhook payload.")
    changes = []
    message_count = 0
    status_count = 0
    known_fields = {
        "account_update",
        "messages",
        "message_template_status_update",
        "phone_number_name_update",
        "phone_number_quality_update",
    }
    for entry in payload["entry"]:
        if not isinstance(entry, dict) or not isinstance(entry.get("changes"), list):
            raise HTTPException(status_code=400, detail="Invalid webhook payload.")
        for change in entry["changes"]:
            if (
                not isinstance(change, dict)
                or not isinstance(change.get("field"), str)
                or not isinstance(change.get("value"), dict)
            ):
                raise HTTPException(status_code=400, detail="Invalid webhook payload.")
            changes.append(change)
            value = change["value"]
            if change["field"] == "messages":
                messages = value.get("messages", [])
                statuses = value.get("statuses", [])
                if not isinstance(messages, list) or not isinstance(statuses, list):
                    raise HTTPException(
                        status_code=400, detail="Invalid webhook payload."
                    )
                message_count += len(messages)
                status_count += len(statuses)

    if message_count:
        if not settings.is_whatsapp_configured:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="WhatsApp assistant is not configured.",
            )
        for message in _extract_messages(payload, settings.whatsapp_phone_number_id):
            await _process_message(message, settings, session)

    logger.info(
        "Accepted WhatsApp webhook event object=%s entries=%d changes=%d "
        "fields=%s messages=%d statuses=%d",
        payload["object"],
        len(payload["entry"]),
        len(changes),
        ",".join(
            sorted(
                {
                    change["field"]
                    if change["field"] in known_fields
                    else "other"
                    for change in changes
                }
            )
        ),
        message_count,
        status_count,
    )
    return {"success": True}
