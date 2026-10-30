"""add patrol report submission timestamp

Revision ID: 8cecb07eb060
Revises: 416b4aa442ed
"""

import sqlalchemy as sa

from app.db.migration_compat import add_column_if_compatible, refuse_unsafe_downgrade

revision = "8cecb07eb060"
down_revision = "416b4aa442ed"
branch_labels = None
depends_on = None


def upgrade() -> None:
    add_column_if_compatible(
        "field_patrol_reports",
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    refuse_unsafe_downgrade(revision)