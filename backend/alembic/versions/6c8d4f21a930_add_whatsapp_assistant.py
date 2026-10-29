"""add WhatsApp officer pairing and webhook idempotency

Revision ID: 6c8d4f21a930
Revises: ef8a6c2d91b4
Create Date: 2026-10-26 18:55:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "6c8d4f21a930"
down_revision: Union[str, Sequence[str], None] = "ef8a6c2d91b4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "whatsapp_officer_links",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("phone_number", sa.String(length=20), nullable=True),
        sa.Column("pairing_code_hash", sa.String(length=64), nullable=True),
        sa.Column("pairing_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("paired_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("pairing_code_hash", name="uq_whatsapp_pairing_code_hash"),
        sa.UniqueConstraint("phone_number", name="uq_whatsapp_officer_phone"),
        sa.UniqueConstraint("user_id", name="uq_whatsapp_officer_user"),
    )
    op.create_index(
        "ix_whatsapp_officer_links_user_id",
        "whatsapp_officer_links",
        ["user_id"],
    )
    op.create_table(
        "whatsapp_inbound_messages",
        sa.Column("provider_message_id", sa.String(length=200), nullable=False),
        sa.Column("sender_phone", sa.String(length=20), nullable=False),
        sa.Column("message_text", sa.Text(), nullable=False),
        sa.Column("reply_text", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("provider_message_id"),
    )


def downgrade() -> None:
    op.drop_table("whatsapp_inbound_messages")
    op.drop_index(
        "ix_whatsapp_officer_links_user_id", table_name="whatsapp_officer_links"
    )
    op.drop_table("whatsapp_officer_links")
