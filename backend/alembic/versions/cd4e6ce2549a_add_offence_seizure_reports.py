"""add offence seizure reports

Revision ID: cd4e6ce2549a
Revises: 2df3157e4b50
Create Date: 2026-10-08 12:54:32.405218
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from app.db.migration_compat import (
    create_index_if_compatible,
    create_table_if_compatible,
    refuse_unsafe_downgrade,
)


revision: str = "cd4e6ce2549a"
down_revision: Union[str, Sequence[str], None] = "2df3157e4b50"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    create_table_if_compatible(
        "offence_seizure_reports",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("officer_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("offence_date", sa.Date(), nullable=True),
        sa.Column("offence_time", sa.Time(), nullable=True),
        sa.Column("division", sa.Text(), nullable=True),
        sa.Column("range_name", sa.Text(), nullable=True),
        sa.Column("beat", sa.Text(), nullable=True),
        sa.Column("location", sa.Text(), nullable=True),
        sa.Column("offence_type", sa.Text(), nullable=True),
        sa.Column("applicable_law", sa.Text(), nullable=True),
        sa.Column("applicable_section", sa.Text(), nullable=True),
        sa.Column("persons_involved", sa.JSON(), nullable=False),
        sa.Column("seized_material", sa.JSON(), nullable=False),
        sa.Column("seizure_location", sa.Text(), nullable=True),
        sa.Column("seizure_date", sa.Date(), nullable=True),
        sa.Column("seizure_time", sa.Time(), nullable=True),
        sa.Column("vehicle_details", sa.Text(), nullable=True),
        sa.Column(
            "vehicle_registration_number",
            sa.Text(),
            nullable=True,
        ),
        sa.Column("evidence_details", sa.Text(), nullable=True),
        sa.Column("witnesses", sa.JSON(), nullable=False),
        sa.Column("action_taken", sa.Text(), nullable=True),
        sa.Column("authorities_informed", sa.Text(), nullable=True),
        sa.Column("case_reference_number", sa.Text(), nullable=True),
        sa.Column("fir_number", sa.Text(), nullable=True),
        sa.Column("incident_reference_id", sa.Uuid(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("additional_remarks", sa.Text(), nullable=True),
        sa.Column("source_text", sa.Text(), nullable=True),
        sa.Column("ai_confidence", sa.Float(), nullable=True),
        sa.Column(
            "review_status",
            sa.String(length=30),
            nullable=False,
        ),
        sa.Column("review_comment", sa.Text(), nullable=True),
        sa.Column("reviewed_by", sa.Uuid(), nullable=True),
        sa.Column(
            "reviewed_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
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
        sa.Column(
            "submitted_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.ForeignKeyConstraint(
            ["incident_reference_id"],
            ["incident_reports.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["officer_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["reviewed_by"],
            ["users.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    create_index_if_compatible(
        op.f("ix_offence_seizure_reports_incident_reference_id"),
        "offence_seizure_reports",
        ["incident_reference_id"],
        unique=False,
    )

    create_index_if_compatible(
        op.f("ix_offence_seizure_reports_officer_id"),
        "offence_seizure_reports",
        ["officer_id"],
        unique=False,
    )

    create_index_if_compatible(
        op.f("ix_offence_seizure_reports_review_status"),
        "offence_seizure_reports",
        ["review_status"],
        unique=False,
    )

    create_index_if_compatible(
        op.f("ix_offence_seizure_reports_reviewed_by"),
        "offence_seizure_reports",
        ["reviewed_by"],
        unique=False,
    )

    create_index_if_compatible(
        op.f("ix_offence_seizure_reports_status"),
        "offence_seizure_reports",
        ["status"],
        unique=False,
    )


def downgrade() -> None:
    refuse_unsafe_downgrade(revision)