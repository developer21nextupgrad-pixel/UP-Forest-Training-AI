"""Widen document processing status columns for all ProcessingStatus values.

Revision ID: 0011_widen_status_columns
Revises: 0010_dashboard_indexes
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0011_widen_status_columns"
down_revision: str | Sequence[str] | None = "0010_dashboard_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for column in ("processing_status", "ocr_status", "embedding_status"):
        op.alter_column(
            "documents",
            column,
            existing_type=sa.String(length=10),
            type_=sa.String(length=30),
            existing_nullable=False,
        )


def downgrade() -> None:
    for column in ("processing_status", "ocr_status", "embedding_status"):
        op.alter_column(
            "documents",
            column,
            existing_type=sa.String(length=30),
            type_=sa.String(length=10),
            existing_nullable=False,
        )
