"""reconcile structured patrol wildlife sightings column

Revision ID: 4f7b19c2a6d1
Revises: 2d4a7c91e6f3
Create Date: 2026-11-04 12:38:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from app.db.migration_compat import add_column_if_compatible, refuse_unsafe_downgrade

revision: str = "4f7b19c2a6d1"
down_revision: str | Sequence[str] | None = "2d4a7c91e6f3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    add_column_if_compatible(
        "field_patrol_reports",
        sa.Column("wildlife_sightings", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    refuse_unsafe_downgrade(revision)
