from __future__ import annotations

import asyncio
import smtplib
from email.message import EmailMessage
from html import escape

from app.core.config import Settings


class EmailService:
    def __init__(self, settings: Settings):
        self.settings = settings

    @property
    def configured(self) -> bool:
        return bool(
            self.settings.smtp_host
            and self.settings.smtp_from_email
            and self.settings.frontend_base_url
        )

    async def send_password_reset(self, recipient: str, reset_url: str) -> None:
        if not self.configured:
            raise RuntimeError("SMTP email delivery is not configured")

        message = EmailMessage()
        message["Subject"] = "Reset your UP Forest Library password"
        message["From"] = self.settings.smtp_from_email
        message["To"] = recipient
        message.set_content(
            f"Use this link to reset your password: {reset_url}\n\n"
            f"This link expires in {self.settings.password_reset_expire_minutes} minutes."
        )
        message.add_alternative(
            f"<p>We received a request to reset your UP Forest Library password.</p>"
            f'<p><a href="{escape(reset_url)}">Reset your password</a></p>'
            f"<p>This link expires in {self.settings.password_reset_expire_minutes} minutes.</p>",
            subtype="html",
        )

        await asyncio.to_thread(self._send, message)

    def _send(self, message: EmailMessage) -> None:
        with smtplib.SMTP(self.settings.smtp_host, self.settings.smtp_port, timeout=15) as server:
            if self.settings.smtp_use_tls:
                server.starttls()
            if self.settings.smtp_username:
                server.login(self.settings.smtp_username, self.settings.smtp_password)
            server.send_message(message)
