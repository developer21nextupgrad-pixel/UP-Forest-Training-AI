import hashlib
import hmac
import json
import logging
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings, get_settings
from app.db.session import get_db_session
from app.main import create_app

VERIFY_TOKEN = "test-verify-token"
APP_SECRET = "test-meta-app-secret"


@pytest.fixture
def client():
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(
        _env_file=None,
        whatsapp_access_token="test-access-token",
        whatsapp_phone_number_id="test-phone-number-id",
        whatsapp_verify_token=VERIFY_TOKEN,
        whatsapp_app_secret=APP_SECRET,
        whatsapp_business_number="+15550000000",
    )

    async def fake_db_session():
        yield None

    app.dependency_overrides[get_db_session] = fake_db_session
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def _signature(body: bytes) -> str:
    digest = hmac.new(APP_SECRET.encode(), body, hashlib.sha256).hexdigest()
    return f"sha256={digest}"


def test_webhook_verification_returns_challenge_for_matching_token(client):
    response = client.get(
        "/api/v1/whatsapp/webhook",
        params={
            "hub.mode": "subscribe",
            "hub.verify_token": VERIFY_TOKEN,
            "hub.challenge": "challenge-value",
        },
    )

    assert response.status_code == 200
    assert response.text == "challenge-value"
    assert response.headers["content-type"].startswith("text/plain")


@pytest.mark.parametrize(
    "params",
    [
        {
            "hub.mode": "subscribe",
            "hub.verify_token": "wrong-token",
            "hub.challenge": "challenge-value",
        },
        {
            "hub.mode": "unsubscribe",
            "hub.verify_token": VERIFY_TOKEN,
            "hub.challenge": "challenge-value",
        },
    ],
)
def test_webhook_verification_rejects_wrong_token_or_mode(client, params):
    response = client.get("/api/v1/whatsapp/webhook", params=params)

    assert response.status_code == 403


def test_webhook_rejects_invalid_signature(client):
    body = b'{"object":"whatsapp_business_account","entry":[]}'

    response = client.post(
        "/api/v1/whatsapp/webhook",
        content=body,
        headers={"X-Hub-Signature-256": "sha256=invalid"},
    )

    assert response.status_code == 401


def test_valid_incoming_message_reaches_assistant_without_logging_personal_data(
    client, monkeypatch, caplog
):
    caplog.set_level(logging.INFO)
    processed = AsyncMock()
    payload = {
        "object": "whatsapp_business_account",
        "entry": [
            {
                "id": "business-account-id",
                "changes": [
                    {
                        "field": "messages",
                        "value": {
                            "metadata": {
                                "phone_number_id": "test-phone-number-id",
                                "display_phone_number": "+15550000000",
                            },
                            "messages": [
                                {
                                    "id": "wamid.incoming-test",
                                    "from": "15551234567",
                                    "type": "text",
                                    "text": {"body": "PRIVATE MESSAGE BODY"},
                                }
                            ]
                        },
                    }
                ],
            }
        ],
    }
    body = json.dumps(payload, separators=(",", ":")).encode()

    monkeypatch.setattr("app.api.whatsapp._process_message", processed)

    response = client.post(
        "/api/v1/whatsapp/webhook",
        content=body,
        headers={"X-Hub-Signature-256": _signature(body)},
    )

    assert response.status_code == 200
    assert response.json() == {"success": True}
    processed.assert_awaited_once()
    message, settings, session = processed.await_args.args
    assert message == {
        "id": "wamid.incoming-test",
        "phone": "15551234567",
        "text": "PRIVATE MESSAGE BODY",
        "type": "text",
    }
    assert settings.whatsapp_phone_number_id == "test-phone-number-id"
    assert session is None
    assert "PRIVATE MESSAGE BODY" not in caplog.text
    assert "15551234567" not in caplog.text
    assert "object=whatsapp_business_account entries=1 changes=1" in caplog.text
    assert "messages=1 statuses=0" in caplog.text


def test_status_only_webhook_is_acknowledged_without_assistant_processing(
    client, monkeypatch, caplog
):
    caplog.set_level(logging.INFO)
    process_message = AsyncMock()
    monkeypatch.setattr("app.api.whatsapp._process_message", process_message)
    payload = {
        "object": "whatsapp_business_account",
        "entry": [
            {
                "id": "business-account-id",
                "changes": [
                    {
                        "field": "messages",
                        "value": {
                            "metadata": {
                                "phone_number_id": "test-phone-number-id",
                            },
                            "statuses": [
                                {
                                    "id": "wamid.delivery-test",
                                    "status": "delivered",
                                    "recipient_id": "15551234567",
                                }
                            ],
                        },
                    }
                ],
            }
        ],
    }
    body = json.dumps(payload, separators=(",", ":")).encode()

    response = client.post(
        "/api/v1/whatsapp/webhook",
        content=body,
        headers={"X-Hub-Signature-256": _signature(body)},
    )

    assert response.status_code == 200
    assert response.json() == {"success": True}
    process_message.assert_not_awaited()
    assert "messages=0 statuses=1" in caplog.text


def test_webhook_rejects_signed_non_whatsapp_payload(client):
    body = b'{"object":"not_whatsapp","entry":[]}'

    response = client.post(
        "/api/v1/whatsapp/webhook",
        content=body,
        headers={"X-Hub-Signature-256": _signature(body)},
    )

    assert response.status_code == 400


def test_webhook_routes_are_in_openapi(client):
    paths = client.get("/openapi.json").json()["paths"]

    assert "get" in paths["/api/v1/whatsapp/webhook"]
    assert "post" in paths["/api/v1/whatsapp/webhook"]


def test_webhook_secrets_are_trimmed_and_empty_configuration_is_detected():
    settings = Settings(
        _env_file=None,
        whatsapp_verify_token="  verify ",
        whatsapp_app_secret=" app-secret ",
    )
    unconfigured = Settings(_env_file=None)

    assert settings.whatsapp_verify_token == "verify"
    assert settings.whatsapp_app_secret == "app-secret"
    assert settings.is_whatsapp_webhook_configured
    assert not unconfigured.is_whatsapp_webhook_configured


def test_whatsapp_cloud_api_settings_read_environment_variables(monkeypatch):
    env_values = {
        "WHATSAPP_ACCESS_TOKEN": "access-token-placeholder",
        "WHATSAPP_PHONE_NUMBER_ID": "phone-id-placeholder",
        "WHATSAPP_VERIFY_TOKEN": "verify-token-placeholder",
        "WHATSAPP_APP_SECRET": "app-secret-placeholder",
        "WHATSAPP_GRAPH_API_VERSION": "v23.0",
        "WHATSAPP_BUSINESS_NUMBER": "+10000000000",
    }
    for key, value in env_values.items():
        monkeypatch.setenv(key, value)

    settings = Settings(_env_file=None)

    assert settings.whatsapp_access_token == env_values["WHATSAPP_ACCESS_TOKEN"]
    assert settings.whatsapp_phone_number_id == env_values["WHATSAPP_PHONE_NUMBER_ID"]
    assert settings.whatsapp_verify_token == env_values["WHATSAPP_VERIFY_TOKEN"]
    assert settings.whatsapp_app_secret == env_values["WHATSAPP_APP_SECRET"]
    assert (
        settings.whatsapp_graph_api_version
        == env_values["WHATSAPP_GRAPH_API_VERSION"]
    )
    assert settings.whatsapp_business_number == env_values["WHATSAPP_BUSINESS_NUMBER"]
