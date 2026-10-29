"""add idempotency keys to field form draft tables

Revision ID: ef8a6c2d91b4
Revises: 9acb5ef27271
Create Date: 2026-10-26 15:45:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "ef8a6c2d91b4"
down_revision: Union[str, Sequence[str], None] = "9acb5ef27271"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    for table in ("field_patrol_reports", "incident_reports", "offence_seizure_reports", "evidence"):
        op.add_column(table, sa.Column("client_operation_id", sa.String(length=100), nullable=True))
    op.create_unique_constraint(
        "uq_patrol_report_officer_operation",
        "field_patrol_reports",
        ["officer_id", "client_operation_id"],
    )
    op.create_unique_constraint(
        "uq_incident_report_officer_operation",
        "incident_reports",
        ["officer_id", "client_operation_id"],
    )
    op.create_unique_constraint(
        "uq_offence_report_officer_operation",
        "offence_seizure_reports",
        ["officer_id", "client_operation_id"],
    )
    op.create_unique_constraint(
        "uq_evidence_officer_operation",
        "evidence",
        ["officer_id", "client_operation_id"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_evidence_officer_operation", "evidence", type_="unique")
    op.drop_constraint("uq_offence_report_officer_operation", "offence_seizure_reports", type_="unique")
    op.drop_constraint("uq_incident_report_officer_operation", "incident_reports", type_="unique")
    op.drop_constraint("uq_patrol_report_officer_operation", "field_patrol_reports", type_="unique")
    for table in ("evidence", "offence_seizure_reports", "incident_reports", "field_patrol_reports"):
        op.drop_column(table, "client_operation_id")
