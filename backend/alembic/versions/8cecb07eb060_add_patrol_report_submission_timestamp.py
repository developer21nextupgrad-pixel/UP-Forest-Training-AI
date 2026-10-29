"""add patrol report submission timestamp

Revision ID: 8cecb07eb060
Revises: 416b4aa442ed
"""

from alembic import op
import sqlalchemy as sa

revision = "8cecb07eb060"
down_revision = "416b4aa442ed"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "field_patrol_reports",
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("field_patrol_reports", "submitted_at")