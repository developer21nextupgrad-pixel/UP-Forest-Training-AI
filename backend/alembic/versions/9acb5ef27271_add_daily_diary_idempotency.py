"""add daily diary operation idempotency

Revision ID: 9acb5ef27271
Revises: 8d90438ac069
Create Date: 2026-10-26 13:14:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa

from app.db.migration_compat import (
    add_column_if_compatible,
    create_unique_constraint_if_compatible,
    refuse_unsafe_downgrade,
)


revision: str = "9acb5ef27271"
down_revision: Union[str, Sequence[str], None] = "8d90438ac069"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    add_column_if_compatible(
        "daily_diaries",
        sa.Column("client_operation_id", sa.String(length=100), nullable=True),
    )
    create_unique_constraint_if_compatible(
        "uq_daily_diary_officer_operation",
        "daily_diaries",
        ["officer_id", "client_operation_id"],
    )


def downgrade() -> None:
    refuse_unsafe_downgrade(revision)
