"""add daily diary operation idempotency

Revision ID: 9acb5ef27271
Revises: 8d90438ac069
Create Date: 2026-10-26 13:14:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "9acb5ef27271"
down_revision: Union[str, Sequence[str], None] = "8d90438ac069"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "daily_diaries",
        sa.Column("client_operation_id", sa.String(length=100), nullable=True),
    )
    op.create_unique_constraint(
        "uq_daily_diary_officer_operation",
        "daily_diaries",
        ["officer_id", "client_operation_id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_daily_diary_officer_operation",
        "daily_diaries",
        type_="unique",
    )
    op.drop_column("daily_diaries", "client_operation_id")
