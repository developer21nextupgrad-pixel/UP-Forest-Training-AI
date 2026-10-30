"""add idempotency keys to field form draft tables

Revision ID: ef8a6c2d91b4
Revises: 9acb5ef27271
Create Date: 2026-10-26 15:45:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa

from app.db.migration_compat import (
    add_column_if_compatible,
    create_unique_constraint_if_compatible,
    refuse_unsafe_downgrade,
)


revision: str = "ef8a6c2d91b4"
down_revision: Union[str, Sequence[str], None] = "9acb5ef27271"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    for table in ("field_patrol_reports", "incident_reports", "offence_seizure_reports", "evidence"):
        add_column_if_compatible(
            table, sa.Column("client_operation_id", sa.String(length=100), nullable=True)
        )
    create_unique_constraint_if_compatible(
        "uq_patrol_report_officer_operation",
        "field_patrol_reports",
        ["officer_id", "client_operation_id"],
    )
    create_unique_constraint_if_compatible(
        "uq_incident_report_officer_operation",
        "incident_reports",
        ["officer_id", "client_operation_id"],
    )
    create_unique_constraint_if_compatible(
        "uq_offence_report_officer_operation",
        "offence_seizure_reports",
        ["officer_id", "client_operation_id"],
    )
    create_unique_constraint_if_compatible(
        "uq_evidence_officer_operation",
        "evidence",
        ["officer_id", "client_operation_id"],
    )


def downgrade() -> None:
    refuse_unsafe_downgrade(revision)
