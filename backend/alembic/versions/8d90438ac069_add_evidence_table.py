"""add evidence table

Revision ID: 8d90438ac069
Revises: cd4e6ce2549a
Create Date: 2026-10-08 18:48:37.243933
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "8d90438ac069"
down_revision: Union[str, Sequence[str], None] = "cd4e6ce2549a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade database schema."""

    op.create_table(
        "evidence",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("report_type", sa.String(length=30), nullable=False),
        sa.Column("report_id", sa.UUID(), nullable=False),
        sa.Column("officer_id", sa.UUID(), nullable=False),
        sa.Column("file_name", sa.Text(), nullable=False),
        sa.Column("storage_key", sa.Text(), nullable=False),
        sa.Column("file_type", sa.String(length=20), nullable=False),
        sa.Column("file_size", sa.BigInteger(), nullable=False),
        sa.Column("mime_type", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "uploaded_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["officer_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("storage_key"),
    )

    op.create_index(
        "ix_evidence_officer_id",
        "evidence",
        ["officer_id"],
        unique=False,
    )

    op.create_index(
        "ix_evidence_report_id",
        "evidence",
        ["report_id"],
        unique=False,
    )

    op.create_index(
        "ix_evidence_report_type",
        "evidence",
        ["report_type"],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade database schema."""

    op.drop_index(
        "ix_evidence_report_type",
        table_name="evidence",
    )

    op.drop_index(
        "ix_evidence_report_id",
        table_name="evidence",
    )

    op.drop_index(
        "ix_evidence_officer_id",
        table_name="evidence",
    )

    op.drop_table("evidence")