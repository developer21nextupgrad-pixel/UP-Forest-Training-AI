"""reconcile patrol report columns and idempotency constraint

Revision ID: c6e8f91a2d43
Revises: 4f7b19c2a6d1
Create Date: 2026-11-02 12:57:00
"""

import re
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy import inspect

from alembic import op
from app.db.migration_compat import (
    add_column_if_compatible,
    create_unique_constraint_if_compatible,
    refuse_unsafe_downgrade,
)

revision: str = "c6e8f91a2d43"
down_revision: str | Sequence[str] | None = "4f7b19c2a6d1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    if op.get_context().as_sql:
        op.alter_column(
            "field_patrol_reports",
            "review_status",
            existing_type=sa.String(length=30),
            server_default=sa.text("'PENDING'"),
        )
        return

    inspector = inspect(op.get_bind())
    if not inspector.has_table("field_patrol_reports"):
        raise RuntimeError(
            "field_patrol_reports is missing; refusing schema reconciliation"
        )
    columns = {
        column["name"]: column
        for column in inspector.get_columns("field_patrol_reports")
    }
    if "review_status" not in columns:
        add_column_if_compatible(
            "field_patrol_reports",
            sa.Column(
                "review_status",
                sa.String(length=30),
                nullable=False,
                server_default=sa.text("'PENDING'"),
            ),
        )
        columns = {
            column["name"]: column
            for column in inspect(op.get_bind()).get_columns("field_patrol_reports")
        }
    review_status = columns["review_status"]
    if (
        not isinstance(review_status["type"], sa.String)
        or review_status["type"].length != 30
    ):
        raise RuntimeError(
            "field_patrol_reports.review_status has an incompatible type"
        )
    if review_status["nullable"]:
        raise RuntimeError("field_patrol_reports.review_status must not be nullable")
    default = review_status.get("default")
    if default is None:
        op.alter_column(
            "field_patrol_reports",
            "review_status",
            existing_type=sa.String(length=30),
            nullable=False,
            server_default=sa.text("'PENDING'"),
        )
    else:
        normalized_default = re.sub(
            r"::(?:character varying|varchar|text)$",
            "",
            default.strip().lower(),
        )
        while normalized_default.startswith("(") and normalized_default.endswith(")"):
            normalized_default = normalized_default[1:-1]
        if normalized_default.strip("'\" ") != "pending":
            raise RuntimeError(
                "field_patrol_reports.review_status has an incompatible server default"
            )

    add_column_if_compatible(
        "field_patrol_reports",
        sa.Column("client_operation_id", sa.String(length=100), nullable=True),
    )
    add_column_if_compatible(
        "field_patrol_reports",
        sa.Column("wildlife_sightings", sa.JSON(), nullable=True),
    )
    create_unique_constraint_if_compatible(
        "uq_patrol_report_officer_operation",
        "field_patrol_reports",
        ["officer_id", "client_operation_id"],
    )


def downgrade() -> None:
    refuse_unsafe_downgrade(revision)
