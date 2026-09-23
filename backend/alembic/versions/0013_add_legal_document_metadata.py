"""Add legal metadata to documents.

Revision ID: 0013_add_legal_document_metadata
Revises: 0012_production_content_pgvector
Create Date: 2026-09-17
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0013_add_legal_document_metadata"
down_revision = "0012_production_content_pgvector"
branch_labels = None
depends_on = None


DOCUMENT_TYPE_VALUES = (
    "ACT",
    "RULE",
    "ORDER",
    "CIRCULAR",
    "SOP",
    "JUDGMENT",
)


def upgrade() -> None:
    # Legal metadata is intentionally nullable because existing
    # Training/Forest documents do not require legal classification.
    op.add_column(
        "documents",
        sa.Column(
            "document_type",
            sa.String(length=50),
            nullable=True,
        ),
    )

    op.add_column(
        "documents",
        sa.Column(
            "authority",
            sa.String(length=255),
            nullable=True,
        ),
    )

    op.add_column(
        "documents",
        sa.Column(
            "effective_date",
            sa.Date(),
            nullable=True,
        ),
    )

    op.add_column(
        "documents",
        sa.Column(
            "rule",
            sa.Text(),
            nullable=True,
        ),
    )

    # Controlled vocabulary at the database boundary.
    # NULL remains valid for non-legal documents.
    op.create_check_constraint(
        "ck_documents_document_type",
        "documents",
        "document_type IS NULL OR document_type IN "
        "('ACT', 'RULE', 'ORDER', 'CIRCULAR', 'SOP', 'JUDGMENT')",
    )

    op.create_index(
        "ix_documents_document_type",
        "documents",
        ["document_type"],
    )

    op.create_index(
        "ix_documents_authority",
        "documents",
        ["authority"],
    )

    op.create_index(
        "ix_documents_effective_date",
        "documents",
        ["effective_date"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_documents_effective_date",
        table_name="documents",
    )

    op.drop_index(
        "ix_documents_authority",
        table_name="documents",
    )

    op.drop_index(
        "ix_documents_document_type",
        table_name="documents",
    )

    op.drop_constraint(
        "ck_documents_document_type",
        "documents",
        type_="check",
    )

    op.drop_column("documents", "rule")
    op.drop_column("documents", "effective_date")
    op.drop_column("documents", "authority")
    op.drop_column("documents", "document_type")