"""expand user role column

Revision ID: 60226d546d14
Revises: 0015_add_manual_document_type
Create Date: 2026-09-22 12:15:06.561060
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "60226d546d14"
down_revision: Union[str, Sequence[str], None] = "0015_add_manual_document_type"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "users",
        "role",
        existing_type=sa.String(length=10),
        type_=sa.String(length=30),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "users",
        "role",
        existing_type=sa.String(length=30),
        type_=sa.String(length=10),
        existing_nullable=False,
    )