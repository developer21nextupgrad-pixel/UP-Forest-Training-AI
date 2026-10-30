"""add field patrol reports

Revision ID: 416b4aa442ed
Revises: 5cd7d0d9c1b7
Create Date: 2026-09-24 15:31:15.402444

"""

from typing import Sequence, Union

import sqlalchemy as sa

from app.db.migration_compat import (
    create_index_if_compatible,
    create_table_if_compatible,
    refuse_unsafe_downgrade,
)


# revision identifiers, used by Alembic.
revision: str = "416b4aa442ed"
down_revision: Union[str, Sequence[str], None] = "5cd7d0d9c1b7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    create_table_if_compatible(
        "field_patrol_reports",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("officer_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("patrol_date", sa.Date(), nullable=True),
        sa.Column("beat", sa.Text(), nullable=True),
        sa.Column("range_name", sa.Text(), nullable=True),
        sa.Column("division", sa.Text(), nullable=True),
        sa.Column("start_time", sa.Time(), nullable=True),
        sa.Column("end_time", sa.Time(), nullable=True),
        sa.Column("location", sa.Text(), nullable=True),
        sa.Column("team_members", sa.JSON(), nullable=False),
        sa.Column("purpose", sa.Text(), nullable=True),
        sa.Column("observations", sa.Text(), nullable=True),
        sa.Column("wildlife_sighting", sa.Text(), nullable=True),
        sa.Column("illegal_activity", sa.Text(), nullable=True),
        sa.Column("action_taken", sa.Text(), nullable=True),
        sa.Column("incident_details", sa.Text(), nullable=True),
        sa.Column("additional_remarks", sa.Text(), nullable=True),
        sa.Column("source_text", sa.Text(), nullable=True),
        sa.Column("ai_confidence", sa.Float(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["officer_id"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    create_index_if_compatible(
        "ix_field_patrol_reports_officer_id",
        "field_patrol_reports",
        ["officer_id"],
        unique=False,
    )

    create_index_if_compatible(
        "ix_field_patrol_reports_status",
        "field_patrol_reports",
        ["status"],
        unique=False,
    )


def downgrade() -> None:
    refuse_unsafe_downgrade(revision)