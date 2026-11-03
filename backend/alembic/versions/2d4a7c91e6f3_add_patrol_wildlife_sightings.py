"""add structured wildlife sightings to patrol reports

Revision ID: 2d4a7c91e6f3
Revises: 6c8d4f21a930
Create Date: 2026-11-03 00:00:00.000000
"""

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa

from app.db.migration_compat import add_column_if_compatible, refuse_unsafe_downgrade

revision: str = "2d4a7c91e6f3"
down_revision: str | Sequence[str] | None = "6c8d4f21a930"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    add_column_if_compatible(
        "field_patrol_reports",
        sa.Column("wildlife_sightings", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    refuse_unsafe_downgrade(revision)
